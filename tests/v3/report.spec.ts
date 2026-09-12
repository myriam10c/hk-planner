import { expect, test } from '@playwright/test';
import { bootV3, fetchLog, noHorizontalScroll } from './helpers';

// jobId opaque (`job_<20 hex>`) et non la forme historique
// `2026-09-12_<nom du guest>` : aucun nom de guest ne doit atteindre le DOM, un
// attribut ni l'adresse (ruling 9). C'est la forme que le proxy rend depuis le
// correctif de la revue de la tache 3.
const JOB_ID = 'job_3f2a9c81d47b60e5a2f9';

const STOP = {
  jobId: JOB_ID, listingId: '102', listingName: '623 Samana Park View',
  aptNumber: '623', unitType: '1 BHK', templateName: '1 Bedroom',
  checkOutTime: '12:00', nextArrivalDate: '2026-09-12', nextArrivalTime: '15:00',
  sameDay: true, guest: 'Marc L.', nextGuest: 'Anna W.', estimatedMinutes: 118,
  state: 'running', startedAt: new Date(Date.now() - 60000).toISOString(),
  checklist: ['Bathroom'], photoRequired: [], progress: {}, openTickets: [], label: null,
};

const JOURNEE = {
  status: 'success', date: '2026-09-12', me: { id: 3, name: 'Faiza', role: 'cleaner' },
  linenRequired: true, totalMinutes: 118, stops: [STOP],
};

const ROUTES = [
  { match: 'action=v3.myDay', status: 200, body: JOURNEE },
  { match: 'action=v3.uploadPhoto', status: 200, body: { status: 'success', photoId: 55, path: 'v3/2026-09-12/abc.jpg' } },
  { match: 'action=v3.reportProblem', status: 200, body: { status: 'success', ticketId: 900, technicianId: 5 } },
  { match: 'action=cleanerLogout', status: 200, body: { status: 'success' } },
];

const HASH_JOB = '#/job/' + encodeURIComponent(JOB_ID);

// Un vrai PNG de 1x1 : le redimensionnement canvas s'execute pour de bon, comme
// avec une photo d'appareil, au lieu de tomber sur le repli d'image illisible.
const PNG_1x1 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

// La prise de photo passe par un <input type="file"> que le code ouvre lui-meme :
// on attend donc le selecteur de fichier de Playwright et on lui donne l'image,
// exactement comme l'appareil photo du telephone remplirait le champ.
async function prendreLaPhoto(page: any, declencher: () => Promise<void>) {
  const [selecteur] = await Promise.all([page.waitForEvent('filechooser'), declencher()]);
  await selecteur.setFiles({
    name: 'photo.png', mimeType: 'image/png', buffer: Buffer.from(PNG_1x1, 'base64'),
  });
}

