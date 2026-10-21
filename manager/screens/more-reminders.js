// More > Reminders : relances automatiques par push (plan 2026-10-20-hk-reminders).
// Lecture : rem.config (config fusionnee, defauts, managers, personnes) et rem.log.
// Ecritures : rem.config.set { patch } avec seulement les champs modifies d'une carte,
// { patch: { reset: true } } pour les defauts. rem.test : urgent de test a soi-meme.
import { get, post } from '/manager/api.js';
import { esc, I, toast } from '/manager/ui/dom.js';

// Regles affichees : description courte, champs de delai propres a la regle.
// unit : 'min' (minutes), 'h' (heures converties en minutes), 'time' (HH:MM), 'n' (entier), 'x' (facteur).
export const RULES = [
  { r: 'r1', name: 'Urgent ticket unassigned', desc: 'Urgent ticket with no one assigned: alert the managers (URGENT).',
    fields: [{ k: 'urgentUnassignedMin', label: 'After', unit: 'min', lo: 1, hi: 10080 }] },
  { r: 'r2', name: 'No one and no due date', desc: 'Ticket with no one assigned and no due date: alert the managers.',
    fields: [{ k: 'unassignedNoDueMin', label: 'After', unit: 'h', lo: 1, hi: 10080 }] },
  { r: 'r3', name: 'Assigned, not started', desc: 'Ticket assigned but not started: remind the technician, then once more.',
    fields: [{ k: 'assignedFirstMin', label: 'First reminder after', unit: 'h', lo: 1, hi: 10080 },
      { k: 'assignedSecondMin', label: 'Second reminder, after another', unit: 'h', lo: 1, hi: 10080 }] },
  { r: 'r4', name: 'In progress, no update', desc: 'Ticket in progress with no update: remind the technician.',
    fields: [{ k: 'inProgressStaleMin', label: 'After', unit: 'h', lo: 1, hi: 10080 }] },
  { r: 'r5', name: 'Guest on site', desc: 'Guest in the apartment: rules 1, 2, 3, 4, 6 and 9 fire sooner.',
    fields: [{ k: 'guestFactor', label: 'Multiply the delays by', unit: 'x', lo: 0.1, hi: 1 }] },
  { r: 'r6', name: 'Past due date', desc: 'Ticket past its due date: remind the technician and alert the managers, once a day.', fields: [] },
  { r: 'r7', name: 'Tomorrow unassigned', desc: 'Tomorrow’s cleanings with no one assigned: alert the managers once a day.',
    fields: [{ k: 'tomorrowCheckAt', label: 'Check at (Dubai time)', unit: 'time' }] },
  { r: 'r8', name: 'Cleaning late', desc: 'Cleaning not marked done after its planned time: remind the cleaner (not Elite).',
    fields: [{ k: 'cleaningLateMin', label: 'After the planned time', unit: 'h', lo: 1, hi: 10080 },
      { k: 'cleaningDefaultTime', label: 'Planned time when unknown', unit: 'time' }] },
  { r: 'r9', name: 'Proposal waiting', desc: 'Maintenance proposal waiting for a decision: remind the managers.',
    fields: [{ k: 'proposalPendingMin', label: 'After', unit: 'h', lo: 1, hi: 10080 }] },
  { r: 'r10', name: 'Escalation', desc: 'Technician did nothing after the reminders: alert the managers (URGENT).',
    fields: [{ k: 'escalateAfter', label: 'After this many reminders', unit: 'n', lo: 1, hi: 10 },
      { k: 'escalateGraceMin', label: 'Escalation grace', unit: 'min', lo: 0, hi: 1440 }] },
];

const LIMITS = [
  { k: 'quiet.start', label: 'Quiet hours start (Dubai time)', unit: 'time' },
  { k: 'quiet.end', label: 'Quiet hours end', unit: 'time' },
  { k: 'maxPerSubjectPerDay', label: 'Max reminders per ticket per day', unit: 'n', lo: 1, hi: 10 },
  { k: 'minGapMin', label: 'Min gap between two identical reminders', unit: 'min', lo: 0, hi: 1440 },
  { k: 'digestOver', label: 'Group into one notification above', unit: 'n', lo: 1, hi: 50 },
];

