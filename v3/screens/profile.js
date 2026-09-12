// Profile : qui je suis, la porte vers les ecrans que la v3 ne refait pas encore
// (conges, linge du local, historique), et la deconnexion.
import { api } from '/v3/api.js';
import { queueStrip, render } from '/v3/app.js';
import { clearDead, deadEntries } from '/v3/offline.js';
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
    // La session est celle de l'app actuelle : on la revoque cote serveur, puis on
    // efface les deux cles locales et on rend la main a l'ecran de connexion.
    try {
      await api.post('cleanerLogout', {});
    } catch (e) {
      /* hors ligne ou session deja morte : on ferme quand meme cote telephone */
    }
    try {
      localStorage.removeItem('cleanerToken');
      localStorage.removeItem('cleanerMode');
    } catch (e) { /* stockage indisponible */ }
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
