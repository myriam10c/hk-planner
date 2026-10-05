import { expect, test } from '@playwright/test';
import { bootV3, fetchLog, noHorizontalScroll } from './helpers';

// Mode « View as » (plan 2026-10-02) : un manager choisit une cleaner dans
// Profile et voit sa vraie journee, en lecture seule.
//
// Depuis le portage de l'interface conversation (tache 4 du plan 2026-10-05),
// la journee est la liste du prototype : le nom de la personne est dans
// l'en-tete « Hi <nom> » (.list-top b), les menages dans les lignes (.row-name).
// Tache 6 : la conversation de la cleaner s'ouvre en lecture seule, reconstruite
// depuis v3.myDay (pas commence, demarre a telle heure, fini, binome, tickets du
// logement). Aucune reponse, aucune camera, aucune ecriture ni sauvegarde.
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

const ECRITURES = [
  'v3.startJob', 'v3.tick', 'v3.uploadPhoto', 'v3.finishJob', 'v3.reportProblem', 'v3.checkTicket',
  'v3.addProblemPhoto', 'v3.setProblemNote', 'v3.updateProblem', 'v3.deleteProblem', 'v3.deletePhoto',
];

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
  await expect(page.getByText('Try the cleaner app')).toBeVisible();
  await page.getByRole('button', { name: "View Faiza's day" }).click();
  await expect(page.locator('.viewas')).toContainText("Viewing Faiza's day · read only");
  // Le bandeau est deja la pendant le chargement : on attend la journee rendue.
  await expect(page.locator('.row-name').first()).toHaveText('623 Samana Park View');
}

