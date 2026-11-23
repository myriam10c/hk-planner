import type { Page } from '@playwright/test';
import type { FakeRoute } from './helpers';
import { NOW } from './fixtures';

// Position de l'equipe (ecran More > Where is everyone) : jeux d'essai de
// locations.spec.ts, repris par look.spec.ts. NOW = 11:00 Dubai.
const PNG_1PX = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
export const ago = (min: number) => new Date(NOW.getTime() - min * 60000).toISOString();

// Format de mgrLocations (supabase/functions/hostaway-proxy/team_locations.ts).
export const PEOPLE = [
  { id: 4, name: 'Faiza', role: 'cleaner', color: '#7a5af8',
    location: { lat: 25.0805, lng: 55.1403, accuracy: 12, recordedAt: ago(4), ageMin: 4,
      place: { kind: 'at', listingId: 'L2', label: '103 · Damac Reva', distanceM: 40 } } },
  { id: 7, name: 'Semax', role: 'maintenance', color: '#0e9384',
    location: { lat: 25.197, lng: 55.274, accuracy: 30, recordedAt: ago(125), ageMin: 125,
      place: { kind: 'near', listingId: 'L9', label: '1205 · Marina Gate', distanceM: 1234 } } },
  // 2026-10-08 18:40 Dubai : hier.
  { id: 8, name: 'Walter', role: 'manager', color: '#e94560',
    location: { lat: 25.1, lng: 55.2, accuracy: 20, recordedAt: '2026-10-08T14:40:00.000Z', ageMin: 980,
      place: { kind: 'near', listingId: 'L3', label: '404 · Elysee', distanceM: 450 } } },
  { id: 10, name: 'Pionah', role: 'cleaner', color: '#dd2590', location: null },
];
export const LOCS: FakeRoute = { match: 'action=mgr.locations', status: 200, body: { generatedAt: NOW.toISOString(), people: PEOPLE } };

export async function tiles(page: Page) {
  await page.route(/tile\.openstreetmap\.org/, (r) => r.fulfill({ status: 200, contentType: 'image/png', body: Buffer.from(PNG_1PX, 'base64') }));
}
