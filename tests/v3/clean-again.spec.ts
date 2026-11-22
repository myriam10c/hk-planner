import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { BLOOM, DAY, WRITE_ROUTES, carteAcces, demarrer, ecritures, fileVide, fileVideApresRetour } from './conv-helpers';
import { fetchLog, liberer, noHorizontalScroll } from './helpers';

// Lot 1 des corrections cleaner, tache 5 : un menage fini sur le serveur, sans conversation sur ce
// telephone (rechargement apres la fin), s'ouvre en lecture seule : « Cleaning done », l'heure de
// fin, ce que la journee sait deja. Avant, il s'ouvrait sur « I'm here » et un appui rouvrait le
// chrono clos. Seul « Clean again », confirme en deux temps, relance un menage, et son demarrage
// porte l'indicateur explicite. Un demarrage refuse par le proxy (422 « job_done ») n'est ni
// relance, ni mis au magasin mort, ni affiche en erreur brute.

// Demarre a 10:00, fini a 11:30 (heure de Dubai).
const FINI = { ...BLOOM, state: 'done', startedAt: '2026-10-02T06:00:00Z', finishedAt: '2026-10-02T07:30:00Z' };
const JOUR_FINI = { ...DAY, stops: [FINI, DAY.stops[1]] };
const sansMyDay = WRITE_ROUTES.filter((r) => r.match !== 'action=v3.myDay');
const ROUTES_FINI = [{ match: 'action=v3.myDay', status: 200, body: JOUR_FINI }, ...sansMyDay];
const REFUS = { status: 422, body: { error: 'Cleaning already done', code: 'job_done' } };
// La journee du telephone dit encore « todo » (lue avant la fin d'une collegue) : le proxy refuse.
// Relue apres le refus (tache 6 du lot 1), elle dit le menage fini, avec son heure de fin.
const ROUTES_REFUS = [
  { match: 'action=v3.myDay', status: 200, body: DAY, once: true },
  { match: 'action=v3.myDay', status: 200, body: JOUR_FINI },
  { match: 'action=v3.startJob', ...REFUS },
  ...WRITE_ROUTES.filter((r) => r.match !== 'action=v3.startJob' && r.match !== 'action=v3.myDay'),
];

const morts = (page: Page) => page.evaluate(async () => (await (await import('/v3/offline.js')).deadEntries()).length);
const demarrages = async (page: Page) =>
  (await fetchLog(page)).filter((l) => l.url.indexOf('action=v3.startJob') !== -1).map((l) => JSON.parse(l.body));

test('menage fini sur le serveur : lecture seule « Cleaning done » avec l heure de fin, rien n est ecrit', async ({ page }) => {
  await demarrer(page, ROUTES_FINI);
  const ligne = page.getByRole('button', { name: /1011C Bloom Towers/ });
  await expect(ligne.locator('.row-sub')).toHaveText('Cleaning done');
  await ligne.click();
  await expect(page.locator('.top .title span')).toHaveText('Cleaning done at 11:30');
  await expect(page.getByText('Started at 10:00.')).toBeVisible();
  await expect(page.getByText('Cleaning done at 11:30.')).toBeVisible();
  await expect(page.locator('[data-reply="here"]')).toHaveCount(0);
  await expect(page.locator('.vf')).toHaveCount(0);
  await expect(page.locator('[data-act="again-ask"]')).toHaveText('Clean again');
  // Retour a la liste : la ligne garde l'etat du serveur, et rien n'est parti.
  await page.locator('[data-act="back"]').click();
  await expect(ligne.locator('.row-sub')).toHaveText('Cleaning done');
  expect(await ecritures(page)).toEqual([]);
});

test('menage fini sans heure de fin connue (manager, ancienne app) : « Cleaning done » sans heure', async ({ page }) => {
  const sansFin = { ...FINI, finishedAt: null };
  await demarrer(page, [{ match: 'action=v3.myDay', status: 200, body: { ...DAY, stops: [sansFin] } }, ...sansMyDay]);
  await page.getByRole('button', { name: /1011C Bloom Towers/ }).click();
  await expect(page.locator('.top .title span')).toHaveText('Cleaning done');
  await expect(page.getByText('Cleaning done.')).toBeVisible();
  await expect(page.locator('[data-act="again-ask"]')).toBeVisible();
});

test('Clean again : confirmation en deux temps, puis un menage neuf dont le demarrage porte l indicateur', async ({ page }) => {
  await demarrer(page, ROUTES_FINI);
  await page.getByRole('button', { name: /1011C Bloom Towers/ }).click();
  await page.locator('[data-act="again-ask"]').click();
  await expect(page.locator('.confirm b')).toHaveText('Start a new cleaning?');
  // « No » : retour au bouton, rien ne change.
  await page.locator('[data-act="again-no"]').click();
  await expect(page.locator('.confirm')).toHaveCount(0);
  await expect(page.locator('[data-act="again-ask"]')).toBeVisible();
  expect(await demarrages(page)).toEqual([]);
  await page.locator('[data-act="again-ask"]').click();
  await page.locator('[data-act="again-yes"]').click();
  // Parcours neuf, sur « I'm here » ; rien n'est parti avant.
  await expect(page.locator('[data-reply="here"]')).toBeVisible();
  expect(await demarrages(page)).toEqual([]);
  await page.locator('[data-reply="here"]').click();
  await carteAcces(page);
  await fileVide(page);
  const d = await demarrages(page);
  expect(d.length).toBe(1);
  expect(d[0]).toEqual({ jobId: FINI.jobId, idem: d[0].idem, again: true });
});

