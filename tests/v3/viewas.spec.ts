import { expect, test } from '@playwright/test';
import { bootV3, fetchLog, noHorizontalScroll } from './helpers';

// Mode « View as » (plan 2026-10-02) : un manager choisit une cleaner dans
// Profile et voit sa vraie journee, en lecture seule.
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
  // Avancement reel de Faiza : le manager doit le voir tel quel.
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
const JOUR_CLEANER = {
  status: 'success', date: '2026-09-12', me: { id: 3, name: 'Faiza', role: 'cleaner' },
  linenRequired: true, totalMinutes: 212, stops: [STOP_FAIZA, STOP_FAIZA_2],
};

// Le plus specifique d'abord : le bouchon prend la premiere route qui correspond.
const ROUTES_MANAGER = [
  { match: 'action=v3.myDay&as=3', status: 200, body: JOUR_FAIZA },
  { match: 'action=v3.myDay', status: 200, body: JOUR_MANAGER },
  { match: 'action=v3.', status: 403, body: { error: 'forbidden' } },
];

const ECRITURES = ['v3.startJob', 'v3.tick', 'v3.uploadPhoto', 'v3.finishJob', 'v3.reportProblem', 'v3.checkTicket'];

async function ecrituresEnvoyees(page: any) {
  return (await fetchLog(page)).filter((l) => ECRITURES.some((a) => l.url.indexOf('action=' + a) !== -1));
}

async function fileHorsLigne(page: any) {
  return await page.evaluate(async () => {
    const m = await import('/v3/offline.js');
    return (await m.pendingEntries()).length;
  });
}

async function voirFaiza(page: any) {
  await bootV3(page, ROUTES_MANAGER, { pinToken: 'jeton-manager', hash: '#/profile' });
  await expect(page.getByText("View a cleaner's day")).toBeVisible();
  await page.getByRole('button', { name: /Faiza/ }).click();
  await expect(page.locator('.viewas')).toContainText("Viewing Faiza's day · read only");
  // Le bandeau est deja la pendant le chargement : on attend la journee rendue.
  await expect(page.locator('.nextup .n')).toHaveText('623 Samana Park View');
}

