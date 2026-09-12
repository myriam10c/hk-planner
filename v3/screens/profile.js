// Profile : qui je suis, la porte vers les ecrans que la v3 ne refait pas encore
// (conges, linge du local, historique), et la deconnexion.
import { api } from '/v3/api.js';
import { queueStrip, render } from '/v3/app.js';
import { clearDead, deadEntries, resetQueue } from '/v3/offline.js';
import { esc, icon } from '/v3/ui.js';

// Actions refusees par le serveur : elles ne sont jamais jetees en silence, elles
// se lisent ici. C'est ce que Hillal fait regarder a la cleaner pendant le pilote.
function refuses(state) {
  const morts = state.dead || [];
  if (morts.length === 0) return '';
  let h = '<div class="reco" style="margin:16px 0 0"><div class="rr"><span><b>Not sent</b></span>' +
    '<b>' + morts.length + '</b></div>';
  morts.forEach(function (d) {
    h += '<div class="rr"><span>' + esc(String(d.action).replace('v3.', '')) + '</span>' +
      '<span class="muted">' + esc(d.reason) + '</span></div>';
  });
  h += '<button class="btn-ghost" type="button" data-act="clear-dead">Clear this list</button></div>';
  return h;
}

function view(state) {
  const jour = state.day || {};
  const me = jour.me || { name: '', role: '' };
  const stops = jour.stops || [];
  const faits = stops.filter(function (s) { return s.state === 'done'; }).length;
  return '<header class="drench">' +
      '<div class="dr-top"><span>Profile</span></div>' +
      '<div class="dr-count"><b>' + faits + '/' + stops.length + '</b>' +
      '<span>cleanings finished today</span></div>' +
    '</header>' +
    queueStrip() +
    '<div class="body"><div class="pad">' +
      '<h1 style="font-family:var(--disp);font-size:26px;margin:0">' + esc(me.name) + '</h1>' +
      '<p class="muted">' + esc(me.role) + '</p>' +
      refuses(state) +
      '<p class="muted" style="margin-top:18px">Leave requests, linen at the store and your history are still in ' +
        'the main app. Everything you do here is saved in the same place.</p>' +
      '<a class="btn-primary" style="text-align:center;text-decoration:none;line-height:58px" ' +
        'href="/#cleaner">Open HK Planner</a>' +
      '<button class="btn-ghost" type="button" data-act="signout">Sign out</button>' +
    '</div></div>' +
    '<nav class="cl-bar">' +
      '<a href="#/today">' + icon('home', 20) + 'Today</a>' +
      '<a href="#/profile" aria-current="page">' + icon('user', 20) + 'Profile</a>' +
    '</nav>';
}

// Un seul appui compte : sans ce drapeau, deux appuis rapides envoient deux
// cleanerLogout, dont le second sur une session deja revoquee.
let deconnexionEnCours = false;

// Tout ce que l'app actuelle laisse sur l'appareil pendant une session, et
// qu'elle efface elle-meme a sa deconnexion (app.js, cleanerLogout et
// emailLogout). `hkAuthSession` est la cle de stockage du client Supabase :
// c'est elle que readSession() relit, la laisser en place rendait le bouton
// « Sign out » purement decoratif. `hkPlannerCache` porte les noms et telephones
// des voyageurs de la derniere semaine consultee : il ne survit pas a un
// telephone qui change de main (ruling 9).
const CLES_SESSION = [
  'cleanerToken',
  'cleanerMode',
  'hkAuthSession',
  'hkSessionCleanerId',
  'hkPlannerCache',
  'pushSubscribed',
  'pushEndpointSynced',
];

function lire(cle) {
  try { return localStorage.getItem(cle); } catch (e) { return null; }
}

// Meme borne que disablePushForLogout de l'app actuelle :
// navigator.serviceWorker.ready ne se resout JAMAIS quand l'enregistrement du
// service worker a echoue (fenetre privee, navigateur qui le bloque), et un
// desabonnement n'est pas une raison de retenir une deconnexion.
const DELAI_PUSH_MS = 3000;

