import { test, expect } from '@playwright/test';
import { bootMgr, fetchLog, MANAGER, me, noHorizontalScroll } from './helpers';
import { DONE, NOW_MNT, OPEN, PROPOSALS, PRP, REJECTED, TICKET } from './maintenance-fixtures';

// Fiche ticket (maquette 4) : mnt.get?ref=MNT-n, etapes, faits, historique, gestes
// mnt.act, photo de cloture par mnt.photo, nouveau ticket.

function DETAIL(o: any = {}) {
  return {
    kind: 'ticket',
    ticket: {
      ...TICKET({ status: 'assigned', assignee: { kind: 'member', id: 21, name: 'Semax' }, dueOn: '2026-10-09' }),
      description: null,
      history: [
        { at: '2026-10-09T06:10:00Z', who: 'Guest', kind: 'guest', text: 'The AC is <b>blowing warm</b> air', photoUrl: null },
        { at: '2026-10-09T06:20:00Z', who: 'Walter', kind: 'event', text: 'created the ticket', photoUrl: null },
        { at: '2026-10-09T06:40:00Z', who: 'Semax', kind: 'comment', text: '<img src=x onerror=alert(1)> coming at 13:00', photoUrl: 'https://signed.test/p1.jpg' },
      ],
      photos: [], resolutionPhotoUrl: null, proposal: PRP(),
      ...o,
    },
  };
}
const L = [
  { match: 'rejected=1', status: 200, body: REJECTED() },
  { match: 'tab=proposals', status: 200, body: PROPOSALS() },
  { match: 'tab=open', status: 200, body: OPEN() },
  { match: 'tab=done', status: 200, body: DONE() },
];
const GET = (ref: string, body: any) => ({ match: 'ref=' + ref, status: 200, body });
const NOT_FOUND = { match: 'action=mnt.get', status: 404, body: { error: 'Not found.' } };
const ACT_OK = (o: any = {}) => ({ match: 'action=mnt.act', status: 200, body: { ok: true, ticketId: 14, ...o } });
const ALL = (...extra: any[]) => [me(MANAGER), ...L, ...extra];

const lists = async (page: any) => (await fetchLog(page)).filter((l) => l.url.includes('action=mnt.list')).map((l) => l.url);
const acts = async (page: any) => (await fetchLog(page)).filter((l) => l.url.includes('action=mnt.act')).map((l) => JSON.parse(l.body));
const hashOf = (page: any) => page.evaluate(() => location.hash);
const sheet = (page: any) => page.locator('#sheet');
const choose = (page: any, sel: string, value: string) => page.locator(sel).evaluate((el: HTMLSelectElement, v: string) => {
  el.value = v;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}, value);
// Formulaires multipart envoyes (le journal du faux serveur ne garde que les corps texte).
async function watchForms(page: any) {
  await page.evaluate(() => {
    const prev = window.fetch;
    (window as any).__forms = [];
    window.fetch = ((input: any, init: any) => {
      if (init && init.body instanceof FormData) {
        const o: any = {};
        init.body.forEach((v: any, k: string) => { o[k] = v instanceof File ? 'file:' + v.name + ':' + v.type : v; });
        (window as any).__forms.push(o);
      }
      return prev(input, init);
    }) as any;
  });
}
const forms = (page: any) => page.evaluate(() => (window as any).__forms || []);
const PNG = { name: 'leak.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64') };

const WORKING = { stage: 'in_progress', status: 'in_progress' };
async function openFromOpen(page: any, extra: any[] = [], detail: any = {}) {
  await bootMgr(page, ALL(GET('MNT-14', DETAIL(detail)), ...extra), { email: true, clock: NOW_MNT, hash: '#/maintenance?tab=open' });
  await page.locator('.mt-row').nth(0).click();
  await expect(sheet(page).locator('.mt-steps')).toBeVisible();
}

