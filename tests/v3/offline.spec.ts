import { expect, test } from '@playwright/test';
import { bootV3, fetchLog } from './helpers';
import { BLOOM, carteAcces, demarrer, ecritures, fileVide, fileVideApresRetour, photo, piece } from './conv-helpers';

// File hors ligne de la v3. Les premiers tests passent par sendOrQueue (chemin
// direct, garde pour les actions hors conversation) et lisent le bandeau « Saved
// on device » sur la liste du jour. Les derniers (tache 5 du branchement) passent
// par l'interface : reseau coupe au milieu d'un signalement, rechargement au
// milieu de l'etape 4.
async function geste(page: any, itemId: string) {
  return await page.evaluate(async (item: string) => {
    const m = await import('/v3/offline.js');
    return await m.sendOrQueue('v3.tick', { jobId: 'job_aaaaaaaaaaaaaaaaaaaa', itemId: item, checked: true, idem: m.newIdem() });
  }, itemId);
}

const JOURNEE = {
  status: 'success',
  date: '2026-09-12',
  me: { id: 3, name: 'Faiza', role: 'cleaner' },
  linenRequired: true,
  totalMinutes: 306,
  stops: [
    {
      jobId: 'job_aaaaaaaaaaaaaaaaaaaa', listingId: '102', listingName: '623 Samana Park View',
      aptNumber: '623', unitType: '1 BHK', templateName: '1 Bedroom',
      checkOutTime: '12:00', nextArrivalDate: '2026-09-12', nextArrivalTime: '15:00',
      sameDay: true, guest: 'Marc L.', nextGuest: 'Anna W.', estimatedMinutes: 118,
      state: 'todo', startedAt: null,
      checklist: ['Master Bed & Linens', 'Bathroom', 'Final Check'],
      photoRequired: [], progress: {}, openTickets: [], label: null,
      rooms: ['Bedroom', 'Living room', 'Kitchen', 'Bathroom', 'Balcony'], heroPhotoUrl: null,
      othersOnJob: [], references: {},
    },
  ],
};

const ROUTES = [
  { match: 'action=v3.myDay', status: 200, body: JOURNEE },
  { match: 'action=v3.startJob', status: 200, body: { status: 'success', jobId: 'job_aaaaaaaaaaaaaaaaaaaa', startedAt: '2026-09-12T08:00:00Z' } },
  { match: 'action=v3.tick', status: 200, body: { status: 'success' } },
];

test('hors ligne, les gestes sont gardes puis rejoues une seule fois, dans l ordre', async ({ page, context }) => {
  await bootV3(page, ROUTES, { pinToken: 'jeton-pin' });
  await expect(page.locator('.row-name')).toHaveText(['623 Samana Park View']);

  await context.setOffline(true);
  for (const item of ['Master Bed & Linens', 'Bathroom', 'Final Check']) {
    expect(await geste(page, item)).toEqual({ ok: false, queued: true, data: null });
  }

  // Le bandeau dit exactement combien de gestes attendent, sous l'en-tete de la liste.
  await expect(page.getByText('Saved on device, 3 to sync')).toBeVisible();
  await expect(page.locator('.list-top + .offstrip')).toHaveCount(1);

  await context.setOffline(false);
  await expect(page.getByText('Saved on device', { exact: false })).toHaveCount(0, { timeout: 10_000 });

  const log = await fetchLog(page);
  const ticks = log.filter((l) => l.url.indexOf('action=v3.tick') !== -1);
  // Trois tentatives hors ligne plus trois rejeux : six entrees au journal,
  // mais trois cles d'idempotence distinctes et aucune repetee au rejeu.
  const idems = ticks.map((l) => JSON.parse(l.body).idem);
  expect(new Set(idems).size).toBe(3);
  const items = ticks.filter((_l, i) => i >= ticks.length - 3).map((l) => JSON.parse(l.body).itemId);
  expect(items).toEqual(['Master Bed & Linens', 'Bathroom', 'Final Check']);
});