test('Profile d un manager : le selecteur liste l equipe et ouvre la journee de la cleaner', async ({ page }) => {
  await bootV3(page, ROUTES_MANAGER, { pinToken: 'jeton-manager', hash: '#/profile' });
  await expect(page.getByText('Try the cleaner app')).toBeVisible();
  const lignes = page.locator('[data-act="viewas"]');
  await expect(lignes).toHaveCount(3);
  await expect(lignes.nth(0)).toHaveAttribute('data-name', 'Amina');
  await expect(lignes.nth(2)).toHaveAttribute('data-name', 'Faiza');
  // Journee du manager : aucun bandeau tant qu'il ne regarde personne.
  await expect(page.locator('.viewas')).toHaveCount(0);

  await page.getByRole('button', { name: "View Faiza's day" }).click();
  await expect(page).toHaveURL(/#\/today$/);
  await expect(page.locator('.viewas')).toContainText("Viewing Faiza's day · read only");
  await expect(page.locator('.list-top b')).toContainText('Faiza');
  await expect(page.locator('.row-name').first()).toHaveText('623 Samana Park View');
  await expect(page.getByRole('button', { name: /704 Golf Links/ })).toBeVisible();
  const myDays = (await fetchLog(page)).filter((l) => l.url.indexOf('action=v3.myDay') !== -1);
  expect(myDays[myDays.length - 1].url).toContain('&as=3');
  expect(await page.evaluate(() => sessionStorage.getItem('v3ViewAs'))).toContain('"3"');
});

test('le bandeau suit tous les ecrans, et Exit rend la journee du manager', async ({ page }) => {
  await voirFaiza(page);
  await page.getByRole('button', { name: /623 Samana Park View/ }).click();
  await expect(page.locator('.top .title b')).toHaveText('623 Samana Park View');
  await expect(page.locator('.viewas')).toBeVisible();
  await page.getByRole('button', { name: 'Back' }).click();
  await page.evaluate(() => { location.hash = '#/profile'; });
  await expect(page.locator('.viewas')).toBeVisible();
  await expect(page.locator('[data-act="viewas"][aria-current="true"]')).toHaveAttribute('data-name', 'Faiza');

  await page.getByRole('button', { name: 'Exit' }).click();
  await expect(page).toHaveURL(/#\/today$/);
  await expect(page.locator('.viewas')).toHaveCount(0);
  await expect(page.locator('.list-top b')).toContainText('Hillal');
  const myDays = (await fetchLog(page)).filter((l) => l.url.indexOf('action=v3.myDay') !== -1);
  expect(myDays[myDays.length - 1].url).not.toContain('as=');
  expect(await page.evaluate(() => sessionStorage.getItem('v3ViewAs'))).toBeNull();
});

// Camera et partage observes : en View as, ni l'un ni l'autre ne doit s'ouvrir.
async function observer(page: any) {
  await page.addInitScript(() => {
    (window as any).__gum = 0;
    if (navigator.mediaDevices) {
      navigator.mediaDevices.getUserMedia = async () => {
        (window as any).__gum += 1;
        throw new DOMException('denied', 'NotAllowedError');
      };
    }
    (window as any).__shared = 0;
    (navigator as any).share = async () => { (window as any).__shared += 1; };
    (navigator as any).canShare = () => true;
  });
}

// Tout ce qu'un geste aurait pu laisser : file, magasin mort, conversations et photos gardees.
async function traces(page: any) {
  return await page.evaluate(async () => {
    const m = await import('/v3/offline.js');
    const fichiers = await new Promise<number>((res) => {
      const r = indexedDB.open('hk-v3');
      r.onsuccess = () => {
        const db = r.result;
        if (!db.objectStoreNames.contains('files')) { db.close(); res(0); return; }
        const c = db.transaction('files').objectStore('files').count();
        c.onsuccess = () => { db.close(); res(c.result); };
      };
    });
    return {
      file: (await m.pendingEntries()).length, morts: (await m.deadEntries()).length, fichiers,
      convs: sessionStorage.getItem('v3Convs'), convsIdb: await m.getState('v3Convs'),
      practice: sessionStorage.getItem('v3PracticeConvs'),
      camera: (window as any).__gum, partage: (window as any).__shared,
    };
  });
}
const PROPRE = { file: 0, morts: 0, fichiers: 0, convs: null, convsIdb: null, practice: null, camera: 0, partage: 0 };

test('en View as, la conversation est en lecture seule : aucun bouton n ecrit, aucune camera', async ({ page }) => {
  await observer(page);
  await voirFaiza(page);
  await page.getByRole('button', { name: /623 Samana Park View/ }).click();
  await expect(page.locator('.top .title b')).toHaveText('623 Samana Park View');
  await expect(page.locator('.top .title span')).toHaveText('Read only · Not started yet');
  await expect(page.getByText('Open problems here: Photo of the DEWA bill.')).toBeVisible();
  await expect(page.getByText('Read only. Only Faiza can answer here.')).toBeVisible();
  // Aucune reponse, aucun outil : la cleaner seule avance sa conversation.
  await expect(page.locator('[data-reply], [data-act="camera"], [data-act="problem"], [data-act="shutter"]')).toHaveCount(0);
  await expect(page.locator('.vf')).toHaveCount(0);

  // Meme des boutons forges (ancienne page restee ouverte, double appui) ne font rien :
  // chaque geste de la conversation est ignore en lecture seule.
  await page.evaluate(() => {
    const gestes = [
      ['data-reply', 'here'], ['data-reply', 'cant-get-in'], ['data-act', 'camera'], ['data-act', 'shutter'],
      ['data-act', 'problem'], ['data-kind', 'Leak'], ['data-flow', 'no-photo'], ['data-reply', 'send'],
      ['data-act', 'edit'], ['data-act', 'delete'], ['data-urgency', 'urgent'],
    ];
    for (const [k, v] of gestes) {
      const b = document.createElement('button');
      b.setAttribute(k, v);
      if (k === 'data-act' && (v === 'edit' || v === 'delete')) b.setAttribute('data-index', '0');
      document.getElementById('view')!.appendChild(b);
      b.click();
    }
  });
  await page.waitForTimeout(600);
  await expect(page.locator('.top .title span')).toHaveText('Read only · Not started yet');
  await expect(page.locator('.vf')).toHaveCount(0);
  await expect(page.locator('.msg.me')).toHaveCount(0);
  const vue = await page.evaluate(() => {
    const c = (window as any).__hk.convs['job_aaaaaaaaaaaaaaaaaaaa'];
    return { readOnly: c.readOnly, startedAt: c.startedAt, problems: c.problems.length, sync: c.sync || null };
  });
  expect(vue).toEqual({ readOnly: true, startedAt: null, problems: 0, sync: null });
  // Au niveau du reseau et du stockage : rien n'est parti, rien n'est garde.
  expect(await ecrituresEnvoyees(page)).toEqual([]);
  expect(await traces(page)).toEqual(PROPRE);
  await expect(page.getByText('Saved on device', { exact: false })).toHaveCount(0);

  // Exit depuis la conversation : rien ne reste, la journee du manager revient.
  await page.getByRole('button', { name: 'Exit' }).click();
  await expect(page.locator('.list-top b')).toContainText('Hillal');
  expect(await page.evaluate(() => Object.keys((window as any).__hk.convs).length)).toBe(0);
  expect(await traces(page)).toEqual(PROPRE);
  expect(await page.evaluate(() => sessionStorage.getItem('v3ViewAs'))).toBeNull();
});

test('en View as, un menage en cours ou fini se lit depuis la journee du serveur', async ({ page }) => {
  const enCours = { ...STOP_FAIZA, state: 'running', startedAt: '2026-09-12T06:05:00Z', role: 'helper', leadId: 7,
    othersOnJob: [{ id: 7, name: 'Pionah', startedAt: '2026-09-12T06:00:00Z' }] };
  const fini = { ...STOP_FAIZA_2, state: 'done', startedAt: '2026-09-12T04:00:00Z' };
  await observer(page);
  await bootV3(page, [
    { match: 'action=v3.myDay&as=3', status: 200, body: { ...JOUR_FAIZA, stops: [enCours, fini] } },
    ...ROUTES_MANAGER.slice(1),
  ], { pinToken: 'jeton-manager', hash: '#/profile' });
  await page.getByRole('button', { name: "View Faiza's day" }).click();
  await expect(page.getByRole('button', { name: /623 Samana Park View/ }).locator('.row-sub')).toContainText('Started');
  await expect(page.getByRole('button', { name: /704 Golf Links/ }).locator('.row-sub')).toHaveText('Cleaning done');

  await page.getByRole('button', { name: /623 Samana Park View/ }).click();
  await expect(page.locator('.top .title span')).toHaveText('Read only · Started 10:05');
  await expect(page.getByText('Pionah started at 10:00 and sends the report.')).toBeVisible();
  await expect(page.getByText('Add your photos', { exact: false })).toHaveCount(0);
  await expect(page.getByText('Started at 10:05.')).toBeVisible();
  await expect(page.locator('[data-reply], [data-act="problem"], [data-act="shutter"]')).toHaveCount(0);
  await page.getByRole('button', { name: 'Back' }).click();
  // Une conversation ouverte en lecture seule ne verrouille pas les autres menages.
  await expect(page.getByRole('button', { name: /704 Golf Links/ })).toBeEnabled();
  await page.getByRole('button', { name: /704 Golf Links/ }).click();
  await expect(page.locator('.top .title span')).toHaveText('Read only · Cleaning done');
  await expect(page.getByText('Cleaning done.')).toBeVisible();
  expect(await ecrituresEnvoyees(page)).toEqual([]);
  expect(await traces(page)).toEqual(PROPRE);
});

test('le View as survit au rechargement de l onglet, et Sign out l efface', async ({ page }) => {
  await voirFaiza(page);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => (window as any).__v3ready === true, null, { timeout: 10_000 });
  await expect(page.locator('.viewas')).toContainText("Viewing Faiza's day · read only");
  await expect(page.locator('.row-name').first()).toHaveText('623 Samana Park View');

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
    { match: 'action=v3.myDay&as=4', status: 400, body: { error: 'unknown team member' } },
    { match: 'action=v3.myDay', status: 200, body: JOUR_MANAGER },
  ], { pinToken: 'jeton-manager', hash: '#/profile' });
  // Amina a ete desactivee entre le chargement de la liste et l'appui.
  await page.getByRole('button', { name: "View Amina's day" }).click();
  await expect(page.getByText('This view is no longer available')).toBeVisible();
  await expect(page.locator('.viewas')).toHaveCount(0);
  await expect(page.locator('.list-top b')).toContainText('Hillal');
  expect(await page.evaluate(() => sessionStorage.getItem('v3ViewAs'))).toBeNull();
});