test('fiche ticket : reference, origine, etapes, faits, historique en texte, photo, boutons, hash', async ({ page }) => {
  await openFromOpen(page);
  const s = sheet(page);
  await expect(s.locator('.mt-tkref')).toHaveText('MNT-14 · from a guest message');
  await expect(s.getByRole('heading', { name: 'AC not cooling' })).toBeVisible();
  await expect(s.locator('.mt-tkwhere')).toHaveText('Apt 1509 · Westwood · AC');
  await expect(s.locator('.mt-steps li')).toHaveText(['Created', 'Assigned', 'In progress', 'Done']);
  await expect(s.locator('.mt-steps li[aria-current="step"]')).toHaveText('Assigned');
  await expect(s.locator('.mt-facts dt')).toHaveText(['Urgency', 'Who follows it', 'Guest', 'Due']);
  await expect(s.locator('.mt-facts dd')).toHaveText(['Urgent', 'Semax', 'In now, until Mon 12', 'Today']);
  const h = s.locator('.mt-hist li');
  await expect(h).toHaveCount(3);
  // Citation du guest une seule fois, depuis l'historique, avec son prenom.
  await expect(h.nth(0)).toContainText('Ann');
  await expect(h.nth(0).locator('.mt-hq')).toHaveText('“The AC is <b>blowing warm</b> air”');
  await expect(s.locator('.mt-hq')).toHaveCount(1);
  await expect(s.locator('.mt-hist time').nth(0)).toHaveText('10:10');
  await expect(h.nth(1)).toContainText('Walter created the ticket');
  await expect(h.nth(2)).toContainText('<img src=x onerror=alert(1)> coming at 13:00');
  expect(await s.locator('.mt-hist img:not(.mt-thumbimg)').count()).toBe(0);
  const a = h.nth(2).locator('a.mt-thumb');
  await expect(a).toHaveAttribute('href', 'https://signed.test/p1.jpg');
  await expect(a).toHaveAttribute('target', '_blank');
  await expect(s.locator('[data-mact^="tk-"]')).toHaveText(['Start', 'Waiting parts', 'Comment', 'Reassign', 'Due date']);
  expect(await hashOf(page)).toBe('#/maintenance?ref=MNT-14');
  await s.locator('.x').click();
  await expect(page.locator('#sheet.on')).toHaveCount(0);
  await expect.poll(() => hashOf(page)).toBe('#/maintenance?tab=open');
});

