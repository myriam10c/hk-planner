// More > HR > fiche employe (#/more/hr/<cleanerId>), memes sections que renderHRDetail de hr.js :
// soldes, dossier, poser un conge, historique, documents, remuneration et fin de service
// (proprietaire seulement), suppression du dossier (proprietaire).
// Lecture : hrOverview + mgr.team (noms, roles) ; hrGetCompensation seulement si isOwner.
// Ecritures : hrSaveEmployee, hrDeleteEmployee, hrSubmitLeave, hrCancelLeave, hrSaveDocument,
// hrDeleteDocument, hrLeaveForm. Le serveur reste juge : les actions proprietaire sont
// seulement masquees quand isOwner est faux, et il recalcule toujours le nombre de jours.
import { get, post } from '/manager/api.js';
import { closeSheet, esc, I, openSheet, sheetBusy, sheetError, sheetIsOpen, toast } from '/manager/ui/dom.js';
import { HR_DOC_TYPES, HR_LEAVE_TYPES, accruedAnnualDays, daysUntil, gratuityEstimate, hrSplitHistory, leaveDays, sickTiers } from '/manager/hr-rules.js';
import { accessHandler, docLabel, head, plural, sec, typeLabel } from '/manager/screens/more-hr.js';

const STATUS = { pending: ['Pending', 'warn'], approved: ['Approved', 'ok'], rejected: ['Rejected', 'bad'], cancelled: ['Cancelled', 'idle'] };

const statRow = (key, label, value) => '<div class="hr-stat"><span>' + esc(label) + '</span><b data-stat="' + key + '">' + esc(value) + '</b></div>';
// Champ de formulaire ; data-f indique le formulaire, pour garder ou vider sa saisie au rendu.
const field = (form, id, label, input) => '<div class="tm-fl"><label for="' + id + '">' + esc(label) + '</label>'
  + input.replace('<input', '<input id="' + id + '" data-f="' + form + '"').replace('<select', '<select id="' + id + '" data-f="' + form + '"')
    .replace('<textarea', '<textarea id="' + id + '" data-f="' + form + '"') + '</div>';
const attr = (v) => esc(v == null ? '' : v);
const typeOptions = (list, cur) => list.map((t) => '<option value="' + t.key + '"' + (t.key === cur ? ' selected' : '') + '>' + esc(t.label) + '</option>').join('');

