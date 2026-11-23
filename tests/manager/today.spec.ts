import { test, expect, type Page } from '@playwright/test';
import { bootMgr, fetchLog, MANAGER, me, noHorizontalScroll } from './helpers';
import { lookMetrics } from './look';
import { longTodayBody, NOW, todayBody } from './fixtures';

// Today du manager (lot 4a) : la journee rangee par heure d'arrivee des guests (page de
// test validee le 20/11/2026). Modele : manager/screens/today-model.js.
const TODAY = (body: any = todayBody()) => ({ match: 'action=mgr.today', status: 200, body });
const h1 = (page: Page) => page.getByRole('heading', { level: 1 });
const card = (page: Page, id: string) => page.locator('[data-td-open="' + id + '"]');
// Puce ou en-tete du panneau (grand ecran) qui filtre : celle qui est affichee.
const filterBtn = (page: Page, v: string) => page.locator('[data-td-filter="' + v + '"]:visible');

for (const scheme of ['light', 'dark'] as const) {
  test.describe(scheme, () => {
    test.use({ colorScheme: scheme });
    test('tete, phrase du jour, statuts, carte bloquee, aucun defilement horizontal (' + scheme + ')', async ({ page }, info) => {
      await bootMgr(page, [me(MANAGER), TODAY()], { email: true, clock: NOW });
      await expect(h1(page)).toHaveText('Friday');
      await expect(page.locator('.td-date')).toHaveText('9 October · today, as of 11:00');
      await expect(page.locator('.td-sum')).toHaveText(
        '4 guests arrive today. 1 apartment is ready, 2 are at risk, 1 is blocked. 3 cleanings, 1 with no cleaner, 1 expected with Elite.');
      await expect(page.locator('.td-blocked')).toContainText('Guest due today at 15:00');
      const risk = card(page, '2026-10-09_Cy Doe');
      await expect(risk).toContainText('At risk');
      await expect(risk).toContainText('Not started yet, Faiza. Guest in 4 h, checkout time not set.');
      // La cause dit deja « checkout time not set » : la ligne des heures ne le repete pas.
      await expect(risk.locator('.td-ti')).toHaveCount(0);
      expect(((await risk.textContent()) || '').match(/checkout time not set/gi)).toHaveLength(1);
      await expect(card(page, 'arr:6')).toContainText('Not logged yet. Elite logs its jobs the next day around 14:00.');
      const elite = card(page, '2026-10-09_Lu Mo');
      await expect(elite).toContainText('Not logged yet');
      await expect(elite).toContainText('Usually done by Elite Cleaning, who log their jobs the next day around 14:00.');
      await expect(card(page, 'arr:8')).toContainText('Ready');
      const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
      expect(bg).toBe(scheme === 'dark' ? 'rgb(12, 14, 20)' : 'rgb(244, 246, 248)');
      const s = await noHorizontalScroll(page);
      expect(s.scrollWidth).toBeLessThanOrEqual(s.clientWidth);
      const side = page.getByRole('heading', { name: 'Who is where today', exact: true });
      const first = page.locator('[data-td-moment]').first();
      if (info.project.name === 'mgr-mobile') {
        await expect(side).toBeHidden();
        expect((await first.boundingBox())!.y).toBeLessThan((await page.locator('[data-td-more]').boundingBox())!.y);
      } else {
        // Grand ecran : le panneau des personnes a droite de la liste.
        await expect(side).toBeVisible();
        const m = (await first.boundingBox())!;
        expect((await side.boundingBox())!.x).toBeGreaterThan(m.x + m.width);
      }
    });
  });
}

test('mgr.today part avec le Bearer de la session email', async ({ page }) => {
  await bootMgr(page, [me(MANAGER), TODAY()], { email: true, clock: NOW });
  await expect(h1(page)).toHaveText('Friday');
  const log = await fetchLog(page);
  expect(log.find((l) => l.url.includes('action=mgr.today'))!.headers['Authorization']).toBe('Bearer jwt-test');
});