test('boutons par etape ; Reopen as still broken envoie ticket.start', async ({ page }) => {
  const at = (id: number, o: any) => GET('MNT-' + id, DETAIL({ id, ref: 'MNT-' + id, ...o }));
  await bootMgr(page, ALL(
    at(31, { stage: 'in_progress', status: 'in_progress' }),
    at(32, { stage: 'waiting_parts', status: 'waiting_parts' }),
    at(33, { stage: 'to_confirm', status: 'to_confirm' }),
    at(34, { stage: 'done', status: 'resolved', resolvedAt: '2026-10-08T08:00:00Z', resolvedBy: 'Semax', actualCost: 0, resolutionNotes: 'Gas <i>refilled</i>' }),
    at(35, { assignee: null, status: 'open', proposal: null, dueOn: null }),
    ACT_OK({ ticketId: 33, status: 'in_progress' }),
  ), { email: true, clock: NOW_MNT, hash: '#/maintenance?ref=MNT-31' });
  const s = sheet(page);
  const btns = s.locator('[data-mact^="tk-"]');
  await expect(btns).toHaveText(['Done', 'Waiting parts', 'Comment', 'Reassign', 'Due date']);
  await expect(s.locator('.mt-steps li[aria-current="step"]')).toHaveText('In progress');

  await page.evaluate(() => { location.hash = '#/maintenance?ref=MNT-32'; });
  await expect(s.locator('[data-mref="MNT-32"]')).toBeVisible();
  await expect(btns).toHaveText(['Start', 'Done', 'Comment', 'Reassign', 'Due date']);
  await expect(s.locator('.mt-stage')).toHaveText('Waiting parts');

  await page.evaluate(() => { location.hash = '#/maintenance?ref=MNT-34'; });
  await expect(s.locator('[data-mref="MNT-34"]')).toBeVisible();
  await expect(btns).toHaveText(['Reopen']);
  await expect(s.locator('.mt-steps li[aria-current="step"]')).toHaveText('Done');
  await expect(s.locator('.mt-tkdone')).toHaveText('Done by Semax, Thu 8 · AED 0');
  await expect(s.locator('.mt-tkdone + .mt-note')).toHaveText('“Gas <i>refilled</i>”');

  await page.evaluate(() => { location.hash = '#/maintenance?ref=MNT-35'; });
  await expect(s.locator('[data-mref="MNT-35"]')).toBeVisible();
  await expect(s.locator('.mt-steps li[aria-current="step"]')).toHaveText('Created');
  await expect(s.locator('.mt-facts dt')).toHaveText(['Urgency', 'Who follows it', 'Due']);
  await expect(s.locator('.mt-facts dd')).toHaveText(['Urgent', 'Nobody yet', 'Not set']);

  await page.evaluate(() => { location.hash = '#/maintenance?ref=MNT-33'; });
  await expect(s.locator('[data-mref="MNT-33"]')).toBeVisible();
  await expect(btns).toHaveText(['Confirm fixed', 'Reopen as still broken', 'Comment', 'Reassign', 'Due date']);
  await expect(s.locator('.mt-stage')).toHaveText('To confirm');
  await s.locator('[data-mact="tk-broken"]').click();
  await expect(page.locator('#toast')).toContainText('MNT-33 reopened');
  const a = await acts(page);
  expect(a).toHaveLength(1);
  const { idem, ...rest } = a[0];
  expect(rest).toEqual({ op: 'ticket.start', ticketId: 33 });
  expect(idem).toMatch(/^mgr-[A-Za-z0-9]{8,}/);
});

test('Start : ticket.start avec cle, toast, feuille fermee, liste relue', async ({ page }) => {
  await openFromOpen(page, [ACT_OK({ status: 'in_progress' })]);
  const before = (await lists(page)).length;
  await sheet(page).locator('[data-mact="tk-start"]').click();
  await expect(page.locator('#toast')).toContainText('MNT-14 started');
  await expect(page.locator('#sheet.on')).toHaveCount(0);
  const a = await acts(page);
  expect(a).toHaveLength(1);
  expect(a[0]).toMatchObject({ op: 'ticket.start', ticketId: 14 });
  expect(a[0].idem).toBeTruthy();
  await expect.poll(async () => (await lists(page)).length).toBeGreaterThan(before);
  await expect.poll(() => hashOf(page)).toBe('#/maintenance?tab=open');
});

test('Waiting parts : note facultative envoyee', async ({ page }) => {
  await openFromOpen(page, [ACT_OK({ status: 'waiting_parts' })]);
  const s = sheet(page);
  await s.locator('[data-mact="tk-waiting"]').click();
  await expect(s.getByRole('heading', { name: 'Waiting parts' })).toBeVisible();
  expect(await hashOf(page)).toBe('#/maintenance?ref=MNT-14');
  await s.locator('#mtWaitNote').fill('Compressor ordered');
  await s.locator('[data-mact="tk-wait-send"]').click();
  await expect(page.locator('#toast')).toContainText('MNT-14 waiting parts');
  const a = await acts(page);
  expect(a).toHaveLength(1);
  const { idem, ...rest } = a[0];
  expect(rest).toEqual({ op: 'ticket.waiting_parts', ticketId: 14, note: 'Compressor ordered' });
});

