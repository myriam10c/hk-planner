// Notes et stats des personnes (More > Ratings and stats) : lecture seule.
// Notes : snapshot cleaner_ratings_cache (payload_json.cleaners[cid]), le meme que getCleanerRatings.
// Perf : dashboardKpis (kpis.ts) limite au mois demande, jour metier Dubai injecte.
import { dashboardKpis } from "./kpis.ts";

export function parsePeopleMonth(raw: string | null, today: string): { ok: true; month: string } | { ok: false; error: string } {
  if (raw === null || raw === "") return { ok: true, month: today.slice(0, 7) };
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(raw)) return { ok: false, error: "month must be YYYY-MM" };
  return { ok: true, month: raw };
}

const num = (v: any): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

export async function mgrPeople(sb: any, month: string, today: string) {
  const [cacheRes, cleanerRes, listingRes] = await Promise.all([
    sb.from("cleaner_ratings_cache").select("*").eq("id", 1).maybeSingle(),
    sb.from("cleaners").select("id, name, role, is_active"),
    sb.from("listing_config").select("listing_id, internal_name, listing_name"),
  ]);
  if (cacheRes.error) throw cacheRes.error;
  if (cleanerRes.error) throw cleanerRes.error;
  // Un nom de logement manquant ne doit pas faire tomber la page : repli sur l'identifiant.
  const listingNames: Record<string, string> = {};
  (listingRes.data ?? []).forEach((l: any) => {
    const n = l.internal_name || l.listing_name;
    if (n) listingNames[String(l.listing_id)] = String(n);
  });
  // Actifs et inactifs : une ancienne note garde un nom.
  const byId: Record<string, { name: string; role: string }> = {};
  (cleanerRes.data ?? []).forEach((c: any) => { byId[String(c.id)] = { name: String(c.name ?? ""), role: String(c.role ?? "") }; });

  const row = cacheRes.data ?? null;
  const cleaners = (row?.payload_json?.cleaners ?? {}) as Record<string, any>;
  const people = Object.keys(cleaners)
    // Comme l'ancien ecran : ni manager ni compte machine dans le classement.
    .filter((cid) => !["manager", "system"].includes(byId[cid]?.role ?? ""))
    .map((cid) => {
      const c = cleaners[cid] ?? {};
      const enough = c.enough_data === true;
      const recent = (Array.isArray(c.details) ? c.details : [])
        .filter((d: any) => d && typeof d.cleaning_date === "string")
        .sort((a: any, b: any) => String(b.cleaning_date).localeCompare(String(a.cleaning_date)))
        .slice(0, 10)
        .map((d: any) => ({
          date: String(d.cleaning_date),
          listingName: listingNames[String(d.listing_id)] ?? String(d.listing_id ?? ""),
          guest: String(d.guest ?? ""),
          score: num(d.cleanliness),
        }));
      return {
        id: Number(cid),
        name: byId[cid]?.name || `Cleaner #${cid}`,
        role: byId[cid]?.role ?? "",
        avgAll: enough ? num(c.avg_cleanliness_all_time) : null,
        avg90: enough ? num(c.avg_cleanliness_90d) : null,
        count: Number(c.count_all_time) || 0,
        enoughData: enough,
        recent,
      };
    })
    .sort((a, b) => (b.avgAll ?? -1) - (a.avgAll ?? -1) || a.name.localeCompare(b.name, "en", { sensitivity: "base" }));

  const kpis = await dashboardKpis(sb, month, today, month);
  const performance = (kpis.cleanerPerformance as any[]).map((p) => ({
    id: p.id,
    name: String(p.name ?? ""),
    role: byId[String(p.id)]?.role ?? "cleaner",
    cleanings: p.totalCleanings,
    avgMinutes: p.timerCount > 0 ? p.avgTime : null,
    fastest: p.timerCount > 0 ? p.fastest : null,
    slowest: p.timerCount > 0 ? p.slowest : null,
    timed: p.timerCount,
  }));

  return {
    month,
    ratings: {
      computedAt: row?.computed_at ?? null,
      syncedAt: row?.synced_at ?? null,
      unmatched: Number(row?.unmatched_count) || 0,
      people,
    },
    performance,
  };
}
