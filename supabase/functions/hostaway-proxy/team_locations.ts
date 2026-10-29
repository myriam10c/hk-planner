// Qui est ou (plan docs/superpowers/plans/2026-10-29-team-locations.md, tache 1).
// Derniere position seulement, une ligne par personne dans team_locations : pas
// d'historique. Ecriture par la session (cleaner_id de la session, jamais du corps),
// lecture par les managers et la maintenance. La table n'a aucune policy : seul le
// service role du proxy y touche.
import type { SessionUser } from "./auth.ts";
import { splitListing } from "./mgr_rules.ts";
import { readAllRows, readOrThrow } from "./mgr_today.ts";

// Fenetre 07:00-23:00 heure de Dubai (UTC+4 toute l'annee, sans changement d'heure).
export const LOC_FROM_HOUR = 7;
export const LOC_TO_HOUR = 23;
const DUBAI_UTC_OFFSET_MS = 4 * 3600_000;
// recorded_at accepte : au plus 2 min dans le futur (horloge du telephone), au plus 30 min d'age.
export const LOC_FUTURE_MS = 2 * 60_000;
export const LOC_MAX_AGE_MS = 30 * 60_000;
// « At » un logement a 150 m ou moins, « near » au-dela.
export const LOC_AT_M = 150;

export type LocPlace = { kind: "at" | "near"; listingId: string; label: string; distanceM: number };
export type LocPoint = {
  lat: number; lng: number; accuracy: number | null; recordedAt: string; ageMin: number; place: LocPlace | null;
};
export type LocPerson = { id: number; name: string; role: string; color: string; location: LocPoint | null };
export type LocListing = { listingId: string; label: string; lat: number; lng: number };

// Distance en metres sur la sphere (rayon moyen 6 371 km) : assez juste a l'echelle d'une ville.
export function haversineM(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371_000 * Math.asin(Math.min(1, Math.sqrt(h)));
}

// Logement le plus proche : « at » a LOC_AT_M ou moins, « near » sinon. null sans logement geolocalise.
export function nearestListing(p: { lat: number; lng: number }, listings: LocListing[]): LocPlace | null {
  let best: LocListing | null = null;
  let bestM = Infinity;
  for (const l of listings) {
    const d = haversineM(p, l);
    if (d < bestM) { best = l; bestM = d; }
  }
  if (!best) return null;
  return { kind: bestM <= LOC_AT_M ? "at" : "near", listingId: best.listingId, label: best.label, distanceM: Math.round(bestM) };
}

// Minutes depuis minuit heure de Dubai.
export function dubaiMinutes(nowMs: number): number {
  const d = new Date(nowMs + DUBAI_UTC_OFFSET_MS);
  return d.getUTCHours() * 60 + d.getUTCMinutes();
}
export function inLocationHours(nowMs: number): boolean {
  const m = dubaiMinutes(nowMs);
  return m >= LOC_FROM_HOUR * 60 && m < LOC_TO_HOUR * 60;
}

const coord = (v: unknown, max: number) => typeof v === "number" && Number.isFinite(v) && Math.abs(v) <= max;

export type LocInput = { lat: number; lng: number; accuracy: number | null; recordedMs: number };
export function parseLocation(body: any, nowMs: number): { ok: true; value: LocInput } | { ok: false; error: string } {
  if (!body || typeof body !== "object") return { ok: false, error: "invalid json body" };
  if (!coord(body.lat, 90) || !coord(body.lng, 180)) return { ok: false, error: "invalid lat/lng" };
  const acc = body.accuracy;
  if (acc != null && !(typeof acc === "number" && Number.isFinite(acc) && acc >= 0)) {
    return { ok: false, error: "invalid accuracy" };
  }
  const recordedMs = typeof body.recordedAt === "string" ? Date.parse(body.recordedAt) : NaN;
  if (!Number.isFinite(recordedMs)) return { ok: false, error: "invalid recordedAt" };
  if (recordedMs > nowMs + LOC_FUTURE_MS) return { ok: false, error: "recordedAt is in the future" };
  if (recordedMs < nowMs - LOC_MAX_AGE_MS) return { ok: false, error: "recordedAt is too old" };
  return { ok: true, value: { lat: body.lat, lng: body.lng, accuracy: acc == null ? null : acc, recordedMs } };
}

// Coordonnees d'une annonce Hostaway pour listing_config : nombres finis seulement.
// Rien (objet vide) sinon, pour ne jamais effacer une position deja en base ; 0,0 = absent.
export function hostawayCoords(l: any): { lat?: number; lng?: number } {
  const lat = l?.lat == null || l.lat === "" ? NaN : Number(l.lat);
  const lng = l?.lng == null || l.lng === "" ? NaN : Number(l.lng);
  if (!coord(lat, 90) || !coord(lng, 180) || (lat === 0 && lng === 0)) return {};
  return { lat, lng };
}

