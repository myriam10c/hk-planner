// Session de la v3. La session email est celle de l'app racine : meme client
// supabase-js (bundle vendor), meme storageKey `hkAuthSession`. Le client la
// renouvelle quand le jeton d'acces expire (jwt_exp = 1 h), au lieu que la v3
// l'abandonne et renvoie la cleaner vers « Sign in » toutes les heures.
//
// Aucun renouvellement fait a la main ici (pas de fetch vers /auth/v1/token) :
// la rotation des refresh tokens est active, et seul le client sait coordonner
// un renouvellement avec l'app racine (garde de commit sur le stockage,
// BroadcastChannel `hkAuthSession`). Un second chemin revoquerait la session.
//
// Ordre, comme le proxy (Bearer > X-Cleaner-Token) :
//   Bearer valide > jeton PIN > session email en attente de reseau (stale) > rien.
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from '/v3/proxy-config.js';

const CLE = 'hkAuthSession';
// Au-dela, un renouvellement est tenu pour hors ligne. Le client, lui, retente
// jusqu'a 30 s en arriere-plan (backoff de supabase-js) : la cleaner n'attend
// pas, son geste part dans la file et sera rejoue.
const DELAI_MS = 4000;
// Marge de la lecture directe (repli sans client) : un jeton a moins de 30 s
// de sa fin n'est plus envoye.
const MARGE_MS = 30000;

let client;              // undefined : pas encore cree ; null : indisponible
let enVol = null;        // auth.getSession() en cours, partage entre appelants
let enRetard = false;    // le dernier enVol a depasse DELAI_MS sans repondre
const renouvellements = [];

function lireStockage(cle) {
  try { return localStorage.getItem(cle); } catch (e) { return null; }
}

function sessionStockee() {
  const raw = lireStockage(CLE);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch (e) { return null; }
}

function jetonPin() {
  const pin = lireStockage('cleanerToken');
  return pin ? { kind: 'pin', token: pin } : null;
}

function encoreValide(sess) {
  if (!sess || !sess.access_token) return false;
  const exp = Number(sess.expires_at);
  return !Number.isFinite(exp) || exp * 1000 > Date.now() + MARGE_MS;
}

// Client cree une seule fois, avec les options de l'app racine (app.js), sauf
// detectSessionInUrl : le fragment de /v3/ est le routeur (#/job/...), pas un
// retour de lien email.
function sbClient() {
  if (client !== undefined) return client;
  const lib = typeof window !== 'undefined' ? window.supabase : null;
  if (!lib || typeof lib.createClient !== 'function') {
    console.warn('[v3] supabase-js absent : lecture directe de la session, sans renouvellement');
    client = null;
    return client;
  }
  try {
    client = lib.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
      auth: {
        flowType: 'implicit',
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
        storageKey: CLE,
      },
    });
  } catch (e) {
    console.warn('[v3] supabase-js inutilisable : lecture directe de la session', e);
    client = null;
    return client;
  }
  // Un renouvellement reussi (ici, par le minuteur du client ou par l'onglet de
  // l'app racine via BroadcastChannel) previent l'app : la file peut repartir.
  client.auth.onAuthStateChange(function (evt) {
    // SIGNED_IN aussi : au retour d'une page gelee, si l'onglet de l'app racine a
    // deja renouvele, le client annonce SIGNED_IN et non TOKEN_REFRESHED.
    if (evt !== 'TOKEN_REFRESHED' && evt !== 'SIGNED_IN') return;
    renouvellements.forEach(function (fn) {
      try { fn(evt); } catch (e) { /* un abonne ne casse pas les autres */ }
    });
  });
  // Retour du reseau : supabase-js garde un echec de renouvellement en memoire
  // 60 s pour le meme refresh token (lastRefreshFailure, 2.116.0). Sans cette
  // remise a zero, le rejeu de la file au retour du reseau verrait encore
  // l'echec d'il y a quelques secondes et repasserait en stale. Ce n'est qu'un
  // cache : le renouvellement suivant passe toujours par le client.
  window.addEventListener('online', function () {
    enRetard = false;
    try {
      if (client && client.auth && 'lastRefreshFailure' in client.auth) client.auth.lastRefreshFailure = null;
    } catch (e) { /* interne absent : on attendra la fin du cache */ }
  });
  return client;
}

