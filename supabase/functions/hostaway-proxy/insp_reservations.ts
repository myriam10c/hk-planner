import type { InspReservation } from "./insp_rules.ts";

const heure = (v: unknown) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : null; };

export function normalizeReservations(raw: any[]): InspReservation[] {
  const seen = new Set<string>();
  const out: InspReservation[] = [];
  for (const r of raw ?? []) {
    const listingId = String(r?.listingMapId ?? r?.listingId ?? "");
    if (!listingId || !r?.arrivalDate || !r?.departureDate) continue;
    const key = r?.id != null ? String(r.id) : listingId + "|" + r.arrivalDate + "|" + r.departureDate;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      listingId, arrival: String(r.arrivalDate), departure: String(r.departureDate), status: String(r.status ?? ""),
      checkInTime: heure(r.checkInTime), checkOutTime: heure(r.checkOutTime),
    });
  }
  return out;
}

// Cache « au chaud » des reservations Hostaway (cle proxy_cache `insp:res:<day>`).
// Cache du jour present : toujours servi tout de suite ; des 2 min il est rafraichi
// en arriere-plan (une seule revalidation en vol par cle et par isolat). Sans cache
// du jour : fetch synchrone. Une revalidation en echec marque la ligne `failedAt`
// SANS toucher updated_at : cachedAt (bandeau « Bookings data from ») n'est renvoye
// que dans ce cas, jamais sur la seule anciennete du cache.
const RES_FRESH_MS = 2 * 60 * 1000;
const revalidating = new Set<string>();
export function _resetInflightForTests() { revalidating.clear(); }

export async function loadReservationsCached<T = InspReservation>(
  sb: any, day: string,
  deps: {
    fetchHostaway: (day: string) => Promise<T[]>;
    now?: () => number;
    waitUntil?: (p: Promise<unknown>) => void;
    // Cle proxy_cache. Defaut : celle d'Inspections. L'app manager garde son propre
    // instantane (guest et fenetre de 14 jours en plus) sous mgr:res:<day>.
    cacheKey?: string;
  },
): Promise<{ reservations: T[]; cachedAt: string | null }> {
  const now = deps.now ?? Date.now;
  const key = deps.cacheKey ?? "insp:res:" + day;
  const write = async (payload: unknown, updated_at: string) => {
    const { error } = await sb.from("proxy_cache").upsert({ key, payload, updated_at });
    if (error) console.error("[insp] proxy_cache upsert failed:", error);
  };
  const { data: row } = await sb.from("proxy_cache").select("payload, updated_at").eq("key", key).maybeSingle();
  if (row?.payload) {
    const age = now() - new Date(row.updated_at).getTime();
    const reservations = row.payload.reservations ?? [];
    if (age >= RES_FRESH_MS && !revalidating.has(key)) {
      revalidating.add(key);
      const p = (async () => {
        try {
          const fresh = await deps.fetchHostaway(day);
          await write({ reservations: fresh }, new Date(now()).toISOString());
        } catch (e) {
          console.error("[insp] Hostaway revalidation failed:", e);
          try { await write({ reservations, failedAt: new Date(now()).toISOString() }, row.updated_at); }
          catch (e2) { console.error("[insp] failedAt mark failed:", e2); }
        } finally { revalidating.delete(key); }
      })();
      deps.waitUntil?.(p);
    }
    return { reservations, cachedAt: row.payload.failedAt ? row.updated_at : null };
  }
  try {
    const reservations = await deps.fetchHostaway(day);
    await write({ reservations }, new Date(now()).toISOString());
    return { reservations, cachedAt: null };
  } catch (e) {
    console.error("[insp] Hostaway reservations failed:", e);
    throw new Error("Bookings are unavailable right now. Try again in a few minutes.");
  }
}
