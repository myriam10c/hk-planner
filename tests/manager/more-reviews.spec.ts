import { test, expect } from '@playwright/test';
import { bootMgr, fetchLog, MANAGER, me, noHorizontalScroll, type FakeRoute } from './helpers';

const rv = (id: number, status: string, o: any = {}) => ({
  id, rating: 2, listing_name: 'Apt 1204 Marina Gate', reviewer_name: 'Anna', public_review: 'Dirty place',
  submitted_at: '2026-10-01T10:00:00Z', reservation_id: 900 + id,
  dispute: {
    review_id: id, dispute_status: status, reply_posted: false, confidence: 'STRONG', ground: 'irrelevant', template: 2,
    quote: 'The wifi was slow', angle: 'Not about the stay', evidence: ['Screenshot of the thread', 'Check-in log'],
    public_reply: 'Thank you for your feedback.', public_review_en: null, ...o,
  },
});
const DATA = {
  status: 'success',
  reviews: [
    rv(1, 'todo'), rv(2, 'todo', { public_review_en: 'Great but noisy' }), rv(3, 'submitted'),
    rv(4, 'removed'), rv(5, 'rejected'), rv(6, 'not_disputable'),
    { id: 7, rating: 1, listing_name: 'Studio Burj', reviewer_name: 'Bob', public_review: 'Bad', submitted_at: '2026-09-30T10:00:00Z', dispute: null },
  ],
};
DATA.reviews[1].public_review = 'Tres bruyant';
const READ: FakeRoute = { match: 'action=getDisputes', status: 200, body: DATA };
const boot = (page: any, extra: FakeRoute[] = [], read: FakeRoute[] = [READ]) =>
  bootMgr(page, [me(MANAGER), ...extra, ...read], { email: true, hash: '#/more/reviews' });
const posts = async (page: any) =>
  (await fetchLog(page)).filter((l: any) => l.url.endsWith('action=updateDisputeStatus') && l.body).map((l: any) => JSON.parse(l.body));

test('puces : compteurs, filtre, To do par defaut, All sans exclusion', async ({ page }) => {
  await boot(page);
  await expect(page.getByRole('heading', { name: 'Reviews', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'More', exact: true }).first()).toHaveAttribute('href', '#/more');
  const chip = (n: string) => page.locator('main .rv-chip', { hasText: n });
  await expect(chip('To do')).toContainText('3'); // 2 todo + 1 sans analyse
  await expect(chip('Submitted')).toContainText('1');
  await expect(chip('Removed')).toContainText('1');
  await expect(chip('Rejected')).toContainText('1');
  await expect(chip('Not disputable')).toContainText('1');
  await expect(chip('All')).toContainText('7');
  await expect(page.locator('main .rv-card')).toHaveCount(3);
  await chip('Submitted').click();
  await expect(page.locator('main .rv-card')).toHaveCount(1);
  await expect(page.locator('main [data-review="3"]')).toBeVisible();
  await chip('All').click();
  await expect(page.locator('main .rv-card')).toHaveCount(7);
  await expect(page.locator('main [data-review="7"]')).toContainText('Not analyzed yet');
});

test('carte : traduction EN d abord, original replie, litige detaille', async ({ page }) => {
  await boot(page);
  const c2 = page.locator('main [data-review="2"]');
  await expect(c2.locator('[data-en]')).toHaveText('Great but noisy');
  await expect(c2.locator('.rv-orig p')).toBeHidden();
  await c2.locator('.rv-orig summary').click();
  await expect(c2.locator('.rv-orig p')).toHaveText('Tres bruyant');
  const c1 = page.locator('main [data-review="1"]');
  await expect(c1).toContainText('Apt 1204 Marina Gate');
  await expect(c1).toContainText('Anna');
  await expect(c1).toContainText('2026-10-01');
  await expect(c1.locator('.rv-stars')).toHaveAttribute('aria-label', '2 out of 5 stars');
  await expect(c1).toContainText('strong, irrelevant');
  await expect(c1).toContainText('Not about the stay');
  await expect(c1).toContainText('Screenshot of the thread');
  await expect(c1).toContainText('Airbnb allows two removal requests per review.');
});

test('Copy ecrit citation et reponse dans le presse-papiers', async ({ page }) => {
  await page.addInitScript(() => {
    (window as any).__copied = [];
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: (t: string) => { (window as any).__copied.push(t); return Promise.resolve(); } }, configurable: true });
  });
  await boot(page);
  const c1 = page.locator('main [data-review="1"]');
  await c1.getByRole('button', { name: 'Copy quote to cite' }).click();
  await c1.getByRole('button', { name: 'Copy public reply' }).click();
  expect(await page.evaluate(() => (window as any).__copied)).toEqual(['The wifi was slow', 'Thank you for your feedback.']);
});