test('un mode relu au demarrage et refuse sort en silence, sans bandeau', async ({ page }) => {
  await bootV3(page, [
    { match: 'action=v3.myDay&as=9', status: 400, body: { error: 'unknown team member' }, delay: 2000 },
    { match: 'action=v3.myDay', status: 200, body: JOUR_MANAGER },
  ], { pinToken: 'jeton-manager' });
  await page.evaluate(() => sessionStorage.setItem('v3ViewAs',
    JSON.stringify({ id: '9', name: 'Old', viewerId: '1' })));
  await page.reload({ waitUntil: 'domcontentloaded' });
  // Pendant le chargement : pas encore confirme, donc pas de bandeau.
  await expect(page.getByText('Loading your day.')).toBeVisible();
  await expect(page.locator('.viewas')).toHaveCount(0);
  await expect(page.locator('.list-top b')).toContainText('Hillal');
  await expect(page.locator('.viewas')).toHaveCount(0);
  await expect(page.getByText('This view is no longer available')).toHaveCount(0);
  expect(await page.evaluate(() => sessionStorage.getItem('v3ViewAs'))).toBeNull();
});

// Revue tache 1, constat 1 : une reponse de v3.myDay arrivee en retard ne doit
// jamais ecraser l'etat apres un Exit ou un changement de personne.
const JOUR_AMINA = {
  ...JOUR_FAIZA, me: { id: 4, name: 'Amina', role: 'cleaner' }, totalMinutes: 94, stops: [STOP_FAIZA_2],
};

