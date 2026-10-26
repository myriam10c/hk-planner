import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { bootV3, fetchLog, noHorizontalScroll } from './helpers';
import { WRITE_ROUTES, carteAcces, fileVide } from './conv-helpers';

// Interface conversation portee du prototype, sur la journee reelle (tache 4 du
// plan 2026-10-05) : la liste vient de v3.myDay, ouvrir un appartement cree la
// conversation locale. Les ecritures (tache 5) sont verifiees en detail par
// conversation-write.spec.ts ; ici, le proxy simule les accepte toutes.

const PNG_1x1 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const IMG = 'data:image/png;base64,' + PNG_1x1;
const dubaiToday = () => new Date(Date.now() + 4 * 3600e3).toISOString().slice(0, 10);

const base = {
  aptNumber: null, templateName: 'Studio', checkOutTime: '11:00', guest: 'Marc L.', nextGuest: null,
  checklist: [], photoRequired: [], progress: {}, label: null, othersOnJob: [], openTickets: [],
  state: 'todo', startedAt: null, sameDay: false, nextArrivalDate: null, nextArrivalTime: null,
};
const OXFORD = {
  ...base, jobId: 'job_00000000000000oxf122', listingId: '201', listingName: '122 - Oxford Boulevard',
  unitType: 'Studio', estimatedMinutes: 100, sameDay: true, nextArrivalDate: dubaiToday(), nextArrivalTime: '15:00',
  nextGuest: 'Anna W.',
  openTickets: [
    { id: 91, title: 'Cockroaches · Kitchen', category: 'pest', priority: 'medium' },
    { id: 92, title: 'Leak · Bathroom', category: 'plumbing', priority: 'medium' },
  ],
  rooms: ['Bed', 'Bathroom', 'Kitchen'], heroPhotoUrl: IMG, references: { Bed: IMG, Bathroom: IMG, Kitchen: IMG },
};
const CREEK = {
  ...base, jobId: 'job_0000000000000crk1506', listingId: '202', listingName: '1506 - Emaar Creekside 18A',
  unitType: '2 BHK', templateName: '2 Bedrooms', estimatedMinutes: 150, state: 'running',
  startedAt: '2026-10-02T06:05:00Z',
  othersOnJob: [{ id: 7, name: 'Pionah', startedAt: '2026-10-02T06:05:00Z' }],
  rooms: ['Bedroom 1', 'Bedroom 2', 'Living room', 'Kitchen', 'Bathroom 1', 'Bathroom 2', 'Balcony'],
  heroPhotoUrl: null, references: {},
};
const BLOOM = {
  ...base, jobId: 'job_0000000000000blm1011', listingId: '203', listingName: '1011C - Bloom Towers',
  unitType: 'Studio', estimatedMinutes: 100, rooms: ['Bed', 'Bathroom', 'Kitchen'],
  heroPhotoUrl: IMG, references: { Bed: IMG, Kitchen: IMG },
};
const DAY = {
  status: 'success', date: dubaiToday(), me: { id: 4, name: 'Faiza', role: 'cleaner' }, linenRequired: true,
  totalMinutes: 350, stops: [OXFORD, CREEK, BLOOM],
};
const ROUTES = [{ match: 'action=v3.myDay', status: 200, body: DAY }, ...WRITE_ROUTES.filter((r) => r.match !== 'action=v3.myDay')];
const actionsEcrites = async (page: Page) => (await ecritures(page)).map((l) => (l.url.match(/action=v3\.(\w+)/) || [])[1]);

// Pas de camera dans le navigateur de test : le viseur passe en image fixe et le
// declencheur ouvre l'appareil photo du telephone (champ fichier), le repli reel.
// Le partage natif est simule et note ce qui part.
async function demarrer(page: Page, opts: { hash?: string } = {}) {
  await page.addInitScript(() => {
    if (navigator.mediaDevices) {
      navigator.mediaDevices.getUserMedia = async () => { throw new DOMException('denied', 'NotAllowedError'); };
    }
    (window as any).__shared = [];
    (navigator as any).share = async (d: any) => { (window as any).__shared.push({ text: d.text, files: (d.files || []).length }); };
    (navigator as any).canShare = () => true;
  });
  await bootV3(page, ROUTES, { pinToken: 'jeton-pin', hash: opts.hash });
  await expect(page.locator('.row').first()).toBeVisible();
}