test('un second retour en ligne ne rejoue rien', async ({ page, context }) => {
  await bootV3(page, ROUTES, { pinToken: 'jeton-pin' });
  await context.setOffline(true);
  await geste(page, 'Bathroom');
  // Attendre que le geste soit vraiment en file avant de repasser en ligne :
  // sans cette attente, toHaveCount(0) plus bas peut etre satisfait a vide
  // (la bande n'a jamais eu le temps de s'afficher), ce qui rend le test
  // instable en v3-desktop (revue tache 11, constat 1).
  await expect(page.getByText('Saved on device, 1 to sync')).toBeVisible();
  await context.setOffline(false);
  await expect(page.getByText('Saved on device', { exact: false })).toHaveCount(0, { timeout: 10_000 });
  const avant = (await fetchLog(page)).length;
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await page.waitForTimeout(500);
  expect((await fetchLog(page)).length).toBe(avant);
});

test('une action refusee par le proxy est signalee et mise de cote', async ({ page, context }) => {
  await bootV3(page, [
    { match: 'action=v3.myDay', status: 200, body: JOURNEE },
    { match: 'action=v3.startJob', status: 200, body: { status: 'success', jobId: 'job_aaaaaaaaaaaaaaaaaaaa', startedAt: '2026-09-12T08:00:00Z' } },
    { match: 'action=v3.tick', status: 400, body: { error: 'itemId required' } },
  ], { pinToken: 'jeton-pin' });
  await context.setOffline(true);
  await geste(page, 'Bathroom');
  await expect(page.getByText('Saved on device, 1 to sync')).toBeVisible();

  await context.setOffline(false);
  // La cleaner est prevenue, l'entree sort de la file et va dans le magasin mort.
  await expect(page.getByText('Not sent: itemId required. Tell your manager.')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText('Saved on device', { exact: false })).toHaveCount(0, { timeout: 10_000 });
  const morts = await page.evaluate(async () => {
    const m = await import('/v3/offline.js');
    return await m.deadEntries();
  });
  expect(morts.length).toBe(1);
  expect(morts[0].action).toBe('v3.tick');
  expect(morts[0].reason).toBe('itemId required');
});

// Revue de branche, finding 4. L'identite vient de la session et jamais du corps
// (ruling 6) : une entree encore en file au moment ou le telephone change de main
// serait rejouee sous la session de la cleaner SUIVANTE, qui recevrait le chrono,
// le comptage de linge et le signalement de la precedente. Et son ecran Profile
// afficherait la liste « Not sent » de quelqu'un d'autre.
//
// Compromis assume : vider la file perd vraiment les gestes non synchronises. Une
// action attribuee a la mauvaise personne est pire qu'une action a refaire, et le
// mode d'emploi le dit maintenant en une phrase.
test('Sign out vide la file hors ligne et le magasin mort', async ({ page }) => {
  await bootV3(page, [
    { match: 'action=v3.myDay', status: 200, body: JOURNEE },
    { match: 'action=v3.startJob', status: 200, body: { status: 'success', jobId: 'job_aaaaaaaaaaaaaaaaaaaa', startedAt: '2026-09-12T08:00:00Z' } },
    { match: 'action=v3.tick', status: 400, body: { error: 'itemId required' } },
    { match: 'action=cleanerLogout', status: 200, body: { status: 'success' } },
  ], { pinToken: 'jeton-pin' });
  await expect(page.locator('.row')).toHaveCount(1);

  // 1. Un geste refuse par le proxy : il quitte la file pour le magasin mort.
  // Drapeau plutot que context.setOffline : la deconnexion navigue vers « / »,
  // et un contexte hors ligne ferait echouer cette navigation.
  await page.evaluate(() => localStorage.setItem('v3TestOffline', '1'));
  await geste(page, 'Master Bed & Linens');
  await expect(page.getByText('Saved on device, 1 to sync')).toBeVisible();
  await page.evaluate(() => {
    localStorage.removeItem('v3TestOffline');
    window.dispatchEvent(new Event('online'));
  });
  await expect(page.getByText('Not sent: itemId required. Tell your manager.')).toBeVisible({ timeout: 10_000 });

  // 2. Deux gestes encore en file au moment de la deconnexion.
  await page.evaluate(() => localStorage.setItem('v3TestOffline', '1'));
  await geste(page, 'Bathroom');
  await geste(page, 'Final Check');
  await expect(page.getByText('Saved on device, 2 to sync')).toBeVisible();
  expect(await page.evaluate(async () => {
    const m = await import('/v3/offline.js');
    return { file: (await m.pendingEntries()).length, morts: (await m.deadEntries()).length };
  })).toEqual({ file: 2, morts: 1 });

  // L'app actuelle est remplacee par une page vide du MEME domaine : IndexedDB
  // reste donc observable apres la deconnexion.
  await page.route((url) => url.pathname === '/', (route) => route.fulfill({
    status: 200, contentType: 'text/html', body: '<!doctype html><title>stub</title><p>stub</p>',
  }));
  await page.evaluate(() => { location.hash = '#/profile'; });
  await expect(page.getByRole('heading', { name: 'Faiza' })).toBeVisible();
  await Promise.all([
    page.waitForURL(/#cleaner$/),
    page.getByRole('button', { name: 'Sign out' }).click(),
  ]);

  expect(await page.evaluate(async () => {
    const m = await import('/v3/offline.js');
    return { file: (await m.pendingEntries()).length, morts: (await m.deadEntries()).length };
  })).toEqual({ file: 0, morts: 0 });
});

test('la file survit a un rechargement de page', async ({ page }) => {
  await bootV3(page, ROUTES, { pinToken: 'jeton-pin' });
  // Drapeau plutot que context.setOffline : ce dernier couperait aussi le
  // chargement de la page et le reload echouerait avant d'atteindre le test.
  await page.evaluate(() => localStorage.setItem('v3TestOffline', '1'));
  await geste(page, 'Bathroom');
  await expect(page.getByText('Saved on device, 1 to sync')).toBeVisible();
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => (window as any).__v3ready === true);
  await expect(page.getByText('Saved on device, 1 to sync')).toBeVisible();
});

