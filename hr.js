// HK Planner - module RH.
// Chargé en <script> classique AVANT app.js : les deux partagent le scope
// global, donc hr.js peut appeler esc()/icon()/api() d'app.js au runtime, et
// app.js peut appeler renderHR() (gardé par un typeof).
//
// Cette première section ne contient que des fonctions PURES : pas de DOM, pas
// de réseau, pas d'état. Elles sont testées telles quelles par tests/hr.spec.ts.

const HR_LEAVE_TYPES = [
  { key: 'annual',      label: 'Annual leave' },
  { key: 'sick',        label: 'Sick leave' },
  { key: 'unpaid',      label: 'Unpaid leave' },
  { key: 'maternity',   label: 'Maternity leave' },
  { key: 'parental',    label: 'Parental leave' },
  { key: 'bereavement', label: 'Bereavement leave' },
  { key: 'hajj',        label: 'Hajj leave' },
  { key: 'other',       label: 'Other' },
];

const HR_DOC_TYPES = [
  { key: 'passport',          label: 'Passport' },
  { key: 'emirates_id',       label: 'Emirates ID' },
  { key: 'visa',              label: 'Residence visa' },
  { key: 'labour_card',       label: 'Labour card' },
  { key: 'medical_insurance', label: 'Medical insurance' },
  { key: 'contract',          label: 'Contract' },
  { key: 'other',             label: 'Other' },
];

// Jours calendaires, bornes incluses. Du 10 au 20 = 11 jours.
function leaveDays(start, end){
  const a = Date.parse(String(start) + 'T00:00:00Z');
  const b = Date.parse(String(end) + 'T00:00:00Z');
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return 0;
  return Math.round((b - a) / 86400000) + 1;
}

// Mois révolus entre deux dates. Le 15/01 -> 14/02 ne fait pas un mois.
function completeMonths(from, to){
  const f = new Date(String(from) + 'T00:00:00Z');
  const t = new Date(String(to) + 'T00:00:00Z');
  if (isNaN(f.getTime()) || isNaN(t.getTime()) || t < f) return 0;
  let m = (t.getUTCFullYear() - f.getUTCFullYear()) * 12 + (t.getUTCMonth() - f.getUTCMonth());
  if (t.getUTCDate() < f.getUTCDate()) m--;
  return Math.max(0, m);
}

// Droit annuel acquis, décret-loi fédéral 33/2021 :
//   - moins de 6 mois d'ancienneté : 0
//   - de 6 à 12 mois : 2 jours par mois révolu
//   - au-dela de 12 mois : 2,5 jours par mois révolu (30 jours par an)
// openingDays/openingDate permettent de reprendre un solde existant : on ne
// calcule alors l'acquis qu'a partir d'openingDate, mais le PALIER dépend de
// l'ancienneté réelle depuis hireDate.
function accruedAnnualDays(hireDate, asOf, openingDays, openingDate){
  const opening = Number(openingDays) || 0;
  const from = openingDate || hireDate;
  const tenureMonths = completeMonths(hireDate, asOf);
  if (tenureMonths < 6) return opening;
  const earnedMonths = completeMonths(from, asOf);
  const rate = tenureMonths >= 12 ? 2.5 : 2;
  return Math.round((opening + earnedMonths * rate) * 100) / 100;
}

// Congé maladie par année de service : 15 jours plein salaire, 30 jours a
// demi-salaire, 45 jours non payés. 90 jours au total.
function sickTiers(daysUsed){
  const d = Math.max(0, Number(daysUsed) || 0);
  return {
    full: Math.min(d, 15),
    half: Math.min(Math.max(d - 15, 0), 30),
    unpaid: Math.min(Math.max(d - 45, 0), 45),
    used: d,
    remaining: Math.max(0, 90 - d),
  };
}

function rangesOverlap(aStart, aEnd, bStart, bEnd){
  return String(aStart) <= String(bEnd) && String(bStart) <= String(aEnd);
}

// Indemnité de fin de service : 21 jours de basic par an sur les 5 premières
// années, 30 jours par an ensuite, plafonnée a 24 mois de basic. Les jours de
// congé non payé ne comptent pas dans l'ancienneté.
function gratuityEstimate(hireDate, endDate, basicSalary, unpaidDays){
  const basic = Number(basicSalary) || 0;
  const a = Date.parse(String(hireDate) + 'T00:00:00Z');
  const b = Date.parse(String(endDate) + 'T00:00:00Z');
  if (!basic || !Number.isFinite(a) || !Number.isFinite(b) || b <= a) {
    return { years: 0, days: 0, amount: 0 };
  }
  const serviceDays = Math.max(0, (b - a) / 86400000 - (Number(unpaidDays) || 0));
  const years = serviceDays / 365;
  if (years < 1) return { years: Math.round(years * 100) / 100, days: 0, amount: 0 };
  const daily = basic / 30;
  const gratDays = Math.min(years, 5) * 21 + Math.max(years - 5, 0) * 30;
  const amount = Math.min(gratDays * daily, 24 * basic);
  return {
    years: Math.round(years * 100) / 100,
    days: Math.round(gratDays * 100) / 100,
    amount: Math.round(amount * 100) / 100,
  };
}

