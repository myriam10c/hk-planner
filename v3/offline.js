// File hors ligne. Chaque geste est ecrit dans IndexedDB avec sa cle
// d'idempotence AVANT toute tentative reseau, et rejoue dans l'ordre au retour du
// reseau (specification, ruling 7). Le proxy accepte les rejeux : meme cle, meme
// resultat, aucune ecriture en double.
import { api, ApiError } from '/v3/api.js';
import { practiceActive, practiceMark } from '/v3/practice.js';
import { toast } from '/v3/ui.js';

const DB_NAME = 'hk-v3';
const DB_VERSION = 3;
const STORE = 'queue';
// Magasin mort : une action refusee definitivement par le proxy (4xx autre que
// 429 et 409) ne peut pas rester dans la file, elle bloquerait tout ce qui la
// suit. Elle n'est pas jetee pour autant : elle atterrit ici, avec sa raison, et
// l'ecran Profile la montre. Le critere de succes de la phase A est « zero
// action perdue », pas « zero action refusee ».
const DEAD = 'dead';
// Octets des photos de la journee, par cle de televersement (tache 5 du
// branchement) : un rechargement au milieu d'un menage retrouve ses miniatures et
// les fichiers du partage WhatsApp, qu'ils soient deja partis ou non.
const FILES = 'files';
// Etat des conversations du jour (reprise) : sessionStorage disparait quand iOS
// ferme l'app installee, IndexedDB reste. Une seule ligne par cle.
const ETAT = 'state';

export function newIdem() {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID().replace(/-/g, '');
  const a = new Uint8Array(16);
  c.getRandomValues(a);
  return Array.prototype.map.call(a, function (b) {
    return ('0' + b.toString(16)).slice(-2);
  }).join('');
}

function openDb() {
  return new Promise(function (resolve, reject) {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = function () {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        // seq auto-incremente : l'ordre d'insertion est l'ordre de rejeu.
        db.createObjectStore(STORE, { keyPath: 'seq', autoIncrement: true });
      }
      if (!db.objectStoreNames.contains(DEAD)) {
        db.createObjectStore(DEAD, { keyPath: 'seq', autoIncrement: true });
      }
      if (!db.objectStoreNames.contains(FILES)) {
        db.createObjectStore(FILES, { keyPath: 'idem' });
      }
      if (!db.objectStoreNames.contains(ETAT)) {
        db.createObjectStore(ETAT, { keyPath: 'key' });
      }
    };
    req.onsuccess = function () { resolve(req.result); };
    req.onerror = function () { reject(req.error); };
  });
}

function tx(mode, fn, nom) {
  return openDb().then(function (db) {
    return new Promise(function (resolve, reject) {
      const cible = nom || STORE;
      const t = db.transaction(cible, mode);
      const store = t.objectStore(cible);
      let out;
      // IndexedDB rejette volontiers avec un `error` nul. Sans ce repli, la
      // promesse remonte `null` et plus personne ne sait ce qui s'est passe :
      // c'est exactement ce qui masquait le refus de stocker un Blob.
      function echec(ou, err) {
        db.close();
        reject(err || new Error('IndexedDB ' + ou + ' failed on ' + cible));
      }
      const r = fn(store);
      if (r && typeof r.onsuccess !== 'undefined') {
        r.onsuccess = function () { out = r.result; };
        r.onerror = function () { echec('request', r.error); };
      }
      t.oncomplete = function () { db.close(); resolve(out); };
      t.onerror = function () { echec('transaction', t.error); };
      t.onabort = function () { echec('transaction', t.error); };
    });
  });
}

export function enqueue(entry) {
  return tx('readwrite', function (store) { return store.add(entry); });
}

export function pendingEntries() {
  return tx('readonly', function (store) { return store.getAll(); })
    .then(function (rows) {
      return (rows || []).slice().sort(function (a, b) { return a.seq - b.seq; });
    });
}

export function pendingCount() {
  return tx('readonly', function (store) { return store.count(); })
    .then(function (n) { return Number(n || 0); });
}

function drop(seq) {
  return tx('readwrite', function (store) { return store.delete(seq); });
}

export function resetQueue() {
  return tx('readwrite', function (store) { return store.clear(); });
}

// Actions refusees definitivement, dans l'ordre. Lues par l'ecran Profile.
export function deadEntries() {
  return tx('readonly', function (store) { return store.getAll(); }, DEAD)
    .then(function (rows) {
      return (rows || []).slice().sort(function (a, b) { return a.seq - b.seq; });
    });
}

