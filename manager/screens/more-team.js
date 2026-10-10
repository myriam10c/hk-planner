// More > Team : membres, roles, invitations. Lecture : mgr.team. Ecritures : les actions
// existantes saveCleaner, inviteCleaner et deleteCleaner (le proxy verifie la session manager).
// Un membre ne quitte la liste qu'une fois le serveur confirme. Les liens de connexion
// ne sont jamais construits ici : l'invitation part par email depuis le proxy.
import { get, post } from '/manager/api.js';
import { closeSheet, esc, I, openSheet, sheetBusy, sheetError, sheetIsOpen, toast } from '/manager/ui/dom.js';

const ROLES = [
  ['manager', 'Manager', 'Managers'], ['cleaner', 'Cleaner', 'Cleaners'],
  ['subcontractor', 'Subcontractor', 'Subcontractors'], ['maintenance', 'Maintenance', 'Maintenance'],
];
const ROLE_LABEL = Object.fromEntries(ROLES.map((r) => [r[0], r[1]]));
const DEFAULT_COLOR = '#e94560';
const PIN_RE = /^\d{3,8}$/;

const colorOf = (c) => (/^#[0-9a-f]{6}$/i.test(String(c || '')) ? String(c).toLowerCase() : DEFAULT_COLOR);

function header() {
  return '<header class="top"><div><a class="more-back" href="#/more">' + I.prev + '<span>More</span></a>'
    + '<h1>Team</h1></div>'
    + '<button class="btn primary tm-add" type="button" data-add>Add member</button></header>';
}

function badges(m) {
  const b = [];
  if (m.hasPin) b.push('PIN');
  if (m.hasAccount) b.push('Account');
  if (m.isOwner) b.push('Owner');
  return b.length ? '<span class="tm-badges">' + b.map((x) => '<span class="tm-badge">' + x + '</span>').join('') + '</span>' : '';
}

function rowBody(m) {
  return '<span class="tm-dot" style="background:' + esc(colorOf(m.color)) + '"></span>'
    + '<span class="tm-txt"><span class="tm-name">' + esc(m.name) + ' <span class="pill idle">' + esc(ROLE_LABEL[m.role] || m.role) + '</span></span>'
    + '<span class="tm-sub">' + (m.email ? esc(m.email) : 'No email') + '</span></span>' + badges(m);
}

const field = (id, label, control) => '<div class="tm-fl"><label for="' + id + '">' + label + '</label>' + control + '</div>';

export async function renderTeam(ctx) {
  const main = ctx.main;
  const st = { members: null, error: '', sheet: null, busy: false, openInactive: false };
  const byId = (id) => (st.members || []).find((m) => String(m.id) === String(id));
  const isSelf = (m) => !!(ctx.me && String(ctx.me.id) === String(m.id));

  // true quand l'erreur est une sortie d'ecran (meme regle que Settings).
  function handleAccess(e) {
    if (e && e.kind === 'auth') { location.replace('/'); return true; }
    if (e && e.kind === 'forbidden' && e.message === 'email sign-in required') { ctx.emailRequired(); return true; }
    return false;
  }

  function paintList() {
    if (!ctx.isCurrent()) return;
    const active = st.members.filter((m) => m.active);
    const inactive = st.members.filter((m) => !m.active);
    const groups = ROLES.map(([role, , plural]) => {
      const rows = active.filter((m) => m.role === role);
      return rows.length
        ? '<section class="card"><div class="sec-head"><h2>' + plural + '</h2><span class="meta">' + rows.length + '</span></div><div class="tm-list">'
          + rows.map((m) => '<button class="tm-row" type="button" data-member="' + esc(m.id) + '">' + rowBody(m) + '</button>').join('')
          + '</div></section>'
        : '';
    }).join('');
    const empty = active.length ? '' : '<p class="empty pad">No active members.</p>';
    const off = inactive.length
      ? '<details class="card tm-inactive" data-inactive' + (st.openInactive ? ' open' : '') + '><summary>Inactive (' + inactive.length + ')</summary><div class="tm-list">'
        + inactive.map((m) => '<div class="tm-row ro" data-inactive-row="' + esc(m.id) + '">' + rowBody(m) + '</div>').join('')
        + '</div></details>'
      : '';
    main.innerHTML = header() + '<div class="tm">' + groups + empty + off + '</div>';
  }

  function paintLoading() { main.innerHTML = header() + '<div class="ph"><p role="status">Loading team...</p></div>'; }
  function paintError(msg) {
    main.innerHTML = header() + '<div class="err-card"><p role="alert">' + esc(msg) + '</p>'
      + '<button class="btn primary" type="button" data-retry>Retry</button></div>';
  }

  async function load(quiet) {
    if (!quiet) paintLoading();
    try {
      const d = await get('mgr.team');
      if (!ctx.isCurrent()) return;
      st.members = Array.isArray(d.members) ? d.members : [];
      paintList();
    } catch (e) {
      if (!ctx.isCurrent() || handleAccess(e)) return;
      if (!quiet || !st.members) paintError(e.message || 'Could not load the team.');
    }
  }

  // ---- panneau ----
  const head = (title, sub) => '<div class="sheet-h"><div><h2 id="sheetTitle">' + esc(title) + '</h2>'
    + (sub ? '<div class="sub">' + esc(sub) + '</div>' : '') + '</div>'
    + '<button class="iconbtn x" type="button" data-close aria-label="Close">' + I.close + '</button></div>';

  function formSheet(m) {
    const roleOpts = ROLES.map(([v, l]) => '<option value="' + v + '"' + ((m ? m.role : 'cleaner') === v ? ' selected' : '') + '>' + l + '</option>').join('');
    const body = field('tmName', 'Name', '<input id="tmName" type="text" maxlength="100" autocomplete="off" value="' + esc(m ? m.name : '') + '">')
      + (m
        ? '<div class="tm-fl"><span class="tm-lab">Email</span><span class="tm-ro">' + (m.email ? esc(m.email) : 'No email') + '</span></div>'
        : field('tmEmail', 'Email (optional)', '<input id="tmEmail" type="email" inputmode="email" autocomplete="off" autocapitalize="off">'))
      + field('tmPhone', 'Phone', '<input id="tmPhone" type="tel" inputmode="tel" autocomplete="off" value="' + esc(m ? m.phone : '') + '">')
      + field('tmRole', 'Role', '<select id="tmRole">' + roleOpts + '</select>')
      + field('tmColor', 'Color', '<input id="tmColor" type="color" value="' + esc(colorOf(m ? m.color : DEFAULT_COLOR)) + '">')
      + field('tmPin', m ? (m.hasPin ? 'New PIN (3 to 8 digits, optional)' : 'PIN (3 to 8 digits, optional)') : 'PIN (3 to 8 digits)',
        '<input id="tmPin" type="password" inputmode="numeric" maxlength="8" autocomplete="new-password">');
    const foot = m
      ? '<button class="btn primary" type="button" data-save>Save</button>'
        + (m.email ? '<button class="btn" type="button" data-resend>Resend invite</button>' : '')
        + (isSelf(m) ? '' : '<button class="btn danger" type="button" data-deactivate>Deactivate</button>')
      : '<button class="btn primary" type="button" data-create>Add with PIN only</button>';
    return head(m ? m.name : 'Add member', m ? ROLE_LABEL[m.role] || m.role : '')
      + '<div class="sheet-b">' + body + '</div><div class="sheet-f">' + foot + '</div>';
  }

  function confirmSheet(m) {
    return head('Deactivate ' + m.name + '?', '')
      + '<div class="sheet-b"><p class="tm-confirm" role="status">Deactivate ' + esc(m.name) + '? They will be signed out.</p></div>'
      + '<div class="sheet-f"><button class="btn danger" type="button" data-confirm>Confirm</button>'
      + '<button class="btn" type="button" data-cancel>Cancel</button></div>';
  }

  const val = (id) => { const el = document.getElementById(id); return el ? String(el.value).trim() : ''; };
  function readForm() {
    return { name: val('tmName'), email: val('tmEmail').toLowerCase(), phone: val('tmPhone'), role: val('tmRole'), color: val('tmColor'), pin: val('tmPin') };
  }

  // Une ecriture dans le panneau : bloque pendant l'envoi, erreur du serveur telle quelle.
  async function run(fn, okMsg) {
    if (st.busy) return;
    st.busy = true;
    sheetBusy(true);
    try {
      await fn();
    } catch (e) {
      st.busy = false;
      sheetBusy(false);
      if (!handleAccess(e)) sheetError((e && e.message) || 'Something went wrong. Try again.');
      return false;
    }
    st.busy = false;
    sheetBusy(false);
    if (st.sheet) { st.sheet = null; closeSheet(); }
    toast(okMsg);
    load(true);
    return true;
  }

  function validate(f, needPin) {
    if (!f.name) return 'Name is required.';
    if (needPin && !f.pin) return 'A PIN is required when there is no email.';
    if (f.pin && !PIN_RE.test(f.pin)) return 'PIN must be 3 to 8 digits.';
    return '';
  }

  function onCreate() {
    const f = readForm();
    const bad = validate(f, !f.email);
    if (bad) { sheetError(bad); return; }
    if (f.email) {
      run(async () => {
        const r = await post('inviteCleaner', { name: f.name, email: f.email, role: f.role, phone: f.phone, color: f.color });
        // L'invitation ne connait pas le PIN : on le pose sur la ligne creee.
        if (f.pin) {
          if (!r || !r.id) throw new Error('Member invited, but the PIN was not saved: no member id returned.');
          try { await post('saveCleaner', { id: r.id, name: f.name, phone: f.phone, color: f.color, role: f.role, pin: f.pin }); }
          catch (e) { throw new Error('Member invited, but the PIN was not saved: ' + ((e && e.message) || 'error')); }
        }
      }, 'Invitation sent to ' + f.email);
    } else {
      run(() => post('saveCleaner', { name: f.name, phone: f.phone, color: f.color, role: f.role, pin: f.pin }), 'Member added');
    }
  }

  function onSave() {
    const m = st.sheet && byId(st.sheet.id);
    if (!m) return;
    const f = readForm();
    const bad = validate(f, false);
    if (bad) { sheetError(bad); return; }
    const body = { id: m.id, name: f.name, phone: f.phone, color: f.color, role: f.role };
    if (f.pin) body.pin = f.pin;
    run(() => post('saveCleaner', body), 'Saved');
  }

  function onResend() {
    const m = st.sheet && byId(st.sheet.id);
    if (!m || !m.email) return;
    run(() => post('inviteCleaner', { id: m.id, name: m.name, email: m.email, role: m.role }), 'Invitation sent to ' + m.email);
  }

  async function onConfirm() {
    const m = st.sheet && byId(st.sheet.id);
    if (!m) return;
    const ok = await run(() => post('deleteCleaner', { id: m.id }), m.name + ' deactivated');
    // Echec partiel possible (desactive mais compte non supprime) : on relit la liste.
    if (ok === false) load(true);
  }

  function openAdd() { st.sheet = { id: null, view: 'form' }; openSheet(formSheet(null)); syncAddLabel(); }
  function openMember(id) {
    const m = byId(id);
    if (!m) return;
    st.sheet = { id: m.id, view: 'form' };
    openSheet(formSheet(m));
  }
  function syncAddLabel() {
    const btn = document.querySelector('#sheet [data-create]');
    if (btn) btn.textContent = val('tmEmail') ? 'Add and invite' : 'Add with PIN only';
  }

  const onClick = (e) => {
    if (!ctx.isCurrent()) return;
    const t = e.target && e.target.closest ? e.target.closest('button') : null;
    if (!t) return;
    const inSheet = !!t.closest('#sheet');
    if (!inSheet) {
      if (t.hasAttribute('data-retry')) load(); else if (t.hasAttribute('data-add')) openAdd();
      else if (t.hasAttribute('data-member')) openMember(t.getAttribute('data-member'));
      return;
    }
    if (!st.sheet || t.disabled) return;
    if (t.hasAttribute('data-create')) onCreate();
    else if (t.hasAttribute('data-save')) onSave();
    else if (t.hasAttribute('data-resend')) onResend();
    else if (t.hasAttribute('data-deactivate')) { const m = byId(st.sheet.id); if (m) { st.sheet.view = 'confirm'; openSheet(confirmSheet(m)); } }
    else if (t.hasAttribute('data-cancel')) openMember(st.sheet.id);
    else if (t.hasAttribute('data-confirm')) onConfirm();
  };
  const onInput = (e) => { if (e.target && e.target.id === 'tmEmail') syncAddLabel(); };
  const onToggle = (e) => { if (e.target && e.target.hasAttribute && e.target.hasAttribute('data-inactive')) st.openInactive = e.target.open; };
  document.addEventListener('click', onClick);
  document.addEventListener('input', onInput);
  main.addEventListener('toggle', onToggle, true);
  ctx.onLeave(() => {
    document.removeEventListener('click', onClick);
    document.removeEventListener('input', onInput);
    main.removeEventListener('toggle', onToggle, true);
    if (st.sheet && sheetIsOpen()) closeSheet();
    st.sheet = null;
  });

  await load();
}
