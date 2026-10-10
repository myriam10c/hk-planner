// Rapports de l'app manager (More > Reports, phase 5b) : action mgr.reports, lecture seule.
//   - compta Elite : le snapshot cleaning_accounting_cache du mois, passe TEL QUEL
//     (totals_json, payload_json.rows, unmatched_resa, unmatched_pricing). Aucun montant
//     n'est recalcule, arrondi ni estime ici ; une valeur absente part en null.
//   - operations : KPIs de l'ancien getDashboardKPIs, mais lus sur le mois de Dubai borne
//     cote base et en entier (pages), comme mgr.people : l'ancien chemin dashboardKpis
//     tronque a ~1000 lignes recentes et ne convient pas a un mois passe.
//   - logements : healthScore (mgr_apartment.ts) pour chaque logement, entrees lues par
//     lot (une lecture par table, regroupee en memoire), le pire en premier. Sans les
//     notes guest_feedback (pas de listing_id en base, voir plus bas).
//   - reportsAccess : garde des anciennes actions getCleaningAccounting,
//     listCleaningAccountingMonths, exportCleaningsCsv et exportMaintenanceCsv.
// Une table illisible fait echouer la lecture : index.ts rend 503, jamais un rapport partiel.
import { healthScore } from "./mgr_apartment.ts";
import { MGR_OPEN_TICKET_STATUSES } from "./mgr_inbox.ts";
import { dubaiMonthBounds, parsePeopleMonth } from "./mgr_people.ts";
import { splitListing } from "./mgr_rules.ts";
import { readAllRows, readOrThrow } from "./mgr_today.ts";
import { dubaiDay } from "./insp_rules.ts";
import { plusDays } from "./v3.ts";

export const parseReportsMonth = parsePeopleMonth;
// guest_feedback n'a pas de colonne listing_id en base (verifie le 11/10/2026, table vide) :
// la note ne peut pas etre rattachee a un logement, elle n'est donc pas lue (penalite 0).
export const REPORTS_PROPERTIES_TABLES = ["listing_config", "maintenance_tickets", "equipment"];

// 401 sans session, 403 si le role n'est pas manager (PIN ou email, l'ancienne app envoie l'un ou l'autre).
export function reportsAccess(me: { role: string } | null): { status: number; error: string } | null {
  if (!me) return { status: 401, error: "auth required" };
  if (me.role !== "manager") return { status: 403, error: "Only managers can do this." };
  return null;
}

export type ReportsAccounting = {
  computedAt: string | null; syncedAt: string | null; rowsCount: number | null; unmatchedCount: number | null;
  totals: unknown; rows: unknown; unmatchedResa: unknown; unmatchedPricing: unknown;
};
export type ReportsOps = {
  avgCleaningTime: number | null; totalTimerSessions: number; openMaintenanceTickets: number;
  resolvedThisMonth: number; avgResolutionHours: number | null;
  last7DaysCompletions: Array<{ date: string; completions: number }>;
};
export type ReportsProperty = { listingId: string; apt: string; bld: string; score: number; openTickets: number; urgentOpen: number };
export type MgrReports = {
  month: string; months: string[]; accounting: ReportsAccounting | null; ops: ReportsOps; properties: ReportsProperty[];
};

const orNull = (v: unknown) => (v === undefined ? null : v);

async function readAccounting(sb: any, month: string): Promise<{ months: string[]; accounting: ReportsAccounting | null }> {
  const [list, snap] = await Promise.all([
    sb.from("cleaning_accounting_cache").select("month").order("month", { ascending: false }),
    sb.from("cleaning_accounting_cache").select("*").eq("month", month).maybeSingle(),
  ]);
  const months = readOrThrow(list, "cleaning_accounting_cache").map((r: any) => String(r.month))
    .sort((a: string, b: string) => b.localeCompare(a));
  if (snap?.error) throw new Error("cleaning_accounting_cache: " + String(snap.error.message ?? "read failed"));
  const row = snap?.data ?? null;
  if (!row) return { months, accounting: null };
  const p = row.payload_json ?? {};
  return {
    months,
    accounting: {
      computedAt: orNull(row.computed_at) as string | null, syncedAt: orNull(row.synced_at) as string | null,
      rowsCount: orNull(row.rows_count) as number | null, unmatchedCount: orNull(row.unmatched_count) as number | null,
      totals: orNull(row.totals_json), rows: orNull(p.rows), unmatchedResa: orNull(p.unmatched_resa), unmatchedPricing: orNull(p.unmatched_pricing),
    },
  };
}

const isOpen = (t: any) => MGR_OPEN_TICKET_STATUSES.includes(String(t.status ?? "open"));

