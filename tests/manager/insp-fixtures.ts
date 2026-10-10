import { MANAGER, me } from './helpers';

// Formes reprises de tests/inspections/*.spec.ts (reponses du proxy insp.*).
export const card = (o: any) => ({ listingId: 'A', name: 'Apt 101 · Tower A', eligibility: { kind: 'checkout', checkOutTime: 12, nextCheckIn: { date: '2026-10-06', time: 15 } },
  daysSince: null, lastInspector: null, missed: 2, openIssue: false, claimedBy: null, claimedByName: null, inProgressBy: null, inProgressById: null, doneToday: null, ...o });
export const INSP_TODAY = (claimedBy: number | null = null) => ({ status: 200, match: 'action=insp.today', body: { day: '2026-10-06', target: 4, cachedAt: null,
  today: [card({ claimedBy, claimedByName: claimedBy ? 'Walter' : null })], also: [] } });
export const OVERVIEW = { status: 200, match: 'action=insp.overview', body: { coveragePct: 33, inspectedThisMonth: 12, rows: [
  { listingId: 'B', name: 'Apt 202 · Tower B', excluded: false, lastAt: '2026-09-25T06:00:00Z', lastInspector: 'Faiza', daysSince: 11, color: 'green', openIssues: 1, missed: 0 },
] } };
export const HISTORY = { status: 200, match: 'action=insp.history', body: { listingId: 'B', name: 'Apt 202 · Tower B', inspections: [
  { id: 2, inspector: 'Faiza', startedAt: '2026-09-25T05:30:00Z', finishedAt: '2026-09-25T06:00:00Z', eligibility: 'checkout', generalNote: 'Good overall', items: [] }] } };
export const REPORTS = { status: 200, match: 'action=insp.reports', body: { totals: {}, reports: [] } };
export const KEYS = ['entrance', 'living', 'kitchen', 'bedrooms', 'bathrooms', 'ac', 'wifi_tv', 'balcony', 'inventory', 'cleanliness', 'det'];
export const START = (items: any[] = []) => ({ status: 200, match: 'action=insp.start', body: {
  inspection: { id: 41, listingId: 'A', eligibility: 'checkout', startedAt: '2026-10-06T06:42:00Z' }, items, photos: [] } });

