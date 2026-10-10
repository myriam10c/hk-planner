// More > HR : vue d'ensemble, meme ordre que renderHRManager de hr.js (racine) :
// demandes en attente (seulement s'il y en a), absents du jour, documents qui expirent,
// equipe, personnes sans dossier, jours feries (tous ceux a venir, sans plafond).
// Lecture : hrOverview (+ mgr.team pour les noms et les personnes sans dossier).
// Ecritures : hrDecideLeave (proprietaire ; Approve exige la signature du manager),
// hrSaveHoliday, hrDeleteHoliday (proprietaire), hrLeaveForm pour le formulaire PDF.
// Le serveur reste juge : les boutons proprietaire sont seulement masques si isOwner est faux.
// La fiche employe (#/more/hr/<id>) arrive en Task 2 ; d'ici la, l'identifiant affiche la vue d'ensemble.
import { get, post } from '/manager/api.js';
import { closeSheet, esc, I, openSheet, sheetBusy, sheetError, sheetIsOpen, toast } from '/manager/ui/dom.js';
import { askSignature } from '/manager/ui/signature.js';
import { HR_DOC_TYPES, HR_LEAVE_TYPES, accruedAnnualDays, daysUntil, hrUpcomingHolidays, rangesOverlap } from '/manager/hr-rules.js';

const ROLE_LABEL = { manager: 'Manager', cleaner: 'Cleaner', maintenance: 'Maintenance', subcontractor: 'Subcontractor' };
const typeLabel = (k) => { const t = HR_LEAVE_TYPES.find((x) => x.key === k); return t ? t.label : String(k || ''); };
const docLabel = (k) => { const t = HR_DOC_TYPES.find((x) => x.key === k); return t ? t.label : String(k || ''); };
const plural = (n, w) => n + ' ' + w + (n === 1 ? '' : 's');
const nextDay = (d) => new Date(Date.parse(d + 'T00:00:00Z') + 86400000).toISOString().slice(0, 10);

function header() {
  return '<header class="top"><div><a class="more-back" href="#/more">' + I.prev + '<span>More</span></a>'
    + '<h1>HR and leave</h1></div></header>';
}

const sec = (key, title, meta, body) => '<section class="card hr-sec" data-hr-sec="' + key + '">'
  + '<div class="sec-head"><h2>' + esc(title) + '</h2>' + (meta !== '' ? '<span class="meta">' + esc(meta) + '</span>' : '') + '</div>'
  + body + '</section>';