const PLACEHOLDERS = {
  r1: '{apt} {title} {ref}', r2: '{apt} {title} {ref} {hours}', r3: '{apt} {title} {ref} {who}',
  r4: '{apt} {title} {ref} {hours} {who}', r6: '{apt} {title} {ref} {due} {who}', r7: '{count} {list} {date}',
  r8: '{apt} {ref}', r9: '{apt} {title} {ref} {hours}', r10: '{apt} {title} {ref} {who} {count}',
};
const TEXT_RULES = ['r1', 'r2', 'r3', 'r4', 'r6', 'r7', 'r8', 'r9', 'r10'];

const STATUS = {
  sent: ['Sent', 'ok'], no_subscription: ['No phone subscribed', 'warn'], quiet: ['Quiet hours', ''],
  capped: ['Daily cap reached', ''], duplicate: ['Duplicate', ''], error: ['Error', 'bad'],
};

const UNIT_TXT = { min: 'min', h: 'hours', n: '', x: '', time: '' };
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

// --- Aides pures (testees dans tests/manager/more-reminders.spec.ts) ------------------

export function getPath(obj, path) {
  return String(path).split('.').reduce((o, k) => (o && typeof o === 'object' ? o[k] : undefined), obj);
}

function same(a, b) {
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    const sa = [...a].sort((x, y) => x - y), sb = [...b].sort((x, y) => x - y);
    return sa.every((v, i) => v === sb[i]);
  }
  return a === b;
}

// Patch minimal : { 'quiet.start': '22:00', urgentUnassignedMin: 45 } compare a la config
// -> { quiet: { start: '22:00' }, urgentUnassignedMin: 45 } sans les valeurs inchangees.
export function remPatch(config, values) {
  const patch = {};
  for (const path of Object.keys(values || {})) {
    const v = values[path];
    if (same(getPath(config, path), v)) continue;
    const parts = path.split('.');
    let o = patch;
    for (let i = 0; i < parts.length - 1; i++) { o[parts[i]] = o[parts[i]] || {}; o = o[parts[i]]; }
    o[parts[parts.length - 1]] = v;
  }
  return patch;
}

// Valeur affichee d'un champ (minutes -> heures pour l'unite h).
export function toInput(value, unit) {
  if (unit === 'h') return String(Math.round((Number(value) / 60) * 100) / 100);
  return value === null || value === undefined ? '' : String(value);
}

// Saisie -> valeur de config, ou { error } avec un message court.
export function fromInput(raw, f) {
  const s = String(raw == null ? '' : raw).trim();
  if (f.unit === 'time') return HHMM.test(s) ? { value: s } : { error: f.label + ': use HH:MM.' };
  const n = Number(s.replace(',', '.'));
  if (s === '' || !Number.isFinite(n)) return { error: f.label + ': enter a number.' };
  if ((f.unit === 'min' || f.unit === 'n') && !Number.isInteger(n)) return { error: f.label + ': whole numbers only.' };
  const v = f.unit === 'h' ? Math.round(n * 60) : n;
  if (v < f.lo || v > f.hi) {
    const lo = f.unit === 'h' ? toInput(f.lo, 'h') : f.lo, hi = f.unit === 'h' ? toInput(f.hi, 'h') : f.hi;
    return { error: f.label + ': between ' + lo + ' and ' + hi + (UNIT_TXT[f.unit] ? ' ' + UNIT_TXT[f.unit] : '') + '.' };
  }
  return { value: v };
}

// Lien vers la fiche ticket ou proposition ; null pour les autres sujets (menages).
export function refHref(ref) {
  return /^(MNT|PRP)-\d+$/.test(String(ref || '')) ? '#/maintenance?ref=' + encodeURIComponent(ref) : null;
}

// Resultat de rem.test -> message du toast.
export function testMessage(r) {
  const sent = Number(r && r.sent) || 0;
  if (sent > 0) return 'Test sent to ' + sent + (sent === 1 ? ' device' : ' devices') + '. Check this phone.';
  const sk = r && r.skipped;
  const list = Array.isArray(sk) ? sk.map((x) => (x && typeof x === 'object' ? x.reason : x)) : [sk];
  if (list.includes('no_subscription') || !sk) return 'No notifications on this phone yet: turn them on first';
  if (list.includes('vapid_not_configured')) return 'Push is not configured on the server yet';
  return 'The test was not sent (' + String(list[0]) + ').';
}