test('Exit pendant un chargement lent : la reponse en retard est ignoree', async ({ page }) => {
  await bootV3(page, [
    { match: 'action=v3.myDay&as=3', status: 200, body: JOUR_FAIZA, delay: 1500 },
    { match: 'action=v3.myDay', status: 200, body: JOUR_MANAGER },
  ], { pinToken: 'jeton-manager', hash: '#/profile' });
  await page.getByRole('button', { name: "View Faiza's day" }).click();
  await expect(page.getByText('Loading your day.')).toBeVisible();
  await page.getByRole('button', { name: 'Exit' }).click();
  await expect(page.locator('.list-top b')).toContainText('Hillal');
  // La reponse de Faiza arrive maintenant : rien ne doit bouger.
  await page.waitForTimeout(2000);
  await expect(page.locator('.list-top b')).toContainText('Hillal');
  await expect(page.locator('.viewas')).toHaveCount(0);
  await expect(page.locator('.row')).toHaveCount(0);
  expect(await page.evaluate(() => sessionStorage.getItem('v3ViewAs'))).toBeNull();
});

test('Exit pendant un chargement lent : une erreur en retard n ecrase pas la journee', async ({ page }) => {
  await bootV3(page, [
    { match: 'action=v3.myDay&as=4', status: 400, body: { error: 'unknown team member' }, delay: 1500 },
    { match: 'action=v3.myDay', status: 200, body: JOUR_MANAGER },
  ], { pinToken: 'jeton-manager', hash: '#/profile' });
  await page.getByRole('button', { name: "View Amina's day" }).click();
  await page.getByRole('button', { name: 'Exit' }).click();
  await expect(page.locator('.list-top b')).toContainText('Hillal');
  await page.waitForTimeout(2000);
  await expect(page.locator('.list-top b')).toContainText('Hillal');
  await expect(page.getByText('unknown team member')).toHaveCount(0);
  await expect(page.getByText('This view is no longer available')).toHaveCount(0);
});

