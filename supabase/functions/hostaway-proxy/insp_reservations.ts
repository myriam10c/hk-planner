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
