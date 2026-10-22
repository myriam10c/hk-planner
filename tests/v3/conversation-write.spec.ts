import { expect, test } from '@playwright/test';
import { BLOOM, CREEK, PNG_1x1, WRITE_ROUTES, carteAcces, demarrer, ecritures, fileVide, photo, piece } from './conv-helpers';

// Ecritures de la conversation (tache 5 du branchement 2026-10-05), observees sur le proxy
// simule : chaque geste part dans la file (offline.js) puis au proxy, dans l'ordre, une seule
// fois par cle d'idempotence. ✓ = en file, ✓✓ = reponse 2xx recue pour cet idem.

const court = (e: { action: string; body: any }) => {
  const a = e.action.replace('v3.', '');
  if (a === 'uploadPhoto') return a + ' ' + e.body.itemName;
  if (a === 'reportProblem') return a + ' ' + e.body.kind;
  return a;
};

test('studio : startJob, photos de pieces dans l ordre, finishJob avec linge et rapport avant le partage ; ✓✓ partout', async ({ page }) => {
  await demarrer(page);
  await page.getByRole('button', { name: /1011C Bloom Towers/ }).click();
  await page.locator('[data-reply="here"]').click();
  await carteAcces(page);
  for (const r of ['Bed', 'Bathroom', 'Kitchen']) await piece(page, 1, r);
  await page.locator('[data-reply="walls-ok"]').click();
  await page.locator('[data-reply="no-damage"]').click();
  await page.locator('[data-reply="linen-yes"]').click();
  for (const r of ['Bed', 'Bathroom', 'Kitchen']) await piece(page, 4, r);
  await expect(page.locator('[data-reply="leave:door"]')).toHaveText(/Door locked, keys & card left inside/);
  for (const k of ['gas', 'ac', 'wifi', 'lights', 'windows', 'trash', 'door']) await page.locator('[data-reply="leave:' + k + '"]').click();
  await page.locator('[data-reply="low-done"]').click();
  await page.locator('[data-reply="send"]').click();
  await expect(page.locator('.msg.me').last()).toContainText('Report sent to the group');
  await fileVide(page);
  const e = await ecritures(page);
  expect(e.map(court)).toEqual([
    'startJob',
    'uploadPhoto arrival:Access card',
    'uploadPhoto arrival:Bed', 'uploadPhoto arrival:Bathroom', 'uploadPhoto arrival:Kitchen',
    'uploadPhoto end:Bed', 'uploadPhoto end:Bathroom', 'uploadPhoto end:Kitchen',
    'finishJob',
  ]);
  expect(e.every((x) => x.essais === 1)).toBe(true);
  expect(e.every((x) => x.body.jobId === BLOOM.jobId)).toBe(true);
  const fin = e[8].body;
  expect(fin.linen).toEqual({ pillowcases: 4, bed_sheets: 1, duvet_covers: 1, large_towels: 3, small_towels: 0, face_towels: 0, bath_mats: 1 });
  expect(fin.report.text).toContain('READY · 1011C Bloom Towers');
  expect(fin.report.text).toContain('Door locked, keys & card left inside ✓');
  expect(fin.report.text).not.toContain('key back');
  expect(JSON.stringify(fin)).not.toContain('—');
  // Toutes les bulles de la cleaner passent a ✓✓, la liste dit Report sent ✓✓.
  await expect(page.locator('.msg.me .ticks').filter({ hasText: /^✓$/ })).toHaveCount(0);
  expect(await page.locator('.msg.me .ticks').count()).toBeGreaterThan(10);
  const partage = await page.evaluate(() => (window as any).__shared);
  expect(partage.length).toBe(1);
  expect(partage[0].files).toBe(7);
  expect(fin.report.text).toContain('*Access card:* 📷 1');
  await page.getByRole('button', { name: 'Back' }).click();
  await expect(page.locator('.row').first().locator('.row-sub')).toHaveText('Report sent ✓✓');
});

