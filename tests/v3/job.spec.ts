import { expect, test } from '@playwright/test';
import { bootV3, fetchLog, noHorizontalScroll } from './helpers';

const STOP = {
  jobId: '2026-09-12_Marc Lefevre', listingId: '102', listingName: '623 Samana Park View',
  aptNumber: '623', unitType: '1 BHK', templateName: '1 Bedroom',
  checkOutTime: '12:00', nextArrivalDate: '2026-09-12', nextArrivalTime: '15:00',
  sameDay: true, guest: 'Marc L.', nextGuest: 'Anna W.', estimatedMinutes: 118,
  state: 'running', startedAt: new Date(Date.now() - 12 * 60000).toISOString(),
  checklist: ['Master Bed & Linens', 'Bathroom', 'Final Check'],
  photoRequired: ['Final Check'], progress: {},
  openTickets: [{ id: 71, title: 'Photo of the DEWA bill', category: 'general', priority: 'urgent' }],
  label: null,
};

const JOURNEE = {
  status: 'success', date: '2026-09-12', me: { id: 3, name: 'Faiza', role: 'cleaner' },
  linenRequired: true, totalMinutes: 118, stops: [STOP],
};

const ROUTES = [
  { match: 'action=v3.myDay', status: 200, body: JOURNEE },
  { match: 'action=v3.tick', status: 200, body: { status: 'success' } },
  { match: 'action=v3.uploadPhoto', status: 200, body: { status: 'success', photoId: 55, path: 'v3/2026-09-12/abc.jpg' } },
  { match: 'action=v3.checkTicket', status: 200, body: { status: 'success', ticketId: 71, status_value: 'to_confirm' } },
  { match: 'action=v3.finishJob', status: 200, body: { status: 'success', jobId: STOP.jobId, durationMinutes: 92, unchecked: 0 } },
];

async function ouvrirJob(page: any) {
  await bootV3(page, ROUTES, { pinToken: 'jeton-pin', hash: '#/job/' + encodeURIComponent(STOP.jobId) });
}

test('le Job montre l heure limite, l acces et le template du vrai type', async ({ page }) => {
  await ouvrirJob(page);
  await expect(page.getByRole('heading', { name: '623 Samana Park View' })).toBeVisible();
  await expect(page.locator('.deadline')).toContainText('Guest arrives at 15:00');
  await expect(page.locator('.facts')).toContainText('12:00');
  await expect(page.getByText('Checklist, 1 Bedroom')).toBeVisible();
  await expect(page.locator('#c-list .crow')).toHaveCount(3);
  await expect(page.locator('.checkhead .pr').first()).toHaveText('0/3');
});

test('la ligne entiere coche, et l etat part au proxy avec sa cle', async ({ page }) => {
  await ouvrirJob(page);
  const ligne = page.getByRole('button', { name: 'Bathroom' });
  await ligne.click();
  await expect(ligne).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.checkhead .pr').first()).toHaveText('1/3');
  const ticks = (await fetchLog(page)).filter((l) => l.url.indexOf('action=v3.tick') !== -1);
  expect(ticks.length).toBe(1);
  const corps = JSON.parse(ticks[0].body);
  expect(corps).toMatchObject({ jobId: STOP.jobId, itemId: 'Bathroom', checked: true });
  expect(String(corps.idem).length >= 8).toBe(true);
});

test('les tickets ouverts du logement sont proposes a la verification, photo obligatoire', async ({ page }) => {
  await ouvrirJob(page);
  await expect(page.getByText('Check while you are here')).toBeVisible();
  const ticket = page.getByRole('button', { name: 'Photo of the DEWA bill' });
  await expect(ticket).toBeVisible();
  await ticket.click();
  // Sans photo, rien ne part : la ligne demande l'appareil photo.
  await expect(page.getByText('Take a photo first')).toBeVisible();
  expect((await fetchLog(page)).filter((l) => l.url.indexOf('v3.checkTicket') !== -1).length).toBe(0);
});