// ---------------------------------------------------------------------------
// Par l'interface (tache 5 du branchement)
// ---------------------------------------------------------------------------

test('reseau coupe au milieu d un signalement puis retabli : un seul ticket, ses deux photos et sa note rattachees', async ({ page }) => {
  await demarrer(page);
  await page.getByRole('button', { name: /1011C Bloom Towers/ }).click();
  await page.locator('[data-reply="here"]').click();
  await carteAcces(page);
  for (const r of ['Bed', 'Bathroom', 'Kitchen']) await piece(page, 1, r);
  await page.locator('[data-reply="walls-ok"]').click();
  await page.locator('[data-reply="some-damage"]').click();
  await page.locator('[data-kind="Leak"]').click();
  await fileVide(page);
  // Coupure par le drapeau du faux fetch, pas par context.setOffline() : sous WebKit,
  // Playwright hors ligne refuse aussi la lecture des Blob de la page (photo du canvas),
  // ce qu'un vrai iPhone en mode avion ne fait pas.
  await page.evaluate(() => localStorage.setItem('v3TestOffline', '1'));
  await photo(page, 'flow-shutter');
  await photo(page, 'flow-shutter');
  await page.locator('[data-flow="photos-done"]').click();
  await page.locator('#problem-note').fill('under the sink');
  await page.locator('[data-flow="save-text"]').click();
  // Garde sur le telephone : une seule coche.
  await expect(page.locator('.msg.me.problem .ticks')).toHaveText('✓');
  await expect.poll(async () => page.evaluate(async () => (await (await import('/v3/offline.js')).pendingEntries()).length)).toBe(5);
  await page.evaluate(() => { localStorage.removeItem('v3TestOffline'); window.dispatchEvent(new Event('online')); });
  await fileVideApresRetour(page);
  const e = await ecritures(page);
  const reports = e.filter((x) => x.action === 'v3.reportProblem');
  expect(reports.length).toBe(1);
  const ups = e.filter((x) => x.action === 'v3.uploadPhoto' && x.body.itemName === 'problem');
  expect(ups.length).toBe(2);
  const adds = e.filter((x) => x.action === 'v3.addProblemPhoto');
  const notes = e.filter((x) => x.action === 'v3.setProblemNote');
  expect(adds.length).toBe(1);
  expect(notes.length).toBe(1);
  expect(reports[0].body.photoIdem).toBe(ups[0].body.idem);
  expect(adds[0].body).toMatchObject({ ticketIdem: reports[0].body.idem, photoIdem: ups[1].body.idem });
  expect(notes[0].body).toMatchObject({ ticketIdem: reports[0].body.idem, note: 'under the sink' });
  // Dans l'ordre de la file : photo, signalement, photo, rattachement, note.
  const log = (await fetchLog(page)).filter((l) => /action=v3\.(uploadPhoto|reportProblem|addProblemPhoto|setProblemNote)/.test(l.url));
  const derniers = log.slice(-5).map((l) => (l.url.match(/action=v3\.(\w+)/) || [])[1]);
  expect(derniers).toEqual(['uploadPhoto', 'reportProblem', 'uploadPhoto', 'addProblemPhoto', 'setProblemNote']);
  await expect(page.locator('.msg.me.problem .ticks')).toHaveText('✓✓');
  expect(await page.evaluate(async () => (await (await import('/v3/offline.js')).deadEntries()).length)).toBe(0);
});