test('fiche arrivee au clavier : fleches, Entree, Echap rend le focus', async ({ page }, info) => {
  await bootMgr(page, [me(MANAGER), TODAY()], { email: true, clock: NOW });
  // Cartes du moment de 15:00 : bloquee (308), a risque (103), prete (404).
  const rows = page.locator('.td-moment').first().locator('[data-td-open]');
  await expect(rows).toHaveCount(3);
  await rows.first().focus();
  await page.keyboard.press('ArrowDown');
  await expect(rows.nth(1)).toBeFocused();
  await page.keyboard.press('Enter');
  const sheet = page.locator('#sheet');
  await expect(sheet).toHaveAttribute('aria-hidden', 'false');
  await expect(sheet.getByRole('heading', { name: 'Apt 103 · Damac Reva' })).toBeVisible();
  await expect(sheet).toContainText('Today, checkout time not set');
  // Duree insecable (U+00A0) : « 4 h » ne se coupe jamais en fin de ligne.
  expect(await sheet.textContent()).toContain('4 h from now');
  if (info.project.name === 'mgr-desktop') {
    const box = await sheet.boundingBox();
    expect(Math.round(box!.width)).toBe(460);
  }
  await page.keyboard.press('Escape');
  await expect(sheet).toHaveAttribute('aria-hidden', 'true');
  await expect(rows.nth(1)).toBeFocused();
  // Fleche vers le haut, sans sortir du moment.
  await page.keyboard.press('ArrowUp');
  await expect(rows.first()).toBeFocused();
  await page.keyboard.press('ArrowUp');
  await expect(rows.first()).toBeFocused();
});

test('erreur du proxy sans donnees : message et Retry, jamais d ecran blanc', async ({ page }) => {
  await bootMgr(page, [me(MANAGER), { match: 'action=mgr.today', status: 500, body: { error: 'Internal error' }, once: true }, TODAY()], { email: true, clock: NOW });
  await expect(page.locator('.err-card')).toContainText('Internal error');
  await page.getByRole('button', { name: 'Retry' }).click();
  await expect(h1(page)).toHaveText('Friday');
});

test('les classes de More ne fuient pas sur les lignes de Today (classes td- seules)', async ({ page }) => {
  await bootMgr(page, [me(MANAGER), TODAY()], { email: true, clock: NOW });
  await expect(card(page, 'arr:8')).toBeVisible();
  // Lignes et cartes de la journee : aucune classe partagee avec un autre ecran.
  const foreign = await page.locator('.td-moments').evaluate((n) => Array.from(n.querySelectorAll('[class]'))
    .flatMap((e) => Array.from(e.classList)).filter((c) => !c.startsWith('td-')));
  expect(foreign).toEqual([]);
});

// ---------- Heure dediee d'un extra (13/10/2026) ----------
function extraToday() {
  const b = todayBody();
  const X = (o: any) => ({ kind: 'extra', checkoutDate: '2026-10-09', postponedFrom: null, assigned: [10], serviceType: 'CHC',
    state: 'not_started', next: null, checkout: null, tone: 'idle', word: 'Not started', ...o });
  b.who.jobs.push(
    X({ key: 'extra_2026-10-09_mabc', listingId: 'L8', apt: '808', bld: 'Tower H', extraTime: '14:00' }),
    X({ key: 'extra_2026-10-09_mdef', listingId: 'L7', apt: '707', bld: 'Marina Gate' }),
  );
  b.who.people.find((p: any) => p.id === 10).keys = ['extra_2026-10-09_mabc', 'extra_2026-10-09_mdef'];
  return b;
}

