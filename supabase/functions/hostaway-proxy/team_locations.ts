// Qui est ou (plan docs/superpowers/plans/2026-10-29-team-locations.md, tache 1).
// Derniere position seulement, une ligne par personne dans team_locations : pas
// d'historique. Ecriture par la session (cleaner_id de la session, jamais du corps),
// lecture par les managers et la maintenance. La table n'a aucune policy : seul le
// service role du proxy y touche.
import type { SessionUser } from "./auth.ts";
import { splitListing } from "./mgr_rules.ts";
import { readAllRows, readOrThrow } from "./mgr_today.ts";
import { APP_URL, isQuietHoursDubai, type PushPayload } from "./push.ts";

// Fenetre 07:00-23:00 heure de Dubai (UTC+4 toute l'annee, sans changement d'heure).
export const LOC_FROM_HOUR = 7;
export const LOC_TO_HOUR = 23;
const DUBAI_UTC_OFFSET_MS = 4 * 3600_000;
// recorded_at accepte : au plus 2 min dans le futur (horloge du telephone), au plus 30 min d'age.
export const LOC_FUTURE_MS = 2 * 60_000;
export const LOC_MAX_AGE_MS = 30 * 60_000;
// « At » un logement a 150 m ou moins, « near » au-dela.
export const LOC_AT_M = 150;
// Precision annoncee au-dela de 2 km : point ignore (reseau ou wifi grossier), rien n'est ecrit.
export const LOC_MAX_ACCURACY_M = 2000;

export type LocPlace = { kind: "at" | "near"; listingId: string; label: string; distanceM: number };
export type LocPoint = {
  lat: number; lng: number; accuracy: number | null; recordedAt: string; ageMin: number; place: LocPlace | null;
};
// offAt : la personne a coupe le partage elle-meme (bouton Location OFF, v3.stopLocation),
// efface au prochain envoi accepte. Colonne cleaners.location_off_at (migration 20261030120000).
export type LocPerson = {
  id: number; name: string; role: string; color: string; location: LocPoint | null; offAt: string | null;
};
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
  // 0,0 : position par defaut d'un capteur sans fix, jamais une vraie position a Dubai.
  if (body.lat === 0 && body.lng === 0) return { ok: false, error: "invalid lat/lng" };
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

// Choix par personne (colonne cleaners.share_location, migration 20261029180000) :
// seul un false explicite coupe le partage ; ligne ou colonne absente = partage.
export const sharesLocation = (row: any) => !row || row.share_location !== false;

// share_location de la personne connectee, pour le `me` de v3.myDay et cleanerMe.
// Lecture ratee = true : l'ecran montre le partage, et saveLocation, qui relit
// la colonne lui-meme, refuse quand meme l'ecriture.
export async function readShareLocation(sb: any, cleanerId: number): Promise<boolean> {
  const r = await sb.from("cleaners").select("share_location").eq("id", cleanerId).maybeSingle();
  if (r.error) {
    console.error("[team_locations] share_location read failed:", r.error.message ?? r.error);
    return true;
  }
  return sharesLocation(r.data);
}