// Jours restants avant une date. Négatif si déja passée, null si vide.
function daysUntil(dateStr, todayStr){
  if (!dateStr) return null;
  const a = Date.parse(String(dateStr) + 'T00:00:00Z');
  const b = Date.parse(String(todayStr || new Date().toISOString().slice(0, 10)) + 'T00:00:00Z');
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.round((a - b) / 86400000);
}

window.HR_LEAVE_TYPES = HR_LEAVE_TYPES;
window.HR_DOC_TYPES = HR_DOC_TYPES;

// ===========================================================================
// Etat du module RH. Volontairement séparé des helpers purs ci-dessus, qui
// restent testables sans DOM ni réseau.
// ===========================================================================

let hrData = null;        // payload de hrOverview ou hrMyLeave
let hrLoading = false;
let hrError = null;
let hrSelected = null;    // cleaner_id du dossier ouvert (vue manager)
let hrSubmitting = false;

function hrIsManager(){
  return !cleanerMode || cleanerMode.role === 'manager';
}

function hrToday(){
  return (hrData && hrData.today) || new Date().toISOString().slice(0, 10);
}

function hrCleanerName(id){
  const c = (typeof cleaners !== 'undefined' ? cleaners : []).find(x => x.id === Number(id));
  return c ? c.name : ('#' + id);
}

function hrTypeLabel(key){
  const t = HR_LEAVE_TYPES.find(x => x.key === key);
  return t ? t.label : key;
}

async function loadHR(){
  if (hrLoading) return;
  hrLoading = true; hrError = null;
  try {
    const r = await api(hrIsManager() ? 'hrOverview' : 'hrMyLeave');
    if (r && r.error) throw new Error(r.error);
    hrData = r;
  } catch (e) {
    hrError = (e && e.message) || 'Failed to load HR data';
    hrData = null;
  } finally {
    hrLoading = false;
    render();
  }
}

function hrRefresh(){
  hrData = null; hrError = null;
  loadHR();
  render();
}

function renderHR(){
  if (hrLoading || (hrData === null && !hrError)) {
    document.getElementById('app').innerHTML =
      '<div class="header"><div class="header-top"><h1>&#x1F464; HR</h1></div></div>' +
      '<div class="container"><div class="loading"><div class="spinner"></div></div></div>' + renderBottomNav();
    return;
  }
  if (hrError) {
    document.getElementById('app').innerHTML =
      '<div class="header"><div class="header-top"><h1>&#x1F464; HR</h1></div></div>' +
      '<div class="container"><div class="hr-empty">' + esc(hrError) +
      ' <button class="btn-secondary" data-action="hrRefresh">Retry</button></div></div>' + renderBottomNav();
    return;
  }
  document.getElementById('app').innerHTML =
    (hrIsManager() ? renderHRManager() : renderHRMine()) + renderBottomNav();
}

// Solde de congés annuels d'un employé : acquis légal moins jours approuvés.
function hrAnnualBalance(emp){
  const taken = ((hrData && hrData.taken) || {})[String(emp.cleaner_id)] || {};
  const asOf = emp.end_date && emp.end_date < hrToday() ? emp.end_date : hrToday();
  const accrued = accruedAnnualDays(emp.hire_date, asOf, emp.opening_annual_days, emp.opening_date);
  const used = Number(taken.annual || 0);
  return { accrued: accrued, used: used, left: Math.round((accrued - used) * 100) / 100 };
}

function hrIsOnLeave(cleanerId, day){
  return ((hrData && hrData.upcoming) || []).some(l =>
    l.cleaner_id === Number(cleanerId) && rangesOverlap(l.start_date, l.end_date, day, day));
}