test('un probleme avec 2 photos et une note : photo, signalement, photo + rattachement, note', async ({ page }) => {
  await demarrer(page);
  await page.getByRole('button', { name: /1011C Bloom Towers/ }).click();
  await page.locator('[data-reply="here"]').click();
  await carteAcces(page);
  for (const r of ['Bed', 'Bathroom', 'Kitchen']) await piece(page, 1, r);
  await page.locator('[data-reply="walls-ok"]').click();
  await page.locator('[data-reply="some-damage"]').click();
  await page.locator('[data-kind="Leak"]').click();
  await photo(page, 'flow-shutter');
  await photo(page, 'flow-shutter');
  await page.locator('[data-flow="photos-done"]').click();
  await page.locator('#problem-note').fill('under the sink');
  await page.locator('[data-flow="save-text"]').click();
  await fileVide(page);
  const e = (await ecritures(page)).slice(5);
  expect(e.map(court)).toEqual(['uploadPhoto problem', 'reportProblem Leak', 'uploadPhoto problem', 'addProblemPhoto', 'setProblemNote']);
  const [p1, rep, p2, add, note] = e.map((x) => x.body);
  expect(rep).toMatchObject({ jobId: BLOOM.jobId, listingId: '203', kind: 'Leak', urgency: 'soon', where: 'Whole apartment', photoIdem: p1.idem });
  expect(add.photoIdem).toBe(p2.idem);
  expect(add.ticketIdem).toBe(rep.idem);
  expect(note).toMatchObject({ ticketIdem: rep.idem, note: 'under the sink' });
  // Signalement reconnu par le proxy : la bulle du probleme passe a ✓✓.
  await expect(page.locator('.msg.me.problem .ticks')).toHaveText('✓✓');
});

test('aide : finishJob sans linge ni rapport a « Add to Pionah s report »', async ({ page }) => {
  await demarrer(page);
  await page.getByRole('button', { name: /1506 Emaar Creekside 18A/ }).click();
  await page.locator('[data-reply="here"]').click();
  for (const r of CREEK.rooms) await piece(page, 4, r);
  await page.locator('[data-reply="add-to-lead"]').click();
  await fileVide(page);
  const e = await ecritures(page);
  expect(e.map(court)).toEqual(['startJob', ...CREEK.rooms.map((r) => 'uploadPhoto end:' + r), 'finishJob']);
  const fin = e.at(-1)!.body;
  expect(fin).toEqual({ jobId: CREEK.jobId, idem: fin.idem, checklist: {}, photos: [] });
});

test('finishJob refuse faute de linge (le serveur voit un lead) : l ecran demande le linge, rien au magasin mort', async ({ page }) => {
  const routes = WRITE_ROUTES.filter((r) => r.match !== 'action=v3.finishJob');
  await demarrer(page, [
    { match: 'action=v3.finishJob', status: 400, body: { error: 'pillowcases must be an integer' }, once: true },
    { match: 'action=v3.finishJob', status: 200, body: { status: 'success', role: 'lead' } },
    ...routes,
  ] as any);
  await page.getByRole('button', { name: /1506 Emaar Creekside 18A/ }).click();
  await page.locator('[data-reply="here"]').click();
  for (const r of CREEK.rooms) await piece(page, 4, r);
  await page.locator('[data-reply="add-to-lead"]').click();
  await expect(page.getByText('Housekeeping needs your linen count.').first()).toBeVisible({ timeout: 15_000 });
  await page.locator('[data-reply="linen-yes"]').click();
  await page.locator('[data-reply="linen-send"]').click();
  await fileVide(page);
  const fins = (await ecritures(page)).filter((x) => x.action === 'v3.finishJob');
  expect(fins.length).toBe(2);
  expect(fins[1].body.linen.pillowcases).toBe(4);
  const morts = await page.evaluate(async () => (await (await import('/v3/offline.js')).deadEntries()).length);
  expect(morts).toBe(0);
  await expect(page.getByText('Not sent:', { exact: false })).toHaveCount(0);
});