test('Done sans cout : ni cost ni photoPath, aucune photo envoyee ; Back revient a la fiche', async ({ page }) => {
  await bootMgr(page, ALL(GET('MNT-31', DETAIL({ id: 31, ref: 'MNT-31', stage: 'in_progress', status: 'in_progress' })), ACT_OK({ ticketId: 31 })),
    { email: true, clock: NOW_MNT, hash: '#/maintenance?ref=MNT-31' });
  const s = sheet(page);
  await s.locator('[data-mact="tk-done"]').click();
  await expect(s.getByRole('heading', { name: 'Mark done' })).toBeVisible();
  await expect(s.locator('label[for="mtCost"]')).toHaveText('Cost (AED), optional');
  await expect(s.locator('#mtCost')).toHaveAttribute('inputmode', 'decimal');
  await expect(s.locator('#mtPhoto')).toHaveAttribute('accept', 'image/*');
  await expect(s.locator('#mtPhoto')).toHaveAttribute('capture', 'environment');
  await expect(s.locator('label[for="mtPhoto"]')).toHaveText('Add photo');
  await s.locator('[data-mact="tk-back"]').click();
  await expect(s.locator('.mt-steps')).toBeVisible();
  await s.locator('[data-mact="tk-done"]').click();
  await s.locator('#mtDoneNote').fill('Gas refilled');
  await s.locator('[data-mact="tk-done-send"]').click();
  await expect(page.locator('#toast')).toContainText('MNT-31 done');
  const a = await acts(page);
  expect(a).toHaveLength(1);
  const { idem, ...rest } = a[0];
  expect(rest).toEqual({ op: 'ticket.done', ticketId: 31, note: 'Gas refilled' });
  expect((await fetchLog(page)).filter((l) => l.url.includes('action=mnt.photo'))).toHaveLength(0);
});

test('Done avec cout 120 ; cout illisible refuse sans envoi', async ({ page }) => {
  await openFromOpen(page, [ACT_OK()], WORKING);
  const s = sheet(page);
  await s.locator('[data-mact="tk-done"]').click();
  await s.locator('#mtCost').fill('12,5 AED');
  await s.locator('[data-mact="tk-done-send"]').click();
  await expect(s.locator('.sheet-err')).toHaveText('Cost must be a number.');
  expect(await acts(page)).toHaveLength(0);
  await s.locator('#mtCost').fill('120');
  await s.locator('[data-mact="tk-done-send"]').click();
  await expect(page.locator('#toast')).toContainText('MNT-14 done');
  const a = await acts(page);
  expect(a).toHaveLength(1);
  expect(a[0]).toMatchObject({ op: 'ticket.done', ticketId: 14, cost: '120' });
  expect('photoPath' in a[0]).toBe(false);
});

test('Done avec photo : mnt.photo d abord (cle, fichier, ticketId), puis ticket.done avec le chemin rendu', async ({ page }) => {
  await openFromOpen(page, [
    { match: 'action=mnt.photo', status: 200, body: { status: 'success', photoId: 77, path: 'v3/2026-10-09/abc.png' } },
    ACT_OK(),
  ], WORKING);
  await watchForms(page);
  const s = sheet(page);
  await s.locator('[data-mact="tk-done"]').click();
  await s.locator('#mtPhoto').setInputFiles(PNG);
  await expect(s.locator('#mtPhotoName')).toContainText('leak.png');
  await s.locator('[data-mact="tk-done-send"]').click();
  await expect(page.locator('#toast')).toContainText('MNT-14 done');
  const log = (await fetchLog(page)).filter((l) => l.url.includes('action=mnt.photo') || l.url.includes('action=mnt.act'));
  expect(log.map((l) => (l.url.includes('mnt.photo') ? 'photo' : 'act'))).toEqual(['photo', 'act']);
  const f = await forms(page);
  expect(f).toHaveLength(1);
  expect(f[0].ticketId).toBe('14');
  expect(f[0].file).toBe('file:leak.png:image/png');
  expect(f[0].idem).toMatch(/^mgr-[A-Za-z0-9]{8,}/);
  const a = await acts(page);
  expect(a[0]).toMatchObject({ op: 'ticket.done', ticketId: 14, photoPath: 'v3/2026-10-09/abc.png' });
  expect(a[0].idem).not.toBe(f[0].idem);
});

