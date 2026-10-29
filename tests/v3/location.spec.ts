import { expect, test } from '@playwright/test';
import { bootV3, fetchLog } from './helpers';

// Position de l'equipe (plan 2026-10-29, tache 2) : avertissement une fois,
// demande du navigateur seulement apres OK, envoi limite (deplacement > 100 m ou
// plus de 5 min), rien en Practice. Heure figee a 10:00 Dubai : la fenetre
// 07:00-23:00 est ouverte quelle que soit l'heure du lancement.
const DIX_HEURES = new Date('2026-09-12T10:00:00+04:00');

const TEAM = [{ id: 3, name: 'Faiza', role: 'cleaner' }];
const JOURNEE = {
  status: 'success', date: '2026-09-12', me: { id: 3, name: 'Faiza', role: 'cleaner' },
  linenRequired: true, totalMinutes: 0, stops: [],
};
const JOUR_MANAGER = {
  status: 'success', date: '2026-09-12', me: { id: 1, name: 'Hillal', role: 'manager' },
  linenRequired: true, totalMinutes: 0, stops: [], team: TEAM,
};
const JOUR_FAIZA = { ...JOURNEE, viewAs: true, viewer: { id: 1, name: 'Hillal' }, team: TEAM };

const ROUTES = [
  { match: 'action=v3.myDay&as=3', status: 200, body: JOUR_FAIZA },
  { match: 'action=v3.myDay', status: 200, body: JOURNEE },
  { match: 'action=v3.myReports', status: 200, body: { reports: [] } },
  { match: 'action=v3.saveLocation', status: 200, body: { ok: true, saved: true } },
];

// Compte les appels a watchPosition : la demande du navigateur part avec lui.
async function compterWatch(page: any) {
  await page.addInitScript(() => {
    try {
      const proto = (window as any).Geolocation && (window as any).Geolocation.prototype;
      if (!proto || !proto.watchPosition) return;
      const vrai = proto.watchPosition;
      proto.watchPosition = function (this: any, ...args: any[]) {
        (window as any).__geoWatch = ((window as any).__geoWatch || 0) + 1;
        return vrai.apply(this, args);
      };
    } catch (e) { /* le test le verra */ }
  });
}

async function envois(page: any) {
  return (await fetchLog(page)).filter((l) => l.url.indexOf('action=v3.saveLocation') !== -1);
}

test.beforeEach(async ({ page, context }) => {
  await page.clock.setFixedTime(DIX_HEURES);
  await context.grantPermissions(['geolocation']);
  await context.setGeolocation({ latitude: 25.08, longitude: 55.14, accuracy: 12 });
  await compterWatch(page);
});

async function rouvrir(page: any) {
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => (window as any).__v3ready === true, null, { timeout: 10_000 });
}

test('cleaner : Not now ne demande rien, plus rien sur la page, redemande a l ouverture suivante', async ({ page }) => {
  await page.clock.install({ time: DIX_HEURES });
  await bootV3(page, ROUTES, { pinToken: 'jeton-pin', locNotice: null });
  const gate = page.locator('#locgate');
  await expect(gate.getByRole('heading', { name: 'Share your location' })).toBeVisible();
  await expect(gate).toContainText('between 7 AM and 11 PM');
  expect(await page.evaluate(() => (window as any).__geoWatch || 0)).toBe(0);
  await gate.getByRole('button', { name: 'Not now' }).click();
  await expect(gate).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem('hkLocNotice2:3'))).toBe('later:page');
  // Les minutes suivantes, meme page : pas de nouvelle demande.
  await page.clock.runFor(3 * 60_000);
  await page.waitForTimeout(300);
  await expect(page.locator('#locgate')).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).__geoWatch || 0)).toBe(0);
  expect(await envois(page)).toHaveLength(0);

  // Ouverture suivante de l'app : redemande.
  await rouvrir(page);
  await expect(page.locator('#locgate').getByRole('heading', { name: 'Share your location' })).toBeVisible();
  await expect(page.locator('#locgate [data-loc="later"]')).toHaveText('Not now');
  expect(await page.evaluate(() => (window as any).__geoWatch || 0)).toBe(0);
});

