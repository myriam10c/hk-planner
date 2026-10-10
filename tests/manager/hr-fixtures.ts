import { fetchLog, type FakeRoute } from './helpers';

// Donnees partagees des ecrans More > HR (vue d'ensemble et fiche employe).
export const m = (o: any) => ({ phone: '', email: null, active: true, hasPin: false, hasAccount: false, isOwner: false, system: false, color: '#4caf50', ...o });
export const TEAM = {
  members: [
    m({ id: 8, name: 'Walter', role: 'manager', isOwner: true }),
    m({ id: 3, name: 'Amir', role: 'cleaner' }),
    m({ id: 4, name: 'Faiza', role: 'cleaner' }),
    m({ id: 5, name: 'Elite Cleaning', role: 'subcontractor' }),
    m({ id: 9, name: 'Nadia', role: 'cleaner' }),
    m({ id: 7, name: 'Old Bob', role: 'cleaner', active: false }),
  ],
};
export const emp = (o: any) => ({ id: o.cleaner_id * 10, end_date: null, job_title: 'Cleaner', nationality: null, opening_annual_days: 0, opening_date: null, notes: null, ...o });
export const req = (o: any) => ({ leave_type: 'annual', reason: null, requested_by: 'Amir', decided_by: null, decided_at: null, decision_note: null, form_path: null, ...o });
export const OVERVIEW = {
  status: 'success',
  today: '2026-10-11',
  isOwner: true,
  employees: [
    // 2 ans d'anciennete : 2,5 j/mois depuis l'embauche, 20 jours annuels pris.
    emp({ cleaner_id: 3, hire_date: '2024-10-01', job_title: 'Senior cleaner' }),
    emp({ cleaner_id: 4, hire_date: '2026-06-01' }),
  ],
  pending: [req({ id: 41, cleaner_id: 4, start_date: '2026-10-20', end_date: '2026-10-22', days: 3, status: 'pending', reason: 'Family visit' })],
  upcoming: [req({ id: 42, cleaner_id: 3, start_date: '2026-10-10', end_date: '2026-10-12', days: 3, status: 'approved' })],
  taken: { '3': { annual: 20, sick: 2 } },
  documents: [],
  expiring: [
    { id: 1, cleaner_id: 3, doc_type: 'visa', expiry_date: '2026-11-10' },
    { id: 2, cleaner_id: 4, doc_type: 'passport', expiry_date: '2026-10-01' },
  ],
  history: [],
  holidays: [
    { id: 71, holiday_date: '2026-12-02', name: 'National Day' },
    { id: 70, holiday_date: '2026-01-01', name: 'New Year past' },
    { id: 72, holiday_date: '2027-03-20', name: 'Eid Al Fitr' },
  ],
};
export const TEAM_READ: FakeRoute = { match: 'action=mgr.team', status: 200, body: TEAM };
export const READ: FakeRoute = { match: 'action=hrOverview', status: 200, body: OVERVIEW };



export const posts = async (page: any, action: string) =>
  (await fetchLog(page)).filter((l) => l.url.endsWith('action=' + action) && l.body).map((l) => JSON.parse(l.body));

export async function sign(page: any) {
  // hover attend la fin de l'animation du panneau avant de lire la position.
  await page.locator('#sheet canvas').hover();
  const box = (await page.locator('#sheet canvas').boundingBox())!;
  await page.mouse.move(box.x + 20, box.y + 20);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 5 });
  await page.mouse.move(box.x + box.width - 20, box.y + 30, { steps: 5 });
  await page.mouse.up();
}