test('statut : POST sans updated_by, la carte change une fois confirme', async ({ page }) => {
  const upd: FakeRoute = { match: 'action=updateDisputeStatus', status: 200, delay: 300, body: { status: 'success', dispute: { ...DATA.reviews[0].dispute, dispute_status: 'submitted' } } };
  await boot(page, [upd]);
  const c1 = page.locator('main [data-review="1"]');
  await c1.getByRole('button', { name: 'Submitted', exact: true }).click();
  await expect(c1.locator('.rv-sbtn').first()).toBeDisabled();
  await expect(page.locator('main [data-review="1"]')).toHaveCount(0); // quitte la liste To do
  const p = await posts(page);
  expect(p).toEqual([{ review_id: 1, dispute_status: 'submitted' }]);
  await page.locator('main .rv-chip', { hasText: 'Submitted' }).click();
  await expect(page.locator('main [data-review="1"] .rv-sbtn[aria-pressed="true"]')).toHaveText('Submitted');
  await expect(page.locator('main .rv-chip', { hasText: 'Submitted' })).toContainText('2');
});

test('Reply posted : interrupteur, POST reply_posted sans updated_by', async ({ page }) => {
  const upd: FakeRoute = { match: 'action=updateDisputeStatus', status: 200, body: { status: 'success', dispute: { ...DATA.reviews[0].dispute, reply_posted: true } } };
  await boot(page, [upd]);
  const sw = page.locator('main [data-review="1"] [role="switch"]');
  await expect(sw).toHaveAttribute('aria-checked', 'false');
  await sw.click();
  await expect(sw).toHaveAttribute('aria-checked', 'true');
  expect(await posts(page)).toEqual([{ review_id: 1, reply_posted: true }]);
});

test('404 « review not analyzed yet » : erreur sur la carte, statut inchange', async ({ page }) => {
  await boot(page, [{ match: 'action=updateDisputeStatus', status: 404, body: { error: 'review not analyzed yet' } }]);
  const c1 = page.locator('main [data-review="1"]');
  await c1.getByRole('button', { name: 'Removed', exact: true }).click();
  await expect(c1.locator('.rv-err')).toHaveText('review not analyzed yet');
  await expect(c1.locator('.rv-sbtn[aria-pressed="true"]')).toHaveText('Back to To do');
  await expect(c1.locator('.rv-sbtn').first()).toBeEnabled();
  await expect(page.locator('main .rv-chip', { hasText: 'To do' })).toContainText('3');
});

test('lecture en echec : message du serveur et Retry', async ({ page }) => {
  await boot(page, [], [{ match: 'action=getDisputes', status: 500, body: { error: 'boom' }, once: true }, READ]);
  await expect(page.locator('main [role="alert"]')).toHaveText('boom');
  await page.getByRole('button', { name: 'Retry' }).click();
  await expect(page.locator('main .rv-card').first()).toBeVisible();
});

test('403 non manager : message affiche, pas de liste', async ({ page }) => {
  await boot(page, [], [{ match: 'action=getDisputes', status: 403, body: { error: 'Only managers can do this.' } }]);
  await expect(page.locator('main [role="alert"]')).toHaveText('Only managers can do this.');
});

test('mobile 390 : pas de defilement horizontal, cibles 44 px', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await boot(page);
  await expect(page.locator('main .rv-card').first()).toBeVisible();
  const w = await noHorizontalScroll(page);
  expect(w.scrollWidth).toBeLessThanOrEqual(w.clientWidth);
  for (const b of await page.locator('main [data-review="1"] button, main .rv-chip').all()) {
    expect((await b.boundingBox())!.height).toBeGreaterThanOrEqual(43.5);
  }
});

test('revenir sur Reviews apres More : un seul ecouteur, une seule requete par changement', async ({ page }) => {
  const upd: FakeRoute = { match: 'action=updateDisputeStatus', status: 200, body: { status: 'success', dispute: { ...DATA.reviews[0].dispute, dispute_status: 'submitted' } } };
  await boot(page, [upd]);
  await expect(page.locator('main [data-review="1"]')).toBeVisible();
  await page.getByRole('link', { name: 'More', exact: true }).first().click();
  await expect(page.getByRole('heading', { name: 'More', exact: true })).toBeVisible();
  await page.locator('main a[href="#/more/reviews"]').click();
  await expect(page.locator('main [data-review="1"]')).toBeVisible();
  await page.locator('main [data-review="1"]').getByRole('button', { name: 'Submitted' }).click();
  await expect(page.locator('main .rv-chip', { hasText: 'To do' })).toContainText('2');
  await expect(page.locator('main [data-review="1"]')).toHaveCount(0);
  expect(await posts(page)).toHaveLength(1);
});
