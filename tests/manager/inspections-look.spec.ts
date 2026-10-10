import { test, expect } from '@playwright/test';
import { bootMgr, MANAGER, me, noHorizontalScroll } from './helpers';
import { INSP_TODAY, OVERVIEW, HISTORY, REPORTS, START } from './insp-fixtures';

// Habillage manager des ecrans Inspections (feuille manager/ui/inspections.css, limitee a .insp).
const boot = (page: any, hash: string, extra: any[] = []) =>
  bootMgr(page, [me(MANAGER), INSP_TODAY(8), OVERVIEW, HISTORY, REPORTS, ...extra], { email: true, hash });

const HASHES: Array<[string, string, string]> = [
  ['Today', '#/inspections', '.insp .card'],
  ['Fleet', '#/inspections/fleet', '.insp .frow'],
  ['History', '#/inspections/history/B', '.insp .card'],
  ['Inspect', '#/inspections/inspect/A?e=checkout', '.insp .zone'],
];

for (const scheme of ['light', 'dark'] as const) {
  test.describe(scheme, () => {
    test.use({ colorScheme: scheme });

    test('carte distincte du fond, titre lisible, sombre en dark', async ({ page }) => {
      await boot(page, '#/inspections');
      await expect(page.locator('.insp .card').first()).toBeVisible();
      const r = await page.evaluate(() => {
        const lum = (c: string) => {
          const m = c.match(/[\d.]+/g)!.map(Number);
          const f = (v: number) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); };
          return 0.2126 * f(m[0]) + 0.7152 * f(m[1]) + 0.0722 * f(m[2]);
        };
        const card = document.querySelector('.insp .card') as HTMLElement;
        const cs = getComputedStyle(card);
        const h3 = getComputedStyle(card.querySelector('h3') as HTMLElement);
        const a = lum(cs.backgroundColor), b = lum(h3.color);
        const hi = Math.max(a, b), lo = Math.min(a, b);
        return { cardBg: cs.backgroundColor, bodyBg: getComputedStyle(document.body).backgroundColor, ratio: (hi + 0.05) / (lo + 0.05), lum: a };
      });
      expect(r.cardBg).not.toBe(r.bodyBg);
      expect(r.ratio).toBeGreaterThanOrEqual(4.5);
      if (scheme === 'dark') expect(r.lum).toBeLessThan(0.2);
    });

    test('boutons >= 44 px et texte >= 16 px', async ({ page }) => {
      for (const [, hash, ready] of HASHES) {
        await boot(page, hash, [START()]);
        await expect(page.locator(ready).first()).toBeVisible();
        const small = await page.evaluate(() => Array.from(document.querySelectorAll('.insp button, .insp a.btn'))
          .filter((e) => (e as HTMLElement).offsetParent !== null)
          .map((e) => ({ t: (e.textContent || '').trim().slice(0, 30), h: e.getBoundingClientRect().height }))
          .filter((x) => x.h < 44));
        expect(small, hash).toEqual([]);
        const fs = await page.evaluate(() => {
          const e = document.querySelector('.insp .reason, .insp .mute') as HTMLElement | null;
          return e ? parseFloat(getComputedStyle(e).fontSize) : null;
        });
        if (fs !== null) expect(fs, hash).toBeGreaterThanOrEqual(16);
      }
    });

    test('aucun defilement horizontal', async ({ page }) => {
      for (const [, hash, ready] of HASHES) {
        await boot(page, hash, [START()]);
        await expect(page.locator(ready).first()).toBeVisible();
        const s = await noHorizontalScroll(page);
        expect(s.scrollWidth, hash).toBeLessThanOrEqual(s.clientWidth);
      }
    });

    test('bouton principal a la couleur d accent du manager', async ({ page }) => {
      await boot(page, '#/inspections');
      await expect(page.locator('.insp .btn.primary').first()).toBeVisible();
      const r = await page.evaluate(() => {
        const probe = document.createElement('div');
        probe.style.background = 'var(--accent)';
        document.body.appendChild(probe);
        const want = getComputedStyle(probe).backgroundColor;
        probe.remove();
        return { got: getComputedStyle(document.querySelector('.insp .btn.primary') as HTMLElement).backgroundColor, want };
      });
      expect(r.got).toBe(r.want);
    });

    test('Inspect : Finish au dessus de la barre d onglets (phone)', async ({ page }, info) => {
      test.skip(info.project.name !== 'mgr-mobile', 'phone seulement');
      await boot(page, '#/inspections/inspect/A?e=checkout', [START()]);
      const fin = page.getByRole('button', { name: 'Finish inspection' });
      await expect(fin).toBeVisible();
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      await page.waitForTimeout(100);
      const r = await page.evaluate(() => ({
        fb: (document.querySelector('[data-act="finish"]') as HTMLElement).getBoundingClientRect().bottom,
        tt: (document.getElementById('tabbar') as HTMLElement).getBoundingClientRect().top,
      }));
      expect(r.fb).toBeLessThan(r.tt);
    });
  });
}
