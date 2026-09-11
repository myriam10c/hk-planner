import { test, expect } from '@playwright/test';

// L'ecran Settings > Team Members est rendu depuis l'etat global `cleaners`.
// On seede cet etat, on bouchonne api/apiWrite, et on verifie le rendu et le
// corps envoye par le bouton Invite.
//
// Deux ecarts par rapport au brief, imposes par le code reel :
//  1. `cleaners`, `templates` et `currentTab` sont declares en `let` de premier
//     niveau dans app.js. Ce sont des bindings lexicaux globaux, pas des
//     proprietes de window : `window.cleaners = ...` cree une propriete que
//     renderSettings() ne lit jamais. On passe donc par un eval indirect
//     (window.eval), qui s'execute dans la portee globale et voit ces bindings.
//     Les fonctions (`api`, `apiWrite`, `fetchAll`) sont, elles, de vraies
//     globales : l'affectation directe suffit.
//  2. Depuis la tache 6, l'app ouvre sur l'ecran de connexion quand l'appareil
//     n'a aucune session. On pose un jeton PIN dans localStorage avant le
//     chargement de la page pour retrouver la vue manager.
//
// Boucle locale rapide :
//   python3 -m http.server 8892
//   HK_PLANNER_URL=http://localhost:8892 npx playwright test tests/team-invite.spec.ts --project=desktop

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    // Une session PIN suffit pour passer la porte de connexion posee par la
    // tache 6 (deverrouillage rapide, ruling Q3).
    try { localStorage.setItem('cleanerToken', 'pin-session-test'); } catch (e) { /* pas de storage */ }
    // Rien ne doit sortir vers le proxy de prod : le chargement initial
    // (hkAuthBoot puis fetchAll) partirait en reseau avec un faux jeton, et sa
    // reponse repeindrait l'ecran au milieu du test en effacant le formulaire.
    // Les requetes vers le proxy restent donc en attente pour toujours ; les
    // requetes same-origin (les fichiers de l'app) passent normalement.
    const real = window.fetch.bind(window);
    window.fetch = ((input: any, init: any) => {
      const url = typeof input === 'string' ? input : (input && input.url) || '';
      if (url.indexOf(location.origin) === 0 || url.charAt(0) === '/') return real(input, init);
      return new Promise(() => { /* jamais resolue */ });
    }) as any;
  });
});

async function openTeamScreen(page: any) {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof (window as any).renderSettings === 'function', null, { timeout: 10_000 });
  await page.evaluate(() => {
    const w = window as any;
    w.__inviteCalls = [];  // ce qui passe par apiWrite (action inviteCleaner)
    w.__apiCalls = [];     // ce qui passe par api (saveCleaner, getCleaners)
    w.__seed = {
      cleaners: [
        { id: 8, name: 'Walter', role: 'manager', color: '#e94560', phone: '', email: 'walter@example.com' },
        { id: 4, name: 'Faiza', role: 'cleaner', color: '#4caf50', phone: '', email: null },
        { id: 11, name: 'Medini CEO Agent', role: 'system', color: '#333333', phone: '', email: null },
      ],
    };
    w.eval('cleaners = window.__seed.cleaners; templates = []; currentTab = "settings";');
    w.api = async (action: string, opts: any) => {
      w.__apiCalls.push({ action, body: opts && opts.body });
      if (action === 'getCleaners') return { status: 'success', cleaners: w.__seed.cleaners };
      return { status: 'success' };
    };
    w.apiWrite = async (action: string, opts: any) => {
      w.__inviteCalls.push({ action, body: opts && opts.body });
      return { status: 'success', id: 4, mode: 'invite' };
    };
    w.fetchAll = () => {};
    w.renderSettings();
  });
}

test('chaque membre a un champ email et un bouton Invite', async ({ page }) => {
  await openTeamScreen(page);
  await expect(page.locator('#cleanerEmail-8')).toHaveValue('walter@example.com');
  await expect(page.locator('#cleanerEmail-4')).toHaveValue('');
  await expect(page.locator('[data-action="inviteCleaner"][data-arg0="8"]')).toBeVisible();
  await expect(page.locator('[data-action="inviteCleaner"][data-arg0="4"]')).toBeVisible();
  // Mobile-first : le champ email et les deux boutons du formulaire ne doivent
  // pas faire deborder l'ecran Settings (projet mobile = iPhone 13, 390 px).
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});