// Tous les enregistrements, pas seulement celui qui controle la page. Depuis la
// tache 13 la v3 a le sien (portee /v3/), et c'est LUI que rend
// `navigator.serviceWorker.ready` sur une page de /v3/ : le plus specifique
// gagne. Or il ne porte aucun abonnement push (phase A, aucun abonnement cote
// v3), l'abonnement vit sur l'enregistrement de la racine. Chercher par `ready`
// ne trouvait donc plus rien et le telephone continuait de recevoir les taches
// de la cleaner precedente.
async function retirerAbonnementPush() {
  if (!navigator.serviceWorker) return;
  // Repli sur `ready` quand `getRegistrations` manque : aucun moteur en
  // circulation n'expose l'un sans l'autre, mais exiger `getRegistrations`
  // faisait sauter la revocation en silence, ce qui est exactement le defaut
  // que la tache 12 avait ferme.
  const regs = navigator.serviceWorker.getRegistrations
    ? await navigator.serviceWorker.getRegistrations()
    : [await navigator.serviceWorker.ready];
  for (const reg of regs) {
    const sub = reg.pushManager && await reg.pushManager.getSubscription();
    if (!sub) continue;
    const endpoint = sub.toJSON().endpoint;
    // Au mieux : sans cet appel, l'appareil continue de recevoir les taches de
    // la cleaner precedente. Il exige la session courante, donc il passe AVANT
    // la revocation.
    try { await api.post('deletePushSubscription', { endpoint: endpoint }); } catch (e) { /* le serveur nettoiera */ }
    try { await sub.unsubscribe(); } catch (e) { /* deja parti */ }
  }
}

function desabonnerPush() {
  return Promise.race([
    retirerAbonnementPush(),
    new Promise(function (r) { setTimeout(r, DELAI_PUSH_MS); }),
  ]);
}

const actions = {
  async 'clear-dead'(state) {
    await clearDead();
    state.dead = [];
    // Redessin plutot que location.reload() : la journee est deja en memoire,
    // recharger la ferait redemander au proxy pour rien, et hors ligne la
    // cleaner tomberait sur l'ecran d'erreur en voulant ranger une liste.
    render();
  },
  async signout() {
    if (deconnexionEnCours) return;
    deconnexionEnCours = true;
    // 1. Le desabonnement push d'abord : il exige la session encore vivante.
    try { await desabonnerPush(); } catch (e) { /* jamais une raison de retenir la sortie */ }
    // 2. Revocation cote serveur. L'action cleanerLogout du proxy ne lit QUE
    // x-cleaner-token pour savoir quelle ligne de cleaner_sessions supprimer :
    // avec une session email a cote, authHeaders pose le Bearer et la session
    // PIN survivait au serveur. On pose donc l'en-tete explicitement, comme
    // emailLogout de l'app actuelle, et on n'appelle l'action que s'il y a bien
    // un jeton PIN a revoquer.
    const jetonPin = lire('cleanerToken');
    if (jetonPin) {
      try {
        await api.post('cleanerLogout', {}, { 'X-Cleaner-Token': jetonPin });
      } catch (e) {
        /* hors ligne ou session deja morte : on ferme quand meme cote telephone */
      }
    }
    // 3. Le telephone. Limite assumee : sans le SDK Supabase, la v3 ne peut pas
    // revoquer le jeton de rafraichissement email cote serveur (l'app actuelle
    // appelle sbAuth.auth.signOut()). Effacer hkAuthSession suffit a ce que
    // l'appareil n'ait plus de session, ce que le bouton promet.
    CLES_SESSION.forEach(function (cle) {
      try { localStorage.removeItem(cle); } catch (e) { /* stockage indisponible */ }
    });
    // 4. La base IndexedDB, avant de considerer la sortie faite. L'identite vient
    // de la session et jamais du corps (ruling 6) : une entree encore en file
    // serait rejouee sous la session de la personne SUIVANTE, qui recevrait le
    // chrono, le comptage de linge et le signalement de la precedente. Le magasin
    // mort part avec, sinon l'ecran Profile de la suivante affiche la liste
    // « Not sent » de quelqu'un d'autre.
    //
    // Compromis assume : ce qui n'etait pas encore synchronise est vraiment
    // perdu. Une action attribuee a la mauvaise personne est pire qu'une action
    // a refaire, et le mode d'emploi dit de se deconnecter avec du reseau.
    // Aucune de ces deux erreurs ne retient la sortie : un stockage indisponible
    // laisserait sinon la cleaner enfermee dans une session qu'elle veut quitter.
    try { await resetQueue(); } catch (e) { /* stockage indisponible */ }
    try { await clearDead(); } catch (e) { /* stockage indisponible */ }
    location.replace('/#cleaner');
  },
};

// Le magasin mort est lu avant le rendu : `view` reste synchrone, comme les
// autres ecrans.
export async function prepare(state) {
  try {
    state.dead = await deadEntries();
  } catch (e) {
    state.dead = [];
  }
}

export default { view: view, actions: actions, prepare: prepare };
