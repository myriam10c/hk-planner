import { test, expect } from '@playwright/test';
import { bootMgr, fetchLog, MANAGER, me, noHorizontalScroll, type FakeRoute } from './helpers';

const recent = (n: number) => Array.from({ length: n }, (_, i) => ({
  date: `2026-09-${String(20 - i).padStart(2, '0')}`, listingName: i % 2 ? 'Beta Tower' : 'Studio Alpha', guest: 'Guest ' + i, score: i === 3 ? 6 : 10,
}));
const OCT = {
  month: '2026-10',
  ratings: {
    computedAt: '2026-10-10T20:00:00Z', syncedAt: '2026-10-10T20:05:00Z', unmatched: 3,
    people: [
      { id: 1, name: 'Zara', role: 'cleaner', avgAll: 9.24, avg90: 9.5, count: 12, enoughData: true, recent: recent(10) },
      { id: 7, name: 'Old Bob', role: 'cleaner', avgAll: 8.1, avg90: null, count: 6, enoughData: true, recent: [] },
      { id: 2, name: 'Amir', role: 'cleaner', avgAll: null, avg90: null, count: 2, enoughData: false, recent: recent(2) },
    ],
  },
  performance: [
    { id: 1, name: 'Zara', role: 'cleaner', cleanings: 14, avgMinutes: 52, fastest: 38, slowest: 71, timed: 12 },
    { id: 2, name: 'Amir', role: 'cleaner', cleanings: 5, avgMinutes: null, fastest: null, slowest: null, timed: 0 },
    { id: 9, name: 'Newbie', role: 'cleaner', cleanings: 1, avgMinutes: 45, fastest: 45, slowest: 45, timed: 1 },
  ],
};
const SEP = { ...OCT, month: '2026-09', performance: [{ ...OCT.performance[0], cleanings: 20 }] };
const READS: FakeRoute[] = [
  { match: 'month=2026-09', status: 200, body: SEP },
  { match: 'action=mgr.people', status: 200, body: OCT },
];
const boot = (page: any, reads: FakeRoute[] = READS) => bootMgr(page, [me(MANAGER), ...reads], { email: true, hash: '#/more/people' });

test('cartes : moyennes, avis, temps, Not enough data et No timer', async ({ page }) => {
  await boot(page);
  await expect(page.getByRole('heading', { name: 'Ratings and stats', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'More', exact: true }).first()).toHaveAttribute('href', '#/more');
  await expect(page.locator('.pp-month-l')).toHaveText('October 2026');
  await expect(page.locator('.pp-fresh')).toContainText('Ratings computed 11 Oct 2026, 00:00');
  await expect(page.locator('.pp-fresh')).toContainText('3 unmatched reviews');
  const zara = page.locator('[data-person="1"]');
  await expect(zara.getByRole('heading', { name: 'Zara' })).toBeVisible();
  await expect(zara).toContainText('Cleaner');
  await expect(zara).toContainText('9.5 / 10');
  await expect(zara).toContainText('9.2 / 10');
  await expect(zara).toContainText('Cleanings in October 2026');
  await expect(zara).toContainText('14');
  await expect(zara).toContainText('52 min');
  await expect(zara).toContainText('38 min');
  await expect(zara).toContainText('71 min');
  // Inactif : le nom reste, 90 jours sans donnee.
  const bob = page.locator('[data-person="7"]');
  await expect(bob).toContainText('Old Bob');
  await expect(bob).toContainText('8.1 / 10');
  await expect(bob.getByText('Not enough data')).toHaveCount(1);
  await expect(bob).toContainText('No reviews yet.');
  // Pas assez de donnees : pas de moyenne, pas de chrono.
  const amir = page.locator('[data-person="2"]');
  await expect(amir.getByText('Not enough data')).toHaveCount(2);
  await expect(amir.getByText('No timer')).toHaveCount(3);
  await expect(amir).toContainText('5');
  // Cleaner sans note : carte quand meme, pas de moyenne.
  const newbie = page.locator('[data-person="9"]');
  await expect(newbie).toContainText('Newbie');
  await expect(newbie.getByText('Not enough data')).toHaveCount(2);
  await expect(newbie).toContainText('45 min');
});

test('avis recents : replies puis 10 lignes avec logement, date, invite et note', async ({ page }) => {
  await boot(page);
  const d = page.locator('[data-person="1"] details.pp-recent');
  await expect(d.locator('summary')).toContainText('Recent reviews (10)');
  await expect(d.locator('.pp-rev').first()).toBeHidden();
  await d.locator('summary').click();
  await expect(d.locator('.pp-rev')).toHaveCount(10);
  await expect(d.locator('.pp-rev').first()).toContainText('Studio Alpha');
  await expect(d.locator('.pp-rev').first()).toContainText('2026-09-20 · Guest 0');
  await expect(d.locator('.pp-rev').first()).toContainText('10 / 10');
  await expect(d.locator('.pp-rev').nth(3)).toContainText('6 / 10');
});

