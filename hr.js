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

function renderHRManager(){
  return '<div class="header"><div class="header-top"><h1>&#x1F464; HR</h1></div></div>' +
    '<div class="container"><div class="hr-empty">Manager view coming next.</div></div>';
}

function renderHRMine(){
  return '<div class="header"><div class="header-top"><h1>&#x1F334; My leave</h1></div></div>' +
    '<div class="container"><div class="hr-empty">Employee view coming next.</div></div>';
}