// Meme regle que le Start de Today (revue tache 10, constat 2) : un refus dur du
// proxy n'est pas une coupure reseau, rien n'est mis en file, donc la case doit
// revenir a son etat d'origine plutot que mentir a la cleaner.
test('un cochage refuse par le proxy revient en arriere', async ({ page }) => {
  await bootV3(page, [
    { match: 'action=v3.myDay', status: 200, body: JOURNEE },
    { match: 'action=v3.tick', status: 400, body: { error: 'itemId required' } },
  ], { pinToken: 'jeton-pin', hash: '#/job/' + encodeURIComponent(STOP.jobId) });
  const ligne = page.getByRole('button', { name: 'Bathroom' });
  await ligne.click();
  await expect(page.getByText('itemId required')).toBeVisible();
  await expect(ligne).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('.checkhead .pr').first()).toHaveText('0/3');
  await expect(page.getByRole('button', { name: 'Finish 0/3' })).toBeVisible();
});

test('Finish incomplet demande une confirmation chiffree', async ({ page }) => {
  await ouvrirJob(page);
  await page.getByRole('button', { name: 'Bathroom' }).click();
  await page.getByRole('button', { name: 'Finish 1/3' }).click();
  await expect(page.getByText('2 items not ticked')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Finish anyway' })).toBeVisible();
});

test('Finish complet compte le linge puis envoie finishJob', async ({ page }) => {
  await ouvrirJob(page);
  for (const item of ['Master Bed & Linens', 'Bathroom', 'Final Check']) {
    await page.getByRole('button', { name: item }).click();
  }
  await page.getByRole('button', { name: 'Finish', exact: true }).click();
  await expect(page.getByText('Linen going out')).toBeVisible();
  // Deux draps et un tapis de bain, le reste a zero.
  await page.locator('[data-act="linen-plus"][data-field="bed_sheets"]').click();
  await page.locator('[data-act="linen-plus"][data-field="bed_sheets"]').click();
  await page.locator('[data-act="linen-plus"][data-field="bath_mats"]').click();
  await page.getByRole('button', { name: 'Finish this cleaning' }).click();

  await expect(page.getByRole('heading', { name: 'Cleaning finished' })).toBeVisible();
  await expect(page.getByText('The median for a 1 BHK is 118 min.')).toBeVisible();
  const fin = (await fetchLog(page)).filter((l) => l.url.indexOf('action=v3.finishJob') !== -1);
  expect(fin.length).toBe(1);
  const corps = JSON.parse(fin[0].body);
  expect(corps.jobId).toBe(STOP.jobId);
  expect(corps.linen.bed_sheets).toBe(2);
  expect(corps.linen.bath_mats).toBe(1);
  expect(corps.linen.pillowcases).toBe(0);
  expect(corps.checklist['Bathroom']).toBe(true);
});

test('un sous-traitant ne voit jamais le comptage du linge', async ({ page }) => {
  await bootV3(page, [
    { match: 'action=v3.myDay', status: 200, body: { ...JOURNEE, linenRequired: false, me: { id: 9, name: 'Elite Cleaning', role: 'subcontractor' } } },
    ...ROUTES.slice(1),
  ], { pinToken: 'jeton-pin', hash: '#/job/' + encodeURIComponent(STOP.jobId) });
  for (const item of ['Master Bed & Linens', 'Bathroom', 'Final Check']) {
    await page.getByRole('button', { name: item }).click();
  }
  await page.getByRole('button', { name: 'Finish', exact: true }).click();
  await expect(page.getByText('Linen going out')).toHaveCount(0);
  await page.getByRole('button', { name: 'Finish this cleaning' }).click();
  const corps = JSON.parse((await fetchLog(page)).filter((l) => l.url.indexOf('v3.finishJob') !== -1)[0].body);
  expect(corps.linen).toBeUndefined();
});

test('le Job ne deborde pas a 390 px et ses lignes font 60 px', async ({ page }) => {
  await ouvrirJob(page);
  const { scrollWidth, clientWidth } = await noHorizontalScroll(page);
  expect(scrollWidth).toBe(clientWidth);
  for (const l of await page.locator('#c-list .crow').all()) {
    const b = await l.boundingBox();
    expect(b!.height).toBeGreaterThanOrEqual(60);
  }
});

// Cas ajoute : le chemin photo de bout en bout. La photo est la condition de la
// verification d'un ticket (ruling 3), c'est donc le seul chemin qui prouve que
// l'appareil photo, le redimensionnement et le rattachement fonctionnent.
const PNG_1x1 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

test('avec une photo, le ticket part a la verification avec l identifiant de la photo', async ({ page }) => {
  await ouvrirJob(page);
  const chooser = page.waitForEvent('filechooser');
  await page.locator('[data-act="shoot-ticket"][data-ticket="71"]').click();
  await (await chooser).setFiles({ name: 'dewa.png', mimeType: 'image/png', buffer: Buffer.from(PNG_1x1, 'base64') });
  await expect(page.locator('[data-act="shoot-ticket"][data-ticket="71"]')).toHaveClass(/done/);

  const envois = (await fetchLog(page)).filter((l) => l.url.indexOf('action=v3.uploadPhoto') !== -1);
  expect(envois.length).toBe(1);

  await page.getByRole('button', { name: 'Photo of the DEWA bill' }).click();
  await expect(page.getByText('Sent for confirmation')).toBeVisible();
  const checks = (await fetchLog(page)).filter((l) => l.url.indexOf('action=v3.checkTicket') !== -1);
  expect(checks.length).toBe(1);
  const corps = JSON.parse(checks[0].body);
  expect(corps).toMatchObject({ ticketId: 71, jobId: STOP.jobId, photoId: 55 });
});

// Le reseau est coupe par le drapeau localStorage et non par context.setOffline :
// sous l'emulation hors ligne de Playwright, toute lecture d'octets d'un Blob ou
// d'un File echoue en NotReadableError, donc la photo ne peut meme pas etre lue
// avant sa mise en file. C'est un artefact du harnais, pas du telephone.
test('hors ligne, la photo est gardee sur le telephone et le ticket part avec sa cle', async ({ page }) => {
  await ouvrirJob(page);
  await page.evaluate(() => localStorage.setItem('v3TestOffline', '1'));
  const chooser = page.waitForEvent('filechooser');
  await page.locator('[data-act="shoot-ticket"][data-ticket="71"]').click();
  await (await chooser).setFiles({ name: 'dewa.png', mimeType: 'image/png', buffer: Buffer.from(PNG_1x1, 'base64') });
  await expect(page.getByText('Photo saved on your phone')).toBeVisible();

  // Sans identifiant serveur, la verification part quand meme, rattachee par la
  // cle d'idempotence de la photo.
  await page.getByRole('button', { name: 'Photo of the DEWA bill' }).click();
  await expect(page.getByText('Saved on device, 2 to sync')).toBeVisible();
  const corps = JSON.parse((await fetchLog(page))
    .filter((l) => l.url.indexOf('action=v3.checkTicket') !== -1)[0].body);
  expect(corps.photoId).toBeUndefined();
  expect(String(corps.photoIdem).length >= 8).toBe(true);

  // Retour du reseau : les octets de la photo ont survecu a la file.
  await page.evaluate(() => {
    localStorage.removeItem('v3TestOffline');
    window.dispatchEvent(new Event('online'));
  });
  await expect(page.getByText('Saved on device', { exact: false })).toHaveCount(0, { timeout: 10_000 });
  const envois = (await fetchLog(page)).filter((l) => l.url.indexOf('action=v3.uploadPhoto') !== -1);
  expect(envois.length).toBe(2);
});
