// Bloc « Open problems » de Today : compteurs et 5 premiers elements, en lecture
// seule en phase 1 (le tri Assign / Schedule / Close arrive avec Problems, phase 2).
// Identifiants stables par source (spec section 6) : MNT-<id>, TSK-<id>.
import { dubaiDay } from "./insp_rules.ts";
import { ddmm, type Tone } from "./mgr_rules.ts";
import { readOrThrow, type MgrArrival, type MgrCore, type MgrJob } from "./mgr_today.ts";

export const MGR_CLEANER_REPORT_SOURCE = "hk_planner_v3";

export type MgrProblem = {
  ref: string; source: "Maintenance" | "Team task"; priority: string; label: string; title: string;
  listingId: string | null; apt: string; bld: string; why: string; tone: Tone;
};
export type MgrProblems = {
  counts: {
    ticketsOpen: number; ticketsUrgent: number; ticketsNoTech: number; teamTasksOpen: number;
    teamTasksOverdue: number; inspectionFindingsOpen: number; cleanerReportsOpen: number;
  };
  top: MgrProblem[];
};

const RANK: Record<string, number> = { urgent: 0, high: 1, medium: 2, normal: 2, low: 3 };
const label = (p: string) => (p ? p.charAt(0).toUpperCase() + p.slice(1) : "Normal");
const tone = (p: string): Tone => (p === "urgent" ? "bad" : p === "high" || p === "medium" ? "warn" : "idle");
const since = (iso: unknown) => (iso ? ddmm(dubaiDay(String(iso))) : "?");

export async function loadProblems(sb: any, c: MgrCore, jobs: MgrJob[], arrivals: MgrArrival[]): Promise<MgrProblems> {
  const tasks = readOrThrow(
    await sb.from("team_tasks")
      .select("id, title, priority, status, listing_id, assigned_cleaner_id, due_at, created_at").eq("status", "open"),
    "team_tasks",
  );
  const findings = readOrThrow(
    await sb.from("inspection_items").select("id, status, outcome").eq("status", "not_ok").is("outcome", null),
    "inspection_items",
  );
  const nowIso = new Date(c.nowMs).toISOString();
  const arrBy = new Map(arrivals.map((a) => [a.listingId, a]));
  const coBy = new Map(jobs.filter((j) => j.kind === "checkout" && !j.postponedFrom).map((j) => [j.listingId, j]));
  const where = (lid: string | null) => {
    const l = lid ? c.listings[lid] : undefined;
    return { apt: l?.apt ?? "", bld: l?.bld ?? "" };
  };
  const today = (lid: string | null): { boost: number; text: string } => {
    if (!lid) return { boost: 2, text: "" };
    const a = arrBy.get(lid);
    if (a) return { boost: 0, text: (a.kind === "Owner stay" ? "The owner arrives" : "A guest arrives") + " today at " + a.time + ". " };
    const j = coBy.get(lid);
    if (j) return { boost: 1, text: (j.checkout ? "Checkout today at " + j.checkout : "Checkout today, checkout time not set") + ". " };
    return { boost: 2, text: "" };
  };
  const nameOf = (id: unknown) => (id == null ? null : c.people[String(id)]?.name ?? "Member " + id);
  const items: Array<{ p: MgrProblem; r: number; b: number; t: string }> = [];
  for (const t of c.tickets) {
    const lid = t.listingId || null;
    const n = today(lid);
    const tech = nameOf(t.techId);
    items.push({
      p: {
        ref: "MNT-" + t.id, source: "Maintenance", priority: t.priority, label: label(t.priority), title: t.title,
        listingId: lid, ...where(lid),
        why: n.text + "Open since " + since(t.createdAt) +
          (tech ? ", assigned to " + tech + "." : t.vendorId != null ? ", sent to a vendor." : ", no technician assigned."),
        tone: tone(t.priority),
      },
      r: RANK[t.priority] ?? 2, b: n.boost, t: t.createdAt,
    });
  }
  for (const t of tasks) {
    const lid = t.listing_id ? String(t.listing_id) : null;
    const prio = String(t.priority ?? "normal");
    const n = today(lid);
    const who = nameOf(t.assigned_cleaner_id);
    const overdue = !!t.due_at && String(t.due_at) < nowIso;
    items.push({
      p: {
        ref: "TSK-" + t.id, source: "Team task", priority: prio, label: label(prio), title: String(t.title ?? "Task"),
        listingId: lid, ...where(lid),
        why: n.text + (who ? "Assigned to " + who : "Unassigned") +
          (overdue ? ", overdue since " + since(t.due_at) : t.due_at ? ", due " + since(t.due_at) : ", open since " + since(t.created_at)) + ".",
        tone: tone(prio),
      },
      r: RANK[prio] ?? 2, b: n.boost, t: String(t.due_at ?? t.created_at ?? ""),
    });
  }
  items.sort((x, y) => x.r - y.r || x.b - y.b || x.t.localeCompare(y.t));
  return {
    counts: {
      ticketsOpen: c.tickets.length,
      ticketsUrgent: c.tickets.filter((t) => t.priority === "urgent").length,
      ticketsNoTech: c.tickets.filter((t) => t.techId == null && t.vendorId == null).length,
      teamTasksOpen: tasks.length,
      teamTasksOverdue: tasks.filter((t: any) => t.due_at && String(t.due_at) < nowIso).length,
      inspectionFindingsOpen: findings.length,
      cleanerReportsOpen: c.tickets.filter((t) => t.source === MGR_CLEANER_REPORT_SOURCE).length,
    },
    top: items.slice(0, 5).map((x) => x.p),
  };
}