// Revue finale du lot 1 : « Clean again » confirme est enregistre tout de suite. Avant, rien
// n'etait garde avant « I'm here » : l'app tuee puis rouverte hors ligne perdait l'indicateur.
const copieConvs = (page: Page) => page.evaluate(async () => {
  const blob = await (await import('/v3/offline.js')).getState('v3Convs');
  const c = blob && blob.convs ? blob.convs['job_0000000000000blm1011'] : null;
  return blob ? { activeId: blob.activeId, screen: blob.screen, again: c ? c.again === true : null } : null;
});

test('Clean again confirme : la conversation est enregistree avant tout autre geste et survit a un rechargement hors ligne', async ({ page }) => {
  await demarrer(page, ROUTES_FINI);
  await page.getByRole('button', { name: /1011C Bloom Towers/ }).click();
  await page.locator('[data-act="again-ask"]').click();
  await page.locator('[data-act="again-yes"]').click();
  await expect(page.locator('[data-reply="here"]')).toBeVisible();
  await expect.poll(() => copieConvs(page)).toEqual({ activeId: BLOOM.jobId, screen: 'conv', again: true });
  expect(await demarrages(page)).toEqual([]);

  await page.evaluate(() => localStorage.setItem('v3TestOffline', '1'));
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => (window as any).__v3ready === true);
  await expect(page.locator('[data-reply="here"]')).toBeVisible();
  await expect(page.locator('[data-act="again-ask"]')).toHaveCount(0);
  expect(await page.evaluate((id) => (window as any).__hk.convs[id].again, BLOOM.jobId)).toBe(true);
  // Le demarrage mis en file porte l'indicateur.
  await page.locator('[data-reply="here"]').click();
  await expect.poll(async () => page.evaluate(async () => (await (await import('/v3/offline.js')).pendingEntries())
    .filter((e: any) => e.action === 'v3.startJob').map((e: any) => e.body.again))).toEqual([true]);
});

test('un demarrage ordinaire ne porte pas l indicateur', async ({ page }) => {
  await demarrer(page);
  await page.getByRole('button', { name: /1011C Bloom Towers/ }).click();
  await page.locator('[data-reply="here"]').click();
  await carteAcces(page);
  await fileVide(page);
  const d = await demarrages(page);
  expect(Object.keys(d[0]).sort()).toEqual(['idem', 'jobId']);
});

test('demarrage refuse en ligne (menage fini) : ni erreur brute ni magasin mort, l appartement passe en « Cleaning done »', async ({ page }) => {
  await demarrer(page, ROUTES_REFUS);
  await page.getByRole('button', { name: /1011C Bloom Towers/ }).click();
  await page.locator('[data-reply="here"]').click();
  await expect(page.locator('.top .title span')).toHaveText('Cleaning done', { timeout: 10_000 });
  await expect(page.locator('.vf')).toHaveCount(0);
  await expect(page.locator('[data-act="again-ask"]')).toBeVisible();
  await expect(page.getByText('1011C Bloom Towers: this cleaning is already done.')).toBeVisible();
  await expect(page.getByText(/Not sent/)).toHaveCount(0);
  await fileVide(page);
  expect(await morts(page)).toBe(0);
  // Un seul essai : le refus n'est jamais relance.
  await page.waitForTimeout(500);
  expect((await demarrages(page)).length).toBe(1);
  await page.locator('[data-act="back"]').click();
  await expect(page.getByRole('button', { name: /1011C Bloom Towers/ }).locator('.row-sub')).toHaveText('Cleaning done');
  // Journee relue apres le refus (tache 6 du lot 1) : l'heure de fin est connue, la copie gardee aussi.
  await expect.poll(async () => page.evaluate(async () => {
    const c = await (await import('/v3/offline.js')).getState('v3Day');
    return c && c.day.stops[0].finishedAt;
  })).toBe(FINI.finishedAt);
  await page.getByRole('button', { name: /1011C Bloom Towers/ }).click();
  await expect(page.locator('.top .title span')).toHaveText('Cleaning done at 11:30');
});

// Correction 1 de la tache 6, complement : le 422 dit le menage fini ; le telephone le retient sans
// attendre la relecture qui suit. Avant, si cette relecture ratait, la copie gardee disait encore
// « todo » : rouverte sans reseau, l'app reproposait « I'm here ». Heure de fin inconnue : jamais
// celle du refus a l'ecran.
const copieDuJour = (page: Page) => page.evaluate(async () => (await import('/v3/offline.js')).getState('v3Day'));
const nbMyDay = async (page: Page) => (await fetchLog(page)).filter((l) => l.url.indexOf('action=v3.myDay') !== -1).length;