test('changement de personne pendant un chargement lent : seule la derniere demande s affiche', async ({ page }) => {
  await bootV3(page, [
    { match: 'action=v3.myDay&as=3', status: 200, body: JOUR_FAIZA, delay: 2500 },
    { match: 'action=v3.myDay&as=4', status: 200, body: JOUR_AMINA },
    { match: 'action=v3.myDay', status: 200, body: JOUR_MANAGER },
  ], { pinToken: 'jeton-manager', hash: '#/profile' });
  // Par l'interface : Faiza (lente), Exit, Profile, Amina, avant le retour de Faiza.
  await page.getByRole('button', { name: "View Faiza's day" }).click();
  await page.getByRole('button', { name: 'Exit' }).click();
  await expect(page.locator('.list-top b')).toContainText('Hillal');
  await page.evaluate(() => { location.hash = '#/profile'; });
  await page.getByRole('button', { name: "View Amina's day" }).click();
  await expect(page.locator('.viewas')).toContainText("Viewing Amina's day · read only");
  await expect(page.locator('.row-name').first()).toHaveText('704 Golf Links');
  await page.waitForTimeout(2500);
  await expect(page.locator('.viewas')).toContainText("Viewing Amina's day · read only");
  await expect(page.locator('.list-top b')).toContainText('Amina');
  await expect(page.locator('.row-name').first()).toHaveText('704 Golf Links');
});

test('changement direct de personne pendant le chargement : la reponse de la premiere est jetee', async ({ page }) => {
  await bootV3(page, [
    { match: 'action=v3.myDay&as=3', status: 200, body: JOUR_FAIZA, delay: 1500 },
    { match: 'action=v3.myDay&as=4', status: 200, body: JOUR_AMINA, delay: 300 },
    { match: 'action=v3.myDay', status: 200, body: JOUR_MANAGER },
  ], { pinToken: 'jeton-manager', hash: '#/profile' });
  await page.getByRole('button', { name: "View Faiza's day" }).click();
  // L'ecran de chargement ne montre pas le selecteur : on passe par le module,
  // comme le ferait un second appui servi par un ecran deja dessine.
  await page.evaluate(async () => {
    const m = await import('/v3/app.js');
    m.startViewAs({ id: 4, name: 'Amina' });
  });
  await expect(page.locator('.row-name').first()).toHaveText('704 Golf Links');
  await page.waitForTimeout(1800);
  await expect(page.locator('.viewas')).toContainText("Viewing Amina's day · read only");
  await expect(page.locator('.row-name').first()).toHaveText('704 Golf Links');
});

// Revue tache 1, constat 2 : le mode appartient a la personne qui l'a choisi.
test('une cleaner connectee dans la meme fenetre n herite pas du View as', async ({ page }) => {
  await bootV3(page, [
    { match: 'as=', status: 200, body: JOUR_AMINA },
    { match: 'action=v3.myDay', status: 200, body: JOUR_CLEANER, delay: 2000 },
  ], { pinToken: 'jeton-pin' });
  await page.evaluate(() => {
    sessionStorage.setItem('v3ViewAs', JSON.stringify({ id: '4', name: 'Amina', viewerId: '1' }));
    localStorage.setItem('hkSessionCleanerId', '3');
  });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.getByText('Loading your day.')).toBeVisible();
  await expect(page.locator('.viewas')).toHaveCount(0);
  await expect(page.locator('.list-top b')).toContainText('Faiza');
  await expect(page.locator('.viewas')).toHaveCount(0);
  await expect(page.locator('.row').first()).toBeEnabled();
  expect((await fetchLog(page)).some((l) => l.url.indexOf('as=') !== -1)).toBe(false);
  expect(await page.evaluate(() => sessionStorage.getItem('v3ViewAs'))).toBeNull();
});

