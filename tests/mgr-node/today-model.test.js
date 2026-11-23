// Modele pur de Today (lot 4a, tache 2) : manager/screens/today-model.js.
// Jeux d'essai inventes en ligne, aux formes de mgr.today (tests/manager/fixtures.ts)
// et de mgr.planning (tests/manager/planning-fixtures.ts). Aucun vrai nom de guest.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildAhead, buildToday, countNone, isNone, nextNone, sentence, slotsOf, visible } from '../../manager/screens/today-model.js';

const DAY = '2026-11-20'; // vendredi
const SAT = '2026-11-21';
const TEAM = [
  { id: 10, name: 'Annet', role: 'cleaner' },
  { id: 4, name: 'Faiza', role: 'cleaner' },
  { id: 12, name: 'Elite Cleaning', role: 'subcontractor' },
];

// Un menage de mgr.today (MgrJob, mgr_today.ts).
const J = (o) => ({
  key: DAY + '_Ann Lee', kind: 'checkout', listingId: 'L1', apt: '101', bld: 'Tower A', checkout: '11:00', checkoutDate: DAY,
  postponedFrom: null, next: null, extraTime: null, assigned: [], serviceType: null, state: 'not_started',
  tone: 'bad', word: 'Unassigned', ...o,
});
// Une arrivee de mgr.today (MgrArrival, mgr_today.ts).
const A = (o) => ({
  id: '1', listingId: 'L1', apt: '101', bld: 'Tower A', time: '15:00', timeSet: true, kind: 'Guest',
  tone: 'ok', word: 'Ready', cause: 'Cleaned by Faiza after the 18/11 checkout.', prevKey: null,
  prevCheckout: null, cleaners: [], assigned: [], serviceType: null, done: false, ...o,
});
function today({ jobs = [], arrivals = [], tickets = {}, assignable = TEAM, people = null } = {}) {
  return {
    day: DAY, generatedAt: '2026-11-20T12:57:00.000Z', bookingsCachedAt: null, riskHours: 6,
    me: { id: 8, name: 'Walter' },
    who: { jobs, people: people || assignable.map((p) => ({ ...p, keys: [] })), unassigned: [], technicians: [] },
    arrivals: { counts: { ok: 0, warn: 0, bad: 0, idle: 0 }, rows: arrivals },
    assignable, ticketsByListing: tickets, locations: null,
  };
}

// Un menage de mgr.planning (PlanJob, mgr_planning.ts).
const PJ = (o) => ({
  kind: 'checkout', listingId: 'L1', apt: '101', bld: 'Tower A', addr: null, date: SAT, postponedFrom: null, checkout: '11:00',
  guest: 'Guest', next: null, assigned: [], serviceType: null, state: 'not_started', cancelled: null, laundry: null,
  extra: null, tone: 'idle', word: 'Scheduled', ...o,
});
function week(jobs, off = {}) {
  const dates = ['2026-11-16', '2026-11-17', '2026-11-18', '2026-11-19', DAY, SAT, '2026-11-22'];
  return {
    start: dates[0], end: dates[6], today: DAY, generatedAt: '2026-11-20T12:57:00.000Z', bookingsAt: '2026-11-20T12:55:00.000Z',
    me: { id: 8, name: 'Walter' },
    days: dates.map((date) => ({ date, holiday: null, off: off[date] || [] })),
    jobs,
    people: [
      { id: 10, name: 'Annet', role: 'cleaner', slot: 'p1', assignable: true },
      { id: 4, name: 'Faiza', role: 'cleaner', slot: 'p2', assignable: true },
      { id: 12, name: 'Elite Cleaning', role: 'subcontractor', slot: 'sub', assignable: true },
    ],
    leaves: [], listings: [], counts: { total: 0, unassigned: 0, done: 0, cancelled: 0 },
  };
}

const unit = (day, id) => day.units.find((u) => u.id === id);
const nextOn = (date, time = '15:00', owner = false) => ({ date, time, sameDay: date === DAY, owner });

// 1
test("fusion : une arrivee et le menage que designe prevKey font un seul logement, ouvert sur l'arrivee", () => {
  const d = buildToday(today({
    jobs: [J({ key: 'K1', assigned: [4], tone: 'warn', word: 'Not started', next: nextOn(DAY) })],
    arrivals: [A({ id: '2', prevKey: 'K1', tone: 'warn', word: 'At risk', cause: 'Not started yet, Faiza. Guest in 4 h.', assigned: [4] })],
  }));
  assert.equal(d.units.length, 1);
  const u = d.units[0];
  assert.equal(u.id, 'K1');
  assert.equal(u.key, 'K1');
  assert.deepEqual(u.opens, { type: 'arr', ref: '2' });
  assert.deepEqual(u.arrival, { id: '2', time: '15:00', timeSet: true, owner: false });
  assert.equal(u.job.key, 'K1');
  assert.equal(u.k, 'risk');
  assert.equal(u.tone, 'warn');
  assert.equal(u.word, 'At risk');
  assert.equal(u.cause, 'Not started yet, Faiza. Guest in 4 h.');
  assert.deepEqual(u.assigned, [4]);
  assert.equal(u.canAssign, true);
});

