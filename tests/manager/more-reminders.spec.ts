import { test, expect } from '@playwright/test';
import { bootMgr, fetchLog, MANAGER, me, noHorizontalScroll, type FakeRoute } from './helpers';

const TEXTS = {
  r1: 'Urgent ticket with no one assigned: {title}.', r2: 'No one: {title}.', r3: '{title} is assigned to you.',
  r4: 'No update for {hours} h on {title}.', r6: '{title} is past due.', r7: '{count} cleanings tomorrow.',
  r8: 'Cleaning at {apt} is not done.', r9: 'Proposal waiting: {title}.', r10: '{who} got {count} reminders.',
};
const CONFIG = {
  enabled: true,
  rules: { r1: true, r2: true, r3: true, r4: true, r5: true, r6: true, r7: true, r8: true, r9: true, r10: true },
  urgentUnassignedMin: 30, unassignedNoDueMin: 1440, assignedFirstMin: 120, assignedSecondMin: 240,
  inProgressStaleMin: 1440, proposalPendingMin: 1440, guestFactor: 0.5, quiet: { start: '21:00', end: '07:00' },
  tomorrowCheckAt: '09:15', cleaningLateMin: 120, cleaningDefaultTime: '11:00', maxPerSubjectPerDay: 3,
  minGapMin: 60, escalateAfter: 2, escalateGraceMin: 60, digestOver: 3, managerIds: null, texts: TEXTS,
};
const READ = { config: CONFIG, defaults: CONFIG, managers: [{ id: 8, name: 'Walter' }, { id: 9, name: 'Harlene' }], people: [] };
const LOG = {
  rows: [
    { id: 1, sentAt: '2026-10-20T10:05:00Z', rule: 'r1', subjectKind: 'ticket', subjectRef: 'MNT-42', recipientId: 8, recipientName: 'Walter',
      title: 'URGENT · 305 Neva Residence', body: 'Urgent ticket with no one assigned: AC leak.', urgent: true, status: 'sent', readAt: null },
    { id: 2, sentAt: '2026-10-20T09:00:00Z', rule: 'r8', subjectKind: 'cleaning', subjectRef: 'c-77', recipientId: 12, recipientName: 'Faiza',
      title: 'Cleaning late', body: 'Cleaning at 1203 Marina is not done.', urgent: false, status: 'no_subscription', readAt: null },
  ],
};

const boot = (page: any, extra: FakeRoute[] = []) =>
  bootMgr(page, [me(MANAGER), ...extra, { match: 'action=rem.config', status: 200, body: READ }], { email: true, hash: '#/more/reminders' });
const posts = async (page: any, action: string) =>
  (await fetchLog(page)).filter((l) => l.url.endsWith('action=' + action)).map((l) => JSON.parse(l.body));

test('aides pures : patch minimal, heures, liens, message du test', async ({ page }) => {
  await boot(page);
  const r = await page.evaluate(async () => {
    const m = await import('/manager/screens/more-reminders.js');
    const cfg = { quiet: { start: '21:00', end: '07:00' }, minGapMin: 60, managerIds: [8, 9], rules: { r1: true } };
    return {
      patch: m.remPatch(cfg, { 'quiet.start': '22:00', 'quiet.end': '07:00', minGapMin: 60, managerIds: [9, 8], 'rules.r1': false }),
      h: m.fromInput('2.5', { label: 'After', unit: 'h', lo: 1, hi: 10080 }),
      bad: m.fromInput('0', { label: 'Max', unit: 'n', lo: 1, hi: 10 }),
      frac: m.fromInput('1.5', { label: 'Gap', unit: 'min', lo: 0, hi: 1440 }),
      time: m.fromInput('9:15', { label: 'Check at', unit: 'time' }),
      show: m.toInput(90, 'h'),
      mnt: m.refHref('MNT-42'), prp: m.refHref('PRP-3'), other: m.refHref('c-77'),
      sent: m.testMessage({ sent: 1, skipped: [] }),
      none: m.testMessage({ sent: 0, skipped: 'no_subscription' }),
    };
  });
  expect(r.patch).toEqual({ quiet: { start: '22:00' }, rules: { r1: false } });
  expect(r.h).toEqual({ value: 150 });
  expect(r.bad.error).toContain('between 1 and 10');
  expect(r.frac.error).toContain('whole numbers');
  expect(r.time.error).toContain('HH:MM');
  expect(r.show).toBe('1.5');
  expect(r.mnt).toBe('#/maintenance?ref=MNT-42');
  expect(r.prp).toBe('#/maintenance?ref=PRP-3');
  expect(r.other).toBeNull();
  expect(r.sent).toContain('Test sent');
  expect(r.none).toBe('No notifications on this phone yet: turn them on first');
});

