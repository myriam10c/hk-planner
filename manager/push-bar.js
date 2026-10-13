// Bandeau « Turn on notifications » : affiche tant que ce telephone n'est pas
// abonne. Personne ne peut etre abonne a sa place (le navigateur exige un geste
// de la personne), d'ou ce rappel sur chaque ecran. « Later » le cache pour la journee.
import { get } from '/manager/api.js';
import { enablePush, pushState } from '/manager/push.js';
import { esc, toast } from '/manager/ui/dom.js';

const LATER_KEY = 'mgrPushLater';

function today() { return new Date().toISOString().slice(0, 10); }
function laterToday() { try { return localStorage.getItem(LATER_KEY) === today(); } catch (e) { return false; } }
function isIos() { return /iPhone|iPad|iPod/.test(navigator.userAgent || ''); }
function standalone() {
  try { return window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true; } catch (e) { return false; }
}

export function pushBarText(state, ios, installed) {
  if (state === 'off') return { text: 'Turn on notifications to get urgent problems on this phone.', action: true };
  if (state === 'denied') return { text: 'Notifications are blocked for HK Planner. Allow them in this browser’s site settings.', action: false };
  if (state === 'unsupported' && ios && !installed) {
    return { text: 'On iPhone, add HK Planner to your Home Screen (Share, then Add to Home Screen) to get notifications.', action: false };
  }
  return null;
}

export async function mountPushBar() {
  if (laterToday()) return;
  const state = await pushState().catch(() => 'unsupported');
  const msg = pushBarText(state, isIos(), standalone());
  if (!msg) return;
  const main = document.getElementById('main');
  if (!main || document.getElementById('pushBar')) return;
  const bar = document.createElement('div');
  bar.id = 'pushBar';
  bar.className = 'pushbar';
  bar.setAttribute('role', 'status');
  bar.innerHTML = '<span>' + esc(msg.text) + '</span><span class="pushbar-b">'
    + (msg.action ? '<button class="btn sm primary" type="button" data-push-on>Allow</button>' : '')
    + '<button class="btn sm" type="button" data-push-later>Later</button></span>';
  main.parentNode.insertBefore(bar, main);
  bar.addEventListener('click', async (e) => {
    const t = e.target && e.target.closest ? e.target : null;
    if (t && t.closest('[data-push-later]')) {
      try { localStorage.setItem(LATER_KEY, today()); } catch (err) { /* stockage indisponible */ }
      bar.remove();
      return;
    }
    const on = t && t.closest('[data-push-on]');
    if (!on) return;
    on.disabled = true;
    try {
      const r = await get('getVapidPublicKey');
      await enablePush(r && r.publicKey);
      bar.remove();
      toast('Notifications are on for this phone.');
    } catch (err) {
      on.disabled = false;
      toast(err && err.message ? err.message : 'Could not turn on notifications.');
    }
  });
}
