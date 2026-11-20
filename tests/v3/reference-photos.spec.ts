import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { BLOOM, DAY, PNG_1x1, WRITE_ROUTES, carteAcces, photo, piece } from './conv-helpers';
import { bootV3, fetchLog } from './helpers';

// Photos « make it look like this » valables toute la journee (lot 1, tache 4) : l'URL est relue sur
// l'appartement au rendu, une relecture de la journee la rafraichit (conversation en cours comprise),
// et une image qui ne charge pas disparait sans casser le parcours.

const URL_REF = (nom: string, jeton = '1') => 'https://refs.test/' + nom + '.png?token=' + jeton;
const sansMyDay = WRITE_ROUTES.filter((r) => r.match !== 'action=v3.myDay');
const myDay = (corps: any) => ({ match: 'action=v3.myDay', status: 200, body: corps });
const jourAvec = (references: Record<string, string> | null) => ({ ...DAY, stops: [{ ...BLOOM, references }, DAY.stops[1]] });
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

// Bulle de l'etape 4 pour une piece avec reference (sous le viseur, mais presente dans la page).
const bulle = (page: Page, nom: string) => page.locator('.msg.app[data-ref-room="' + nom + '"]');
// Bulle d'une piece sans reference, ou dont l'image a disparu : « clean it, then take a photo ».
const bulleSans = (page: Page, nom: string) => page.locator('.msg.app', { hasText: nom + ': clean it, then take a photo.' });

test('une image de reference qui ne charge pas disparait : ni image cassee, ni plantage, le parcours continue', async ({ page }) => {
  const erreurs: string[] = [];
  page.on('pageerror', (e) => erreurs.push(e.message));
  await imagesDeReference(page, [URL_REF('bed-morte')]);
  await jusqueEtape4(page, [myDay(jourAvec({ Bed: URL_REF('bed-morte'), Kitchen: URL_REF('kitchen') })), ...sansMyDay]);
  // La bulle de la piece perd son image (retiree par l'ecouteur d'erreur) et prend le texte sans photo.
  await expect(bulle(page, 'Bed')).toHaveCount(1);
  await expect(bulle(page, 'Bed').locator('img')).toHaveCount(0);
  await expect(bulle(page, 'Bed')).toContainText('Bed: clean it, then take a photo.');
  await expect(bulle(page, 'Bed')).not.toContainText('make it look like this');
  await expect(page.locator('.vf img.vf-still')).toHaveCount(0);
  // Plus aucune image cassee a l'ecran.
  const cassees = await page.evaluate(() => Array.from(document.images).filter((i) => i.complete && i.naturalWidth === 0).length);
  expect(cassees).toBe(0);
  // Le parcours continue : photo, Next room, puis la piece suivante.
  await photo(page);
  await expect(page.locator('.vf .count')).toHaveText('1 photo');
  await page.locator('.vf [data-reply="next-room"]').click();
  await expect(page.locator('.vf-top b')).toHaveText(/^Step 4 · Bathroom /);
  // Bathroom n'a pas de reference : sa bulle est celle de la variante sans photo, sans image.
  await expect(bulleSans(page, 'Bathroom')).toHaveCount(1);
  await expect(bulleSans(page, 'Bathroom').locator('img')).toHaveCount(0);
  await photo(page);
  await page.locator('.vf [data-reply="next-room"]').click();
  await expect(page.locator('.vf-top b')).toHaveText(/^Step 4 · Kitchen /);
  // Kitchen garde sa reference, chargee.
  const kitchen = bulle(page, 'Kitchen').locator('img.ref');
  await expect(kitchen).toHaveCount(1);
  await expect.poll(() => kitchen.evaluate((i: HTMLImageElement) => i.complete && i.naturalWidth > 0)).toBe(true);
  expect(erreurs).toEqual([]);
});

test('relectures : meme fichier et jeton neuf = meme src, aucun nouveau telechargement ; autre fichier = nouveau src ; appartement absent ou references inconnues = rien ne change ; {} = image retiree', async ({ page }) => {
  const erreurs: string[] = [];
  page.on('pageerror', (e) => erreurs.push(e.message));
  const demandees = await imagesDeReference(page);
  await jusqueEtape4(page, [
    { ...myDay(jourAvec({ Bed: URL_REF('bed-1', '1') })), once: true },
    { ...myDay(jourAvec({ Bed: URL_REF('bed-1', '2') })), once: true },
    { ...myDay(jourAvec({ Bed: URL_REF('bed-2', '3') })), once: true },
    { ...myDay({ ...DAY, stops: [DAY.stops[1]] }), once: true },
    { ...myDay(jourAvec(null)), once: true },
    { ...myDay(jourAvec({})), once: true },
    ...sansMyDay,
    myDay(jourAvec({})),
  ]);
  const imageBulle = bulle(page, 'Bed').locator('img.ref');
  const imageViseur = page.locator('.vf img.vf-still');
  await expect(imageBulle).toHaveAttribute('src', URL_REF('bed-1', '1'));
  // 1. Meme fichier, jeton neuf : l'URL connue reste (pas de nouveau telechargement).
  await relire(page, 120_000, 2);
  await expect(imageBulle).toHaveAttribute('src', URL_REF('bed-1', '1'));
  await expect(imageViseur).toHaveAttribute('src', URL_REF('bed-1', '1'));
  // 2. Un autre fichier : la bulle et le viseur le prennent. Les deux relectures se suivent, donc
  //    le rendu de la premiere est fait avant celui-ci.
  await relire(page, 240_000, 3);
  await expect(imageBulle).toHaveAttribute('src', URL_REF('bed-2', '3'));
  await expect(imageViseur).toHaveAttribute('src', URL_REF('bed-2', '3'));
  expect(demandees).not.toContain(URL_REF('bed-1', '2'));
  // 3. Relecture sans cet appartement : rien ne change.
  await relire(page, 360_000, 4);
  await expect(imageBulle).toHaveAttribute('src', URL_REF('bed-2', '3'));
  // 4. References inconnues (le serveur n'a pas pu signer) : l'ancienne liste reste.
  await relire(page, 480_000, 5);
  await expect(imageBulle).toHaveAttribute('src', URL_REF('bed-2', '3'));
  // 5. L'appartement sans aucune photo pour la piece : l'image disparait, rien ne plante.
  await relire(page, 600_000, 6);
  await expect(imageBulle).toHaveCount(0);
  await expect(bulle(page, 'Bed')).toContainText('Bed: clean it, then take a photo.');
  await expect(imageViseur).toHaveCount(0);
  await photo(page);
  await page.locator('.vf [data-reply="next-room"]').click();
  await expect(page.locator('.vf-top b')).toHaveText(/^Step 4 · Bathroom /);
  expect(demandees).toContain(URL_REF('bed-2', '3'));
  expect(erreurs).toEqual([]);
});
