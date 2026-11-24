import { test, expect, type Page } from '@playwright/test';
import { bootMgr, fetchLog, MANAGER, me } from './helpers';
import { lookMetrics } from './look';
import { todayBody } from './fixtures';
import { daysOf, IDEM, isMobile, noIdem, OK, PLAN, planningBody, PNOW, writes } from './planning-fixtures';

// Ecran Assign (lot 4b, spec-quick-assign section 3) : une ligne par menage, une initiale par
// personne, un toucher affecte ou retire. Horloge : vendredi 9 octobre 2026, 11:00 a Dubai ; la
// bande va du 9 au 15, sur deux semaines (PLAN repond pour les deux start). Noms inventes.
const HASH = '#/assign?d=2026-10-09';
const PJ = (o: any) => ({
  kind: 'checkout', postponedFrom: null, checkout: '11:00', guest: 'Guest', next: null, assigned: [], serviceType: null,
  state: 'not_started', cancelled: null, laundry: null, extra: null, tone: 'idle', word: 'Scheduled', ...o,
});
// planningBody, plus usuallyElite sur deux menages (Cy Doe, Ro Sa) et deux menages du vendredi.
// Vendredi 9 : No cleaner yet = Bo Ray (guest a 15:00), Ka Lu ; Already assigned = Di Fox, l'extra
// (Pionah) ; Often with Elite = Cy Doe, Ro Sa. Samedi 10 : Fa Ho (Elite Cleaning), Faiza en conge.
function assignBody(over: any = {}) {
  const b = planningBody(over);
  for (const j of b.jobs as any[]) j.usuallyElite = j.key === '2026-10-09_Cy Doe';
  b.jobs.push(
    PJ({ key: '2026-10-09_Ka Lu', listingId: 'L14', apt: '1602', bld: 'The Grand Emaar', date: '2026-10-09', checkout: '10:00',
      guest: 'Ka Lu', serviceType: 'CHC', tone: 'bad', word: 'Unassigned', usuallyElite: false }),
    PJ({ key: '2026-10-09_Ro Sa', listingId: 'L15', apt: '210', bld: 'Marina Gate', date: '2026-10-09', checkout: '12:00',
      guest: 'Ro Sa', usuallyElite: true }),
  );
  return b;
}
// Soir du vendredi 9 : tout est affecte sauf Cy Doe et Ro Sa, attendus chez Elite (« Not logged
// yet », hors du compte de la bande) ; samedi 10, Lu Ma sans personne. Bande : 0 vendredi, 1 samedi.
function eveningBody() {
  const b = assignBody();
  const jobs = b.jobs as any[];
  Object.assign(jobs.find((j) => j.key === '2026-10-09_Bo Ray'), { assigned: [10], tone: 'idle', word: 'Scheduled' });
  Object.assign(jobs.find((j) => j.key === '2026-10-09_Ka Lu'), { assigned: [4], tone: 'idle', word: 'Scheduled' });
  Object.assign(jobs.find((j) => j.key === '2026-10-09_Ro Sa'), { tone: 'warn', word: 'Not logged yet' });
  jobs.push(PJ({ key: '2026-10-10_Lu Ma', listingId: 'L16', apt: '402', bld: 'Tower D', date: '2026-10-10', guest: 'Lu Ma',
    tone: 'bad', word: 'Unassigned', usuallyElite: false }));
  return b;
}
const KL = '2026-10-09_Ka Lu'; // Apt 1602 · The Grand Emaar, personne, CHC
const BR = '2026-10-09_Bo Ray'; // Apt 103 · Damac Reva, personne, type inconnu
const DF = '2026-10-09_Di Fox'; // Apt 805 · Azizi Riviera 39, Pionah dessus
const CD = '2026-10-09_Cy Doe'; // Apt 909 · Bloom Height, Often with Elite
const W1 = (body: any, extra: any = {}) => ({ match: 'action=mgr.planning&start=2026-10-05', status: 200, body, ...extra });
// Semaine du 12 sans menage : PLAN rend la semaine du 5 pour les deux start, et ses menages, lus
// en dernier, couvriraient une semaine du 5 relue differente.
const W2 = () => ({ match: 'action=mgr.planning&start=2026-10-12', status: 200,
  body: planningBody({ start: '2026-10-12', end: '2026-10-18', days: daysOf('2026-10-12'), jobs: [], counts: { total: 0, unassigned: 0, done: 0, cancelled: 0 } }) });
const AW = (extra: any = {}) => ({ match: 'action=assignCleaner', status: 200, body: OK, ...extra });
const CHANGED = (current: number[]) => ({ status: 409, body: { error: 'Changed by someone else.', current } });

const btn = (page: Page, key: string, id: number) => page.locator('[data-qa-key="' + key + '"][data-qa-id="' + id + '"]');
const row = (page: Page, key: string) => page.locator('[data-qa-row="' + key + '"]');
const day = (page: Page, d: string) => page.locator('[data-qa-day="' + d + '"]');
const group = (page: Page, title: string) => page.locator('section.qa-group').filter({ has: page.locator('h2', { hasText: title }) });
const toastBox = (page: Page) => page.locator('#toast');
const undoBtn = (page: Page) => page.locator('#toast [data-undo]');
const load = (page: Page, name: string) => page.locator('.qa-load', { hasText: name }).locator('.qa-lc');
// Ordre des lectures mgr.planning (week) et des ecritures assignCleaner (write).
const order = async (page: Page) => (await fetchLog(page))
  .filter((l) => l.url.includes('action=mgr.planning') || l.url.endsWith('action=assignCleaner'))
  .map((l) => (l.url.endsWith('action=assignCleaner') ? 'write' : 'week'));
const ADD_KL = { reservation_key: KL, cleaner_id: 4, mode: 'add', expect_ids: [], service_type: 'CHC' };

async function boot(page: Page, routes: any[], hash = HASH, opts: { timeoutMs?: number } = {}) {
  await bootMgr(page, [me(MANAGER), ...routes], { email: true, hash, clock: PNOW, ...opts });
  await expect(page.locator('.qa h1')).toHaveText('Assign');
}