test('ecran : interrupteur general, regles, limites, destinataires, sans defilement horizontal', async ({ page }) => {
  await boot(page);
  await expect(page.getByRole('heading', { name: 'Reminders', exact: true })).toBeVisible();
  await expect(page.getByRole('switch', { name: 'Automatic reminders' })).toBeChecked();
  await expect(page.locator('[data-enabled-state]')).toContainText('ON');
  await expect(page.locator('main .rem-rule')).toHaveCount(10);
  await expect(page.getByLabel('First reminder after')).toHaveValue('2');
  await expect(page.getByLabel('Quiet hours start (Dubai time)')).toHaveValue('21:00');
  await expect(page.getByRole('switch', { name: 'All active managers' })).toBeChecked();
  const s = await noHorizontalScroll(page);
  expect(s.scrollWidth).toBeLessThanOrEqual(s.clientWidth);
});

test('interrupteur general OFF : patch {enabled:false} immediat', async ({ page }) => {
  await boot(page, [{ match: 'action=rem.config.set', status: 200, body: { config: { ...CONFIG, enabled: false } } }]);
  await page.getByRole('switch', { name: 'Automatic reminders' }).click();
  await expect(page.locator('#toast')).toContainText('Reminders off');
  await expect(page.locator('[data-enabled-state]')).toContainText('OFF');
  expect(await posts(page, 'rem.config.set')).toEqual([{ patch: { enabled: false } }]);
});

test('Save des regles : seulement les champs modifies, heures en minutes', async ({ page }) => {
  await boot(page, [{ match: 'action=rem.config.set', status: 200, body: { config: CONFIG } }]);
  await page.getByRole('switch', { name: 'R2 No one and no due date' }).click();
  await page.getByLabel('First reminder after').fill('3');
  await page.locator('main [data-save="rules"]').click();
  await expect(page.locator('#toast')).toContainText('Saved');
  expect(await posts(page, 'rem.config.set')).toEqual([{ patch: { rules: { r2: false }, assignedFirstMin: 180 } }]);
});

test('Save des limites : erreur serveur en ligne', async ({ page }) => {
  await boot(page, [{ match: 'action=rem.config.set', status: 400, body: { error: 'minGapMin must be 0 to 1440.' } }]);
  await page.getByLabel('Max reminders per ticket per day').fill('5');
  await page.locator('main [data-save="limits"]').click();
  await expect(page.locator('main').getByText('minGapMin must be 0 to 1440.')).toBeVisible();
  expect(await posts(page, 'rem.config.set')).toEqual([{ patch: { maxPerSubjectPerDay: 5 } }]);
});

test('destinataires : un seul manager coche', async ({ page }) => {
  await boot(page, [{ match: 'action=rem.config.set', status: 200, body: { config: { ...CONFIG, managerIds: [8] } } }]);
  await page.getByRole('switch', { name: 'All active managers' }).click();
  await page.locator('main [data-mgr="9"]').uncheck();
  await page.locator('main [data-save="recipients"]').click();
  await expect(page.locator('#toast')).toContainText('Saved');
  expect(await posts(page, 'rem.config.set')).toEqual([{ patch: { managerIds: [8] } }]);
});

test('test URGENT : toast sans abonnement ; restaurer les defauts apres confirmation', async ({ page }) => {
  await boot(page, [
    { match: 'action=rem.test', status: 200, body: { sent: 0, skipped: 'no_subscription' } },
    { match: 'action=rem.config.set', status: 200, body: { config: CONFIG } },
  ]);
  await page.getByRole('button', { name: 'Send me a test URGENT notification' }).click();
  await expect(page.locator('#toast')).toContainText('No notifications on this phone yet: turn them on first');
  await page.getByRole('button', { name: 'Restore defaults' }).click();
  await page.getByRole('button', { name: 'Yes, restore' }).click();
  await expect(page.locator('#toast')).toContainText('Defaults restored');
  expect(await posts(page, 'rem.config.set')).toEqual([{ patch: { reset: true } }]);
});

test('journal : lignes, lien du ticket, badge urgent, sans defilement horizontal', async ({ page }) => {
  await boot(page, [{ match: 'action=rem.log', status: 200, body: LOG }]);
  await page.getByRole('tab', { name: 'Log' }).click();
  const rows = page.locator('main .rem-log tbody tr');
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0).getByRole('link', { name: 'MNT-42' })).toHaveAttribute('href', '#/maintenance?ref=MNT-42');
  await expect(rows.nth(0)).toContainText('URGENT');
  await expect(rows.nth(0)).toContainText('Walter');
  await expect(rows.nth(0)).toContainText('14:05');
  await expect(rows.nth(0)).toContainText('Not read');
  await expect(rows.nth(1)).toContainText('No phone subscribed');
  expect((await fetchLog(page)).some((l) => l.url.includes('action=rem.log&limit=200'))).toBe(true);
  const s = await noHorizontalScroll(page);
  expect(s.scrollWidth).toBeLessThanOrEqual(s.clientWidth);
});