async function readOps(sb: any, month: string, today: string, tickets: any[]): Promise<ReportsOps> {
  const { from, to } = dubaiMonthBounds(month);
  // Debut du jour Dubai d'il y a 6 jours, en UTC.
  const weekFrom = new Date(Date.parse(plusDays(today, -6) + "T00:00:00Z") - 4 * 3600_000).toISOString();
  const [timers, dones] = await Promise.all([
    readAllRows((a: number, b: number) => sb.from("cleaning_timer").select("reservation_key, started_at, duration_minutes")
      .not("duration_minutes", "is", null).gte("started_at", from).lt("started_at", to)
      .order("started_at").order("reservation_key").range(a, b), "cleaning_timer"),
    readAllRows((a: number, b: number) => sb.from("menage_done").select("reservation_key, done, updated_at")
      .gte("updated_at", weekFrom).order("updated_at").order("reservation_key").range(a, b), "menage_done"),
  ]);
  // Comme l'ancien KPI : une duree hors 1..479 minutes est un chrono oublie.
  const durations = timers.map((t: any) => Number(t.duration_minutes)).filter((d: number) => d > 0 && d < 480);
  const avgCleaningTime = durations.length ? Math.round(durations.reduce((s: number, d: number) => s + d, 0) / durations.length) : null;

  const inMonth = (iso: unknown) => typeof iso === "string" && iso !== "" && Number.isFinite(Date.parse(iso)) &&
    new Date(Date.parse(iso)).toISOString() >= from && new Date(Date.parse(iso)).toISOString() < to;
  const resolvedInMonth = tickets.filter((t) => t.status === "resolved" && inMonth(t.resolved_at));
  const timed = tickets.filter((t) => inMonth(t.resolved_at) && t.created_at && Number.isFinite(Date.parse(String(t.created_at))));
  const avgResolutionHours = timed.length
    ? Math.round(timed.reduce((s, t) => s + (Date.parse(t.resolved_at) - Date.parse(String(t.created_at))) / 3600_000, 0) / timed.length)
    : null;

  const last7: Array<{ date: string; completions: number }> = [];
  for (let i = 6; i >= 0; i--) {
    const day = plusDays(today, -i);
    last7.push({ date: day, completions: dones.filter((d: any) => d.done === true && d.updated_at && dubaiDay(String(d.updated_at)) === day).length });
  }
  return {
    avgCleaningTime, totalTimerSessions: durations.length, openMaintenanceTickets: tickets.filter(isOpen).length,
    resolvedThisMonth: resolvedInMonth.length, avgResolutionHours, last7DaysCompletions: last7,
  };
}

function groupBy(rows: any[]): Record<string, any[]> {
  const out: Record<string, any[]> = {};
  for (const r of rows) if (r.listing_id !== null && r.listing_id !== undefined && r.listing_id !== "") (out[String(r.listing_id)] ??= []).push(r);
  return out;
}

function properties(listings: any[], tickets: any[], equipment: any[], today: string): ReportsProperty[] {
  const t = groupBy(tickets), e = groupBy(equipment);
  return listings.map((l: any) => {
    const id = String(l.listing_id);
    // Le cout n'entre pas dans le score : il n'est pas lu.
    const h = healthScore({ tickets: t[id] ?? [], equipment: e[id] ?? [], costs: [], feedback: [], today });
    const place = splitListing(l);
    return { listingId: id, apt: place.apt, bld: place.bld, score: h.score, openTickets: h.openTickets, urgentOpen: h.urgentOpen };
  }).sort((a, b) => a.score - b.score || b.urgentOpen - a.urgentOpen || b.openTickets - a.openTickets ||
    a.bld.localeCompare(b.bld) || a.apt.localeCompare(b.apt, undefined, { numeric: true }));
}

export async function mgrReports(sb: any, month: string, o: { today: string }): Promise<MgrReports> {
  const page = (table: string, cols: string) => readAllRows((a: number, b: number) =>
    sb.from(table).select(cols).order("id").range(a, b), table);
  const [acc, listings, tickets, equipment] = await Promise.all([
    readAccounting(sb, month),
    readAllRows((a: number, b: number) => sb.from("listing_config").select("listing_id, internal_name, listing_name, apt_number")
      .order("listing_id").range(a, b), "listing_config"),
    page("maintenance_tickets", "id, listing_id, status, priority, created_at, resolved_at"),
    page("equipment", "id, listing_id, next_service"),
  ]);
  const ops = await readOps(sb, month, o.today, tickets);
  return { month, months: acc.months, accounting: acc.accounting, ops, properties: properties(listings, tickets, equipment, o.today) };
}