// 2
test("arrivee sans menage du jour : id 'arr:8', cle = prevKey, ligne Ready", () => {
  const d = buildToday(today({ arrivals: [A({ id: '8', listingId: 'L4', prevKey: '2026-11-18_Fa Ho', assigned: [12], done: true })] }));
  const u = d.units[0];
  assert.equal(u.id, 'arr:8');
  assert.equal(u.key, '2026-11-18_Fa Ho');
  assert.equal(u.shape, 'line');
  assert.equal(u.k, 'ready');
  assert.equal(u.job, null);
  assert.equal(u.next, null);
  assert.deepEqual(u.assigned, [12]);
  assert.equal(u.canAssign, false); // menage d'avant deja fait
  assert.deepEqual(u.opens, { type: 'arr', ref: '8' });
  // Menage d'avant pas fait : la cle permet d'affecter.
  const open = buildToday(today({ arrivals: [A({ id: '8', prevKey: '2026-11-19_Fa Ho', tone: 'warn', word: 'At risk' })] })).units[0];
  assert.equal(open.canAssign, true);
  // Sans menage d'avant : aucune cle d'ecriture.
  const none = buildToday(today({ arrivals: [A({ id: '9', prevKey: null })] })).units[0];
  assert.equal(none.key, null);
  assert.equal(none.canAssign, false);
});

// 3
test("depart et extra sur le meme logement : deux cartes, l'arrivee fusionnee avec le depart seulement", () => {
  const next = nextOn(DAY, '16:00');
  const d = buildToday(today({
    jobs: [
      J({ key: 'K1', checkout: '11:00', assigned: [4], tone: 'idle', word: 'Not started', next }),
      J({ key: 'extra_2026-11-20_mx1', kind: 'extra', checkout: null, extraTime: '14:00', assigned: [10], tone: 'idle', word: 'Not started', next }),
    ],
    arrivals: [A({ id: '5', time: '16:00', prevKey: 'K1', tone: 'idle', word: 'Scheduled', assigned: [4] })],
  }));
  assert.equal(d.units.length, 2);
  assert.equal(unit(d, 'K1').arrival.id, '5');
  const x = unit(d, 'extra_2026-11-20_mx1');
  assert.equal(x.arrival, null);
  assert.equal(x.job.extra, true);
  assert.equal(x.key, 'extra_2026-11-20_mx1');
  assert.deepEqual(x.opens, { type: 'job', ref: 'extra_2026-11-20_mx1' });
  // L'extra reste une carte a part, rangee sous l'arrivee de son logement (pas sous « No guest today »).
  assert.deepEqual(d.moments.map((m) => [m.id, m.unitIds]), [['arr-1600', ['K1', 'extra_2026-11-20_mx1']]]);
});

// 4
test('k et shape pour chaque ligne du tableau Rangement de la spec', () => {
  const ks = (o) => { const u = buildToday(today(o)).units[0]; return [u.k, u.shape]; };
  assert.deepEqual(ks({ arrivals: [A({ tone: 'bad', word: 'Blocked' })] }), ['blocked', 'blocked']);
  assert.deepEqual(ks({ arrivals: [A({ tone: 'warn', word: 'At risk' })] }), ['risk', 'card']);
  assert.deepEqual(ks({ arrivals: [A({ tone: 'idle', word: 'Scheduled' })] }), ['planned', 'card']);
  assert.deepEqual(ks({ arrivals: [A({ tone: 'ok', word: 'Ready' })] }), ['ready', 'line']);
  assert.deepEqual(ks({ jobs: [J({ assigned: [4], state: 'done', tone: 'ok', word: 'Done' })] }), ['done', 'line']);
  assert.deepEqual(ks({ jobs: [J({ state: 'done', tone: 'ok', word: 'Done' })] }), ['done', 'line']);
  assert.deepEqual(ks({ jobs: [J({ tone: 'warn', word: 'Not logged yet' })] }), ['elite', 'card']);
  assert.deepEqual(ks({ jobs: [J({ tone: 'bad', word: 'Unassigned' })] }), ['none', 'card']);
  assert.deepEqual(ks({ jobs: [J({ assigned: [4], state: 'in_progress', tone: 'idle', word: 'In progress' })] }), ['prog', 'card']);
  assert.deepEqual(ks({ jobs: [J({ assigned: [4], tone: 'idle', word: 'Not started' })] }), ['todo', 'card']);
  // Logement fusionne : l'arrivee decide, pas le menage.
  assert.deepEqual(ks({
    jobs: [J({ key: 'K', assigned: [4], state: 'done', tone: 'ok', word: 'Done' })],
    arrivals: [A({ prevKey: 'K', tone: 'bad', word: 'Blocked' })],
  }), ['blocked', 'blocked']);
  // Autre jour : un menage affecte est « planned » (todo n'existe qu'aujourd'hui).
  const w = week([PJ({ key: 'P1', assigned: [4] }), PJ({ key: 'P2', listingId: 'L2' }), PJ({ key: 'P3', listingId: 'L3', assigned: [4], state: 'done', tone: 'ok', word: 'Done' })]);
  assert.deepEqual(buildAhead(w, SAT).units.map((u) => [u.id, u.k, u.shape]),
    [['P1', 'planned', 'card'], ['P2', 'none', 'card'], ['P3', 'done', 'line']]);
});

// 5
test("moments : un par heure d'arrivee, tries par heure, puis No guest today ; un moment vide n'existe pas", () => {
  const d = buildToday(today({
    jobs: [J({ key: 'K9', listingId: 'L9', next: nextOn('2026-11-23', null) })],
    arrivals: [A({ id: '3', listingId: 'L3', time: '23:00' }), A({ id: '1', listingId: 'L1', time: '15:00' })],
  }));
  assert.deepEqual(d.moments.map((m) => m.id), ['arr-1500', 'arr-2300', 'none']);
  assert.deepEqual(d.moments.map((m) => m.tint), ['day', 'night', 'any']);
  assert.deepEqual(d.moments.map((m) => m.label), ['Arriving at 15:00', 'Arriving at 23:00', 'No guest today']);
  assert.deepEqual(d.moments.map((m) => m.unitIds), [['arr:1'], ['arr:3'], ['K9']]);
  assert.deepEqual(d.units.map((u) => u.id), ['arr:1', 'arr:3', 'K9']); // ordre affiche
  // 17:00 encore le jour, 18:00 deja la nuit ; sans menage hors arrivee, pas de « No guest today ».
  const e = buildToday(today({ arrivals: [A({ id: '1', time: '17:00' }), A({ id: '2', listingId: 'L2', time: '18:00' })] }));
  assert.deepEqual(e.moments.map((m) => [m.id, m.tint]), [['arr-1700', 'day'], ['arr-1800', 'night']]);
});