async function photo(page: Page, act = 'shutter') {
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.locator('[data-act="' + act + '"]').click()]);
  await chooser.setFiles({ name: 'p.png', mimeType: 'image/png', buffer: Buffer.from(PNG_1x1, 'base64') });
}

// Une piece : une photo (compteur verifie), puis Next room.
async function piece(page: Page, step: number, nom: string) {
  await expect(page.locator('.vf-top b')).toHaveText(new RegExp('^Step ' + step + ' · ' + nom + ' '));
  await photo(page);
  await expect(page.locator('.vf .count')).toHaveText('1 photo');
  await page.locator('.vf [data-reply="next-room"]').click();
}

async function sansDebordement(page: Page) {
  const { scrollWidth, clientWidth } = await noHorizontalScroll(page);
  expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
  const deborde = await page.evaluate(() => {
    const W = document.documentElement.clientWidth;
    return [...document.querySelectorAll('#view button, #view h1, #view b, #view p, #view textarea')]
      .map((e) => ({ t: (e.textContent || e.tagName).trim().slice(0, 30), r: e.getBoundingClientRect() }))
      .filter((x) => x.r.width > 0 && (x.r.right > W + 0.5 || x.r.left < -0.5)).map((x) => x.t);
  });
  expect(deborde).toEqual([]);
}

async function ecritures(page: Page) {
  return (await fetchLog(page)).filter((l) => l.url.indexOf('hostaway-proxy') !== -1 && l.url.indexOf('action=v3.myDay') === -1);
}

test('la liste du jour vient de v3.myDay : numero et immeuble, statut, aucun nom de voyageur', async ({ page }) => {
  await demarrer(page);
  await expect(page.locator('.list-top b')).toHaveText('Hi Faiza');
  await expect(page.locator('.row-name')).toHaveText(['122 Oxford Boulevard', '1506 Emaar Creekside 18A', '1011C Bloom Towers']);
  await expect(page.locator('.row-sub')).toHaveText(['Guest at 3 PM', 'Started · No guest yet', 'No guest yet']);
  // Avatar sans photo d'annonce : pastille au numero, jamais d'image cassee.
  await expect(page.locator('.row').nth(1).locator('.avatar.ph')).toHaveText('1506');
  const texte = await page.locator('#view').innerText();
  expect(texte).not.toContain('Marc');
  expect(texte).not.toContain('Anna');
  expect(texte).not.toContain('—');
  expect(await ecritures(page)).toEqual([]);
});

test('ouvrir un appartement cree la conversation locale ; Back et le retour systeme ramenent a la liste', async ({ page }) => {
  await demarrer(page);
  await page.getByRole('button', { name: /1011C Bloom Towers/ }).click();
  await expect(page.locator('.top .title b')).toHaveText('1011C Bloom Towers');
  await expect(page.locator('.top .title span')).toHaveText('Step 1 of 5 · Arrival');
  await expect(page.locator('.msg.app').first()).toContainText('1011C Bloom Towers · no guest yet');
  await expect(page.locator('[data-reply="here"]')).toHaveText("I'm here");
  await page.getByRole('button', { name: 'Back' }).click();
  await expect(page.locator('.row')).toHaveCount(3);
  // Retour systeme depuis la conversation : la liste, pas la sortie de l'app.
  await page.getByRole('button', { name: /1011C Bloom Towers/ }).click();
  await expect(page.locator('.top .title b')).toHaveText('1011C Bloom Towers');
  await page.goBack();
  await expect(page.locator('.row')).toHaveCount(3);
  expect(page.url()).toContain('/v3/');
});

