import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { BLOOM, DAY, PNG_1x1, WRITE_ROUTES, carteAcces, photo, piece } from './conv-helpers';
import { bootV3, fetchLog } from './helpers';

// Photos « make it look like this » valables toute la journee (lot 1, tache 4) : l'URL est relue sur
// l'appartement au rendu, une relecture de la journee la rafraichit (conversation en cours comprise),
// et une image qui ne charge pas disparait sans casser le parcours.

const URL_REF = (nom: string) => 'https://refs.test/' + nom + '.png';
const sansMyDay = WRITE_ROUTES.filter((r) => r.match !== 'action=v3.myDay');
const myDay = (corps: any) => ({ match: 'action=v3.myDay', status: 200, body: corps });
const jourAvec = (references: Record<string, string>) => ({ ...DAY, stops: [{ ...BLOOM, references }, DAY.stops[1]] });
const auPremierPlan = (page: Page) => page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
const nbMyDay = async (page: Page) => (await fetchLog(page)).filter((e) => e.url.indexOf('action=v3.myDay') !== -1).length;
// Relecture : retour au premier plan apres `ms`, puis attente de la reponse du proxy.
async function relire(page: Page, ms: number, n: number) {
  await plusTard(page, ms);
  await auPremierPlan(page);
  await expect.poll(() => nbMyDay(page)).toBe(n);
}
const plusTard = (page: Page, ms: number) => page.clock.setFixedTime(new Date(Date.now() + ms));

// Images de reference : celles du jeu `mortes` echouent (404), les autres rendent un PNG.
async function imagesDeReference(page: Page, mortes: string[] = []) {
  const demandees: string[] = [];
  await page.route('https://refs.test/**', (route) => {
    const u = route.request().url();
    demandees.push(u);
    if (mortes.some((m) => u === m)) return route.fulfill({ status: 404, body: 'gone' });
    return route.fulfill({ status: 200, contentType: 'image/png', body: Buffer.from(PNG_1x1, 'base64') });
  });
  return demandees;
}

async function jusqueEtape4(page: Page, routes: any[]) {
  await page.addInitScript(() => {
    if (navigator.mediaDevices) {
      navigator.mediaDevices.getUserMedia = async () => { throw new DOMException('denied', 'NotAllowedError'); };
    }
    (navigator as any).share = async () => {};
    (navigator as any).canShare = () => true;
  });
  await bootV3(page, routes, { pinToken: 'jeton-pin' });
  await page.getByRole('button', { name: /1011C Bloom Towers/ }).click();
  await page.locator('[data-reply="here"]').click();
  await carteAcces(page);
  for (const r of ['Bed', 'Bathroom', 'Kitchen']) await piece(page, 1, r);
  await page.locator('[data-reply="walls-ok"]').click();
  await page.locator('[data-reply="no-damage"]').click();
  await page.locator('[data-reply="send-arrival-text"]').click();
  await page.locator('[data-reply="send-arrival"]').click();
  await page.locator('[data-reply="linen-yes"]').click();
  await expect(page.locator('.vf-top b')).toHaveText(/^Step 4 · Bed /);
}

// Bulle « <piece>: make it look like this. » du fil (sous le viseur, mais presente dans la page).
const bulle = (page: Page, nom: string) => page.locator('.msg.app', { hasText: nom + ': make it look like this.' });

test('une image de reference qui ne charge pas disparait : ni image cassee, ni plantage, le parcours continue', async ({ page }) => {
  const erreurs: string[] = [];
  page.on('pageerror', (e) => erreurs.push(e.message));
  await imagesDeReference(page, [URL_REF('bed-morte')]);
  await jusqueEtape4(page, [myDay(jourAvec({ Bed: URL_REF('bed-morte'), Kitchen: URL_REF('kitchen') })), ...sansMyDay]);
  // La bulle de la piece perd son image (retiree par l'ecouteur d'erreur), le texte reste.
  await expect(bulle(page, 'Bed')).toHaveCount(1);
  await expect(bulle(page, 'Bed').locator('img')).toHaveCount(0);
  await expect(page.locator('.vf img.vf-still')).toHaveCount(0);
  // Plus aucune image cassee a l'ecran.
  const cassees = await page.evaluate(() => Array.from(document.images).filter((i) => i.complete && i.naturalWidth === 0).length);
  expect(cassees).toBe(0);
  // Le parcours continue : photo, Next room, puis la piece suivante.
  await photo(page);
  await expect(page.locator('.vf .count')).toHaveText('1 photo');
  await page.locator('.vf [data-reply="next-room"]').click();
  await expect(page.locator('.vf-top b')).toHaveText(/^Step 4 · Bathroom /);
  await page.locator('.vf [data-act="close-camera"]').click();
  await expect(bulle(page, 'Bathroom').locator('img')).toHaveCount(0);
  expect(erreurs).toEqual([]);
});

test('relecture de la journee : la bulle deja posee lit la nouvelle URL ; une journee sans cet appartement ne change rien ; une piece sans photo relue perd son image', async ({ page }) => {
  const erreurs: string[] = [];
  page.on('pageerror', (e) => erreurs.push(e.message));
  const demandees = await imagesDeReference(page);
  await jusqueEtape4(page, [
    { ...myDay(jourAvec({ Bed: URL_REF('bed-1') })), once: true },
    { ...myDay(jourAvec({ Bed: URL_REF('bed-2') })), once: true },
    { ...myDay({ ...DAY, stops: [DAY.stops[1]] }), once: true },
    { ...myDay(jourAvec({})), once: true },
    ...sansMyDay,
    myDay(jourAvec({ Bed: URL_REF('bed-2') })),
  ]);
  await expect(bulle(page, 'Bed').locator('img.ref')).toHaveAttribute('src', URL_REF('bed-1'));
  // 1. Relecture avec une URL neuve : la bulle et le viseur la prennent.
  await relire(page, 120_000, 2);
  await expect(bulle(page, 'Bed').locator('img.ref')).toHaveAttribute('src', URL_REF('bed-2'));
  await expect(page.locator('.vf img.vf-still')).toHaveAttribute('src', URL_REF('bed-2'));
  // 2. Relecture sans cet appartement : l'URL reste celle d'avant.
  await relire(page, 240_000, 3);
  await expect(bulle(page, 'Bed').locator('img.ref')).toHaveAttribute('src', URL_REF('bed-2'));
  // 3. Relecture qui porte l'appartement sans photo pour la piece : l'image disparait, rien ne plante.
  await relire(page, 360_000, 4);
  await expect(bulle(page, 'Bed').locator('img')).toHaveCount(0);
  await expect(page.locator('.vf img.vf-still')).toHaveCount(0);
  await photo(page);
  await page.locator('.vf [data-reply="next-room"]').click();
  await expect(page.locator('.vf-top b')).toHaveText(/^Step 4 · Bathroom /);
  expect(demandees).toContain(URL_REF('bed-2'));
  expect(erreurs).toEqual([]);
});
