import { expect, test } from '@playwright/test';
import { bootV3, fetchLog, noHorizontalScroll } from './helpers';

// Mode Practice (plan 2026-10-02, tache 2) : un manager prend la vraie journee
// d'une cleaner et fait tous ses gestes, rien n'est enregistre. Le simulateur
// (v3/practice.js) repond a la place du proxy, au point de passage unique
// d'api.js : aucune ecriture ne part, rien n'entre dans la file hors ligne.
const TEAM = [
  { id: 4, name: 'Amina', role: 'cleaner' },
  { id: 6, name: 'Elite', role: 'subcontractor' },
  { id: 3, name: 'Faiza', role: 'cleaner' },
];

const STOP_FAIZA = {
  jobId: 'job_aaaaaaaaaaaaaaaaaaaa', listingId: '102', listingName: '623 Samana Park View',
  aptNumber: '623', unitType: '1 BHK', templateName: '1 Bedroom',
  checkOutTime: '12:00', nextArrivalDate: '2026-09-12', nextArrivalTime: '15:00',
  sameDay: true, guest: 'Marc L.', nextGuest: 'Anna W.', estimatedMinutes: 118,
  state: 'todo', startedAt: null,
  checklist: ['Master Bed & Linens', 'Bathroom', 'Final Check'],
  photoRequired: ['Final Check'],
  progress: { 'Bathroom': true },
  openTickets: [{ id: 71, title: 'Photo of the DEWA bill', category: 'general', priority: 'urgent' }],
  label: null,
};
const STOP_FAIZA_2 = {
  ...STOP_FAIZA, jobId: 'job_bbbbbbbbbbbbbbbbbbbb', listingId: '101', listingName: '704 Golf Links',
  aptNumber: '704', unitType: 'Studio', templateName: 'Studio', sameDay: false,
  nextArrivalDate: null, nextArrivalTime: null, progress: {}, openTickets: [], estimatedMinutes: 94,
};

const JOUR_MANAGER = {
  status: 'success', date: '2026-09-12', me: { id: 1, name: 'Hillal', role: 'manager' },
  linenRequired: true, totalMinutes: 0, stops: [], team: TEAM,
};
const JOUR_FAIZA = {
  status: 'success', date: '2026-09-12', me: { id: 3, name: 'Faiza', role: 'cleaner' },
  linenRequired: true, totalMinutes: 212, stops: [STOP_FAIZA, STOP_FAIZA_2],
  viewAs: true, viewer: { id: 1, name: 'Hillal' }, team: TEAM,
};
const JOUR_AMINA = {
  ...JOUR_FAIZA, me: { id: 4, name: 'Amina', role: 'cleaner' }, totalMinutes: 94,
  stops: [{ ...STOP_FAIZA_2, progress: {} }],
};

// Toute ecriture qui partait vraiment recevrait le refus du serveur (un manager
// n'a aucun droit d'ecriture), et resterait surtout dans le journal de fetch.
const ROUTES = [
  { match: 'action=v3.myDay&as=3', status: 200, body: JOUR_FAIZA },
  { match: 'action=v3.myDay&as=4', status: 200, body: JOUR_AMINA },
  { match: 'action=v3.myDay', status: 200, body: JOUR_MANAGER },
  { match: 'action=cleanerLogout', status: 200, body: { status: 'success' } },
  { match: 'action=', status: 403, body: { error: 'forbidden' } },
];

const PNG_1x1 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

// Tout appel au proxy autre que la lecture de la journee et la deconnexion.
async function appelsInterdits(page: any) {
  return (await fetchLog(page)).filter((l) =>
    l.url.indexOf('hostaway-proxy') !== -1 &&
    l.url.indexOf('action=v3.myDay') === -1 &&
    l.url.indexOf('action=cleanerLogout') === -1);
}

async function fileEtMorts(page: any) {
  return await page.evaluate(async () => {
    const m = await import('/v3/offline.js');
    return { file: await m.pendingCount(), morts: (await m.deadEntries()).length };
  });
}

async function practiceFaiza(page: any, opts: { hash?: string; routes?: any[] } = {}) {
  await bootV3(page, opts.routes ?? ROUTES, { pinToken: 'jeton-manager', hash: opts.hash ?? '#/profile' });
  await page.evaluate(() => { location.hash = '#/profile'; });
  await expect(page.getByText('Try the cleaner app')).toBeVisible();
  await page.getByRole('button', { name: 'Practice as Faiza' }).click();
  await expect(page.locator('.practicebar')).toContainText('Practice as Faiza · nothing is saved');
  await expect(page.locator('.nextup .n')).toHaveText('623 Samana Park View');
}

async function photo(page: any, cible: any, nom = 'shot.png', type = 'image/png', octets?: Buffer) {
  const chooser = page.waitForEvent('filechooser');
  await cible.click();
  await (await chooser).setFiles({ name: nom, mimeType: type, buffer: octets ?? Buffer.from(PNG_1x1, 'base64') });
}

