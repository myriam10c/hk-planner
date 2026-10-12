import { expect, type Page } from '@playwright/test';
import { fetchLog } from './helpers';

// Reponse mgr.planning au format de supabase/functions/hostaway-proxy/mgr_planning.ts.
export const WEEK = '2026-10-05';
export const PNOW = new Date('2026-10-09T07:00:00Z'); // vendredi 11:00 Dubai
export const IDEM = /^mgr-[A-Za-z0-9]{8,}$/;
export const OK = { status: 'success' };

export function daysOf(start: string) {
  const out: string[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(start + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() + i);
    out.push(d.toISOString().slice(0, 10));
  }
  return out.map((date) => ({ date, holiday: null as string | null, off: [] as number[] }));
}

const J = (o: any) => ({
  kind: 'checkout', postponedFrom: null, checkout: '11:00', guest: 'Guest', next: null, assigned: [], serviceType: null,
  state: 'not_started', cancelled: null, laundry: null, extra: null, tone: 'idle', word: 'Scheduled', ...o,
});

export function planningBody(over: any = {}) {
  const days = daysOf(WEEK).map((d) => ({
    ...d,
    holiday: d.date === '2026-10-11' ? 'Test holiday' : null,
    off: d.date === '2026-10-10' || d.date === '2026-10-11' ? [4] : [],
  }));
  return {
    start: WEEK, end: '2026-10-11', today: '2026-10-09',
    generatedAt: '2026-10-09T07:00:00.000Z', bookingsAt: '2026-10-09T06:58:00.000Z',
    me: { id: 8, name: 'Walter' },
    days,
    jobs: [
      J({ key: '2026-10-06_Ann Lee', listingId: 'L1', apt: '308', bld: 'Binghatti Lavender', date: '2026-10-06', checkout: '12:00',
        guest: 'Ann Lee', assigned: [4], serviceType: 'CHC', state: 'done', tone: 'ok', word: 'Done',
        laundry: { pillowcases: 4, bed_sheets: 2, duvet_covers: 2, small_towels: 4, face_towels: 4, large_towels: 4, bath_mats: 2, total: 22 } }),
      J({ key: '2026-10-07_Ed Gu', listingId: 'L4', apt: '404', bld: 'Elysee 1', date: '2026-10-07', guest: 'Ed Gu',
        assigned: [12], serviceType: 'CHC', cancelled: { reason: 'Guest extended', by: 'Walter' }, word: 'Cancelled' }),
      J({ key: '2026-10-07_Gi Lo', listingId: 'L6', apt: '606', bld: 'Tower F', date: '2026-10-08', checkout: null, guest: 'Gi Lo',
        postponedFrom: '2026-10-07', assigned: [4], serviceType: 'CHC', tone: 'warn', word: 'Not marked done' }),
      J({ key: '2026-10-09_Bo Ray', listingId: 'L2', apt: '103', bld: 'Damac Reva', date: '2026-10-09', guest: 'Bo Ray',
        next: { date: '2026-10-09', time: '15:00', sameDay: true, before: false }, tone: 'bad', word: 'Unassigned' }),
      J({ key: '2026-10-09_Cy Doe', listingId: 'L9', apt: '909', bld: 'Bloom Height', date: '2026-10-09', guest: 'Cy Doe',
        tone: 'warn', word: 'Not logged yet' }),
      J({ key: '2026-10-09_Di Fox', listingId: 'L3', apt: '805', bld: 'Azizi Riviera 39', date: '2026-10-09', checkout: null, guest: 'Di Fox',
        next: { date: '2026-10-10', time: '16:00', sameDay: false, before: false }, assigned: [10], serviceType: 'CHC' }),
      J({ key: 'extra_2026-10-09_mabc', kind: 'extra', listingId: 'L8', apt: '808', bld: 'Tower H', date: '2026-10-09', checkout: null, guest: null,
        assigned: [10], serviceType: 'CHC',
        extra: { id: 31, label: 'Deep clean', guestName: 'Owner', priceBilled: 250, cleanerPrice: 120, notes: 'Bring the steamer', cleaningDate: '2026-10-09' } }),
      J({ key: '2026-10-10_Fa Ho', listingId: 'L5', apt: '505', bld: 'Tower E', date: '2026-10-10', guest: 'Fa Ho', assigned: [12], serviceType: 'CHC' }),
    ],
    people: [
      { id: 4, name: 'Faiza', role: 'cleaner', slot: 'p1', assignable: true },
      { id: 10, name: 'Pionah', role: 'cleaner', slot: 'p2', assignable: true },
      { id: 12, name: 'Elite Cleaning', role: 'subcontractor', slot: 'sub', assignable: true },
    ],
    leaves: [{ cleanerId: 4, name: 'Faiza', start: '2026-10-10', end: '2026-10-12' }],
    listings: [
      { id: 'L3', apt: '805', bld: 'Azizi Riviera 39' }, { id: 'L1', apt: '308', bld: 'Binghatti Lavender' },
      { id: 'L8', apt: '808', bld: 'Tower H' },
    ],
    counts: { total: 7, unassigned: 2, done: 1, cancelled: 1 },
    ...over,
  };
}

export const PLAN = (body: any = planningBody()) => ({ match: 'action=mgr.planning', status: 200, body });

export const isMobile = (info: any) => info.project.name === 'mgr-mobile';

// Ouvre la fiche d'un menage ; sur telephone, choisit d'abord son jour.
export async function openJob(page: Page, mobile: boolean, key: string, day: string) {
  if (mobile) await page.locator('.pl-strip [data-day="' + day + '"]').click();
  await page.locator('.pj[data-job="' + key + '"]').click();
  await expect(page.locator('#sheet')).toHaveAttribute('aria-hidden', 'false');
}

// Corps des ecritures envoyees pour une action (POST ?action=<action>).
export async function writes(page: Page, action: string) {
  return (await fetchLog(page)).filter((l) => l.url.endsWith('action=' + action)).map((l) => JSON.parse(l.body));
}
export const noIdem = (rows: any[]) => rows.map(({ idem, ...b }) => b);