test('opens on d with groups and strip counts', async ({ page }) => {
  await boot(page, [PLAN(assignBody())], '#/assign?d=2026-10-10');
  // Bande : 7 jours depuis aujourd'hui ; comptes de Today (sans personne, hors Cy Doe « Not logged
  // yet »), inconnus pour 12-15 (la reponse de la seconde semaine ne porte pas ces jours).
  await expect(page.locator('.qa-day')).toHaveCount(7);
  await expect(page.locator('.qa-day .qa-dl')).toHaveText(['Fri', 'Sat', 'Sun', 'Mon', 'Tue', 'Wed', 'Thu']);
  await expect(page.locator('.qa-dc')).toHaveText(['3', '0', '0', '·', '·', '·', '·']);
  // d = samedi 10 : Faiza en conge, Fa Ho deja chez Elite Cleaning. Le jour est ecrit sous le titre.
  await expect(day(page, '2026-10-10')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.qa-date')).toHaveText('Sat 10 · tomorrow');
  await expect(page.locator('h2.qa-gh')).toHaveText(['Already assigned (1)']);
  await expect(page.locator('.qa-load')).toHaveText(['F Faiza Off', 'P Pionah 0 jobs', 'EC Elite Cleaning 1 job']);
  const fa = btn(page, '2026-10-10_Fa Ho', 4);
  await expect(fa).toHaveAttribute('aria-disabled', 'true');
  await expect(fa).toHaveAttribute('aria-label', 'Faiza, off on Sat 10');
  await expect(btn(page, '2026-10-10_Fa Ho', 12)).toHaveAttribute('aria-pressed', 'true');

  // Vendredi : trois groupes, arrivee du jour d'abord, puis heure de depart.
  await day(page, '2026-10-09').click();
  await expect(day(page, '2026-10-09')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.qa-date')).toHaveText('Fri 9 · today');
  await expect(page.locator('h2.qa-gh')).toHaveText(['No cleaner yet (2)', 'Already assigned (2)', 'Often with Elite (2)']);
  await expect(group(page, 'No cleaner yet').locator('.qa-place')).toHaveText(['Apt 103 · Damac Reva', 'Apt 1602 · The Grand Emaar']);
  await expect(group(page, 'No cleaner yet').locator('.qa-line')).toHaveText(['Out 11:00 · Guest arrives 15:00', 'Out 10:00 · No next guest']);
  await expect(group(page, 'Already assigned').locator('.qa-place')).toHaveText(['Apt 805 · Azizi Riviera 39', 'Apt 808 · Tower H']);
  await expect(page.locator('.qa-load')).toHaveText(['F Faiza 0 jobs', 'P Pionah 2 jobs', 'EC Elite Cleaning 0 jobs']);
  await expect(btn(page, DF, 10)).toHaveAttribute('aria-pressed', 'true');
  await expect(btn(page, DF, 4)).toHaveAttribute('aria-pressed', 'false');
  // Aucune ecriture pour changer de jour.
  expect(await writes(page, 'assignCleaner')).toEqual([]);

  // d hors de la bande : premier jour qui a un menage sans personne (vendredi).
  await page.evaluate(() => { location.hash = '#/assign?d=2026-10-20'; });
  await expect(page.locator('h2.qa-gh').first()).toHaveText('No cleaner yet (2)');
  await expect(day(page, '2026-10-09')).toHaveAttribute('aria-pressed', 'true');
});

test('d equal to today with nothing to assign opens the next day to assign', async ({ page }) => {
  // Lien de Today avec aujourd'hui selectionne, le soir : la bande dit 0 aujourd'hui, l'ecran
  // s'ouvre sur samedi (1 + 4 touchers pour 4 menages de demain).
  await boot(page, [PLAN(eveningBody())], HASH);
  await expect(page.locator('.qa-dc')).toHaveText(['0', '1', '0', '·', '·', '·', '·']);
  await expect(day(page, '2026-10-10')).toHaveAttribute('aria-pressed', 'true');
  // Ouvert sur un autre jour que demande : le jour est ecrit en toutes lettres.
  await expect(page.locator('.qa-date')).toHaveText('Sat 10 · tomorrow');
  await expect(page.locator('h2.qa-gh')).toHaveText(['No cleaner yet (1)', 'Already assigned (1)']);
  await expect(group(page, 'No cleaner yet').locator('.qa-place')).toHaveText(['Apt 402 · Tower D']);
  // Aujourd'hui reste a un toucher : Elite attendu, groupe ouvert.
  await day(page, '2026-10-09').click();
  await expect(page.locator('h2.qa-gh')).toHaveText(['Already assigned (4)', 'Often with Elite (2)']);
});

test('one tap assigns: body is add with expect_ids and service_type, toast with Undo', async ({ page }) => {
  await boot(page, [AW(), PLAN(assignBody())]);
  const b = btn(page, KL, 4);
  await expect(b).toHaveAttribute('aria-label', 'Faiza, Apt 1602 · The Grand Emaar');
  await expect(b).toHaveAttribute('aria-pressed', 'false');
  await b.click();
  await expect(toastBox(page)).toContainText('Apt 1602 · The Grand Emaar assigned to Faiza');
  await expect(undoBtn(page)).toHaveText('Undo');
  await expect(b).toHaveAttribute('aria-pressed', 'true');
  // Le focus revient sur le meme bouton apres le rendu.
  await expect(b).toBeFocused();
  const w = await writes(page, 'assignCleaner');
  expect(noIdem(w)).toEqual([ADD_KL]);
  expect(w[0].idem).toMatch(IDEM);
  // Charge du jour et compte de la bande suivent le toucher.
  await expect(load(page, 'Faiza')).toHaveText('1 job');
  await expect(day(page, '2026-10-09').locator('.qa-dc')).toHaveText('2');

  // Type de service inconnu : pas de service_type.
  await btn(page, BR, 10).click();
  await expect(toastBox(page)).toContainText('Apt 103 · Damac Reva assigned to Pionah');
  expect(noIdem(await writes(page, 'assignCleaner'))[1]).toEqual({ reservation_key: BR, cleaner_id: 10, mode: 'add', expect_ids: [] });
  await expect(load(page, 'Pionah')).toHaveText('3 jobs');
});

test('tap again removes', async ({ page }) => {
  await boot(page, [AW(), PLAN(assignBody())]);
  await btn(page, KL, 4).click();
  await expect(toastBox(page)).toContainText('assigned to Faiza');
  await btn(page, KL, 4).click();
  await expect(toastBox(page)).toContainText('Faiza removed from Apt 1602 · The Grand Emaar');
  await expect(btn(page, KL, 4)).toHaveAttribute('aria-pressed', 'false');
  // Binome : Pionah s'ajoute a cote de Faiza, puis se retire seule.
  await btn(page, DF, 4).click();
  await expect(toastBox(page)).toContainText('Apt 805 · Azizi Riviera 39 assigned to Faiza');
  await btn(page, DF, 10).click();
  await expect(toastBox(page)).toContainText('Pionah removed from Apt 805 · Azizi Riviera 39');
  await expect(btn(page, DF, 4)).toHaveAttribute('aria-pressed', 'true');
  await expect(btn(page, DF, 10)).toHaveAttribute('aria-pressed', 'false');
  expect(noIdem(await writes(page, 'assignCleaner'))).toEqual([
    ADD_KL,
    { reservation_key: KL, cleaner_id: 4, mode: 'remove', expect_ids: [4] },
    { reservation_key: DF, cleaner_id: 4, mode: 'add', expect_ids: [10], service_type: 'CHC' },
    { reservation_key: DF, cleaner_id: 10, mode: 'remove', expect_ids: [4, 10] },
  ]);
});

test('row stays in No cleaner yet after assign', async ({ page }) => {
  await boot(page, [AW(), PLAN(assignBody())]);
  await btn(page, KL, 4).click();
  await expect(toastBox(page)).toContainText('assigned to Faiza');
  // Rien ne bouge sous le doigt : la ligne garde son groupe tant qu'on reste sur ce jour.
  await expect(group(page, 'No cleaner yet').locator('[data-qa-row="' + KL + '"]')).toBeVisible();
  await expect(page.locator('h2.qa-gh')).toHaveText(['No cleaner yet (2)', 'Already assigned (2)', 'Often with Elite (2)']);
  // Une ligne d'Already assigned videe y reste aussi.
  await btn(page, DF, 10).click();
  await expect(toastBox(page)).toContainText('Pionah removed from Apt 805');
  await expect(group(page, 'Already assigned').locator('[data-qa-row="' + DF + '"]')).toBeVisible();
  // Autre jour puis retour : chaque ligne prend son groupe.
  await day(page, '2026-10-10').click();
  await day(page, '2026-10-09').click();
  await expect(group(page, 'Already assigned').locator('[data-qa-row="' + KL + '"]')).toBeVisible();
  await expect(group(page, 'No cleaner yet').locator('[data-qa-row="' + DF + '"]')).toBeVisible();
  await expect(page.locator('h2.qa-gh')).toHaveText(['No cleaner yet (2)', 'Already assigned (2)', 'Often with Elite (2)']);
  expect((await writes(page, 'assignCleaner')).length).toBe(2);
});

test('double tap sends one write', async ({ page }) => {
  await boot(page, [AW({ delay: 1500 }), PLAN(assignBody())]);
  await btn(page, KL, 4).click();
  // Ecriture en cours : la ligne est occupee, la personne deja montree dessus.
  await expect(row(page, KL)).toHaveAttribute('aria-busy', 'true');
  await expect(btn(page, KL, 4)).toHaveAttribute('aria-pressed', 'true');
  await btn(page, KL, 4).click();
  await expect(toastBox(page)).toHaveText('Saving, wait a second.');
  await btn(page, KL, 10).click();
  await expect(toastBox(page)).toHaveText('Saving, wait a second.');
  // Les autres lignes restent libres.
  await btn(page, BR, 10).click();
  await expect(row(page, BR)).toHaveAttribute('aria-busy', 'true');
  await expect(row(page, KL)).not.toHaveAttribute('aria-busy', 'true');
  await expect(row(page, BR)).not.toHaveAttribute('aria-busy', 'true');
  await expect(btn(page, KL, 4)).toHaveAttribute('aria-pressed', 'true');
  await expect(btn(page, KL, 10)).toHaveAttribute('aria-pressed', 'false');
  const w = noIdem(await writes(page, 'assignCleaner'));
  expect(w).toEqual([ADD_KL, { reservation_key: BR, cleaner_id: 10, mode: 'add', expect_ids: [] }]);
});

test('undo sends the reverse with a new idem', async ({ page }) => {
  await boot(page, [AW(), PLAN(assignBody())]);
  await btn(page, KL, 4).click();
  await expect(toastBox(page)).toContainText('Apt 1602 · The Grand Emaar assigned to Faiza');
  await undoBtn(page).click();
  await expect(toastBox(page)).toContainText('Faiza removed from Apt 1602 · The Grand Emaar');
  await expect(btn(page, KL, 4)).toHaveAttribute('aria-pressed', 'false');
  await expect(load(page, 'Faiza')).toHaveText('0 jobs');
  const w = await writes(page, 'assignCleaner');
  expect(noIdem(w)).toEqual([ADD_KL, { reservation_key: KL, cleaner_id: 4, mode: 'remove', expect_ids: [4] }]);
  expect(w[1].idem).toMatch(IDEM);
  expect(w[1].idem).not.toBe(w[0].idem);
});

test('409 current updates the row and says someone else changed', async ({ page }) => {
  await boot(page, [AW({ ...CHANGED([12, 10]), once: true }), AW(), PLAN(assignBody())]);
  await btn(page, KL, 4).click();
  await expect(toastBox(page)).toHaveText('Someone else changed Apt 1602 · The Grand Emaar. Check and tap again.');
  await expect(undoBtn(page)).toHaveCount(0);
  await expect(btn(page, KL, 4)).toHaveAttribute('aria-pressed', 'false');
  await expect(btn(page, KL, 10)).toHaveAttribute('aria-pressed', 'true');
  await expect(btn(page, KL, 12)).toHaveAttribute('aria-pressed', 'true');
  await expect(row(page, KL)).not.toHaveAttribute('aria-busy', 'true');
  // Le toucher suivant part de la liste du serveur.
  await btn(page, KL, 12).click();
  await expect(toastBox(page)).toContainText('Elite Cleaning removed from Apt 1602 · The Grand Emaar');
  expect(noIdem(await writes(page, 'assignCleaner'))).toEqual([
    ADD_KL, { reservation_key: KL, cleaner_id: 12, mode: 'remove', expect_ids: [10, 12] },
  ]);
});

test('undo conflict shows someone else changed', async ({ page }) => {
  await boot(page, [AW({ once: true }), AW(CHANGED([4, 10])), PLAN(assignBody())]);
  await btn(page, KL, 4).click();
  await expect(toastBox(page)).toContainText('assigned to Faiza');
  await undoBtn(page).click();
  await expect(toastBox(page)).toHaveText('Someone else changed Apt 1602 · The Grand Emaar. Check and tap again.');
  await expect(btn(page, KL, 4)).toHaveAttribute('aria-pressed', 'true');
  await expect(btn(page, KL, 10)).toHaveAttribute('aria-pressed', 'true');
  expect(noIdem(await writes(page, 'assignCleaner'))).toEqual([
    ADD_KL, { reservation_key: KL, cleaner_id: 4, mode: 'remove', expect_ids: [4] },
  ]);
});

test('leave refusal restores the row', async ({ page }) => {
  await boot(page, [AW({ status: 409, body: { error: 'Faiza is on approved leave on 2026-10-10' } }), PLAN(assignBody())]);
  await btn(page, KL, 4).click();
  await expect(toastBox(page)).toHaveText('Faiza is on approved leave on 2026-10-10');
  await expect(btn(page, KL, 4)).toHaveAttribute('aria-pressed', 'false');
  await expect(row(page, KL)).not.toHaveAttribute('aria-busy', 'true');
  await expect(load(page, 'Faiza')).toHaveText('0 jobs');
  await expect(day(page, '2026-10-09').locator('.qa-dc')).toHaveText('3');
  expect(noIdem(await writes(page, 'assignCleaner'))).toEqual([ADD_KL]);
});

test('an unexpected error during a tap frees the row and puts the list back', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await boot(page, [AW(), PLAN(assignBody())]);
  // Exception imprevue simulee, une seule fois : le rendu qui suit le toucher (focusMark, avant
  // l'envoi) leve. Rien n'est parti : la ligne revient libre, Faiza n'y est plus montree.
  await page.evaluate(() => {
    const esc = CSS.escape;
    CSS.escape = () => { CSS.escape = esc; throw new Error('Something broke.'); };
  });
  await btn(page, KL, 4).click();
  await expect(toastBox(page)).toHaveText('Something broke.');
  await expect(row(page, KL)).not.toHaveAttribute('aria-busy', 'true');
  await expect(btn(page, KL, 4)).toHaveAttribute('aria-pressed', 'false');
  expect(await writes(page, 'assignCleaner')).toEqual([]);
  // Retouchable : le toucher suivant ecrit, depuis la liste d'avant.
  await btn(page, KL, 4).click();
  await expect(toastBox(page)).toContainText('Apt 1602 · The Grand Emaar assigned to Faiza');
  expect(noIdem(await writes(page, 'assignCleaner'))).toEqual([ADD_KL]);
  expect(errors).toEqual([]);
});

test('replayed write answered 409 with current equal to after counts as success', async ({ page }) => {
  // Premier envoi perdu (ecriture peut-etre faite), le geste rejoue garde sa cle ; le serveur,
  // sans idempotence pour assignCleaner, repond 409 avec la liste voulue : c'est une reussite.
  await boot(page, [AW({ fail: true, once: true }), AW({ ...CHANGED([4]), once: true }), AW(), PLAN(assignBody())]);
  await btn(page, KL, 4).click();
  await expect(toastBox(page)).toHaveText('No connection. Try again.');
  await expect(btn(page, KL, 4)).toHaveAttribute('aria-pressed', 'false');
  await btn(page, KL, 4).click();
  await expect(toastBox(page)).toContainText('Apt 1602 · The Grand Emaar assigned to Faiza');
  await expect(undoBtn(page)).toBeVisible();
  await expect(btn(page, KL, 4)).toHaveAttribute('aria-pressed', 'true');
  const w = await writes(page, 'assignCleaner');
  expect(noIdem(w)).toEqual([ADD_KL, ADD_KL]);
  expect(w[1].idem).toBe(w[0].idem);
  // Meme Undo qu'une reussite.
  await undoBtn(page).click();
  await expect(toastBox(page)).toContainText('Faiza removed from Apt 1602 · The Grand Emaar');
  expect(noIdem(await writes(page, 'assignCleaner'))[2]).toEqual({ reservation_key: KL, cleaner_id: 4, mode: 'remove', expect_ids: [4] });
});

test('stale data re-reads before writing', async ({ page }) => {
  // Lectures de la semaine du 5 : au chargement, a la premiere relecture, puis Bo Ray chez Elite.
  const changed = assignBody();
  (changed.jobs as any[]).find((j) => j.key === BR).assigned = [12];
  (changed.jobs as any[]).find((j) => j.key === KL).assigned = [4];
  await boot(page, [AW(), W1(assignBody(), { once: true }), W1(assignBody(), { once: true }), W1(changed), W2()]);
  await expect(row(page, KL)).toBeVisible();
  expect(await order(page)).toEqual(['week', 'week']);
  // Plus de 60 s : les deux semaines sont relues avant l'ecriture.
  await page.clock.setFixedTime(new Date(PNOW.getTime() + 61_000));
  await btn(page, KL, 4).click();
  await expect(toastBox(page)).toContainText('Apt 1602 · The Grand Emaar assigned to Faiza');
  expect(await order(page)).toEqual(['week', 'week', 'week', 'week', 'write']);
  // Moins de 60 s apres la relecture : ecriture directe.
  await btn(page, DF, 4).click();
  await expect(toastBox(page)).toContainText('Apt 805 · Azizi Riviera 39 assigned to Faiza');
  expect(await order(page)).toEqual(['week', 'week', 'week', 'week', 'write', 'write']);
  // Encore 60 s, et Bo Ray a change pendant la relecture : rien n'est ecrit, la ligne se met a jour.
  await page.clock.setFixedTime(new Date(PNOW.getTime() + 122_000));
  await btn(page, BR, 4).click();
  await expect(toastBox(page)).toHaveText('Apt 103 · Damac Reva changed. Check and tap again.');
  expect(await order(page)).toEqual(['week', 'week', 'week', 'week', 'write', 'write', 'week', 'week']);
  await expect(btn(page, BR, 12)).toHaveAttribute('aria-pressed', 'true');
  await expect(btn(page, BR, 4)).toHaveAttribute('aria-pressed', 'false');
  await expect(row(page, BR)).not.toHaveAttribute('aria-busy', 'true');
  await expect(group(page, 'No cleaner yet').locator('[data-qa-row="' + BR + '"]')).toBeVisible();
});

test('after a re-read, rows shown but not touched keep their group while on that day', async ({ page }) => {
  // Relecture (toucher au-dela de 60 s) : Bo Ray a recu Elite Cleaning ailleurs, Cy Doe (Often with
  // Elite) Pionah, et Di Fox a perdu Pionah. Lignes non touchees : aucune ne change de groupe.
  const changed = assignBody();
  const jobs = changed.jobs as any[];
  jobs.find((j) => j.key === BR).assigned = [12];
  jobs.find((j) => j.key === CD).assigned = [10];
  jobs.find((j) => j.key === DF).assigned = [];
  await boot(page, [AW(), W1(assignBody(), { once: true }), W1(changed), W2()]);
  const heads = ['No cleaner yet (2)', 'Already assigned (2)', 'Often with Elite (2)'];
  await expect(page.locator('h2.qa-gh')).toHaveText(heads);
  await page.clock.setFixedTime(new Date(PNOW.getTime() + 61_000));
  await btn(page, KL, 4).click();
  await expect(toastBox(page)).toContainText('Apt 1602 · The Grand Emaar assigned to Faiza');
  expect(await order(page)).toEqual(['week', 'week', 'week', 'week', 'write']);
  // La relecture se voit sur les initiales, pas sur les groupes.
  await expect(btn(page, BR, 12)).toHaveAttribute('aria-pressed', 'true');
  await expect(btn(page, CD, 10)).toHaveAttribute('aria-pressed', 'true');
  await expect(btn(page, DF, 10)).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('h2.qa-gh')).toHaveText(heads);
  await expect(group(page, 'No cleaner yet').locator('[data-qa-row="' + BR + '"]')).toBeVisible();
  await expect(group(page, 'Often with Elite').locator('[data-qa-row="' + CD + '"]')).toBeVisible();
  await expect(group(page, 'Already assigned').locator('[data-qa-row="' + DF + '"]')).toBeVisible();
  // Autre jour puis retour : chaque ligne prend son groupe.
  await day(page, '2026-10-10').click();
  await day(page, '2026-10-09').click();
  await expect(page.locator('h2.qa-gh')).toHaveText(['No cleaner yet (1)', 'Already assigned (4)', 'Often with Elite (1)']);
  await expect(group(page, 'Already assigned').locator('[data-qa-row="' + BR + '"]')).toBeVisible();
  await expect(group(page, 'Already assigned').locator('[data-qa-row="' + CD + '"]')).toBeVisible();
  await expect(group(page, 'No cleaner yet').locator('[data-qa-row="' + DF + '"]')).toBeVisible();
});