test('parcours du studio jusqu au rapport en 28 gestes, ✓✓ une fois la file partie', async ({ page }) => {
  await demarrer(page);
  await page.getByRole('button', { name: /1011C Bloom Towers/ }).click();
  await page.locator('[data-reply="here"]').click();
  // Sans camera : viseur en image fixe, le cercle ouvre l'appareil photo du telephone.
  await expect(page.locator('.vf-msg')).toHaveText('Tap the circle to open your camera');
  await carteAcces(page);
  for (const r of ['Bed', 'Bathroom', 'Kitchen']) await piece(page, 1, r);
  await page.locator('[data-reply="walls-ok"]').click();
  await page.locator('[data-reply="no-damage"]').click();
  await page.locator('[data-reply="send-arrival"]').click();
  await page.locator('[data-reply="linen-yes"]').click();
  for (const r of ['Bed', 'Bathroom', 'Kitchen']) await piece(page, 4, r);
  for (const k of ['gas', 'ac', 'wifi', 'lights', 'windows', 'trash', 'door']) await page.locator('[data-reply="leave:' + k + '"]').click();
  await page.locator('[data-reply="low-done"]').click();
  const rapport = page.locator('.msg.report:not(.arrival)');
  await expect(rapport).toContainText('READY · 1011C Bloom Towers');
  await expect(rapport).toContainText('Studio · Next guest: none booked yet');
  await expect(rapport).toContainText('👤 Faiza');
  await expect(rapport).toContainText('Access card: 📷 1');
  await page.locator('[data-reply="send"]').click();
  await expect(page.locator('.msg.me').last()).toContainText('Report sent to the group');
  const partage = await page.evaluate(() => (window as any).__shared);
  // Arrivee (carte + 3 pieces) partagee avant le menage, puis le rapport final (3 pieces propres).
  expect(partage.length).toBe(2);
  expect(partage[0].text).toContain('*ARRIVAL CHECK · 1011C Bloom Towers*');
  expect(partage[0].files).toBe(4);
  expect(partage[1].text).toContain('*READY · 1011C Bloom Towers*');
  expect(partage[1].files).toBe(3);
  const etat = await page.evaluate(() => {
    const c = (window as any).__hk.convs['job_0000000000000blm1011'];
    return { gestes: c.gestures, envoye: c.sent };
  });
  expect(etat).toEqual({ gestes: 28, envoye: true });
  await fileVide(page);
  await page.getByRole('button', { name: 'Back' }).click();
  await expect(page.locator('.row').nth(2).locator('.row-sub')).toHaveText('Report sent ✓✓');
  expect((await actionsEcrites(page)).filter((a) => a === 'finishJob').length).toBe(1);
});

test('ticket pest : verification du manager, et les autres tickets ouverts en bulle a l etape 2', async ({ page }) => {
  await demarrer(page);
  await page.getByRole('button', { name: /122 Oxford Boulevard/ }).click();
  await expect(page.locator('.msg.app').first()).toContainText('122 Oxford Boulevard · guest at 3 pm');
  await page.locator('[data-reply="here"]').click();
  await carteAcces(page);
  for (const r of ['Bed', 'Bathroom', 'Kitchen']) await piece(page, 1, r);
  // Maintenance phase 3 (C4) : les autres tickets ouverts sont des cartes, sous une seule question.
  await expect(page.getByText('Open problems here. Is it still there?')).toBeVisible();
  await expect(page.locator('.tcard b')).toHaveText(['Leak · Bathroom']);
  await expect(page.getByText('Pest control was asked. Do you see insects?')).toBeVisible();
  await expect(page.locator('[data-reply="check-see"]')).toHaveText('I see insects');
  await page.locator('[data-reply="check-ok"]').click();
  await expect(page.locator('[data-reply="walls-ok"]')).toBeVisible();
  // « No insects » n'ecrit rien : seuls le demarrage et les photos des pieces partent.
  await fileVide(page);
  expect(new Set(await actionsEcrites(page))).toEqual(new Set(['startJob', 'uploadPhoto']));
});

