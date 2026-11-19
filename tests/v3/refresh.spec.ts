import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { BLOOM, CREEK, DAY, WRITE_ROUTES } from './conv-helpers';
import { bootV3, fetchLog } from './helpers';

// La journee se relit seule (lot 1, tache 2) : retour au premier plan apres plus de 60 s,
// changement de jour a Dubai, bouton Refresh. Le proxy est bouche ; un second v3.myDay
// (route `once` qui passe devant la premiere) rend la journee modifiee par un manager.

const TROISIEME = {
  ...BLOOM, jobId: 'job_0000000000000sbw3207', listingId: '204', listingName: '3207 - Sobha Waves',
  state: 'done',
};
const DAY2 = { ...DAY, stops: [BLOOM, CREEK, TROISIEME] };
const sansMyDay = WRITE_ROUTES.filter((r) => r.match !== 'action=v3.myDay');
const myDay = (corps: any, status = 200) => ({ match: 'action=v3.myDay', status, body: corps });

// Sert DAY au boot, puis la reponse donnee a la premiere relecture, puis DAY.
const routes = (relecture: any, status = 200) => [
  { ...myDay(DAY), once: true },
  { ...myDay(relecture, status), once: true },
  ...sansMyDay,
  myDay(DAY),
];

const nbMyDay = async (page: Page) => (await fetchLog(page)).filter((e) => e.url.indexOf('action=v3.myDay') !== -1).length;
const auPremierPlan = (page: Page) => page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
const plusTard = (page: Page, ms: number) => page.clock.setFixedTime(new Date(Date.now() + ms));

test('retour au premier plan apres plus de 60 s : l appartement ajoute apparait, sans ecran de chargement', async ({ page }) => {
  await bootV3(page, routes(DAY2), { pinToken: 'jeton-pin' });
  await expect(page.locator('.row')).toHaveCount(2);
  expect(await nbMyDay(page)).toBe(1);
  await plusTard(page, 120_000);
  await auPremierPlan(page);
  // Aucune bascule vers l'ecran « Loading your day » : la liste reste la.
  const chargement = page.evaluate(() => new Promise<boolean>((res) => {
    let vu = false;
    const o = new MutationObserver(() => { if (document.querySelector('.gate')) vu = true; });
    o.observe(document.body, { childList: true, subtree: true });
    setTimeout(() => { o.disconnect(); res(vu); }, 600);
  }));
  await expect(page.locator('.row')).toHaveCount(3);
  await expect(page.getByRole('button', { name: /3207 Sobha Waves/ })).toBeVisible();
  expect(await nbMyDay(page)).toBe(2);
  expect(await chargement).toBe(false);
});

test('retour au premier plan apres moins de 60 s : aucune relecture', async ({ page }) => {
  await bootV3(page, routes(DAY2), { pinToken: 'jeton-pin' });
  await expect(page.locator('.row')).toHaveCount(2);
  await plusTard(page, 30_000);
  await auPremierPlan(page);
  await page.waitForTimeout(400);
  expect(await nbMyDay(page)).toBe(1);
  await expect(page.locator('.row')).toHaveCount(2);
});

test('le jour de Dubai change : relecture meme moins de 60 s apres la derniere', async ({ page }) => {
  // Dubai = UTC+4 : minuit a Dubai, c'est 20:00 UTC.
  const minuit = new Date(); minuit.setUTCHours(20, 0, 0, 0);
  if (minuit.getTime() < Date.now()) minuit.setUTCDate(minuit.getUTCDate() + 1);
  await page.clock.setFixedTime(new Date(minuit.getTime() - 20_000));
  await bootV3(page, routes(DAY2), { pinToken: 'jeton-pin' });
  await expect(page.locator('.row')).toHaveCount(2);
  await page.clock.setFixedTime(new Date(minuit.getTime() + 5_000));
  await auPremierPlan(page);
  await expect(page.locator('.row')).toHaveCount(3);
  expect(await nbMyDay(page)).toBe(2);
});