test('un autre manager, identite inconnue de l appareil : la reponse le trahit et le mode tombe', async ({ page }) => {
  const JOUR_ISMAEL = { ...JOUR_MANAGER, me: { id: 5, name: 'Ismael', role: 'manager' } };
  await bootV3(page, [
    { match: 'action=v3.myDay&as=3', status: 200, delay: 600,
      body: { ...JOUR_FAIZA, viewer: { id: 5, name: 'Ismael' } } },
    { match: 'action=v3.myDay', status: 200, body: JOUR_ISMAEL },
  ], { pinToken: 'jeton-ismael' });
  await page.evaluate(() => sessionStorage.setItem('v3ViewAs',
    JSON.stringify({ id: '3', name: 'Faiza', viewerId: '1' })));
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.locator('.viewas')).toHaveCount(0);
  await expect(page.locator('.list-top b')).toContainText('Ismael');
  await expect(page.locator('.viewas')).toHaveCount(0);
  await expect(page.getByText('This view is no longer available')).toHaveCount(0);
  expect(await page.evaluate(() => sessionStorage.getItem('v3ViewAs'))).toBeNull();
});

test('une session perdue emporte le View as', async ({ page }) => {
  await voirFaiza(page);
  expect(await page.evaluate(() => sessionStorage.getItem('v3ViewAs'))).toContain('"viewerId":"1"');
  // Le proxy ne reconnait plus la session : 401 « auth required ».
  await page.evaluate(async () => {
    window.fetch = (() => Promise.resolve(new Response(JSON.stringify({ error: 'auth required' }),
      { status: 401, headers: { 'Content-Type': 'application/json' } }))) as any;
    const m = await import('/v3/app.js');
    await m.loadDay();
  });
  await expect(page.getByRole('link', { name: 'Sign in' })).toBeVisible();
  expect(await page.evaluate(() => sessionStorage.getItem('v3ViewAs'))).toBeNull();
});

test('une cleaner ne voit ni selecteur ni bandeau, et sa journee part sans as=', async ({ page }) => {
  await bootV3(page, [
    { match: 'action=v3.myDay', status: 200, body: JOUR_CLEANER },
    { match: 'action=v3.startJob', status: 200, body: { status: 'success', startedAt: new Date().toISOString() } },
  ], { pinToken: 'jeton-pin', hash: '#/profile' });
  await expect(page.getByRole('heading', { name: 'Faiza' })).toBeVisible();
  await expect(page.getByText('Try the cleaner app')).toHaveCount(0);
  await expect(page.locator('.viewas')).toHaveCount(0);
  await page.evaluate(() => { location.hash = '#/today'; });
  await expect(page.locator('.viewas')).toHaveCount(0);
  await page.getByRole('button', { name: /623 Samana Park View/ }).click();
  await expect(page.locator('.top .title b')).toHaveText('623 Samana Park View');
  // Les ecritures (startJob et suivantes) sont branchees a la tache 5.
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

test('le bandeau est lisible sur la liste et ne recouvre ni l en-tete ni les menages', async ({ page }) => {
  await voirFaiza(page);
  const mesure = await page.evaluate(() => {
    const rgb = (s: string) => (s.match(/\d+(\.\d+)?/g) || []).slice(0, 3).map(Number);
    const bar = document.querySelector('.viewas') as HTMLElement;
    const exit = bar.querySelector('button') as HTMLElement;
    const row = document.querySelector('.row') as HTMLElement;
    const head = document.querySelector('.list-top') as HTMLElement;
    const b = bar.getBoundingClientRect();
    const n = row.getBoundingClientRect();
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