test('past midnight the screen moves to the new day and rows take their group again', async ({ page }) => {
  // Vendredi 9 a l'ecran, Bo Ray dans No cleaner yet (epingle). Samedi 00:30 a Dubai, plus de 60 s :
  // le toucher relit ; Bo Ray, reporte au samedi (meme cle) et pris par Pionah, a change : rien
  // d'ecrit. L'ecran passe a samedi, et Bo Ray y prend son groupe (Already assigned), pas celui de
  // vendredi.
  const night = assignBody({ today: '2026-10-10' });
  Object.assign((night.jobs as any[]).find((j) => j.key === BR), { date: '2026-10-10', postponedFrom: '2026-10-09', checkout: null, assigned: [10] });
  await boot(page, [AW(), W1(assignBody(), { once: true }), W1(night), W2()]);
  await expect(group(page, 'No cleaner yet').locator('[data-qa-row="' + BR + '"]')).toBeVisible();
  await page.clock.setFixedTime(new Date('2026-10-09T20:30:00Z'));
  await btn(page, BR, 4).click();
  await expect(toastBox(page)).toHaveText('Apt 103 · Damac Reva changed. Check and tap again.');
  await expect(page.locator('.qa-date')).toHaveText('Sat 10 · today');
  await expect(day(page, '2026-10-10')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('h2.qa-gh')).toHaveText(['Already assigned (2)']);
  await expect(group(page, 'Already assigned').locator('[data-qa-row="' + BR + '"]')).toBeVisible();
  await expect(btn(page, BR, 10)).toHaveAttribute('aria-pressed', 'true');
  expect(await writes(page, 'assignCleaner')).toEqual([]);
});