test('rechargement au milieu de l etape 4 : meme etape, photos retrouvees, aucun geste renvoye', async ({ page }) => {
  await demarrer(page);
  await page.getByRole('button', { name: /1011C Bloom Towers/ }).click();
  await page.locator('[data-reply="here"]').click();
  await carteAcces(page);
  for (const r of ['Bed', 'Bathroom', 'Kitchen']) await piece(page, 1, r);
  await page.locator('[data-reply="walls-ok"]').click();
  await page.locator('[data-reply="no-damage"]').click();
  await page.locator('[data-reply="send-arrival"]').click();
  await page.locator('[data-reply="linen-yes"]').click();
  await piece(page, 4, 'Bed');
  await fileVide(page);
  const avant = await ecritures(page);
  expect(avant.length).toBe(6);
  // Une photo encore en file au moment du rechargement.
  await page.evaluate(() => localStorage.setItem('v3TestOffline', '1'));
  await photo(page);
  await expect(page.locator('.vf .count')).toHaveText('1 photo');
  await expect.poll(async () => page.evaluate(async () => (await (await import('/v3/offline.js')).pendingEntries()).length)).toBe(1);

  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => (window as any).__v3ready === true);
  await expect(page.locator('.vf-top b')).toHaveText(/^Step 4 · Bathroom /);
  await expect(page.locator('.vf .count')).toHaveText('1 photo');
  const jours = async () => (await fetchLog(page)).filter((l) => l.url.indexOf('action=v3.myDay') !== -1).length;
  const joursAvant = await jours();
  await page.evaluate(() => { localStorage.removeItem('v3TestOffline'); window.dispatchEvent(new Event('online')); });
  await fileVideApresRetour(page);
  // Journee reprise de la copie hors ligne : relue au retour du reseau, sans quitter le viseur.
  await expect.poll(jours).toBeGreaterThan(joursAvant);
  await expect(page.locator('.vf-top b')).toHaveText(/^Step 4 · Bathroom /);
  const apres = await ecritures(page);
  expect(apres.length).toBe(7);
  const anciens = new Set(avant.map((x) => x.body.idem));
  expect(apres.filter((x) => anciens.has(x.body.idem)).every((x) => x.essais === 1)).toBe(true);
  expect(apres[6]).toMatchObject({ action: 'v3.uploadPhoto', body: { itemName: 'end:Bathroom', jobId: BLOOM.jobId } });
  // La conversation continue la ou elle en etait.
  await page.locator('.vf [data-reply="next-room"]').click();
  await piece(page, 4, 'Kitchen');
  await fileVide(page);
  const fin = await ecritures(page);
  expect(fin.length).toBe(8);
  expect(fin[7].body.itemName).toBe('end:Kitchen');
});

