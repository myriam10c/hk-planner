import { expect, test } from '@playwright/test';
import { bootV3, fetchLog, noHorizontalScroll } from './helpers';

const JOURNEE = {
  status: 'success',
  date: '2026-09-12',
  me: { id: 3, name: 'Faiza', role: 'cleaner' },
  linenRequired: true,
  totalMinutes: 306,
  stops: [
    {
      jobId: '2026-09-12_Marc Lefevre', listingId: '102', listingName: '623 Samana Park View',
      aptNumber: '623', unitType: '1 BHK', templateName: '1 Bedroom',
      checkOutTime: '12:00', nextArrivalDate: '2026-09-12', nextArrivalTime: '15:00',
      sameDay: true, guest: 'Marc L.', nextGuest: 'Anna W.', estimatedMinutes: 118,
      state: 'todo', startedAt: null,
      checklist: ['Master Bed & Linens', 'Bathroom', 'Final Check'],
      photoRequired: [], progress: {},
      openTickets: [{ id: 71, title: 'Photo of the DEWA bill', category: 'general', priority: 'urgent' }],
      label: null,
    },
    {
      jobId: '2026-09-12_Yuki Tanaka', listingId: '103', listingName: '122 Oxford Boulevard',
      aptNumber: '122', unitType: 'Studio', templateName: 'Studio',
      checkOutTime: '10:00', nextArrivalDate: '2026-09-13', nextArrivalTime: '14:00',
      sameDay: false, guest: 'Yuki T.', nextGuest: 'Omar S.', estimatedMinutes: 94,
      state: 'todo', startedAt: null,
      checklist: ['Living Room', 'Bathroom'], photoRequired: [], progress: {},
      openTickets: [], label: null,
    },
    {
      jobId: '2026-09-12_Sofia Marchetti', listingId: '101', listingName: '704 Golf Links',
      aptNumber: '704', unitType: 'Studio', templateName: 'Studio',
      checkOutTime: '11:00', nextArrivalDate: null, nextArrivalTime: null,
      sameDay: false, guest: 'Sofia M.', nextGuest: null, estimatedMinutes: 94,
      state: 'done', startedAt: '2026-09-12T05:00:00Z',
      checklist: ['Living Room', 'Bathroom'], photoRequired: [], progress: {},
      openTickets: [], label: null,
    },
  ],
};

const ROUTES = [
  { match: 'action=v3.myDay', status: 200, body: JOURNEE },
  { match: 'action=v3.startJob', status: 200, body: { status: 'success', jobId: '2026-09-12_Marc Lefevre', startedAt: '2026-09-12T08:00:00Z' } },
];

test('Today montre les chiffres de la personne, pas ceux de l equipe', async ({ page }) => {
  await bootV3(page, ROUTES, { pinToken: 'jeton-pin' });
  await expect(page.getByText('Faiza')).toBeVisible();
  await expect(page.getByText('stops today, about 5h06')).toBeVisible();
  await expect(page.locator('.dr-count b')).toHaveText('3');
  await expect(page.getByText('ALL')).toHaveCount(0);
});

test('le prochain arret est le same-day, en carte pleine avec son heure limite', async ({ page }) => {
  await bootV3(page, ROUTES, { pinToken: 'jeton-pin' });
  await expect(page.locator('.nextup .n')).toHaveText('623 Samana Park View');
  await expect(page.locator('.nextup .m')).toContainText('1 BHK');
  await expect(page.locator('.nextup .dl')).toContainText('Guest arrives 15:00');
  const lignes = page.locator('.stop');
  await expect(lignes).toHaveCount(2);
  await expect(lignes.nth(0)).toContainText('122 Oxford Boulevard');
  await expect(lignes.nth(1)).toContainText('704 Golf Links');
});

test('aucun nom de guest complet n apparait a l ecran', async ({ page }) => {
  await bootV3(page, ROUTES, { pinToken: 'jeton-pin' });
  const texte = await page.locator('body').innerText();
  expect(texte).not.toContain('Lefevre');
  expect(texte).not.toContain('Marchetti');
  expect(texte).not.toContain('Tanaka');
});

