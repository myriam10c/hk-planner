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
// Congés approuvés reçus via getAllData. Ne contiennent que cleaner_id,
// start_date et end_date : le type de congé n'est jamais envoyé aux clients
// non-manager, un arrêt maladie n'a pas a circuler.
// ===========================================================================
let hrApprovedLeaves = [];

function hrSetApprovedLeaves(rows){
  hrApprovedLeaves = Array.isArray(rows) ? rows : [];
}

function hrOnLeaveOn(cleanerId, day){
  if (!day) return false;
  const cid = Number(cleanerId);
  return hrApprovedLeaves.some(l => Number(l.cleaner_id) === cid && l.start_date <= day && l.end_date >= day);
}

// Jour EFFECTIF d'un ménage, pas celui de sa clé. Une prestation reportée garde
// volontairement sa reservation_key figée sur la date d'origine (voir applyPostponements
// dans app.js : assignation, état "fait" et checklist sont indexés dessus), et sa vraie
// date vit dans postponed[key].new_date. Sans cette résolution, un ménage déplacé DANS
// une période de congé échappait au grisage et au filtre de pool de smartAssign.
// `postponed` est la globale d'app.js ; le typeof couvre le cas ou hr.js tourne seul.
function hrDayOfKey(reservationKey){
  const key = String(reservationKey || '');
  const p = (typeof postponed !== 'undefined' && postponed) ? postponed[key] : null;
  if (p && p.new_date) return p.new_date;
  const m = key.match(/^(?:extra_)?(\d{4}-\d{2}-\d{2})_/);
  return m ? m[1] : null;
}

// ===========================================================================
// Etat du module RH. Volontairement séparé des helpers purs ci-dessus, qui
// restent testables sans DOM ni réseau.
// ===========================================================================

let hrData = null;        // payload de hrOverview ou hrMyLeave
let hrLoading = false;
let hrError = null;
let hrSelected = null;    // cleaner_id du dossier ouvert (vue manager)
let hrSubmitting = false;
let hrComp = null;        // payload hrGetCompensation du dossier ouvert
let hrCompLoading = false;
let hrCompError = null;   // message d'erreur du dernier fetch hrGetCompensation ; null = pas d'erreur
// Proprietaire de l'etat de remuneration ci-dessus : hrComp / hrCompLoading /
// hrCompError ne valent QUE pour ce cleaner_id. Sans ce marqueur, une reponse
// arrivee apres un changement de dossier peuplait le panneau d'un autre salarie.
let hrCompCleanerId = null;
// Numero de la derniere requete hrGetCompensation emise. Toute reponse portant
// un numero perime est jetee : elle ne peut plus ecrire dans l'etat du module.
let hrCompReqId = 0;

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

