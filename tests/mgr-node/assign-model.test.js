// Modele pur de l'ecran Assign (lot 4b, tache 2) : manager/screens/assign-model.js.
// Jeux d'essai inventes en ligne, a la forme de mgr.planning (tests/manager/planning-fixtures.ts,
// planningBody()) avec usuallyElite sur chaque menage. Aucun vrai nom de guest.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildRows, firstDay, mergeWeeks, peopleOn, rowLine, stripDays, toggleOp } from '../../manager/screens/assign-model.js';

const THU = '2026-11-26'; // aujourd'hui (Dubai) dans ces jeux d'essai
const FRI = '2026-11-27';
const SAT = '2026-11-28';

// Un menage de mgr.planning (PlanJob, mgr_planning.ts).
const PJ = (o) => ({
  kind: 'checkout', listingId: 'L1', apt: '101', bld: 'Tower A', addr: null, date: FRI, postponedFrom: null, checkout: '11:00',
  guest: 'Guest', next: null, assigned: [], serviceType: null, state: 'not_started', cancelled: null, laundry: null,
  extra: null, tone: 'bad', word: 'Unassigned', usuallyElite: false, ...o,
});
// Personnes dans l'ordre du proxy (role puis nom) ; slot rendu par le proxy, garde tel quel.
const PEOPLE = [
  { id: 12, name: 'Elite Cleaning', role: 'subcontractor', slot: 'sub', assignable: true },
  { id: 10, name: 'Annet', role: 'cleaner', slot: 'p1', assignable: true },
  { id: 4, name: 'Faiza', role: 'cleaner', slot: 'p2', assignable: true },
  { id: 7, name: 'Old Hand', role: 'cleaner', slot: 'other', assignable: false },
  { id: 3, name: 'Pionah', role: 'cleaner', slot: 'p3', assignable: true },
  { id: 8, name: 'Walter', role: 'manager', slot: 'other', assignable: false },
];
function daysFrom(start, off = {}) {
  const out = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(start + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() + i);
    const date = d.toISOString().slice(0, 10);
    out.push({ date, holiday: null, off: off[date] || [] });
  }
  return out;
}
function week(start, jobs, { today = THU, off = {}, people = PEOPLE } = {}) {
  const days = daysFrom(start, off);
  return {
    start, end: days[6].date, today, generatedAt: '2026-11-26T07:00:00.000Z', bookingsAt: '2026-11-26T06:58:00.000Z',
    me: { id: 8, name: 'Walter' }, days, jobs, people, leaves: [], listings: [],
    counts: { total: jobs.length, unassigned: 0, done: 0, cancelled: 0 },
  };
}

// Vendredi 27 : sept menages a montrer, un fait et un annule caches.
const FRI_JOBS = [
  PJ({ key: '2026-11-27_Ann Lee', listingId: 'L1', apt: '1602', bld: 'The Grand Emaar', checkout: '10:00' }),
  PJ({ key: '2026-11-27_Bo Ray', listingId: 'L2', apt: '308', bld: 'Binghatti Lavender', checkout: '11:00',
    next: { date: FRI, time: '15:00', sameDay: true, before: false } }),
  PJ({ key: '2026-11-27_Cy Doe', listingId: 'L9', apt: '909', bld: 'Bloom Height', usuallyElite: true }),
  PJ({ key: '2026-11-27_Di Fox', listingId: 'L3', apt: '805', bld: 'Azizi Riviera 39', checkout: null,
    assigned: [10, 4], serviceType: 'CHC', tone: 'idle', word: 'Scheduled' }),
  PJ({ key: '2026-11-27_Ed Gu', listingId: 'L4', apt: '404', bld: 'Elysee 1', assigned: [4], serviceType: 'CHC',
    state: 'done', tone: 'ok', word: 'Done' }),
  PJ({ key: '2026-11-27_Fa Ho', listingId: 'L5', apt: '505', bld: 'Tower E', assigned: [4], serviceType: 'CHC',
    cancelled: { reason: 'Guest extended', by: 'Walter' }, tone: 'idle', word: 'Cancelled' }),
  PJ({ key: '2026-11-19_Gi Lo', listingId: 'L6', apt: '606', bld: 'Tower F', checkout: null, postponedFrom: '2026-11-19' }),
  PJ({ key: 'extra_2026-11-27_mabc', kind: 'extra', listingId: 'L8', apt: '808', bld: 'Tower H', checkout: null, guest: null,
    extra: { id: 31, label: 'Deep clean', guestName: 'Owner', priceBilled: 250, cleanerPrice: 120, notes: null, cleaningDate: FRI, cleaningTime: null } }),
  PJ({ key: '2026-11-27_Hu Ng', listingId: 'L7', apt: '99', bld: 'Marina Gate', checkout: '10:00',
    next: { date: '2026-11-29', time: '16:00', sameDay: false, before: false } }),
];
const WEEK_A = week('2026-11-23', [
  PJ({ key: '2026-11-26_Io Pe', listingId: 'L10', apt: '210', bld: 'Tower B', date: THU, assigned: [3], serviceType: 'CHC',
    tone: 'idle', word: 'Scheduled' }),
  ...FRI_JOBS,
  PJ({ key: '2026-11-28_Jo Ku', listingId: 'L11', apt: '311', bld: 'Tower C', date: SAT }),
], { off: { [FRI]: [10] } });

