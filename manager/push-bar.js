// Ecran plein « Turn on notifications » : affiche une fois par jour tant que ce
// telephone n'est pas abonne. Personne ne peut etre abonne a sa place (le navigateur
// exige un geste de la personne), d'ou cet ecran a l'ouverture de l'app (managers et
// techniciens). « Not now » le cache jusqu'au lendemain (cle mgrPushLater, jour local).
import { get } from '/manager/api.js';
import { enablePush, pushState } from '/manager/push.js';
import { esc, toast } from '/manager/ui/dom.js';

const LATER_KEY = 'mgrPushLater';

// Jour local (telephones a l'heure de Dubai) : en UTC, « Not now » touche entre
// minuit et 04:00 aurait ete oublie des 04:00.
function today() { try { return new Date().toLocaleDateString('en-CA'); } catch (e) { return new Date().toISOString().slice(0, 10); } }
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

// Titre de l'ecran plein selon l'etat (meme decision que pushBarText).
export function pushPromptTitle(state) {
  if (state === 'off') return 'Turn on notifications';
  if (state === 'denied') return 'Notifications are blocked';
  return 'Add HK Planner to your Home Screen';
}

export async function mountPushBar() {
  if (laterToday()) return;
  const state = await pushState().catch(() => 'unsupported');
  const msg = pushBarText(state, isIos(), standalone());
  if (!msg || document.getElementById('pushPrompt')) return;
  const prev = document.activeElement;
  const el = document.createElement('div');
  el.id = 'pushPrompt';
  el.className = 'pushprompt';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  el.setAttribute('aria-labelledby', 'pushPromptTitle');
  el.innerHTML = '<div class="pushprompt-in">'
    + '<div class="pushprompt-ic" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg></div>'
    + '<h2 id="pushPromptTitle">' + esc(pushPromptTitle(state)) + '</h2>'
    + '<p>' + esc(msg.text) + '</p>'
    + (msg.action ? '<p class="pushprompt-sub">Reminders and urgent tickets arrive here, even when the app is closed.</p>' : '')
    + '<div class="pushprompt-b">'
    + (msg.action ? '<button class="btn primary" type="button" data-push-on>Turn on notifications</button>' : '')
    + '<button class="btn" type="button" data-push-later>Not now</button></div>'
    + '<p class="set-err pushprompt-err" role="alert" hidden></p></div>';
  document.body.appendChild(el);
  const close = () => {
    el.remove();
    if (prev && document.body.contains(prev) && prev.focus) prev.focus();
  };
  const first = el.querySelector('[data-push-on]') || el.querySelector('[data-push-later]');
  if (first) first.focus();
  el.addEventListener('keydown', (e) => {
    if (e.key !== 'Tab') return;
    const f = Array.from(el.querySelectorAll('button:not([disabled])'));
    if (!f.length) return;
    const a = f[0], z = f[f.length - 1];
    if (e.shiftKey && document.activeElement === a) { e.preventDefault(); z.focus(); }
    else if (!e.shiftKey && document.activeElement === z) { e.preventDefault(); a.focus(); }
  });
  el.addEventListener('click', async (e) => {
    const t = e.target && e.target.closest ? e.target : null;
    if (t && t.closest('[data-push-later]')) {
      try { localStorage.setItem(LATER_KEY, today()); } catch (err) { /* stockage indisponible */ }
      close();
      return;
    }
    const on = t && t.closest('[data-push-on]');
    if (!on) return;
    on.disabled = true;
    const err = el.querySelector('.pushprompt-err');
    err.hidden = true;
    try {
      const r = await get('getVapidPublicKey');
      await enablePush(r && r.publicKey);
      close();
      toast('Notifications are on for this phone.');
    } catch (ex) {
      on.disabled = false;
      // Refus dans la fenetre du navigateur : l'ecran passe a la variante « blocked ».
      const now = await pushState().catch(() => 'unsupported');
      if (now === 'denied') {
        el.querySelector('h2').textContent = pushPromptTitle('denied');
        el.querySelector('p').textContent = pushBarText('denied', false, false).text;
        on.remove();
        const sub = el.querySelector('.pushprompt-sub');
        if (sub) sub.remove();
        return;
      }
      err.textContent = ex && ex.message ? ex.message : 'Could not turn on notifications.';
      err.hidden = false;
    }
  });
}
