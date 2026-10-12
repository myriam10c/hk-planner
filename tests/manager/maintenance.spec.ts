import { test, expect } from '@playwright/test';
import { bootMgr, fetchLog, MANAGER, me, noHorizontalScroll } from './helpers';
import { DONE, NOW_MNT, OPEN, PROPOSALS, PRP, REJECTED, SEMAX, listBody } from './maintenance-fixtures';

const L = {
  rejected: () => ({ match: 'rejected=1', status: 200, body: REJECTED() }),
  proposals: (b: any = PROPOSALS()) => ({ match: 'tab=proposals', status: 200, body: b }),
  open: () => ({ match: 'tab=open', status: 200, body: OPEN() }),
  done: () => ({ match: 'tab=done', status: 200, body: DONE() }),
};
const ALL = () => [me(MANAGER), L.rejected(), L.proposals(), L.open(), L.done()];
const ACT_OK = (o: any = {}) => ({ match: 'action=mnt.act', status: 200, body: { ok: true, ticketId: 20, ref: 'MNT-20', ...o } });

const lists = async (page: any) => (await fetchLog(page)).filter((l) => l.url.includes('action=mnt.list')).map((l) => l.url);
const acts = async (page: any) => (await fetchLog(page)).filter((l) => l.url.includes('action=mnt.act')).map((l) => JSON.parse(l.body));
const hashOf = (page: any) => page.evaluate(() => location.hash);
const sheet = (page: any) => page.locator('#sheet');
// Choix dans un select par script : en emulation telephone, selectOption enchaine
// apres une saisie laisse Chromium croire le champ suivant invisible.
const choose = (page: any, sel: string, value: string) => page.locator(sel).evaluate((el: HTMLSelectElement, v: string) => {
  el.value = v;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}, value);