export async function renderHr(ctx) {
  const main = ctx.main;
  const st = { data: null, team: [], busy: new Set(), errs: new Map(), formBusy: false, formErr: '', sheet: null, sheetBusy: false };

  function handleAccess(e) {
    if (e && e.kind === 'auth') { location.replace('/'); return true; }
    if (e && e.kind === 'forbidden' && e.message === 'email sign-in required') { ctx.emailRequired(); return true; }
    return false;
  }

  const nameOf = (id) => {
    const c = st.team.find((x) => String(x.id) === String(id));
    return c ? c.name : '#' + id;
  };
  const today = () => (st.data && st.data.today) || '';

  // Solde annuel : acquis legal moins jours annuels approuves (hrAnnualBalance de hr.js).
  function balance(e) {
    const taken = ((st.data && st.data.taken) || {})[String(e.cleaner_id)] || {};
    const asOf = e.end_date && e.end_date < today() ? e.end_date : today();
    const accrued = accruedAnnualDays(e.hire_date, asOf, e.opening_annual_days, e.opening_date);
    return Math.round((accrued - Number(taken.annual || 0)) * 100) / 100;
  }
  const onLeaveToday = (cid) => (st.data.upcoming || []).some((l) =>
    Number(l.cleaner_id) === Number(cid) && rangesOverlap(l.start_date, l.end_date, today(), today()));

  function requestCard(r) {
    const days = Number(r.days || 0);
    const id = String(r.id);
    const busy = st.busy.has(id);
    const err = st.errs.get(id);
    const owner = !!st.data.isOwner;
    return '<article class="hr-req" data-req="' + esc(id) + '">'
      + '<div class="hr-line"><span class="hr-name">' + esc(nameOf(r.cleaner_id)) + '</span>'
      + '<span class="pill warn">Pending</span></div>'
      + '<div class="hr-sub">' + esc(typeLabel(r.leave_type)) + ' · ' + esc(r.start_date) + ' to ' + esc(r.end_date) + ' · ' + plural(days, 'day') + '</div>'
      + (r.reason ? '<div class="hr-sub">"' + esc(r.reason) + '"</div>' : '')
      + (err ? '<p class="hr-err" role="alert">' + esc(err) + '</p>' : '')
      + '<div class="hr-actions">'
      + (owner ? '<button class="btn primary" type="button" data-approve="' + esc(id) + '"' + (busy ? ' disabled' : '') + '>Approve</button>'
        + '<button class="btn" type="button" data-reject="' + esc(id) + '"' + (busy ? ' disabled' : '') + '>Reject</button>' : '')
      + '<button class="btn" type="button" data-form="' + esc(id) + '"' + (busy ? ' disabled' : '') + '>Download form</button>'
      + '</div></article>';
  }

  function paint() {
    if (!ctx.isCurrent()) return;
    const d = st.data;
    const t = today();
    const pending = d.pending || [];
    const employees = d.employees || [];
    let h = '';
    if (pending.length) h += sec('pending', 'Pending requests', String(pending.length), '<div class="hr-list">' + pending.map(requestCard).join('') + '</div>');

    const away = (d.upcoming || []).filter((l) => rangesOverlap(l.start_date, l.end_date, t, t));
    if (away.length) {
      h += sec('away', 'Away today', String(away.length), '<div class="hr-list">' + away.map((l) => '<div class="hr-row ro">'
        + '<span class="hr-txt"><span class="hr-name">' + esc(nameOf(l.cleaner_id)) + '</span>'
        + '<span class="hr-sub">Back on ' + esc(nextDay(l.end_date)) + '</span></span>'
        + '<span class="pill idle">On leave</span></div>').join('') + '</div>');
    }

    const expiring = d.expiring || [];
    if (expiring.length) {
      h += sec('docs', 'Documents expiring', String(expiring.length), '<div class="hr-list">' + expiring.map((x) => {
        const left = daysUntil(x.expiry_date, t);
        const pill = left < 0 ? '<span class="pill bad">Expired ' + plural(Math.abs(left), 'day') + ' ago</span>'
          : '<span class="pill warn">' + plural(left, 'day') + ' left</span>';
        return '<a class="hr-row" href="#/more/hr/' + esc(encodeURIComponent(x.cleaner_id)) + '">'
          + '<span class="hr-txt"><span class="hr-name">' + esc(nameOf(x.cleaner_id)) + '</span>'
          + '<span class="hr-sub">' + esc(docLabel(x.doc_type)) + ' · expires ' + esc(x.expiry_date) + '</span></span>' + pill + '</a>';
      }).join('') + '</div>');
    }

    h += sec('team', 'Team', String(employees.length), employees.length
      ? '<div class="hr-list">' + employees.map((e) => '<a class="hr-row" href="#/more/hr/' + esc(encodeURIComponent(e.cleaner_id)) + '">'
        + '<span class="hr-txt"><span class="hr-name">' + esc(nameOf(e.cleaner_id))
        + (onLeaveToday(e.cleaner_id) ? ' <span class="pill idle">On leave</span>' : '') + '</span>'
        + '<span class="hr-sub">' + esc(e.job_title || 'Employee') + ' · since ' + esc(e.hire_date)
        + (e.end_date ? ' · left ' + esc(e.end_date) : '') + '</span></span>'
        + '<span class="hr-bal"><span class="hr-bal-n" data-balance>' + esc(balance(e)) + '</span><span class="hr-sub">days left</span></span></a>').join('') + '</div>'
      : '<p class="empty pad">No employee record yet.</p>');

    const known = new Set(employees.map((e) => String(e.cleaner_id)));
    const missing = st.team.filter((c) => c.active !== false && (c.role || 'cleaner') !== 'subcontractor' && !known.has(String(c.id)));
    if (missing.length) {
      h += sec('missing', 'Not set up yet', String(missing.length), '<div class="hr-list">' + missing.map((c) => '<a class="hr-row" href="#/more/hr/' + esc(encodeURIComponent(c.id)) + '">'
        + '<span class="hr-txt"><span class="hr-name">' + esc(c.name) + '</span><span class="hr-sub">' + esc(ROLE_LABEL[c.role] || c.role || 'Cleaner') + '</span></span>'
        + '<span class="hr-go">Set up</span></a>').join('') + '</div>');
    }

    // Pas de plafond, comme hr.js : un ferie enregistre mais absent passerait pour un echec.
    const hol = hrUpcomingHolidays(d.holidays || [], t, 999);
    const owner = !!d.isOwner;
    const year = Number(t.slice(0, 4));
    h += sec('holidays', 'Public holidays', String(hol.length), (hol.length
      ? '<div class="hr-list">' + hol.map((x) => '<div class="hr-row ro" data-holiday="' + esc(x.id) + '">'
        + '<span class="hr-txt"><span class="hr-name">' + esc(x.name) + '</span><span class="hr-sub">' + esc(x.holiday_date) + '</span></span>'
        + (owner ? '<button class="btn hr-del" type="button" data-del-holiday="' + esc(x.id) + '" aria-label="Delete ' + esc(x.name) + '">Delete</button>' : '')
        + '</div>').join('') + '</div>'
      : '<p class="empty pad">No upcoming public holiday on file.</p>')
      + '<div class="hr-form">'
      + '<div class="tm-fl"><label for="hrHolDate">Date</label><input id="hrHolDate" type="date" min="' + esc(t) + '" max="' + (year + 1) + '-12-31"></div>'
      + '<div class="tm-fl"><label for="hrHolName">Name</label><input id="hrHolName" type="text" maxlength="120" autocomplete="off" placeholder="Eid Al Fitr"></div>'
      + (st.formErr ? '<p class="hr-err" role="alert">' + esc(st.formErr) + '</p>' : '')
      + '<div class="hr-actions"><button class="btn primary" type="button" data-add-holiday' + (st.formBusy ? ' disabled' : '') + '>Add holiday</button></div>'
      + '</div>');

    // Le formulaire garde sa saisie d'un rendu a l'autre.
    const keep = { date: val('hrHolDate'), name: val('hrHolName') };
    main.innerHTML = header() + '<div class="hr-page">' + h + '</div>';
    setVal('hrHolDate', keep.date);
    setVal('hrHolName', keep.name);
  }

  const val = (id) => { const el = document.getElementById(id); return el ? String(el.value).trim() : ''; };
  const setVal = (id, v) => { const el = document.getElementById(id); if (el && v) el.value = v; };

  function paintLoading() { main.innerHTML = header() + '<div class="ph"><p role="status">Loading HR...</p></div>'; }
  function paintError(msg) {
    main.innerHTML = header() + '<div class="err-card"><p role="alert">' + esc(msg) + '</p>'
      + '<button class="btn primary" type="button" data-retry>Retry</button></div>';
  }

  async function load(quiet, afterWrite) {
    if (!quiet) paintLoading();
    try {
      const [d, team] = await Promise.all([get('hrOverview'), get('mgr.team')]);
      if (!ctx.isCurrent()) return;
      st.data = d;
      st.team = Array.isArray(team && team.members) ? team.members : [];
      paint();
    } catch (e) {
      if (!ctx.isCurrent() || handleAccess(e)) return;
      if (afterWrite) {
        toast('Saved, but HR could not be refreshed.');
        paintError(e.message || 'Could not load HR.');
      } else if (!quiet || !st.data) paintError(e.message || 'Could not load HR.');
    }
  }

  // ---- decisions ----
  async function decide(id, body, okMsg) {
    st.busy.add(id);
    st.errs.delete(id);
    paint();
    try {
      await post('hrDecideLeave', body);
    } catch (e) {
      st.busy.delete(id);
      if (!ctx.isCurrent() || handleAccess(e)) return false;
      st.errs.set(id, (e && e.message) || 'Something went wrong. Try again.');
      paint();
      return false;
    }
    st.busy.delete(id);
    if (!ctx.isCurrent()) return true;
    toast(okMsg);
    await load(true, true);
    return true;
  }

  async function onApprove(id) {
    if (st.busy.has(id)) return;
    const sig = await askSignature('Manager signature to approve');
    if (!sig || !ctx.isCurrent()) return;
    decide(id, { id: Number(id), decision: 'approved', note: '', manager_signature: sig }, 'Leave approved');
  }

  const head = (title, sub) => '<div class="sheet-h"><div><h2 id="sheetTitle">' + esc(title) + '</h2>'
    + (sub ? '<div class="sub">' + esc(sub) + '</div>' : '') + '</div>'
    + '<button class="iconbtn x" type="button" data-close aria-label="Close">' + I.close + '</button></div>';

  function onReject(id) {
    const r = (st.data.pending || []).find((x) => String(x.id) === id);
    if (!r || st.busy.has(id)) return;
    st.sheet = { kind: 'reject', id };
    openSheet(head('Reject this request?', nameOf(r.cleaner_id) + ' · ' + r.start_date + ' to ' + r.end_date)
      + '<div class="sheet-b"><div class="tm-fl"><label for="hrNote">Note (optional)</label>'
      + '<textarea id="hrNote" class="hr-note" maxlength="500" rows="3"></textarea></div></div>'
      + '<div class="sheet-f"><button class="btn danger" type="button" data-sheet-reject>Reject</button>'
      + '<button class="btn" type="button" data-sheet-cancel>Cancel</button></div>');
  }

  // Ecriture lancee depuis le panneau : erreur du serveur dans le panneau, qui reste ouvert.
  async function sheetRun(fn, okMsg) {
    if (st.sheetBusy) return;
    st.sheetBusy = true;
    sheetBusy(true);
    try {
      await fn();
    } catch (e) {
      st.sheetBusy = false;
      sheetBusy(false);
      if (!ctx.isCurrent() || handleAccess(e)) return;
      sheetError((e && e.message) || 'Something went wrong. Try again.');
      return;
    }
    st.sheetBusy = false;
    sheetBusy(false);
    st.sheet = null;
    closeSheet();
    if (!ctx.isCurrent()) return;
    toast(okMsg);
    await load(true, true);
  }

  function onSheetReject() {
    const s = st.sheet;
    if (!s || s.kind !== 'reject') return;
    const note = val('hrNote');
    sheetRun(() => post('hrDecideLeave', { id: Number(s.id), decision: 'rejected', note }), 'Leave rejected');
  }

  function onDeleteHoliday(id) {
    const x = (st.data.holidays || []).find((h) => String(h.id) === id);
    if (!x) return;
    st.sheet = { kind: 'holiday', id };
    openSheet(head('Delete this public holiday?', '')
      + '<div class="sheet-b"><p class="tm-confirm">' + esc(x.name) + ' · ' + esc(x.holiday_date) + '</p></div>'
      + '<div class="sheet-f"><button class="btn danger" type="button" data-sheet-delete>Delete</button>'
      + '<button class="btn" type="button" data-sheet-cancel>Cancel</button></div>');
  }

  function onSheetDelete() {
    const s = st.sheet;
    if (!s || s.kind !== 'holiday') return;
    sheetRun(() => post('hrDeleteHoliday', { id: Number(s.id) }), 'Holiday deleted');
  }

  // Memes bornes que hrSaveHolidayUI : hors [aujourd'hui, 31/12 de l'an prochain], le
  // ferie serait enregistre puis invisible partout.
  async function onAddHoliday() {
    if (st.formBusy) return;
    const date = val('hrHolDate');
    const name = val('hrHolName');
    const t = today();
    const next = Number(t.slice(0, 4)) + 1;
    let bad = '';
    if (!date || !name) bad = 'Pick a date and a name.';
    else if (date < t) bad = 'This date is in the past. Check the year (' + date.slice(0, 4) + ').';
    else if (date > next + '-12-31') bad = 'Too far ahead. Only ' + t.slice(0, 4) + ' and ' + next + ' can be encoded.';
    st.formErr = bad;
    if (bad) { paint(); return; }
    st.formBusy = true;
    paint();
    try {
      await post('hrSaveHoliday', { holiday_date: date, name });
    } catch (e) {
      st.formBusy = false;
      if (!ctx.isCurrent() || handleAccess(e)) return;
      st.formErr = (e && e.message) || 'Could not save the holiday.';
      paint();
      return;
    }
    st.formBusy = false;
    if (!ctx.isCurrent()) return;
    const d = document.getElementById('hrHolDate'); if (d) d.value = '';
    const n = document.getElementById('hrHolName'); if (n) n.value = '';
    toast('Holiday saved');
    await load(true, true);
  }

  // Le lien signe vit 60 s : onglet ouvert pendant le geste (sinon bloque), rempli ensuite.
  async function onForm(id) {
    if (st.busy.has(id)) return;
    const w = window.open('', '_blank');
    st.busy.add(id);
    st.errs.delete(id);
    paint();
    try {
      const r = await get('hrLeaveForm', { id: Number(id) });
      if (!r || !r.url) throw new Error('No download link returned.');
      if (w) { try { w.opener = null; } catch (e) { /* onglet sans opener */ } w.location.href = r.url; }
      else window.location.href = r.url;
    } catch (e) {
      if (w) try { w.close(); } catch (err) { /* deja ferme */ }
      if (!ctx.isCurrent() || handleAccess(e)) { st.busy.delete(id); return; }
      st.errs.set(id, (e && e.message) || 'Could not download the form.');
    }
    st.busy.delete(id);
    if (ctx.isCurrent()) paint();
  }

  const onClick = (e) => {
    if (!ctx.isCurrent()) return;
    const t = e.target && e.target.closest ? e.target.closest('button') : null;
    if (!t || t.disabled) return;
    if (t.closest('#sheet')) {
      if (t.hasAttribute('data-sheet-reject')) onSheetReject();
      else if (t.hasAttribute('data-sheet-delete')) onSheetDelete();
      else if (t.hasAttribute('data-sheet-cancel')) { st.sheet = null; closeSheet(); }
      return;
    }
    if (!main.contains(t)) return;
    if (t.hasAttribute('data-retry')) load();
    else if (t.hasAttribute('data-approve')) onApprove(t.getAttribute('data-approve'));
    else if (t.hasAttribute('data-reject')) onReject(t.getAttribute('data-reject'));
    else if (t.hasAttribute('data-form')) onForm(t.getAttribute('data-form'));
    else if (t.hasAttribute('data-del-holiday')) onDeleteHoliday(t.getAttribute('data-del-holiday'));
    else if (t.hasAttribute('data-add-holiday')) onAddHoliday();
  };
  document.addEventListener('click', onClick);
  ctx.onLeave(() => {
    document.removeEventListener('click', onClick);
    if (st.sheet && sheetIsOpen()) closeSheet();
    st.sheet = null;
  });

  await load();
}