test('la feuille de signalement demande categorie puis photo, et rien ne part sans les deux', async ({ page }) => {
  await bootV3(page, ROUTES, { pinToken: 'jeton-pin', hash: HASH_JOB });
  await page.getByRole('button', { name: 'Report a problem' }).click();
  await expect(page.getByRole('heading', { name: 'Report a problem' })).toBeVisible();
  for (const c of ['AC', 'Plumbing', 'Electrical', 'Appliance', 'Pest', 'Other']) {
    await expect(page.getByRole('button', { name: c, exact: true })).toBeVisible();
  }
  const envoyer = page.getByRole('button', { name: 'Send to the technician on duty' });
  await expect(envoyer).toBeDisabled();
  await page.getByRole('button', { name: 'AC', exact: true }).click();
  await expect(page.getByRole('button', { name: 'AC', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(envoyer).toBeDisabled();
  expect((await fetchLog(page)).filter((l) => l.url.indexOf('v3.reportProblem') !== -1).length).toBe(0);
});

test('categorie plus photo envoie le signalement avec le logement et le menage', async ({ page }) => {
  await bootV3(page, ROUTES, { pinToken: 'jeton-pin', hash: HASH_JOB });
  await page.getByRole('button', { name: 'Report a problem' }).click();
  await page.getByRole('button', { name: 'AC', exact: true }).click();
  await prendreLaPhoto(page, () => page.getByRole('button', { name: 'Take a photo' }).click());
  await expect(page.getByText('Photo taken')).toBeVisible();
  const envoyer = page.getByRole('button', { name: 'Send to the technician on duty' });
  await expect(envoyer).toBeEnabled();
  await envoyer.click();

  const log = await fetchLog(page);
  const televersement = log.filter((l) => l.url.indexOf('v3.uploadPhoto') !== -1);
  expect(televersement.length).toBe(1);
  const envois = log.filter((l) => l.url.indexOf('v3.reportProblem') !== -1);
  expect(envois.length).toBe(1);
  const corps = JSON.parse(envois[0].body);
  expect(corps).toMatchObject({ jobId: JOB_ID, listingId: '102', category: 'ac', photoId: 55 });
  expect(String(corps.idem).length >= 8).toBe(true);
  await expect(page.getByText('Sent. The technician on duty is notified.')).toBeVisible();
  // La feuille se referme : la cleaner revient a sa checklist.
  await expect(page.getByRole('heading', { name: 'Report a problem' })).toHaveCount(0);
});

// Le reseau est coupe par le drapeau localStorage et non par context.setOffline :
// sous l'emulation hors ligne de Playwright, toute lecture d'octets d'un Blob
// echoue en NotReadableError, donc la photo n'est meme pas lisible avant sa mise
// en file (revue tache 11, constat 2). Artefact du harnais, pas du telephone.
test('hors ligne, le signalement part dans la file avec la cle de sa photo', async ({ page }) => {
  await bootV3(page, ROUTES, { pinToken: 'jeton-pin', hash: HASH_JOB });
  await page.getByRole('button', { name: 'Report a problem' }).click();
  await page.getByRole('button', { name: 'Pest', exact: true }).click();
  await page.evaluate(() => localStorage.setItem('v3TestOffline', '1'));
  await prendreLaPhoto(page, () => page.getByRole('button', { name: 'Take a photo' }).click());
  await expect(page.getByText('Photo taken')).toBeVisible();
  await page.getByRole('button', { name: 'Send to the technician on duty' }).click();
  await expect(page.getByText('Saved on device, 2 to sync')).toBeVisible();

  await page.evaluate(() => {
    localStorage.removeItem('v3TestOffline');
    window.dispatchEvent(new Event('online'));
  });
  await expect(page.getByText('Saved on device', { exact: false })).toHaveCount(0, { timeout: 10_000 });
  const log = await fetchLog(page);
  const envois = log.filter((l) => l.url.indexOf('v3.reportProblem') !== -1);
  const dernier = JSON.parse(envois[envois.length - 1].body);
  // La photo est designee par la cle de son televersement : le rejeu passe la
  // photo d'abord, le signalement ensuite, et le proxy fait le lien.
  expect(dernier.photoIdem).toBeTruthy();
  expect(dernier.photoId).toBeUndefined();
  expect(JSON.parse(envois[envois.length - 1].body).category).toBe('pest');
});

// Meme regle que le Start de Today et le cochage du Job (revue tache 10,
// constat 2) : un refus dur du proxy ne met rien en file, donc la feuille doit
// rester ouverte et le bouton redevenir utilisable, sinon le signalement est
// perdu sans aucun moyen de le refaire.
test('un signalement refuse laisse la feuille ouverte et le bouton reutilisable', async ({ page }) => {
  await bootV3(page, [
    { match: 'action=v3.myDay', status: 200, body: JOURNEE },
    { match: 'action=v3.uploadPhoto', status: 200, body: { status: 'success', photoId: 55 } },
    { match: 'action=v3.reportProblem', status: 400, body: { error: 'unknown category' } },
  ], { pinToken: 'jeton-pin', hash: HASH_JOB });
  await page.getByRole('button', { name: 'Report a problem' }).click();
  await page.getByRole('button', { name: 'Other', exact: true }).click();
  await prendreLaPhoto(page, () => page.getByRole('button', { name: 'Take a photo' }).click());
  const envoyer = page.getByRole('button', { name: 'Send to the technician on duty' });
  await envoyer.click();
  await expect(page.getByText('unknown category')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Report a problem' })).toBeVisible();
  await expect(envoyer).toBeEnabled();
  // Rien n'est garde : la cleaner peut renvoyer, et un second appui repart.
  await envoyer.click();
  expect((await fetchLog(page)).filter((l) => l.url.indexOf('v3.reportProblem') !== -1).length).toBe(2);
});

test('Profile renvoie vers l app actuelle et permet de se deconnecter', async ({ page }) => {
  await bootV3(page, ROUTES, { pinToken: 'jeton-pin', hash: '#/profile' });
  await expect(page.getByRole('heading', { name: 'Faiza' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Open HK Planner' })).toHaveAttribute('href', '/#cleaner');
  // Aucune action refusee dans ce parcours : le bloc « Not sent » reste absent.
  await expect(page.getByText('Not sent')).toHaveCount(0);
  const { scrollWidth, clientWidth } = await noHorizontalScroll(page);
  expect(scrollWidth).toBe(clientWidth);
  await Promise.all([
    page.waitForURL(/#cleaner$/),
    page.getByRole('button', { name: 'Sign out' }).click(),
  ]);
  // Le journal est garde dans localStorage : il survit a la navigation vers
  // l'app actuelle, contrairement a une variable de page.
  expect(await page.evaluate(() => localStorage.getItem('cleanerToken'))).toBeNull();
  expect((await fetchLog(page)).some((l) => l.url.indexOf('action=cleanerLogout') !== -1)).toBe(true);
});

// Le magasin mort n'existe que si quelqu'un le lit : c'est la raison d'etre du
// bloc « Not sent » de Profile. Le critere de la phase A est « zero action
// perdue », pas « zero action refusee ».
test('Profile montre les actions refusees par le proxy et sait vider la liste', async ({ page }) => {
  await bootV3(page, [
    { match: 'action=v3.myDay', status: 200, body: JOURNEE },
    { match: 'action=v3.uploadPhoto', status: 200, body: { status: 'success', photoId: 55 } },
    { match: 'action=v3.reportProblem', status: 400, body: { error: 'unknown category' } },
  ], { pinToken: 'jeton-pin', hash: HASH_JOB });
  await page.getByRole('button', { name: 'Report a problem' }).click();
  await page.getByRole('button', { name: 'Other', exact: true }).click();
  await page.evaluate(() => localStorage.setItem('v3TestOffline', '1'));
  await prendreLaPhoto(page, () => page.getByRole('button', { name: 'Take a photo' }).click());
  await page.getByRole('button', { name: 'Send to the technician on duty' }).click();
  await expect(page.getByText('Saved on device, 2 to sync')).toBeVisible();

  await page.evaluate(() => {
    localStorage.removeItem('v3TestOffline');
    window.dispatchEvent(new Event('online'));
  });
  await expect(page.getByText('Not sent: unknown category. Tell your manager.')).toBeVisible({ timeout: 10_000 });

  // L'ecran Job n'a pas de barre du bas : on repasse par la journee, comme la
  // cleaner le ferait.
  await page.getByRole('button', { name: 'Back' }).click();
  await page.getByRole('link', { name: 'Profile' }).click();
  await expect(page.getByText('Not sent', { exact: true })).toBeVisible();
  await expect(page.getByText('reportProblem')).toBeVisible();
  await page.getByRole('button', { name: 'Clear this list' }).click();
  await expect(page.getByText('Not sent', { exact: true })).toHaveCount(0);
});