// Ecriture de la position de la personne connectee. Hors fenetre : rien n'est ecrit, 200 quand meme
// (le front n'a rien a corriger). Identite : me.cleaner_id, jamais un id du corps.
export async function saveLocation(sb: any, me: SessionUser | null, body: any, nowMs: number): Promise<{ status: number; body: any }> {
  if (!me) return { status: 401, body: { error: "auth required" } };
  const p = parseLocation(body, nowMs);
  if (!p.ok) return { status: 400, body: { error: p.error } };
  if (!inLocationHours(nowMs)) return { status: 200, body: { ok: true, saved: false, reason: "outside_hours" } };
  const { error } = await sb.from("team_locations").upsert({
    cleaner_id: me.cleaner_id, lat: p.value.lat, lng: p.value.lng, accuracy_m: p.value.accuracy,
    recorded_at: new Date(p.value.recordedMs).toISOString(), received_at: new Date(nowMs).toISOString(),
  }, { onConflict: "cleaner_id" });
  if (error) {
    console.error("[team_locations] upsert failed:", error.message ?? error);
    return { status: 500, body: { error: "Location could not be saved." } };
  }
  return { status: 200, body: { ok: true, saved: true } };
}

// Logements geolocalises, libelle « 1205 · Marina Gate » : meme decoupe (splitListing)
// que place() de mgr_today.ts et les ecrans de /manager/.
export function locListings(rows: any[]): LocListing[] {
  const out: LocListing[] = [];
  for (const r of rows) {
    if (!coord(r?.lat, 90) || !coord(r?.lng, 180)) continue;
    const s = splitListing(r);
    out.push({ listingId: String(r.listing_id), label: [s.apt, s.bld].filter(Boolean).join(" · "), lat: r.lat, lng: r.lng });
  }
  return out;
}

// Pur : membres actifs hors system et sous-traitants, positions les plus recentes
// d'abord, puis ceux sans position par nom.
export function buildLocations(people: any[], locs: any[], listings: LocListing[], nowMs: number): LocPerson[] {
  const byId = new Map(locs.map((l: any) => [String(l.cleaner_id), l]));
  const out = people
    .filter((p: any) => p.is_active !== false && p.role !== "system" && p.role !== "subcontractor")
    .map((p: any): LocPerson & { _ms: number } => {
      const l = byId.get(String(p.id));
      const ms = l ? Date.parse(String(l.recorded_at)) : NaN;
      const ok = l && Number.isFinite(ms) && Number.isFinite(Number(l.lat)) && Number.isFinite(Number(l.lng));
      const pt = ok ? { lat: Number(l.lat), lng: Number(l.lng) } : null;
      return {
        id: Number(p.id), name: String(p.name ?? ""), role: String(p.role ?? ""), color: String(p.color ?? ""),
        location: pt ? {
          ...pt, accuracy: l.accuracy_m == null ? null : Number(l.accuracy_m),
          recordedAt: new Date(ms).toISOString(), ageMin: Math.max(0, Math.floor((nowMs - ms) / 60_000)),
          place: nearestListing(pt, listings),
        } : null,
        _ms: pt ? ms : -Infinity,
      };
    });
  out.sort((a, b) => b._ms - a._ms || a.name.localeCompare(b.name, "en", { sensitivity: "base" }));
  return out.map(({ _ms, ...p }) => p);
}

// Lecture des trois tables ; une lecture ratee leve (l'appelant decide : 503 ou null).
export async function loadLocations(sb: any, nowMs: number): Promise<LocPerson[]> {
  const [people, locs, listings] = await Promise.all([
    readAllRows((a: number, b: number) => sb.from("cleaners").select("id, name, role, color, is_active").order("id").range(a, b), "cleaners"),
    sb.from("team_locations").select("cleaner_id, lat, lng, accuracy_m, recorded_at").then((r: any) => readOrThrow(r, "team_locations")),
    readAllRows((a: number, b: number) => sb.from("listing_config")
      .select("listing_id, internal_name, listing_name, apt_number, lat, lng").order("listing_id").range(a, b), "listing_config"),
  ]);
  return buildLocations(people, locs, locListings(listings), nowMs);
}

// Bloc de mgr.today : null si une lecture echoue, Today ne casse jamais pour ca.
export async function loadLocationsSafe(sb: any, nowMs: number): Promise<LocPerson[] | null> {
  try {
    return await loadLocations(sb, nowMs);
  } catch (e) {
    console.error("[team_locations] read failed:", (e as Error)?.message ?? String(e));
    return null;
  }
}

export async function mgrLocations(sb: any, nowMs: number): Promise<{ status: number; body: any }> {
  try {
    return { status: 200, body: { generatedAt: new Date(nowMs).toISOString(), people: await loadLocations(sb, nowMs) } };
  } catch (e) {
    console.error("[mgr.locations]", (e as Error)?.message ?? String(e));
    return { status: 503, body: { error: "Locations are unavailable right now. Try again." } };
  }
}
