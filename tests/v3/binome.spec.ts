import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { BLOOM, DAY, WRITE_ROUTES, carteAcces, demarrer, ecritures, fileVide, piece } from './conv-helpers';
import { fetchLog, liberer } from './helpers';

// Binome (lot 1 des corrections, tache 3) : deux cleaners ouvrent le meme appartement avant
// qu'aucune n'ait touche « I'm here ». La premiere qui demarre fait le rapport ; la seconde
// passe en aide, sans perdre ce qu'elle avait saisi. L'ouverture n'attend jamais le reseau
// (correction 1) : la conversation s'ouvre avec la journee en memoire, et seul un binome
// relit la journee, en arriere-plan.

const PIONAH = { id: 7, name: 'Pionah', startedAt: '2026-10-02T06:30:00Z' };
// Pionah est affectee au meme menage et n'a pas encore demarre.
const BLOOM_BINOME = { ...BLOOM, othersOnJob: [{ id: 7, name: 'Pionah', startedAt: null }] };
// Journee relue apres le demarrage de Pionah : le serveur dit « aide ».
const BLOOM_AIDE = {
  ...BLOOM, state: 'running', startedAt: PIONAH.startedAt, role: 'helper', leadId: 7,
  othersOnJob: [PIONAH],
};
const JOUR_SEUL = { ...DAY, stops: [BLOOM] };
const JOUR_BINOME = { ...DAY, stops: [BLOOM_BINOME] };
const JOUR_AIDE = { ...DAY, stops: [BLOOM_AIDE] };
// Reponse de v3.startJob quand Pionah a touche « I'm here » juste avant.
const DEMARRAGE_AIDE = { status: 'success', jobId: BLOOM.jobId, startedAt: PIONAH.startedAt, role: 'helper', lead: PIONAH };
const NOTE = "1011C Bloom Towers: Pionah started first. You add your photos and problems to her report.";

const sansJournee = WRITE_ROUTES.filter((r) => r.match !== 'action=v3.myDay');
const sansDemarrage = sansJournee.filter((r) => r.match !== 'action=v3.startJob');
const ouvrir = (page: Page) => page.getByRole('button', { name: /1011C Bloom Towers/ }).click();
const nbMyDay = async (page: Page) => (await fetchLog(page)).filter((e) => e.url.indexOf('action=v3.myDay') !== -1).length;
const essaisDemarrage = async (page: Page) => (await fetchLog(page)).filter((e) => e.url.indexOf('action=v3.startJob') !== -1).length;
// Heure de la derniere journee lue : elle change quand une relecture a abouti.
const derniereLecture = (page: Page) => page.evaluate(() => (window as any).__hk.lastRead && (window as any).__hk.lastRead.at);
const roleActif = (page: Page) => page.evaluate(() => {
  const h = (window as any).__hk;
  const a = h.convs[h.activeId].apt;
  return { role: a.role, lead: a.lead ? a.lead.name : null };
});
// Avertissements de la file ([v3] onSent) et erreurs de la page : un rendu qui plante fige l'ecran.
function surveiller(page: Page) {
  const alertes: string[] = [];
  page.on('console', (m) => { if (/\[v3\] onSent|TypeError/.test(m.text())) alertes.push(m.type() + ' ' + m.text()); });
  page.on('pageerror', (e) => alertes.push('pageerror ' + e.message));
  return alertes;
}

// Fin du parcours d'aide sur les trois pieces du studio, puis les ecritures : la photo de la
// carte, deja saisie, n'est ni perdue ni supprimee ; la fin n'a ni linge ni rapport.
// `debut` : les ecritures d'avant la bascule (sans carte quand la reponse arrive avant sa photo).
async function finirEnAide(page: Page, debut = ['startJob', 'uploadPhoto arrival:Access card']) {
  for (const r of ['Bed', 'Bathroom', 'Kitchen']) await piece(page, 4, r);
  await expect(page.locator('[data-reply="add-to-lead"]')).toHaveText("Add to Pionah's report");
  await page.locator('[data-reply="add-to-lead"]').click();
  await fileVide(page);
  const e = await ecritures(page);
  const noms = e.map((x) => x.action.replace('v3.', '') + (x.action === 'v3.uploadPhoto' ? ' ' + x.body.itemName : ''));
  expect(noms).toEqual([
    ...debut,
    'uploadPhoto end:Bed', 'uploadPhoto end:Bathroom', 'uploadPhoto end:Kitchen',
    'finishJob',
  ]);
  const fin = e[e.length - 1].body;
  expect('report' in fin).toBe(false);
  expect('linen' in fin).toBe(false);
  return e;
}