test('1. entree : Profile propose Practice et View pour chaque membre', async ({ page }) => {
  await bootV3(page, ROUTES, { pinToken: 'jeton-manager', hash: '#/profile' });
  await expect(page.getByText('Try the cleaner app')).toBeVisible();
  await expect(page.getByText("View a cleaner's day")).toHaveCount(0);
  await expect(page.locator('[data-act="practice"]')).toHaveCount(3);
  await expect(page.locator('[data-act="viewas"]')).toHaveCount(3);
  await expect(page.getByRole('button', { name: 'Practice as Amina' })).toHaveText('Practice');
  await expect(page.getByRole('button', { name: "View Amina's day" })).toHaveText('View');

  await page.getByRole('button', { name: 'Practice as Faiza' }).click();
  await expect(page).toHaveURL(/#\/today$/);
  await expect(page.locator('.practicebar')).toContainText('Practice as Faiza · nothing is saved');
  await expect(page.locator('.viewas')).toHaveCount(0);
  await expect(page.locator('.drench .dr-top')).toContainText('Faiza');
  // Les gestes sont ceux de la cleaner : Start actif, pas de bouton de lecture.
  await expect(page.getByRole('button', { name: 'Start this cleaning' })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'View this cleaning' })).toHaveCount(0);
  const myDays = (await fetchLog(page)).filter((l) => l.url.indexOf('action=v3.myDay') !== -1);
  expect(myDays[myDays.length - 1].url).toContain('&as=3');
  expect(await page.evaluate(() => sessionStorage.getItem('v3ViewAs'))).toContain('"practice":true');
});

test('1b. View reste la lecture seule de la tache 1', async ({ page }) => {
  await bootV3(page, ROUTES, { pinToken: 'jeton-manager', hash: '#/profile' });
  await page.getByRole('button', { name: "View Faiza's day" }).click();
  await expect(page.locator('.viewas')).toContainText("Viewing Faiza's day · read only");
  await expect(page.locator('.practicebar')).toHaveCount(0);
  await expect(page.locator('.btn-start')).toBeDisabled();
});