test('mois : precedent recharge avec month=, suivant desactive au mois courant', async ({ page }) => {
  await boot(page);
  await expect(page.getByRole('button', { name: 'Next month' })).toBeDisabled();
  await page.getByRole('button', { name: 'Previous month' }).click();
  await expect(page.locator('.pp-month-l')).toHaveText('September 2026');
  await expect(page.locator('[data-person="1"]')).toContainText('20');
  await expect(page.locator('[data-person="2"]').getByText('Not available')).toHaveCount(4); // sans ligne de perf ce mois
  await expect(page.locator('[data-person="2"]').getByText('No timer')).toHaveCount(0);
  const urls = (await fetchLog(page)).map((l) => l.url).filter((u) => u.includes('mgr.people'));
  expect(urls[0]).not.toContain('month=');
  expect(urls[1]).toContain('month=2026-09');
  await expect(page.getByRole('button', { name: 'Next month' })).toBeEnabled();
  await page.getByRole('button', { name: 'Next month' }).click();
  await expect(page.locator('.pp-month-l')).toHaveText('October 2026');
  await expect(page.getByRole('button', { name: 'Next month' })).toBeDisabled();
});

test('lecture en echec : message et Retry', async ({ page }) => {
  await boot(page, [{ match: 'action=mgr.people', status: 500, body: { error: 'Internal error' }, once: true }, ...READS]);
  await expect(page.locator('main').getByText('Internal error')).toBeVisible();
  await page.getByRole('button', { name: 'Retry' }).click();
  await expect(page.locator('[data-person="1"]')).toBeVisible();
});

test('lecture refusee (403) : message du serveur et Retry', async ({ page }) => {
  await boot(page, [{ match: 'action=mgr.people', status: 403, body: { error: 'Manager access required.' }, once: true }, ...READS]);
  await expect(page.locator('main').getByText('Manager access required.')).toBeVisible();
  await page.getByRole('button', { name: 'Retry' }).click();
  await expect(page.locator('[data-person="1"]')).toBeVisible();
});

test('aucune note ni menage : message vide, fraicheur absente dite', async ({ page }) => {
  await boot(page, [{ match: 'action=mgr.people', status: 200, body: { month: '2026-10', ratings: { computedAt: null, syncedAt: null, unmatched: 0, people: [] }, performance: [] } }]);
  await expect(page.getByText('No ratings or cleanings to show.')).toBeVisible();
  await expect(page.locator('.pp-fresh')).toHaveText('Ratings not computed yet');
});

test('le hub mene a l ecran', async ({ page }) => {
  await bootMgr(page, [me(MANAGER), ...READS], { email: true, hash: '#/more' });
  await page.locator('main a.more-row', { hasText: 'Ratings and stats' }).click();
  await expect(page).toHaveURL(/#\/more\/people$/);
  await expect(page.locator('[data-person="1"]')).toBeVisible();
});

for (const scheme of ['light', 'dark'] as const) {
  test.describe(scheme, () => {
    test.use({ colorScheme: scheme });
    test('sans defilement horizontal, cibles de 44 px, texte de 16 px (' + scheme + ')', async ({ page }) => {
      await boot(page);
      await expect(page.locator('[data-person="1"]')).toBeVisible();
      await page.locator('[data-person="1"] summary').click();
      const s = await noHorizontalScroll(page);
      expect(s.scrollWidth).toBeLessThanOrEqual(s.clientWidth);
      for (const b of await page.locator('main button:not([disabled]), main a, main summary').all()) {
        const box = await b.boundingBox();
        expect(box!.height).toBeGreaterThanOrEqual(44);
      }
      for (const sel of ['.pp-stat span:first-child', '.pp-fresh', '.pp-rev-t b']) {
        expect(await page.locator(sel).first().evaluate((e) => parseFloat(getComputedStyle(e).fontSize))).toBeGreaterThanOrEqual(16);
      }
    });
  });
}

test('stats indisponibles (503) : message du serveur et Retry, pas de zeros', async ({ page }) => {
  await boot(page, [{ match: 'action=mgr.people', status: 503, body: { error: 'Stats are unavailable right now. Try again.' }, once: true }, ...READS]);
  await expect(page.locator('main').getByText('Stats are unavailable right now. Try again.')).toBeVisible();
  await expect(page.locator('[data-person]')).toHaveCount(0);
  await page.getByRole('button', { name: 'Retry' }).click();
  await expect(page.locator('[data-person="1"]')).toBeVisible();
});