export function clearDead() {
  return tx('readwrite', function (store) { return store.clear(); }, DEAD);
}

// ---- Fichiers des photos (reprise) ----
export async function putFile(idem, file) {
  if (!idem || !file) return;
  const g = await gardable(file);
  return tx('readwrite', function (store) {
    return store.put({ idem: idem, bytes: g.bytes, file: g.file, fileType: g.fileType, name: file.name || 'photo.jpg', at: Date.now() });
  }, FILES);
}

// Rend { idem: File } pour les cles trouvees.
export function getFiles(idems) {
  const voulu = new Set(idems || []);
  return tx('readonly', function (store) { return store.getAll(); }, FILES).then(function (rows) {
    const out = {};
    (rows || []).forEach(function (r) {
      if (!voulu.has(r.idem)) return;
      const blob = blobDe(r);
      if (blob) out[r.idem] = new File([blob], r.name || 'photo.jpg', { type: r.fileType || blob.type || 'image/jpeg' });
    });
    return out;
  });
}

// Fichiers plus vieux que `ageMs` : une journee de travail est finie, ils ne
// servent plus a rien sur le telephone.
export function purgeFiles(ageMs) {
  const limite = Date.now() - ageMs;
  return tx('readwrite', function (store) {
    const req = store.openCursor();
    req.onsuccess = function () {
      const cur = req.result;
      if (!cur) return;
      if (!(cur.value.at >= limite)) cur.delete();
      cur.continue();
    };
    return null;
  }, FILES);
}

// ---- Etat des conversations (reprise apres fermeture forcee) ----
export function putState(key, value) {
  return tx('readwrite', function (store) { return store.put({ key: key, value: value, at: Date.now() }); }, ETAT);
}

export function getState(key) {
  return tx('readonly', function (store) { return store.get(key); }, ETAT)
    .then(function (r) { return r ? r.value : null; });
}

export function deleteState(key) {
  return tx('readwrite', function (store) { return store.delete(key); }, ETAT);
}

export function clearFiles() {
  return tx('readwrite', function (store) { return store.clear(); }, FILES);
}

function toDead(entry, raison) {
  return tx('readwrite', function (store) {
    return store.add({
      action: entry.action, body: entry.body, at: entry.at || Date.now(),
      failedAt: Date.now(), reason: String(raison || 'refused'),
    });
  }, DEAD);
}

const abonnes = [];
export function onQueueChange(fn) { abonnes.push(fn); }

// Reponse 2xx d'une entree rejouee : fn(entry, data). Sert aux coches ✓✓ et aux
// identifiants rendus par le proxy (photoId, ticketId).
const envoyes = [];
export function onSent(fn) { envoyes.push(fn); }

// Refus definitif d'une entree (4xx autre que 409 et 429) : fn(entry, err) rend
// true si l'appelant le prend en charge (l'entree quitte alors la file sans aller
// au magasin mort, ni bandeau). Exemple : finishJob refuse faute de linge, l'ecran
// demande le comptage au lieu de laisser le geste bloque.
const refusGeres = [];
export function onRefused(fn) { refusGeres.push(fn); }
function annoncer() {
  return pendingCount().then(function (n) {
    abonnes.forEach(function (fn) { fn(n); });
    return n;
  });
}

// Une photo n'est PAS gardee comme Blob : Chromium refuse « Error preparing
// Blob/File data to be stored in object store » des que le stockage de blobs
// n'est pas disponible (navigation privee, harnais de test), et WebKit a connu
// le meme defaut. Un signalement avec photo serait alors perdu au moment precis
// ou la cleaner est hors ligne, c'est-a-dire exactement le cas que la file
// existe pour couvrir. On garde donc les octets (ArrayBuffer, toujours
// clonable) et le type, et on rebatit le Blob a l'envoi comme au rejeu.
async function gardable(file) {
  try {
    return { bytes: await file.arrayBuffer(), fileType: file.type || 'image/jpeg', file: null };
  } catch (e) {
    // Lecture impossible : on tente quand meme le Blob tel quel plutot que de
    // jeter le geste. Si IndexedDB le refuse, l'erreur remonte a l'appelant.
    return { bytes: null, fileType: null, file: file };
  }
}

function blobDe(entry) {
  if (entry.file) return entry.file;
  if (!entry.bytes) return null;
  return new Blob([entry.bytes], { type: entry.fileType || 'image/jpeg' });
}

// Rebatit le multipart a l'envoi comme au rejeu.
function formFrom(body, file, fileName) {
  const form = new FormData();
  const b = body || {};
  Object.keys(b).forEach(function (k) {
    if (b[k] !== null && b[k] !== undefined) form.set(k, String(b[k]));
  });
  form.set('file', file, fileName || 'photo.jpg');
  return form;
}