// Carte HTML d'une demande de congé. withActions ajoute les boutons Approve/Reject.
function hrRequestCard(r, withActions){
  const days = Number(r.days || 0);
  return '<div class="hr-card"><div class="hr-row">' +
    '<div class="hr-grow"><div class="hr-name">' + esc(hrCleanerName(r.cleaner_id)) + '</div>' +
    '<div class="hr-meta">' + esc(hrTypeLabel(r.leave_type)) + ' · ' + esc(r.start_date) + ' to ' + esc(r.end_date) +
    ' · ' + days + ' day' + (days > 1 ? 's' : '') + '</div>' +
    (r.reason ? '<div class="hr-meta">"' + esc(r.reason) + '"</div>' : '') +
    (r.decided_by ? '<div class="hr-meta">' + esc(r.status) + ' by ' + esc(r.decided_by) + '</div>' : '') +
    '</div>' +
    '<span class="hr-badge ' + esc(r.status) + '">' + esc(r.status) + '</span>' +
    '</div>' +
    (withActions ? '<div class="hr-actions">' +
      '<button class="hr-btn-ok" data-action="hrDecide" data-arg0="' + r.id + '" data-arg1="approved">Approve</button>' +
      '<button class="hr-btn-no" data-action="hrDecide" data-arg0="' + r.id + '" data-arg1="rejected">Reject</button>' +
      '</div>' : '') +
    '</div>';
}

function renderHRManager(){
  const today = hrToday();
  const employees = (hrData.employees || []).slice();
  const pending = hrData.pending || [];
  const upcoming = hrData.upcoming || [];
  const known = new Set(employees.map(e => e.cleaner_id));
  const staff = (typeof cleaners !== 'undefined' ? cleaners : [])
    .filter(c => (c.role || 'cleaner') !== 'subcontractor');
  const missing = staff.filter(c => !known.has(c.id));

  let h = '<div class="header"><div class="header-top"><h1>👤 HR</h1>' +
    '<div class="header-actions"><button data-action="hrRefresh" title="Refresh" aria-label="Refresh">' + icon('refresh', 18) + '</button></div></div></div>';
  h += '<div class="container">';

  if (hrSelected) { h += renderHRDetail(hrSelected); h += '</div>'; return h; }

  h += '<div class="hr-section"><h3>Pending requests (' + pending.length + ')</h3>';
  h += pending.length
    ? pending.map(r => hrRequestCard(r, true)).join('')
    : '<div class="hr-empty">Nothing waiting for a decision.</div>';
  h += '</div>';

  const onLeaveNow = upcoming.filter(l => rangesOverlap(l.start_date, l.end_date, today, today));
  if (onLeaveNow.length) {
    h += '<div class="hr-section"><h3>Away today</h3>';
    h += onLeaveNow.map(l => '<div class="hr-card"><div class="hr-row">' +
      '<div class="hr-grow"><div class="hr-name">' + esc(hrCleanerName(l.cleaner_id)) + '</div>' +
      '<div class="hr-meta">Back on ' + esc(new Date(Date.parse(l.end_date + 'T00:00:00Z') + 86400000).toISOString().slice(0, 10)) + '</div></div>' +
      '<span class="hr-badge onleave">on leave</span></div></div>').join('');
    h += '</div>';
  }

  h += '<div class="hr-section"><h3>Team (' + employees.length + ')</h3>';
  employees.forEach(e => {
    const bal = hrAnnualBalance(e);
    const away = hrIsOnLeave(e.cleaner_id, today);
    h += '<div class="hr-card" data-action="hrOpen" data-arg0="' + e.cleaner_id + '" style="cursor:pointer">' +
      '<div class="hr-row"><div class="hr-grow">' +
      '<div class="hr-name">' + esc(hrCleanerName(e.cleaner_id)) + (away ? ' <span class="hr-badge onleave">away</span>' : '') + '</div>' +
      '<div class="hr-meta">' + esc(e.job_title || 'Employee') + ' · since ' + esc(e.hire_date) +
      (e.end_date ? ' · left ' + esc(e.end_date) : '') + '</div></div>' +
      '<div style="text-align:right"><div class="hr-name">' + bal.left + '</div>' +
      '<div class="hr-meta">days left</div></div></div></div>';
  });
  if (!employees.length) h += '<div class="hr-empty">No employee record yet.</div>';
  h += '</div>';

  if (missing.length) {
    h += '<div class="hr-section"><h3>Not set up yet</h3>';
    missing.forEach(c => {
      h += '<div class="hr-card"><div class="hr-row"><div class="hr-grow">' +
        '<div class="hr-name">' + esc(c.name) + '</div><div class="hr-meta">' + esc(c.role || 'cleaner') + '</div></div>' +
        '<button class="hr-btn-alt" style="padding:8px 12px;border:none;border-radius:8px;font-weight:700;cursor:pointer" data-action="hrOpen" data-arg0="' + c.id + '">Set up</button>' +
        '</div></div>';
    });
    h += '</div>';
  }

  h += '</div>';
  return h;
}

