// Position de l'equipe cote manager et maintenance (plan 2026-10-29, tache 3).
// Meme avertissement « Share your location » que l'app cleaner (v3/location.js),
// dessine avec l'ecran plein des notifications (.pushprompt), puis le partage
// commun de /shared/location-core.js, envoye par v3.saveLocation (le proxy
// accepte les sessions manager et maintenance sur cette action).
// La demande du navigateur ne part qu'apres « OK » : c'est le watch du module
// commun qui la declenche.
import { post } from '/manager/api.js';
import { esc } from '/manager/ui/dom.js';
import {
  geoSupported, inWindow, readNotice, refreshLocationSharing, setNotice, sharingState, startLocationSharing,
} from '/shared/location-core.js';

export const BLOCKED_HELP = 'Location is blocked. In Chrome: tap the lock icon next to the address, then Permissions, then Location, Allow.';
const PIN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/></svg>';

let ouvert = null;   // promesse de l'avertissement affiche

// L'ecran des notifications (#pushPrompt, push-bar.js) passe d'abord : on attend
// qu'il soit ferme, jamais deux ecrans pleins l'un sur l'autre.
function apresPushPrompt() {
  if (!document.getElementById('pushPrompt')) return Promise.resolve();
  return new Promise((resolve) => {
    const obs = new MutationObserver(() => {
      if (document.getElementById('pushPrompt')) return;
      obs.disconnect();
      resolve();
    });
    obs.observe(document.body, { childList: true });
  });
}

// Avertissement plein ecran. Rend 'ok' ou 'later' au geste de la personne.
export function openLocationNotice() {
  if (ouvert) return ouvert;
  ouvert = apresPushPrompt().then(() => new Promise((resolve) => {
    const prev = document.activeElement;
    const el = document.createElement('div');
    el.id = 'locPrompt';
    el.className = 'pushprompt';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    el.setAttribute('aria-labelledby', 'locPromptTitle');
    el.innerHTML = '<div class="pushprompt-in">'
      + '<div class="pushprompt-ic" aria-hidden="true">' + PIN + '</div>'
      + '<h2 id="locPromptTitle">' + esc('Share your location') + '</h2>'
      + '<p>' + esc('Your managers see where you are while HK Planner is open, between 7 AM and 11 PM, to organise the day.') + '</p>'
      + '<div class="pushprompt-b">'
      + '<button class="btn primary" type="button" data-loc="ok">OK</button>'
      + '<button class="btn" type="button" data-loc="later">Not now</button></div></div>';
    document.body.appendChild(el);
    el.querySelector('[data-loc="ok"]').focus();
    // Focus garde dans l'ecran (meme regle que push-bar.js).
    el.addEventListener('keydown', (e) => {
      if (e.key !== 'Tab') return;
      const f = Array.from(el.querySelectorAll('button'));
      const a = f[0], z = f[f.length - 1];
      if (e.shiftKey && document.activeElement === a) { e.preventDefault(); z.focus(); }
      else if (!e.shiftKey && document.activeElement === z) { e.preventDefault(); a.focus(); }
    });
    el.addEventListener('click', (e) => {
      const b = e.target && e.target.closest ? e.target.closest('[data-loc]') : null;
      if (!b) return;
      const rep = b.getAttribute('data-loc') === 'ok' ? 'ok' : 'later';
      setNotice(rep);
      el.remove();
      ouvert = null;
      if (prev && document.body.contains(prev) && prev.focus) prev.focus();
      // Apres OK : le watch demarre, et avec lui la demande du navigateur.
      refreshLocationSharing();
      resolve(rep);
    });
  }));
  return ouvert;
}

// 'on' | 'off' | 'blocked' | 'unsupported', pour More > Settings.
export function locationState() {
  return sharingState().catch(() => 'unsupported');
}

// Depuis app.js, apres l'acces confirme par le serveur (session email, role
// manager ou maintenance). `isAllowed` est relu a chaque envoi. `ask` faux :
// depuis Settings, qui ouvre l'avertissement lui-meme.
export function startLocation(isAllowed, ask) {
  startLocationSharing({
    post: (body) => post('v3.saveLocation', body),
    isAllowed,
  });
  // Hors fenetre (avant 7 h, apres 23 h), rien n'est demande.
  if (ask !== false && geoSupported() && readNotice() === 'ask' && inWindow(Date.now())) openLocationNotice();
}