// Lecture directe, comme avant cette tache : repli quand le client manque.
function lectureDirecte() {
  const sess = sessionStockee();
  if (encoreValide(sess)) return { kind: 'bearer', token: sess.access_token };
  return jetonPin();
}

// Le renouvellement n'a pas pu se faire faute de reseau. Le stockage dit le
// reste : un jeton encore valide part tel quel, le PIN passe avant stale, et une
// session email avec refresh token garde la cleaner dans l'app.
function sansReseau() {
  const sess = sessionStockee();
  if (encoreValide(sess)) return { kind: 'bearer', token: sess.access_token };
  const pin = jetonPin();
  if (pin) return pin;
  if (sess && sess.refresh_token) return { kind: 'stale', token: null };
  return null;
}

function attendre(ms) {
  return new Promise(function (r) { setTimeout(function () { r(TROP_LONG); }, ms); });
}
const TROP_LONG = { trop: true };

function demander(c) {
  if (!enVol) {
    enVol = c.auth.getSession().then(
      function (r) { enVol = null; enRetard = false; return r; },
      function (e) { enVol = null; enRetard = false; return { data: { session: null }, error: e }; }
    );
  }
  return enVol;
}

function estReseau(err) {
  return !!err && err.name === 'AuthRetryableFetchError';
}

export async function getSession() {
  const c = sbClient();
  if (!c) return lectureDirecte();
  // Coupure franche : rien a demander au client, qui retenterait 30 s.
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return sansReseau();
  // Un renouvellement deja en retard : on ne refait pas attendre chaque geste.
  if (enVol && enRetard) return sansReseau();
  const r = await Promise.race([demander(c), attendre(DELAI_MS)]);
  if (r === TROP_LONG) {
    enRetard = true;
    return sansReseau();
  }
  const sess = r && r.data && r.data.session;
  if (sess && sess.access_token) return { kind: 'bearer', token: sess.access_token };
  if (r && r.error && estReseau(r.error)) return sansReseau();
  if (r && r.error) {
    // Refus (400/401 : session revoquee, supabase-js l'a effacee) ou commit
    // annule parce qu'un autre onglet a deja renouvele : le stockage fait foi.
    const stockee = sessionStockee();
    if (encoreValide(stockee)) return { kind: 'bearer', token: stockee.access_token };
  }
  return jetonPin();
}

// Apres un 401 du proxy sur un Bearer : un seul renouvellement force. Renvoie
// la session a utiliser pour le nouvel essai.
export async function renewSession() {
  const c = sbClient();
  if (!c) return lectureDirecte();
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return sansReseau();
  const r = await Promise.race([
    c.auth.refreshSession().catch(function (e) { return { data: { session: null }, error: e }; }),
    attendre(DELAI_MS),
  ]);
  if (r === TROP_LONG) return sansReseau();
  const sess = r && r.data && r.data.session;
  if (sess && sess.access_token) return { kind: 'bearer', token: sess.access_token };
  return getSession();
}

// Deconnexion : la session email part par le client (portee locale), pour que
// son minuteur de renouvellement s'arrete et que l'app racine soit prevenue.
// Bornee dans le temps : hors ligne, signOut attendrait le renouvellement et
// l'appel /logout, et la sortie ne doit jamais etre retenue. Le client efface le
// stockage meme quand /logout echoue ; le removeItem n'est qu'un dernier filet.
export async function signOutEmail() {
  const c = sbClient();
  if (c) {
    try {
      await Promise.race([c.auth.signOut({ scope: 'local' }), attendre(DELAI_MS)]);
    } catch (e) { /* le filet ci-dessous */ }
  }
  try { localStorage.removeItem(CLE); } catch (e) { /* stockage indisponible */ }
}

// Abonnement aux renouvellements reussis (rejeu de la file).
export function onSessionRenewed(fn) { renouvellements.push(fn); }

// Pour les tests seulement : le client, ou null sans supabase-js. Permet de
// verifier que le champ interne lastRefreshFailure existe toujours dans le
// bundle (une montee de version qui le renomme doit casser un test).
export function supabaseClientForTests() { return sbClient(); }