test('demarrage refuse en 422 puis relecture en echec (500) : rouverte sans reseau, « Cleaning done » sans heure, jamais « I m here »', async ({ page }) => {
  await demarrer(page, [
    { match: 'action=v3.myDay', status: 200, body: DAY, once: true },
    { match: 'action=v3.myDay', status: 500, body: { error: 'boom' }, once: true, hold: 'relue' },
    { match: 'action=v3.myDay', status: 500, body: { error: 'boom' } },
    { match: 'action=v3.startJob', ...REFUS },
    ...WRITE_ROUTES.filter((r) => r.match !== 'action=v3.startJob' && r.match !== 'action=v3.myDay'),
  ]);
  await page.getByRole('button', { name: /1011C Bloom Towers/ }).click();
  await page.locator('[data-reply="here"]').click();
  await expect(page.locator('.top .title span')).toHaveText('Cleaning done', { timeout: 10_000 });
  // Relecture forcee apres le refus, retenue puis refusee : la copie dit encore le menage a faire.
  await expect.poll(() => nbMyDay(page)).toBe(2);
  await liberer(page, 'relue');
  await expect.poll(() => page.evaluate(() => (window as any).__hk.relectureEchec)).toBe(true);
  expect(((await copieDuJour(page)).day.stops[0] || {}).state).toBe('todo');

  await page.evaluate(() => localStorage.setItem('v3TestOffline', '1'));
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => (window as any).__v3ready === true);
  const ligne = page.getByRole('button', { name: /1011C Bloom Towers/ });
  await expect(ligne.locator('.row-sub')).toHaveText('Cleaning done');
  await ligne.click();
  await expect(page.locator('.top .title span')).toHaveText('Cleaning done');
  await expect(page.getByText('Cleaning done.')).toBeVisible();
  await expect(page.locator('[data-reply="here"]')).toHaveCount(0);
  // Marque sans heure de fin ; « Clean again » confirme la retire.
  expect((await copieDuJour(page)).done).toEqual({ [BLOOM.jobId]: { at: expect.any(Number), timeKnown: false } });
  await page.locator('[data-act="again-ask"]').click();
  await page.locator('[data-act="again-yes"]').click();
  await expect(page.locator('[data-reply="here"]')).toBeVisible();
  await expect.poll(async () => (await copieDuJour(page)).done).toEqual({});
});

test('demarrage refuse au rejeu (hors ligne puis retour) : la file continue derriere, rien au magasin mort', async ({ page }) => {
  await demarrer(page, ROUTES_REFUS);
  await page.getByRole('button', { name: /1011C Bloom Towers/ }).click();
  // Coupure par le drapeau du faux fetch (voir offline.spec.ts : WebKit hors ligne refuse la
  // lecture des Blob de la page).
  await page.evaluate(() => localStorage.setItem('v3TestOffline', '1'));
  await page.locator('[data-reply="here"]').click();
  await carteAcces(page);
  await expect.poll(async () => page.evaluate(async () => (await (await import('/v3/offline.js')).pendingEntries()).length)).toBe(2);
  await page.evaluate(() => { localStorage.removeItem('v3TestOffline'); window.dispatchEvent(new Event('online')); });
  await fileVideApresRetour(page);
  const e = await ecritures(page);
  expect(e.map((x) => x.action)).toEqual(['v3.startJob', 'v3.uploadPhoto']);
  expect(await morts(page)).toBe(0);
  await expect(page.getByText(/Not sent/)).toHaveCount(0);
  await expect(page.locator('.top .title span')).toHaveText('Cleaning done');
  await expect(page.locator('[data-act="again-ask"]')).toBeVisible();
});

test('360 px : ecran fini et confirmation sans defilement horizontal, cibles de 48 px', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await demarrer(page, ROUTES_FINI);
  await page.getByRole('button', { name: /1011C Bloom Towers/ }).click();
  const demande = page.locator('[data-act="again-ask"]');
  await expect(demande).toBeVisible();
  let s = await noHorizontalScroll(page);
  expect(s.scrollWidth).toBeLessThanOrEqual(s.clientWidth);
  expect((await demande.boundingBox())!.height).toBeGreaterThanOrEqual(48);
  await demande.click();
  for (const act of ['again-yes', 'again-no']) {
    const b = page.locator('[data-act="' + act + '"]');
    await expect(b).toBeVisible();
    const box = (await b.boundingBox())!;
    expect(box.height).toBeGreaterThanOrEqual(48);
    expect(box.x + box.width).toBeLessThanOrEqual(360);
  }
  s = await noHorizontalScroll(page);
  expect(s.scrollWidth).toBeLessThanOrEqual(s.clientWidth);
});