// 6
test("ordre dans un moment : bloques, puis a risque, puis l'ordre du proxy ; decompte dans l'ordre fixe", () => {
  const at = (id, tone) => A({ id, listingId: 'L' + id, tone, word: tone });
  const d = buildToday(today({
    arrivals: [at('1', 'ok'), at('2', 'warn'), at('3', 'bad'), at('4', 'idle'), at('5', 'bad'), at('6', 'warn')],
    jobs: [
      J({ key: 'K1', listingId: 'L11', assigned: [4], state: 'done', tone: 'ok', word: 'Done' }),
      J({ key: 'K2', listingId: 'L12', assigned: [4], tone: 'idle', word: 'Not started' }),
      J({ key: 'K3', listingId: 'L13', tone: 'warn', word: 'Not logged yet' }),
      J({ key: 'K4', listingId: 'L14', assigned: [10], state: 'in_progress', tone: 'idle', word: 'In progress' }),
      J({ key: 'K5', listingId: 'L15' }),
    ],
  }));
  assert.deepEqual(d.moments[0].unitIds, ['arr:3', 'arr:5', 'arr:2', 'arr:6', 'arr:1', 'arr:4']);
  assert.deepEqual(d.moments[0].tally, [
    { k: 'blocked', n: 2, w: 'blocked' }, { k: 'risk', n: 2, w: 'at risk' },
    { k: 'planned', n: 1, w: 'with a cleaner' }, { k: 'ready', n: 1, w: 'ready' },
  ]);
  assert.deepEqual(d.moments[1].unitIds, ['K1', 'K2', 'K3', 'K4', 'K5']);
  assert.deepEqual(d.moments[1].tally, [
    { k: 'none', n: 1, w: 'with no cleaner' }, { k: 'elite', n: 1, w: 'not logged yet' },
    { k: 'prog', n: 1, w: 'in progress' }, { k: 'todo', n: 1, w: 'not started' }, { k: 'done', n: 1, w: 'done' },
  ]);
});

// La journee de reference : 7 arrivees (6 pretes, 1 bloquee par un ticket urgent), 6 menages dont 1 attendu chez Elite.
function D7() {
  const nx = nextOn(DAY);
  return today({
    jobs: [
      J({ key: 'K1', listingId: 'L1', assigned: [4], tone: 'idle', word: 'Not started', next: nx }),
      J({ key: 'K2', listingId: 'L2', assigned: [4], state: 'done', tone: 'ok', word: 'Done', next: nx }),
      J({ key: 'K3', listingId: 'L3', assigned: [10], state: 'done', tone: 'ok', word: 'Done', next: nx }),
      J({ key: 'K4', listingId: 'L4', assigned: [10], state: 'done', tone: 'ok', word: 'Done' }),
      J({ key: 'K5', listingId: 'L5', assigned: [12], state: 'done', tone: 'ok', word: 'Done' }),
      J({ key: 'K6', listingId: 'L6', tone: 'warn', word: 'Not logged yet' }),
    ],
    arrivals: [
      A({ id: '1', listingId: 'L1', prevKey: 'K1', tone: 'bad', word: 'Blocked', cause: 'Urgent ticket open: Gas not working (MNT-585).', assigned: [4] }),
      A({ id: '2', listingId: 'L2', prevKey: 'K2', assigned: [4], done: true }),
      A({ id: '3', listingId: 'L3', prevKey: 'K3', assigned: [10], done: true }),
      A({ id: '7', listingId: 'L7', prevKey: '2026-11-17_Bo Ray', assigned: [10], done: true }),
      A({ id: '8', listingId: 'L8', prevKey: '2026-11-18_Cy Doe', assigned: [12], done: true }),
      A({ id: '9', listingId: 'L9', time: '16:00' }),
      A({ id: '10', listingId: 'L10', time: '16:00', kind: 'Owner stay' }),
    ],
    tickets: { L1: [{ id: 585, title: 'Gas not working', priority: 'urgent', since: '31/10', tech: null }] },
  });
}

// 7
test('comptes : none exclut elite ; phrase de la journee de reference', () => {
  const d = buildToday(D7());
  assert.deepEqual(d.counts, { arrivals: 7, ready: 6, scheduled: 0, risk: 0, blocked: 1, cleanings: 6, none: 0, elite: 1 });
  assert.equal(sentence(d), '7 guests arrive today. 6 apartments are ready, 1 is blocked. 6 cleanings, 1 expected with Elite.');
  // Le meme menage sans personne et sans « Not logged yet » compte comme « with no cleaner ».
  const data = D7();
  data.who.jobs[5] = J({ key: 'K6', listingId: 'L6' });
  const e = buildToday(data);
  assert.equal(e.counts.none, 1);
  assert.equal(e.counts.elite, 0);
  assert.equal(sentence(e), '7 guests arrive today. 6 apartments are ready, 1 is blocked. 6 cleanings, 1 with no cleaner.');
});

