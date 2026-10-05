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
// Cache du jour present : servi tout de suite ; au-dela de 2 min il est rafraichi
// en arriere-plan (une seule revalidation en vol par cle et par isolat). Sans cache
// du jour : fetch synchrone. Au-dela de 30 min, la revalidation echoue depuis un
// moment : on renvoie cachedAt pour garder le bandeau « Bookings data from ».
const RES_FRESH_MS = 2 * 60 * 1000;
const RES_STALE_BANNER_MS = 30 * 60 * 1000;
const revalidating = new Set<string>();

export async function loadReservationsCached(
  sb: any, day: string,
  deps: {
    fetchHostaway: (day: string) => Promise<InspReservation[]>;
    now?: () => number;
    waitUntil?: (p: Promise<unknown>) => void;
  },
): Promise<{ reservations: InspReservation[]; cachedAt: string | null }> {
  const now = deps.now ?? Date.now;
  const key = "insp:res:" + day;
  const refresh = async () => {
    const reservations = await deps.fetchHostaway(day);
    await sb.from("proxy_cache").upsert({ key, payload: { reservations }, updated_at: new Date(now()).toISOString() });
    return reservations;
  };
  const { data: row } = await sb.from("proxy_cache").select("payload, updated_at").eq("key", key).maybeSingle();
  if (row?.payload) {
    const age = now() - new Date(row.updated_at).getTime();
    const reservations = row.payload.reservations ?? [];
    if (age < RES_FRESH_MS) return { reservations, cachedAt: null };
    if (!revalidating.has(key)) {
      revalidating.add(key);
      const p = refresh().catch((e) => { console.error("[insp] Hostaway revalidation failed:", e); })
        .finally(() => { revalidating.delete(key); });
      deps.waitUntil?.(p);
    }
    return { reservations, cachedAt: age > RES_STALE_BANNER_MS ? row.updated_at : null };
  }
  try {
    return { reservations: await refresh(), cachedAt: null };
  } catch (e) {
    console.error("[insp] Hostaway reservations failed:", e);
    throw new Error("Bookings are unavailable right now. Try again in a few minutes.");
  }
}