// Libellé lisible pour un type de document (analogue à hrTypeLabel pour les congés).
function hrDocLabel(key){
  const d = HR_DOC_TYPES.find(x => x.key === key);
  return d ? d.label : key;
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

// Remet a zero tout l'etat de rémunération et périme les réponses en vol.
// Incrémenter hrCompReqId suffit : la réponse d'une requête déja partie sera
// jetée a son retour, donc elle ne peut plus peupler le panneau d'un autre dossier.
function hrResetComp(){
  hrComp = null;
  hrCompError = null;
  hrCompLoading = false;
  hrCompCleanerId = null;
  hrCompReqId++;
}

// Renvoie hrComp UNIQUEMENT s'il appartient bien au dossier demandé, sinon null.
// Double contrôle : le marqueur de propriété du module ET le cleaner_id renvoyé
// par le serveur dans la réponse.
function hrCompDataFor(cleanerId){
  const cid = Number(cleanerId);
  if (hrCompCleanerId !== cid || !hrComp) return null;
  if (hrComp.cleaner_id != null && Number(hrComp.cleaner_id) !== cid) return null;
  return hrComp;
}

// Charge les données de rémunération du dossier ouvert, uniquement si l'appelant
// est owner (le drapeau hrData.isOwner est vérifié avant l'appel dans renderHRDetail).
// Pattern trois-états identique à loadHR / hrRefresh : hrCompError bloque toute
// nouvelle tentative automatique ; seul un appel explicite (ex. retry) remet hrCompError
// à null avant le fetch, ce qui stoppe la boucle infinie en cas d'erreur réseau ou 4xx.
// Anti-contamination : la requête s'approprie l'état (hrCompCleanerId) avant l'await et
// porte un numéro ; une réponse dont le numéro n'est plus le dernier n'écrit rien.
async function hrLoadComp(cleanerId){
  const cid = Number(cleanerId);
  // Déja en vol POUR CE DOSSIER : ne pas doubler la requête. Un fetch en cours
  // pour un AUTRE dossier ne doit en revanche jamais bloquer celui-ci.
  if (hrCompLoading && hrCompCleanerId === cid) return;
  const reqId = ++hrCompReqId;
  hrCompCleanerId = cid; hrCompLoading = true; hrCompError = null; hrComp = null;
  try {
    const r = await api('hrGetCompensation', { params: { cleaner_id: cid } });
    if (reqId !== hrCompReqId) return; // réponse périmée : un autre dossier a pris la main
    if (r && r.error) { hrCompError = r.error; hrComp = null; }
    else if (!r || !r.compensation) { hrCompError = 'Failed to load compensation'; hrComp = null; }
    else if (r.compensation.cleaner_id != null && Number(r.compensation.cleaner_id) !== cid) {
      // Ceinture et bretelles : le serveur a répondu pour quelqu'un d'autre.
      hrCompError = 'Compensation data did not match the selected employee'; hrComp = null;
    }
    else { hrComp = r.compensation; }
  } catch (e) {
    if (reqId !== hrCompReqId) return;
    hrCompError = (e && e.message) || 'Failed to load compensation';
    hrComp = null;
  } finally {
    // Une réponse périmée ne touche ni au drapeau de chargement (il appartient a
    // la requête courante) ni au rendu.
    if (reqId === hrCompReqId) {
      hrCompLoading = false;
      render();
    }
  }
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

  // Bandeau d'alerte pour les documents expirant dans les 60 prochains jours.
  const expiring = hrData.expiring || [];
  if (expiring.length) {
    h += '<div class="hr-section"><h3>Documents expiring</h3>';
    expiring.forEach(d => {
      const left = daysUntil(d.expiry_date, today);
      h += '<div class="hr-card" data-action="hrOpen" data-arg0="' + d.cleaner_id + '" style="cursor:pointer">' +
        '<div class="hr-row"><div class="hr-grow">' +
        '<div class="hr-name">' + esc(hrCleanerName(d.cleaner_id)) + '</div>' +
        '<div class="hr-meta">' + esc(hrDocLabel(d.doc_type)) + ' · expires ' + esc(d.expiry_date) + '</div></div>' +
        '<span class="hr-badge ' + (left < 0 ? 'rejected' : 'pending') + '">' +
        (left < 0 ? 'expired ' + Math.abs(left) + 'd ago' : left + 'd left') + '</span>' +
        '</div></div>';
    });
    h += '</div>';
  }

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
// L'état de rémunération est remis a zéro ET les réponses en vol sont périmées,
// pour qu'aucune donnée de l'employé précédent ne puisse atterrir dans ce panneau.
function hrOpen(cleanerId){ hrSelected = Number(cleanerId); hrResetComp(); render(); }
// Ferme le dossier et revient a la liste. Même remise a zéro : sans elle, un aller
// -retour liste/dossier laissait un hrComp orphelin en mémoire.
function hrCloseDetail(){ hrSelected = null; hrResetComp(); render(); }

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

    // Section documents : liste + formulaire d'ajout.
    const docs = (hrData.documents || []).filter(d => d.cleaner_id === cid);
    h += '<div class="hr-section"><h3>Documents</h3>';
    docs.forEach(d => {
      const left = daysUntil(d.expiry_date, hrToday());
      h += '<div class="hr-card"><div class="hr-row"><div class="hr-grow">' +
        '<div class="hr-name">' + esc(hrDocLabel(d.doc_type)) + '</div>' +
        '<div class="hr-meta">' + (d.doc_number ? esc(d.doc_number) + ' · ' : '') +
        (d.expiry_date ? 'expires ' + esc(d.expiry_date) : 'no expiry') +
        (d.note ? ' · ' + esc(d.note) : '') + '</div></div>' +
        (left !== null ? '<span class="hr-badge ' + (left < 0 ? 'rejected' : left <= 60 ? 'pending' : 'approved') + '">' +
          (left < 0 ? 'expired' : left + 'd') + '</span>' : '') +
        '<button class="hr-btn-alt" style="padding:6px 10px;border:none;border-radius:8px;cursor:pointer" data-action="hrDeleteDocument" data-arg0="' + d.id + '" title="Delete" aria-label="Delete document">' + icon('trash', 14) + '</button>' +
        '</div></div>';
    });
    if (!docs.length) h += '<div class="hr-empty">No document on file.</div>';
    h += '<div class="hr-card"><div class="hr-form">' +
      '<label>Type</label><select id="hrDocType">' +
      HR_DOC_TYPES.map(t => '<option value="' + t.key + '">' + esc(t.label) + '</option>').join('') + '</select>' +
      '<label>Number</label><input id="hrDocNumber" placeholder="Optional"/>' +
      '<label>Issued</label><input type="date" id="hrDocIssue"/>' +
      '<label>Expires</label><input type="date" id="hrDocExpiry"/>' +
      '<label>Note</label><input id="hrDocNote" placeholder="Optional"/>' +
      '</div><div class="hr-actions">' +
      '<button class="hr-btn-ok" data-action="hrSaveDocument" data-arg0="' + cid + '">Add document</button>' +
      '</div></div></div>';

    // Bloc rémunération : visible uniquement si l'utilisateur courant est owner.
    // Le fetch n'est déclenché que si hrData.isOwner est vrai ; un manager non-owner
    // ne voit jamais ce bloc et n'envoie aucune requête hrGetCompensation.
    // hrCompError stoppe toute nouvelle tentative automatique et affiche un message explicite.
    if (hrData.isOwner) {
      // Garde a quatre termes. Le premier terme relance un fetch si l'état en mémoire
      // appartient a un AUTRE dossier (retour arrière puis ouverture d'un autre salarié
      // pendant qu'une réponse est en vol) ; les trois autres sont la garde anti-boucle.
      if (hrCompCleanerId !== cid || (hrComp === null && !hrCompLoading && !hrCompError)) hrLoadComp(cid);
      // Rendu strictement limité aux données du dossier ouvert : hrCompDataFor renvoie
      // null si l'état appartient a quelqu'un d'autre, donc jamais de salaire croisé.
      const compData = hrCompDataFor(cid);
      const c = compData || {};
      const compError = (hrCompCleanerId === cid) ? hrCompError : null;
      h += '<div class="hr-section"><h3>Compensation (CEO only)</h3><div class="hr-card">';
      if (compError) {
        // Erreur de chargement : afficher le message et bloquer le formulaire pour
        // éviter d'écraser des valeurs inconnues avec des nulls.
        h += '<div class="hr-empty">Could not load compensation data: ' + esc(compError) + '</div>';
      } else {
        h += '<div class="hr-form">' +
          '<label>Basic salary (AED / month)</label><input type="number" step="1" id="hrBasic" value="' + (c.basic_salary != null ? c.basic_salary : '') + '"/>' +
          '<label>Housing allowance</label><input type="number" step="1" id="hrHousing" value="' + (c.housing_allowance != null ? c.housing_allowance : '') + '"/>' +
          '<label>Transport allowance</label><input type="number" step="1" id="hrTransport" value="' + (c.transport_allowance != null ? c.transport_allowance : '') + '"/>' +
          '<label>Other allowance</label><input type="number" step="1" id="hrOther" value="' + (c.other_allowance != null ? c.other_allowance : '') + '"/>' +
          '</div><div class="hr-actions"><button class="hr-btn-ok" data-action="hrSaveComp" data-arg0="' + cid + '">Save compensation</button></div>' +
          '<div class="hr-stat" style="margin-top:10px"><span>Total package</span><b>' + (c.total || 0) + ' AED</b></div>' +
          '<div class="hr-stat"><span>Basic share</span><b>' + (c.total ? Math.round((Number(c.basic_salary || 0) / c.total) * 100) : 0) + '%</b></div>';
      }
      h += '</div>';
      // L'estimation de fin de service n'est rendue que sur des données réellement
      // chargées pour CE dossier. Sous un message d'erreur ou pendant le chargement,
      // "Estimated gratuity 0 AED" se lirait comme un vrai montant.
      if (compData) {
        const endForGratuity = emp.end_date || hrToday();
        const grat = gratuityEstimate(emp.hire_date, endForGratuity, c.basic_salary, c.unpaid_days || 0);
        h += '<div class="hr-card">' +
          '<div class="hr-name" style="margin-bottom:6px">End of service estimate</div>' +
          '<div class="hr-stat"><span>Service years' + (emp.end_date ? '' : ' if leaving today') + '</span><b>' + grat.years + '</b></div>' +
          '<div class="hr-stat"><span>Gratuity days</span><b>' + grat.days + '</b></div>' +
          '<div class="hr-stat"><span>Unpaid leave deducted</span><b>' + (c.unpaid_days || 0) + ' days</b></div>' +
          '<div class="hr-stat"><span>Estimated gratuity</span><b>' + grat.amount + ' AED</b></div>' +
          '<div class="hr-meta" style="margin-top:8px">Indicative only, based on basic salary. Confirm with the PRO before any settlement.</div>' +
          '</div>';
      }
      h += '</div>';
    }
  }

  return h;
}