test('Heure d un extra : Extra cleaning at 14:00., sans heure Extra cleaning., fiche « Extra cleaning, today at 14:00 »', async ({ page }) => {
  await bootMgr(page, [me(MANAGER), TODAY(extraToday())], { email: true, clock: NOW });
  await expect(card(page, 'extra_2026-10-09_mabc').locator('.td-ti')).toHaveText('Extra cleaning at 14:00. No guest in the next 14 days.');
  await expect(card(page, 'extra_2026-10-09_mdef').locator('.td-ti')).toHaveText('Extra cleaning. No guest in the next 14 days.');
  await expect(card(page, 'extra_2026-10-09_mabc')).toContainText('Not started · Pionah');
  await card(page, 'extra_2026-10-09_mabc').click();
  await expect(page.locator('#sheet .sheet-h .sub')).toHaveText('Extra cleaning, today at 14:00');
  await page.locator('#sheet [data-close]').first().click();
  await card(page, 'extra_2026-10-09_mdef').click();
  await expect(page.locator('#sheet .sheet-h .sub')).toHaveText('Extra cleaning, today');
  const s = await noHorizontalScroll(page);
  expect(s.scrollWidth).toBeLessThanOrEqual(s.clientWidth);
});

// ---------- Journee par heure d'arrivee (lot 4a, tache 3) ----------
test('la journée est rangée par heure d arrivée', async ({ page }) => {
  await bootMgr(page, [me(MANAGER), TODAY()], { email: true, clock: NOW });
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Friday');
  await expect(page.getByText('9 October · today, as of 11:00')).toBeVisible();
  const moments = page.locator('[data-td-moment]');
  await expect(moments).toHaveText([/Arriving at 15:00/, /Arriving at 16:00/, /No guest today/]);
  await expect(moments.first()).toHaveAttribute('aria-label', 'Arriving at 15:00: 1 blocked, 1 at risk, 1 ready');
  await expect(moments.nth(1)).toHaveAttribute('aria-label', 'Arriving at 16:00: 1 at risk');
  await expect(moments.nth(2)).toHaveAttribute('aria-label', 'No guest today: 1 not logged yet');
  // Ordre dans le moment : bloque, a risque, puis l'ordre du proxy.
  await expect(page.locator('.td-moment').first().locator('[data-td-open]')).toHaveText([/Apt 308/, /Apt 103/, /Apt 404/]);
  // Le menage sans arrivee : un disque en pointilles pour affecter (feuille actuelle).
  await expect(page.locator('[data-td-who="2026-10-09_Lu Mo"]')).toHaveAttribute('data-assign', '2026-10-09_Lu Mo');
  await expect(page.locator('[data-td-who="2026-10-09_Lu Mo"]')).toHaveAttribute('aria-label', 'Assign a cleaner to Apt 909 · Bloom Height');
  // Bande de sept jours : le jour des donnees choisi, son compte sans cleaner ; les autres jours pas encore lus.
  const days = page.locator('[data-wday]');
  await expect(days).toHaveCount(7);
  await expect(days.first()).toHaveAttribute('data-wday', '2026-10-09');
  await expect(days.first()).toHaveAttribute('aria-pressed', 'true');
  await expect(days.first()).toHaveAttribute('aria-label', 'Fri 9, 1 with no cleaner');
  await expect(days.nth(1)).toHaveAttribute('aria-label', 'Sat 10');
  await expect(days.nth(1)).toContainText('·');
  await expect(page.getByText('Under each day: cleanings with no cleaner yet.')).toBeVisible();
});

test('le logement bloqué est une grande carte avec ses raisons', async ({ page }) => {
  await bootMgr(page, [me(MANAGER), TODAY()], { email: true, clock: NOW });
  const b = page.locator('.td-blocked');
  await expect(b).toContainText('Guest due today at 15:00');
  await expect(b).toContainText('Apt 308 · Binghatti Lavender');
  await expect(b).toContainText('Urgent ticket open since 09/07, nobody on it');
  await expect(b.getByRole('link', { name: 'See ticket' })).toHaveAttribute('href', '#/maintenance?ref=MNT-429');
  await expect(b).toContainText('No cleaner assigned');
  expect((await b.boundingBox())!.y).toBeLessThan(844);
  await expect(b).toContainText('Gas not working (MNT-429)');
  // Assign someone : la feuille actuelle « Assign a cleaner » (remplacee par le choix dans la carte en tache 4).
  await b.getByRole('button', { name: 'Assign someone' }).click();
  await expect(page.locator('#sheet').getByRole('heading', { name: 'Assign a cleaner' })).toBeVisible();
});