test('photo refusee : la feuille reste avec l erreur, aucun ticket.done ; reessai avec la meme cle', async ({ page }) => {
  await openFromOpen(page, [
    { match: 'action=mnt.photo', status: 0, body: {}, fail: true, once: true },
    { match: 'action=mnt.photo', status: 413, body: { error: 'photo is too large' }, once: true },
    ACT_OK(),
  ], WORKING);
  await watchForms(page);
  const s = sheet(page);
  await s.locator('[data-mact="tk-done"]').click();
  await s.locator('#mtPhoto').setInputFiles(PNG);
  await s.locator('#mtCost').fill('80');
  await s.locator('[data-mact="tk-done-send"]').click();
  await expect(s.locator('.sheet-err')).toHaveText('No connection. Try again.');
  await expect(page.locator('#sheet.on')).toHaveCount(1);
  await expect(s.getByRole('heading', { name: 'Mark done' })).toBeVisible();
  await expect(s.locator('[data-mact="tk-done-send"]')).toBeEnabled();
  await s.locator('[data-mact="tk-done-send"]').click();
  await expect(s.locator('.sheet-err')).toHaveText('photo is too large');
  await expect(s.locator('#mtCost')).toHaveValue('80');
  expect(await acts(page)).toHaveLength(0);
  const f = await forms(page);
  expect(f).toHaveLength(2);
  expect(f[1].idem).toBe(f[0].idem);
});

test('Comment : texte obligatoire, HTML envoye tel quel', async ({ page }) => {
  await openFromOpen(page, [ACT_OK({ comment: { author: 'Walter', text: 'x', at: '2026-10-09T07:00:00Z' } })]);
  const s = sheet(page);
  await s.locator('[data-mact="tk-comment"]').click();
  await expect(s.getByRole('heading', { name: 'Comment' })).toBeVisible();
  await s.locator('[data-mact="tk-comment-send"]').click();
  await expect(s.locator('.sheet-err')).toHaveText('Write a comment first.');
  expect(await acts(page)).toHaveLength(0);
  await s.locator('#mtComment').fill('Guest <b>says</b> 13:00 is fine');
  await s.locator('[data-mact="tk-comment-send"]').click();
  await expect(page.locator('#toast')).toContainText('Comment added to MNT-14');
  const a = await acts(page);
  expect(a[0]).toMatchObject({ op: 'ticket.comment', ticketId: 14, text: 'Guest <b>says</b> 13:00 is fine' });
});

