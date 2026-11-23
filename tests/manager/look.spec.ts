import { test, expect, type Page } from '@playwright/test';
import { bootMgr, MANAGER, me, OWNER } from './helpers';
import { lookMetrics } from './look';
import { NOW, todayBody } from './fixtures';
import { PLAN, PNOW } from './planning-fixtures';
import { DONE, NOW_MNT, OPEN, PROPOSALS, REJECTED } from './maintenance-fixtures';
import { listBody as taskList } from './problem-fixtures';
import { HISTORY, INSP_TODAY, OVERVIEW, REPORTS } from './insp-fixtures';

// Socle visuel du manager (lot 4a, tache 1) : chaque ecran, charge avec les jeux
// d'essai de son propre fichier de tests, sans defilement horizontal ni texte
// sous le contraste requis, en clair et en sombre.

async function bootToday(page: Page) {
  await bootMgr(page, [me(MANAGER), { match: 'action=mgr.today', status: 200, body: todayBody() }], { email: true, clock: NOW });
  await expect(page.locator('main .top h1')).toBeVisible();
  // « Loading today… » remplace par le tableau (ni chargement ni erreur).
  await expect(page.locator('main .boot')).toHaveCount(0);
  await expect(page.locator('main .err-card')).toHaveCount(0);
}

const SCREENS: Array<{ name: string; boot: (page: Page) => Promise<void> }> = [
  { name: 'today', boot: bootToday },
  {
    name: 'planning',
    boot: async (page) => {
      await bootMgr(page, [me(MANAGER), PLAN()], { email: true, hash: '#/planning', clock: PNOW });
      await expect(page.locator('.pj').first()).toBeVisible();
    },
  },
  {
    name: 'maintenance',
    boot: async (page) => {
      await bootMgr(page, [me(MANAGER),
        { match: 'rejected=1', status: 200, body: REJECTED() },
        { match: 'tab=proposals', status: 200, body: PROPOSALS() },
        { match: 'tab=open', status: 200, body: OPEN() },
        { match: 'tab=done', status: 200, body: DONE() },
      ], { email: true, clock: NOW_MNT, hash: '#/maintenance' });
      await expect(page.locator('.mt-card')).toHaveCount(2);
    },
  },
  {
    name: 'tasks',
    boot: async (page) => {
      await bootMgr(page, [me(MANAGER), { match: 'action=mgr.problems', status: 200, body: taskList() }], { email: true, clock: NOW, hash: '#/tasks' });
      await expect(page.locator('.prow')).toHaveCount(3);
    },
  },
  {
    name: 'inspections',
    boot: async (page) => {
      await bootMgr(page, [me(MANAGER), INSP_TODAY(8), OVERVIEW, HISTORY, REPORTS], { email: true, hash: '#/inspections' });
      await expect(page.locator('.insp .card').first()).toBeVisible();
    },
  },
  {
    name: 'more',
    boot: async (page) => {
      await bootMgr(page, [me(OWNER)], { email: true, hash: '#/more' });
      await expect(page.locator('main a.more-row')).toHaveCount(13);
    },
  },
];

for (const scheme of ['light', 'dark'] as const) {
  test.describe(scheme, () => {
    test.use({ colorScheme: scheme });
    for (const s of SCREENS) {
      test(s.name + ' : socle lisible (' + scheme + ')', async ({ page }) => {
        await s.boot(page);
        const m = await lookMetrics(page);
        expect(m.overflowX, 'défilement horizontal').toBeLessThanOrEqual(0);
        expect(m.lowTop, 'contraste').toEqual([]);
      });
    }
  });
}

test('coquille : polices, fond, cibles', async ({ page }, info) => {
  await bootToday(page);
  const body = await page.evaluate(() => { const c = getComputedStyle(document.body); return { font: c.fontFamily, bg: c.backgroundColor, feat: c.fontFeatureSettings }; });
  expect(body.font).toContain('Manrope');
  expect(body.bg).toBe('rgb(244, 246, 248)');
  expect(body.feat).not.toContain('tnum');
  if (info.project.name === 'mgr-mobile') {
    const tabs = page.locator('#tabbar .tab');
    await expect(tabs).toHaveCount(5);
    for (const b of await tabs.all()) { const r = (await b.boundingBox())!; expect(Math.min(r.width, r.height)).toBeGreaterThanOrEqual(44); }
    await expect(page.locator('#tabbar .tab[aria-current="page"]')).toContainText('Today');
    await expect(page.locator('#tabbar .tab:not([aria-current])').first()).toHaveAttribute('aria-label', 'Planning');
  }
});