// Echec incertain (delai depasse, reseau, 5xx) : le message s'affiche, la semaine est relue tout
// de suite, puis le toast dit ce que la relecture montre pour la ligne : liste voulue = reussite
// (avec Undo), liste d'avant = le message, autre liste = changed.
test('5xx on a write, re-read shows the write done: success toast with Undo', async ({ page }) => {
  const written = assignBody();
  (written.jobs as any[]).find((j) => j.key === KL).assigned = [4];
  await boot(page, [AW({ status: 503, body: { error: 'Service unavailable' }, once: true }), AW(),
    W1(assignBody(), { once: true }), W1(written), W2()]);
  await expect(row(page, KL)).toBeVisible();
  await btn(page, KL, 4).click();
  await expect.poll(() => order(page)).toEqual(['week', 'week', 'write', 'week', 'week']);
  await expect(row(page, KL)).not.toHaveAttribute('aria-busy', 'true');
  await expect(toastBox(page)).toContainText('Apt 1602 · The Grand Emaar assigned to Faiza');
  await expect(btn(page, KL, 4)).toHaveAttribute('aria-pressed', 'true');
  await expect(load(page, 'Faiza')).toHaveText('1 job');
  // Undo : le geste inverse, cle neuve.
  await undoBtn(page).click();
  await expect(toastBox(page)).toContainText('Faiza removed from Apt 1602 · The Grand Emaar');
  const w = await writes(page, 'assignCleaner');
  expect(noIdem(w)).toEqual([ADD_KL, { reservation_key: KL, cleaner_id: 4, mode: 'remove', expect_ids: [4] }]);
  expect(w[1].idem).not.toBe(w[0].idem);
});