test('Reassign : equipe, prestataires, Nobody ; vers un prestataire puis personne', async ({ page }) => {
  await openFromOpen(page, [ACT_OK()]);
  const s = sheet(page);
  await s.locator('[data-mact="tk-assign"]').click();
  await expect(s.getByRole('heading', { name: 'Reassign' })).toBeVisible();
  await expect(s.locator('[data-asg]')).toHaveText(['Walter', 'Semax', 'CoolFix AC', 'Nobody']);
  await expect(s.locator('[data-asg="m:21"]')).toHaveAttribute('aria-pressed', 'true');
  await s.locator('[data-asg="v:3"]').click();
  await expect(s.locator('[data-asg="v:3"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(s.locator('[data-asg="m:21"]')).toHaveAttribute('aria-pressed', 'false');
  await s.locator('[data-mact="tk-assign-send"]').click();
  await expect(page.locator('#toast')).toContainText('MNT-14 assigned to CoolFix AC');
  let a = await acts(page);
  const { idem, ...rest } = a[0];
  expect(rest).toEqual({ op: 'ticket.assign', ticketId: 14, vendorId: 3 });

  await page.locator('.mt-row').nth(0).click();
  await s.locator('[data-mact="tk-assign"]').click();
  await s.locator('[data-asg="none"]').click();
  await s.locator('[data-mact="tk-assign-send"]').click();
  await expect(page.locator('#toast')).toContainText('Nobody follows MNT-14 now');
  a = await acts(page);
  expect(a[1]).toMatchObject({ op: 'ticket.assign', ticketId: 14, unassign: true });
});

test('Due date : date minimale aujourd hui, enregistrer puis effacer', async ({ page }) => {
  await openFromOpen(page, [ACT_OK()]);
  const s = sheet(page);
  await s.locator('[data-mact="tk-due"]').click();
  await expect(s.getByRole('heading', { name: 'Due date' })).toBeVisible();
  await expect(s.locator('#mtDue')).toHaveAttribute('min', '2026-10-09');
  await expect(s.locator('#mtDue')).toHaveValue('2026-10-09');
  await s.locator('#mtDue').fill('2026-10-12');
  await s.locator('[data-mact="tk-due-send"]').click();
  await expect(page.locator('#toast')).toContainText('MNT-14 due 12/10');
  await page.locator('.mt-row').nth(0).click();
  await s.locator('[data-mact="tk-due"]').click();
  await s.locator('[data-mact="tk-due-clear"]').click();
  await expect(page.locator('#toast')).toContainText('Due date removed from MNT-14');
  const a = await acts(page);
  expect(a.map((x) => ({ op: x.op, ticketId: x.ticketId, date: x.date }))).toEqual([
    { op: 'ticket.due', ticketId: 14, date: '2026-10-12' },
    { op: 'ticket.due', ticketId: 14, date: null },
  ]);
});

test('+ New ticket : champs, appartement obligatoire, ticket.create, toast', async ({ page }) => {
  await bootMgr(page, ALL(ACT_OK({ ticketId: 20, ref: 'MNT-20' })), { email: true, clock: NOW_MNT, hash: '#/maintenance?tab=open' });
  await expect(page.locator('.mt-row')).toHaveCount(3);
  await page.getByRole('button', { name: '+ New ticket' }).click();
  const s = sheet(page);
  await expect(s.getByRole('heading', { name: 'New ticket' })).toBeVisible();
  await expect(s.locator('#mtTitle')).toHaveValue('');
  await expect(s.locator('#mtApt')).toHaveValue('');
  await expect(s.locator('#mtCat')).toHaveValue('other');
  await expect(s.locator('[data-urg="normal"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(s.locator('[data-who="m:21"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(s.locator('#mtNote')).toBeVisible();
  expect(await hashOf(page)).toBe('#/maintenance?tab=open');
  await s.locator('[data-mact="new-send"]').click();
  await expect(s.locator('.sheet-err')).toHaveText('Write a title first.');
  await s.locator('#mtTitle').fill('Balcony door <stuck>');
  await s.locator('[data-mact="new-send"]').click();
  await expect(s.locator('.sheet-err')).toHaveText('Choose an apartment.');
  expect(await acts(page)).toHaveLength(0);
  await choose(page, '#mtApt', 'L2');
  await choose(page, '#mtCat', 'lock_door');
  await s.locator('[data-urg="high"]').click();
  await s.locator('#mtNote').fill('Owner reported');
  await s.locator('[data-mact="new-send"]').click();
  await expect(page.locator('#toast')).toContainText('MNT-20 created');
  await expect(page.locator('#sheet.on')).toHaveCount(0);
  const a = await acts(page);
  expect(a).toHaveLength(1);
  const { idem, ...rest } = a[0];
  expect(idem).toBeTruthy();
  expect(rest).toEqual({
    op: 'ticket.create', title: 'Balcony door <stuck>', listingId: 'L2', category: 'lock_door', urgency: 'high', note: 'Owner reported', memberId: 21,
  });
});

test('serveur en erreur : message dans la feuille, boutons rendus', async ({ page }) => {
  await openFromOpen(page, [{ match: 'action=mnt.act', status: 409, body: { error: 'This ticket is already in progress.' } }]);
  const s = sheet(page);
  await s.locator('[data-mact="tk-start"]').click();
  await expect(s.locator('.sheet-err')).toHaveText('This ticket is already in progress.');
  await expect(page.locator('#sheet.on')).toHaveCount(1);
  await expect(s.locator('[data-mact="tk-start"]')).toBeEnabled();
});

test('lien #/maintenance?ref=MNT-14 ouvre la fiche ; inconnu : toast This ticket was not found.', async ({ page }) => {
  await bootMgr(page, ALL(GET('MNT-14', DETAIL()), NOT_FOUND), { email: true, clock: NOW_MNT, hash: '#/maintenance?ref=MNT-14' });
  await expect(sheet(page).locator('[data-mref="MNT-14"] .mt-tkref')).toHaveText('MNT-14 · from a guest message');
  await expect(sheet(page).locator('.mt-steps')).toBeVisible();
  expect(await hashOf(page)).toBe('#/maintenance?ref=MNT-14');
  await page.keyboard.press('Escape');
  await expect.poll(() => hashOf(page)).toBe('#/maintenance');

  await page.evaluate(() => { location.hash = '#/maintenance?ref=MNT-99'; });
  await expect(page.locator('#toast')).toContainText('This ticket was not found.');
  await expect(page.locator('#sheet.on')).toHaveCount(0);
  await expect.poll(() => hashOf(page)).toBe('#/maintenance');
  await expect(page.locator('.mt-card')).toHaveCount(2);
});

test('donnees non fraiches : fiche en lecture, Reconnect to make changes., aucun geste', async ({ page }) => {
  await bootMgr(page, [me(MANAGER), { ...L[2], once: true }, GET('MNT-14', DETAIL()), { match: 'action=mnt.list', status: 0, body: {}, fail: true }],
    { email: true, clock: NOW_MNT, hash: '#/maintenance?tab=open' });
  await expect(page.locator('.mt-row')).toHaveCount(3);
  await page.locator('[data-tab="done"]').click();
  await page.locator('[data-tab="open"]').click();
  await expect(page.locator('#mtBanner .banner.warn')).toBeVisible();
  await page.locator('.mt-row').nth(0).click();
  await expect(sheet(page).locator('.mt-steps')).toBeVisible();
  await expect(sheet(page).locator('.ro-note')).toHaveText('Reconnect to make changes.');
  await expect(sheet(page).locator('[data-mact^="tk-"]')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '+ New ticket' }).click();
  await expect(page.locator('#toast')).toContainText('Reconnect to make changes.');
  await expect(page.locator('#sheet.on')).toHaveCount(0);
  expect(await acts(page)).toHaveLength(0);
});

test('375 px : fiche, Done et New ticket sans defilement horizontal, cibles de 44 px', async ({ page }, info) => {
  test.skip(info.project.name !== 'mgr-mobile', 'largeur telephone');
  await page.setViewportSize({ width: 375, height: 760 });
  await openFromOpen(page, [], WORKING);
  // Fin de l'animation du panneau avant de mesurer (arrondis sous le pixel).
  const check = async () => {
    await page.waitForTimeout(400);
    const sc = await noHorizontalScroll(page);
    expect(sc.scrollWidth).toBeLessThanOrEqual(sc.clientWidth);
    const small = await page.evaluate(() => Array.from(document.querySelectorAll('#sheet.on button, #sheet.on label.btn'))
      .filter((b: any) => b.offsetParent !== null && b.getBoundingClientRect().height < 43.5)
      .map((b: any) => (b.textContent.trim() || b.getAttribute('aria-label')) + ' ' + b.getBoundingClientRect().height));
    expect(small).toEqual([]);
    const wide = await page.evaluate(() => {
      const sh = document.getElementById('sheet') as HTMLElement;
      return sh.scrollWidth - sh.clientWidth;
    });
    expect(wide).toBeLessThanOrEqual(0);
  };
  await check();
  await sheet(page).locator('[data-mact="tk-done"]').click();
  await check();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '+ New ticket' }).click();
  await check();
});