test('fermeture forcee de l app (sessionStorage vide) : reprise depuis IndexedDB, rien n est repris apres la fin', async ({ page }) => {
  await demarrer(page);
  await page.getByRole('button', { name: /1011C Bloom Towers/ }).click();
  await page.locator('[data-reply="here"]').click();
  await carteAcces(page);
  await piece(page, 1, 'Bed');
  await fileVide(page);
  // iOS ferme l'app installee : sessionStorage est perdu, IndexedDB reste.
  await page.evaluate(() => sessionStorage.clear());
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => (window as any).__v3ready === true);
  await expect(page.locator('.vf-top b')).toHaveText(/^Step 1 · Bathroom /);
  expect((await ecritures(page)).length).toBe(3);
  for (const r of ['Bathroom', 'Kitchen']) await piece(page, 1, r);
  await page.locator('[data-reply="walls-ok"]').click();
  await page.locator('[data-reply="no-damage"]').click();
  await page.locator('[data-reply="send-arrival"]').click();
  await page.locator('[data-reply="linen-yes"]').click();
  for (const r of ['Bed', 'Bathroom', 'Kitchen']) await piece(page, 4, r);
  for (const k of ['gas', 'ac', 'wifi', 'lights', 'windows', 'trash', 'door']) await page.locator('[data-reply="leave:' + k + '"]').click();
  await page.locator('[data-reply="low-done"]').click();
  await page.locator('[data-reply="send"]').click();
  await fileVide(page);
  // Fin confirmee par le proxy : plus rien a reprendre, les deux copies sont effacees.
  await expect.poll(async () => page.evaluate(async () => {
    const m = await import('/v3/offline.js');
    return { idb: await m.getState('v3Convs'), session: sessionStorage.getItem('v3Convs') };
  })).toEqual({ idb: null, session: null });
});

test('reprise : le role (lead ou aide) vient de la journee fraiche, pas de la copie gardee', async ({ page }) => {
  await demarrer(page);
  await page.getByRole('button', { name: /1506 Emaar Creekside 18A/ }).click();
  await page.locator('[data-reply="here"]').click();
  await fileVide(page);
  await expect.poll(() => page.evaluate(() => sessionStorage.getItem('v3Convs') !== null)).toBe(true);
  // La copie gardee dit « lead » (le serveur le pensait au moment de la sauvegarde) ;
  // la journee relue apres le rechargement dit « aide de Pionah ».
  await page.evaluate(async () => {
    const m = await import('/v3/offline.js');
    const id = 'job_0000000000000crk1506';
    const blob = JSON.parse(sessionStorage.getItem('v3Convs') || 'null');
    blob.convs[id].apt.lead = null;
    blob.convs[id].apt.role = 'lead';
    sessionStorage.setItem('v3Convs', JSON.stringify(blob));
    await m.putState('v3Convs', blob);
  });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => (window as any).__v3ready === true);
  await expect.poll(async () => page.evaluate(() => {
    const c = (window as any).__hk.convs['job_0000000000000crk1506'];
    return c ? { lead: c.apt.lead && c.apt.lead.name, role: c.apt.role } : null;
  })).toEqual({ lead: 'Pionah', role: 'helper' });
});

test('une entree illisible au rejeu (erreur locale) part au magasin mort au bout de 5 essais, la file continue', async ({ page }) => {
  await bootV3(page, ROUTES, { pinToken: 'jeton-pin' });
  await page.waitForFunction(() => (window as any).__v3ready === true);
  const r = await page.evaluate(async () => {
    const m = await import('/v3/offline.js');
    // file: une chaine et non un Blob : le multipart ne peut pas etre bati (TypeError, pas une ApiError).
    await m.enqueue({ action: 'v3.uploadPhoto', body: { jobId: 'job_aaaaaaaaaaaaaaaaaaaa', idem: m.newIdem() }, bytes: null, fileType: null, file: 'pas un blob', fileName: 'p.jpg', at: Date.now() });
    await m.enqueue({ action: 'v3.tick', body: { jobId: 'job_aaaaaaaaaaaaaaaaaaaa', itemId: 'Bathroom', checked: true, idem: m.newIdem() }, bytes: null, fileType: null, file: null, fileName: null, at: Date.now() });
    const etapes: number[] = [];
    for (let i = 0; i < m.MAX_ECHECS_LOCAUX; i++) { await m.flush(); etapes.push((await m.pendingEntries()).length); }
    return { etapes, morts: (await m.deadEntries()).map((d: any) => d.action) };
  });
  expect(r.etapes).toEqual([2, 2, 2, 2, 0]);
  expect(r.morts).toEqual(['v3.uploadPhoto']);
  const ticks = (await fetchLog(page)).filter((l) => l.url.indexOf('action=v3.tick') !== -1);
  expect(ticks.length).toBe(1);
});