// Approuve ou rejette une demande de congé, puis recharge les données RH.
async function hrDecide(id, decision){
  if (hrSubmitting) return;
  hrSubmitting = true;
  try {
    await apiWrite('hrDecideLeave', { body: { id: id, decision: decision } });
    toast('Leave ' + decision, decision === 'approved' ? 'success' : 'info');
    hrData = null;
    await loadHR();
  } catch (e) {
    toast((e && e.message) || 'Failed', 'error');
  } finally {
    hrSubmitting = false;
  }
}

// Ouvre le dossier d'un employé (vue détail, remplacée en Task 9).
function hrOpen(cleanerId){ hrSelected = Number(cleanerId); render(); }
// Ferme le dossier et revient a la liste.
function hrCloseDetail(){ hrSelected = null; render(); }

// Panneau de détail employé : soldes, formulaire d'édition du dossier, saisie
// de congé par le manager, et historique des congés en cours/à venir.
function renderHRDetail(cleanerId){
  const cid = Number(cleanerId);
  const emp = (hrData.employees || []).find(e => e.cleaner_id === cid) || null;
  const taken = ((hrData && hrData.taken) || {})[String(cid)] || {};
  const history = ((hrData.pending || []).concat(hrData.upcoming || []))
    .filter(r => r.cleaner_id === cid)
    .sort((a, b) => (a.start_date < b.start_date ? 1 : -1));

  let h = '<div class="hr-row" style="margin-bottom:12px">' +
    '<button class="hr-btn-alt" style="padding:8px 12px;border:none;border-radius:8px;font-weight:700;cursor:pointer" data-action="hrCloseDetail">' + icon('chevronLeft', 14) + ' Back</button>' +
    '<div class="hr-grow"><div class="hr-name">' + esc(hrCleanerName(cid)) + '</div></div></div>';

  if (emp) {
    const bal = hrAnnualBalance(emp);
    const sick = sickTiers(Number(taken.sick || 0));
    h += '<div class="hr-section"><h3>Balances</h3><div class="hr-card">' +
      '<div class="hr-stat"><span>Annual accrued</span><b>' + bal.accrued + '</b></div>' +
      '<div class="hr-stat"><span>Annual taken</span><b>' + bal.used + '</b></div>' +
      '<div class="hr-stat"><span>Annual left</span><b>' + bal.left + '</b></div>' +
      '<div class="hr-stat"><span>Sick used (full / half / unpaid)</span><b>' + sick.full + ' / ' + sick.half + ' / ' + sick.unpaid + '</b></div>' +
      '<div class="hr-stat"><span>Sick left this service year</span><b>' + sick.remaining + '</b></div>' +
      '<div class="hr-stat"><span>Unpaid days taken</span><b>' + (Number(taken.unpaid || 0)) + '</b></div>' +
      '</div></div>';
  }

  h += '<div class="hr-section"><h3>' + (emp ? 'Employee record' : 'Create employee record') + '</h3><div class="hr-card"><div class="hr-form">' +
    '<input type="hidden" id="hrEmpCleanerId" value="' + cid + '"/>' +
    '<label>Hire date</label><input type="date" id="hrHireDate" value="' + esc((emp && emp.hire_date) || '') + '"/>' +
    '<label>Job title</label><input id="hrJobTitle" value="' + esc((emp && emp.job_title) || '') + '" placeholder="Housekeeper"/>' +
    '<label>Nationality</label><input id="hrNationality" value="' + esc((emp && emp.nationality) || '') + '" placeholder="Philippines"/>' +
    '<label>Opening annual balance (days)</label><input type="number" step="0.5" id="hrOpeningDays" value="' + ((emp && emp.opening_annual_days) || 0) + '"/>' +
    '<label>Opening balance date</label><input type="date" id="hrOpeningDate" value="' + esc((emp && emp.opening_date) || '') + '"/>' +
    '<label>End of service date (leave empty if active)</label><input type="date" id="hrEndDate" value="' + esc((emp && emp.end_date) || '') + '"/>' +
    '<label>Notes</label><textarea id="hrNotes" rows="2">' + esc((emp && emp.notes) || '') + '</textarea>' +
    '</div><div class="hr-actions">' +
    '<button class="hr-btn-ok" data-action="hrSaveEmployee">' + (emp ? 'Save' : 'Create') + '</button>' +
    (emp && hrData.isOwner ? '<button class="hr-btn-no" data-action="hrDeleteEmployeeRecord" data-arg0="' + cid + '">Delete record</button>' : '') +
    '</div></div></div>';

  if (emp) {
    h += '<div class="hr-section"><h3>Book leave for this person</h3><div class="hr-card"><div class="hr-form">' +
      '<label>Type</label><select id="hrNewType">' +
      HR_LEAVE_TYPES.map(t => '<option value="' + t.key + '">' + esc(t.label) + '</option>').join('') + '</select>' +
      '<label>From</label><input type="date" id="hrNewStart"/>' +
      '<label>To</label><input type="date" id="hrNewEnd"/>' +
      '<label>Reason (optional)</label><input id="hrNewReason" placeholder="Family trip"/>' +
      '</div><div class="hr-actions">' +
      '<button class="hr-btn-ok" data-action="hrSubmitLeaveFor" data-arg0="' + cid + '">Submit request</button>' +
      '</div></div></div>';

    h += '<div class="hr-section"><h3>Current and upcoming leave</h3>';
    h += history.length
      ? history.map(r => hrRequestCard(r, false) +
          (r.status === 'pending' || r.status === 'approved'
            ? '<div class="hr-actions" style="margin-top:-4px;margin-bottom:8px"><button class="hr-btn-alt" data-action="hrCancelRequest" data-arg0="' + r.id + '">Cancel this leave</button></div>'
            : '')).join('')
      : '<div class="hr-empty">Nothing planned.</div>';
    h += '</div>';
  }

  return h;
}

