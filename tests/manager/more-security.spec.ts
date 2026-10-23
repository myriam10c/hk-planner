import { test, expect } from '@playwright/test';
import { bootMgr, MANAGER, me, noHorizontalScroll, type FakeRoute } from './helpers';
import { PNOW } from './planning-fixtures';

// Reponse au format de getSecurityContacts (security_contacts.ts) : le document entier.
const DOC = {
  buildings: [
    {
      name: 'Binghatti Lavender',
      groups: [{
        units: ['308', '309'], phone: '+971 50 111 2222', phoneDigits: '971501112222', emails: ['sec@bl.test'],
        portal: 'https://portal.bl.test', portalId: 'medini01', portalPassword: 'S3cret!', notes: ['Gate code at desk'],
        unitLinks: [{ unit: '308', dtcm: 'https://drive.test/permit308', det: null }],
      }],
    },
    { name: 'Elysée 1', groups: [{ units: ['404'], phone: '', emails: ['desk@elysee.test'], notes: [] }] },
  ],
};
const SEC: FakeRoute = { match: 'action=getSecurityContacts', status: 200, body: DOC };
const boot = (page: any, hash: string, routes: FakeRoute[]) => bootMgr(page, [me(MANAGER), ...routes], { email: true, hash, clock: PNOW });

test('Security : tous les immeubles, appel, WhatsApp, portail, identifiants copiables, recherche', async ({ page }) => {
  await boot(page, '#/more/security', [SEC]);
  await expect(page.getByRole('heading', { name: 'Security', exact: true })).toBeVisible();
  const cards = page.locator('main section.card');
  await expect(cards).toHaveCount(2);
  const b = cards.first();
  await expect(b.locator('h2')).toHaveText('Binghatti Lavender');
  await expect(b).toContainText('2 units');
  await expect(b.getByRole('link', { name: 'Call +971 50 111 2222' })).toHaveAttribute('href', 'tel:+971501112222');
  await expect(b.getByRole('link', { name: 'WhatsApp' })).toHaveAttribute('href', 'https://wa.me/971501112222');
  await expect(b.getByRole('link', { name: 'Portal' })).toHaveAttribute('href', 'https://portal.bl.test');
  await expect(b.getByRole('link', { name: 'Permit' })).toHaveAttribute('href', 'https://drive.test/permit308');
  await expect(b).toContainText('S3cret!');
  await expect(b.getByRole('button', { name: 'Copy password' })).toBeVisible();
  const q = page.getByLabel('Search building, unit, email or phone');
  await q.fill('elysee');
  await expect(cards).toHaveCount(1);
  await expect(cards.first().locator('h2')).toHaveText('Elysée 1');
  await q.fill('309');
  await expect(cards.first().locator('h2')).toHaveText('Binghatti Lavender');
  await q.fill('zzz');
  await expect(cards).toHaveCount(0);
  await expect(page.locator('main')).toContainText('No building matches.');
  const s = await noHorizontalScroll(page);
  expect(s.scrollWidth).toBeLessThanOrEqual(s.clientWidth);
});

test('Security : ?q= pre-remplit la recherche (lien de la fiche appartement)', async ({ page }) => {
  await boot(page, '#/more/security?q=Binghatti%20Lavender', [SEC]);
  await expect(page.getByLabel('Search building, unit, email or phone')).toHaveValue('Binghatti Lavender');
  await expect(page.locator('main section.card')).toHaveCount(1);
});

test('Security : erreur du serveur, Retry', async ({ page }) => {
  await boot(page, '#/more/security', [{ ...SEC, status: 500, body: { error: 'boom' }, once: true }, SEC]);
  await expect(page.getByRole('alert')).toBeVisible();
  await page.getByRole('button', { name: 'Retry' }).click();
  await expect(page.locator('main section.card')).toHaveCount(2);
});