test('les deux ont ouvert avant de demarrer : la seconde passe en aide a la reponse de startJob, photos gardees', async ({ page }) => {
  await demarrer(page, [
    { match: 'action=v3.myDay', status: 200, body: JOUR_BINOME },
    // Reponse retenue jusqu'a ce que la carte soit photographiee.
    { match: 'action=v3.startJob', status: 200, hold: 'demarrage', body: DEMARRAGE_AIDE },
    ...sansDemarrage,
  ]);
  await ouvrir(page);
  await page.locator('[data-reply="here"]').click();
  // Pendant l'attente de la reponse, elle suit le parcours de la lead : la carte d'acces.
  await carteAcces(page);
  await expect(page.locator('.vf-top b')).toHaveText(/^Step 1 · Bed /);
  await liberer(page, 'demarrage');
  // La reponse arrive : parcours d'aide, directement sur la premiere piece de la fin du menage.
  await expect(page.locator('.vf-top b')).toHaveText(/^Step 4 · Bed /);
  await expect(page.locator('.note')).toHaveText(NOTE);
  await expect(page.locator('.msg.lead').first()).toContainText('Pionah started at 10:30');
  await finirEnAide(page);
});

test('binome : la conversation s ouvre sans attendre la relecture ; la journee relue dit aide avant I m here', async ({ page }) => {
  await demarrer(page, [
    { match: 'action=v3.myDay', status: 200, once: true, body: JOUR_BINOME },
    // Relecture a l'ouverture, retenue : le reseau est lent.
    { match: 'action=v3.myDay', status: 200, hold: 'relecture', body: JOUR_AIDE },
    ...sansJournee,
  ]);
  await ouvrir(page);
  // Ouverte tout de suite, avec la journee en memoire, pendant que la relecture attend.
  await expect(page.locator('[data-reply="here"]')).toBeVisible({ timeout: 1000 });
  await expect.poll(() => nbMyDay(page)).toBe(2);
  await expect(page.locator('.msg.lead')).toHaveCount(0);
  await liberer(page, 'relecture');
  // Pionah a demarre : parcours d'aide, toujours a l'arrivee, prevenue par la note.
  await expect(page.locator('.msg.lead').first()).toContainText('Pionah started at 10:30');
  await expect(page.locator('.note')).toHaveText(NOTE);
  await expect(page.locator('[data-reply="here"]')).toBeVisible();
  await page.locator('[data-reply="here"]').click();
  // Ni carte d'acces ni photos d'arrivee : on part sur les pieces de la fin du menage.
  await piece(page, 4, 'Bed');
});

test('binome : la journee relue dit aide apres I m here, la photo deja prise est gardee', async ({ page }) => {
  await demarrer(page, [
    { match: 'action=v3.myDay', status: 200, once: true, body: JOUR_BINOME },
    { match: 'action=v3.myDay', status: 200, hold: 'relecture', body: JOUR_AIDE },
    ...sansJournee,
  ]);
  await ouvrir(page);
  // Aucune touche ignoree pendant la relecture : elle demarre et photographie la carte.
  await page.locator('[data-reply="here"]').click();
  await carteAcces(page);
  await expect(page.locator('.vf-top b')).toHaveText(/^Step 1 · Bed /);
  await liberer(page, 'relecture');
  await expect(page.locator('.vf-top b')).toHaveText(/^Step 4 · Bed /);
  await expect(page.locator('.note')).toHaveText(NOTE);
  const carte = await page.evaluate(() => {
    const h = (window as any).__hk;
    return (h.convs[h.activeId].arrivalPhotos['Access card'] || []).length;
  });
  expect(carte).toBe(1);
  await finirEnAide(page);
});