// Rapport de contraste WCAG, calcule sur les couleurs reellement rendues.
function contraste(a: number[], b: number[]) {
  const lum = (c: number[]) => {
    const [r, g, bl] = c.map((v) => {
      const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

async function mesureBandeau(page: any, sel: string) {
  return await page.evaluate((s: string) => {
    const rgb = (v: string) => (v.match(/\d+(\.\d+)?/g) || []).slice(0, 3).map(Number);
    const bar = document.querySelector(s) as HTMLElement;
    const exit = bar.querySelector('button') as HTMLElement;
    const nav = document.querySelector('.cl-bar, .jobactions') as HTMLElement;
    const b = bar.getBoundingClientRect();
    const n = nav.getBoundingClientRect();
    const fond = rgb(getComputedStyle(bar).backgroundColor);
    const eb = getComputedStyle(exit).backgroundColor;
    const transparent = eb === 'transparent' || /rgba\(.*,\s*0\)$/.test(eb);
    return {
      fond,
      texte: rgb(getComputedStyle(bar).color),
      exit: rgb(getComputedStyle(exit).color),
      exitFond: transparent ? fond : rgb(eb),
      position: getComputedStyle(bar).position,
      chevauche: !(b.bottom <= n.top || b.top >= n.bottom),
      exitHauteur: exit.getBoundingClientRect().height,
    };
  }, sel);
}

test('2. bandeau : sur tous les ecrans, lisible, distinct de la lecture seule, Exit efface tout', async ({ page }) => {
  await practiceFaiza(page);
  const today = await mesureBandeau(page, '.practicebar');
  expect(contraste(today.texte, today.fond)).toBeGreaterThanOrEqual(4.5);
  expect(contraste(today.exit, today.exitFond)).toBeGreaterThanOrEqual(4.5);
  expect(today.position).toBe('static');
  expect(today.chevauche).toBe(false);
  expect(today.exitHauteur).toBeGreaterThanOrEqual(44);
  const { scrollWidth, clientWidth } = await noHorizontalScroll(page);
  expect(scrollWidth).toBe(clientWidth);

  // Le Job : le bandeau en tete, la barre d'actions intacte.
  await page.getByRole('button', { name: '704 Golf Links' }).click();
  await expect(page.getByRole('heading', { name: '704 Golf Links' })).toBeVisible();
  await expect(page.locator('.practicebar')).toBeVisible();
  const job = await mesureBandeau(page, '.practicebar');
  expect(job.chevauche).toBe(false);
  await page.evaluate(() => { location.hash = '#/profile'; });
  await expect(page.locator('.practicebar')).toContainText('Practice as Faiza · nothing is saved');
  await expect(page.getByRole('button', { name: 'Practice as Faiza' })).toHaveAttribute('aria-current', 'true');

  // Couleur propre au mode : differente du bandeau lecture seule, et absente
  // du reste de l'interface cleaner.
  const fondPractice = today.fond.join(',');
  const ailleurs = await page.evaluate((f: string) => {
    const rgb = (v: string) => (v.match(/\d+(\.\d+)?/g) || []).slice(0, 3).map(Number).join(',');
    return Array.from(document.querySelectorAll('body *'))
      .filter((el) => !(el as HTMLElement).closest('.practicebar'))
      .filter((el) => rgb(getComputedStyle(el).backgroundColor) === f).length;
  }, fondPractice);
  expect(ailleurs).toBe(0);

  await page.getByRole('button', { name: 'Exit' }).click();
  await expect(page).toHaveURL(/#\/today$/);
  await expect(page.locator('.practicebar')).toHaveCount(0);
  await expect(page.locator('.drench .dr-top')).toContainText('Hillal');
  expect(await page.evaluate(() => sessionStorage.getItem('v3ViewAs'))).toBeNull();
  expect(await page.evaluate(() => sessionStorage.getItem('v3PracticeState'))).toBeNull();

  await page.evaluate(() => { location.hash = '#/profile'; });
  await page.getByRole('button', { name: "View Faiza's day" }).click();
  await expect(page.locator('.viewas')).toBeVisible();
  // Le bandeau View parait des le chargement : on mesure sur la journee rendue.
  await expect(page.locator('.nextup .n')).toHaveText('623 Samana Park View');
  const vue = await mesureBandeau(page, '.viewas');
  expect(vue.fond.join(',')).not.toBe(fondPractice);
});

test('3 et 4. tous les gestes marchent comme pour la cleaner, et rien ne part', async ({ page }) => {
  await practiceFaiza(page);
  // Start : le chrono demarre.
  await page.getByRole('button', { name: 'Start this cleaning' }).click();
  await expect(page.getByRole('heading', { name: '623 Samana Park View' })).toBeVisible();
  await expect(page.locator('#c-timer')).not.toHaveText('00:00', { timeout: 4000 });
  await expect(page.locator('.practicebar')).toBeVisible();

  // Cases : l'avancement reel de Faiza, puis cocher et decocher.
  await expect(page.locator('.checkhead .pr').last()).toHaveText('1/3');
  const lit = page.getByRole('button', { name: 'Master Bed & Linens' });
  await lit.click();
  await expect(lit).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.checkhead .pr').last()).toHaveText('2/3');
  await lit.click();
  await expect(lit).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('.checkhead .pr').last()).toHaveText('1/3');
  await lit.click();

  // Photo d'une ligne : la camera passe a « done », comme d'habitude.
  await photo(page, page.locator('[data-act="shoot"][data-item="Final Check"]'));
  await expect(page.locator('[data-act="shoot"][data-item="Final Check"]')).toHaveClass(/done/);
  await page.getByRole('button', { name: 'Final Check' }).click();
  await expect(page.getByRole('button', { name: 'Final Check' })).toHaveAttribute('aria-pressed', 'true');

  // Check ticket : la meme validation front, puis la meme confirmation.
  await page.getByRole('button', { name: 'Photo of the DEWA bill' }).click();
  await expect(page.getByText('Take a photo first')).toBeVisible();
  await photo(page, page.locator('[data-act="shoot-ticket"][data-ticket="71"]'));
  await expect(page.locator('[data-act="shoot-ticket"][data-ticket="71"]')).toHaveClass(/done/);
  await page.getByRole('button', { name: 'Photo of the DEWA bill' }).click();
  await expect(page.getByText('Sent for confirmation')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Photo of the DEWA bill' })).toHaveAttribute('aria-pressed', 'true');

  // Report a problem : la feuille se ferme avec le meme message.
  await page.getByRole('button', { name: 'Report a problem' }).click();
  await page.getByRole('button', { name: 'Plumbing' }).click();
  await expect(page.locator('[data-act="report-send"]')).toBeDisabled();
  await photo(page, page.locator('[data-act="report-shot"]'));
  await expect(page.locator('[data-act="report-shot"]')).toHaveText('Photo taken');
  await page.getByRole('button', { name: 'Send to the technician on duty' }).click();
  await expect(page.getByText('Sent. The technician on duty is notified.')).toBeVisible();
  await expect(page.locator('#sheet-host [data-sheet]')).toHaveCount(0);

  // Finish : linge compte, ecran de fin, le menage passe a « done » dans Today.
  await page.getByRole('button', { name: 'Finish', exact: true }).click();
  await expect(page.getByText('Linen going out')).toBeVisible();
  await page.locator('[data-act="linen-plus"][data-field="bed_sheets"]').click();
  await page.locator('[data-act="linen-plus"][data-field="bed_sheets"]').click();
  await expect(page.locator('[data-linen="bed_sheets"]')).toHaveText('2');
  await page.locator('[data-act="linen-minus"][data-field="bed_sheets"]').click();
  await expect(page.locator('[data-linen="bed_sheets"]')).toHaveText('1');
  await page.getByRole('button', { name: 'Finish this cleaning' }).click();
  await expect(page.getByRole('heading', { name: 'Cleaning finished' })).toBeVisible();
  await expect(page.locator('.reco')).toContainText('3/3');
  await expect(page.locator('.reco')).toContainText('Photos');
  await expect(page.getByText('Saved on your phone')).toHaveCount(0);
  await page.getByRole('button', { name: 'Back to my day' }).click();
  await expect(page.locator('.nextup .n')).toHaveText('704 Golf Links');
  await expect(page.getByRole('button', { name: /623 Samana Park View/ }).locator('.pill')).toHaveText('Done');

  // Rien n'est parti : ni ecriture, ni photo, ni file, ni magasin mort.
  expect(await appelsInterdits(page)).toEqual([]);
  expect(await fileEtMorts(page)).toEqual({ file: 0, morts: 0 });
  await expect(page.getByText('forbidden')).toHaveCount(0);
  await expect(page.getByText('Saved on device', { exact: false })).toHaveCount(0);
});

test('3b. le simulateur rend les refus du serveur avec le meme texte', async ({ page }) => {
  await practiceFaiza(page);
  await page.getByRole('button', { name: '704 Golf Links' }).click();
  // Un fichier qui n'est pas une image : le proxy refuserait « unsupported image type ».
  await photo(page, page.locator('[data-act="shoot"][data-item="Final Check"]'), 'note.txt', 'text/plain', Buffer.from('hello'));
  await expect(page.getByText('unsupported image type')).toBeVisible();
  await expect(page.locator('[data-act="shoot"][data-item="Final Check"]')).not.toHaveClass(/done/);

  // Les autres refus, au point de passage unique : memes messages, memes codes.
  const refus = await page.evaluate(async () => {
    const { api } = await import('/v3/api.js');
    const essai = async (action: string, corps: any) => {
      try { await api.post(action, corps); return 'ok'; } catch (e: any) { return e.kind + ' ' + e.status + ' ' + e.message; }
    };
    const idem = () => 'idem' + Math.random().toString(16).slice(2, 12);
    return {
      jobInconnu: await essai('v3.finishJob', { jobId: 'job_inconnu', idem: idem() }),
      sansIdem: await essai('v3.startJob', { jobId: 'job_bbbbbbbbbbbbbbbbbbbb' }),
      checked: await essai('v3.tick', { jobId: 'job_bbbbbbbbbbbbbbbbbbbb', itemId: 'Bathroom', checked: 'yes', idem: idem() }),
      ticketSansPhoto: await essai('v3.checkTicket', { ticketId: 71, idem: idem() }),
      ticketInconnu: await essai('v3.checkTicket', { ticketId: 999, photoId: 5, idem: idem() }),
      photoInconnue: await essai('v3.reportProblem', { jobId: 'job_bbbbbbbbbbbbbbbbbbbb', listingId: '101', category: 'ac', photoId: 123456, idem: idem() }),
      categorie: await essai('v3.reportProblem', { listingId: '101', category: 'constructor', photoId: 5, idem: idem() }),
      linge: await essai('v3.finishJob', { jobId: 'job_bbbbbbbbbbbbbbbbbbbb', idem: idem(), linen: { bed_sheets: 1 } }),
      autre: await essai('deletePushSubscription', { endpoint: 'x' }),
    };
  });
  expect(refus.jobInconnu).toBe('server 404 Job not found.');
  expect(refus.sansIdem).toBe('server 400 idem required');
  expect(refus.checked).toBe('server 400 checked must be a boolean');
  expect(refus.ticketSansPhoto).toBe('server 400 photoId required');
  expect(refus.ticketInconnu).toBe('server 400 ticket not found');
  expect(refus.photoInconnue).toBe('server 400 photo not found');
  expect(refus.categorie).toBe('server 400 unknown category');
  expect(refus.linge).toBe('server 400 pillowcases must be an integer');
  expect(refus.autre).toBe('server 400 Not available in practice');
  expect(await appelsInterdits(page)).toEqual([]);
  expect(await fileEtMorts(page)).toEqual({ file: 0, morts: 0 });
});

test('5. l avancement survit a la navigation et au rechargement, Exit et Re-entrer repartent du reel', async ({ page }) => {
  await practiceFaiza(page);
  await page.getByRole('button', { name: 'Start this cleaning' }).click();
  await page.getByRole('button', { name: 'Master Bed & Linens' }).click();
  await expect(page.locator('.checkhead .pr').last()).toHaveText('2/3');

  // Navigation : Today puis retour.
  await page.getByRole('button', { name: 'Back' }).click();
  await expect(page.getByRole('button', { name: 'Continue this cleaning' })).toBeVisible();
  await page.getByRole('button', { name: 'Continue this cleaning' }).click();
  await expect(page.locator('.checkhead .pr').last()).toHaveText('2/3');

  // Rechargement de l'onglet, au milieu du menage.
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => (window as any).__v3ready === true, null, { timeout: 10_000 });
  await expect(page.locator('.practicebar')).toContainText('Practice as Faiza · nothing is saved');
  await expect(page.getByRole('heading', { name: '623 Samana Park View' })).toBeVisible();
  await expect(page.locator('.checkhead .pr').last()).toHaveText('2/3');
  await expect(page.locator('#c-timer')).not.toHaveText('00:00', { timeout: 4000 });
  expect(await page.evaluate(() => sessionStorage.getItem('v3PracticeState'))).toContain('job_aaaaaaaaaaaaaaaaaaaa');

  // Exit puis Practice a nouveau : la journee reelle, sans rien de simule.
  await page.getByRole('button', { name: 'Exit' }).click();
  await expect(page.locator('.drench .dr-top')).toContainText('Hillal');
  expect(await page.evaluate(() => sessionStorage.getItem('v3PracticeState'))).toBeNull();
  await page.evaluate(() => { location.hash = '#/profile'; });
  await page.getByRole('button', { name: 'Practice as Faiza' }).click();
  await expect(page.getByRole('button', { name: 'Start this cleaning' })).toBeVisible();
  await page.getByRole('button', { name: 'Start this cleaning' }).click();
  await expect(page.locator('.checkhead .pr').last()).toHaveText('1/3');
  expect(await appelsInterdits(page)).toEqual([]);
});

test('5b. changer de membre et Sign out effacent la seance', async ({ page }) => {
  await practiceFaiza(page);
  await page.getByRole('button', { name: 'Start this cleaning' }).click();
  await expect(page.getByRole('heading', { name: '623 Samana Park View' })).toBeVisible();
  expect(await page.evaluate(() => sessionStorage.getItem('v3PracticeState'))).toContain('running');

  await page.evaluate(() => { location.hash = '#/profile'; });
  await page.getByRole('button', { name: 'Practice as Amina' }).click();
  await expect(page.locator('.practicebar')).toContainText('Practice as Amina · nothing is saved');
  await expect(page.locator('.nextup .n')).toHaveText('704 Golf Links');
  expect(await page.evaluate(() => sessionStorage.getItem('v3PracticeState') || '')).not.toContain('running');

  await page.evaluate(() => { location.hash = '#/profile'; });
  await page.getByRole('button', { name: 'Practice as Faiza' }).click();
  await expect(page.locator('.practicebar')).toContainText('Practice as Faiza · nothing is saved');
  await expect(page.locator('.nextup .n')).toHaveText('623 Samana Park View');
  await expect(page.getByRole('button', { name: 'Start this cleaning' })).toBeVisible();

  // View d'un autre membre efface aussi la seance. On attend l'ecran du Job :
  // Start navigue apres la reponse simulee, un changement d'ecran plus tot
  // serait ecrase par cette navigation.
  await page.getByRole('button', { name: 'Start this cleaning' }).click();
  await expect(page.getByRole('heading', { name: '623 Samana Park View' })).toBeVisible();
  await page.evaluate(() => { location.hash = '#/profile'; });
  await page.getByRole('button', { name: "View Amina's day" }).click();
  await expect(page.locator('.viewas')).toBeVisible();
  expect(await page.evaluate(() => sessionStorage.getItem('v3PracticeState'))).toBeNull();

  await page.evaluate(() => { location.hash = '#/profile'; });
  await page.getByRole('button', { name: 'Practice as Faiza' }).click();
  await expect(page.locator('.nextup .n')).toHaveText('623 Samana Park View');
  await page.getByRole('button', { name: 'Start this cleaning' }).click();
  await expect(page.getByRole('heading', { name: '623 Samana Park View' })).toBeVisible();
  expect(await page.evaluate(() => sessionStorage.getItem('v3PracticeState'))).toContain('running');
  await page.route((url) => url.pathname === '/', (route) => route.fulfill({
    status: 200, contentType: 'text/html', body: '<!doctype html><title>stub</title><p>stub</p>',
  }));
  await page.evaluate(() => { location.hash = '#/profile'; });
  await Promise.all([
    page.waitForURL(/#cleaner$/),
    page.getByRole('button', { name: 'Sign out' }).click(),
  ]);
  expect(await page.evaluate(() => sessionStorage.getItem('v3PracticeState'))).toBeNull();
  expect(await page.evaluate(() => sessionStorage.getItem('v3ViewAs'))).toBeNull();
  // La deconnexion est reelle : cleanerLogout part, rien d'autre.
  const log = await fetchLog(page);
  expect(log.some((l) => l.url.indexOf('action=cleanerLogout') !== -1)).toBe(true);
  expect(log.filter((l) => /action=v3\.(startJob|tick|uploadPhoto|finishJob|reportProblem|checkTicket)/.test(l.url))).toEqual([]);
});

test('6. hors ligne, les gestes marchent et aucun bandeau Saved on device', async ({ page }) => {
  await practiceFaiza(page);
  await page.evaluate(() => localStorage.setItem('v3TestOffline', '1'));
  await page.getByRole('button', { name: 'Start this cleaning' }).click();
  await expect(page.getByRole('heading', { name: '623 Samana Park View' })).toBeVisible();
  await page.getByRole('button', { name: 'Master Bed & Linens' }).click();
  await expect(page.getByRole('button', { name: 'Master Bed & Linens' })).toHaveAttribute('aria-pressed', 'true');
  await photo(page, page.locator('[data-act="shoot"][data-item="Final Check"]'));
  await expect(page.locator('[data-act="shoot"][data-item="Final Check"]')).toHaveClass(/done/);
  await page.getByRole('button', { name: 'Final Check' }).click();
  await page.getByRole('button', { name: 'Finish', exact: true }).click();
  await page.getByRole('button', { name: 'Finish this cleaning' }).click();
  await expect(page.getByRole('heading', { name: 'Cleaning finished' })).toBeVisible();
  await expect(page.getByText('Saved on your phone')).toHaveCount(0);
  await expect(page.getByText('Photo saved on your phone')).toHaveCount(0);
  await expect(page.getByText('Saved on device', { exact: false })).toHaveCount(0);
  expect(await fileEtMorts(page)).toEqual({ file: 0, morts: 0 });
  // Retour du reseau : aucun rejeu, rien a rejouer.
  await page.evaluate(() => {
    localStorage.removeItem('v3TestOffline');
    window.dispatchEvent(new Event('online'));
  });
  await page.waitForTimeout(400);
  expect(await appelsInterdits(page)).toEqual([]);
});

test('6b. Practice ne rejoue pas la file reelle, et sendOrQueue n y met rien', async ({ page }) => {
  await practiceFaiza(page);
  // Une entree reelle deja en file (cas d'ecole) : elle ne doit ni partir ni
  // etre avalee par le simulateur pendant la seance.
  await page.evaluate(async () => {
    const m = await import('/v3/offline.js');
    await m.enqueue({ action: 'v3.tick', body: { jobId: 'x', itemId: 'y', checked: true, idem: 'reelle-12345' }, at: Date.now() });
    localStorage.setItem('v3TestOffline', '1');
    await m.flush();
    const r = await m.sendOrQueue('v3.startJob', { jobId: 'job_inconnu', idem: 'essai-123456' }).catch((e: any) => e.message);
    return r;
  }).then((r: any) => expect(r).toBe('Job not found.'));
  await page.evaluate(() => {
    localStorage.removeItem('v3TestOffline');
    window.dispatchEvent(new Event('online'));
  });
  await page.waitForTimeout(400);
  expect(await page.evaluate(async () => (await import('/v3/offline.js')).pendingCount())).toBe(1);
  expect(await appelsInterdits(page)).toEqual([]);
});

// ---------------------------------------------------------------------------
// Revue tache 2, correctif 1.
// ---------------------------------------------------------------------------

const ROUTES_REJEU = [
  { match: 'action=v3.tick', status: 200, body: { status: 'success' } },
  ...ROUTES,
];

const JOUR_CLEANER = {
  status: 'success', date: '2026-09-12', me: { id: 3, name: 'Faiza', role: 'cleaner' },
  linenRequired: true, totalMinutes: 212, stops: [STOP_FAIZA, STOP_FAIZA_2],
};

const ECRITURES = /action=v3\.(startJob|tick|uploadPhoto|finishJob|reportProblem|checkTicket)/;

for (const horsLigne of [false, true]) {
  test('constat 1 : Exit pendant la prise de photo, la photo ne part pas' + (horsLigne ? ' (hors ligne)' : ''), async ({ page }) => {
    await practiceFaiza(page);
    await page.getByRole('button', { name: 'Start this cleaning' }).click();
    await expect(page.getByRole('heading', { name: '623 Samana Park View' })).toBeVisible();
    if (horsLigne) await page.evaluate(() => localStorage.setItem('v3TestOffline', '1'));
    // Le selecteur de fichier est ouvert : la photo n'est pas encore choisie.
    const chooser = page.waitForEvent('filechooser');
    await page.locator('[data-act="shoot"][data-item="Final Check"]').click();
    const fc = await chooser;
    // Exit pendant l'attente, puis la photo arrive.
    await page.getByRole('button', { name: 'Exit' }).click();
    await expect(page.locator('.practicebar')).toHaveCount(0);
    await fc.setFiles({ name: 'shot.png', mimeType: 'image/png', buffer: Buffer.from(PNG_1x1, 'base64') });
    await page.waitForTimeout(1200);
    const log = await fetchLog(page);
    expect(log.filter((l) => l.url.indexOf('action=v3.uploadPhoto') !== -1)).toEqual([]);
    expect(log.filter((l) => ECRITURES.test(l.url))).toEqual([]);
    expect(await fileEtMorts(page)).toEqual({ file: 0, morts: 0 });
    await expect(page.getByText('forbidden')).toHaveCount(0);
    await expect(page.getByText('Photo saved on your phone')).toHaveCount(0);
    await expect(page.getByText('Saved on device', { exact: false })).toHaveCount(0);
  });

  test('constat 1 : api.js refuse une ecriture nee d une seance Practice finie' + (horsLigne ? ' (hors ligne)' : ''), async ({ page }) => {
    await practiceFaiza(page);
    const marque = await page.evaluate(async () => (await import('/v3/practice.js')).practiceMark());
    expect(marque).toBeGreaterThan(0);
    await page.getByRole('button', { name: 'Exit' }).click();
    await expect(page.locator('.drench .dr-top')).toContainText('Hillal');
    if (horsLigne) await page.evaluate(() => localStorage.setItem('v3TestOffline', '1'));
    const r = await page.evaluate(async (m: number) => {
      const o = await import('/v3/offline.js');
      const essai = async (f: () => Promise<any>) => {
        try { await f(); return 'ok'; } catch (e: any) { return e.kind + ' ' + e.message; }
      };
      const blob = new Blob([new Uint8Array([137, 80, 78, 71])], { type: 'image/png' });
      return {
        tick: await essai(() => o.sendOrQueue('v3.tick',
          { jobId: 'job_aaaaaaaaaaaaaaaaaaaa', itemId: 'Bathroom', checked: true, idem: 'apres-exit-0001' }, undefined, undefined, m)),
        photo: await essai(() => o.sendOrQueue('v3.uploadPhoto',
          { jobId: 'job_aaaaaaaaaaaaaaaaaaaa', idem: 'apres-exit-0002' }, blob, 'p.png', m)),
      };
    }, marque);
    expect(r).toEqual({ tick: 'practice Practice ended', photo: 'practice Practice ended' });
    expect((await fetchLog(page)).filter((l) => ECRITURES.test(l.url))).toEqual([]);
    expect(await fileEtMorts(page)).toEqual({ file: 0, morts: 0 });
  });
}

test('constat 2 : Sign out quitte Practice avant la deconnexion reseau', async ({ page }) => {
  await practiceFaiza(page, {
    routes: [{ match: 'action=cleanerLogout', status: 200, body: { status: 'success' }, delay: 2500 }, ...ROUTES],
  });
  await page.route((url) => url.pathname === '/', (route) => route.fulfill({
    status: 200, contentType: 'text/html', body: '<!doctype html><title>stub</title><p>stub</p>',
  }));
  await page.evaluate(() => { location.hash = '#/profile'; });
  await expect(page.locator('.practicebar')).toBeVisible();
  await page.getByRole('button', { name: 'Sign out' }).click();
  // Pendant la sortie (cleanerLogout lent) : plus de bandeau, gestes inertes.
  await expect(page.locator('.practicebar')).toHaveCount(0);
  const pendant = await page.evaluate(async () => {
    const app = await import('/v3/app.js');
    const pr = await import('/v3/practice.js');
    return { lecture: app.readOnly(), practice: pr.practiceActive(), url: location.hash };
  });
  expect(pendant).toEqual({ lecture: true, practice: false, url: '#/profile' });
  await page.waitForURL(/#cleaner$/);
  expect((await fetchLog(page)).filter((l) => ECRITURES.test(l.url))).toEqual([]);
});

test('constats 3 et 4b : Exit relance le rejeu de la vraie file', async ({ page }) => {
  await practiceFaiza(page, { routes: ROUTES_REJEU });
  await page.evaluate(async () => {
    const m = await import('/v3/offline.js');
    await m.enqueue({ action: 'v3.tick', body: { jobId: 'x', itemId: 'y', checked: true, idem: 'reelle-12345' }, at: Date.now() });
    await m.flush();
  });
  expect(await page.evaluate(async () => (await import('/v3/offline.js')).pendingCount())).toBe(1);
  expect((await fetchLog(page)).filter((l) => l.url.indexOf('action=v3.tick') !== -1)).toEqual([]);
  await page.getByRole('button', { name: 'Exit' }).click();
  await expect.poll(async () => page.evaluate(async () => (await import('/v3/offline.js')).pendingCount())).toBe(0);
  const ticks = (await fetchLog(page)).filter((l) => l.url.indexOf('action=v3.tick') !== -1);
  expect(ticks.length).toBe(1);
  expect(ticks[0].body).toContain('reelle-12345');
  expect((await fileEtMorts(page)).morts).toBe(0);
});

test('constat 3 : Practice relu puis refuse par le proxy, la vraie file repart', async ({ page }) => {
  // Une cleaner dont l'identite n'est pas connue de l'appareil ouvre un onglet
  // ou un manager avait laisse Practice ; elle a un vrai geste en file.
  await bootV3(page, [
    { match: 'as=', status: 403, body: { error: 'forbidden' } },
    { match: 'action=v3.myDay', status: 200, body: JOUR_CLEANER },
    { match: 'action=v3.tick', status: 200, body: { status: 'success' } },
  ], { pinToken: 'jeton-pin' });
  await page.evaluate(async () => {
    const m = await import('/v3/offline.js');
    await m.enqueue({ action: 'v3.tick', body: { jobId: 'x', itemId: 'y', checked: true, idem: 'reelle-67890' }, at: Date.now() });
    sessionStorage.setItem('v3ViewAs', JSON.stringify({ id: '4', name: 'Amina', viewerId: '1', practice: true }));
    localStorage.removeItem('hkSessionCleanerId');
    // Elle demarre hors ligne : la journee demandee (as=) ne vient pas, le rejeu
    // est muet tant que la seance relue est ouverte.
    localStorage.setItem('v3TestOffline', '1');
  });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
  // Le reseau revient : l'evenement online tombe pendant la seance, rien ne part.
  await page.evaluate(() => {
    localStorage.removeItem('v3TestOffline');
    window.dispatchEvent(new Event('online'));
  });
  await page.waitForTimeout(400);
  expect(await page.evaluate(async () => (await import('/v3/offline.js')).pendingCount())).toBe(1);
  // Try again : le proxy refuse as=, le mode tombe, et la vraie file repart.
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(page.locator('.drench .dr-top')).toContainText('Faiza');
  await expect(page.locator('.practicebar')).toHaveCount(0);
  await expect.poll(async () => page.evaluate(async () => (await import('/v3/offline.js')).pendingCount())).toBe(0);
  expect((await fetchLog(page)).filter((l) => l.url.indexOf('action=v3.tick') !== -1).length).toBe(1);
  expect(await page.evaluate(() => sessionStorage.getItem('v3PracticeState'))).toBeNull();
});

test('constat 4c : une cleaner qui ouvre l app avec un Practice residuel ecrit pour de vrai', async ({ page }) => {
  await bootV3(page, [
    { match: 'as=', status: 200, body: JOUR_AMINA },
    { match: 'action=v3.myDay', status: 200, body: JOUR_CLEANER },
    { match: 'action=v3.startJob', status: 200, body: { status: 'success', startedAt: new Date().toISOString() } },
  ], { pinToken: 'jeton-pin' });
  await page.evaluate(() => {
    sessionStorage.setItem('v3ViewAs', JSON.stringify({ id: '4', name: 'Amina', viewerId: '1', practice: true }));
    sessionStorage.setItem('v3PracticeState', JSON.stringify({ targetId: '4', viewerId: '1', seq: 0, jobs: {}, photos: {}, tickets: {}, idem: {} }));
    localStorage.setItem('hkSessionCleanerId', '3');
  });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => (window as any).__v3ready === true, null, { timeout: 10_000 });
  await expect(page.locator('.drench .dr-top')).toContainText('Faiza');
  await expect(page.locator('.practicebar')).toHaveCount(0);
  await expect(page.locator('.viewas')).toHaveCount(0);
  expect(await page.evaluate(() => sessionStorage.getItem('v3PracticeState'))).toBeNull();
  expect(await page.evaluate(() => sessionStorage.getItem('v3ViewAs'))).toBeNull();
  expect(await page.evaluate(async () => (await import('/v3/practice.js')).practiceActive())).toBe(false);
  await page.getByRole('button', { name: 'Start this cleaning' }).click();
  await expect(page.getByRole('heading', { name: '623 Samana Park View' })).toBeVisible();
  const log = await fetchLog(page);
  expect(log.some((l) => l.url.indexOf('as=') !== -1)).toBe(false);
  expect(log.filter((l) => l.url.indexOf('action=v3.startJob') !== -1).length).toBe(1);
});

test('constat 4d : en Practice, une erreur locale n entre jamais en file', async ({ page }) => {
  await practiceFaiza(page);
  // Un « fichier » qui n'est pas un Blob : le multipart ne se batit pas, et
  // sendOrQueue traite toute erreur qui n'est pas une ApiError comme une coupure.
  const r = await page.evaluate(async () => {
    const o = await import('/v3/offline.js');
    const faux = { type: 'image/png', size: 3, arrayBuffer: async () => new ArrayBuffer(3) };
    try {
      await o.sendOrQueue('v3.uploadPhoto', { jobId: 'job_aaaaaaaaaaaaaaaaaaaa', idem: 'erreur-locale-01' }, faux as any, 'p.png');
      return 'ok';
    } catch (e: any) {
      return e && e.name;
    }
  });
  expect(r).toBe('TypeError');
  expect(await fileEtMorts(page)).toEqual({ file: 0, morts: 0 });
  expect(await appelsInterdits(page)).toEqual([]);
});