test('le bouton Invite envoie l email saisi au proxy', async ({ page }) => {
  await openTeamScreen(page);
  await page.fill('#cleanerEmail-4', '  Faiza@Example.COM ');
  await page.click('[data-action="inviteCleaner"][data-arg0="4"]');
  const calls = await page.evaluate(() => (window as any).__inviteCalls);
  expect(calls).toHaveLength(1);
  expect(calls[0].action).toBe('inviteCleaner');
  expect(calls[0].body).toMatchObject({ id: 4, email: 'faiza@example.com', name: 'Faiza', role: 'cleaner' });
});

test('Invite sans email ne part pas', async ({ page }) => {
  await openTeamScreen(page);
  await page.click('[data-action="inviteCleaner"][data-arg0="4"]');
  const calls = await page.evaluate(() => (window as any).__inviteCalls);
  expect(calls).toHaveLength(0);
  await expect(page.locator('.toast, .toast-item')).toContainText('email');
});

test('le formulaire d ajout envoie une invitation', async ({ page }) => {
  await openTeamScreen(page);
  await page.fill('#newName', 'Pionah');
  await page.fill('#newEmail', 'Pionah@Example.com');
  await page.selectOption('#newRole', 'cleaner');
  await page.click('[data-action="__inviteNewCleanerFromForm"]');
  const calls = await page.evaluate(() => (window as any).__inviteCalls);
  expect(calls).toHaveLength(1);
  expect(calls[0].body).toMatchObject({ name: 'Pionah', email: 'pionah@example.com', role: 'cleaner' });
  expect(calls[0].body.id).toBeUndefined();
});

// === Correctifs de la revue ===

test('vider le champ email d un membre qui en a un n envoie rien', async ({ page }) => {
  await openTeamScreen(page);
  await page.fill('#cleanerEmail-8', '');
  await page.click('[data-action="inviteCleaner"][data-arg0="8"]');
  const calls = await page.evaluate(() => (window as any).__inviteCalls);
  expect(calls).toHaveLength(0);
  await expect(page.locator('.toast, .toast-item')).toContainText('email');
});

test('changer l adresse d un membre demande confirmation et part si elle est donnee', async ({ page }) => {
  await openTeamScreen(page);
  const messages: string[] = [];
  page.on('dialog', (d: any) => { messages.push(d.message()); d.accept(); });
  await page.fill('#cleanerEmail-8', 'walter.new@example.com');
  await page.click('[data-action="inviteCleaner"][data-arg0="8"]');
  const calls = await page.evaluate(() => (window as any).__inviteCalls);
  expect(calls).toHaveLength(1);
  expect(calls[0].body).toMatchObject({ id: 8, email: 'walter.new@example.com' });
  expect(messages).toHaveLength(1);
  expect(messages[0]).toContain('walter@example.com');
  expect(messages[0]).toContain('walter.new@example.com');
});

test('changer l adresse d un membre n envoie rien si la confirmation est refusee', async ({ page }) => {
  await openTeamScreen(page);
  page.on('dialog', (d: any) => d.dismiss());
  await page.fill('#cleanerEmail-8', 'walter.new@example.com');
  await page.click('[data-action="inviteCleaner"][data-arg0="8"]');
  const calls = await page.evaluate(() => (window as any).__inviteCalls);
  expect(calls).toHaveLength(0);
});

test('la meme adresse ne declenche aucune confirmation', async ({ page }) => {
  await openTeamScreen(page);
  const messages: string[] = [];
  page.on('dialog', (d: any) => { messages.push(d.message()); d.accept(); });
  await page.click('[data-action="inviteCleaner"][data-arg0="8"]');
  const calls = await page.evaluate(() => (window as any).__inviteCalls);
  expect(calls).toHaveLength(1);
  expect(messages).toHaveLength(0);
});