test('timed-out write, re-read shows the write done: success toast, next tap removes', async ({ page }) => {
  // Le proxy a fini l'ecriture apres l'abandon du client : la ligne montre Faiza, le toast dit la
  // reussite (pas « Try again ») ; le toucher suivant sur Faiza la retire, sans renvoyer l'ajout.
  const written = assignBody();
  (written.jobs as any[]).find((j) => j.key === KL).assigned = [4];
  await boot(page, [AW({ delay: 5000, once: true }), AW(), W1(assignBody(), { once: true }), W1(written), W2()], HASH, { timeoutMs: 1000 });
  await expect(row(page, KL)).toBeVisible();
  await btn(page, KL, 4).click();
  await expect.poll(() => order(page)).toEqual(['week', 'week', 'write', 'week', 'week']);
  await expect(row(page, KL)).not.toHaveAttribute('aria-busy', 'true');
  await expect(toastBox(page)).toContainText('Apt 1602 · The Grand Emaar assigned to Faiza');
  await expect(undoBtn(page)).toHaveText('Undo');
  await expect(btn(page, KL, 4)).toHaveAttribute('aria-pressed', 'true');
  await btn(page, KL, 4).click();
  await expect(toastBox(page)).toContainText('Faiza removed from Apt 1602 · The Grand Emaar');
  await expect(btn(page, KL, 4)).toHaveAttribute('aria-pressed', 'false');
  expect(noIdem(await writes(page, 'assignCleaner'))).toEqual([ADD_KL, { reservation_key: KL, cleaner_id: 4, mode: 'remove', expect_ids: [4] }]);
});