// 8
test("phrase : singulier, parts des arrivees dans l'ordre (les pretes toujours), journees a moitie vides", () => {
  const one = buildToday(today({
    jobs: [J({ key: 'K1', assigned: [4], state: 'done', tone: 'ok', word: 'Done', next: nextOn(DAY) })],
    arrivals: [A({ id: '1', prevKey: 'K1', assigned: [4], done: true })],
  }));
  assert.equal(sentence(one), '1 guest arrives today. 1 apartment is ready. 1 cleaning, all with a cleaner.');
  const mix = buildToday(today({
    jobs: [J({ key: 'K1', listingId: 'L1' }), J({ key: 'K2', listingId: 'L2', tone: 'warn', word: 'Not logged yet' }), J({ key: 'K3', listingId: 'L3' })],
    arrivals: [
      A({ id: '1', listingId: 'L4', tone: 'idle', word: 'Scheduled' }), A({ id: '2', listingId: 'L5', tone: 'warn', word: 'At risk' }),
      A({ id: '3', listingId: 'L6', tone: 'warn', word: 'At risk' }), A({ id: '4', listingId: 'L7', tone: 'bad', word: 'Blocked' }),
    ],
  }));
  assert.deepEqual(mix.counts, { arrivals: 4, ready: 0, scheduled: 1, risk: 2, blocked: 1, cleanings: 3, none: 2, elite: 1 });
  assert.equal(sentence(mix), '4 guests arrive today. 0 apartments are ready, 1 is scheduled, 2 are at risk, 1 is blocked. 3 cleanings, 2 with no cleaner, 1 expected with Elite.');
  const noGuest = buildToday(today({ jobs: [J({ key: 'K1' })] }));
  assert.equal(sentence(noGuest), 'No guest arrives today. 1 cleaning, 1 with no cleaner.');
  const noCleaning = buildToday(today({ arrivals: [A({ id: '1' }), A({ id: '2', listingId: 'L2', tone: 'idle', word: 'Scheduled' }), A({ id: '3', listingId: 'L3', tone: 'idle', word: 'Scheduled' })] }));
  assert.equal(sentence(noCleaning), '3 guests arrive today. 1 apartment is ready, 2 are scheduled. No cleaning planned.');
});

// 9
test('journee vide : phrase sans zero, aucun moment', () => {
  const d = buildToday(today());
  assert.equal(sentence(d), 'No guest arrives today. No cleaning planned.');
  assert.deepEqual(d.moments, []);
  assert.deepEqual(d.units, []);
  assert.deepEqual(d.counts, { arrivals: 0, ready: 0, scheduled: 0, risk: 0, blocked: 0, cleanings: 0, none: 0, elite: 0 });
  assert.deepEqual(visible(d, null), []);
  assert.deepEqual(visible(d, 'none'), []);
  assert.equal(nextNone(d, null, null), null);
  assert.deepEqual(d.people.map((p) => [p.id, p.count]), [[10, 0], [4, 0], [12, 0]]);
});

// 10
test('personne inconnue : Member 12, disque neutre marque ?, aucun plantage', () => {
  const team = TEAM.filter((p) => p.id !== 12);
  const d = buildToday(today({ assignable: team, jobs: [J({ key: 'K1', assigned: [12], tone: 'idle', word: 'Not started' })] }));
  assert.deepEqual(d.people.find((p) => p.id === 12),
    { id: 12, name: 'Member 12', role: 'unknown', slot: 'other', ini: '?', count: 1, off: false, assignable: false });
  assert.deepEqual(d.people.map((p) => p.id), [10, 4, 12]);
  // Connue de who.people seulement (cleaner inactive) : son nom, aucune couleur d'equipe, pas affectable.
  const e = buildToday(today({
    assignable: team, people: [...team.map((p) => ({ ...p, keys: [] })), { id: 12, name: 'Old Hand', role: 'cleaner', keys: ['K1'] }],
    jobs: [J({ key: 'K1', assigned: [12], tone: 'idle', word: 'Not started' })],
  }));
  assert.deepEqual(e.people.find((p) => p.id === 12),
    { id: 12, name: 'Old Hand', role: 'cleaner', slot: 'other', ini: 'OH', count: 1, off: false, assignable: false });
  // Le proxy rend lui-meme « Member 12 » (role unknown) quand la ligne cleaners manque : meme disque neutre.
  const f = buildToday(today({
    assignable: team, people: [...team.map((p) => ({ ...p, keys: [] })), { id: 12, name: 'Member 12', role: 'unknown', keys: ['K1'] }],
    jobs: [J({ key: 'K1', assigned: [12], tone: 'idle', word: 'Not started' })],
  }));
  assert.equal(f.people.find((p) => p.id === 12).ini, '?');
});

// 11
test('slotsOf : cleaners par nom, p1 a p4 en boucle ; sous-traitant sub ; autres roles absents', () => {
  assert.deepEqual(slotsOf([
    { id: 4, name: 'Faiza', role: 'cleaner' }, { id: 10, name: 'Annet', role: 'cleaner' },
    { id: 12, name: 'Elite Cleaning', role: 'subcontractor' }, { id: 8, name: 'Walter', role: 'manager' },
  ]), { 10: 'p1', 4: 'p2', 12: 'sub' });
  const five = ['Eve', 'Dina', 'Cara', 'Bea', 'Ada'].map((name, i) => ({ id: i + 1, name, role: 'cleaner' }));
  assert.deepEqual(slotsOf(five), { 5: 'p1', 4: 'p2', 3: 'p3', 2: 'p4', 1: 'p1' });
  assert.deepEqual(slotsOf([]), {});
  // Les personnes de la journee portent ces couleurs.
  const d = buildToday(today());
  assert.deepEqual(d.people.map((p) => [p.id, p.slot, p.ini, p.assignable]), [[10, 'p1', 'A', true], [4, 'p2', 'F', true], [12, 'sub', 'EC', true]]);
});

