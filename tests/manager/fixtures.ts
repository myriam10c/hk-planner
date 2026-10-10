import { ROW, ROW_TSK } from './problem-fixtures';
// Reponse mgr.today au format de supabase/functions/hostaway-proxy/mgr_api.ts.
export const DAY = '2026-10-09';
export const NOW = new Date('2026-10-09T07:00:00Z'); // 11:00 Dubai

const J = (o: any) => ({
  kind: 'checkout', checkoutDate: DAY, postponedFrom: null, assigned: [], serviceType: null,
  state: 'not_started', next: null, ...o,
});

export function todayBody(over: any = {}) {
  const base = {
    day: DAY, generatedAt: '2026-10-09T07:00:00.000Z', bookingsCachedAt: null, riskHours: 6,
    me: { id: 8, name: 'Walter' },
    strip: { cleanings: 3, unassigned: 2, arrivals: 4, notReady: 3 },
    who: {
      jobs: [
        J({ key: '2026-10-09_Ann Lee', listingId: 'L1', apt: '308', bld: 'Binghatti Lavender', checkout: '12:00',
          next: { date: DAY, time: '15:00', sameDay: true, owner: false }, tone: 'bad', word: 'Unassigned' }),
        J({ key: '2026-10-09_Lu Mo', listingId: 'L9', apt: '909', bld: 'Bloom Height', checkout: '11:00',
          next: { date: '2026-10-13', time: '15:00', sameDay: false, owner: false }, tone: 'warn', word: 'Usually Elite · not logged yet' }),
        J({ key: '2026-10-09_Cy Doe', listingId: 'L2', apt: '103', bld: 'Damac Reva', checkout: null,
          next: { date: DAY, time: '15:00', sameDay: true, owner: false }, assigned: [4], serviceType: 'CHC', tone: 'warn', word: 'Not started' }),
      ],
      people: [
        { id: 4, name: 'Faiza', role: 'cleaner', keys: ['2026-10-09_Cy Doe'] },
        { id: 10, name: 'Pionah', role: 'cleaner', keys: [] },
        { id: 12, name: 'Elite Cleaning', role: 'subcontractor', keys: [] },
      ],
      unassigned: ['2026-10-09_Ann Lee', '2026-10-09_Lu Mo'],
      technicians: [{ id: 7, name: 'Semax', open: 1, oldest: { id: 106, title: 'Balcony drain blocked', since: '27/04' } }],
    },
    problems: {
      counts: { urgent: 21, ticketsOpen: 70, ticketsUrgent: 19, ticketsNoTech: 69, teamTasksOpen: 135, teamTasksOverdue: 19, inspectionTicketsOpen: 11, cleanerReportsOpen: 0 },
      top: [ROW(), ROW_TSK],
    },
    control: {
      inspections: { proposed: 4, claimed: 1, done: 0, unfinished: [{ apt: '414', bld: 'Azizi Riviera 11', inspector: 'Hillal', date: '05/10' }] },
      linen: { window: 'last 7 days', rows: [{ name: 'Elite Cleaning', missing: 38, total: 39 }, { name: 'Faiza', missing: 1, total: 10 }] },
      overdue: { total: 113, rows: [{ name: 'Semax', n: 94 }, { name: 'Walter', n: 19 }] },
      yesterday: { date: '08/10', rows: [
        { name: 'Faiza', text: '2 cleanings done, 2 linen counts.' },
        { name: 'Elite Cleaning', text: 'Not logged yet. Elite logs its jobs around 14:00 the next day.' },
        { name: 'Maintenance', text: '0 tickets resolved.' },
      ] },
    },
    arrivals: {
      counts: { ok: 1, warn: 2, bad: 1, idle: 0 },
      rows: [
        { id: '2', listingId: 'L1', apt: '308', bld: 'Binghatti Lavender', time: '15:00', timeSet: true, kind: 'Guest', tone: 'bad', word: 'Blocked',
          cause: 'No cleaner assigned, and urgent ticket open: Gas not working (MNT-429).', prevKey: '2026-10-09_Ann Lee',
          prevCheckout: { date: DAY, time: '12:00' }, cleaners: [], assigned: [], serviceType: null, done: false },
        { id: '4', listingId: 'L2', apt: '103', bld: 'Damac Reva', time: '15:00', timeSet: true, kind: 'Guest', tone: 'warn', word: 'At risk',
          cause: 'Not started yet, Faiza. Guest in 4 h, checkout time not set.', prevKey: '2026-10-09_Cy Doe',
          prevCheckout: { date: DAY, time: null }, cleaners: ['Faiza'], assigned: [4], serviceType: 'CHC', done: false },
        { id: '8', listingId: 'L4', apt: '404', bld: 'Elysee 1', time: '15:00', timeSet: true, kind: 'Guest', tone: 'ok', word: 'Ready',
          cause: 'Cleaned by Elite Cleaning after the 05/10 checkout.', prevKey: '2026-10-05_Fa Ho',
          prevCheckout: { date: '2026-10-05', time: '11:00' }, cleaners: ['Elite Cleaning'], assigned: [12], serviceType: 'CHC', done: true },
        { id: '6', listingId: 'L3', apt: '805', bld: 'Azizi Riviera 39', time: '16:00', timeSet: true, kind: 'Owner stay', tone: 'warn', word: 'At risk',
          cause: 'Usually Elite · not logged yet. Elite logs its jobs the next day around 14:00.', prevKey: '2026-10-08_Ed Gu',
          prevCheckout: { date: '2026-10-08', time: '12:00' }, cleaners: [], assigned: [], serviceType: null, done: false },
      ],
    },
    assignable: [
      { id: 4, name: 'Faiza', role: 'cleaner' }, { id: 10, name: 'Pionah', role: 'cleaner' }, { id: 12, name: 'Elite Cleaning', role: 'subcontractor' },
    ],
    ticketsByListing: { L1: [{ id: 429, title: 'Gas not working', priority: 'urgent', since: '09/07', tech: null }] },
  };
  return { ...JSON.parse(JSON.stringify(base)), ...over };
}