export function dubaiDateTime(iso) {
  try {
    return new Date(iso).toLocaleString('en-GB', {
      day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Dubai',
    });
  } catch (e) { return ''; }
}

// --- Ecran ---------------------------------------------------------------------------

function header() {
  return '<header class="top"><div><a class="more-back" href="#/more">' + I.prev + '<span>More</span></a>'
    + '<h1>Reminders</h1></div></header>';
}
const errLine = (msg) => (msg ? '<p class="set-err" role="alert">' + esc(msg) + '</p>' : '');

function fieldHtml(f, cfg, dis) {
  const id = 'rem_' + f.k.replace('.', '_');
  const v = toInput(getPath(cfg, f.k), f.unit);
  const type = f.unit === 'time' ? 'time' : 'number';
  const step = f.unit === 'h' ? '0.25' : f.unit === 'x' ? '0.05' : '1';
  const attrs = type === 'number'
    ? ' inputmode="decimal" step="' + step + '" min="' + (f.unit === 'h' ? toInput(f.lo, 'h') : f.lo) + '" max="' + (f.unit === 'h' ? toInput(f.hi, 'h') : f.hi) + '"'
    : '';
  return '<div class="set-field rem-field"><label for="' + id + '">' + esc(f.label) + '</label>'
    + '<div class="set-inline"><input id="' + id + '" type="' + type + '" data-f="' + esc(f.k) + '" value="' + esc(v) + '"' + attrs + dis + '>'
    + (UNIT_TXT[f.unit] ? '<span class="set-sub">' + esc(UNIT_TXT[f.unit]) + '</span>' : '') + '</div></div>';
}

