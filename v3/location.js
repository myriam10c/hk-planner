// Position de l'equipe cote cleaner (plan 2026-10-29, tache 2). L'avertissement
// « Share your location » (meme couche que l'ecran des notifications, push.js),
// puis le partage commun de /shared/location-core.js, envoye par v3.saveLocation.
// La demande du navigateur ne part qu'apres « OK » : c'est le watch du module
// commun qui la declenche.
//
// Charge par import() dynamique depuis app.js et profile.js, en ligne seulement :
// ni ce module ni /shared/ ne sont dans le precache de /v3/sw.js, l'app hors
// ligne ne doit pas en dependre.
import { api } from '/v3/api.js';
import { esc, icon } from '/v3/ui.js';
import {
  geoSupported, inWindow, readNotice, refreshLocationSharing, setLocationPerson, setNotice, sharingState,
  startLocationSharing,
} from '/shared/location-core.js';

export const BLOCKED_HELP = 'Location is blocked. In Chrome: tap the lock icon next to the address, then Permissions, then Location, Allow.';

let ouvert = null;   // promesse de l'avertissement affiche

function close(el) { if (el && el.parentNode) el.parentNode.removeChild(el); }

// L'ecran des notifications (#pushgate) passe d'abord : on attend qu'il soit
// ferme, jamais deux couches l'une sur l'autre.
function apresPushgate() {
  if (!document.getElementById('pushgate')) return Promise.resolve();
  return new Promise(function (resolve) {
    const obs = new MutationObserver(function () {
      if (document.getElementById('pushgate')) return;
      obs.disconnect();
      resolve();
    });
    obs.observe(document.body, { childList: true });
  });
}

// Avertissement plein ecran. Rend 'ok' ou 'later' au geste de la personne.
export function openLocationNotice() {
  if (ouvert) return ouvert;
  ouvert = apresPushgate().then(function () {
    return new Promise(function (resolve) {
      const el = document.createElement('div');
      el.id = 'locgate';
      el.className = 'pushgate';
      el.setAttribute('role', 'dialog');
      el.setAttribute('aria-modal', 'true');
      el.setAttribute('aria-labelledby', 'locgate-t');
      el.innerHTML = '<div class="pushgate-in">' + icon('pin', 40) +
        '<h1 id="locgate-t">' + esc('Share your location') + '</h1>' +
        '<p>' + esc('Your managers see where you are while HK Planner is open, between 7 AM and 11 PM, to organise the day.') + '</p>' +
        '<button class="btn-primary" type="button" data-loc="ok">OK</button>' +
        '<button class="pushgate-later" type="button" data-loc="later">Not now</button>' +
        '</div>';
      document.body.appendChild(el);
      el.addEventListener('click', function (e) {
        const b = e.target && e.target.closest ? e.target.closest('[data-loc]') : null;
        if (!b) return;
        const rep = b.getAttribute('data-loc') === 'ok' ? 'ok' : 'later';
        setNotice(rep);
        close(el);
        ouvert = null;
        // Apres OK : le watch demarre, et avec lui la demande du navigateur.
        refreshLocationSharing();
        resolve(rep);
      });
    });
  });
  return ouvert;
}

// 'on' | 'off' | 'blocked' | 'unsupported', pour Profile. `personId` : la
// personne connectee, dont le choix est lu (le partage n'a peut-etre pas demarre).
export function locationState(personId) {
  if (personId !== undefined) setLocationPerson(personId);
  return sharingState().catch(function () { return 'unsupported'; });
}

// Avertissement a proposer maintenant : jamais repondu (ou « Not now » d'un autre
// jour), fenetre ouverte, partage permis.
function aProposer(isAllowed) {
  let ok = false;
  try { ok = !isAllowed || isAllowed() === true; } catch (e) { ok = false; }
  return ok && geoSupported() && readNotice() === 'ask' && inWindow(Date.now());
}

// Depuis app.js, apres la session confirmee par le serveur, pour la personne
// elle-meme. o.isAllowed est relu a chaque envoi : entrer en Practice ou en View
// as plus tard coupe aussi les envois. o.personId : la personne connectee (le
// choix est garde par personne). o.ask faux : depuis Profile, qui ouvre
// l'avertissement lui-meme. o.busy() vrai (facultatif, garde) : une autre couche
// est a l'ecran, la minute suivante retentera.
let occupe = null;   // busy() garde d'un appel a l'autre (Profile ne le repasse pas)

export function startLocation(o) {
  const isAllowed = o.isAllowed;
  if (o.busy !== undefined) occupe = o.busy;
  startLocationSharing({
    post: function (body) { return api.post('v3.saveLocation', body); },
    isAllowed: isAllowed,
    personId: o.personId,
    // App ouverte avant 7 h : l'avertissement est propose quand la fenetre
    // s'ouvre, si rien d'autre n'est a l'ecran et la page visible.
    onTick: function () {
      if (ouvert || document.visibilityState === 'hidden') return;
      if (document.querySelector('[aria-modal="true"]')) return;
      try { if (occupe && occupe()) return; } catch (e) { return; }
      if (aProposer(isAllowed)) openLocationNotice();
    },
  });
  // Hors fenetre (avant 7 h, apres 23 h), rien n'est demande.
  if (o.ask !== false && aProposer(isAllowed)) openLocationNotice();
}