test('timed-out write, re-read shows the list from before: error message, tap again replays', async ({ page }) => {
  // Rien d'ecrit : la ligne revient vide, le message reste ; toucher a nouveau rejoue le meme geste
  // avec la meme cle.
  await boot(page, [AW({ delay: 5000, once: true }), AW(), W1(assignBody(), { once: true }), W1(assignBody()), W2()], HASH, { timeoutMs: 1000 });
  await expect(row(page, KL)).toBeVisible();
  await btn(page, KL, 4).click();
  await expect.poll(() => order(page)).toEqual(['week', 'week', 'write', 'week', 'week']);
  await expect(row(page, KL)).not.toHaveAttribute('aria-busy', 'true');
  await expect(btn(page, KL, 4)).toHaveAttribute('aria-pressed', 'false');
  await expect(toastBox(page)).toHaveText('HK Planner is taking too long to answer. Try again.');
  await btn(page, KL, 4).click();
  await expect(toastBox(page)).toContainText('Apt 1602 · The Grand Emaar assigned to Faiza');
  const w = await writes(page, 'assignCleaner');
  expect(noIdem(w)).toEqual([ADD_KL, ADD_KL]);
  expect(w[1].idem).toBe(w[0].idem);
});

test('timed-out write, re-read shows another list: changed, check and tap again', async ({ page }) => {
  // L'ecriture n'a pas eu lieu, mais un collegue a mis Pionah entre-temps. La ligne montre Pionah
  // (le serveur), ni Faiza (le geste) ni la ligne vide d'avant.
  const other = assignBody();
  (other.jobs as any[]).find((j) => j.key === KL).assigned = [10];
  await boot(page, [AW({ delay: 5000, once: true }), W1(assignBody(), { once: true }), W1(other), W2()], HASH, { timeoutMs: 1000 });
  await expect(row(page, KL)).toBeVisible();
  await btn(page, KL, 4).click();
  await expect.poll(() => order(page)).toEqual(['week', 'week', 'write', 'week', 'week']);
  await expect(row(page, KL)).not.toHaveAttribute('aria-busy', 'true');
  await expect(toastBox(page)).toHaveText('Apt 1602 · The Grand Emaar changed. Check and tap again.');
  await expect(btn(page, KL, 10)).toHaveAttribute('aria-pressed', 'true');
  await expect(btn(page, KL, 4)).toHaveAttribute('aria-pressed', 'false');
  await expect(group(page, 'No cleaner yet').locator('[data-qa-row="' + KL + '"]')).toBeVisible();
  expect(noIdem(await writes(page, 'assignCleaner'))).toEqual([ADD_KL]);
});

test('a re-read that starts during a write does not undo it', async ({ page }) => {
  // Ecriture de Ka Lu en vol (0,8 s) ; un toucher au-dela de 60 s sur Bo Ray lance une relecture
  // lente (1,6 s) dont la reponse n'a pas encore Faiza sur Ka Lu. L'ecriture, finie pendant la
  // relecture, reste a l'ecran : la relecture etait partie avant elle (compteur tick).
  await boot(page, [AW({ delay: 800 }), W1(assignBody(), { once: true }), W1(assignBody(), { delay: 1600 }), W2()]);
  await expect(row(page, KL)).toBeVisible();
  await btn(page, KL, 4).click();
  await expect(row(page, KL)).toHaveAttribute('aria-busy', 'true');
  await page.clock.setFixedTime(new Date(PNOW.getTime() + 61_000));
  await btn(page, BR, 10).click();
  await expect(toastBox(page)).toContainText('Apt 1602 · The Grand Emaar assigned to Faiza');
  await expect(toastBox(page)).toContainText('Apt 103 · Damac Reva assigned to Pionah');
  expect(await order(page)).toEqual(['week', 'week', 'write', 'week', 'week', 'write']);
  await expect(btn(page, KL, 4)).toHaveAttribute('aria-pressed', 'true');
  await expect(load(page, 'Faiza')).toHaveText('1 job');
  await expect(btn(page, BR, 10)).toHaveAttribute('aria-pressed', 'true');
});

