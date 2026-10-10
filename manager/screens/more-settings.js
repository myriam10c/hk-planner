// More > Settings : autopilote, notifications de cet appareil, objectif d'inspections,
// checklists (lecture seule). Lecture : mgr.settings. Ecritures : mgr.settings.set et
// mgr.autopilot.run, jamais d'auteur envoye (le proxy le prend de la session).
// Les liens WhatsApp sont rendus pour un tap manuel, jamais ouverts par le code.
import { get, post } from '/manager/api.js';
import { esc, I, toast } from '/manager/ui/dom.js';
import { disablePush, enablePush, pushState, testPush } from '/manager/push.js';

const PUSH_LINE = {
  on: 'On for this device', off: 'Off',
  denied: 'Blocked in the browser settings', unsupported: 'Not supported on this device',
};
const plural = (n, one, many) => n + ' ' + (n === 1 ? one : many);

function header() {
  return '<header class="top"><div><a class="more-back" href="#/more">' + I.prev + '<span>More</span></a>'
    + '<h1>Settings</h1></div></header>';
}

const errLine = (msg) => (msg ? '<p class="set-err" role="alert">' + esc(msg) + '</p>' : '');

export async function renderSettings(ctx) {
  const main = ctx.main;
  const st = {
    data: null, push: 'off', target: '',
    err: { autopilot: '', run: '', push: '', target: '' },
    busy: { autopilot: false, run: false, push: false, target: false },
    run: null, want: false,
  };
  const $ = (sel) => main.querySelector(sel);

  // true quand l'erreur a deja ete traitee par une sortie de l'ecran (meme regle que Planning).
  function handleAccess(e) {
    if (e && e.kind === 'auth') { location.replace('/'); return true; }
    if (e && e.kind === 'forbidden') {
      if (e.message === 'email sign-in required') ctx.emailRequired(); else location.replace('/');
      return true;
    }
    return false;
  }

  function autopilotCard() {
    const d = st.data;
    let result = '';
    if (st.run) {
      const r = st.run;
      const rows = (r.notified || []).map((n) => '<li class="set-row"><span class="set-name">' + esc(n.cleaner)
        + ' <span class="set-sub">' + esc(plural(Number(n.tasks) || 0, 'cleaning', 'cleanings')) + '</span></span>'
        + (n.waLink
          ? '<a class="btn" href="' + esc(n.waLink) + '" target="_blank" rel="noopener">Send on WhatsApp</a>'
          : '<span class="set-sub">No phone number</span>')
        + '</li>').join('');
      const line = Number(r.checkouts) === 0 ? 'No checkouts today'
        : plural(Number(r.newlyAssigned) || 0, 'new assignment', 'new assignments') + ', ' + (Number(r.alreadyAssigned) || 0) + ' already assigned';
      result = '<div class="set-result" data-autopilot-result><p class="set-line" role="status">' + esc(line) + '</p>'
        + (rows ? '<ul class="set-list">' + rows + '</ul>' : '') + '</div>';
    }
    return '<div class="sec-head"><h2>Autopilot</h2></div><div class="set-body">'
      + '<label class="set-switch"><span>Send cleaners their jobs automatically</span>'
      + '<input type="checkbox" role="switch" data-autopilot' + ((st.busy.autopilot ? st.want : d.autopilot) ? ' checked' : '')
      + (st.busy.autopilot ? ' disabled' : '') + '></label>' + errLine(st.err.autopilot)
      + '<div class="set-actions"><button class="btn" type="button" data-run' + (st.busy.run ? ' disabled' : '') + '>Run autopilot now</button></div>'
      + errLine(st.err.run) + result + '</div>';
  }

  function pushCard() {
    const s = st.push;
    const dis = st.busy.push ? ' disabled' : '';
    let actions = '';
    if (s === 'on') {
      actions = '<button class="btn" type="button" data-push-off' + dis + '>Turn off</button>'
        + '<button class="btn" type="button" data-push-test' + dis + '>Send a test</button>';
    } else if (s === 'off') {
      actions = '<button class="btn primary" type="button" data-push-on' + dis + '>Turn on</button>';
    }
    return '<div class="sec-head"><h2>Notifications</h2></div><div class="set-body">'
      + '<p class="set-line" data-push-state>' + esc(PUSH_LINE[s] || PUSH_LINE.off) + '</p>'
      + (actions ? '<div class="set-actions">' + actions + '</div>' : '') + errLine(st.err.push)
      + '<p class="set-sub">Quiet hours 22:00 to 08:30 Dubai time.</p></div>';
  }

  function inspectionsCard() {
    const d = st.data;
    const dis = st.busy.target ? ' disabled' : '';
    return '<div class="sec-head"><h2>Inspections</h2></div><div class="set-body">'
      + '<div class="set-field"><label for="setTarget">Daily inspection target</label>'
      + '<div class="set-inline"><input id="setTarget" type="number" inputmode="numeric" min="0" max="50" step="1" value="'
      + esc(st.target) + '"' + dis + '>'
      + '<button class="btn primary" type="button" data-target-save' + dis + '>Save</button></div></div>'
      + errLine(st.err.target)
      + '<p class="set-line">' + esc(plural(Number(d.excludedCount) || 0, 'apartment', 'apartments')) + ' excluded from inspections</p>'
      + '<a class="btn" href="#/inspections/fleet">Manage exclusions</a></div>';
  }

  function checklistsCard() {
    const t = st.data.templates || [];
    const list = t.length
      ? '<ul class="set-list" data-checklists>' + t.map((x) => '<li class="set-row">' + esc(x.name) + ' · '
        + esc(plural(Number(x.items) || 0, 'step', 'steps')) + '</li>').join('') + '</ul>'
      : '<p class="empty" data-checklists>No checklists yet.</p>';
    return '<div class="sec-head"><h2>Checklists</h2></div><div class="set-body">' + list + '</div>';
  }

  const CARDS = { autopilot: autopilotCard, push: pushCard, inspections: inspectionsCard, checklists: checklistsCard };

  // Repeint une seule carte : la saisie en cours des autres cartes reste en place.
  function paintCard(name) {
    if (!ctx.isCurrent()) return;
    const el = $('[data-card="' + name + '"]');
    if (el) el.innerHTML = CARDS[name]();
  }

  function paintAll() {
    if (!ctx.isCurrent()) return;
    main.innerHTML = header() + '<div class="set">'
      + Object.keys(CARDS).map((k) => '<section class="card" data-card="' + k + '"></section>').join('') + '</div>';
    Object.keys(CARDS).forEach(paintCard);
  }

  function paintLoading() {
    main.innerHTML = header() + '<div class="ph"><p role="status">Loading settings...</p></div>';
  }

  function paintError(msg) {
    main.innerHTML = header() + '<div class="err-card"><p role="alert">' + esc(msg) + '</p>'
      + '<button class="btn primary" type="button" data-retry>Retry</button></div>';
  }

  async function load() {
    paintLoading();
    try {
      const d = await get('mgr.settings');
      if (!ctx.isCurrent()) return;
      st.data = d;
      st.target = String(d.inspectionTarget);
    } catch (e) {
      if (!ctx.isCurrent() || handleAccess(e)) return;
      paintError(e.message || 'Could not load the settings.');
      return;
    }
    st.push = await pushState().catch(() => 'unsupported');
    paintAll();
  }

  // Une ecriture : controle desactive pendant l'envoi, message du serveur en ligne en cas d'echec.
  async function write(card, busyKey, fn) {
    if (st.busy[busyKey]) return;
    st.busy[busyKey] = true;
    st.err[busyKey] = '';
    paintCard(card);
    try {
      await fn();
    } catch (e) {
      if (handleAccess(e)) return;
      st.err[busyKey] = (e && e.message) || 'Something went wrong. Try again.';
    } finally {
      st.busy[busyKey] = false;
    }
    paintCard(card);
  }

  async function setSetting(key, value) {
    const r = await post('mgr.settings.set', { key, value });
    if (r && r.settings) st.data = r.settings;
    toast('Saved');
  }

  const onClick = (e) => {
    if (!ctx.isCurrent()) return;
    const t = e.target && e.target.closest ? e.target.closest('button, a') : null;
    if (!t) return;
    if (t.hasAttribute('data-retry')) { load(); return; }
    if (t.hasAttribute('data-run')) {
      write('autopilot', 'run', async () => { st.run = null; st.run = await post('mgr.autopilot.run', {}); });
      return;
    }
    if (t.hasAttribute('data-target-save')) {
      const input = $('#setTarget');
      st.target = input ? input.value : st.target;
      const raw = String(st.target).trim();
      write('inspections', 'target', async () => {
        await setSetting('inspectionTarget', raw === '' ? null : Number(raw));
        st.target = String(st.data.inspectionTarget);
      });
      return;
    }
    if (t.hasAttribute('data-push-on')) {
      write('push', 'push', async () => {
        try { await enablePush(st.data.push && st.data.push.vapidPublicKey); }
        finally { st.push = await pushState().catch(() => 'unsupported'); }
        toast('Notifications on');
      });
      return;
    }
    if (t.hasAttribute('data-push-off')) {
      write('push', 'push', async () => {
        try { await disablePush(); } finally { st.push = await pushState().catch(() => 'unsupported'); }
        toast('Notifications off');
      });
      return;
    }
    if (t.hasAttribute('data-push-test')) {
      write('push', 'push', async () => {
        const r = await testPush();
        const why = r && r.skipped;
        toast(r && r.sent > 0 ? 'Test sent'
          : why === 'quiet_hours' ? 'Quiet hours: only urgent notifications are sent now'
            : why === 'vapid_not_configured' ? 'Push is not configured on the server yet'
              : 'No device subscribed yet');
      });
    }
  };

  const onChange = (e) => {
    if (!ctx.isCurrent()) return;
    const t = e.target;
    if (t && t.hasAttribute && t.hasAttribute('data-autopilot')) {
      const want = !!t.checked;
      st.want = want;
      write('autopilot', 'autopilot', () => setSetting('autopilot', want));
    }
    // La saisie de l'objectif est gardee si une autre carte se repeint.
    if (t && t.id === 'setTarget') st.target = t.value;
  };
  const onInput = (e) => { if (e.target && e.target.id === 'setTarget') st.target = e.target.value; };
  // Ecouteurs sur main, partage par tous les ecrans : retires en quittant la page.
  main.addEventListener('click', onClick);
  main.addEventListener('change', onChange);
  main.addEventListener('input', onInput);
  ctx.onLeave(() => {
    main.removeEventListener('click', onClick);
    main.removeEventListener('change', onChange);
    main.removeEventListener('input', onInput);
  });

  await load();
}