// Lit la valeur d'un champ formulaire par son id.
function hrVal(id){ const el = document.getElementById(id); return el ? el.value.trim() : ''; }

// Sauvegarde (création ou mise à jour) du dossier employé via hrSaveEmployee.
async function hrSaveEmployee(){
  if (hrSubmitting) return;
  const cid = Number(hrVal('hrEmpCleanerId'));
  const hire = hrVal('hrHireDate');
  if (!hire) { toast('Hire date is required', 'error'); return; }
  hrSubmitting = true;
  try {
    await apiWrite('hrSaveEmployee', { body: {
      cleaner_id: cid, hire_date: hire,
      job_title: hrVal('hrJobTitle') || null,
      nationality: hrVal('hrNationality') || null,
      opening_annual_days: Number(hrVal('hrOpeningDays')) || 0,
      opening_date: hrVal('hrOpeningDate') || hire,
      end_date: hrVal('hrEndDate') || null,
      notes: hrVal('hrNotes') || null,
    }});
    toast('Employee record saved', 'success');
    hrData = null;
    await loadHR();
  } catch (e) {
    toast((e && e.message) || 'Failed to save', 'error');
  } finally {
    hrSubmitting = false;
  }
}

// Supprime le dossier employé (owner uniquement). Demande confirmation.
async function hrDeleteEmployeeRecord(cleanerId){
  if (!confirm('Delete the HR record of ' + hrCleanerName(cleanerId) + '? This cannot be undone.')) return;
  try {
    await apiWrite('hrDeleteEmployee', { body: { cleaner_id: Number(cleanerId) } });
    toast('Record deleted', 'success');
    hrSelected = null; hrData = null;
    await loadHR();
  } catch (e) {
    toast((e && e.message) || 'Failed to delete', 'error');
  }
}

// Soumet une demande de congé pour un autre membre de l'équipe (manager).
async function hrSubmitLeaveFor(cleanerId){
  if (hrSubmitting) return;
  const start = hrVal('hrNewStart'), end = hrVal('hrNewEnd');
  if (!start || !end) { toast('Pick both dates', 'error'); return; }
  if (!leaveDays(start, end)) { toast('End date must be on or after start date', 'error'); return; }
  hrSubmitting = true;
  try {
    await apiWrite('hrSubmitLeave', { body: {
      cleaner_id: Number(cleanerId), leave_type: hrVal('hrNewType') || 'annual',
      start_date: start, end_date: end, reason: hrVal('hrNewReason') || null,
    }});
    toast('Request submitted', 'success');
    hrData = null;
    await loadHR();
  } catch (e) {
    toast((e && e.message) || 'Failed to submit', 'error');
  } finally {
    hrSubmitting = false;
  }
}

// Annule une demande de congé existante. Demande confirmation.
async function hrCancelRequest(id){
  if (!confirm('Cancel this leave?')) return;
  try {
    await apiWrite('hrCancelLeave', { body: { id: Number(id) } });
    toast('Leave cancelled', 'info');
    hrData = null;
    await loadHR();
  } catch (e) {
    toast((e && e.message) || 'Failed to cancel', 'error');
  }
}

function renderHRMine(){
  return '<div class="header"><div class="header-top"><h1>&#x1F334; My leave</h1></div></div>' +
    '<div class="container"><div class="hr-empty">Employee view coming next.</div></div>';
}