test('stale re-read failing turns the day read-only', async ({ page }) => {
  await boot(page, [AW(), W1(assignBody(), { once: true }), W1(null, { status: 503, body: { error: 'Service unavailable' }, once: true }),
    PLAN(assignBody())]);
  await expect(row(page, KL)).toBeVisible();
  await page.clock.setFixedTime(new Date(PNOW.getTime() + 61_000));
  await btn(page, KL, 4).click();
  await expect(toastBox(page)).toHaveText('Reconnect to make changes.');
  await expect(page.locator('.qa-rol')).toHaveText('Reconnect to make changes.');
  await expect(btn(page, KL, 4)).toHaveAttribute('aria-disabled', 'true');
  await expect(btn(page, KL, 4)).toHaveAttribute('aria-pressed', 'false');
  expect(await writes(page, 'assignCleaner')).toEqual([]);
  // Retry : la semaine relue, les gestes reviennent.
  await page.locator('[data-qa-retry]').click();
  await expect(page.locator('.qa-ro')).toHaveCount(0);
  await btn(page, KL, 4).click();
  await expect(toastBox(page)).toContainText('assigned to Faiza');
  expect(noIdem(await writes(page, 'assignCleaner'))).toEqual([ADD_KL]);
});

test('read-only tap on an initial says reconnect and writes nothing', async ({ page }) => {
  await boot(page, [AW(), W1(assignBody(), { once: true }), W1(null, { status: 503, body: { error: 'Service unavailable' }, once: true }),
    PLAN(assignBody())]);
  await expect(row(page, KL)).toBeVisible();
  await page.clock.setFixedTime(new Date(PNOW.getTime() + 61_000));
  await btn(page, KL, 4).click();
  await expect(page.locator('.qa-rol')).toHaveText('Reconnect to make changes.');
  // Estompees, libres ou deja sur le menage : l'etat se voit sans curseur (ecran tactile).
  await expect(btn(page, BR, 10)).toHaveAttribute('aria-disabled', 'true');
  await expect(btn(page, BR, 10)).toHaveCSS('opacity', '0.55');
  await expect(btn(page, DF, 10)).toHaveAttribute('aria-pressed', 'true');
  await expect(btn(page, DF, 10)).toHaveCSS('opacity', '0.55');
  // Toast vide, puis toucher d'une autre initiale (refusee : force, comme un doigt) : il le redit.
  await page.evaluate(() => { document.getElementById('toast')!.textContent = ''; });
  await btn(page, BR, 10).click({ force: true });
  await expect(toastBox(page)).toHaveText('Reconnect to make changes.');
  await expect(btn(page, BR, 10)).toHaveAttribute('aria-pressed', 'false');
  expect(await writes(page, 'assignCleaner')).toEqual([]);
});

test('second week failing shows Retry on its days only', async ({ page }) => {
  await boot(page, [{ match: 'action=mgr.planning&start=2026-10-12', status: 503, body: { error: 'Service unavailable' }, once: true },
    AW(), PLAN(assignBody())]);
  await expect(row(page, KL)).toBeVisible();
  await expect(page.locator('.qa-ro')).toHaveCount(0);
  await expect(btn(page, KL, 4)).not.toHaveAttribute('aria-disabled', 'true');
  await day(page, '2026-10-12').click();
  await expect(page.locator('.qa-rol')).toHaveText('Reconnect to make changes.');
  await expect(page.locator('[data-qa-retry]')).toHaveText('Retry');
  await expect(page.locator('.qa-empty')).toHaveCount(0);
  await day(page, '2026-10-11').click();
  await expect(page.locator('.qa-ro')).toHaveCount(0);
  await expect(page.locator('.qa-date')).toHaveText('Sun 11');
  await expect(page.locator('.qa-empty')).toHaveText('No cleaning planned for Sun 11.');
  await day(page, '2026-10-15').click();
  await expect(page.locator('.qa-rol')).toBeVisible();
  // Retry : la seconde semaine repond.
  await page.locator('[data-qa-retry]').click();
  await expect(page.locator('.qa-ro')).toHaveCount(0);
  await expect(page.locator('.qa-empty')).toHaveText('No cleaning planned for Thu 15.');
});

test('all weeks failing shows read-only with Retry', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const down = () => ({ match: 'action=mgr.planning', status: 503, body: { error: 'Service unavailable' }, once: true });
  await boot(page, [down(), down(), PLAN(assignBody())], '#/assign');
  await expect(page.locator('.qa-rol')).toHaveText('Reconnect to make changes.');
  await expect(page.locator('.qa-dc')).toHaveText(['·', '·', '·', '·', '·', '·', '·']);
  await expect(day(page, '2026-10-09')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.qa-row')).toHaveCount(0);
  await expect(page.locator('.qa-empty')).toHaveCount(0);
  await page.locator('[data-qa-retry]').click();
  await expect(page.locator('.qa-ro')).toHaveCount(0);
  await expect(row(page, KL)).toBeVisible();
  await expect(page.locator('.qa-dc').first()).toHaveText('3');
  expect(errors).toEqual([]);
});