// Ecriture de la position de la personne connectee. Hors fenetre : rien n'est ecrit, 200 quand meme
// (le front n'a rien a corriger). Identite : me.cleaner_id, jamais un id du corps.
// share_location = false : rien n'est ecrit, reason "not_shared" (le front arrete pour la page).
export async function saveLocation(sb: any, me: SessionUser | null, body: any, nowMs: number): Promise<{ status: number; body: any }> {
  if (!me) return { status: 401, body: { error: "auth required" } };
  const p = parseLocation(body, nowMs);
  if (!p.ok) return { status: 400, body: { error: p.error } };
  // Jamais ecraser une position plus recente (deux onglets, requete arrivee en retard).
  const [who, cur] = await Promise.all([
    sb.from("cleaners").select("share_location").eq("id", me.cleaner_id).maybeSingle(),
    sb.from("team_locations").select("recorded_at").eq("cleaner_id", me.cleaner_id).maybeSingle(),
  ]);
  // Lecture du choix ratee : rien n'est ecrit (on ne partage jamais sans savoir).
  if (who.error) {
    console.error("[team_locations] share_location read failed:", who.error.message ?? who.error);
    return { status: 500, body: { error: "Location could not be saved." } };
  }
  if (!sharesLocation(who.data)) return { status: 200, body: { ok: true, saved: false, reason: "not_shared" } };
  if (!inLocationHours(nowMs)) return { status: 200, body: { ok: true, saved: false, reason: "outside_hours" } };
  if (p.value.accuracy != null && p.value.accuracy > LOC_MAX_ACCURACY_M) {
    return { status: 200, body: { ok: true, saved: false, reason: "inaccurate" } };
  }
  if (cur.error) {
    console.error("[team_locations] read failed:", cur.error.message ?? cur.error);
    return { status: 500, body: { error: "Location could not be saved." } };
  }
  const curMs = cur.data ? Date.parse(String(cur.data.recorded_at)) : NaN;
  if (Number.isFinite(curMs) && curMs > p.value.recordedMs) {
    return { status: 200, body: { ok: true, saved: false, reason: "older" } };
  }
  const { error } = await sb.from("team_locations").upsert({
    cleaner_id: me.cleaner_id, lat: p.value.lat, lng: p.value.lng, accuracy_m: p.value.accuracy,
    recorded_at: new Date(p.value.recordedMs).toISOString(), received_at: new Date(nowMs).toISOString(),
  }, { onConflict: "cleaner_id" });
  if (error) {
    console.error("[team_locations] upsert failed:", error.message ?? error);
    return { status: 500, body: { error: "Location could not be saved." } };
  }
  // Partage repris : la marque « turned off » s'efface. Seulement si elle est posee
  // (pas une ecriture par envoi) ; un echec est journalise, la position reste enregistree.
  try {
    const off = await sb.from("cleaners").update({ location_off_at: null })
      .eq("id", me.cleaner_id).not("location_off_at", "is", null);
    if (off?.error) console.error("[team_locations] location_off_at clear failed:", off.error.message ?? off.error);
  } catch (e) {
    console.error("[team_locations] location_off_at clear failed:", (e as Error)?.message ?? String(e));
  }
  return { status: 200, body: { ok: true, saved: true } };
}

// Bouton « Location OFF » (v3 et /manager/) : la derniere position de la personne
// connectee disparait de la carte, et l'heure de la coupure est gardee pour les managers.
// Identite : me.cleaner_id, jamais le corps. Permis a toute heure.
export async function stopLocation(sb: any, me: SessionUser | null, nowMs: number): Promise<{ status: number; body: any }> {
  if (!me) return { status: 401, body: { error: "auth required" } };
  const del = await sb.from("team_locations").delete().eq("cleaner_id", me.cleaner_id);
  if (del?.error) {
    console.error("[team_locations] delete failed:", del.error.message ?? del.error);
    return { status: 500, body: { error: "Location could not be turned off." } };
  }
  const up = await sb.from("cleaners").update({ location_off_at: new Date(nowMs).toISOString() }).eq("id", me.cleaner_id);
  if (up?.error) {
    console.error("[team_locations] location_off_at write failed:", up.error.message ?? up.error);
    return { status: 500, body: { error: "Location could not be turned off." } };
  }
  return { status: 200, body: { ok: true } };
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

function isoOrNull(v: unknown): string | null {
  if (v == null || v === "") return null;
  const ms = Date.parse(String(v));
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

// Pur : membres actifs hors system, sous-traitants et share_location = false,
// positions les plus recentes d'abord, puis ceux sans position par nom.
export function buildLocations(people: any[], locs: any[], listings: LocListing[], nowMs: number): LocPerson[] {
  const byId = new Map(locs.map((l: any) => [String(l.cleaner_id), l]));
  const out = people
    .filter((p: any) => p.is_active !== false && p.role !== "system" && p.role !== "subcontractor" && sharesLocation(p))
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
        offAt: isoOrNull(p.location_off_at),
        _ms: pt ? ms : -Infinity,
      };
    });
  out.sort((a, b) => b._ms - a._ms || a.name.localeCompare(b.name, "en", { sensitivity: "base" }));
  return out.map(({ _ms, ...p }) => p);
}