// Sauvegarde les données de rémunération via hrSaveEmployee (upsert complet).
// Les champs non sensibles sont repris depuis emp pour ne pas écraser les valeurs existantes.
// Utilise apiWrite pour que tout refus serveur (403 si non-owner) lève une exception.
// Bloque si hrCompLoading est vrai : le handler délégué (window[action]) appelle cette
// fonction directement, sans tenir compte de l'état visuel du bouton.
async function hrSaveComp(cleanerId){
  if (hrSubmitting) return;
  const cid = Number(cleanerId);
  // Anti-contamination : l'état de rémunération en mémoire doit appartenir a CE dossier.
  // Sinon on écrirait les montants d'un autre salarié (champs rendus depuis son payload)
  // sur ce dossier-ci, avec un toast de succès.
  if (hrCompCleanerId !== cid) {
    toast('Compensation data does not match this employee, reopen the record', 'error');
    return;
  }
  // Sécurité anti-race : sans données chargées pour ce dossier, on ne peut pas distinguer
  // "champ vide car l'employé n'a pas de salaire" de "champ vide car le fetch n'est pas
  // terminé". Envoyer des nulls détruirait les valeurs stockées silencieusement.
  if (hrCompLoading || !hrCompDataFor(cid)) { toast('Compensation data not loaded yet, please wait', 'error'); return; }
  const emp = (hrData.employees || []).find(e => e.cleaner_id === Number(cleanerId));
  if (!emp) { toast('Create the employee record first', 'error'); return; }
  const num = (id) => { const v = hrVal(id); return v === '' ? null : Number(v); };
  hrSubmitting = true;
  try {
    await apiWrite('hrSaveEmployee', { body: {
      cleaner_id: Number(cleanerId),
      hire_date: emp.hire_date,
      end_date: emp.end_date || null,
      job_title: emp.job_title || null,
      nationality: emp.nationality || null,
      opening_annual_days: emp.opening_annual_days || 0,
      opening_date: emp.opening_date,
      notes: emp.notes || null,
      basic_salary: num('hrBasic'),
      housing_allowance: num('hrHousing'),
      transport_allowance: num('hrTransport'),
      other_allowance: num('hrOther'),
    }});
    toast('Compensation saved', 'success');
    hrComp = null;
    await hrLoadComp(cleanerId);
  } catch (e) {
    toast((e && e.message) || 'Failed to save', 'error');
  } finally {
    hrSubmitting = false;
  }
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
    hrSelected = null; hrData = null; hrResetComp();
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
  const emp = hrData.employee;
  const reqs = hrData.requests || [];
  let h = '<div class="header"><div class="header-top"><h1>🌴 My leave</h1>' +
    '<div class="header-actions"><button data-action="hrRefresh" title="Refresh" aria-label="Refresh">' + icon('refresh', 18) + '</button></div></div></div>';
  h += '<div class="container">';

  // Dossier non encore créé par le manager : message clair sans erreur JS.
  if (!emp) {
    h += '<div class="hr-empty">Your HR record is not set up yet. Ask your manager to create it before requesting leave.</div></div>';
    return h;
  }

  // Soldes acquis a ce jour (ou a la date de fin si l'employé a quitté).
  const approved = reqs.filter(r => r.status === 'approved');
  const usedAnnual = approved.filter(r => r.leave_type === 'annual').reduce((s, r) => s + Number(r.days || 0), 0);
  const usedSick = approved.filter(r => r.leave_type === 'sick').reduce((s, r) => s + Number(r.days || 0), 0);
  const asOf = emp.end_date && emp.end_date < hrToday() ? emp.end_date : hrToday();
  const accrued = accruedAnnualDays(emp.hire_date, asOf, emp.opening_annual_days, emp.opening_date);
  const sick = sickTiers(usedSick);

  h += '<div class="hr-section"><div class="hr-card">' +
    '<div class="hr-stat"><span>Annual days available</span><b>' + (Math.round((accrued - usedAnnual) * 100) / 100) + '</b></div>' +
    '<div class="hr-stat"><span>Annual days earned so far</span><b>' + accrued + '</b></div>' +
    '<div class="hr-stat"><span>Annual days taken</span><b>' + usedAnnual + '</b></div>' +
    '<div class="hr-stat"><span>Sick days left this year</span><b>' + sick.remaining + '</b></div>' +
    '</div></div>';

  // Formulaire de demande de congé.
  h += '<div class="hr-section"><h3>Request leave</h3><div class="hr-card"><div class="hr-form">' +
    '<label>Type</label><select id="hrMineType">' +
    HR_LEAVE_TYPES.map(t => '<option value="' + t.key + '">' + esc(t.label) + '</option>').join('') + '</select>' +
    '<label>From</label><input type="date" id="hrMineStart" min="' + esc(hrToday()) + '"/>' +
    '<label>To</label><input type="date" id="hrMineEnd" min="' + esc(hrToday()) + '"/>' +
    '<label>Reason (optional)</label><input id="hrMineReason" placeholder="Family trip"/>' +
    '</div><div class="hr-actions"><button class="hr-btn-ok" data-action="hrSubmitMine">Send request</button></div>' +
    '<div class="hr-meta" style="margin-top:8px">Days are counted on the calendar, weekends included.</div>' +
    '</div></div>';

  // Historique des demandes de l'employé. Cancel possible si pending.
  h += '<div class="hr-section"><h3>My requests</h3>';
  h += reqs.length
    ? reqs.map(r => hrRequestCard(r, false) +
        (r.status === 'pending'
          ? '<div class="hr-actions" style="margin-top:-4px;margin-bottom:8px"><button class="hr-btn-alt" data-action="hrCancelRequest" data-arg0="' + r.id + '">Cancel</button></div>'
          : '')).join('')
    : '<div class="hr-empty">No request yet.</div>';
  h += '</div></div>';
  return h;
}