test('appartement sans autre cleaner affectee : l ouverture ne relit pas la journee', async ({ page }) => {
  await demarrer(page, [{ match: 'action=v3.myDay', status: 200, body: JOUR_SEUL }, ...sansJournee]);
  await ouvrir(page);
  await page.locator('[data-reply="here"]').click();
  await carteAcces(page);
  expect(await nbMyDay(page)).toBe(1);
});

test('demarrage refuse un temps (503, la collegue demarre au meme instant) : rien de bloquant, la file relance, le role arrive', async ({ page }) => {
  await demarrer(page, [
    { match: 'action=v3.myDay', status: 200, body: JOUR_SEUL },
    { match: 'action=v3.startJob', status: 503, once: true, body: { error: 'Still starting. Retry.' } },
    { match: 'action=v3.startJob', status: 200, hold: 'demarrage', body: DEMARRAGE_AIDE },
    ...sansDemarrage,
  ]);
  await ouvrir(page);
  await page.locator('[data-reply="here"]').click();
  await expect.poll(() => essaisDemarrage(page)).toBe(1);
  // Le parcours continue : la carte se photographie, le geste suivant relance le demarrage.
  await carteAcces(page);
  await expect.poll(() => essaisDemarrage(page)).toBe(2);
  await expect(page.locator('.toast.err')).toHaveCount(0);
  expect(await page.evaluate(async () => (await (await import('/v3/offline.js')).deadEntries()).length)).toBe(0);
  await liberer(page, 'demarrage');
  await expect(page.locator('.vf-top b')).toHaveText(/^Step 4 · Bed /);
  await expect(page.locator('.note')).toHaveText(NOTE);
  const e = await finirEnAide(page);
  expect(e[0].essais).toBe(2);
});

// Correction 2 : le passage en aide est a sens unique sur le telephone. Une journee relue qui dit
// encore « lead » (lue par le serveur avant le demarrage de la collegue, arrivee apres la reponse
// de v3.startJob) ne ramene pas la conversation en lead et n'efface pas sa lead.
test('relecture perimee arrivee apres la reponse helper de startJob : la conversation reste en aide, rien ne se fige', async ({ page }) => {
  const alertes = surveiller(page);
  await demarrer(page, [
    { match: 'action=v3.myDay', status: 200, once: true, body: JOUR_BINOME },
    { match: 'action=v3.myDay', status: 200, hold: 'relecture', body: JOUR_BINOME },
    { match: 'action=v3.startJob', status: 200, body: DEMARRAGE_AIDE },
    ...sansDemarrage,
  ]);
  await ouvrir(page);
  await page.locator('[data-reply="here"]').click();
  await expect(page.locator('.vf-top b')).toHaveText(/^Step 4 · Bed /);
  const avant = await derniereLecture(page);
  await liberer(page, 'relecture');
  await expect.poll(() => derniereLecture(page)).not.toBe(avant);
  expect(await roleActif(page)).toEqual({ role: 'helper', lead: 'Pionah' });
  // La photo suivante s'affiche et Next room s'active (piece), jusqu'au bout du parcours d'aide.
  await finirEnAide(page, ['startJob']);
  expect(alertes).toEqual([]);
});

test('retour au premier plan : une journee relue qui dit lead ne ramene pas l aide en lead', async ({ page }) => {
  const alertes = surveiller(page);
  await demarrer(page, [
    { match: 'action=v3.myDay', status: 200, body: JOUR_SEUL },
    { match: 'action=v3.startJob', status: 200, body: DEMARRAGE_AIDE },
    ...sansDemarrage,
  ]);
  await ouvrir(page);
  await page.locator('[data-reply="here"]').click();
  await expect(page.locator('.vf-top b')).toHaveText(/^Step 4 · Bed /);
  const avant = await derniereLecture(page);
  // Plus de 60 s plus tard, l'app revient au premier plan : relecture de la tache 2.
  await page.clock.setFixedTime(new Date(Date.now() + 120_000));
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await expect.poll(() => derniereLecture(page)).not.toBe(avant);
  expect(await nbMyDay(page)).toBe(2);
  expect(await roleActif(page)).toEqual({ role: 'helper', lead: 'Pionah' });
  await finirEnAide(page, ['startJob']);
  expect(alertes).toEqual([]);
});