test('Start ouvre le menage et envoie startJob avec une cle d idempotence', async ({ page }) => {
  await bootV3(page, ROUTES, { pinToken: 'jeton-pin' });
  await page.getByRole('button', { name: 'Start this cleaning' }).click();
  await expect(page).toHaveURL(/#\/job\//);
  const log = await fetchLog(page);
  const start = log.filter((l) => l.url.indexOf('action=v3.startJob') !== -1);
  expect(start.length).toBe(1);
  const corps = JSON.parse(start[0].body);
  expect(corps.jobId).toBe('2026-09-12_Marc Lefevre');
  expect(String(corps.idem).length >= 8).toBe(true);
  expect(start[0].headers['X-Cleaner-Token']).toBe('jeton-pin');
});

test('un menage fini est marque, pas propose au demarrage', async ({ page }) => {
  await bootV3(page, ROUTES, { pinToken: 'jeton-pin' });
  const fini = page.locator('.stop').nth(1);
  await expect(fini).toContainText('Done');
});

test('Today ne deborde pas a 390 px, et ses cibles font au moins 44 px', async ({ page }) => {
  await bootV3(page, ROUTES, { pinToken: 'jeton-pin' });
  const { scrollWidth, clientWidth } = await noHorizontalScroll(page);
  expect(scrollWidth).toBe(clientWidth);
  const start = page.getByRole('button', { name: 'Start this cleaning' });
  const boite = await start.boundingBox();
  expect(boite!.height).toBeGreaterThanOrEqual(58);
  for (const l of await page.locator('.stop').all()) {
    const b = await l.boundingBox();
    expect(b!.height).toBeGreaterThanOrEqual(44);
  }
});

test('une journee vide le dit clairement', async ({ page }) => {
  await bootV3(page, [
    { match: 'action=v3.myDay', status: 200, body: { ...JOURNEE, stops: [], totalMinutes: 0 } },
  ], { pinToken: 'jeton-pin' });
  await expect(page.getByText('Nothing assigned to you today.')).toBeVisible();
});

// Constat 2 de la revue : sans retour arriere, l'arret restait « running » apres
// un refus du serveur, le bouton passait a « Continue this cleaning », et le
// second appui sautait la garde `todo` sans jamais retenter v3.startJob.
test('un Start refuse par le serveur revient en arriere et se retente', async ({ page }) => {
  await bootV3(page, [
    { match: 'action=v3.myDay', status: 200, body: JOURNEE },
    { match: 'action=v3.startJob', status: 500, body: { error: 'timer write failed' } },
  ], { pinToken: 'jeton-pin' });
  const start = page.getByRole('button', { name: 'Start this cleaning' });
  await start.click();
  await expect(page.getByText('timer write failed')).toBeVisible();
  await expect(page).not.toHaveURL(/#\/job\//);
  await expect(start).toBeVisible();
  const arret = await page.evaluate(async () => {
    const m = await import('/v3/app.js');
    const s = (m as any).state.day.stops[0];
    return { state: s.state, startedAt: s.startedAt };
  });
  expect(arret.state).toBe('todo');
  expect(arret.startedAt).toBe(null);

  // Second appui : la garde `todo` laisse passer, l'appel repart vraiment.
  await start.click();
  // Un second toast d'erreur : la preuve que l'appel est reparti et a echoue
  // de nouveau, plutot que d'etre saute par la garde `todo`.
  await expect(page.locator('.toast.err')).toHaveCount(2);
  const log = await fetchLog(page);
  expect(log.filter((l) => l.url.indexOf('action=v3.startJob') !== -1).length).toBe(2);
});

// Constat 3 de la revue : une reponse tronquee ecrivait « undefined NaN
// undefined » a la place de la date, au lieu de degrader comme le fait la garde
// sur `me`.
const DATES_CASSEES: Array<[string, string | null]> = [['absente', null], ['illisible', '12/09/2026']];
for (const [nom, date] of DATES_CASSEES) {
  test('une date ' + nom + ' ne salit pas l en-tete', async ({ page }) => {
    const jour: any = { ...JOURNEE };
    if (date === null) delete jour.date;
    else jour.date = date;
    await bootV3(page, [
      { match: 'action=v3.myDay', status: 200, body: jour },
    ], { pinToken: 'jeton-pin' });
    await expect(page.locator('.dr-top .date')).toHaveText('');
    // Le reste de la journee reste utilisable : c'est le point de la degradation.
    await expect(page.locator('.nextup .n')).toHaveText('623 Samana Park View');
    await expect(page.getByRole('button', { name: 'Start this cleaning' })).toBeVisible();
    const texte = await page.locator('body').innerText();
    expect(texte).not.toContain('undefined');
    expect(texte).not.toContain('NaN');
  });
}

// Le proxy ne rend plus la cle de reservation : depuis le correctif de la revue
// de la tache 3, `jobId` est un identifiant oppose « job_<20 hex> », sans aucune
// donnee guest. Les six cas ci-dessus gardent le libelle historique du brief ;
// celui-ci verifie la forme reellement servie, y compris dans l'adresse.
const JOB_OPAQUE = 'job_3f2a9c81d47b60e5a2f9';
const JOURNEE_OPAQUE = {
  ...JOURNEE,
  totalMinutes: 118,
  stops: [{ ...JOURNEE.stops[0], jobId: JOB_OPAQUE }],
};

test('l identifiant oppose du serveur traverse l ecran et l adresse', async ({ page }) => {
  await bootV3(page, [
    { match: 'action=v3.myDay', status: 200, body: JOURNEE_OPAQUE },
    { match: 'action=v3.startJob', status: 200, body: { status: 'success', jobId: JOB_OPAQUE, startedAt: '2026-09-12T08:00:00Z' } },
  ], { pinToken: 'jeton-pin' });
  await page.getByRole('button', { name: 'Start this cleaning' }).click();
  await expect(page).toHaveURL(new RegExp('#/job/' + JOB_OPAQUE + '$'));
  const log = await fetchLog(page);
  const start = log.filter((l) => l.url.indexOf('action=v3.startJob') !== -1);
  expect(JSON.parse(start[0].body).jobId).toBe(JOB_OPAQUE);
});