let enCours = false;
// Une demande de rejeu arrivee pendant un rejeu en cours (renouvellement de la
// session, retour du reseau) n'est pas perdue : une seule passe de plus part a
// la fin de celle-ci. Jamais deux rejeux en parallele, jamais de boucle : la
// passe suivante ne se relance que si une NOUVELLE demande arrive pendant elle.
let encore = false;
// Entree en cours d'envoi, et entrees retirees de la file pendant un rejeu
// (unqueue) : le rejeu travaille sur une copie de la file, il doit sauter une
// entree retiree entre-temps, et une entree deja partie ne se retire plus.
let enVol = null;
const retirees = new Set();
// Nouvel essai automatique apres un arret temporaire (5xx, 429, 409, reseau qui
// ne repond pas alors que le telephone se croit en ligne) : sans lui, un 409
// « Still processing » ou un wifi sans internet laissaient la file en attente
// jusqu'au prochain geste. Hors ligne declare, l'evenement « online » suffit.
const RETRY_MS = 8000;
// Erreur qui n'est pas une ApiError pendant un rejeu (multipart impossible a
// batir, fichier illisible) : ce n'est pas le reseau. Au bout de MAX_ECHECS_LOCAUX
// essais, l'entree part au magasin mort au lieu de bloquer la file pour toujours.
export const MAX_ECHECS_LOCAUX = 5;
const echecsLocaux = new Map();
let relance = null;
function relancerPlusTard() {
  if (relance || !navigator.onLine) return;
  relance = setTimeout(function () { relance = null; flush(); }, RETRY_MS);
}

// Rejeu strictement ordonne. On s'arrete des qu'une entree ne passe pas pour une
// raison temporaire, pour ne jamais inverser l'ordre des gestes. L'ordre compte :
// un signalement rejoue apres sa photo la retrouve par photoIdem, une photo de
// plus retrouve son ticket par ticketIdem.
export async function flush() {
  // En Practice, api.js servirait chaque entree par le simulateur : une vraie
  // entree en attente serait jugee passee et effacee sans jamais partir. Le
  // rejeu attend la fin de la seance (Exit recharge la journee, et le retour du
  // reseau ou le demarrage suivant relancent flush).
  if (practiceActive()) return;
  if (enCours) { encore = true; return; }
  enCours = true;
  encore = false;
  try {
    const entries = await pendingEntries();
    for (const e of entries) {
      // Une seance Practice ouverte pendant un rejeu deja lance l'arrete net :
      // l'entree suivante serait servie par le simulateur, puis effacee.
      if (practiceActive()) return;
      // Verification et marque sans attente entre les deux : unqueue ne peut
      // pas retirer une entree que ce rejeu est en train d'envoyer.
      if (retirees.has(e.seq)) continue;
      enVol = e.seq;
      let data;
      try {
        const blob = blobDe(e);
        if (blob) data = await api.upload(e.action, formFrom(e.body, blob, e.fileName));
        else data = await api.post(e.action, e.body);
        await drop(e.seq);
        enVol = null;
        envoyes.forEach(function (fn) {
          try { fn(e, data); } catch (x) { console.warn('[v3] onSent', x); }
        });
      } catch (err) {
        enVol = null;
        if (!(err instanceof ApiError)) {
          const n = (echecsLocaux.get(e.seq) || 0) + 1;
          echecsLocaux.set(e.seq, n);
          if (n < MAX_ECHECS_LOCAUX) { relancerPlusTard(); return; }
          echecsLocaux.delete(e.seq);
          console.warn('[v3] geste illisible, mis de cote:', e.action, err);
          await toDead(e, (err && err.message) ? err.message : 'local error');
          await drop(e.seq);
          toast('Not sent: could not read this action on the phone. Tell your manager.', 'err');
          continue;
        }
        const kind = err.kind;
        if (kind === 'offline') { relancerPlusTard(); return; }   // on reessaiera
        if (kind === 'auth') return;   // le renouvellement de session relance
        if (err.status >= 500 || err.status === 429 || err.status === 409) { relancerPlusTard(); return; }
        // 409 = rejeu sans resultat memorise cote proxy ("Still processing.
        // Retry."), pas un refus : l'entree reste en file, on la retentera au
        // prochain flush() (revue tache 4, constat majeur 2). Seul un 4xx
        // AUTRE que 409 est definitif : l'entree ne passera jamais, la garder
        // bloquerait toute la file derriere elle. On la sort de la file, on la
        // garde dans le magasin mort, et on le dit a la cleaner : un
        // console.warn n'est vu de personne sur un telephone. Sauf refus pris
        // en charge par l'ecran (onRefused).
        const raison = (err && err.message) ? err.message : 'refused';
        let gere = false;
        refusGeres.forEach(function (fn) {
          try { if (fn(e, err)) gere = true; } catch (x) { console.warn('[v3] onRefused', x); }
        });
        if (gere) { await drop(e.seq); continue; }
        console.warn('[v3] geste refuse par le proxy:', e.action, raison);
        await toDead(e, raison);
        await drop(e.seq);
        toast('Not sent: ' + raison + '. Tell your manager.', 'err');
      }
    }
  } finally {
    enCours = false;
    enVol = null;
    await annoncer();
    if (encore && !enCours) {
      encore = false;
      flush();
    }
  }
}