test('cleaner : ancien choix (hkLocNotice:<id>) ignore, la question revient', async ({ page }) => {
  await bootV3(page, ROUTES, { pinToken: 'jeton-pin', locNotice: null });
  await page.evaluate(() => { localStorage.setItem('hkLocNotice:3', 'ok'); });
  await rouvrir(page);
  await expect(page.locator('#locgate').getByRole('heading', { name: 'Share your location' })).toBeVisible();
});

test('maintenance dans /v3/ : Not now garde la regle du jour suivant', async ({ page }) => {
  const maint = { ...JOURNEE, me: { id: 7, name: 'Semax', role: 'maintenance' } };
  await bootV3(page, [{ match: 'action=v3.myDay', status: 200, body: maint }, ...ROUTES.slice(2)], { pinToken: 'jeton-pin', locNotice: null });
  await page.locator('#locgate').getByRole('button', { name: 'Not now' }).click();
  expect(await page.evaluate(() => localStorage.getItem('hkLocNotice2:7'))).toBe('later:2026-09-12');
  await rouvrir(page);
  await page.waitForTimeout(800);
  await expect(page.locator('#locgate')).toHaveCount(0);
});

test('shareLocation false : ni avertissement, ni demande, ni envoi, ni ligne Profile', async ({ page }) => {
  const coupe = { ...JOURNEE, me: { ...JOURNEE.me, shareLocation: false } };
  const routes = [{ match: 'action=v3.myDay', status: 200, body: coupe }, ...ROUTES.slice(2)];
  await bootV3(page, routes, { pinToken: 'jeton-pin', locNotice: null });
  await page.waitForTimeout(1000);
  await expect(page.locator('#locgate')).toHaveCount(0);
  // Meme avec un OK garde : rien.
  await page.evaluate(() => localStorage.setItem('hkLocNotice2:3', 'ok'));
  await rouvrir(page);
  await page.waitForTimeout(1500);
  await expect(page.locator('#locgate')).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).__geoWatch || 0)).toBe(0);
  expect(await envois(page)).toHaveLength(0);
  await page.evaluate(() => { location.hash = '#/profile'; });
  await expect(page.getByRole('button', { name: /sign out/i })).toBeVisible();
  await page.waitForTimeout(500);
  await expect(page.locator('.locrow')).toHaveCount(0);
});

test('shareLocation true explicite : comportement normal', async ({ page }) => {
  const oui = { ...JOURNEE, me: { ...JOURNEE.me, shareLocation: true } };
  await bootV3(page, [{ match: 'action=v3.myDay', status: 200, body: oui }, ...ROUTES.slice(2)], { pinToken: 'jeton-pin', locNotice: null });
  await expect(page.locator('#locgate').getByRole('heading', { name: 'Share your location' })).toBeVisible();
});

test('reponse not_shared : un seul envoi, plus rien sur la page', async ({ page, context }) => {
  const routes = [...ROUTES.slice(0, 3), { match: 'action=v3.saveLocation', status: 200, body: { ok: true, saved: false, reason: 'not_shared' } }];
  await bootV3(page, routes, { pinToken: 'jeton-pin', locNotice: 'ok' });
  await expect.poll(async () => (await envois(page)).length).toBe(1);
  await context.setGeolocation({ latitude: 25.09, longitude: 55.14, accuracy: 12 });
  await page.waitForTimeout(1500);
  expect(await envois(page)).toHaveLength(1);
});

test('cleaner, OK mais position bloquee par Chrome : rappel a chaque ouverture, un seul bouton OK', async ({ page }) => {
  await page.addInitScript(() => {
    try {
      const p = (navigator as any).permissions;
      const vrai = p.query.bind(p);
      p.query = (d: any) => (d && d.name === 'geolocation' ? Promise.resolve({ state: 'denied' }) : vrai(d));
    } catch (e) { /* le test le verra */ }
  });
  await bootV3(page, ROUTES, { pinToken: 'jeton-pin', locNotice: 'ok' });
  const gate = page.locator('#locgate[data-variant="blocked"]');
  await expect(gate).toBeVisible();
  await expect(gate.getByRole('heading', { name: 'Share your location' })).toBeVisible();
  await expect(gate.locator('p')).toHaveText(
    'Location is blocked. In Chrome: tap the lock icon next to the address, then Permissions, then Location, Allow.');
  await expect(gate.locator('button')).toHaveCount(1);
  await gate.getByRole('button', { name: 'OK' }).click();
  await expect(page.locator('#locgate')).toHaveCount(0);
  // Rien n'est change dans le choix.
  expect(await page.evaluate(() => localStorage.getItem('hkLocNotice2:3'))).toBe('ok');
  await page.waitForTimeout(500);
  await expect(page.locator('#locgate')).toHaveCount(0);
  await rouvrir(page);
  await expect(page.locator('#locgate[data-variant="blocked"]')).toBeVisible();
});