test('mise en file ratee une fois (stockage plein) : la photo et son signalement repartent au geste suivant, un seul ticket', async ({ page }) => {
  await demarrer(page);
  await page.getByRole('button', { name: /1011C Bloom Towers/ }).click();
  await page.locator('[data-reply="here"]').click();
  await carteAcces(page);
  for (const r of ['Bed', 'Bathroom', 'Kitchen']) await piece(page, 1, r);
  await page.locator('[data-reply="walls-ok"]').click();
  await page.locator('[data-reply="some-damage"]').click();
  await page.locator('[data-kind="Leak"]').click();
  await fileVide(page);
  // La prochaine mise en file echoue une fois, comme un stockage plein.
  await page.evaluate(() => {
    const add = IDBObjectStore.prototype.add;
    let n = 1;
    IDBObjectStore.prototype.add = function (v: any, k?: any) {
      if (this.name === 'queue' && n-- > 0) throw new DOMException('full', 'QuotaExceededError');
      return add.call(this, v, k);
    };
  });
  await photo(page, 'flow-shutter');
  await expect(page.getByText('Could not save on this phone. Try again.')).toBeVisible();
  // Le bandeau peut paraitre avant la fin du geste precedent (busy) : un appui pendant ce
  // temps est ignore par conception. On reappuie jusqu'a l'ouverture du selecteur.
  await expect(async () => {
    const [chooser] = await Promise.all([
      page.waitForEvent('filechooser', { timeout: 1000 }), page.locator('[data-act="flow-shutter"]').click(),
    ]);
    await chooser.setFiles({ name: 'p.png', mimeType: 'image/png', buffer: Buffer.from(PNG_1x1, 'base64') });
  }).toPass({ timeout: 10_000 });
  await expect(page.locator('.vf .count')).toHaveText('2 photos');
  await page.locator('[data-flow="photos-done"]').click();
  await page.locator('[data-flow="no-note"]').click();
  await fileVide(page);
  const e = (await ecritures(page)).slice(5);
  expect(e.map(court)).toEqual(['uploadPhoto problem', 'reportProblem Leak', 'uploadPhoto problem', 'addProblemPhoto']);
  expect(e[1].body.photoIdem).toBe(e[0].body.idem);
  expect(e[3].body).toMatchObject({ ticketIdem: e[1].body.idem, photoIdem: e[2].body.idem });
  expect(await page.evaluate(async () => (await (await import('/v3/offline.js')).deadEntries()).length)).toBe(0);
  await expect(page.locator('.msg.me.problem .ticks')).toHaveText('✓✓');
});

test('Gas smell : double appui sur la tuile puis nouvel appui plus tard = un seul reportProblem, consigne « manager on duty »', async ({ page }) => {
  await demarrer(page);
  await page.getByRole('button', { name: /1011C Bloom Towers/ }).click();
  await page.locator('[data-reply="here"]').click();
  await page.locator('.vf-problem').click();
  await page.locator('[data-kind="Gas smell"]').dblclick();
  await expect(page.locator('.gas-page .gas-text')).toHaveText('Open the windows. Do not touch switches. Leave and call your manager on duty.');
  await page.waitForTimeout(600);
  await page.locator('[data-flow="gas-ok"]').click();
  await expect(page.locator('.gas-page')).toHaveCount(0);
  // Elle croit que ca n'est pas parti et retouche Gas smell 2,5 s plus tard.
  await page.waitForTimeout(2500);
  await page.locator('.vf-problem').click();
  await page.locator('[data-kind="Gas smell"]').click();
  await expect(page.locator('.gas-page')).toBeVisible();
  await page.waitForTimeout(600);
  await page.locator('[data-flow="gas-ok"]').click();
  await fileVide(page);
  const rep = (await ecritures(page)).filter((x) => x.action === 'v3.reportProblem');
  expect(rep.length).toBe(1);
  expect(rep[0].body).toMatchObject({ kind: 'Gas smell', urgency: 'urgent' });
  await expect(page.locator('.msg.me.problem')).toHaveCount(1);
  await expect(page.getByText('Leave and call Walter')).toHaveCount(0);
});