test('onglet par defaut Proposals avec pastille, Open sans proposition, onglet garde dans le hash', async ({ page }) => {
  await bootMgr(page, ALL(), { email: true, clock: NOW_MNT, hash: '#/maintenance' });
  await expect(page.getByRole('heading', { name: 'Maintenance', level: 1 })).toBeVisible();
  await expect(page.locator('#mtAsof')).toHaveText('Data as of 11:00');
  await expect(page.locator('[data-tab="proposals"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('[data-tab="proposals"] .mt-count')).toHaveText('2');
  await expect(page.locator('[data-tab="open"]')).toHaveText('Open · 3');
  await expect(page.locator('.mt-help')).toHaveText('Found by Claude in Hostaway guest messages. Check, then create a ticket or reject.');
  await expect(page.locator('.mt-card')).toHaveCount(2);
  // Pastille de navigation annoncee par mgr:mntbadge.
  await expect(page.locator('.nbadge').first()).toHaveText('2');
  await expect(page.getByRole('button', { name: '+ New ticket' })).toBeVisible();
  await page.locator('[data-tab="open"]').click();
  await expect(page.locator('[data-tab="open"]')).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => hashOf(page)).toBe('#/maintenance?tab=open');
  await expect(page.locator('.mt-row')).toHaveCount(3);

  await page.reload();
  await expect(page.locator('[data-tab="open"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.mt-row')).toHaveCount(3);
});

test('sans proposition en attente : Open par defaut', async ({ page }) => {
  const none = listBody('proposals', { counts: { proposals: 0, open: 3, urgent: 1, unassigned: 2, mine: 1 } });
  const open = OPEN({ counts: none.counts });
  await bootMgr(page, [me(MANAGER), L.proposals(none), { match: 'tab=open', status: 200, body: open }], { email: true, clock: NOW_MNT, hash: '#/maintenance' });
  await expect(page.locator('[data-tab="open"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.mt-row')).toHaveCount(3);
  await expect(page.locator('[data-tab="proposals"] .mt-count')).toHaveCount(0);
  expect(await hashOf(page)).toBe('#/maintenance');
});

test('carte de proposition : pastilles, heure, lieu, citation en texte, lien Hostaway ; carte deja ouverte', async ({ page }) => {
  await bootMgr(page, ALL(), { email: true, clock: NOW_MNT, hash: '#/maintenance' });
  const c = page.locator('.mt-card').nth(0);
  await expect(c.locator('.pill')).toHaveText(['Urgent', 'Guest in now']);
  await expect(c.locator('.mt-time')).toHaveText('10:58');
  await expect(c.locator('.mt-ttl')).toHaveText('AC not cooling in bedroom');
  await expect(c.locator('.mt-where')).toHaveText('Apt 1509 · Westwood · AC');
  await expect(c.locator('.mt-qtext')).toHaveText('“The AC is <b>blowing warm</b> air”');
  expect(await c.locator('b').count()).toBe(0);
  await expect(c.locator('.mt-qmeta')).toHaveText('Guest, 8 to 12 Oct · Open in Hostaway');
  const a = c.getByRole('link', { name: 'Open in Hostaway' });
  await expect(a).toHaveAttribute('href', 'https://dashboard.hostaway.com/v3/messages/inbox/987654');
  await expect(a).toHaveAttribute('target', '_blank');
  await expect(a).toHaveAttribute('rel', 'noopener');
  await expect(c.getByRole('button', { name: 'Create ticket' })).toBeVisible();
  await expect(c.getByRole('button', { name: 'Reject' })).toBeVisible();

  const m = page.locator('.mt-card').nth(1);
  await expect(m.locator('.pill')).toHaveText(['Already open: MNT-12']);
  await expect(m.locator('.mt-time')).toHaveText('Yesterday');
  await expect(m.locator('.mt-qmeta')).toHaveText('Guest, 28 Sep to 3 Oct · Open in Hostaway');
  await expect(m.getByRole('button', { name: 'Add to MNT-12' })).toBeVisible();
  await m.getByRole('button', { name: 'More' }).click();
  await expect(sheet(page).getByRole('heading', { name: 'Shower drain blocked' })).toBeVisible();
  await expect(sheet(page).locator('[data-mact="create"]')).toBeVisible();
  await expect(sheet(page).locator('[data-mact="reject"]')).toBeVisible();
  await expect(sheet(page).locator('[data-mact="merge"]')).toHaveText(/Add to MNT-12/);
});

test('Create ticket : champs pre-remplis, modifies, proposal.accept avec cle, toast, liste relue', async ({ page }) => {
  await bootMgr(page, [...ALL(), ACT_OK()], { email: true, clock: NOW_MNT, hash: '#/maintenance' });
  await page.locator('.mt-card').nth(0).getByRole('button', { name: 'Create ticket' }).click();
  const s = sheet(page);
  await expect(s.getByRole('heading', { name: 'Create ticket' })).toBeVisible();
  await expect(s.locator('.mt-qtext')).toHaveText(['“It is hot in here”', '“The AC is <b>blowing warm</b> air”']);
  await expect(s.locator('#mtTitle')).toHaveValue('AC not cooling in bedroom');
  await expect(s.locator('#mtApt')).toHaveValue('L1');
  await expect(s.locator('#mtApt option')).toHaveText(['Apt 2514 · Emaar Grand', 'Apt 4609 · Peninsula 3', 'Apt 1509 · Westwood']);
  await expect(s.locator('#mtCat')).toHaveValue('ac');
  await expect(s.locator('[data-urg="urgent"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(s.locator('[data-who="m:21"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(s.locator('[data-who]')).toHaveText(['Walter', 'Semax', 'Vendor', 'Nobody yet']);
  expect(await hashOf(page)).toBe('#/maintenance?ref=PRP-5');
  const before = (await lists(page)).length;

  await s.locator('#mtTitle').fill('AC blowing warm air');
  await choose(page, '#mtApt', 'L3');
  await choose(page, '#mtCat', 'electrical');
  await s.locator('[data-urg="high"]').click();
  await s.locator('[data-who="m:8"]').click();
  await s.locator('#mtNote').fill('Guest in until Monday');
  await s.locator('[data-mact="accept-send"]').click();
  await expect(page.locator('#toast')).toContainText('MNT-20 created');
  await expect(page.locator('#sheet.on')).toHaveCount(0);
  const a = await acts(page);
  expect(a).toHaveLength(1);
  expect(a[0].idem).toMatch(/^mgr-[A-Za-z0-9]{8,}/);
  const { idem, ...rest } = a[0];
  expect(rest).toEqual({
    op: 'proposal.accept', proposalId: 5, title: 'AC blowing warm air', listingId: 'L3', category: 'electrical',
    urgency: 'high', note: 'Guest in until Monday', memberId: 8,
  });
  await expect.poll(async () => (await lists(page)).length).toBeGreaterThan(before);
  await expect.poll(() => hashOf(page)).toBe('#/maintenance');
});

test('Create ticket : prestataire obligatoire avec Vendor, Nobody yet sans intervenant', async ({ page }) => {
  await bootMgr(page, [...ALL(), ACT_OK()], { email: true, clock: NOW_MNT, hash: '#/maintenance' });
  await page.locator('.mt-card').nth(0).getByRole('button', { name: 'Create ticket' }).click();
  const s = sheet(page);
  await expect(s.locator('#mtVendor')).toBeHidden();
  await s.locator('[data-who="vendor"]').click();
  await expect(s.locator('#mtVendor')).toBeVisible();
  await s.locator('[data-mact="accept-send"]').click();
  await expect(s.locator('.sheet-err')).toHaveText('Choose a vendor.');
  expect(await acts(page)).toHaveLength(0);
  await choose(page, '#mtVendor', '3');
  await s.locator('[data-mact="accept-send"]').click();
  await expect(page.locator('#toast')).toContainText('MNT-20 created');
  const a = await acts(page);
  expect(a[0].vendorId).toBe(3);
  expect('memberId' in a[0]).toBe(false);

  await page.locator('.mt-card').nth(0).getByRole('button', { name: 'Create ticket' }).click();
  await s.locator('[data-who="none"]').click();
  await s.locator('[data-mact="accept-send"]').click();
  await expect.poll(async () => (await acts(page)).length).toBe(2);
  const b = (await acts(page))[1];
  expect('memberId' in b || 'vendorId' in b).toBe(false);
  expect(b.idem).not.toBe(a[0].idem);
});

test('Reject : raison obligatoire, Other demande un texte, puis proposal.reject', async ({ page }) => {
  await bootMgr(page, [...ALL(), { match: 'action=mnt.act', status: 200, body: { ok: true, proposalId: 5 } }],
    { email: true, clock: NOW_MNT, hash: '#/maintenance' });
  await page.locator('.mt-card').nth(0).getByRole('button', { name: 'Reject' }).click();
  const s = sheet(page);
  await expect(s.getByRole('heading', { name: 'Reject proposal' })).toBeVisible();
  await expect(s.locator('[data-reason]')).toHaveText(['Not maintenance', 'Already fixed', 'Duplicate', 'Other']);
  await s.locator('[data-mact="reject-send"]').click();
  await expect(s.locator('.sheet-err')).toHaveText('Choose a reason.');
  await expect(s.locator('#mtWhy')).toBeHidden();
  await s.locator('[data-reason="other"]').click();
  await expect(s.locator('#mtWhy')).toBeVisible();
  await s.locator('[data-mact="reject-send"]').click();
  await expect(s.locator('.sheet-err')).toHaveText('Write why.');
  expect(await acts(page)).toHaveLength(0);
  await s.locator('#mtWhy').fill('Guest <script>joke</script>');
  await s.locator('[data-mact="reject-send"]').click();
  await expect(page.locator('#toast')).toContainText('PRP-5 rejected');
  const a = await acts(page);
  expect(a).toHaveLength(1);
  expect(a[0]).toMatchObject({ op: 'proposal.reject', proposalId: 5, reason: 'other', note: 'Guest <script>joke</script>' });
  expect(a[0].idem).toBeTruthy();
});

test('Back de Create depuis la feuille More revient a la feuille de proposition', async ({ page }) => {
  await bootMgr(page, ALL(), { email: true, clock: NOW_MNT, hash: '#/maintenance' });
  await page.locator('.mt-card').nth(1).getByRole('button', { name: 'More' }).click();
  await sheet(page).locator('[data-mact="create"]').click();
  await expect(sheet(page).getByRole('heading', { name: 'Create ticket' })).toBeVisible();
  await sheet(page).locator('[data-mact="back"]').click();
  await expect(sheet(page).getByRole('heading', { name: 'Shower drain blocked' })).toBeVisible();
});

test('Add to MNT-n : une touche, proposal.merge, toast', async ({ page }) => {
  await bootMgr(page, [...ALL(), { match: 'action=mnt.act', status: 200, body: { ok: true, ticketId: 12, ref: 'MNT-12' } }],
    { email: true, clock: NOW_MNT, hash: '#/maintenance' });
  await page.locator('.mt-card').nth(1).getByRole('button', { name: 'Add to MNT-12' }).click();
  await expect(page.locator('#toast')).toContainText('Added to MNT-12');
  const a = await acts(page);
  expect(a).toHaveLength(1);
  expect(a[0]).toMatchObject({ op: 'proposal.merge', proposalId: 6, ticketId: 12 });
});

test('409 : message du serveur dans la feuille, feuille ouverte, liste relue', async ({ page }) => {
  await bootMgr(page, [...ALL(), { match: 'action=mnt.act', status: 409, body: { error: 'This proposal was already handled.' } }],
    { email: true, clock: NOW_MNT, hash: '#/maintenance' });
  await page.locator('.mt-card').nth(0).getByRole('button', { name: 'Create ticket' }).click();
  const before = (await lists(page)).length;
  await sheet(page).locator('[data-mact="accept-send"]').click();
  await expect(sheet(page).locator('.sheet-err')).toHaveText('This proposal was already handled.');
  await expect(page.locator('#sheet.on')).toHaveCount(1);
  await expect(sheet(page).locator('[data-mact="accept-send"]')).toBeEnabled();
  await expect.poll(async () => (await lists(page)).length).toBeGreaterThan(before);
});

test('double touche : un seul envoi ; reessai apres coupure : meme cle', async ({ page }) => {
  await bootMgr(page, [...ALL(),
    { match: 'action=mnt.act', status: 0, body: {}, fail: true, once: true, delay: 600 },
    ACT_OK(),
  ], { email: true, clock: NOW_MNT, hash: '#/maintenance' });
  await page.locator('.mt-card').nth(0).getByRole('button', { name: 'Create ticket' }).click();
  const send = sheet(page).locator('[data-mact="accept-send"]');
  await send.dblclick();
  await expect(sheet(page).locator('.sheet-err')).toHaveText('No connection. Try again.');
  expect(await acts(page)).toHaveLength(1);
  await send.click();
  await expect(page.locator('#toast')).toContainText('MNT-20 created');
  const a = await acts(page);
  expect(a).toHaveLength(2);
  expect(a[1].idem).toBe(a[0].idem);
});

test('Open : groupes, ligne priorite et origine, filtres un a la fois, recherche, fiche ticket', async ({ page }) => {
  const detail = { kind: 'ticket', ticket: { ...OPEN().tickets[0], description: null, history: [], photos: [], resolutionPhotoUrl: null, proposal: null } };
  await bootMgr(page, [...ALL(), { match: 'ref=MNT-14', status: 200, body: detail }], { email: true, clock: NOW_MNT, hash: '#/maintenance?tab=open' });
  await expect(page.locator('.mt-gh')).toHaveText(['To do 2', 'In progress 1']);
  const r = page.locator('.mt-row');
  await expect(r.nth(0).locator('.mt-rttl')).toHaveText('AC not cooling');
  await expect(r.nth(0).locator('.mt-ref')).toHaveText('MNT-14');
  await expect(r.nth(0).locator('.mt-where')).toHaveText('Apt 1509 · Westwood');
  await expect(r.nth(0).locator('.mt-meta')).toHaveText('Urgent · 40 min ago · Guest message');
  await expect(r.nth(0).locator('.mt-p-urgent')).toHaveCount(1);
  await expect(r.nth(1).locator('.mt-meta')).toHaveText('High · Due today · Manual');
  await expect(r.nth(2).locator('.mt-meta')).toHaveText('Medium · 40 min ago · Cleaner report');
  await expect(page.locator('[data-filter]')).toHaveText(['Mine · 1', 'Urgent · 1', 'Unassigned · 2']);
  await expect(page.locator('#mtSearch')).toHaveAttribute('placeholder', 'Search apartment');

  await page.locator('[data-filter="mine"]').click();
  await expect.poll(async () => (await lists(page)).pop()).toContain('filter=mine');
  await expect(page.locator('[data-filter="mine"]')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('[data-filter="urgent"]').click();
  await expect.poll(async () => (await lists(page)).pop()).toContain('filter=urgent');
  await expect(page.locator('[data-filter="mine"]')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('[data-filter="urgent"]')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('[data-filter="urgent"]').click();
  await expect.poll(async () => (await lists(page)).pop()).not.toContain('filter=');
  await page.locator('#mtSearch').fill('westwood');
  await expect.poll(async () => (await lists(page)).pop()).toContain('q=westwood');
  expect((await lists(page)).pop()).toContain('tab=open');

  await r.nth(0).click();
  await expect(sheet(page).getByRole('heading', { name: 'AC not cooling' })).toBeVisible();
  expect(await hashOf(page)).toBe('#/maintenance?ref=MNT-14');
  await sheet(page).locator('.sheet-h [data-close]').click();
  await expect(page.locator('#sheet.on')).toHaveCount(0);
  await expect.poll(() => hashOf(page)).toBe('#/maintenance?tab=open');
});

test('Done : compte, fait par, cout seulement s il existe, note en texte, Reopen', async ({ page }) => {
  await bootMgr(page, [...ALL(), { match: 'action=mnt.act', status: 200, body: { ok: true, ticketId: 7, status: 'open' } }],
    { email: true, clock: NOW_MNT, hash: '#/maintenance?tab=done' });
  await expect(page.locator('.mt-help')).toHaveText('Last 30 days · 2 tickets');
  const d = page.locator('.mt-done');
  await expect(d.nth(0).locator('.mt-meta')).toHaveText('Done by Semax, Thu 8 · AED 120');
  await expect(d.nth(0).locator('.mt-note')).toHaveText('“Seal <i>replaced</i>”');
  expect(await d.nth(0).locator('i').count()).toBe(0);
  await expect(d.nth(1).locator('.mt-meta')).toHaveText('Done by Ismael, Wed 7');
  await expect(d.nth(1)).not.toContainText('AED');
  await d.nth(0).getByRole('button', { name: 'Reopen' }).click();
  await expect(page.locator('#toast')).toContainText('MNT-7 reopened');
  const a = await acts(page);
  expect(a).toHaveLength(1);
  expect(a[0]).toMatchObject({ op: 'ticket.reopen', ticketId: 7 });
});

test('See rejected : rejetees et fusionnees en lecture seule, raison et auteur', async ({ page }) => {
  await bootMgr(page, ALL(), { email: true, clock: NOW_MNT, hash: '#/maintenance' });
  await page.getByRole('button', { name: 'See rejected' }).click();
  await expect.poll(async () => (await lists(page)).pop()).toContain('rejected=1');
  const c = page.locator('.mt-card');
  await expect(c).toHaveCount(2);
  await expect(c.nth(0).locator('.mt-line')).toHaveText('Rejected by Walter, 08/10 · Other');
  await expect(c.nth(0).locator('.mt-note')).toHaveText('“Guest found it”');
  await expect(c.nth(1).locator('.mt-line')).toHaveText('Added to MNT-12 by Semax, 07/10');
  await expect(page.locator('.mt-card button')).toHaveCount(0);
  await page.getByRole('button', { name: 'Back to proposals' }).click();
  await expect(page.locator('.mt-card button[data-create]')).toHaveCount(1);
});

test('lien #/maintenance?ref=PRP-5 : feuille de proposition par mnt.get ; inconnu : toast', async ({ page }) => {
  const detail = { kind: 'proposal', proposal: { ...PRP(), sameListingOpen: [{ id: 14, ref: 'MNT-14', title: 'AC not cooling', category: 'ac' }] } };
  await bootMgr(page, [...ALL(), { match: 'ref=PRP-5', status: 200, body: detail }, { match: 'action=mnt.get', status: 404, body: { error: 'Not found.' } }],
    { email: true, clock: NOW_MNT, hash: '#/maintenance?ref=PRP-5' });
  await expect(sheet(page).locator('[data-mref="PRP-5"]')).toBeVisible();
  await expect(sheet(page).getByRole('heading', { name: 'AC not cooling in bedroom' })).toBeVisible();
  await expect(sheet(page).locator('[data-mact="merge"]')).toHaveText(/Add to MNT-14/);
  expect(await hashOf(page)).toBe('#/maintenance?ref=PRP-5');
  await page.keyboard.press('Escape');
  await expect.poll(() => hashOf(page)).toBe('#/maintenance');

  await page.evaluate(() => { location.hash = '#/maintenance?ref=PRP-99'; });
  await expect(page.locator('#toast')).toContainText('This proposal was not found.');
  await expect(page.locator('.mt-card')).toHaveCount(2);
  await expect(page.locator('#sheet.on')).toHaveCount(0);
  await expect.poll(() => hashOf(page)).toBe('#/maintenance');
});

test('donnees non fraiches : bandeau, aucun geste, Reconnect to make changes.', async ({ page }) => {
  await bootMgr(page, [me(MANAGER), { ...L.proposals(), once: true }, { match: 'action=mnt.list', status: 0, body: {}, fail: true }],
    { email: true, clock: NOW_MNT, hash: '#/maintenance' });
  await expect(page.locator('.mt-card')).toHaveCount(2);
  await page.locator('[data-tab="open"]').click();
  await expect(page.locator('.err-card')).toContainText('No connection. Try again.');
  await page.locator('[data-tab="proposals"]').click();
  await expect(page.locator('#mtBanner .banner.warn')).toContainText('No connection. Try again.');
  await expect(page.locator('#mtAsof')).toHaveClass(/stale/);
  await page.locator('.mt-card').nth(0).getByRole('button', { name: 'Create ticket' }).click();
  await expect(page.locator('#toast')).toContainText('Reconnect to make changes.');
  await expect(page.locator('#sheet.on')).toHaveCount(0);
  await page.locator('.mt-card').nth(1).getByRole('button', { name: 'More' }).click();
  await expect(sheet(page).locator('.ro-note')).toHaveText('Reconnect to make changes.');
  await expect(sheet(page).locator('[data-mact]')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await page.locator('.mt-card').nth(1).getByRole('button', { name: 'Add to MNT-12' }).click();
  await expect(page.locator('#toast')).toContainText('Reconnect to make changes.');
  expect(await acts(page)).toHaveLength(0);
});

test('Semax : atterrit sur Maintenance ; 375 px sans defilement horizontal, cibles de 44 px', async ({ page }, info) => {
  test.skip(info.project.name !== 'mgr-mobile', 'largeur telephone');
  await page.setViewportSize({ width: 375, height: 760 });
  await bootMgr(page, [me(SEMAX), L.rejected(), L.proposals(), L.open(), L.done()], { email: true, clock: NOW_MNT, hash: '' });
  await expect(page.locator('.mt-card')).toHaveCount(2);
  for (const view of ['proposals', 'open', 'done']) {
    await page.locator('[data-tab="' + view + '"]').click();
    await expect(page.locator('[data-tab="' + view + '"]')).toHaveAttribute('aria-pressed', 'true');
    await page.waitForTimeout(100);
    const s = await noHorizontalScroll(page);
    expect(s.scrollWidth).toBeLessThanOrEqual(s.clientWidth);
  }
  await page.locator('[data-tab="proposals"]').click();
  await page.locator('.mt-card').nth(0).getByRole('button', { name: 'Create ticket' }).click();
  await expect(sheet(page).locator('#mtTitle')).toBeVisible();
  const s = await noHorizontalScroll(page);
  expect(s.scrollWidth).toBeLessThanOrEqual(s.clientWidth);
  const small = await page.evaluate(() => Array.from(document.querySelectorAll('#main button, #sheet.on button'))
    .filter((b: any) => b.offsetParent !== null && b.getBoundingClientRect().height < 44)
    .map((b: any) => b.textContent.trim()));
  expect(small).toEqual([]);
});
