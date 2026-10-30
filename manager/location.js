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
  geoSupported, inWindow, readNotice, refreshLocationSharing, setLocationPerson, setNotice, sharingState,
  startLocationSharing, turnLocationOff, turnLocationOn,
} from '/shared/location-core.js';

export { pillView } from '/shared/location-core.js';

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
      + '<p>' + esc('Managers see where you are while HK Planner is open, between 7 AM and 11 PM, to organise the day.') + '</p>'
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

// 'on' | 'off' | 'blocked' | 'unsupported', pour More > Settings. `personId` :
// la personne connectee, dont le choix est lu (garde par personne).
export function locationState(personId) {
  if (personId !== undefined) setLocationPerson(personId);
  return sharingState().catch(() => 'unsupported');
}

// Depuis app.js, apres l'acces confirme par le serveur (session email, role
// manager ou maintenance ; un sous-traitant n'entre jamais dans /manager/).
// o.isAllowed est relu a chaque envoi, o.personId : la personne connectee (le
// choix est garde par personne). o.ask faux : depuis Settings, qui ouvre
// l'avertissement lui-meme.
let surEtat = null;  // onState(st) garde d'un appel a l'autre (bouton Location de l'en-tete)

export function startLocation(o) {
  if (o.onState !== undefined) surEtat = o.onState;
  startLocationSharing({
    post: (body) => post('v3.saveLocation', body),
    isAllowed: o.isAllowed,
    personId: o.personId,
    onState: (st) => { try { if (surEtat) surEtat(st); } catch (e) { /* l'ecran ne casse jamais le partage */ } },
  });
  // Hors fenetre (avant 7 h, apres 23 h), rien n'est demande. Partage non permis
  // (shareLocation false, cleaners.share_location) : jamais d'avertissement.
  let permis = false;
  try { permis = !o.isAllowed || o.isAllowed() === true; } catch (e) { permis = false; }
  if (o.ask !== false && permis && geoSupported() && readNotice() === 'ask' && inWindow(Date.now())) openLocationNotice();
}

// Aide « bloquee » (bouton Location blocked) : meme ecran plein, un seul OK, rien n'est stocke.
export function openBlockedHelp() {
  if (ouvert) return ouvert;
  ouvert = apresPushPrompt().then(() => new Promise((resolve) => {
    const prev = document.activeElement;
    const el = document.createElement('div');
    el.id = 'locPrompt';
    el.className = 'pushprompt';
    el.setAttribute('data-variant', 'blocked');
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    el.setAttribute('aria-labelledby', 'locPromptTitle');
    el.innerHTML = '<div class="pushprompt-in">'
      + '<div class="pushprompt-ic" aria-hidden="true">' + PIN + '</div>'
      + '<h2 id="locPromptTitle">' + esc('Location is blocked') + '</h2>'
      + '<p>' + esc(BLOCKED_HELP) + '</p>'
      + '<div class="pushprompt-b"><button class="btn primary" type="button" data-loc="close">OK</button></div></div>';
    document.body.appendChild(el);
    el.querySelector('[data-loc="close"]').focus();
    el.addEventListener('click', (e) => {
      const b = e.target && e.target.closest ? e.target.closest('[data-loc]') : null;
      if (!b) return;
      el.remove();
      ouvert = null;
      if (prev && document.body.contains(prev) && prev.focus) prev.focus();
      resolve('closed');
    });
  }));
  return ouvert;
}

// Bouton « Location ON / OFF » (en-tete des ecrans principaux, carte Settings) :
// bloque = aide ; ON = choix 'off' garde, watch arrete, v3.stopLocation ;
// OFF = accord ('ok'), le watch demarre (Chrome demande si besoin).
// o : memes champs que startLocation. Rend le nouvel etat (sharingState).
export async function toggleLocation(o) {
  startLocation({ ...o, ask: false });
  const st = await locationState(o.personId);
  if (st === 'unsupported') return st;
  if (st === 'blocked') {
    await openBlockedHelp();
    refreshLocationSharing();
  } else if (st === 'on') {
    turnLocationOff();
    try { await post('v3.stopLocation', {}); } catch (e) { /* hors ligne : le partage est deja coupe sur cet appareil */ }
  } else {
    turnLocationOn();
  }
  return locationState();
}