// Panneau des personnes (grand ecran) : un logement bloque montre l'etat de son menage en
// neutre (Not started, In progress, Done), jamais un second « Blocked ».
test('panneau : logement bloque avec l etat neutre de son menage', async ({ page }) => {
  const body = todayBody();
  body.who.jobs[0] = { ...body.who.jobs[0], assigned: [4], serviceType: 'CHC', state: 'in_progress', tone: 'warn', word: 'In progress' };
  body.who.jobs[2] = { ...body.who.jobs[2], state: 'done', tone: 'ok', word: 'Done' };
  body.who.people[0].keys = ['2026-10-09_Cy Doe', '2026-10-09_Ann Lee'];
  body.who.unassigned = ['2026-10-09_Lu Mo'];
  body.arrivals.rows[0] = { ...body.arrivals.rows[0], cause: 'Urgent ticket open: Gas not working (MNT-429).', assigned: [4], cleaners: ['Faiza'] };
  body.arrivals.rows[1] = { ...body.arrivals.rows[1], tone: 'bad', word: 'Blocked', cause: 'Urgent ticket open: Leak under sink (MNT-431).', done: true };
  await bootMgr(page, [me(MANAGER), TODAY(body)], { email: true, clock: NOW });
  await expect(page.locator('.td-blocked')).toHaveCount(2);
  const faiza = page.locator('.td-side .td-tp', { hasText: 'Faiza' });
  const st = (apt: string) => faiza.locator('li', { hasText: apt }).locator('.td-st');
  await expect(st('Apt 308')).toHaveText('In progress');
  await expect(st('Apt 308')).toHaveClass(/\btd-k-todo\b/);
  await expect(st('Apt 103')).toHaveText('Done');
  await expect(st('Apt 103')).toHaveClass(/\btd-k-todo\b/);
  await expect(faiza.locator('.td-k-blocked')).toHaveCount(0);
});

test('carte bloquee d un proprietaire : Owner due today, repli sur la cause du proxy', async ({ page }) => {
  const body = todayBody();
  body.arrivals.rows[3] = { ...body.arrivals.rows[3], tone: 'bad', word: 'Blocked', cause: 'Cleaning postponed to tomorrow.', assigned: [12], cleaners: ['Elite Cleaning'] };
  await bootMgr(page, [me(MANAGER), TODAY(body)], { email: true, clock: NOW });
  const b = page.locator('.td-blocked', { hasText: 'Apt 805' });
  await expect(b).toContainText('Owner due today at 16:00');
  await expect(b).toContainText('Cleaning postponed to tomorrow.');
  await expect(b.getByRole('button')).toHaveText(['Apt 805 · Azizi Riviera 39']);
});

test('filtre par personne, puis sans filtre', async ({ page }) => {
  await bootMgr(page, [me(MANAGER), TODAY()], { email: true, clock: NOW });
  await expect(page.locator('[data-td-open]')).toHaveCount(5);
  await filterBtn(page, '4').click();
  await expect(filterBtn(page, '4')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('[data-td-open]')).toHaveCount(1);
  await expect(card(page, '2026-10-09_Cy Doe')).toBeVisible();
  await expect(page.locator('[data-td-moment]')).toHaveText([/Arriving at 15:00/]);
  await expect(page.locator('[data-td-moment]').first()).toHaveAttribute('aria-label', 'Arriving at 15:00: 1 at risk');
  // Le focus reste sur la puce apres le nouveau rendu.
  await expect(filterBtn(page, '4')).toBeFocused();
  await filterBtn(page, '4').click();
  await expect(filterBtn(page, '4')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('[data-td-open]')).toHaveCount(5);
  // Sans cleaner : le seul menage sans personne (le menage attendu chez Elite n'y est pas).
  await filterBtn(page, 'none').click();
  await expect(page.locator('[data-td-open]')).toHaveCount(1);
  await expect(page.locator('.td-blocked')).toContainText('Apt 308');
});