const keys = (rows) => rows.map((r) => r.key);

test('mergeWeeks dedupes jobs by key and days by date', () => {
  const a = week('2026-11-23', [
    PJ({ key: 'K1', date: '2026-11-29' }),
    PJ({ key: 'K2', date: '2026-11-29', assigned: [] }),
  ]);
  // Semaine qui chevauche la premiere sur le dimanche 29 et sur le menage K2 (relu depuis).
  const b = week('2026-11-29', [
    PJ({ key: 'K2', date: '2026-11-29', assigned: [4], serviceType: 'CHC' }),
    PJ({ key: 'K3', date: '2026-11-30' }),
  ], { today: '2026-11-27', off: { '2026-11-29': [3] } });
  const m = mergeWeeks([a, null, b]);
  assert.equal(m.today, THU);
  assert.deepEqual(m.jobs.map((j) => j.key), ['K1', 'K2', 'K3']);
  assert.deepEqual(m.jobs.find((j) => j.key === 'K2').assigned, [4]);
  assert.equal(m.days.length, 13);
  assert.equal(m.days.filter((d) => d.date === '2026-11-29').length, 1);
  assert.deepEqual(m.days.find((d) => d.date === '2026-11-29').off, [3]);
  assert.deepEqual(m.people.map((p) => p.id), PEOPLE.map((p) => p.id));
  assert.equal(mergeWeeks([null, b]).today, '2026-11-27');
});

test('stripDays gives 7 days with null count when a week is missing', () => {
  assert.deepEqual(stripDays(mergeWeeks([WEEK_A]), THU), [
    { date: THU, label: 'Thu', num: 26, count: 0 },
    { date: FRI, label: 'Fri', num: 27, count: 6 },
    { date: SAT, label: 'Sat', num: 28, count: 1 },
    { date: '2026-11-29', label: 'Sun', num: 29, count: 0 },
    { date: '2026-11-30', label: 'Mon', num: 30, count: null },
    { date: '2026-12-01', label: 'Tue', num: 1, count: null },
    { date: '2026-12-02', label: 'Wed', num: 2, count: null },
  ]);
});

test('firstDay prefers wanted, then first day with rows, then today', () => {
  const m = mergeWeeks([WEEK_A]);
  assert.equal(firstDay(m, THU, SAT), SAT);
  // Jour voulu hors de la bande, puis aucun jour voulu : vendredi, le premier avec une ligne sans personne.
  assert.equal(firstDay(m, THU, '2026-12-10'), FRI);
  assert.equal(firstDay(m, THU, null), FRI);
  // Seulement des menages deja affectes : aujourd'hui.
  const full = mergeWeeks([week('2026-11-23', [PJ({ key: 'K1', assigned: [4], word: 'Scheduled' })])]);
  assert.equal(firstDay(full, THU, null), THU);
});

test('off person is disabled', () => {
  assert.deepEqual(peopleOn(mergeWeeks([WEEK_A]), FRI), [
    { id: 10, name: 'Annet', ini: 'A', slot: 'p1', off: true, load: 1 },
    { id: 4, name: 'Faiza', ini: 'F', slot: 'p2', off: false, load: 2 },
    { id: 3, name: 'Pionah', ini: 'P', slot: 'p3', off: false, load: 0 },
    { id: 12, name: 'Elite Cleaning', ini: 'EC', slot: 'sub', off: false, load: 0 },
  ]);
  assert.equal(peopleOn(mergeWeeks([WEEK_A]), THU)[0].off, false);
});

test('rowLine pinned copy', () => {
  assert.equal(rowLine(PJ({ next: { date: FRI, time: '15:00', sameDay: true, before: false } })), 'Out 11:00 · Guest arrives 15:00');
  assert.equal(rowLine(PJ({ next: { date: FRI, time: null, sameDay: true, before: false } })), 'Out 11:00 · Guest arrives the same day');
  assert.equal(rowLine(PJ({ date: THU, next: { date: FRI, time: '16:00', sameDay: false, before: false } })), 'Out 11:00 · Next guest Fri 27');
  assert.equal(rowLine(PJ({ checkout: null })), 'Out time not set · No next guest');
  assert.equal(rowLine(PJ({ checkout: null, postponedFrom: '2026-11-19' })), 'Postponed from 19/11 · No next guest');
  assert.equal(rowLine(FRI_JOBS.find((j) => j.kind === 'extra')), 'Deep clean');
});

