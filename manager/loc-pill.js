// Bouton « Location ON / OFF » de /manager/ (30/10), pour les personnes qui
// partagent (cleanerMe.shareLocation, aujourd'hui Ismael et Semax) : une pastille
// compacte sous l'en-tete des ecrans principaux (Today, Planning, Maintenance,
// Inspections, Tasks, More), jamais dans les sous-ecrans de More. Memes etats et
// meme geste que l'app cleaner (/shared/location-core.js : pillView), meme etat
// que la carte More > Settings (relu a chaque changement d'ecran).
// Les ecrans reecrivent #main a chaque rendu : un MutationObserver remet la
// pastille apres le premier header.top, sans jamais toucher au reste.
import { esc } from '/manager/ui/dom.js';

let el = null;
let mod = null;       // /manager/location.js
let opts = null;      // { isAllowed, personId }
let st = null;        // 'on' | 'off' | 'blocked' | 'unsupported'
let lecture = 0;
let occupe = false;

// Ecran principal seulement : « #/today », « #/planning?start=... » ; pas « #/more/settings ».
function ecranPrincipal() {
  return !/^#\/?[a-z-]+\//i.test(location.hash || '');
}

function vue() {
  if (!mod || !opts) return null;
  let permis = false;
  try { permis = !opts.isAllowed || opts.isAllowed() === true; } catch (e) { permis = false; }
  return permis ? mod.pillView(st, Date.now()) : null;
}

function peindre() {
  if (!el) return;
  const v = vue();
  if (!v) { el.hidden = true; return; }
  el.hidden = false;
  el.setAttribute('data-state', v.state);
  el.setAttribute('data-on', v.on ? '1' : '0');
  el.setAttribute('aria-pressed', v.on ? 'true' : 'false');
  el.innerHTML = '<span class="locpill-t">' + esc(v.title) + '</span><span class="locpill-s">' + esc(v.sub) + '</span>';
}

function placer() {
  const main = document.getElementById('main');
  if (!main || !el) return;
  if (!ecranPrincipal() || !vue()) { if (el.parentNode) el.remove(); return; }
  const head = main.querySelector(':scope > header.top');
  if (!head) { if (el.parentNode) el.remove(); return; }
  if (head.nextElementSibling !== el) head.after(el);
}

async function relire() {
  const n = ++lecture;
  let s = 'unsupported';
  try { s = await mod.locationState(opts.personId); } catch (e) { s = 'unsupported'; }
  if (n !== lecture) return;
  st = s;
  peindre();
  placer();
}

async function basculer() {
  if (occupe || !mod) return;
  occupe = true;
  el.disabled = true;
  try {
    lecture++;
    st = await mod.toggleLocation({ isAllowed: opts.isAllowed, personId: opts.personId, onState: () => { relire(); } });
  } catch (e) {
    /* hors ligne : rien ne change */
  } finally {
    occupe = false;
    el.disabled = false;
  }
  peindre();
  placer();
}

// Etat change hors du bouton (refus vu par le watch, carte Settings).
export function refreshLocPill() { if (el && mod) relire(); }

// o : { isAllowed, personId }. Une seule fois par page.
export async function mountLocPill(o) {
  if (el) return;
  try { mod = await import('/manager/location.js'); } catch (e) { return; }
  opts = o;
  el = document.createElement('button');
  el.type = 'button';
  el.className = 'locpill';
  el.setAttribute('data-loc-pill', '');
  el.hidden = true;
  el.addEventListener('click', basculer);
  const main = document.getElementById('main');
  if (main) new MutationObserver(placer).observe(main, { childList: true });
  window.addEventListener('hashchange', () => { relire(); });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') relire(); });
  // Fenetre 07:00-23:00 : le bouton s'endort et se reveille sans rechargement.
  setInterval(() => { peindre(); placer(); }, 60000);
  await relire();
}
