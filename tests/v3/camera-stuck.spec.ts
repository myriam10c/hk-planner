import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { bootV3 } from './helpers';
import { PNG_1x1, WRITE_ROUTES } from './conv-helpers';

// Incident du 18/11/2026 : deux cleaners ne pouvaient plus prendre de photo, viseur noir et
// declencheur sans effet, sans message. Quand la camera du telephone ne repond pas (demande
// qui ne revient jamais) ou ne donne pas d'image, le declencheur previent d'abord, puis ouvre
// l'appareil photo du telephone : il ne reste jamais muet.
type Camera = 'hang' | 'noimage' | 'late';

// Camera simulee. hang : la demande ne revient jamais. noimage : un flux branche, sans image.
// late : la demande revient quand le test appelle window.__camAnswer() (autorisation lue longtemps).
// Flux sans image = piste vivante d'un canvas jamais dessine. WebKit lui donne quand meme une
// taille dans la video de la page : `vide` y met un flux sans piste (meme branche du code).
async function ouvrir(page: Page, camera: Camera, { vide = false } = {}) {
  await page.addInitScript(({ mode, vide }) => {
    const w = window as any;
    const sansImage = () => {
      if (vide) return new MediaStream();
      const c = document.createElement('canvas'); c.width = 640; c.height = 480; return c.captureStream(0);
    };
    // Sur le prototype : WebKit perd une fonction posee sur l'objet navigator.mediaDevices lui-meme.
    MediaDevices.prototype.getUserMedia = ((): Promise<MediaStream> => {
      if (mode === 'hang') return new Promise(() => { /* jamais de reponse */ });
      if (mode === 'late') return new Promise((res) => { w.__camAnswer = () => { w.__camStream = sansImage(); res(w.__camStream); }; });
      w.__camStream = sansImage();
      return Promise.resolve(w.__camStream);
    }) as any;
  }, { mode: camera, vide });
  await bootV3(page, WRITE_ROUTES, { pinToken: 'jeton-pin' });
  await page.getByRole('button', { name: /1011C Bloom Towers/ }).click();
  await page.locator('[data-reply="here"]').click();
  await expect(page.locator('.vf-top b')).toHaveText('Step 1 · Access card & keys · as you find them');
}

const pisteCamera = (page: Page) => page.evaluate(() => (window as any).__camStream.getVideoTracks()[0].readyState);

async function photoParLeTelephone(page: Page) {
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.locator('[data-act="shutter"]').click()]);
  await chooser.setFiles({ name: 'p.png', mimeType: 'image/png', buffer: Buffer.from(PNG_1x1, 'base64') });
  await expect(page.locator('.vf .count')).toHaveText('1 photo');
  await expect(page.locator('.vf [data-reply="next-room"]')).toBeEnabled();
}

test('camera qui ne repond jamais : le declencheur previent, puis ouvre l appareil photo du telephone', async ({ page }) => {
  await ouvrir(page, 'hang');
  // Avant le delai : un message, jamais un bouton muet.
  await page.locator('[data-act="shutter"]').click();
  await expect(page.locator('.note')).toHaveText('Camera is starting. Tap again in a moment.');
  // Delai passe : le meme bouton ouvre l'appareil photo du telephone, et l'ecran le dit.
  await page.waitForTimeout(4100);
  await photoParLeTelephone(page);
  await expect(page.locator('.vf-msg')).toHaveText('Tap the circle to open your camera');
});

test('viseur sans image : apres le delai, le declencheur ouvre l appareil photo du telephone et le flux est arrete', async ({ page, browserName }) => {
  const webkit = browserName === 'webkit';
  await ouvrir(page, 'noimage', { vide: webkit });
  // Le flux est branche mais le viseur n'a pas d'image : meme message d'attente, pas de bouton muet.
  await expect.poll(() => page.evaluate(() => {
    const v = document.querySelector('#vf') as HTMLVideoElement;
    return !!v.srcObject && v.videoWidth === 0;
  })).toBe(true);
  if (!webkit) expect(await pisteCamera(page)).toBe('live');
  await page.locator('[data-act="shutter"]').click();
  await expect(page.locator('.note')).toHaveText('Camera is starting. Tap again in a moment.');
  await page.waitForTimeout(4100);
  await photoParLeTelephone(page);
  // La camera de la page est rendue : elle ne reste pas ouverte derriere l'appareil photo du telephone.
  if (!webkit) await expect.poll(() => pisteCamera(page)).toBe('ended');
});

test('autorisation accordee apres plus de 4 s : l appui qui suit garde la camera en direct', async ({ page }) => {
  let selecteurs = 0;
  page.on('filechooser', () => { selecteurs += 1; });
  await ouvrir(page, 'late');
  await page.waitForTimeout(4100);
  await page.evaluate(() => (window as any).__camAnswer());
  await page.locator('[data-act="shutter"]').click();
  // La camera vient de repondre : message d'attente (ou photo, si le viseur a deja une image),
  // jamais l'appareil photo du telephone.
  await expect(page.locator('.note, .vf .count').first()).toBeVisible();
  await expect(page.locator('.vf')).toHaveClass(/\blive\b/);
  expect(selecteurs).toBe(0);
  expect(await pisteCamera(page)).toBe('live');
});

test('camera qui repond apres le passage a l appareil photo du telephone : le viseur y reste, le flux tardif est arrete', async ({ page }) => {
  await ouvrir(page, 'late');
  await page.waitForTimeout(4100);
  await photoParLeTelephone(page);
  await page.evaluate(() => (window as any).__camAnswer());
  await expect.poll(() => pisteCamera(page)).toBe('ended');
  await expect(page.locator('.vf')).not.toHaveClass(/\blive\b/);
  await expect(page.locator('.vf-msg')).toHaveText('Tap the circle to open your camera');
  await expect(page.locator('.vf .count')).toHaveText('1 photo');
  expect(await page.evaluate(() => (document.querySelector('#vf') as HTMLVideoElement).srcObject)).toBeNull();
});
