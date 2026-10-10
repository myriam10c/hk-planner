// Reponses mgr.problem.get et mgr.problems au format de
// supabase/functions/hostaway-proxy/mgr_problem_get.ts et mgr_problems.ts.
export const ROW = (o: any = {}) => ({
  ref: 'MNT-429', kind: 'MNT', id: 429, source: 'Maintenance', priority: 'urgent', label: 'Urgent', tone: 'bad',
  title: 'Gas not working', status: 'open', closed: false, listingId: 'L1', apt: '308', bld: 'Binghatti Lavender',
  assignee: null, createdAt: '2026-07-09T08:00:00Z', since: '09/07', dueAt: null, due: null, overdue: false, todayBoost: 0,
  why: 'A guest arrives today at 15:00. Open since 09/07, no technician assigned.', ...o,
});
export const ROW_TSK = ROW({
  ref: 'TSK-13', kind: 'TSK', id: 13, source: 'Team task', title: 'AC not cooling', listingId: 'L1', apt: '308',
  bld: 'Binghatti Lavender', assignee: { kind: 'member', id: 7, name: 'Semax' }, createdAt: '2026-05-14T08:00:00Z',
  since: '14/05', dueAt: '2026-05-15T08:00:00Z', due: '15/05', overdue: true, todayBoost: 0,
  why: 'A guest arrives today at 15:00. Assigned to Semax, overdue since 15/05.',
});
export const ROW_INS = ROW({
  ref: 'MNT-501', id: 501, source: 'Inspection', priority: 'normal', label: 'Normal', tone: 'idle', title: 'Bedroom: lamp broken',
  status: 'assigned', listingId: 'L2', apt: '103', bld: 'Damac Reva', assignee: { kind: 'member', id: 8, name: 'Walter' },
  createdAt: '2026-10-07T08:00:00Z', since: '07/10', dueAt: '2026-10-12T19:59:59.000Z', due: '12/10', todayBoost: 1,
  why: 'Checkout today at 12:00. Open since 07/10, assigned to Walter.',
});
export const ASSIGNEES = [
  { id: 7, name: 'Semax', role: 'manager', takesTasks: true }, { id: 8, name: 'Walter', role: 'manager', takesTasks: true },
  { id: 4, name: 'Faiza', role: 'cleaner', takesTasks: false },
];
export function detailBody(over: any = {}) {
  return JSON.parse(JSON.stringify({
    problem: ROW(), description: 'Guest says the stove does not light.', category: 'gas', reportedBy: 'Faiza',
    photos: [{ url: 'https://signed.test/v3/p1.jpg', label: 'Reported' }], photosError: null,
    comments: [{ author: 'Walter', text: 'Called the gas company.', at: '2026-10-08T06:00:00Z', photo: null }],
    history: [{ at: '2026-07-09T08:00:00Z', text: 'Reported by Faiza' }],
    mirror: { ref: 'TSK-17', status: 'open', assignee: 'Semax' },
    assignees: ASSIGNEES, vendors: [{ id: 3, name: 'CoolFix', specialty: 'AC' }],
    ...over,
  }));
}
export const detailTsk = () => detailBody({ problem: ROW_TSK, mirror: null, vendors: [], photos: [], description: 'Check the AC' });
export const ACT_OK = (o: any = {}) => ({ status: 'success', ...o });
export function listBody(over: any = {}) {
  return JSON.parse(JSON.stringify({
    day: '2026-10-09', generatedAt: '2026-10-09T07:00:00.000Z', bookingsCachedAt: null, bookingsUnavailable: false,
    me: { id: 8, name: 'Walter' },
    counts: { open: 3, urgent: 2, mine: 1, unassigned: 1, overdue: 1, bySource: { Maintenance: 1, Inspection: 1, 'Cleaner report': 0, 'Team task': 1 } },
    apartments: [{ listingId: 'L1', apt: '308', bld: 'Binghatti Lavender', n: 2 }, { listingId: 'L2', apt: '103', bld: 'Damac Reva', n: 1 }],
    total: 3, offset: 0, limit: 50, rows: [ROW(), ROW_TSK, ROW_INS],
    assignees: ASSIGNEES, vendors: [{ id: 3, name: 'CoolFix', specialty: 'AC' }],
    ...over,
  }));
}
export function manyRows(n: number, start: number) {
  return Array.from({ length: n }, (_, i) => ROW({ ref: 'MNT-' + (start + i), id: start + i, title: 'Problem ' + (start + i), priority: 'low', label: 'Low', tone: 'idle' }));
}