export async function renderReminders(ctx) {
  const main = ctx.main;
  const st = {
    data: null, tab: 'settings', log: null, logErr: '', logBusy: false,
    err: {}, busy: {}, confirmReset: false,
  };
  const $ = (sel) => main.querySelector(sel);
  const cfg = () => st.data.config;

  function handleAccess(e) {
    if (e && e.kind === 'auth') { location.replace('/'); return true; }
    if (e && e.kind === 'forbidden') {
      if (e.message === 'email sign-in required') ctx.emailRequired(); else location.replace('/');
      return true;
    }
    return false;
  }

  const dis = (k) => (st.busy[k] ? ' disabled' : '');
  const saveBtn = (k) => '<div class="set-actions"><button class="btn primary" type="button" data-save="' + k + '"' + dis(k) + '>Save</button></div>' + errLine(st.err[k]);

  function masterCard() {
    const on = !!cfg().enabled;
    return '<div class="set-body rem-master">'
      + '<label class="set-switch rem-big"><span><strong>Automatic reminders</strong></span>'
      + '<input type="checkbox" role="switch" data-enabled' + (on ? ' checked' : '') + dis('enabled') + '></label>'
      + '<p class="set-line" data-enabled-state><span class="pill ' + (on ? 'ok' : 'warn') + '">' + (on ? 'ON' : 'OFF') + '</span> '
      + esc(on ? 'Reminders are sent every 5 minutes when a rule applies.' : 'No reminder is sent. Turn on to start again.') + '</p>'
      + errLine(st.err.enabled)
      + '<div class="set-actions"><button class="btn" type="button" data-test' + dis('test') + '>Send me a test URGENT notification</button></div>'
      + '</div>';
  }

  function rulesCard() {
    const c = cfg();
    const rows = RULES.map((x) => '<li class="rem-rule" data-rule="' + x.r + '">'
      + '<label class="set-switch"><span><strong>' + esc(x.r.toUpperCase() + ' · ' + x.name) + '</strong>'
      + '<span class="rem-desc">' + esc(x.desc) + '</span></span>'
      + '<input type="checkbox" role="switch" data-f="rules.' + x.r + '" aria-label="' + esc(x.r.toUpperCase() + ' ' + x.name) + '"'
      + (c.rules && c.rules[x.r] ? ' checked' : '') + dis('rules') + '></label>'
      + (x.fields.length ? '<div class="rem-fields">' + x.fields.map((f) => fieldHtml(f, c, dis('rules'))).join('') + '</div>' : '')
      + '</li>').join('');
    return '<div class="sec-head"><h2>Rules</h2></div><div class="set-body"><ul class="rem-rules">' + rows + '</ul>' + saveBtn('rules') + '</div>';
  }

  function limitsCard() {
    const c = cfg();
    return '<div class="sec-head"><h2>Quiet hours and limits</h2></div><div class="set-body">'
      + '<p class="set-sub">During quiet hours nothing is sent, except urgent tickets with a guest on site.</p>'
      + '<div class="rem-fields">' + LIMITS.map((f) => fieldHtml(f, c, dis('limits'))).join('') + '</div>' + saveBtn('limits') + '</div>';
  }

  function recipientsCard() {
    const c = cfg();
    const all = c.managerIds === null || c.managerIds === undefined;
    const ids = new Set((c.managerIds || []).map(Number));
    const list = (st.data.managers || []).map((m) => '<li class="set-row"><label class="rem-check">'
      + '<input type="checkbox" data-mgr="' + esc(m.id) + '"' + (all || ids.has(Number(m.id)) ? ' checked' : '')
      + (all || st.busy.recipients ? ' disabled' : '') + '> <span>' + esc(m.name) + '</span></label></li>').join('');
    return '<div class="sec-head"><h2>Who gets the manager alerts</h2></div><div class="set-body">'
      + '<label class="set-switch"><span>All active managers</span><input type="checkbox" role="switch" data-mgr-all'
      + (all ? ' checked' : '') + dis('recipients') + '></label>'
      + (list ? '<ul class="set-list">' + list + '</ul>' : '<p class="empty">No managers found.</p>')
      + '<p class="set-sub">Technicians and cleaners always get their own reminders.</p>' + saveBtn('recipients') + '</div>';
  }

  function textsCard() {
    const c = cfg();
    const items = TEXT_RULES.map((r) => {
      const x = RULES.find((y) => y.r === r);
      return '<div class="set-field rem-text"><label for="remText_' + r + '">' + esc(r.toUpperCase() + ' · ' + x.name) + '</label>'
        + '<textarea id="remText_' + r + '" rows="3" maxlength="200" data-f="texts.' + r + '"' + dis('texts') + '>'
        + esc((c.texts && c.texts[r]) || '') + '</textarea>'
        + '<span class="set-sub">Placeholders: ' + esc(PLACEHOLDERS[r]) + '</span></div>';
    }).join('');
    return '<details class="rem-details"><summary><h2>Message texts</h2></summary><div class="set-body">' + items + saveBtn('texts') + '</div></details>';
  }

  function resetCard() {
    const body = st.confirmReset
      ? '<p class="set-line" role="status">Restore every reminder setting to the defaults?</p>'
        + '<div class="set-actions"><button class="btn danger" type="button" data-reset-yes' + dis('reset') + '>Yes, restore</button>'
        + '<button class="btn" type="button" data-reset-no' + dis('reset') + '>Cancel</button></div>'
      : '<div class="set-actions"><button class="btn" type="button" data-reset>Restore defaults</button></div>';
    return '<div class="set-body rem-reset">' + body + errLine(st.err.reset) + '</div>';
  }

  const CARDS = { master: masterCard, rules: rulesCard, limits: limitsCard, recipients: recipientsCard, texts: textsCard, reset: resetCard };
  // Carte qui porte chaque ecriture (busy/err).
  const CARD_OF = { enabled: 'master', test: 'master', rules: 'rules', limits: 'limits', recipients: 'recipients', texts: 'texts', reset: 'reset' };

  function paintCard(name) {
    if (!ctx.isCurrent()) return;
    const el = $('[data-card="' + name + '"]');
    if (!el) return;
    const wasOpen = name === 'texts' && el.querySelector('details[open]');
    el.innerHTML = CARDS[name]();
    if (wasOpen) el.querySelector('details').open = true;
  }

  function tabs() {
    return '<div class="rv-chips rem-tabs" role="tablist">'
      + ['settings', 'log'].map((t) => '<button class="rv-chip" type="button" role="tab" data-tab="' + t + '" aria-pressed="' + (st.tab === t) + '" aria-selected="' + (st.tab === t) + '">'
        + (t === 'settings' ? 'Settings' : 'Log') + '</button>').join('') + '</div>';
  }

  function logHtml() {
    if (st.logBusy && !st.log) return '<div class="ph"><p role="status">Loading the log...</p></div>';
    if (st.logErr) return '<div class="err-card"><p role="alert">' + esc(st.logErr) + '</p><button class="btn primary" type="button" data-log-retry>Retry</button></div>';
    const rows = st.log || [];
    if (!rows.length) return '<p class="empty">No reminder sent yet.</p>';
    const tr = rows.map((r) => {
      const href = refHref(r.subjectRef);
      const ref = r.subjectRef ? (href ? '<a href="' + esc(href) + '">' + esc(r.subjectRef) + '</a>' : esc(r.subjectRef)) : '';
      const s = STATUS[r.status] || [r.status || '', ''];
      return '<tr>'
        + '<td data-l="When">' + esc(dubaiDateTime(r.sentAt)) + '</td>'
        + '<td data-l="To">' + esc(r.recipientName || (r.recipientId ? '#' + r.recipientId : '')) + '</td>'
        + '<td data-l="Rule">' + esc(String(r.rule || '').toUpperCase()) + '</td>'
        + '<td data-l="Ref">' + ref + '</td>'
        + '<td data-l="Message"><div class="rem-msg">' + (r.urgent ? '<span class="pill bad">URGENT</span> ' : '') + esc(r.title || '')
        + (r.body ? '<span class="rem-body">' + esc(r.body) + '</span>' : '') + '</div></td>'
        + '<td data-l="Status"><span class="pill ' + s[1] + '">' + esc(s[0]) + '</span></td>'
        + '<td data-l="Read">' + (r.readAt ? 'Read ' + esc(dubaiDateTime(r.readAt)) : (r.status === 'sent' ? 'Not read' : '')) + '</td>'
        + '</tr>';
    }).join('');
    return '<p class="set-sub">Latest ' + rows.length + (rows.length === 1 ? ' reminder' : ' reminders') + ', Dubai time.</p>'
      + '<table class="rem-log"><thead><tr><th>When</th><th>To</th><th>Rule</th><th>Ref</th><th>Message</th><th>Status</th><th>Read</th></tr></thead>'
      + '<tbody>' + tr + '</tbody></table>';
  }

  function paintAll() {
    if (!ctx.isCurrent()) return;
    if (st.tab === 'log') {
      main.innerHTML = header() + '<div class="set rem">' + tabs() + '<div data-log>' + logHtml() + '</div></div>';
      return;
    }
    main.innerHTML = header() + '<div class="set rem">' + tabs()
      + Object.keys(CARDS).map((k) => '<section class="card" data-card="' + k + '"></section>').join('') + '</div>';
    Object.keys(CARDS).forEach(paintCard);
  }

  function paintLoading() { main.innerHTML = header() + '<div class="ph"><p role="status">Loading reminders...</p></div>'; }
  function paintError(msg) {
    main.innerHTML = header() + '<div class="err-card"><p role="alert">' + esc(msg) + '</p>'
      + '<button class="btn primary" type="button" data-retry>Retry</button></div>';
  }

  async function load() {
    paintLoading();
    try {
      const d = await get('rem.config');
      if (!ctx.isCurrent()) return;
      st.data = { config: d.config || {}, defaults: d.defaults || {}, managers: d.managers || [], people: d.people || [] };
    } catch (e) {
      if (!ctx.isCurrent() || handleAccess(e)) return;
      paintError(e.message || 'Could not load the reminders.');
      return;
    }
    paintAll();
  }

  async function loadLog() {
    st.logBusy = true; st.logErr = '';
    paintAll();
    try {
      const r = await get('rem.log', { limit: 200 });
      if (!ctx.isCurrent()) return;
      st.log = (r && r.rows) || [];
    } catch (e) {
      if (!ctx.isCurrent() || handleAccess(e)) return;
      st.logErr = e.message || 'Could not load the log.';
    } finally { st.logBusy = false; }
    if (st.tab === 'log') paintAll();
  }

  async function write(key, fn) {
    if (st.busy[key]) return;
    st.busy[key] = true; st.err[key] = '';
    paintCard(CARD_OF[key]);
    try { await fn(); } catch (e) {
      if (handleAccess(e)) return;
      st.err[key] = (e && e.message) || 'Something went wrong. Try again.';
    } finally { st.busy[key] = false; }
    paintCard(CARD_OF[key]);
  }

  async function sendPatch(patch, okMsg) {
    const r = await post('rem.config.set', { patch });
    if (r && r.config) st.data.config = r.config;
    toast(okMsg || 'Saved');
  }

  // Lit les champs data-f d'une carte ; rend { values } ou { error }.
  function readCard(card) {
    const el = $('[data-card="' + card + '"]');
    const values = {};
    const specs = {};
    RULES.forEach((x) => x.fields.forEach((f) => { specs[f.k] = f; }));
    LIMITS.forEach((f) => { specs[f.k] = f; });
    for (const inp of el.querySelectorAll('[data-f]')) {
      const k = inp.getAttribute('data-f');
      if (inp.type === 'checkbox') { values[k] = !!inp.checked; continue; }
      if (k.startsWith('texts.')) {
        const t = String(inp.value).trim();
        if (!t || t.length > 200) return { error: k.slice(6).toUpperCase() + ' text: 1 to 200 characters.' };
        values[k] = t;
        continue;
      }
      const res = fromInput(inp.value, specs[k]);
      if (res.error) return { error: res.error };
      values[k] = res.value;
    }
    return { values };
  }

  function save(card) {
    if (card === 'recipients') {
      const el = $('[data-card="recipients"]');
      const all = el.querySelector('[data-mgr-all]').checked;
      const ids = all ? null : Array.from(el.querySelectorAll('[data-mgr]:checked')).map((i) => Number(i.getAttribute('data-mgr')));
      if (ids && !ids.length) { st.err.recipients = 'Pick at least one manager.'; paintCard('recipients'); return; }
      const patch = remPatch(cfg(), { managerIds: ids });
      if (!Object.keys(patch).length) { toast('Nothing to save'); return; }
      write('recipients', () => sendPatch(patch));
      return;
    }
    const res = readCard(card);
    if (res.error) { st.err[card] = res.error; paintCard(CARD_OF[card]); return; }
    const patch = remPatch(cfg(), res.values);
    if (!Object.keys(patch).length) { st.err[card] = ''; paintCard(CARD_OF[card]); toast('Nothing to save'); return; }
    write(card, () => sendPatch(patch));
  }

  const onClick = (e) => {
    if (!ctx.isCurrent()) return;
    const t = e.target && e.target.closest ? e.target.closest('button') : null;
    if (!t) return;
    if (t.hasAttribute('data-retry')) { load(); return; }
    if (t.hasAttribute('data-tab')) {
      const tab = t.getAttribute('data-tab');
      if (tab === st.tab) return;
      st.tab = tab;
      if (tab === 'log') loadLog(); else paintAll();
      return;
    }
    if (t.hasAttribute('data-log-retry')) { loadLog(); return; }
    if (t.hasAttribute('data-save')) { save(t.getAttribute('data-save')); return; }
    if (t.hasAttribute('data-test')) {
      write('test', async () => { toast(testMessage(await post('rem.test', {}))); });
      return;
    }
    if (t.hasAttribute('data-reset')) { st.confirmReset = true; paintCard('reset'); return; }
    if (t.hasAttribute('data-reset-no')) { st.confirmReset = false; st.err.reset = ''; paintCard('reset'); return; }
    if (t.hasAttribute('data-reset-yes')) {
      write('reset', async () => {
        await sendPatch({ reset: true }, 'Defaults restored');
        st.confirmReset = false;
        Object.keys(CARDS).forEach((k) => { if (k !== 'reset') paintCard(k); });
      });
    }
  };

  const onChange = (e) => {
    if (!ctx.isCurrent()) return;
    const t = e.target;
    if (!t || !t.hasAttribute) return;
    if (t.hasAttribute('data-enabled')) {
      const want = !!t.checked;
      write('enabled', () => sendPatch({ enabled: want }, want ? 'Reminders on' : 'Reminders off'));
      return;
    }
    if (t.hasAttribute('data-mgr-all')) {
      const el = $('[data-card="recipients"]');
      el.querySelectorAll('[data-mgr]').forEach((i) => { i.disabled = t.checked; if (t.checked) i.checked = true; });
    }
  };

  main.addEventListener('click', onClick);
  main.addEventListener('change', onChange);
  ctx.onLeave(() => {
    main.removeEventListener('click', onClick);
    main.removeEventListener('change', onChange);
  });

  await load();
}