export async function renderHrDetail(ctx, rawId) {
  const main = ctx.main;
  const cid = Number(rawId);
  const handleAccess = accessHandler(ctx);
  const st = {
    data: null, team: [], busy: new Set(), errs: new Map(), sheet: null, sheetBusy: false,
    // Remuneration du dossier ouvert ; stamp = updated_at du dossier au chargement (garde anti-course).
    comp: { state: 'idle', data: null, err: '', stamp: null, req: 0 },
  };

  const member = () => st.team.find((x) => Number(x.id) === cid) || null;
  const employee = () => ((st.data && st.data.employees) || []).find((e) => Number(e.cleaner_id) === cid) || null;
  const today = () => (st.data && st.data.today) || '';
  const nameOf = () => { const c = member(); return c ? c.name : '#' + rawId; };
  const val = (id) => { const el = document.getElementById(id); return el ? String(el.value).trim() : ''; };
  const errLine = (key) => (st.errs.get(key) ? '<p class="hr-err" role="alert">' + esc(st.errs.get(key)) + '</p>' : '');
  const dis = (key) => (st.busy.has(key) ? ' disabled' : '');

  function header(name) {
    return '<header class="top"><div><a class="more-back" href="#/more/hr">' + I.prev + '<span>HR and leave</span></a>'
      + '<h1>' + esc(name) + '</h1></div></header>';
  }

  // ---- sections ----
  function balances(e) {
    const taken = ((st.data && st.data.taken) || {})[String(cid)] || {};
    const asOf = e.end_date && e.end_date < today() ? e.end_date : today();
    const accrued = accruedAnnualDays(e.hire_date, asOf, e.opening_annual_days, e.opening_date);
    const used = Number(taken.annual || 0);
    const sick = sickTiers(Number(taken.sick || 0));
    return sec('balances', 'Balances', '', '<div class="hr-stats">'
      + statRow('accrued', 'Annual accrued', accrued)
      + statRow('taken', 'Annual taken', used)
      + statRow('left', 'Annual left', Math.round((accrued - used) * 100) / 100)
      + statRow('sick', 'Sick used (full / half / unpaid)', sick.full + ' / ' + sick.half + ' / ' + sick.unpaid)
      + statRow('sickLeft', 'Sick left this service year', sick.remaining)
      + statRow('unpaid', 'Unpaid days taken', Number(taken.unpaid || 0))
      + '</div>');
  }

  function record(e) {
    const owner = !!st.data.isOwner;
    return sec('record', e ? 'Employee record' : 'Create employee record', '', '<div class="hr-form">'
      + field('rec', 'hrHireDate', 'Hire date', '<input type="date" value="' + attr(e && e.hire_date) + '">')
      + field('rec', 'hrJobTitle', 'Job title', '<input type="text" maxlength="120" autocomplete="off" placeholder="Housekeeper" value="' + attr(e && e.job_title) + '">')
      + field('rec', 'hrNationality', 'Nationality', '<input type="text" maxlength="80" autocomplete="off" placeholder="Philippines" value="' + attr(e && e.nationality) + '">')
      + field('rec', 'hrOpeningDays', 'Opening annual balance (days)', '<input type="number" step="0.5" inputmode="decimal" value="' + attr((e && e.opening_annual_days) || 0) + '">')
      + field('rec', 'hrOpeningDate', 'Opening balance date', '<input type="date" value="' + attr(e && e.opening_date) + '">')
      + field('rec', 'hrEndDate', 'End of service date (leave empty if active)', '<input type="date" value="' + attr(e && e.end_date) + '">')
      + field('rec', 'hrNotes', 'Notes', '<textarea class="hr-note" rows="2" maxlength="2000">' + attr(e && e.notes) + '</textarea>')
      + errLine('rec')
      + '<div class="hr-actions"><button class="btn primary" type="button" data-save-rec' + dis('rec') + '>' + (e ? 'Save' : 'Create') + '</button>'
      + (e && owner ? '<button class="btn danger" type="button" data-del-rec>Delete record</button>' : '')
      + '</div></div>');
  }

  function book() {
    return sec('book', 'Book leave', '', '<div class="hr-form">'
      + field('leave', 'hrNewType', 'Type', '<select>' + typeOptions(HR_LEAVE_TYPES, 'annual') + '</select>')
      + field('leave', 'hrNewStart', 'From', '<input type="date">')
      + field('leave', 'hrNewEnd', 'To', '<input type="date">')
      + field('leave', 'hrNewReason', 'Reason (optional)', '<input type="text" maxlength="500" autocomplete="off" placeholder="Family trip">')
      + '<p class="hr-sub" data-leave-preview aria-live="polite"></p>'
      + errLine('leave')
      + '<div class="hr-actions"><button class="btn primary" type="button" data-submit-leave' + dis('leave') + '>Submit request</button></div>'
      + '</div>');
  }

  // Apercu seulement : le serveur recalcule les jours a l'enregistrement.
  function previewText() {
    const s = val('hrNewStart');
    const e = val('hrNewEnd');
    const d = s && e ? leaveDays(s, e) : 0;
    if (!d) return '';
    const hol = ((st.data && st.data.holidays) || []).filter((h) => h && h.holiday_date >= s && h.holiday_date <= e)
      .sort((a, b) => (a.holiday_date < b.holiday_date ? -1 : 1));
    return plural(d, 'day') + ', weekends included.'
      + (hol.length ? ' Public holiday' + (hol.length > 1 ? 's' : '') + ' in range: '
        + hol.map((h) => h.name + ' (' + h.holiday_date + ')').join(', ') + '.' : '');
  }
  function updatePreview() {
    const el = main.querySelector('[data-leave-preview]');
    if (el) el.textContent = previewText();
  }

  function leaveRow(r) {
    const id = String(r.id);
    const days = Number(r.days || 0);
    const s = STATUS[r.status] || [String(r.status || ''), 'idle'];
    const owner = !!st.data.isOwner;
    const canCancel = owner && (r.status === 'pending' || r.status === 'approved') && r.end_date >= today();
    const busy = st.busy.has('form:' + id);
    return '<article class="hr-req" data-leave="' + esc(id) + '">'
      + '<div class="hr-line"><span class="hr-name">' + esc(typeLabel(r.leave_type)) + '</span><span class="pill ' + s[1] + '">' + esc(s[0]) + '</span></div>'
      + '<div class="hr-sub">' + esc(r.start_date) + ' to ' + esc(r.end_date) + ' · ' + plural(days, 'day') + '</div>'
      + (r.reason ? '<div class="hr-sub">"' + esc(r.reason) + '"</div>' : '')
      + (r.decided_by ? '<div class="hr-sub">' + esc(s[0]) + ' by ' + esc(r.decided_by)
        + (r.decided_at ? ' on ' + esc(String(r.decided_at).slice(0, 10)) : '') + '</div>' : '')
      + errLine('form:' + id)
      + (canCancel || r.status !== 'cancelled' ? '<div class="hr-actions">'
        + (canCancel ? '<button class="btn" type="button" data-cancel-leave="' + esc(id) + '">Cancel this leave</button>' : '')
        + (r.status !== 'cancelled' ? '<button class="btn" type="button" data-form="' + esc(id) + '"' + (busy ? ' disabled' : '') + '>Download form</button>' : '')
        + '</div>' : '')
      + '</article>';
  }

  function history() {
    const split = hrSplitHistory(st.data.history || [], cid, today());
    const body = !split.active.length && !split.past.length
      ? '<p class="empty pad">No leave request yet.</p>'
      : '<div class="hr-list">' + split.active.map(leaveRow).join('')
        + (split.past.length ? '<p class="hr-past">Past and closed</p>' + split.past.map(leaveRow).join('') : '') + '</div>';
    return sec('history', 'Leave history', '', body);
  }

  function documents() {
    const docs = (st.data.documents || []).filter((d) => Number(d.cleaner_id) === cid);
    const rows = docs.map((d) => {
      const left = daysUntil(d.expiry_date, today());
      const pill = left === null ? ''
        : left < 0 ? '<span class="pill bad">Expired</span>'
          : '<span class="pill ' + (left <= 60 ? 'warn' : 'ok') + '">' + plural(left, 'day') + ' left</span>';
      const label = docLabel(d.doc_type);
      return '<article class="hr-req" data-doc="' + esc(d.id) + '">'
        + '<div class="hr-line"><span class="hr-name">' + esc(label) + '</span>' + pill + '</div>'
        + '<div class="hr-sub">' + (d.doc_number ? esc(d.doc_number) + ' · ' : '')
        + (d.expiry_date ? 'expires ' + esc(d.expiry_date) : 'no expiry') + (d.note ? ' · ' + esc(d.note) : '') + '</div>'
        + '<div class="hr-actions"><button class="btn" type="button" data-edit-doc="' + esc(d.id) + '" aria-label="Edit ' + esc(label) + '">Edit</button>'
        + '<button class="btn" type="button" data-del-doc="' + esc(d.id) + '" aria-label="Delete ' + esc(label) + '">Delete</button></div>'
        + '</article>';
    }).join('');
    return sec('docs', 'Documents', docs.length ? String(docs.length) : '', (docs.length ? '<div class="hr-list">' + rows + '</div>' : '<p class="empty pad">No document on file.</p>')
      + '<div class="hr-form"><div class="hr-actions"><button class="btn" type="button" data-add-doc>Add document</button></div></div>');
  }

  function compensation(e) {
    const c = st.comp;
    let body = '';
    if (c.state === 'error') {
      // Montants inconnus : pas de formulaire, il ecraserait le salaire par des vides.
      body = '<p class="hr-err pad" role="alert">Could not load compensation data: ' + esc(c.err) + '</p>'
        + '<div class="hr-form"><div class="hr-actions"><button class="btn" type="button" data-comp-retry>Retry</button></div></div>';
    } else if (c.state !== 'ready') {
      body = errLine('comp').replace('hr-err', 'hr-err pad') + '<p class="empty pad" role="status">Loading compensation...</p>';
    } else {
      const d = c.data;
      const money = (k) => (d[k] != null ? d[k] : '');
      const total = Number(d.total || 0);
      body = '<div class="hr-form">'
        + field('comp', 'hrBasic', 'Basic salary (AED / month)', '<input type="number" step="1" min="0" inputmode="numeric" value="' + attr(money('basic_salary')) + '">')
        + field('comp', 'hrHousing', 'Housing allowance', '<input type="number" step="1" min="0" inputmode="numeric" value="' + attr(money('housing_allowance')) + '">')
        + field('comp', 'hrTransport', 'Transport allowance', '<input type="number" step="1" min="0" inputmode="numeric" value="' + attr(money('transport_allowance')) + '">')
        + field('comp', 'hrOther', 'Other allowance', '<input type="number" step="1" min="0" inputmode="numeric" value="' + attr(money('other_allowance')) + '">')
        + errLine('comp')
        + '<div class="hr-actions"><button class="btn primary" type="button" data-save-comp' + dis('comp') + '>Save compensation</button></div>'
        + '</div><div class="hr-stats">'
        + statRow('total', 'Total package', total + ' AED')
        + statRow('basicShare', 'Basic share', (total ? Math.round((Number(d.basic_salary || 0) / total) * 100) : 0) + '%')
        + '</div>';
    }
    let h = sec('comp', 'Compensation', 'CEO only', body);
    // Estimation rendue seulement sur des montants charges pour ce dossier : sinon
    // « 0 AED » se lirait comme un vrai montant.
    if (c.state === 'ready') {
      const d = c.data;
      const g = gratuityEstimate(e.hire_date, e.end_date || today(), d.basic_salary, d.unpaid_days || 0);
      h += sec('gratuity', 'End of service estimate', '', '<div class="hr-stats">'
        + statRow('serviceYears', 'Service years' + (e.end_date ? '' : ' if leaving today'), g.years)
        + statRow('gratuityDays', 'Gratuity days', g.days)
        + statRow('gratuityUnpaid', 'Unpaid leave deducted', (d.unpaid_days || 0) + ' days')
        + statRow('gratuity', 'Estimated gratuity', g.amount + ' AED')
        + '</div><p class="hr-msg">Indicative only, based on basic salary. Confirm with the PRO before any settlement.</p>');
    }
    return h;
  }

  // reset : formulaires dont la saisie repart des donnees du serveur (apres une ecriture).
  function paint(reset) {
    if (!ctx.isCurrent() || !st.data) return;
    const drop = new Set(reset || []);
    const keep = new Map();
    main.querySelectorAll('[data-f]').forEach((el) => { if (!drop.has(el.getAttribute('data-f'))) keep.set(el.id, el.value); });
    const c = member();
    const e = employee();
    let h;
    if (c && c.role === 'subcontractor') {
      h = '<section class="card"><p class="hr-msg">Subcontractors have no HR record.</p></section>';
    } else {
      h = (e ? balances(e) : '') + record(e);
      if (e) {
        h += book() + history() + documents();
        if (st.data.isOwner) h += compensation(e);
      }
    }
    main.innerHTML = header(nameOf()) + '<div class="hr-page">' + h + '</div>';
    keep.forEach((v, id) => { const el = document.getElementById(id); if (el) el.value = v; });
    updatePreview();
  }

  function paintLoading() { main.innerHTML = header(nameOf()) + '<div class="ph"><p role="status">Loading HR...</p></div>'; }
  function paintError(msg) {
    main.innerHTML = header(nameOf()) + '<div class="err-card"><p role="alert">' + esc(msg) + '</p>'
      + '<button class="btn primary" type="button" data-retry>Retry</button></div>';
  }

  async function load(quiet, afterWrite, reset) {
    if (!quiet) paintLoading();
    try {
      const [d, team] = await Promise.all([get('hrOverview'), get('mgr.team')]);
      if (!ctx.isCurrent()) return;
      st.data = d;
      st.team = Array.isArray(team && team.members) ? team.members : [];
      paint(reset);
      syncComp();
    } catch (e) {
      if (!ctx.isCurrent() || handleAccess(e)) return;
      if (afterWrite) {
        toast('Saved, but HR could not be refreshed.');
        paintError(e.message || 'Could not load HR.');
      } else if (!quiet || !st.data) paintError(e.message || 'Could not load HR.');
    }
  }

  // ---- remuneration (proprietaire) ----
  // Recharge si rien n'est charge pour ce dossier ou si le dossier a change depuis.
  function syncComp() {
    const e = employee();
    if (!st.data.isOwner || !e) return;
    if (st.comp.state === 'ready' && st.comp.stamp === (e.updated_at || null)) return;
    loadComp();
  }

  async function loadComp() {
    const reqId = ++st.comp.req;
    const e = employee();
    const stamp = (e && e.updated_at) || null;
    st.comp.state = 'loading'; st.comp.data = null; st.comp.err = ''; st.comp.stamp = null;
    paint();
    try {
      const r = await get('hrGetCompensation', { cleaner_id: cid });
      if (reqId !== st.comp.req || !ctx.isCurrent()) return;
      const c = r && r.compensation;
      if (!c) throw new Error('Failed to load compensation');
      // Le serveur a repondu pour quelqu'un d'autre : rien ne s'affiche.
      if (c.cleaner_id != null && Number(c.cleaner_id) !== cid) throw new Error('Compensation data did not match the selected employee');
      st.comp.state = 'ready'; st.comp.data = c; st.comp.stamp = stamp;
    } catch (err) {
      if (reqId !== st.comp.req || !ctx.isCurrent() || handleAccess(err)) return;
      st.comp.state = 'error'; st.comp.err = (err && err.message) || 'Failed to load compensation';
    }
    paint(['comp']);
  }

  // Comme hrSaveComp de hr.js : hrSaveEmployee re-poste le dossier complet avec les montants.
  // Garde anti-course : montants charges pour CE dossier, puis relecture du dossier juste avant
  // l'envoi ; s'il a change depuis le chargement, rien n'est envoye.
  async function onSaveComp() {
    if (st.busy.has('comp')) return;
    const c = st.comp;
    if (c.state !== 'ready' || !c.data) { st.errs.set('comp', 'Compensation data not loaded yet, please wait.'); paint(); return; }
    const num = (id) => { const v = val(id); return v === '' ? null : Number(v); };
    const amounts = { basic_salary: num('hrBasic'), housing_allowance: num('hrHousing'), transport_allowance: num('hrTransport'), other_allowance: num('hrOther') };
    st.busy.add('comp');
    st.errs.delete('comp');
    paint();
    let fresh;
    try {
      fresh = await get('hrOverview');
    } catch (err) {
      st.busy.delete('comp');
      if (!ctx.isCurrent() || handleAccess(err)) return;
      st.errs.set('comp', (err && err.message) || 'Could not check the record. Try again.');
      paint();
      return;
    }
    if (!ctx.isCurrent()) return;
    const e = (fresh.employees || []).find((x) => Number(x.cleaner_id) === cid);
    if (!e || (e.updated_at || null) !== c.stamp) {
      st.busy.delete('comp');
      st.data = fresh;
      st.errs.set('comp', e ? 'This record changed since you opened it. Check the values and save again.' : 'Create the employee record first.');
      paint(['rec', 'comp']);
      syncComp();
      return;
    }
    try {
      await post('hrSaveEmployee', {
        cleaner_id: cid,
        hire_date: e.hire_date,
        end_date: e.end_date || null,
        job_title: e.job_title || null,
        nationality: e.nationality || null,
        opening_annual_days: e.opening_annual_days || 0,
        opening_date: e.opening_date,
        notes: e.notes || null,
        ...amounts,
      });
    } catch (err) {
      st.busy.delete('comp');
      if (!ctx.isCurrent() || handleAccess(err)) return;
      st.errs.set('comp', (err && err.message) || 'Could not save the compensation.');
      paint();
      return;
    }
    st.busy.delete('comp');
    if (!ctx.isCurrent()) return;
    toast('Compensation saved');
    st.comp.state = 'stale';
    await load(true, true, ['comp']);
  }

  // ---- ecritures depuis la page ----
  async function write(key, fn, okMsg, reset) {
    if (st.busy.has(key)) return;
    st.busy.add(key);
    st.errs.delete(key);
    paint();
    try {
      await fn();
    } catch (e) {
      st.busy.delete(key);
      if (!ctx.isCurrent() || handleAccess(e)) return;
      st.errs.set(key, (e && e.message) || 'Something went wrong. Try again.');
      paint();
      return;
    }
    st.busy.delete(key);
    if (!ctx.isCurrent()) return;
    toast(okMsg);
    await load(true, true, reset);
  }

  function onSaveRecord() {
    const hire = val('hrHireDate');
    if (!hire) { st.errs.set('rec', 'Hire date is required.'); paint(); return; }
    const body = {
      cleaner_id: cid, hire_date: hire,
      job_title: val('hrJobTitle') || null,
      nationality: val('hrNationality') || null,
      opening_annual_days: Number(val('hrOpeningDays')) || 0,
      opening_date: val('hrOpeningDate') || hire,
      end_date: val('hrEndDate') || null,
      notes: val('hrNotes') || null,
    };
    write('rec', () => post('hrSaveEmployee', body), 'Employee record saved', ['rec']);
  }

  // Comme hrSubmitLeaveFor de hr.js : pas de signature quand un manager pose le conge
  // d'un autre (le serveur ne la garderait pas) ; le serveur recalcule les jours.
  function onSubmitLeave() {
    if (st.busy.has('leave')) return;
    const start = val('hrNewStart');
    const end = val('hrNewEnd');
    let bad = '';
    if (!start || !end) bad = 'Pick both dates.';
    else if (!leaveDays(start, end)) bad = 'End date must be on or after start date.';
    if (bad) { st.errs.set('leave', bad); paint(); return; }
    st.errs.delete('leave');
    const body = { cleaner_id: cid, leave_type: val('hrNewType') || 'annual', start_date: start, end_date: end, reason: val('hrNewReason') || null };
    write('leave', () => post('hrSubmitLeave', body), 'Request submitted', ['leave']);
  }

  // Lien signe suivi dans le meme onglet, comme hrDownloadForm de hr.js.
  async function onForm(id) {
    const key = 'form:' + id;
    if (st.busy.has(key)) return;
    st.busy.add(key);
    st.errs.delete(key);
    paint();
    try {
      const r = await get('hrLeaveForm', { id: Number(id) });
      if (!r || !r.url) throw new Error('No download link returned.');
      if (ctx.isCurrent()) location.href = r.url;
    } catch (e) {
      if (!ctx.isCurrent() || handleAccess(e)) { st.busy.delete(key); return; }
      st.errs.set(key, (e && e.message) || 'Could not download the form.');
    }
    st.busy.delete(key);
    if (ctx.isCurrent()) paint();
  }

  // ---- panneaux ----
  async function sheetRun(fn, okMsg, after) {
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
    if (after) after();
    else await load(true, true);
  }

  const sheetFoot = (main1, label) => '<div class="sheet-f">' + main1 + '<button class="btn" type="button" data-sheet-dismiss>' + label + '</button></div>';

  function onCancelLeave(id) {
    const r = (st.data.history || []).find((x) => String(x.id) === id);
    if (!r) return;
    st.sheet = { kind: 'cancel', id };
    openSheet(head('Cancel this leave?', typeLabel(r.leave_type) + ' · ' + r.start_date + ' to ' + r.end_date)
      + '<div class="sheet-b"><p class="tm-confirm">' + esc(nameOf()) + ' will be told the leave is cancelled.</p></div>'
      + sheetFoot('<button class="btn danger" type="button" data-sheet-ok>Cancel leave</button>', 'Keep'));
  }

  function onDocSheet(id) {
    const d = id ? (st.data.documents || []).find((x) => String(x.id) === id) : null;
    if (id && !d) return;
    st.sheet = { kind: 'doc', id: id || null };
    const v = (k) => attr(d && d[k]);
    openSheet(head(d ? 'Edit document' : 'Add document', nameOf())
      + '<div class="sheet-b hr-sheet-form">'
      + '<div class="tm-fl"><label for="hrDocType">Type</label><select id="hrDocType">' + typeOptions(HR_DOC_TYPES, d ? d.doc_type : 'passport') + '</select></div>'
      + '<div class="tm-fl"><label for="hrDocNumber">Number</label><input id="hrDocNumber" type="text" maxlength="60" autocomplete="off" placeholder="Optional" value="' + v('doc_number') + '"></div>'
      + '<div class="tm-fl"><label for="hrDocIssue">Issued</label><input id="hrDocIssue" type="date" value="' + v('issue_date') + '"></div>'
      + '<div class="tm-fl"><label for="hrDocExpiry">Expires</label><input id="hrDocExpiry" type="date" value="' + v('expiry_date') + '"></div>'
      + '<div class="tm-fl"><label for="hrDocNote">Note</label><input id="hrDocNote" type="text" maxlength="500" autocomplete="off" placeholder="Optional" value="' + v('note') + '"></div>'
      + '</div>'
      + sheetFoot('<button class="btn primary" type="button" data-sheet-ok>Save document</button>', 'Cancel'));
  }

  function onDelDoc(id) {
    const d = (st.data.documents || []).find((x) => String(x.id) === id);
    if (!d) return;
    st.sheet = { kind: 'delDoc', id };
    openSheet(head('Delete this document?', nameOf())
      + '<div class="sheet-b"><p class="tm-confirm">' + esc(docLabel(d.doc_type)) + (d.expiry_date ? ' · expires ' + esc(d.expiry_date) : '') + '</p></div>'
      + sheetFoot('<button class="btn danger" type="button" data-sheet-ok>Delete</button>', 'Cancel'));
  }

  function onDelRecord() {
    st.sheet = { kind: 'delRec' };
    openSheet(head('Delete HR record?', '')
      + '<div class="sheet-b"><p class="tm-confirm">Delete the HR record of ' + esc(nameOf()) + '? This cannot be undone.</p></div>'
      + sheetFoot('<button class="btn danger" type="button" data-sheet-ok>Delete record</button>', 'Cancel'));
  }

  function onSheetOk() {
    const s = st.sheet;
    if (!s) return;
    if (s.kind === 'cancel') sheetRun(() => post('hrCancelLeave', { id: Number(s.id) }), 'Leave cancelled');
    else if (s.kind === 'delDoc') sheetRun(() => post('hrDeleteDocument', { id: Number(s.id) }), 'Document deleted');
    else if (s.kind === 'delRec') {
      sheetRun(() => post('hrDeleteEmployee', { cleaner_id: cid }), 'Record deleted', () => { location.hash = '#/more/hr'; });
    } else if (s.kind === 'doc') {
      const type = val('hrDocType');
      if (!type) { sheetError('Pick a document type.'); return; }
      const body = {
        ...(s.id ? { id: Number(s.id) } : {}),
        cleaner_id: cid, doc_type: type,
        doc_number: val('hrDocNumber') || null,
        issue_date: val('hrDocIssue') || null,
        expiry_date: val('hrDocExpiry') || null,
        note: val('hrDocNote') || null,
      };
      sheetRun(() => post('hrSaveDocument', body), 'Document saved');
    }
  }

  const onClick = (e) => {
    if (!ctx.isCurrent()) return;
    const t = e.target && e.target.closest ? e.target.closest('button') : null;
    if (!t || t.disabled) return;
    if (t.closest('#sheet')) {
      if (!st.sheet) return;
      if (t.hasAttribute('data-sheet-ok')) onSheetOk();
      else if (t.hasAttribute('data-sheet-dismiss')) { st.sheet = null; closeSheet(); }
      return;
    }
    if (!main.contains(t)) return;
    if (t.hasAttribute('data-retry')) load();
    else if (t.hasAttribute('data-save-rec')) onSaveRecord();
    else if (t.hasAttribute('data-del-rec')) onDelRecord();
    else if (t.hasAttribute('data-submit-leave')) onSubmitLeave();
    else if (t.hasAttribute('data-cancel-leave')) onCancelLeave(t.getAttribute('data-cancel-leave'));
    else if (t.hasAttribute('data-form')) onForm(t.getAttribute('data-form'));
    else if (t.hasAttribute('data-add-doc')) onDocSheet(null);
    else if (t.hasAttribute('data-edit-doc')) onDocSheet(t.getAttribute('data-edit-doc'));
    else if (t.hasAttribute('data-del-doc')) onDelDoc(t.getAttribute('data-del-doc'));
    else if (t.hasAttribute('data-save-comp')) onSaveComp();
    else if (t.hasAttribute('data-comp-retry')) loadComp();
  };
  const onInput = (e) => {
    if (!ctx.isCurrent()) return;
    const id = e.target && e.target.id;
    if (id === 'hrNewStart' || id === 'hrNewEnd') updatePreview();
  };
  document.addEventListener('click', onClick);
  document.addEventListener('input', onInput);
  document.addEventListener('change', onInput);
  ctx.onLeave(() => {
    document.removeEventListener('click', onClick);
    document.removeEventListener('input', onInput);
    document.removeEventListener('change', onInput);
    st.comp.req++;
    if (st.sheet && sheetIsOpen()) closeSheet();
    st.sheet = null;
  });

  await load();
}