// Retire de la file le geste de cle `idem` s'il n'est pas encore parti (photo
// effacee depuis sa miniature avant son envoi). Rend false s'il est introuvable
// ou en cours d'envoi : l'appelant envoie alors une suppression, qui passera
// apres lui dans la file.
export async function unqueue(idem) {
  const rows = await pendingEntries();
  const e = rows.find(function (r) { return r.body && r.body.idem === idem; });
  if (!e || e.seq === enVol) return false;
  retirees.add(e.seq);
  await drop(e.seq);
  await annoncer();
  return true;
}

// Ecriture de la conversation (tache 5 du branchement) : TOUJOURS en file
// d'abord, puis rejeu. Un seul chemin, strictement ordonne : un geste ne double
// jamais un geste plus ancien encore en attente (une photo hors ligne puis son
// signalement en ligne partiraient sinon a l'envers). ✓ = en file, ✓✓ = onSent.
// Rien en Practice : la conversation n'ecrit pas, et rien n'entre en file.
export async function submit(action, body, file, fileName) {
  if (practiceActive()) return { queued: false };
  const garde = file ? await gardable(file) : { bytes: null, fileType: null, file: null };
  await enqueue({
    action: action, body: body,
    bytes: garde.bytes, fileType: garde.fileType, file: garde.file,
    fileName: file ? (fileName || 'photo.jpg') : null, at: Date.now(),
  });
  await annoncer();
  flush();
  return { queued: true };
}

// Chemin unique de toute ecriture v3 : on tente, et si le reseau manque on garde.
// La cle d'idempotence est posee par l'appelant DANS le corps, donc la copie mise
// en file porte la meme cle que la tentative qui a echoue : le proxy rejoue le
// meme resultat au lieu d'ecrire deux fois.
// `file` (optionnel) est le Blob d'une photo : l'envoi passe alors en multipart.
// `origine` (optionnel) : la marque Practice capturee au debut du geste
// (practiceMark), quand le geste attend quelque chose avant d'appeler ici ;
// par defaut, la seance du moment. api.js refuse l'ecriture si cette seance
// est finie, et rien de ne d'une seance Practice n'entre jamais en file.
export async function sendOrQueue(action, body, file, fileName, origine) {
  const marque = origine === undefined ? practiceMark() : origine;
  try {
    const data = file
      ? await api.upload(action, formFrom(body, file, fileName), marque)
      : await api.post(action, body, undefined, marque);
    await annoncer();
    return { ok: true, queued: false, data: data };
  } catch (err) {
    const kind = err instanceof ApiError ? err.kind : 'offline';
    // En Practice, rien n'entre jamais en file : le simulateur ne rend pas de
    // coupure, mais toute erreur locale qui n'est pas une ApiError compte ici
    // comme une coupure (multipart impossible a batir, par exemple), et le
    // geste simule n'a rien a garder. Ni pendant la seance, ni s'il en vient.
    if (kind === 'offline' && !marque && !practiceActive()) {
      const garde = file ? await gardable(file) : { bytes: null, fileType: null, file: null };
      await enqueue({
        action: action, body: body,
        bytes: garde.bytes, fileType: garde.fileType, file: garde.file,
        fileName: file ? (fileName || 'photo.jpg') : null, at: Date.now(),
      });
      await annoncer();
      return { ok: false, queued: true, data: null };
    }
    throw err;
  }
}

// Le retour du reseau declenche le rejeu. addEventListener('online') suffit sur
// Android et iOS ; un rejeu est aussi tente au demarrage, pour le cas ou l'app a
// ete fermee hors ligne.
export function watchNetwork() {
  window.addEventListener('online', function () { flush(); });
}
