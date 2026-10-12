import { test, expect } from '@playwright/test';
import { bootMgr, fetchLog, MANAGER, me } from './helpers';
import { NOW, todayBody } from './fixtures';

const TODAY = (body: any = todayBody()) => ({ match: 'action=mgr.today', status: 200, body });
const block = (page: any) => page.locator('section', { has: page.getByRole('heading', { name: 'Maintenance', exact: true }) });

test('bloc Maintenance : compteurs, lignes vers la fiche, lien de pied', async ({ page }) => {
  await bootMgr(page, [me(MANAGER), TODAY()], { email: true, clock: NOW });
  const b = block(page);
  await expect(b).toBeVisible();
  await expect(b.locator('a[href="#/maintenance"]', { hasText: '3 proposals to check' })).toBeVisible();
  await expect(b).toContainText('19 urgent tickets');
  await expect(b).toContainText('69 with nobody');
  // Le nombre une seule fois par compteur.
  await expect(b.locator('.count').nth(0)).toHaveText('3 proposals to check');
  await expect(b.locator('.count').nth(1)).toHaveText('19 urgent tickets');
  await expect(b.locator('.count').nth(2)).toHaveText('69 with nobody');
  // Pied sans span vide.
  await expect(b.locator('.sec-foot span')).toHaveCount(0);
  const rows = b.locator('a.prob');
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toHaveAttribute('href', '#/maintenance?ref=MNT-429');
  await expect(rows.nth(0)).toContainText('Gas not working');
  await expect(rows.nth(0)).toContainText('MNT-429');
  await expect(rows.nth(0)).toContainText('Apt 308');
  await expect(rows.nth(0)).toContainText('To do');
  await expect(rows.nth(0).locator('.bar.bad')).toHaveCount(1);
  await expect(rows.nth(1)).toContainText('Waiting parts');
  await expect(rows.nth(1).locator('.bar.ok')).toHaveCount(1);
  await expect(b.getByRole('link', { name: 'Open maintenance' })).toHaveAttribute('href', '#/maintenance');
  await expect(page.getByRole('heading', { name: 'Open problems' })).toHaveCount(0);
});

test('une ligne ouvre l ecran Maintenance sur le ticket, sans appel mgr.problem', async ({ page }) => {
  await bootMgr(page, [me(MANAGER), TODAY()], { email: true, clock: NOW });
  await block(page).locator('a.prob').first().click();
  await expect(page).toHaveURL(/#\/maintenance\?ref=MNT-429/);
  // T6 #2 : aucun appel a l'ancienne fiche Problems.
  expect((await fetchLog(page)).some((l) => l.url.includes('action=mgr.problem'))).toBe(false);
});

test('rien d ouvert : message vide', async ({ page }) => {
  const body = todayBody({ maintenance: { counts: { proposals: 0, proposalsUrgent: 0, open: 0, urgent: 0, unassigned: 0 }, top: [] } });
  await bootMgr(page, [me(MANAGER), TODAY(body)], { email: true, clock: NOW });
  await expect(block(page)).toContainText('Nothing open.');
  await expect(block(page).locator('a.prob')).toHaveCount(0);
});

test('maintenance null : message d indisponibilite, Today reste affiche', async ({ page }) => {
  await bootMgr(page, [me(MANAGER), TODAY(todayBody({ maintenance: null }))], { email: true, clock: NOW });
  await expect(block(page)).toContainText('Maintenance is unavailable right now.');
  await expect(page.getByRole('heading', { name: 'Who does what today' })).toBeVisible();
});

test('pastille Maintenance : propositions de Today annoncees', async ({ page }, info) => {
  await bootMgr(page, [me(MANAGER), TODAY()], { email: true, clock: NOW });
  const nav = page.locator(info.project.name === 'mgr-desktop' ? '#sideNav' : '#tabbar');
  await expect(nav.locator('a[href="#/maintenance"] .nbadge')).toHaveText('3');
});

test('F5 : compteurs au singulier pour 1', async ({ page }) => {
  const body = todayBody();
  body.maintenance.counts = { proposals: 1, proposalsUrgent: 0, open: 1, urgent: 1, unassigned: 1 };
  await bootMgr(page, [me(MANAGER), TODAY(body)], { email: true, clock: NOW });
  const c = block(page).locator('.count');
  await expect(c.nth(0)).toHaveText('1 proposal to check');
  await expect(c.nth(1)).toHaveText('1 urgent ticket');
  await expect(c.nth(2)).toHaveText('1 with nobody');
});
