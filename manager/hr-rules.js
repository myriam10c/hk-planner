// Regles RH pures de /manager/ : copie conforme des helpers purs de hr.js (lignes 9 a 138).
// Ne pas modifier ici seul : tests/manager/hr-rules.spec.ts compare chaque sortie a hr.js.
// Les commentaires d'origine sont gardes tels quels.

export const HR_LEAVE_TYPES = [
  { key: 'annual',      label: 'Annual leave' },
  { key: 'sick',        label: 'Sick leave' },
  { key: 'unpaid',      label: 'Unpaid leave' },
  { key: 'maternity',   label: 'Maternity leave' },
  { key: 'parental',    label: 'Parental leave' },
  { key: 'bereavement', label: 'Bereavement leave' },
  { key: 'hajj',        label: 'Hajj leave' },
  { key: 'other',       label: 'Other' },
];

export const HR_DOC_TYPES = [
  { key: 'passport',          label: 'Passport' },
  { key: 'emirates_id',       label: 'Emirates ID' },
  { key: 'visa',              label: 'Residence visa' },
  { key: 'labour_card',       label: 'Labour card' },
  { key: 'medical_insurance', label: 'Medical insurance' },
  { key: 'contract',          label: 'Contract' },
  { key: 'other',             label: 'Other' },
];

// Jours calendaires, bornes incluses. Du 10 au 20 = 11 jours.
export function leaveDays(start, end){
  const a = Date.parse(String(start) + 'T00:00:00Z');
  const b = Date.parse(String(end) + 'T00:00:00Z');
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return 0;
  return Math.round((b - a) / 86400000) + 1;
}

// Mois revolus entre deux dates. Le 15/01 -> 14/02 ne fait pas un mois.
export function completeMonths(from, to){
  const f = new Date(String(from) + 'T00:00:00Z');
  const t = new Date(String(to) + 'T00:00:00Z');
  if (isNaN(f.getTime()) || isNaN(t.getTime()) || t < f) return 0;
  let m = (t.getUTCFullYear() - f.getUTCFullYear()) * 12 + (t.getUTCMonth() - f.getUTCMonth());
  if (t.getUTCDate() < f.getUTCDate()) m--;
  return Math.max(0, m);
}

// Droit annuel acquis, decret-loi federal 33/2021 :
//   - moins de 6 mois d'anciennete : 0
//   - de 6 a 12 mois : 2 jours par mois revolu
//   - au-dela de 12 mois : 2,5 jours par mois revolu (30 jours par an)
// openingDays/openingDate permettent de reprendre un solde existant : on ne
// calcule alors l'acquis qu'a partir d'openingDate, mais le PALIER depend de
// l'anciennete reelle depuis hireDate.
export function accruedAnnualDays(hireDate, asOf, openingDays, openingDate){
  const opening = Number(openingDays) || 0;
  const from = openingDate || hireDate;
  const tenureMonths = completeMonths(hireDate, asOf);
  if (tenureMonths < 6) return opening;
  const earnedMonths = completeMonths(from, asOf);
  const rate = tenureMonths >= 12 ? 2.5 : 2;
  return Math.round((opening + earnedMonths * rate) * 100) / 100;
}

// Conge maladie par annee de service : 15 jours plein salaire, 30 jours a
// demi-salaire, 45 jours non payes. 90 jours au total.
export function sickTiers(daysUsed){
  const d = Math.max(0, Number(daysUsed) || 0);
  return {
    full: Math.min(d, 15),
    half: Math.min(Math.max(d - 15, 0), 30),
    unpaid: Math.min(Math.max(d - 45, 0), 45),
    used: d,
    remaining: Math.max(0, 90 - d),
  };
}

export function rangesOverlap(aStart, aEnd, bStart, bEnd){
  return String(aStart) <= String(bEnd) && String(bStart) <= String(aEnd);
}

// Indemnite de fin de service : 21 jours de basic par an sur les 5 premieres
// annees, 30 jours par an ensuite, plafonnee a 24 mois de basic. Les jours de
// conge non paye ne comptent pas dans l'anciennete.
export function gratuityEstimate(hireDate, endDate, basicSalary, unpaidDays){
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

// Jours restants avant une date. Negatif si deja passee, null si vide.
export function daysUntil(dateStr, todayStr){
  if (!dateStr) return null;
  const a = Date.parse(String(dateStr) + 'T00:00:00Z');
  const b = Date.parse(String(todayStr || new Date().toISOString().slice(0, 10)) + 'T00:00:00Z');
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.round((a - b) / 86400000);
}

// Decoupe l'historique d'un employe : demandes vivantes (pending/approved non
// terminees, tri chronologique) puis le reste (passe, rejete, annule, tri
// antichronologique). Pilote par la vue "Leave history" du dossier manager.
export function hrSplitHistory(rows, cleanerId, today){
  const cid = Number(cleanerId);
  const mine = (Array.isArray(rows) ? rows : []).filter(r => Number(r.cleaner_id) === cid);
  const isActive = r => (r.status === 'pending' || r.status === 'approved') && r.end_date >= today;
  const active = mine.filter(isActive).sort((a, b) => (a.start_date < b.start_date ? -1 : 1));
  const past = mine.filter(r => !isActive(r)).sort((a, b) => (a.start_date < b.start_date ? 1 : -1));
  return { active: active, past: past };
}

// Feries a venir (>= today), tri croissant, plafonnes a limit.
export function hrUpcomingHolidays(rows, today, limit){
  return (Array.isArray(rows) ? rows : [])
    .filter(h => h && h.holiday_date >= today)
    .sort((a, b) => (a.holiday_date < b.holiday_date ? -1 : 1))
    .slice(0, limit || 10);
}

// Nom du ferie tombant ce jour-la, null sinon.
export function hrHolidayNameOn(rows, day){
  const h = (Array.isArray(rows) ? rows : []).find(x => x && x.holiday_date === day);
  return h ? h.name : null;
}