test('binome : Pionah a demarre avant, la cleaner ajoute ses pieces a son rapport', async ({ page }) => {
  await demarrer(page);
  await page.getByRole('button', { name: /1506 Emaar Creekside 18A/ }).click();
  await expect(page.locator('.msg.lead')).toContainText('Pionah started at 10:05. She sends the report.');
  await page.locator('[data-reply="here"]').click();
  await expect(page.locator('.vf-top b')).toHaveText(/^Step 4 · Bedroom 1 /);
  await expect(page.locator('[data-reply="send"]')).toHaveCount(0);
});

test('Profile s ouvre depuis l en-tete de la liste, Today y ramene', async ({ page }) => {
  await demarrer(page);
  await page.getByRole('link', { name: 'Profile' }).click();
  await expect(page.getByRole('heading', { name: 'Faiza' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();
  await page.getByRole('link', { name: 'Today' }).click();
  await expect(page.locator('.row')).toHaveCount(3);
});

test('une journee vide le dit clairement', async ({ page }) => {
  await bootV3(page, [{ match: 'action=v3.myDay', status: 200, body: { ...DAY, stops: [] } }], { pinToken: 'jeton-pin' });
  await expect(page.getByText('Nothing assigned to you today.')).toBeVisible();
  await expect(page.locator('.row')).toHaveCount(0);
});

for (const largeur of [360, 390, 430]) {
  test('aucun debordement a ' + largeur + ' px : liste, conversation, viseur, signalement, sortie, rapport', async ({ page }) => {
    await page.setViewportSize({ width: largeur, height: largeur === 360 ? 740 : 844 });
    await demarrer(page);
    const shot = async (nom: string) => {
      await sansDebordement(page);
      await page.screenshot({ path: 'test-results/v3-conv/' + largeur + '-' + nom + '.png' });
    };
    await shot('01-liste');
    await page.getByRole('button', { name: /122 Oxford Boulevard/ }).click();
    await shot('02-arrivee');
    await page.locator('[data-reply="here"]').click();
    await expect(page.locator('.vf')).toBeVisible();
    await expect(page.locator('.vf-top b')).toHaveText('Step 1 · Access card & keys · as you find them');
    await shot('03a-carte');
    await carteAcces(page);
    await photo(page);
    await expect(page.locator('.vf .count')).toHaveText('1 photo');
    await shot('03-viseur');
    await page.locator('.vf [data-act="problem"]').click();
    await expect(page.locator('.kinds-page')).toBeVisible();
    await shot('04-tuiles');
    await page.locator('[data-kind="Leak"]').click();
    await page.locator('[data-flow="no-photo"]').click();
    await expect(page.locator('#problem-note')).toBeVisible();
    await shot('05-note');
    await page.locator('#problem-note').fill('under the sink');
    await page.locator('[data-flow="save-text"]').click();
    await page.locator('.vf [data-reply="next-room"]').click();
    await piece(page, 1, 'Bathroom');
    await piece(page, 1, 'Kitchen');
    await page.locator('[data-reply="check-ok"]').click();
    await page.locator('[data-reply="walls-ok"]').click();
    await page.locator('[data-reply="no-damage"]').click();
    await page.locator('[data-reply="send-arrival"]').click();
    await page.locator('[data-reply="linen-change"]').click();
    await shot('06-linge');
    await page.locator('[data-reply="linen-ok"]').click();
    for (const r of ['Bed', 'Bathroom', 'Kitchen']) await piece(page, 4, r);
    await shot('07-sortie');
    for (const k of ['gas', 'ac', 'wifi', 'lights', 'windows', 'trash', 'door']) await page.locator('[data-reply="leave:' + k + '"]').click();
    await page.locator('[data-reply="low-done"]').click();
    await expect(page.locator('.msg.report:not(.arrival)')).toContainText('Leak: under the sink');
    await shot('08-rapport');
  });
}