// 12
test('buildAhead : annules absents, moments same puis later, conge, menage affecte planned', () => {
  const w = week([
    PJ({ key: '2026-11-19_Ed Gu', listingId: 'L0', date: '2026-11-19' }),
    PJ({ key: '2026-11-21_Bo Ray', listingId: 'L2', apt: '202', assigned: [4], serviceType: 'CHC', next: { date: '2026-11-24', time: null, sameDay: false, before: false } }),
    PJ({ key: '2026-11-21_Ann Lee', listingId: 'L1', next: { date: SAT, time: '15:00', sameDay: true, before: false }, tone: 'bad', word: 'Unassigned' }),
    PJ({ key: '2026-11-21_Cy Doe', listingId: 'L3', assigned: [10], cancelled: { reason: 'Guest extended', by: 'Walter' }, word: 'Cancelled' }),
    PJ({ key: '2026-11-22_Di Fox', listingId: 'L4', date: '2026-11-22', assigned: [10] }),
  ], { [SAT]: [4] });
  const d = buildAhead(w, SAT);
  assert.equal(d.source, 'ahead');
  assert.equal(d.date, SAT);
  assert.deepEqual(d.moments.map((m) => [m.id, m.label, m.tint, m.unitIds]), [
    ['same', 'Guest arrives the same day', 'day', ['2026-11-21_Ann Lee']],
    ['later', 'Next guest later', 'any', ['2026-11-21_Bo Ray']],
  ]);
  assert.deepEqual(d.units.map((u) => u.id), ['2026-11-21_Ann Lee', '2026-11-21_Bo Ray']);
  const bo = unit(d, '2026-11-21_Bo Ray');
  assert.equal(bo.k, 'planned');
  assert.equal(bo.word, 'Scheduled');
  assert.equal(bo.arrival, null);
  assert.equal(bo.canAssign, true);
  assert.deepEqual(bo.opens, { type: 'job', ref: '2026-11-21_Bo Ray' });
  assert.deepEqual(bo.tickets, []);
  assert.equal(unit(d, '2026-11-21_Ann Lee').k, 'none');
  assert.deepEqual(d.people.map((p) => [p.id, p.off, p.count]), [[10, false, 0], [4, true, 1], [12, false, 0]]);
  assert.deepEqual(d.counts, { arrivals: 0, ready: 0, scheduled: 0, risk: 0, blocked: 0, cleanings: 2, none: 1, elite: 0 });
  assert.equal(sentence(d), '2 cleanings. 1 has no cleaner yet. 1 guest arrives the same day.');
  // Jour sans menage, semaine absente : rien ne plante.
  assert.equal(sentence(buildAhead(w, '2026-11-18')), 'No cleaning planned.');
  assert.deepEqual(buildAhead(null, SAT).moments, []);
  // Menage fait : jamais propose.
  const done = buildAhead(week([PJ({ key: 'P1', assigned: [4], state: 'done', tone: 'ok', word: 'Done' })]), SAT);
  assert.equal(done.units[0].canAssign, false);
  assert.equal(sentence(done), '1 cleaning. All have a cleaner.');
});

// 13
test('countNone : annules, faits, affectes et attendus chez Elite exclus', () => {
  const w = week([
    PJ({ key: 'a' }),
    PJ({ key: 'b', listingId: 'L2', cancelled: { reason: 'Guest extended', by: 'Walter' }, tone: 'idle', word: 'Cancelled' }),
    PJ({ key: 'c', listingId: 'L3', state: 'done', tone: 'ok', word: 'Done' }),
    PJ({ key: 'd', listingId: 'L4', assigned: [4] }),
    PJ({ key: 'e', listingId: 'L5', tone: 'warn', word: 'Not logged yet' }),
    PJ({ key: 'f', listingId: 'L6', date: '2026-11-22', tone: 'bad', word: 'Unassigned' }),
  ]);
  assert.equal(countNone(w, SAT), 1);
  assert.equal(countNone(w, '2026-11-22'), 1);
  assert.equal(countNone(w, '2026-11-19'), 0);
  assert.equal(countNone(null, SAT), 0);
});

// 14
test("nextNone : ordre affiche, repart du debut, ignore elite, respecte le filtre, null quand il n'y en a plus", () => {
  const data = today({
    arrivals: [
      A({ id: '1', listingId: 'L1', prevKey: 'K1', tone: 'bad', word: 'Blocked' }),
      A({ id: '2', listingId: 'L2' }),
    ],
    jobs: [
      J({ key: 'K1', listingId: 'L1', next: nextOn(DAY) }),
      J({ key: 'K4', listingId: 'L4' }),
      J({ key: 'K5', listingId: 'L5', tone: 'warn', word: 'Not logged yet' }),
      J({ key: 'K6', listingId: 'L6', assigned: [4], tone: 'idle', word: 'Not started' }),
      J({ key: 'K7', listingId: 'L7' }),
    ],
  });
  const d = buildToday(data);
  assert.deepEqual(d.moments.flatMap((m) => m.unitIds), ['K1', 'arr:2', 'K4', 'K5', 'K6', 'K7']);
  assert.equal(nextNone(d, null, null), 'K1'); // un bloque sans cleaner compte
  assert.equal(nextNone(d, 'K1', null), 'K4');
  assert.equal(nextNone(d, 'K4', null), 'K7'); // saute Elite et l'affecte
  assert.equal(nextNone(d, 'K7', null), 'K1'); // repart du debut
  assert.equal(nextNone(d, 'K6', 'none'), 'K7');
  assert.equal(nextNone(d, 'K4', 4), null); // une personne filtree : aucun logement sans cleaner affiche
  // Filtre « sans cleaner » puis affectation : K4 quitte la liste, la suite part de sa place.
  const after = JSON.parse(JSON.stringify(data));
  after.who.jobs[1].assigned = [10];
  const d2 = buildToday(after);
  assert.deepEqual(visible(d2, 'none').flatMap((m) => m.unitIds), ['K1', 'K7']);
  assert.equal(nextNone(d2, 'K4', 'none'), 'K7');
  // Plus aucun autre : null.
  const last = buildToday(today({ jobs: [J({ key: 'K1' }), J({ key: 'K2', listingId: 'L2', tone: 'warn', word: 'Not logged yet' })] }));
  assert.equal(nextNone(last, 'K1', null), null);
  assert.equal(nextNone(last, null, null), 'K1');
});