test('Add & invite garde le PIN saisi', async ({ page }) => {
  await openTeamScreen(page);
  await page.fill('#newName', 'Pionah');
  await page.fill('#newEmail', 'pionah@example.com');
  await page.fill('#newPin', '4321');
  await page.selectOption('#newRole', 'cleaner');
  await page.click('[data-action="__inviteNewCleanerFromForm"]');
  const invites = await page.evaluate(() => (window as any).__inviteCalls);
  expect(invites).toHaveLength(1);
  const saves = await page.evaluate(() => (window as any).__apiCalls.filter((c: any) => c.action === 'saveCleaner'));
  expect(saves).toHaveLength(1);
  // Une seule ligne : saveCleaner met a jour celle que inviteCleaner a creee.
  expect(saves[0].body).toMatchObject({ id: 4, name: 'Pionah', pin: '4321', role: 'cleaner' });
});

test('Add (PIN only) refuse un email saisi au lieu de l ignorer', async ({ page }) => {
  await openTeamScreen(page);
  await page.fill('#newName', 'Pionah');
  await page.fill('#newEmail', 'pionah@example.com');
  await page.fill('#newPin', '4321');
  await page.click('[data-action="__saveCleanerFromForm"]');
  const invites = await page.evaluate(() => (window as any).__inviteCalls);
  const apiCalls = await page.evaluate(() => (window as any).__apiCalls);
  expect(invites).toHaveLength(0);
  expect(apiCalls).toHaveLength(0);
  await expect(page.locator('.toast, .toast-item')).toContainText('Add & invite');
});

test('la ligne system n a ni email ni bouton ni selecteur de role', async ({ page }) => {
  await openTeamScreen(page);
  await expect(page.locator('#cleanerEmail-11')).toHaveCount(0);
  await expect(page.locator('[data-action="inviteCleaner"][data-arg0="11"]')).toHaveCount(0);
  await expect(page.locator('[data-action-change="__cleanerRoleChange"][data-arg0="11"]')).toHaveCount(0);
  // Les autres lignes gardent bien leur selecteur.
  await expect(page.locator('[data-action-change="__cleanerRoleChange"][data-arg0="4"]')).toHaveCount(1);
});

test('Add & invite dit que seul le PIN a echoue quand saveCleaner refuse', async ({ page }) => {
  await openTeamScreen(page);
  await page.evaluate(() => {
    const w = window as any;
    w.api = async (action: string, opts: any) => {
      w.__apiCalls.push({ action, body: opts && opts.body });
      if (action === 'saveCleaner') return { error: 'Manager access required.' };
      if (action === 'getCleaners') return { status: 'success', cleaners: w.__seed.cleaners };
      return { status: 'success' };
    };
  });
  await page.fill('#newName', 'Pionah');
  await page.fill('#newEmail', 'pionah@example.com');
  await page.fill('#newPin', '4321');
  await page.selectOption('#newRole', 'cleaner');
  await page.click('[data-action="__inviteNewCleanerFromForm"]');
  // Le membre a bien ete cree : l'invitation est partie, seul le PIN manque.
  const invites = await page.evaluate(() => (window as any).__inviteCalls);
  expect(invites).toHaveLength(1);
  await expect(page.locator('#toastStack')).toContainText('Member created, but PIN was not saved: Manager access required.');
});

test('Add & invite dit que seul le PIN a echoue quand le reseau tombe', async ({ page }) => {
  await openTeamScreen(page);
  await page.evaluate(() => {
    const w = window as any;
    w.api = async (action: string, opts: any) => {
      w.__apiCalls.push({ action, body: opts && opts.body });
      if (action === 'saveCleaner') throw new Error('Network error');
      if (action === 'getCleaners') return { status: 'success', cleaners: w.__seed.cleaners };
      return { status: 'success' };
    };
  });
  await page.fill('#newName', 'Pionah');
  await page.fill('#newEmail', 'pionah@example.com');
  await page.fill('#newPin', '4321');
  await page.click('[data-action="__inviteNewCleanerFromForm"]');
  await expect(page.locator('#toastStack')).toContainText('Member created, but PIN was not saved: Network error');
});