test('Profile d un manager : le selecteur liste l equipe et ouvre la journee de la cleaner', async ({ page }) => {
  await bootV3(page, ROUTES_MANAGER, { pinToken: 'jeton-manager', hash: '#/profile' });
  await expect(page.getByText("View a cleaner's day")).toBeVisible();
  const lignes = page.locator('[data-act="viewas"]');
  await expect(lignes).toHaveCount(3);
  await expect(lignes.nth(0)).toContainText('Amina');
  await expect(lignes.nth(2)).toContainText('Faiza');
  // Journee du manager : aucun bandeau tant qu'il ne regarde personne.
  await expect(page.locator('.viewas')).toHaveCount(0);

  await page.getByRole('button', { name: /Faiza/ }).click();
  await expect(page).toHaveURL(/#\/today$/);
  await expect(page.locator('.viewas')).toContainText("Viewing Faiza's day · read only");
  await expect(page.locator('.drench .dr-top')).toContainText('Faiza');
  await expect(page.locator('.nextup .n')).toHaveText('623 Samana Park View');
  await expect(page.getByRole('button', { name: '704 Golf Links' })).toBeVisible();
  const myDays = (await fetchLog(page)).filter((l) => l.url.indexOf('action=v3.myDay') !== -1);
  expect(myDays[myDays.length - 1].url).toContain('&as=3');
  expect(await page.evaluate(() => sessionStorage.getItem('v3ViewAs'))).toContain('"3"');
});

test('le bandeau suit tous les ecrans, et Exit rend la journee du manager', async ({ page }) => {
  await voirFaiza(page);
  await page.getByRole('button', { name: 'View this cleaning' }).click();
  await expect(page.getByRole('heading', { name: '623 Samana Park View' })).toBeVisible();
  await expect(page.locator('.viewas')).toBeVisible();
  await page.evaluate(() => { location.hash = '#/profile'; });
  await expect(page.locator('.viewas')).toBeVisible();
  await expect(page.locator('[data-act="viewas"][aria-current="true"]')).toContainText('Faiza');

  await page.getByRole('button', { name: 'Exit' }).click();
  await expect(page).toHaveURL(/#\/today$/);
  await expect(page.locator('.viewas')).toHaveCount(0);
  await expect(page.locator('.drench .dr-top')).toContainText('Hillal');
  const myDays = (await fetchLog(page)).filter((l) => l.url.indexOf('action=v3.myDay') !== -1);
  expect(myDays[myDays.length - 1].url).not.toContain('as=');
  expect(await page.evaluate(() => sessionStorage.getItem('v3ViewAs'))).toBeNull();
});

test('en View as, le menage montre l avancement reel et aucun geste n ecrit', async ({ page }) => {
  await voirFaiza(page);
  // Today : Start visible mais inerte, meme force.
  const start = page.locator('.btn-start');
  await expect(start).toHaveText('Start this cleaning');
  await expect(start).toBeDisabled();
  await start.click({ force: true });
  await expect(page).toHaveURL(/#\/today$/);

  await page.getByRole('button', { name: 'View this cleaning' }).click();
  await expect(page.getByText('Checklist, 1 Bedroom')).toBeVisible();
  await expect(page.locator('.checkhead .pr').last()).toHaveText('1/3');
  const bain = page.getByRole('button', { name: 'Bathroom' });
  await expect(bain).toHaveAttribute('aria-pressed', 'true');
  await expect(bain).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Final Check' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Photo of the DEWA bill' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Report a problem' })).toBeDisabled();
  await expect(page.locator('.btn-finish')).toBeDisabled();
  // Aucun appareil photo actionnable.
  await expect(page.locator('[data-act="shoot"], [data-act="shoot-ticket"]')).toHaveCount(0);

  await page.getByRole('button', { name: 'Final Check' }).click({ force: true });
  await bain.click({ force: true });
  await page.locator('.btn-finish').click({ force: true });
  await page.getByRole('button', { name: 'Report a problem' }).click({ force: true });
  // Les cases n'ont pas bouge, aucune feuille ne s'est ouverte.
  await expect(bain).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: 'Final Check' })).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('#sheet-host [data-sheet]')).toHaveCount(0);

  // Meme si un geste passait le disabled (clic synthetique), la delegation
  // l'avale : rien ne part, rien n'entre en file.
  await page.evaluate(() => {
    const b = document.querySelector('[data-act="tick"]') as HTMLButtonElement;
    b.disabled = false;
    b.click();
  });
  await expect(page.locator('.toast', { hasText: 'Read only' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Master Bed & Linens' })).toHaveAttribute('aria-pressed', 'false');
  expect(await ecrituresEnvoyees(page)).toEqual([]);
  expect(await fileHorsLigne(page)).toBe(0);
  await expect(page.getByText('Saved on device', { exact: false })).toHaveCount(0);
});

test('le View as survit au rechargement de l onglet, et Sign out l efface', async ({ page }) => {
  await voirFaiza(page);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => (window as any).__v3ready === true, null, { timeout: 10_000 });
  await expect(page.locator('.viewas')).toContainText("Viewing Faiza's day · read only");
  await expect(page.locator('.nextup .n')).toHaveText('623 Samana Park View');

  await page.route((url) => url.pathname === '/', (route) => route.fulfill({
    status: 200, contentType: 'text/html', body: '<!doctype html><title>stub</title><p>stub</p>',
  }));
  await page.evaluate(() => { location.hash = '#/profile'; });
  await Promise.all([
    page.waitForURL(/#cleaner$/),
    page.getByRole('button', { name: 'Sign out' }).click(),
  ]);
  expect(await page.evaluate(() => sessionStorage.getItem('v3ViewAs'))).toBeNull();
});

test('une cible qui n est plus dans l equipe sort du View as sur la journee du manager', async ({ page }) => {
  await bootV3(page, [
    { match: 'action=v3.myDay&as=9', status: 400, body: { error: 'unknown team member' } },
    { match: 'action=v3.myDay', status: 200, body: JOUR_MANAGER },
  ], { pinToken: 'jeton-manager' });
  // Un onglet ou le mode avait ete choisi, puis la cleaner desactivee.
  await page.evaluate(() => sessionStorage.setItem('v3ViewAs', JSON.stringify({ id: '9', name: 'Old' })));
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => (window as any).__v3ready === true, null, { timeout: 10_000 });
  await expect(page.getByText('This view is no longer available')).toBeVisible();
  await expect(page.locator('.viewas')).toHaveCount(0);
  await expect(page.locator('.drench .dr-top')).toContainText('Hillal');
  expect(await page.evaluate(() => sessionStorage.getItem('v3ViewAs'))).toBeNull();
});

test('une cleaner ne voit ni selecteur ni bandeau, et ses gestes ecrivent toujours', async ({ page }) => {
  await bootV3(page, [
    { match: 'action=v3.myDay', status: 200, body: JOUR_CLEANER },
    { match: 'action=v3.startJob', status: 200, body: { status: 'success', startedAt: new Date().toISOString() } },
  ], { pinToken: 'jeton-pin', hash: '#/profile' });
  await expect(page.getByRole('heading', { name: 'Faiza' })).toBeVisible();
  await expect(page.getByText("View a cleaner's day")).toHaveCount(0);
  await expect(page.locator('.viewas')).toHaveCount(0);
  await page.evaluate(() => { location.hash = '#/today'; });
  await expect(page.locator('.viewas')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'View this cleaning' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Start this cleaning' }).click();
  await expect(page.getByRole('heading', { name: '623 Samana Park View' })).toBeVisible();
  expect((await fetchLog(page)).some((l) => l.url.indexOf('action=v3.startJob') !== -1)).toBe(true);
  expect((await fetchLog(page)).some((l) => l.url.indexOf('as=') !== -1)).toBe(false);
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

test('le bandeau est lisible sur Today et ne recouvre ni la barre du bas ni le contenu', async ({ page }) => {
  await voirFaiza(page);
  const mesure = await page.evaluate(() => {
    const rgb = (s: string) => (s.match(/\d+(\.\d+)?/g) || []).slice(0, 3).map(Number);
    const bar = document.querySelector('.viewas') as HTMLElement;
    const exit = bar.querySelector('button') as HTMLElement;
    const nav = document.querySelector('.cl-bar') as HTMLElement;
    const head = document.querySelector('.drench') as HTMLElement;
    const b = bar.getBoundingClientRect();
    const n = nav.getBoundingClientRect();
    const h = head.getBoundingClientRect();
    return {
      fond: rgb(getComputedStyle(bar).backgroundColor),
      texte: rgb(getComputedStyle(bar).color),
      exit: rgb(getComputedStyle(exit).color),
      position: getComputedStyle(bar).position,
      chevaucheNav: !(b.bottom <= n.top || b.top >= n.bottom),
      avantEnTete: b.bottom <= h.top + 0.5,
      exitHauteur: exit.getBoundingClientRect().height,
    };
  });
  expect(contraste(mesure.texte, mesure.fond)).toBeGreaterThanOrEqual(4.5);
  expect(contraste(mesure.exit, mesure.fond)).toBeGreaterThanOrEqual(4.5);
  expect(mesure.position).toBe('static');
  expect(mesure.chevaucheNav).toBe(false);
  expect(mesure.avantEnTete).toBe(true);
  expect(mesure.exitHauteur).toBeGreaterThanOrEqual(44);
  const { scrollWidth, clientWidth } = await noHorizontalScroll(page);
  expect(scrollWidth).toBe(clientWidth);
});