test('a day picked by hand before the first read is kept', async ({ page }) => {
  // Aucune lecture au depart ; aujourd'hui choisi a la main (aller-retour) : la premiere lecture
  // reussie ne le remplace pas, meme a 0 dans la bande.
  const down = () => ({ match: 'action=mgr.planning', status: 503, body: { error: 'Service unavailable' }, once: true });
  await boot(page, [down(), down(), PLAN(eveningBody())], '#/assign');
  await expect(page.locator('.qa-rol')).toBeVisible();
  await day(page, '2026-10-10').click();
  await expect(day(page, '2026-10-10')).toHaveAttribute('aria-pressed', 'true');
  await day(page, '2026-10-09').click();
  await expect(day(page, '2026-10-09')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('[data-qa-retry]').click();
  await expect(page.locator('.qa-ro')).toHaveCount(0);
  await expect(page.locator('.qa-dc').first()).toHaveText('0');
  await expect(day(page, '2026-10-09')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('h2.qa-gh')).toHaveText(['Already assigned (4)', 'Often with Elite (2)']);
});

test('sign-in lost during the stale re-read writes nothing', async ({ page }) => {
  await boot(page, [AW(), W1(assignBody(), { once: true }), W1(null, { status: 401, body: { error: 'Unauthorized' } }), PLAN(assignBody())]);
  await expect(row(page, KL)).toBeVisible();
  await page.clock.setFixedTime(new Date(PNOW.getTime() + 61_000));
  await btn(page, KL, 4).click();
  await expect(page.getByRole('heading', { name: 'ROOT STUB' })).toBeVisible();
  expect(await writes(page, 'assignCleaner')).toEqual([]);
});

test('email sign-in refusal keeps the email screen', async ({ page }) => {
  await bootMgr(page, [me(MANAGER), { match: 'action=mgr.planning', status: 403, body: { error: 'email sign-in required' } }],
    { email: true, hash: '#/assign', clock: PNOW });
  await expect(page.getByRole('heading', { name: 'Sign in with your email' })).toBeVisible();
  // Aucun rendu de l'ecran par-dessus.
  await expect(page.locator('.qa')).toHaveCount(0);
});

test('Often with Elite open at first, its button folds it', async ({ page }) => {
  // Rien de cache : trois menages d'equipe sur quatre tombent dans ce groupe (mesure du 24/11).
  await boot(page, [AW(), PLAN(assignBody())]);
  const tog = page.locator('[data-qa-elite]');
  await expect(tog).toHaveText('Often with Elite (2)');
  await expect(tog).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('#qa-elite-rows .qa-place')).toHaveText(['Apt 909 · Bloom Height', 'Apt 210 · Marina Gate']);
  // Une ligne du groupe s'affecte comme les autres et reste dans son groupe.
  await btn(page, CD, 10).click();
  await expect(toastBox(page)).toContainText('Apt 909 · Bloom Height assigned to Pionah');
  await expect(page.locator('#qa-elite-rows [data-qa-row="' + CD + '"]')).toBeVisible();
  // Son bouton le replie (le compte reste), puis le rouvre.
  await tog.click();
  await expect(tog).toHaveAttribute('aria-expanded', 'false');
  await expect(tog).toBeFocused();
  await expect(tog).toHaveText('Often with Elite (2)');
  await expect(row(page, CD)).toHaveCount(0);
  await tog.click();
  await expect(tog).toHaveAttribute('aria-expanded', 'true');
  await expect(row(page, CD)).toBeVisible();
});

test('Today link opens the selected day', async ({ page }) => {
  await bootMgr(page, [me(MANAGER), { match: 'action=mgr.today', status: 200, body: todayBody() }, PLAN(assignBody())],
    { email: true, clock: PNOW });
  // Le bouton Location pousse la page apres le premier rendu (voir today-days.spec.ts).
  await expect(page.locator('#main > [data-loc-pill]')).toBeVisible();
  const link = page.getByRole('link', { name: 'Assign quickly' });
  await expect(link).toHaveAttribute('href', '#/assign?d=2026-10-09');
  await page.locator('[data-wday="2026-10-10"]').click();
  await expect(page.locator('[data-wday="2026-10-10"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(link).toHaveAttribute('href', '#/assign?d=2026-10-10');
  await link.click();
  await expect(page).toHaveURL(/#\/assign\?d=2026-10-10$/);
  await expect(page.locator('.qa h1')).toHaveText('Assign');
  await expect(day(page, '2026-10-10')).toHaveAttribute('aria-pressed', 'true');
  // Hors barre d'onglets : Today reste allume.
  await expect(page.locator('a[href="#/today"][aria-current="page"]')).toHaveCount(2);
  await page.locator('.qa-back').click();
  await expect(page).toHaveURL(/#\/today$/);
  await expect(page.locator('[data-wday]').first()).toBeVisible();
});

test('Planning link opens assign', async ({ page }, info) => {
  await bootMgr(page, [me(MANAGER), PLAN(assignBody())], { email: true, hash: '#/planning', clock: PNOW });
  await expect(page.locator('.pj').first()).toBeVisible();
  await expect(page.locator('#main > [data-loc-pill]')).toBeVisible();
  const link = page.locator('main a.pl-qa');
  await expect(link).toHaveText('Assign quickly');
  // Telephone : le jour affiche ; ordinateur (grille de la semaine) : le premier jour de la semaine.
  if (isMobile(info)) {
    await expect(link).toHaveAttribute('href', '#/assign?d=2026-10-09');
    await page.locator('.pl-strip [data-day="2026-10-10"]').click();
    await expect(link).toHaveAttribute('href', '#/assign?d=2026-10-10');
  } else {
    await expect(link).toHaveAttribute('href', '#/assign?d=2026-10-05');
  }
  await link.click();
  await expect(page.locator('.qa h1')).toHaveText('Assign');
  // Lundi 5 n'est pas dans la bande : premier jour avec un menage sans personne.
  await expect(day(page, isMobile(info) ? '2026-10-10' : '2026-10-09')).toHaveAttribute('aria-pressed', 'true');
});

test('Planning link absent for the maintenance role', async ({ page }) => {
  await bootMgr(page, [me({ ...MANAGER, id: 9, name: 'Semax', role: 'maintenance' }), PLAN(assignBody())],
    { email: true, hash: '#/planning', clock: PNOW });
  await expect(page.locator('.pj').first()).toBeVisible();
  await expect(page.locator('main a.pl-qa')).toHaveCount(0);
  // L'ecran n'est pas dans ses vues : retour a sa vue d'arrivee.
  await page.evaluate(() => { location.hash = '#/assign'; });
  await expect(page).toHaveURL(/#\/maintenance$/);
});

test('look at 320, 390 and 1280: no horizontal scroll, targets of 44 px, text of 14 px, light and dark', async ({ page }) => {
  await boot(page, [PLAN(assignBody())]);
  await expect(row(page, CD)).toBeVisible();
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    // Vendredi (trois groupes, Elite ouvert), samedi (Faiza en conge).
    for (const d of ['2026-10-09', '2026-10-10']) {
      await day(page, d).click();
      await expect(day(page, d)).toHaveAttribute('aria-pressed', 'true');
      for (const width of [320, 390, 1280]) {
        await page.setViewportSize({ width, height: 900 });
        const m = await lookMetrics(page);
        const where = scheme + ', ' + d + ', ' + width + ' px';
        expect(m.overflowX, 'défilement horizontal, ' + where).toBeLessThanOrEqual(0);
        expect(m.smallTop, 'cibles, ' + where).toEqual([]);
        expect(m.tinyTop, 'texte sous 14 px, ' + where).toEqual([]);
        expect(m.lowTop, 'contraste, ' + where).toEqual([]);
      }
    }
  }
});