// 15
test('reasons : ticket urgent sans technicien, menage Elite, repli sur la cause', () => {
  const tickets = {
    L1: [
      { id: 585, title: 'Gas not working', priority: 'urgent', since: '31/10', tech: null },
      { id: 590, title: 'Door handle loose', priority: 'medium', since: '02/11', tech: 'Semax' },
    ],
    L3: [{ id: 600, title: 'AC leaking', priority: 'urgent', since: '01/11', tech: 'Semax' }],
  };
  const d = buildToday(today({
    tickets,
    jobs: [
      J({ key: 'K1', listingId: 'L1', tone: 'warn', word: 'Not logged yet' }),
      J({ key: 'K2', listingId: 'L2' }),
      J({ key: 'K3', listingId: 'L3', assigned: [4], tone: 'idle', word: 'Not started' }),
      J({ key: 'K5', listingId: 'L5', assigned: [4], tone: 'idle', word: 'Not started' }),
    ],
    arrivals: [
      A({ id: '1', listingId: 'L1', prevKey: 'K1', tone: 'bad', word: 'Blocked', cause: 'No cleaner assigned, and urgent ticket open: Gas not working (MNT-585).' }),
      A({ id: '2', listingId: 'L2', prevKey: 'K2', tone: 'bad', word: 'Blocked', cause: 'No cleaner assigned. Checkout today at 11:00, 4 h turnaround.' }),
      A({ id: '3', listingId: 'L3', prevKey: 'K3', tone: 'bad', word: 'Blocked', cause: 'Urgent ticket open: AC leaking (MNT-600).', assigned: [4] }),
      A({ id: '4', listingId: 'L4', prevKey: '2026-11-18_Ed Gu', tone: 'bad', word: 'Blocked', cause: 'Cleaning postponed to 22/11.' }),
      A({ id: '5', listingId: 'L5', prevKey: 'K5', tone: 'warn', word: 'At risk', cause: 'Not started yet, Faiza.', assigned: [4] }),
    ],
  }));
  assert.deepEqual(unit(d, 'K1').reasons, [
    { type: 'ticket', ref: 'MNT-585', title: 'Gas not working', since: '31/10', tech: null },
    { type: 'cleaning', elite: true },
  ]);
  assert.deepEqual(unit(d, 'K2').reasons, [{ type: 'cleaning', elite: false }]);
  // Menage avec une personne : la ligne Cleaner s'ajoute au ticket (tache 4, decision du controleur).
  assert.deepEqual(unit(d, 'K3').reasons, [
    { type: 'ticket', ref: 'MNT-600', title: 'AC leaking', since: '01/11', tech: 'Semax' },
    { type: 'cleaner', word: 'Not started' },
  ]);
  assert.deepEqual(unit(d, 'arr:4').reasons, [{ type: 'cause', text: 'Cleaning postponed to 22/11.' }]);
  assert.deepEqual(unit(d, 'K5').reasons, []); // pas bloque
  // Tous les tickets ouverts du logement restent sur l'unite, urgents ou non.
  assert.deepEqual(unit(d, 'K1').tickets, [
    { id: 585, ref: 'MNT-585', title: 'Gas not working', priority: 'urgent', since: '31/10', tech: null },
    { id: 590, ref: 'MNT-590', title: 'Door handle loose', priority: 'medium', since: '02/11', tech: 'Semax' },
  ]);
  assert.deepEqual(unit(d, 'K2').tickets, []);
});

