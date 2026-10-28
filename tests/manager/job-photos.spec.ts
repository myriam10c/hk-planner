import { test, expect } from '@playwright/test';
import { bootMgr, fetchLog, MANAGER, me } from './helpers';
import { isMobile, openJob, PLAN, PNOW } from './planning-fixtures';

// Photos d'un menage dans la fiche du planning (28/10/2026) : getPhotos par cle,
// avant / apres, miniatures cliquables vers l'URL signee.
const KEY = '2026-10-06_Ann Lee';
const PHOTOS = {
  match: 'action=getPhotos', status: 200, body: {
    status: 'success', photos: [
      { id: 'v3-2', photo_type: 'after', label: 'Kitchen', author: 'Pionah', created_at: '2026-10-06T11:00:00Z', url: 'https://signed.test/2.jpg' },
      { id: 'v3-1', photo_type: 'before', label: 'Arrival · Bed', author: 'Pionah', created_at: '2026-10-06T10:00:00Z', url: 'https://signed.test/1.jpg' },
      { id: 5, photo_type: 'after', author: 'Walter', created_at: '2026-10-06T12:00:00Z', url: null },
    ],
  },
};

test('fiche du menage : photos avant et apres', async ({ page }, info) => {
  await bootMgr(page, [me(MANAGER), PLAN(), PHOTOS], { email: true, hash: '#/planning', clock: PNOW });
  await openJob(page, isMobile(info), KEY, '2026-10-06');
  const blk = page.locator('#sheet .jp');
  await expect(blk.locator('h4')).toHaveText(['Before cleaning 1', 'After cleaning 1']);
  await expect(blk.locator('img')).toHaveCount(2);
  await expect(blk.locator('a').first()).toHaveAttribute('href', 'https://signed.test/1.jpg');
  const urls = (await fetchLog(page)).filter((l) => l.url.includes('action=getPhotos')).map((l) => l.url);
  expect(urls[0]).toContain('key=' + encodeURIComponent(KEY));
});

test('fiche du menage : aucune photo', async ({ page }, info) => {
  await bootMgr(page, [me(MANAGER), PLAN(), { ...PHOTOS, body: { status: 'success', photos: [] } }], { email: true, hash: '#/planning', clock: PNOW });
  await openJob(page, isMobile(info), KEY, '2026-10-06');
  await expect(page.locator('#sheet .jp')).toContainText('No photos for this cleaning yet.');
});