test('moment replié : ses cartes disparaissent, le compte reste', async ({ page }) => {
  await bootMgr(page, [me(MANAGER), TODAY()], { email: true, clock: NOW });
  const m = page.locator('[data-td-moment="arr-1500"]');
  await expect(m).toHaveAttribute('aria-expanded', 'true');
  await m.click();
  await expect(m).toHaveAttribute('aria-expanded', 'false');
  await expect(card(page, '2026-10-09_Ann Lee')).toHaveCount(0);
  await expect(card(page, 'arr:8')).toHaveCount(0);
  await expect(m).toHaveAttribute('aria-label', 'Arriving at 15:00: 1 blocked, 1 at risk, 1 ready');
  await expect(m).toBeFocused();
  // Un autre rendu (filtre pose puis enleve) garde le moment replie.
  await filterBtn(page, '4').click();
  await filterBtn(page, '4').click();
  await expect(page.locator('[data-td-moment="arr-1500"]')).toHaveAttribute('aria-expanded', 'false');
  await page.locator('[data-td-moment="arr-1500"]').click();
  await expect(card(page, '2026-10-09_Ann Lee')).toBeVisible();
});

test('Not for today est replié, et garde Maintenance et Team control', async ({ page }) => {
  await bootMgr(page, [me(MANAGER), TODAY()], { email: true, clock: NOW });
  const more = page.locator('[data-td-more]');
  await expect(more).toHaveAttribute('aria-expanded', 'false');
  await expect(more).toContainText('Not for today');
  await expect(more).toContainText('19 urgent tickets');
  await expect(more).toHaveAttribute('aria-label', 'Not for today: 19 urgent tickets');
  await expect(page.getByRole('heading', { name: 'Maintenance', exact: true })).toHaveCount(0);
  await more.click();
  await expect(more).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByRole('heading', { name: 'Maintenance', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Team control', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: '3 proposals to check' })).toHaveAttribute('href', '#/maintenance');
  await expect(page.getByRole('link', { name: 'Open maintenance' })).toHaveAttribute('href', '#/maintenance');
  await expect(page.getByRole('link', { name: 'Open inspections' })).toHaveAttribute('href', '#/inspections');
  // Technicien : tickets ouverts et le plus ancien.
  const semax = page.locator('.person', { hasText: 'Semax' });
  await expect(semax).toContainText('Maintenance tickets');
  await expect(semax).toContainText('Oldest: MNT-106 Balcony drain blocked, since 27/04.');
  await expect(page.getByText('Started, never finished')).toBeVisible();
  await expect(page.getByText('Missing linen counts, last 7 days')).toBeVisible();
  await expect(page.getByText('What each person did yesterday, 08/10')).toBeVisible();
  // How status is computed : en bas, inchange.
  await expect(page.locator('details.rules summary')).toHaveText('How status is computed');
});

test('journée vide : No guest arrives today. No cleaning planned.', async ({ page }) => {
  const body = todayBody();
  body.who.jobs = [];
  body.who.unassigned = [];
  body.who.people.forEach((p: any) => { p.keys = []; });
  body.arrivals.rows = [];
  body.arrivals.counts = { ok: 0, warn: 0, bad: 0, idle: 0 };
  body.ticketsByListing = {};
  await bootMgr(page, [me(MANAGER), TODAY(body)], { email: true, clock: NOW });
  await expect(page.locator('.td-sum')).toHaveText('No guest arrives today. No cleaning planned.');
  await expect(page.getByText('No cleaning planned for today.')).toBeVisible();
  await expect(page.locator('[data-td-moment]')).toHaveCount(0);
  await expect(page.locator('[data-td-filter="none"]')).toHaveCount(0);
  await expect(page.locator('[data-td-more]')).toBeVisible();
});

test('personne inconnue : disque ?, Member 12', async ({ page }) => {
  // Elite Cleaning (12) absente des personnes affectables et de who.people.
  const body = todayBody();
  body.assignable = body.assignable.filter((p: any) => p.id !== 12);
  body.who.people = body.who.people.filter((p: any) => p.id !== 12);
  body.who.jobs[2].assigned = [12];
  body.arrivals.rows[1] = { ...body.arrivals.rows[1], assigned: [12], cleaners: ['Member 12'] };
  await bootMgr(page, [me(MANAGER), TODAY(body)], { email: true, clock: NOW });
  const c = page.locator('.td-card', { has: card(page, '2026-10-09_Cy Doe') });
  await expect(c.locator('.td-disc')).toHaveText('?');
  await expect(c.locator('.td-disc')).toHaveClass(/td-other/);
  await expect(card(page, '2026-10-09_Cy Doe')).toContainText('At risk · Member 12');
  await expect(page.locator('[data-td-who="2026-10-09_Cy Doe"]')).toHaveAttribute('aria-label', 'Change the cleaner of Apt 103 · Damac Reva');
  // Pas de puce pour une personne qu'on ne peut pas affecter.
  await expect(page.locator('.td-fchips [data-td-filter="12"]')).toHaveCount(0);
});

const WIDTHS = [320, 390, 768, 960, 1280, 1440];
for (const scheme of ['light', 'dark'] as const) {
  test.describe(scheme, () => {
    test.use({ colorScheme: scheme });
    test('lisibilité de Today (' + scheme + ')', async ({ page }) => {
      await bootMgr(page, [me(MANAGER), TODAY(longTodayBody())], { email: true, clock: NOW });
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('Friday');
      await expect(page.locator('.td-blocked')).toContainText('Seaview Garden Residences Tower Twelve B');
      // Replie par defaut, puis « Not for today » ouvert : memes seuils.
      for (const open of [false, true]) {
        if (open) await page.locator('[data-td-more]').click();
        for (const width of WIDTHS) {
          await page.setViewportSize({ width, height: 900 });
          const m = await lookMetrics(page);
          const at = width + ' px' + (open ? ', Not for today ouvert' : '');
          expect(m.overflowX, 'défilement horizontal, ' + at).toBeLessThanOrEqual(0);
          expect(m.smallTop, 'cibles, ' + at).toEqual([]);
          expect(m.tinyTop, 'texte sous 14 px, ' + at).toEqual([]);
          expect(m.lowTop, 'contraste, ' + at).toEqual([]);
        }
      }
    });
  });
}

// Grand ecran : la barre laterale de l'appli (232 px) et les marges prennent ~300 px. Le
// panneau « Who is where today » ne s'affiche qu'a partir de 1200 px, quand la liste garde au
// moins 520 px ; en dessous, les puces de personnes filtrent comme sur telephone.
test('panneau des personnes a partir de 1200 px, puces en dessous', async ({ page }) => {
  await bootMgr(page, [me(MANAGER), TODAY()], { email: true, clock: NOW });
  await expect(h1(page)).toHaveText('Friday');
  const side = page.locator('.td-side');
  const chips = page.locator('.td-people');
  for (const width of [960, 1024, 1199, 1200, 1280, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    if (width < 1200) {
      await expect(side, width + ' px').toBeHidden();
      await expect(chips, width + ' px').toBeVisible();
      await expect(page.locator('.td-fchips [data-td-filter="4"]'), width + ' px').toBeVisible();
    } else {
      await expect(side, width + ' px').toBeVisible();
      await expect(chips, width + ' px').toBeHidden();
      expect((await page.locator('.td-main').boundingBox())!.width, width + ' px').toBeGreaterThanOrEqual(520);
    }
  }
});