test('cleaner, position autorisee : pas de rappel bloque', async ({ page }) => {
  await bootV3(page, ROUTES, { pinToken: 'jeton-pin', locNotice: 'ok' });
  await expect.poll(async () => (await envois(page)).length).toBe(1);
  await expect(page.locator('#locgate')).toHaveCount(0);
});

test('OK partage la position, puis seulement si deplacement > 100 m ou plus de 5 min', async ({ page, context }) => {
  await bootV3(page, ROUTES, { pinToken: 'jeton-pin', locNotice: null });
  await page.locator('#locgate').getByRole('button', { name: 'OK' }).click();
  await expect(page.locator('#locgate')).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem('hkLocNotice2:3'))).toBe('ok');

  await expect.poll(async () => (await envois(page)).length).toBe(1);
  const corps = JSON.parse((await envois(page))[0].body);
  expect(corps.lat).toBeCloseTo(25.08, 5);
  expect(corps.lng).toBeCloseTo(55.14, 5);
  expect(corps.accuracy).toBe(12);
  expect(typeof corps.recordedAt).toBe('string');
  expect(Number.isNaN(Date.parse(corps.recordedAt))).toBe(false);

  // ~44 m, meme minute : rien.
  await context.setGeolocation({ latitude: 25.0804, longitude: 55.14, accuracy: 12 });
  await page.waitForTimeout(1500);
  expect(await envois(page)).toHaveLength(1);

  // ~220 m : envoye.
  await context.setGeolocation({ latitude: 25.082, longitude: 55.14, accuracy: 12 });
  await expect.poll(async () => (await envois(page)).length).toBe(2);

  // Six minutes plus tard, quasi immobile : envoye quand meme.
  await page.clock.setFixedTime(new Date(DIX_HEURES.getTime() + 6 * 60 * 1000));
  await context.setGeolocation({ latitude: 25.08201, longitude: 55.14, accuracy: 12 });
  await expect.poll(async () => (await envois(page)).length).toBe(3);
});

test('hors fenetre (23:30 Dubai) : ni avertissement ni demande', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-09-12T23:30:00+04:00'));
  await bootV3(page, ROUTES, { pinToken: 'jeton-pin', locNotice: null });
  await page.waitForTimeout(800);
  await expect(page.locator('#locgate')).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).__geoWatch || 0)).toBe(0);
});

test('Practice : ni avertissement, ni demande de position, ni envoi', async ({ page }) => {
  const routes = [{ match: 'action=v3.myDay&as=3', status: 200, body: JOUR_FAIZA },
    { match: 'action=v3.myDay', status: 200, body: JOUR_MANAGER }, ...ROUTES.slice(2)];
  await bootV3(page, routes, { pinToken: 'jeton-manager', hash: '#/profile' });
  await page.getByRole('button', { name: 'Practice as Faiza' }).click();
  await expect(page.locator('.practicebar')).toContainText('Practice as Faiza');

  // Avertissement jamais repondu : il ne s'ouvre pas en Practice.
  await page.evaluate(() => { localStorage.removeItem('hkLocNotice2:1'); localStorage.removeItem('hkLocNotice2:3'); });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => (window as any).__v3ready === true, null, { timeout: 10_000 });
  await expect(page.locator('.practicebar')).toContainText('Practice as Faiza');
  await page.waitForTimeout(1000);
  await expect(page.locator('#locgate')).toHaveCount(0);

  // Partage deja accepte : toujours aucune demande ni envoi en Practice.
  await page.evaluate(() => { localStorage.setItem('hkLocNotice2:1', 'ok'); localStorage.setItem('hkLocNotice2:3', 'ok'); });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => (window as any).__v3ready === true, null, { timeout: 10_000 });
  await expect(page.locator('.practicebar')).toContainText('Practice as Faiza');
  await page.waitForTimeout(1500);
  expect(await page.evaluate(() => (window as any).__geoWatch || 0)).toBe(0);
  expect(await envois(page)).toHaveLength(0);
  // Profile en Practice : pas de ligne de partage.
  await page.evaluate(() => { location.hash = '#/profile'; });
  await expect(page.getByText('Try the cleaner app')).toBeVisible();
  await expect(page.locator('.locrow')).toHaveCount(0);
});

