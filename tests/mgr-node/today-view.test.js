// Vue de Today (manager/screens/today-view.js) : pied de la fiche d'une arrivee (revue finale, F1).
// La vue importe des chemins absolus du site (/manager/..., /v3/...) : node les resout depuis la
// racine du depot (registerHooks), sans rien charger d'autre. Jeux d'essai inventes, aucun vrai
// nom de guest.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
registerHooks({
  resolve(spec, ctx, next) { return next(/^\/(manager|v3)\//.test(spec) ? pathToFileURL(ROOT + spec.slice(1)).href : spec, ctx); },
});
const { arrivalSheet, jobSheet } = await import('../../manager/screens/today-view.js');

const DAY = '2026-11-24';
const NOW = Date.parse('2026-11-24T07:00:00Z'); // 11:00 a Dubai
const DATA = {
  day: DAY, ticketsByListing: {},
  assignable: [{ id: 4, name: 'Faiza', role: 'cleaner' }, { id: 10, name: 'Pionah', role: 'cleaner' }],
  who: { jobs: [], people: [] }, arrivals: { rows: [] },
};
// Une arrivee de mgr.today (MgrArrival, mgr_today.ts) dont le menage d'avant est un autre jour.
const A = (o) => ({
  id: '6', listingId: 'L3', apt: '805', bld: 'Azizi Riviera 39', time: '16:00', timeSet: true, kind: 'Guest', tone: 'bad', word: 'Blocked',
  cause: 'No cleaner assigned. Checkout 23/11.', prevKey: '2026-11-23_Ed Gu', prevCheckout: { date: '2026-11-23', time: '12:00' },
  cleaners: [], assigned: [], serviceType: null, done: false, ...o,
});
const foot = (html) => html.slice(html.indexOf('<div class="sheet-f">'));
const assignBtn = (html) => (foot(html).match(/<button[^>]*data-assign="[^"]*"[^>]*>([^<]*)<\/button>/) || [])[1] || null;

test('fiche d une arrivee : menage d avant annule ou reporte, ni Assign cleaner ni Reassign, Mark done reste', () => {
  const cases = [
    A({ cause: 'Cleaning cancelled in HK Planner after the 23/11 checkout.', assigned: [4], cleaners: ['Faiza'] }),
    A({ cause: 'Cleaning cancelled in HK Planner after the 23/11 checkout. Urgent ticket open: AC leaking (MNT-600).' }),
    A({ cause: 'Cleaning postponed to 25/11.' }),
    A({ cause: 'Cleaning postponed to 25/11.', assigned: [10], cleaners: ['Pionah'] }),
  ];
  for (const a of cases) {
    const html = arrivalSheet(DATA, a, NOW, false);
    assert.equal(assignBtn(html), null, a.cause);
    assert.doesNotMatch(foot(html), /data-assign|Assign cleaner|Reassign/, a.cause);
    assert.match(foot(html), /data-done="2026-11-23_Ed Gu" data-val="1">Mark done</, a.cause);
    assert.match(foot(html), /data-close>Close</, a.cause);
    // La cause du proxy reste dite dans la fiche.
    assert.ok(html.includes(a.cause), a.cause);
  }
});

test('fiche d une arrivee : les autres causes gardent Assign cleaner ou Reassign', () => {
  assert.equal(assignBtn(arrivalSheet(DATA, A({}), NOW, false)), 'Assign cleaner');
  assert.equal(assignBtn(arrivalSheet(DATA, A({ cause: 'No cleaner assigned, and urgent ticket open: Gas not working (MNT-429).' }), NOW, false)), 'Assign cleaner');
  assert.equal(assignBtn(arrivalSheet(DATA, A({ tone: 'warn', word: 'At risk', cause: 'Not started yet, Faiza. Guest in 5 h, checkout 23/11.',
    assigned: [4], cleaners: ['Faiza'] }), NOW, false)), 'Reassign');
  // « postponed » ailleurs que tout au debut : bouton garde.
  assert.equal(assignBtn(arrivalSheet(DATA, A({ cause: 'Urgent ticket open: Cleaning postponed to 25/11.', assigned: [4], cleaners: ['Faiza'] }), NOW, false)), 'Reassign');
  // Lecture seule : aucun bouton d'ecriture, comme avant.
  const ro = arrivalSheet(DATA, A({ cause: 'Cleaning postponed to 25/11.' }), NOW, true);
  assert.doesNotMatch(foot(ro), /data-assign|data-done/);
  assert.match(foot(ro), /Reconnect to make changes\./);
  // Arrivee sans menage d'avant : Close seul, comme avant.
  assert.doesNotMatch(foot(arrivalSheet(DATA, A({ prevKey: null, cause: 'No checkout in the last 14 days, apartment empty.' }), NOW, false)), /data-assign|data-done/);
});

test('fiche d un menage du jour : Assign cleaner, Reassign inchanges', () => {
  const job = { key: '2026-11-24_Lu Mo', kind: 'checkout', listingId: 'L9', apt: '909', bld: 'Bloom Height', checkout: '11:00', checkoutDate: DAY,
    postponedFrom: null, next: null, extraTime: null, assigned: [], serviceType: null, state: 'not_started', tone: 'bad', word: 'Unassigned' };
  assert.equal(assignBtn(jobSheet(DATA, job, NOW, false)), 'Assign cleaner');
  assert.equal(assignBtn(jobSheet(DATA, { ...job, assigned: [4] }, NOW, false)), 'Reassign');
  assert.equal(assignBtn(jobSheet(DATA, { ...job, assigned: [4], state: 'done' }, NOW, false)), 'Reassign');
});