// Lecture des trois tables ; une lecture ratee leve (l'appelant decide : 503 ou null).
export async function loadLocations(sb: any, nowMs: number): Promise<LocPerson[]> {
  const [people, locs, listings] = await Promise.all([
    readAllRows((a: number, b: number) => sb.from("cleaners").select("id, name, role, color, is_active, share_location, location_off_at").order("id").range(a, b), "cleaners"),
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

// ---------------------------------------------------------------------------
// Relance « Turn on your location » (bouton de la carte, ou job serveur).
// ---------------------------------------------------------------------------

// Une position de moins de 2 h : la personne partage deja, rien n'est envoye.
export const NUDGE_FRESH_MS = 2 * 3600_000;
export const NUDGE_ROLES = ["cleaner", "maintenance", "manager"];

// Cleaners : l'app racine (elle ouvre /v3/) ; managers et maintenance : /manager/.
export function nudgePayload(role: string): PushPayload {
  return {
    title: "Turn on your location",
    body: "Open HK Planner and tap Location ON so your manager can organise the day.",
    url: APP_URL + (role === "cleaner" ? "/" : "/manager/"),
    tag: "loc-nudge",
  };
}

// Pur : qui relancer. Actifs, partage permis, roles cleaner / maintenance / manager
// (jamais sous-traitant ni system) ; « skipped » = position de moins de 2 h.
// Ceux qui ont coupe eux-memes (offAt) sont relances aussi : le proprietaire le veut.
export function nudgeTargets(people: any[], locs: any[], nowMs: number): { targets: any[]; skipped: any[] } {
  const fresh = new Set<string>();
  for (const l of locs) {
    const ms = Date.parse(String(l?.recorded_at));
    if (Number.isFinite(ms) && nowMs - ms < NUDGE_FRESH_MS) fresh.add(String(l.cleaner_id));
  }
  const byName = (a: any, b: any) => String(a.name ?? "").localeCompare(String(b.name ?? ""), "en", { sensitivity: "base" });
  const eligible = people
    .filter((p: any) => p.is_active !== false && NUDGE_ROLES.includes(String(p.role)) && sharesLocation(p))
    .sort(byName);
  return {
    targets: eligible.filter((p: any) => !fresh.has(String(p.id))),
    skipped: eligible.filter((p: any) => fresh.has(String(p.id))),
  };
}

type SendFn = (cleanerId: number, payload: PushPayload) => Promise<{ sent: number; pruned: number; skipped: string | null }>;

// Heures de silence (22:00-08:30 Dubai, isQuietHoursDubai) : rien ne part, 200 quand meme.
// send = sendPush de push.ts (abonnements disparus desactives par lui, jamais d'exception).
export async function locationNudge(sb: any, nowMs: number, send: SendFn): Promise<{ status: number; body: any }> {
  if (isQuietHoursDubai(nowMs)) return { status: 200, body: { ok: false, reason: "quiet_hours" } };
  let people: any[], locs: any[];
  try {
    [people, locs] = await Promise.all([
      readAllRows((a: number, b: number) => sb.from("cleaners").select("id, name, role, is_active, share_location").order("id").range(a, b), "cleaners"),
      sb.from("team_locations").select("cleaner_id, recorded_at").then((r: any) => readOrThrow(r, "team_locations")),
    ]);
  } catch (e) {
    console.error("[mgr.locationNudge]", (e as Error)?.message ?? String(e));
    return { status: 503, body: { error: "Could not send the reminder right now. Try again." } };
  }
  const { targets, skipped } = nudgeTargets(people, locs, nowMs);
  const results = await Promise.all(targets.map((p: any) => send(Number(p.id), nudgePayload(String(p.role)))));
  const sent: string[] = [], noPush: string[] = [];
  targets.forEach((p: any, i: number) => (results[i] && results[i].sent > 0 ? sent : noPush).push(String(p.name ?? "")));
  return { status: 200, body: { ok: true, sent, noPush, skipped: skipped.map((p: any) => String(p.name ?? "")) } };
}