test('buildRows groups, order and exclusions', () => {
  const r = buildRows(mergeWeeks([WEEK_A]), FRI, new Map());
  // Arrivee le jour meme d'abord, puis depart (sans heure en dernier), puis numero d'appartement.
  assert.deepEqual(keys(r.todo), ['2026-11-27_Bo Ray', '2026-11-27_Hu Ng', '2026-11-27_Ann Lee', '2026-11-19_Gi Lo', 'extra_2026-11-27_mabc']);
  assert.deepEqual(keys(r.assigned), ['2026-11-27_Di Fox']);
  assert.deepEqual(keys(r.elite), ['2026-11-27_Cy Doe']);
  const all = keys([...r.todo, ...r.assigned, ...r.elite]);
  assert.ok(!all.includes('2026-11-27_Ed Gu'), 'done hidden');
  assert.ok(!all.includes('2026-11-27_Fa Ho'), 'cancelled hidden');
  assert.deepEqual(r.todo[2], {
    key: '2026-11-27_Ann Lee', place: 'Apt 1602 · The Grand Emaar', line: 'Out 10:00 · No next guest',
    ids: [], serviceType: null, group: 'todo',
  });
  assert.deepEqual(r.assigned[0], {
    key: '2026-11-27_Di Fox', place: 'Apt 805 · Azizi Riviera 39', line: 'Out time not set · No next guest',
    ids: [10, 4], serviceType: 'CHC', group: 'assigned',
  });
  assert.equal(r.elite[0].group, 'elite');
});

test('pinned keys stay in their group', () => {
  const touched = WEEK_A.jobs.map((j) => (j.key === '2026-11-27_Ann Lee' ? { ...j, assigned: [4], serviceType: 'CHC' } : j));
  const m = mergeWeeks([{ ...WEEK_A, jobs: touched }]);
  const r = buildRows(m, FRI, new Map([['2026-11-27_Ann Lee', 'todo']]));
  const row = r.todo.find((x) => x.key === '2026-11-27_Ann Lee');
  assert.deepEqual([row.group, row.ids], ['todo', [4]]);
  assert.ok(!keys(r.assigned).includes('2026-11-27_Ann Lee'));
  // Sans epingle, la meme ligne passe dans Already assigned.
  assert.ok(keys(buildRows(m, FRI, new Map()).assigned).includes('2026-11-27_Ann Lee'));
});

test('toggleOp add then undo', () => {
  const row = { key: '2026-11-27_Di Fox', place: 'Apt 805 · Azizi Riviera 39', line: '', ids: [10, 4], serviceType: 'CHC', group: 'assigned' };
  assert.deepEqual(toggleOp(row, 12), {
    body: { reservation_key: '2026-11-27_Di Fox', cleaner_id: 12, mode: 'add', expect_ids: [4, 10], service_type: 'CHC' },
    after: [4, 10, 12],
    undo: { reservation_key: '2026-11-27_Di Fox', cleaner_id: 12, mode: 'remove', expect_ids: [4, 10, 12] },
  });
  // Type de service inconnu : rien d'envoye a sa place.
  const none = { ...row, key: '2026-11-27_Ann Lee', ids: [], serviceType: null };
  assert.deepEqual(toggleOp(none, 4), {
    body: { reservation_key: '2026-11-27_Ann Lee', cleaner_id: 4, mode: 'add', expect_ids: [] },
    after: [4],
    undo: { reservation_key: '2026-11-27_Ann Lee', cleaner_id: 4, mode: 'remove', expect_ids: [4] },
  });
});

test('toggleOp remove', () => {
  const row = { key: '2026-11-27_Di Fox', place: 'Apt 805 · Azizi Riviera 39', line: '', ids: [10, 4], serviceType: 'CHC', group: 'assigned' };
  const op = toggleOp(row, 10);
  assert.deepEqual(op.body, { reservation_key: '2026-11-27_Di Fox', cleaner_id: 10, mode: 'remove', expect_ids: [4, 10] });
  assert.deepEqual(op.after, [4]);
  assert.deepEqual(op.undo, { reservation_key: '2026-11-27_Di Fox', cleaner_id: 10, mode: 'add', expect_ids: [4], service_type: 'CHC' });
  assert.deepEqual(row.ids, [10, 4], 'row left as it was');
});
