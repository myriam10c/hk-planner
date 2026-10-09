// Bloc « Team control » de Today : inspections, linge manquant, taches en
// retard, ce que chacun a fait hier (spec 2026-10-09, sections 2 et 4).
import { plusDays } from "./v3.ts";
import { dubaiDay } from "./insp_rules.ts";
import {
  byRoleThenName, ddmm, dubaiMs, eliteLogDeadlineMs, hhmm, joinNames, keyDate, MGR_ELITE_LOG_HOUR, plural,
} from "./mgr_rules.ts";
import { byKeys, readOrThrow, type MgrCore } from "./mgr_today.ts";

export const MGR_LINEN_WINDOW_DAYS = 7;

export type MgrControl = {
  inspections: { proposed: number; claimed: number; done: number; unfinished: Array<{ apt: string; bld: string; inspector: string; date: string }> };
  linen: { window: string; rows: Array<{ name: string; missing: number; total: number }> };
  overdue: { total: number; rows: Array<{ name: string; n: number }> };
  yesterday: { date: string; rows: Array<{ name: string; text: string }> };
};

export async function loadControl(sb: any, c: MgrCore): Promise<MgrControl> {
  const day = c.day, y = plusDays(day, -1), from = plusDays(day, -MGR_LINEN_WINDOW_DAYS);
  const iso = (ms: number) => new Date(ms).toISOString();
  const q = (p: any, what: string) => p.then((r: any) => readOrThrow(r, what));
  const [props, insps, doneRows, openTasks, closedTasks, resolved] = await Promise.all([
    q(sb.from("inspection_proposals").select("listing_id, claimed_by").eq("proposal_date", day), "inspection_proposals"),
    q(sb.from("inspections").select("id, listing_id, inspector_id, inspection_date, finished_at").gte("inspection_date", from), "inspections"),
    q(sb.from("menage_done").select("reservation_key, done, updated_at").eq("done", true).gte("updated_at", iso(dubaiMs(from, 0))), "menage_done"),
    q(sb.from("team_tasks").select("id, assigned_cleaner_id, due_at").eq("status", "open"), "team_tasks"),
    q(sb.from("team_tasks").select("id, completed_by_cleaner_id, completed_at").eq("status", "done").gte("completed_at", iso(dubaiMs(y, 0))), "team_tasks"),
    q(sb.from("maintenance_tickets").select("id, resolved_at").gte("resolved_at", iso(dubaiMs(y, 0))), "maintenance_tickets"),
  ]);
  const nm = (id: unknown) => c.people[String(id)]?.name ?? "Member " + id;
  const where = (lid: unknown) => c.listings[String(lid)] ?? { apt: "", bld: "Listing " + lid };

  const doneKeys = [...new Set<string>(doneRows.map((r: any) => String(r.reservation_key)))].filter((k) => {
    const d = keyDate(k);
    return !!d && d >= from && d <= y;
  });
  const [asg, linen] = await Promise.all([
    byKeys(sb, "cleaning_assignments", "reservation_key, cleaner_id", doneKeys),
    byKeys(sb, "laundry_counts", "reservation_key", doneKeys),
  ]);
  const counted = new Set(linen.map((r: any) => String(r.reservation_key)));
  const per = new Map<number, { total: number; missing: number; y: number; yLinen: number }>();
  for (const a of asg) {
    const id = Number(a.cleaner_id), k = String(a.reservation_key);
    const e = per.get(id) ?? { total: 0, missing: 0, y: 0, yLinen: 0 };
    e.total++;
    if (!counted.has(k)) e.missing++;
    if (keyDate(k) === y) { e.y++; if (counted.has(k)) e.yLinen++; }
    per.set(id, e);
  }

  const inspections = {
    proposed: props.length,
    claimed: props.filter((p: any) => p.claimed_by != null).length,
    done: insps.filter((i: any) => i.inspection_date === day && i.finished_at).length,
    unfinished: insps.filter((i: any) => !i.finished_at && i.inspection_date < day)
      .map((i: any) => ({ ...where(i.listing_id), inspector: nm(i.inspector_id), date: ddmm(i.inspection_date) })),
  };

  const nowIso = iso(c.nowMs);
  const od = new Map<string, number>();
  for (const t of openTasks) {
    if (!t.due_at || String(t.due_at) >= nowIso) continue;
    const k = t.assigned_cleaner_id == null ? "Unassigned" : nm(t.assigned_cleaner_id);
    od.set(k, (od.get(k) ?? 0) + 1);
  }
  const overdueRows = [...od.entries()].map(([name, n]) => ({ name, n })).sort((a, b) => b.n - a.n || a.name.localeCompare(b.name));

  const rows: Array<{ name: string; text: string }> = [];
  const idle: string[] = [];
  const team = Object.values(c.people).filter((p) => p.active && p.role !== "system").sort(byRoleThenName);
  for (const p of team) {
    if (p.role === "cleaner" || p.role === "subcontractor") {
      const e = per.get(p.id);
      if (e && e.y) rows.push({ name: p.name, text: plural(e.y, "cleaning") + " done, " + plural(e.yLinen, "linen count") + "." });
      else if (p.role === "subcontractor" && c.nowMs < eliteLogDeadlineMs(y)) {
        rows.push({ name: p.name, text: "Not logged yet. Elite logs its jobs around " + hhmm(MGR_ELITE_LOG_HOUR) + " the next day." });
      } else rows.push({ name: p.name, text: "No cleaning marked done." });
      continue;
    }
    const nIns = insps.filter((i: any) => Number(i.inspector_id) === p.id && i.inspection_date === y && i.finished_at).length;
    const nTasks = closedTasks.filter((t: any) =>
      Number(t.completed_by_cleaner_id) === p.id && t.completed_at && dubaiDay(String(t.completed_at)) === y).length;
    if (nIns || nTasks) rows.push({ name: p.name, text: plural(nIns, "inspection") + " done, " + plural(nTasks, "team task") + " closed." });
    else idle.push(p.name);
  }
  if (idle.length) rows.push({ name: joinNames(idle), text: "No inspection and no team task closed." });
  const nRes = resolved.filter((t: any) => t.resolved_at && dubaiDay(String(t.resolved_at)) === y).length;
  rows.push({ name: "Maintenance", text: plural(nRes, "ticket") + " resolved." });

  return {
    inspections,
    linen: {
      window: "last " + MGR_LINEN_WINDOW_DAYS + " days",
      rows: [...per.entries()].map(([id, e]) => ({ name: nm(id), missing: e.missing, total: e.total }))
        .sort((a, b) => b.missing - a.missing || a.name.localeCompare(b.name)),
    },
    overdue: { total: overdueRows.reduce((s, r) => s + r.n, 0), rows: overdueRows },
    yesterday: { date: ddmm(y), rows },
  };
}