// Sauvegarde (création) d'un document employé via le formulaire Documents.
// Utilise apiWrite pour que tout échec (réseau ou serveur) lève une exception.
async function hrSaveDocument(cleanerId){
  if (hrSubmitting) return;
  const type = hrVal('hrDocType');
  if (!type) { toast('Pick a document type', 'error'); return; }
  hrSubmitting = true;
  try {
    await apiWrite('hrSaveDocument', { body: {
      cleaner_id: Number(cleanerId), doc_type: type,
      doc_number: hrVal('hrDocNumber') || null,
      issue_date: hrVal('hrDocIssue') || null,
      expiry_date: hrVal('hrDocExpiry') || null,
      note: hrVal('hrDocNote') || null,
    }});
    toast('Document saved', 'success');
    hrData = null;
    await loadHR();
  } catch (e) {
    toast((e && e.message) || 'Failed to save', 'error');
  } finally {
    hrSubmitting = false;
  }
}

// Supprime un document employé après confirmation.
async function hrDeleteDocument(id){
  if (!confirm('Delete this document?')) return;
  try {
    await apiWrite('hrDeleteDocument', { body: { id: Number(id) } });
    toast('Document deleted', 'info');
    hrData = null;
    await loadHR();
  } catch (e) {
    toast((e && e.message) || 'Failed to delete', 'error');
  }
}

// Soumet une demande de congé pour soi-même via le formulaire employé.
async function hrSubmitMine(){
  if (hrSubmitting) return;
  const start = hrVal('hrMineStart'), end = hrVal('hrMineEnd');
  if (!start || !end) { toast('Pick both dates', 'error'); return; }
  const d = leaveDays(start, end);
  if (!d) { toast('End date must be on or after start date', 'error'); return; }
  if (!confirm('Request ' + d + ' day' + (d > 1 ? 's' : '') + ' off, from ' + start + ' to ' + end + '?')) return;
  hrSubmitting = true;
  try {
    await apiWrite('hrSubmitLeave', { body: {
      leave_type: hrVal('hrMineType') || 'annual',
      start_date: start, end_date: end, reason: hrVal('hrMineReason') || null,
    }});
    toast('Request sent to your manager', 'success');
    hrData = null;
    await loadHR();
  } catch (e) {
    toast((e && e.message) || 'Failed to send', 'error');
  } finally {
    hrSubmitting = false;
  }
}