// 16
test('timesLine : gabarits de la page de test et ecarts voulus', () => {
  const line = (o) => buildToday(today({ jobs: [J(o)] })).units[0].timesLine;
  // Gabarits de la page de test.
  assert.equal(line({ next: nextOn(DAY, '15:00') }), 'Out 11:00. Guest arrives the same day at 15:00.');
  assert.equal(line({ next: nextOn(DAY, null) }), 'Out 11:00. Guest arrives the same day.');
  assert.equal(line({ checkout: null, next: nextOn(DAY, '15:00') }), 'Checkout time not set. Guest arrives the same day at 15:00.');
  assert.equal(line({ next: nextOn(SAT, '16:00') }), 'Out 11:00. Next guest tomorrow at 16:00.');
  assert.equal(line({ next: nextOn('2026-11-24', null) }), 'Out 11:00. Next guest Tue 24.');
  // Ecarts : pas de prochain guest, extra, report, Owner.
  assert.equal(line({ next: null }), 'Out 11:00. No guest in the next 14 days.');
  assert.equal(line({ kind: 'extra', checkout: null, extraTime: '14:00', next: nextOn(SAT, '16:00') }), 'Extra cleaning at 14:00. Next guest tomorrow at 16:00.');
  assert.equal(line({ kind: 'extra', checkout: null, next: null }), 'Extra cleaning. No guest in the next 14 days.');
  assert.equal(line({ checkout: null, checkoutDate: '2026-11-19', postponedFrom: '2026-11-19', next: nextOn('2026-11-22', '15:00') }),
    'Postponed from 19/11. Next guest Sun 22 at 15:00.');
  assert.equal(line({ kind: 'extra', checkout: null, postponedFrom: '2026-11-19', next: nextOn(DAY, '15:00') }),
    'Extra cleaning. Postponed from 19/11. Guest arrives the same day at 15:00.');
  assert.equal(line({ next: nextOn(DAY, '16:00', true) }), 'Out 11:00. Owner arrives the same day at 16:00.');
  assert.equal(line({ next: nextOn(SAT, null, true) }), 'Out 11:00. Next owner tomorrow.');
  // Logement avec arrivee : l'heure d'arrivee est celle du moment, la ligne ne dit que le depart.
  const merged = (o) => buildToday(today({
    jobs: [J({ key: 'K1', assigned: [4], tone: 'idle', word: 'Not started', next: nextOn(DAY), ...o })],
    arrivals: [A({ prevKey: 'K1', tone: 'idle', word: 'Scheduled', assigned: [4] })],
  })).units[0].timesLine;
  assert.equal(merged({ checkout: '12:00' }), 'Out 12:00.');
  assert.equal(merged({ checkout: null }), 'Checkout time not set.');
  // Arrivee seule (menage d'avant un autre jour) : aucun depart aujourd'hui, ligne vide.
  assert.equal(buildToday(today({ arrivals: [A({ prevKey: '2026-11-18_Fa Ho', tone: 'warn', word: 'At risk' })] })).units[0].timesLine, '');
  // Arrivee d'un proprietaire : marquee pour « Owner due today at 16:00 ».
  assert.equal(buildToday(today({ arrivals: [A({ kind: 'Owner stay', time: '16:00' })] })).units[0].arrival.owner, true);
  // Autre jour : « the next day » au lieu de « tomorrow » ; l'extra du Planning n'a jamais de prochain guest connu.
  const ahead = buildAhead(week([
    PJ({ key: 'P1', next: { date: '2026-11-22', time: '15:00', sameDay: false, before: false } }),
    PJ({ key: 'P2', listingId: 'L2', next: null }),
    PJ({ key: 'P3', listingId: 'L3', kind: 'extra', checkout: null,
      extra: { id: 31, label: 'Deep clean', guestName: null, priceBilled: null, cleanerPrice: null, notes: null, cleaningDate: SAT, cleaningTime: '10:00' } }),
    PJ({ key: 'P4', listingId: 'L4', kind: 'extra', checkout: null, postponedFrom: '2026-11-19',
      extra: { id: 32, label: 'Deep clean', guestName: null, priceBilled: null, cleanerPrice: null, notes: null, cleaningDate: '2026-11-19', cleaningTime: null } }),
  ]), SAT);
  assert.deepEqual(ahead.units.map((u) => u.timesLine), [
    'Out 11:00. Next guest the next day at 15:00.',
    'Out 11:00. No guest in the next 14 days.',
    'Extra cleaning at 10:00.',
    'Extra cleaning. Postponed from 19/11.',
  ]);
  assert.equal(unit(ahead, 'P3').job.extraTime, '10:00');
});

// 17 (reprise avant revue) : donnees d'un autre jour que l'horloge (apres minuit), jamais
// « today » : « on Friday » d'apres day.date. Sans option, ou today: true, rien ne change.
test('phrase d une journee qui n est plus aujourd hui : on Friday au lieu de today', () => {
  const d = buildToday(D7());
  assert.equal(sentence(d, { today: false }), '7 guests arrive on Friday. 6 apartments are ready, 1 is blocked. 6 cleanings, 1 expected with Elite.');
  assert.equal(sentence(d, { today: true }), sentence(d));
  const one = buildToday(today({
    jobs: [J({ key: 'K1', assigned: [4], state: 'done', tone: 'ok', word: 'Done', next: nextOn(DAY) })],
    arrivals: [A({ id: '1', prevKey: 'K1', assigned: [4], done: true })],
  }));
  assert.equal(sentence(one, { today: false }), '1 guest arrives on Friday. 1 apartment is ready. 1 cleaning, all with a cleaner.');
  assert.equal(sentence(buildToday(today()), { today: false }), 'No guest arrives on Friday. No cleaning planned.');
  // Nom du jour lu sur la chaine YYYY-MM-DD : un samedi reste Saturday quel que soit le fuseau.
  const sat = today();
  sat.day = SAT;
  assert.equal(sentence(buildToday(sat), { today: false }), 'No guest arrives on Saturday. No cleaning planned.');
  // Autre jour de la bande (mgr.planning) : branche inchangee.
  assert.equal(sentence(buildAhead(week([]), SAT), { today: false }), 'No cleaning planned.');
});

// 18 (reprise avant revue) : la ligne des heures ne repete pas « Checkout time not set. »
// quand la cause du proxy, affichee sur la meme carte, le dit deja (sans tenir compte de la casse).
test('ligne des heures : pas de Checkout time not set. quand la cause affichee le dit deja', () => {
  const cause = 'Not started yet, Faiza. Guest in 4 h, checkout time not set.'; // forme reelle du proxy
  const risk = buildToday(today({
    jobs: [J({ key: 'K1', checkout: null, assigned: [4], tone: 'warn', word: 'Not started', next: nextOn(DAY) })],
    arrivals: [A({ prevKey: 'K1', tone: 'warn', word: 'At risk', cause, assigned: [4], cleaners: ['Faiza'] })],
  }));
  assert.equal(unit(risk, 'K1').cause, cause);
  assert.equal(unit(risk, 'K1').timesLine, '');
  // Scheduled, cause en majuscules : meme regle.
  const sched = buildToday(today({
    jobs: [J({ key: 'K1', checkout: null, assigned: [4], tone: 'idle', word: 'Not started', next: nextOn(DAY, '20:00') })],
    arrivals: [A({ prevKey: 'K1', time: '20:00', tone: 'idle', word: 'Scheduled', cause: 'Faiza assigned. CHECKOUT TIME NOT SET.', assigned: [4] })],
  }));
  assert.equal(unit(sched, 'K1').timesLine, '');
  // Cause qui ne le dit pas : la ligne le dit.
  const other = buildToday(today({
    jobs: [J({ key: 'K1', checkout: null, assigned: [4], tone: 'warn', word: 'Not started', next: nextOn(DAY) })],
    arrivals: [A({ prevKey: 'K1', tone: 'warn', word: 'At risk', cause: 'Not started yet, Faiza. Guest in 4 h.', assigned: [4] })],
  }));
  assert.equal(unit(other, 'K1').timesLine, 'Checkout time not set.');
  // Carte Blocked avec un menage sans personne : la cause n'est pas affichee, la raison garde la ligne.
  const blocked = buildToday(today({
    jobs: [J({ key: 'K1', checkout: null, next: nextOn(DAY) })],
    arrivals: [A({ prevKey: 'K1', tone: 'bad', word: 'Blocked', cause: 'No cleaner assigned, checkout time not set.' })],
  }));
  assert.equal(unit(blocked, 'K1').reasons[0].type, 'cleaning');
  assert.equal(unit(blocked, 'K1').timesLine, 'Checkout time not set.');
  // Menage sans arrivee : rien ne change.
  assert.equal(unit(buildToday(today({ jobs: [J({ key: 'K1', checkout: null })] })), 'K1').timesLine, 'Checkout time not set. No guest in the next 14 days.');
});