test('Profile : la ligne Location sharing dit On et rouvre l avertissement', async ({ page }) => {
  await bootV3(page, ROUTES, { pinToken: 'jeton-pin', locNotice: 'ok', hash: '#/profile' });
  const ligne = page.locator('.locrow');
  await expect(ligne).toContainText('Location sharing');
  await expect(ligne).toContainText('On');
  await ligne.click();
  await page.locator('#locgate').getByRole('button', { name: 'Not now' }).click();
  await expect(ligne).toContainText('Off');
  await ligne.click();
  await page.locator('#locgate').getByRole('button', { name: 'OK' }).click();
  await expect(ligne).toContainText('On');
});

test('Profile : position bloquee par le navigateur, aide pour Chrome', async ({ page }) => {
  await page.addInitScript(() => {
    try {
      const p = (navigator as any).permissions;
      const vrai = p.query.bind(p);
      p.query = (d: any) => (d && d.name === 'geolocation' ? Promise.resolve({ state: 'denied' }) : vrai(d));
    } catch (e) { /* le test le verra */ }
  });
  await bootV3(page, ROUTES, { pinToken: 'jeton-pin', locNotice: 'ok', hash: '#/profile' });
  // Rappel a l'ouverture (cleaner, OK, bloque) : ferme d'abord.
  await page.locator('#locgate[data-variant="blocked"]').getByRole('button', { name: 'OK' }).click();
  await expect(page.locator('.locrow')).toContainText('Blocked');
  await expect(page.locator('.lochelp')).toHaveText(
    'Location is blocked. In Chrome: tap the lock icon next to the address, then Permissions, then Location, Allow.');
});

test('sous-traitant : ni avertissement, ni demande, ni ligne dans Profile', async ({ page }) => {
  const sous = { ...JOURNEE, me: { id: 12, name: 'Elite Cleaning', role: 'subcontractor' } };
  const routes = [{ match: 'action=v3.myDay', status: 200, body: sous }, ...ROUTES.slice(2)];
  await bootV3(page, routes, { pinToken: 'jeton-pin', locNotice: null });
  await page.waitForTimeout(1000);
  await expect(page.locator('#locgate')).toHaveCount(0);
  // Meme avec un OK garde (par exemple d'avant le changement de role) : rien.
  await page.evaluate(() => localStorage.setItem('hkLocNotice2:12', 'ok'));
  await page.evaluate(() => { location.hash = '#/profile'; });
  await expect(page.getByRole('button', { name: /sign out/i })).toBeVisible();
  await page.waitForTimeout(500);
  await expect(page.locator('.locrow')).toHaveCount(0);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => (window as any).__v3ready === true, null, { timeout: 10_000 });
  await page.waitForTimeout(1500);
  expect(await page.evaluate(() => (window as any).__geoWatch || 0)).toBe(0);
  expect(await envois(page)).toHaveLength(0);
});

test('app ouverte avant 7 h : l avertissement arrive quand la fenetre s ouvre', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-09-12T06:58:30+04:00') });
  await bootV3(page, ROUTES, { pinToken: 'jeton-pin', locNotice: null });
  await page.waitForTimeout(800);
  await expect(page.locator('#locgate')).toHaveCount(0);
  // Minute suivante, toujours avant 7 h : rien.
  await page.clock.fastForward(60_000);
  await page.waitForTimeout(300);
  await expect(page.locator('#locgate')).toHaveCount(0);
  // 07:00 passees : propose par le tic de la minute, sans rechargement.
  await page.clock.fastForward(60_000);
  await expect(page.locator('#locgate').getByRole('heading', { name: 'Share your location' })).toBeVisible();
  expect(await page.evaluate(() => (window as any).__geoWatch || 0)).toBe(0);
  await page.locator('#locgate').getByRole('button', { name: 'Not now' }).click();
  // Repondu (cleaner : pour cette ouverture) : la minute suivante ne le repropose pas.
  await page.clock.fastForward(60_000);
  await page.waitForTimeout(300);
  await expect(page.locator('#locgate')).toHaveCount(0);
});
