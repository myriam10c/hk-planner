import { expect, test } from '@playwright/test';
import { BLOOM, DAY, WRITE_ROUTES, carteAcces, demarrer, ecritures, fileVide, piece } from './conv-helpers';

// Binome (lot 1 des corrections, tache 3) : deux cleaners ouvrent le meme appartement avant
// qu'aucune n'ait touche « I'm here ». La premiere qui demarre fait le rapport ; la seconde
// passe en aide, sans perdre ce qu'elle avait saisi.

const PIONAH = { id: 7, name: 'Pionah', startedAt: '2026-10-02T06:30:00Z' };
const BLOOM_AIDE = {
  ...BLOOM, state: 'running', startedAt: PIONAH.startedAt, role: 'helper', leadId: 7,
  othersOnJob: [PIONAH],
};
const JOUR_AIDE = { ...DAY, stops: [BLOOM_AIDE] };
const JOUR_SEUL = { ...DAY, stops: [BLOOM] };

const sansDemarrage = WRITE_ROUTES.filter((r) => r.match !== 'action=v3.myDay' && r.match !== 'action=v3.startJob');

test('les deux ont ouvert avant de demarrer : la seconde passe en aide a la reponse de startJob, photos gardees', async ({ page }) => {
  await demarrer(page, [
    { match: 'action=v3.myDay', status: 200, body: JOUR_SEUL },
    // Le serveur a donne la place de lead a Pionah, qui a touche « I'm here » juste avant.
    { match: 'action=v3.startJob', status: 200, delay: 5000, body: { status: 'success', jobId: BLOOM.jobId, startedAt: PIONAH.startedAt, role: 'helper', lead: PIONAH } },
    ...sansDemarrage,
  ]);
  await page.getByRole('button', { name: /1011C Bloom Towers/ }).click();
  await page.locator('[data-reply="here"]').click();
  // Pendant l'attente de la reponse, elle suit le parcours de la lead : la carte d'acces.
  await carteAcces(page);
  // La reponse arrive : parcours d'aide, directement sur la premiere piece de la fin du menage.
  await expect(page.locator('.vf-top b')).toHaveText(/^Step 4 · Bed /);
  await expect(page.locator('.vf')).toBeVisible();
  for (const r of ['Bed', 'Bathroom', 'Kitchen']) await piece(page, 4, r);
  await expect(page.locator('[data-reply="add-to-lead"]')).toHaveText("Add to Pionah's report");
  await expect(page.locator('.msg.lead').first()).toContainText('Pionah started at 10:30');
  await page.locator('[data-reply="add-to-lead"]').click();
  await fileVide(page);
  const e = await ecritures(page);
  const noms = e.map((x) => x.action.replace('v3.', '') + (x.action === 'v3.uploadPhoto' ? ' ' + x.body.itemName : ''));
  // La photo de la carte, deja saisie, n'est ni perdue ni supprimee ; la fin n'a ni linge ni rapport.
  expect(noms).toEqual([
    'startJob', 'uploadPhoto arrival:Access card',
    'uploadPhoto end:Bed', 'uploadPhoto end:Bathroom', 'uploadPhoto end:Kitchen',
    'finishJob',
  ]);
  const fin = e[e.length - 1].body;
  expect('report' in fin).toBe(false);
  expect('linen' in fin).toBe(false);
});

test('la collegue a deja demarre : l\'appartement s\'ouvre directement en aide (journee relue a l\'ouverture)', async ({ page }) => {
  await demarrer(page, [
    // Boot : personne n'a demarre. Ouverture de l'appartement : la collegue vient de demarrer.
    { match: 'action=v3.myDay', status: 200, once: true, body: JOUR_SEUL },
    { match: 'action=v3.myDay', status: 200, body: JOUR_AIDE },
    ...WRITE_ROUTES.filter((r) => r.match !== 'action=v3.myDay'),
  ]);
  await page.getByRole('button', { name: /1011C Bloom Towers/ }).click();
  await expect(page.locator('.msg.lead').first()).toContainText('Pionah started at 10:30');
  await expect(page.locator('[data-reply="here"]')).toBeVisible();
  await page.locator('[data-reply="here"]').click();
  // Pas de carte d'acces ni de photos d'arrivee : on part sur les pieces de la fin du menage.
  await piece(page, 4, 'Bed');
});
