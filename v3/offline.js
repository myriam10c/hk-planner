// File hors ligne. Chaque geste est ecrit dans IndexedDB avec sa cle
// d'idempotence AVANT toute tentative reseau, et rejoue dans l'ordre au retour du
// reseau (specification, ruling 7). Le proxy accepte les rejeux : meme cle, meme
// resultat, aucune ecriture en double.
import { api, ApiError } from '/v3/api.js';
import { toast } from '/v3/ui.js';

const DB_NAME = 'hk-v3';
const DB_VERSION = 1;
const STORE = 'queue';
// Magasin mort : une action refusee definitivement par le proxy (4xx autre que
// 429 et 409) ne peut pas rester dans la file, elle bloquerait tout ce qui la
// suit. Elle n'est pas jetee pour autant : elle atterrit ici, avec sa raison, et
// l'ecran Profile la montre. Le critere de succes de la phase A est « zero
// action perdue », pas « zero action refusee ».
const DEAD = 'dead';

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

// Rejeu strictement ordonne. On s'arrete des qu'une entree ne passe pas pour une
// raison temporaire, pour ne jamais inverser l'ordre des gestes. L'ordre compte :
// un signalement rejoue apres sa photo la retrouve par photoIdem.
export async function flush() {
  if (enCours) return;
  enCours = true;
  try {
    const entries = await pendingEntries();
    for (const e of entries) {
      try {
        const blob = blobDe(e);
        if (blob) await api.upload(e.action, formFrom(e.body, blob, e.fileName));
        else await api.post(e.action, e.body);
        await drop(e.seq);
      } catch (err) {
        const kind = err instanceof ApiError ? err.kind : 'offline';
        if (kind === 'offline' || kind === 'auth') return;   // on reessaiera
        if (err.status >= 500 || err.status === 429 || err.status === 409) return;
        // 409 = rejeu sans resultat memorise cote proxy ("Still processing.
        // Retry."), pas un refus : l'entree reste en file, on la retentera au
        // prochain flush() (revue tache 4, constat majeur 2). Seul un 4xx
        // AUTRE que 409 est definitif : l'entree ne passera jamais, la garder
        // bloquerait toute la file derriere elle. On la sort de la file, on la
        // garde dans le magasin mort, et on le dit a la cleaner : un
        // console.warn n'est vu de personne sur un telephone.
        const raison = (err && err.message) ? err.message : 'refused';
        console.warn('[v3] geste refuse par le proxy:', e.action, raison);
        await toDead(e, raison);
        await drop(e.seq);
        toast('Not sent: ' + raison + '. Tell your manager.', 'err');
      }
    }
  } finally {
    enCours = false;
    await annoncer();
  }
}

// Chemin unique de toute ecriture v3 : on tente, et si le reseau manque on garde.
// La cle d'idempotence est posee par l'appelant DANS le corps, donc la copie mise
// en file porte la meme cle que la tentative qui a echoue : le proxy rejoue le
// meme resultat au lieu d'ecrire deux fois.
// `file` (optionnel) est le Blob d'une photo : l'envoi passe alors en multipart.
export async function sendOrQueue(action, body, file, fileName) {
  try {
    const data = file
      ? await api.upload(action, formFrom(body, file, fileName))
      : await api.post(action, body);
    await annoncer();
    return { ok: true, queued: false, data: data };
  } catch (err) {
    const kind = err instanceof ApiError ? err.kind : 'offline';
    if (kind === 'offline') {
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
