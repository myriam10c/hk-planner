// Action v3.myReports (maintenance phase 3, C12) : les signalements de la
// cleaner connectee sur les 7 derniers jours de Dubai, pour la section « My
// reports, last 7 days » du Profile.
//
// L'auteur d'un ticket de l'app est `reported_by`, qui porte le nom affiche de la
// session (reportProblem, v3_tickets.ts). On filtre donc sur ce nom ET sur la
// source hk_planner_v3 : un ticket desktop au meme nom n'est pas un signalement
// de l'app.
import type { ActionResult, SessionUser } from "./v3.ts";
import { plusDays, todayDubai } from "./v3.ts";
import { assigneeOf, assigneeNames, dubaiDayOf, nomDuLogement } from "./v3_myday.ts";

export type V3ReportStatus =
  "with_tech" | "in_progress" | "waiting_parts" | "to_confirm" | "fixed" | "open";

export interface V3Report {
  id: number;
  title: string;
  place: string;
  listingLabel: string;
  reportedOn: string;
  status: V3ReportStatus;
  techName: string | null;
}

export const V3_REPORTS_DAYS = 7;

// Statut de la base -> mot montre a la cleaner. Absent (cancelled ou inconnu) :
// la ligne n'est pas rendue.
const STATUT: Record<string, V3ReportStatus> = {
  assigned: "with_tech",
  open: "open",
  in_progress: "in_progress",
  waiting_parts: "waiting_parts",
  to_confirm: "to_confirm",
  resolved: "fixed",
  closed: "fixed",
};

// Le titre d'un signalement de l'app est « <type> · <piece> » (problemTitle) :
// la piece est ce qui suit le dernier separateur, vide sinon.
function placeOf(title: string): string {
  const i = title.lastIndexOf(" · ");
  return i < 0 ? "" : title.slice(i + 3).trim();
}

export async function myReports(sb: any, me: SessionUser, nowMs: number): Promise<ActionResult> {
  const today = todayDubai(nowMs);
  // Aujourd'hui et les 6 jours d'avant, a partir de minuit a Dubai.
  const debut = new Date(plusDays(today, -(V3_REPORTS_DAYS - 1)) + "T00:00:00+04:00").toISOString();
  const { data, error } = await sb.from("maintenance_tickets")
    .select("id, listing_id, title, status, assigned_technician_id, assigned_vendor_id, created_at")
    .eq("source", "hk_planner_v3").eq("reported_by", me.name)
    .gte("created_at", debut)
    .order("created_at", { ascending: false }).limit(200);
  if (error) throw error;
  const tickets = (data ?? []).filter((t: any) =>
    Object.prototype.hasOwnProperty.call(STATUT, String(t?.status ?? "")));

  // Libelles et noms : lectures de confort, une panne ne cache jamais la liste.
  const [noms, listings] = await Promise.all([
    assigneeNames(sb, tickets),
    lireLogements(sb, [...new Set<string>(tickets.map((t: any) => String(t.listing_id ?? "")).filter(Boolean))]),
  ]);

  const reports: V3Report[] = tickets
    .map((t: any) => {
      const title = String(t.title ?? "Ticket");
      return {
        id: Number(t.id),
        title,
        place: placeOf(title),
        listingLabel: nomDuLogement(listings[String(t.listing_id ?? "")], null),
        reportedOn: dubaiDayOf(t.created_at) ?? today,
        status: STATUT[String(t.status)],
        techName: assigneeOf(t, noms),
        _ms: Date.parse(String(t.created_at ?? "")) || 0,
      };
    })
    .sort((a: any, b: any) => b._ms - a._ms || b.id - a.id)
    .map(({ _ms, ...r }: any) => r as V3Report);
  return { status: 200, body: { reports } };
}

async function lireLogements(sb: any, ids: string[]): Promise<Record<string, any>> {
  if (ids.length === 0) return {};
  try {
    const { data, error } = await sb.from("listing_config")
      .select("listing_id, internal_name, listing_name").in("listing_id", ids);
    if (error) throw error;
    const out: Record<string, any> = {};
    for (const l of data ?? []) out[String(l.listing_id)] = l;
    return out;
  } catch (e) {
    console.warn("[v3] logements illisibles pour myReports: " + String((e as any)?.message ?? e));
    return {};
  }
}