test('une conversation en cours survit a la relecture : meme ecran, memes messages, role remis a jour', async ({ page }) => {
  const creekLead = { ...CREEK, role: 'lead', leadId: null };
  await bootV3(page, routes({ ...DAY2, stops: [BLOOM, creekLead, TROISIEME] }), { pinToken: 'jeton-pin' });
  await page.getByRole('button', { name: /1506 Emaar Creekside 18A/ }).click();
  await page.locator('[data-reply="here"]').click();
  const avant = await page.locator('.msg').count();
  expect(avant).toBeGreaterThan(1);
  const idConv = await page.evaluate(() => (window as any).__hk.activeId);
  expect(await page.evaluate((id) => (window as any).__hk.convs[id].apt.role, idConv)).toBe('helper');
  await plusTard(page, 120_000);
  await auPremierPlan(page);
  await expect.poll(() => nbMyDay(page)).toBe(2);
  await expect.poll(() => page.evaluate(() => (window as any).__hk.apartments.length)).toBe(3);
  const etat = await page.evaluate(() => { const h = (window as any).__hk; return { screen: h.screen, active: h.activeId, convs: Object.keys(h.convs) }; });
  expect(etat).toEqual({ screen: 'conv', active: idConv, convs: [idConv] });
  expect(await page.locator('.msg').count()).toBe(avant);
  expect(await page.evaluate((id) => (window as any).__hk.convs[id].apt.role, idConv)).toBe('lead');
});

test('le compteur du Profile suit la journee relue', async ({ page }) => {
  await bootV3(page, routes(DAY2), { pinToken: 'jeton-pin' });
  await page.getByRole('link', { name: 'Profile' }).click();
  await expect(page.locator('.dr-count b')).toHaveText('0/2');
  await plusTard(page, 120_000);
  await auPremierPlan(page);
  await expect(page.locator('.dr-count b')).toHaveText('1/3');
});

test('bouton Refresh : cible de 44 px, heure de lecture, relit meme moins de 60 s apres', async ({ page }) => {
  await bootV3(page, routes(DAY2), { pinToken: 'jeton-pin' });
  const bouton = page.getByRole('button', { name: 'Refresh' });
  await expect(bouton).toBeVisible();
  const box = await bouton.boundingBox();
  expect(box!.height).toBeGreaterThanOrEqual(44);
  expect(box!.width).toBeGreaterThanOrEqual(44);
  await expect(page.locator('.list-top .updated')).toHaveText(/^Updated \d\d:\d\d$/);
  await expect(page.locator('.row')).toHaveCount(2);
  await bouton.click();
  await expect(page.locator('.row')).toHaveCount(3);
  expect(await nbMyDay(page)).toBe(2);
  const { scrollWidth, clientWidth } = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth }));
  expect(scrollWidth).toBe(clientWidth);
});

test('relecture refusee : la liste reste affichee et le dit, sans bloquer', async ({ page }) => {
  await bootV3(page, routes({ error: 'boom' }, 500), { pinToken: 'jeton-pin' });
  await expect(page.locator('.row')).toHaveCount(2);
  await page.getByRole('button', { name: 'Refresh' }).click();
  await expect(page.locator('.list-top .updated')).toContainText("Couldn't update");
  await expect(page.locator('.row')).toHaveCount(2);
  // Elle peut reessayer : la route suivante rend la journee de base.
  await page.getByRole('button', { name: 'Refresh' }).click();
  await expect(page.locator('.list-top .updated')).toHaveText(/^Updated \d\d:\d\d$/);
});

test('Practice : pas de bouton Refresh, pas de relecture au retour au premier plan', async ({ page }) => {
  const equipe = [{ id: 3, name: 'Faiza', role: 'cleaner' }];
  const manager = { status: 'success', date: DAY.date, me: { id: 1, name: 'Hillal', role: 'manager' }, linenRequired: true, totalMinutes: 0, stops: [], team: equipe };
  const faiza = { ...DAY, me: { id: 3, name: 'Faiza', role: 'cleaner' }, viewAs: true, viewer: { id: 1, name: 'Hillal' }, team: equipe };
  await bootV3(page, [
    { match: 'action=v3.myDay&as=3', status: 200, body: faiza },
    { match: 'action=v3.myDay', status: 200, body: manager },
    { match: 'action=', status: 403, body: { error: 'forbidden' } },
  ], { pinToken: 'jeton-manager', hash: '#/profile' });
  await page.getByRole('button', { name: 'Practice as Faiza' }).click();
  await expect(page.locator('.practicebar')).toBeVisible();
  await expect(page.locator('.row')).toHaveCount(2);
  await expect(page.getByRole('button', { name: 'Refresh' })).toHaveCount(0);
  const avant = await nbMyDay(page);
  await plusTard(page, 120_000);
  await auPremierPlan(page);
  await page.waitForTimeout(400);
  expect(await nbMyDay(page)).toBe(avant);
});
