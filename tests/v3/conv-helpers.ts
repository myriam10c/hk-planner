import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { bootV3, fetchLog } from './helpers';

// Journee, routes du proxy simule et gestes communs aux tests des ecritures de la
// conversation (tache 5 du branchement) : conversation-write.spec.ts et offline.spec.ts.

export const PNG_1x1 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
export const dubaiToday = () => new Date(Date.now() + 4 * 3600e3).toISOString().slice(0, 10);

const base = {
  aptNumber: null, templateName: 'Studio', checkOutTime: '11:00', guest: 'Marc L.', nextGuest: null,
  checklist: [], photoRequired: [], progress: {}, label: null, othersOnJob: [], openTickets: [],
  state: 'todo', startedAt: null, sameDay: false, nextArrivalDate: null, nextArrivalTime: null,
  role: 'lead', leadId: null, myStartedAt: null,
};
export const BLOOM = {
  ...base, jobId: 'job_0000000000000blm1011', listingId: '203', listingName: '1011C - Bloom Towers',
  unitType: 'Studio', estimatedMinutes: 100, rooms: ['Bed', 'Bathroom', 'Kitchen'], heroPhotoUrl: null, references: {},
};
export const CREEK = {
  ...base, jobId: 'job_0000000000000crk1506', listingId: '202', listingName: '1506 - Emaar Creekside 18A',
  unitType: '2 BHK', templateName: '2 Bedrooms', estimatedMinutes: 150, state: 'running',
  startedAt: '2026-10-02T06:05:00Z', role: 'helper', leadId: 7,
  othersOnJob: [{ id: 7, name: 'Pionah', startedAt: '2026-10-02T06:05:00Z' }],
  rooms: ['Bedroom 1', 'Bedroom 2', 'Living room', 'Kitchen', 'Bathroom 1', 'Bathroom 2', 'Balcony'],
  heroPhotoUrl: null, references: {},
};
export const DAY = {
  status: 'success', date: dubaiToday(), me: { id: 4, name: 'Faiza', role: 'cleaner' }, linenRequired: true,
  totalMinutes: 250, stops: [BLOOM, CREEK],
};
export const WRITE_ROUTES = [
  { match: 'action=v3.myDay', status: 200, body: DAY },
  { match: 'action=v3.startJob', status: 200, body: { status: 'success', startedAt: '2026-10-02T06:00:00Z' } },
  { match: 'action=v3.uploadPhoto', status: 200, body: { status: 'success', photoId: 501, path: 'v3/x.jpg' } },
  { match: 'action=v3.reportProblem', status: 200, body: { status: 'success', ticketId: 812, priority: 'medium' } },
  { match: 'action=v3.addProblemPhoto', status: 200, body: { status: 'success', ticketId: 812 } },
  { match: 'action=v3.setProblemNote', status: 200, body: { status: 'success', ticketId: 812 } },
  { match: 'action=v3.updateProblem', status: 200, body: { status: 'success', ticketId: 812 } },
  { match: 'action=v3.deleteProblem', status: 200, body: { status: 'success', ticketId: 812 } },
  { match: 'action=v3.deletePhoto', status: 200, body: { status: 'success', photoId: 501 } },
  { match: 'action=v3.finishJob', status: 200, body: { status: 'success', role: 'lead', durationMinutes: 90 } },
];

export async function demarrer(page: Page, routes = WRITE_ROUTES) {
  await page.addInitScript(() => {
    if (navigator.mediaDevices) {
      navigator.mediaDevices.getUserMedia = async () => { throw new DOMException('denied', 'NotAllowedError'); };
    }
    (window as any).__shared = [];
    (navigator as any).share = async (d: any) => { (window as any).__shared.push({ text: d.text, files: (d.files || []).length }); };
    (navigator as any).canShare = () => true;
  });
  await bootV3(page, routes, { pinToken: 'jeton-pin' });
  await expect(page.locator('.row').first()).toBeVisible();
}

export async function photo(page: Page, act = 'shutter') {
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.locator('[data-act="' + act + '"]').click()]);
  await chooser.setFiles({ name: 'p.png', mimeType: 'image/png', buffer: Buffer.from(PNG_1x1, 'base64') });
}

export async function piece(page: Page, step: number, nom: string) {
  await expect(page.locator('.vf-top b')).toHaveText(new RegExp('^Step ' + step + ' · ' + nom + ' '));
  await photo(page);
  await expect(page.locator('.vf .count')).toHaveText('1 photo');
  await page.locator('.vf [data-reply="next-room"]').click();
}

// Carte d'acces et cles (22/10) : premiere photo de l'arrivee, juste apres I'm here (jamais
// pour l'aide). Next reste inactif tant qu'aucune photo n'est prise.
export async function carteAcces(page: Page) {
  await expect(page.locator('.vf-top b')).toHaveText('Step 1 · Access card & keys · as you find them');
  await expect(page.locator('.vf [data-reply="next-room"]')).toBeDisabled();
  await photo(page);
  await expect(page.locator('.vf .count')).toHaveText('1 photo');
  await page.locator('.vf [data-reply="next-room"]').click();
}

// Ecritures au proxy (hors lecture de la journee), une entree par cle d'idempotence : la
// derniere tentative de chaque cle, dans l'ordre de la premiere. Les essais hors ligne
// (rejetes avant le reseau) comptent dans le journal, pas comme des ecritures distinctes.
export async function ecritures(page: Page) {
  const log = (await fetchLog(page)).filter((l) => l.url.indexOf('hostaway-proxy') !== -1 && l.url.indexOf('action=v3.myDay') === -1);
  const parIdem = new Map<string, { action: string; body: any; essais: number }>();
  for (const l of log) {
    const action = decodeURIComponent((l.url.match(/action=([^&]+)/) || [])[1] || '');
    const body = l.body ? JSON.parse(l.body) : {};
    const prev = parIdem.get(body.idem);
    parIdem.set(body.idem, { action, body, essais: (prev ? prev.essais : 0) + 1 });
  }
  return [...parIdem.values()];
}

export async function fileVide(page: Page) {
  await expect.poll(async () => page.evaluate(async () => {
    const m = await import('/v3/offline.js');
    return (await m.pendingEntries()).length;
  }), { timeout: 15_000 }).toBe(0);
}


// Retour du reseau : la file se vide meme si le rejeu automatique attend son delai
// (RETRY_MS) ; chaque tour de l'attente relance un rejeu et lit l'etat de la file.
export async function fileVideApresRetour(page: Page) {
  await expect.poll(async () => page.evaluate(async () => {
    const m = await import('/v3/offline.js');
    await m.flush();
    return (await m.pendingEntries()).length;
  }), { timeout: 30_000 }).toBe(0);
}