// 19 (tache 4, decision du controleur) : sur un logement bloque, un menage qui a deja une
// personne ajoute la ligne de la page de test (« Cleaner: … », puis l'etat du menage) aux
// lignes des tickets urgents ; la cause du proxy reste quand ni ticket ni menage sans
// personne n'expliquent le blocage. isNone : logement « sans cleaner » de l'enchainement.
test('reasons : ligne Cleaner d un logement bloque dont le menage a une personne', () => {
  const tickets = { L1: [{ id: 585, title: 'Gas not working', priority: 'urgent', since: '31/10', tech: null }] };
  const blockedWith = (o, a = {}) => buildToday(today({
    tickets,
    jobs: [J({ key: 'K1', listingId: 'L1', assigned: [4], tone: 'warn', word: 'Not started', next: nextOn(DAY), ...o })],
    arrivals: [A({ prevKey: 'K1', listingId: 'L1', tone: 'bad', word: 'Blocked', cause: 'Urgent ticket open: Gas not working (MNT-585).', assigned: [4], ...a })],
  }));
  const ticket = { type: 'ticket', ref: 'MNT-585', title: 'Gas not working', since: '31/10', tech: null };
  assert.deepEqual(unit(blockedWith({}), 'K1').reasons, [ticket, { type: 'cleaner', word: 'Not started' }]);
  assert.deepEqual(unit(blockedWith({ state: 'in_progress' }), 'K1').reasons, [ticket, { type: 'cleaner', word: 'In progress' }]);
  assert.deepEqual(unit(blockedWith({ state: 'done', tone: 'ok', word: 'Done' }), 'K1').reasons, [ticket, { type: 'cleaner', word: 'Done' }]);
  // Ligne des heures inchangee (elle suit la ligne Cleaner dans la vue).
  assert.equal(unit(blockedWith({}), 'K1').timesLine, 'Out 11:00.');
  // Ni ticket urgent ni menage sans personne : la cause du proxy, puis la ligne Cleaner.
  const cancelled = buildToday(today({
    jobs: [J({ key: 'K2', listingId: 'L2', assigned: [10], tone: 'idle', word: 'Not started', next: nextOn(DAY) })],
    arrivals: [A({ prevKey: 'K2', listingId: 'L2', tone: 'bad', word: 'Blocked', cause: 'Cleaning cancelled in HK Planner after the 20/11 checkout.', assigned: [10] })],
  }));
  assert.deepEqual(unit(cancelled, 'K2').reasons, [
    { type: 'cause', text: 'Cleaning cancelled in HK Planner after the 20/11 checkout.' },
    { type: 'cleaner', word: 'Not started' },
  ]);
  // Menage sans personne : toujours « No cleaner assigned », jamais de ligne Cleaner.
  const none = buildToday(today({
    tickets,
    jobs: [J({ key: 'K1', listingId: 'L1', next: nextOn(DAY) })],
    arrivals: [A({ prevKey: 'K1', listingId: 'L1', tone: 'bad', word: 'Blocked', cause: 'No cleaner assigned.' })],
  }));
  assert.deepEqual(unit(none, 'K1').reasons, [ticket, { type: 'cleaning', elite: false }]);
  // Arrivee seule (aucun menage du jour) : la cause seule.
  const alone = buildToday(today({ arrivals: [A({ id: '4', prevKey: '2026-11-18_Ed Gu', tone: 'bad', word: 'Blocked', cause: 'Cleaning postponed to 22/11.', assigned: [4] })] }));
  assert.deepEqual(unit(alone, 'arr:4').reasons, [{ type: 'cause', text: 'Cleaning postponed to 22/11.' }]);
  // Pas bloque : aucune raison, meme avec une personne.
  assert.deepEqual(unit(blockedWith({}, { tone: 'warn', word: 'At risk' }), 'K1').reasons, []);
  // isNone : menage du jour pas fait, personne dessus, pas attendu chez Elite.
  assert.equal(isNone(unit(none, 'K1')), true);
  assert.equal(isNone(unit(blockedWith({}), 'K1')), false);
  assert.equal(isNone(unit(alone, 'arr:4')), false);
  assert.equal(isNone(unit(buildToday(today({ jobs: [J({ key: 'K5', tone: 'warn', word: 'Not logged yet' })] })), 'K5')), false);
  assert.equal(isNone(unit(buildToday(today({ jobs: [J({ key: 'K6', state: 'done', tone: 'ok', word: 'Done' })] })), 'K6')), false);
});
