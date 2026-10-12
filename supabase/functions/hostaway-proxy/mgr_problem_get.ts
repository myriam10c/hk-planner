// Fiche d'une tache d'equipe de la boite (spec 2026-10-09, section 4) :
// commentaires, historique, personnes a qui l'affecter. Aucun appel Hostaway :
// la fiche ne depend que de la base. Depuis la phase 2 maintenance, une
// reference MNT est refusee (409) : la fiche d'un ticket est servie par mnt.get.
import type { ActionResult } from "./v3.ts";
import { ddmm } from "./mgr_rules.ts";
import { MGR_MNT_ELSEWHERE, parseRef, problemRef, taskRow, type InboxCtx } from "./mgr_inbox.ts";
import { assigneeOptions, loadRefs } from "./mgr_problems.ts";
import { readAllRows } from "./mgr_today.ts";

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
export function logText(l: { action?: unknown; actor?: unknown; details?: any }): string {
  const by = l.actor ? " by " + String(l.actor) : "";
  const d = l.details && typeof l.details === "object" ? l.details : {};
  switch (String(l.action ?? "")) {
    case "ticket_created": return "Ticket created" + by;
    case "ticket_updated": return "Updated" + (d.status ? " to " + String(d.status).replace(/_/g, " ") : "") + by;
    case "ticket_checked": return "Checked during a cleaning" + by;
    case "problem_assigned": return (d.to ? "Assigned to " + String(d.to) : "Unassigned") + by;
    case "problem_scheduled": return (d.date ? "Due date set to " + ddmm(String(d.date)) : "Due date removed") + by;
    case "problem_closed": return "Closed" + by + (d.note ? ": " + String(d.note) : "");
    case "problem_reopened": return "Reopened" + by;
    default: return cap(String(l.action ?? "update").replace(/_/g, " ")) + by;
  }
}

type Item = { at: string; text: string };
function byTime(xs: Item[]): Item[] {
  return xs.map((x, i) => ({ x, i, t: Date.parse(x.at) }))
    .sort((a, b) => (Number.isFinite(a.t) ? a.t : Infinity) - (Number.isFinite(b.t) ? b.t : Infinity) || a.i - b.i)
    .map((e) => e.x);
}
const byId = (xs: any[]) => xs.slice().sort((a, b) => Number(a.id) - Number(b.id));
const byCreated = (xs: any[]) => xs.slice().sort((a, b) =>
  (Date.parse(a.created_at) || 0) - (Date.parse(b.created_at) || 0) || Number(a.id) - Number(b.id));

async function taskDetail(sb: any, t: any, ctx: InboxCtx, logs: any[], nameOf: (id: unknown) => string | null) {
  const id = Number(t.id);
  const comments = await readAllRows((a: number, b: number) => sb.from("team_task_comments")
    .select("id, cleaner_id, body, created_at").eq("task_id", id).order("id").range(a, b), "team_task_comments");
  const problem = taskRow(t, ctx);
  const creator = nameOf(t.created_by_cleaner_id);
  const history: Item[] = [{ at: String(t.created_at ?? ""), text: "Created" + (creator ? " by " + creator : "") }];
  for (const l of logs) history.push({ at: String(l.created_at ?? ""), text: logText(l) });
  if (problem.closed && t.completed_at && !logs.some((l) => l.action === "problem_closed")) {
    const who = nameOf(t.completed_by_cleaner_id);
    history.push({ at: String(t.completed_at), text: "Closed" + (who ? " by " + who : "") });
  }
  return {
    problem, description: String(t.description ?? "").trim(), category: t.category ?? null, reportedBy: creator,
    photos: [], photosError: null,
    comments: byCreated(comments).map((c: any) => ({
      author: nameOf(c.cleaner_id) ?? "Unknown", text: String(c.body ?? ""), at: String(c.created_at ?? ""), photo: null,
    })),
    history: byTime(history), mirror: null,
  };
}

export async function mgrProblemGet(sb: any, o: { ref: string; nowMs: number }): Promise<ActionResult> {
  const p = parseRef(o.ref);
  if (!p) return { status: 400, body: { error: "Unknown problem reference." } };
  if (p.kind === "MNT") return { status: 409, body: { error: MGR_MNT_ELSEWHERE } };
  const ref = problemRef(p.kind, p.id);
  const { data: row, error } = await sb.from("team_tasks").select("*").eq("id", p.id).maybeSingle();
  if (error) throw error;
  if (!row) return { status: 404, body: { error: ref + " not found." } };
  const [refs, logs] = await Promise.all([
    loadRefs(sb),
    readAllRows((a: number, b: number) => sb.from("cleaning_log").select("id, action, actor, details, created_at")
      .eq("reservation_key", "task_" + p.id).order("id").range(a, b), "cleaning_log"),
  ]);
  const ctx: InboxCtx = {
    nowMs: o.nowMs, listings: refs.listings, people: refs.people, vendors: {},
    today: { arrivals: {}, checkouts: {} },
  };
  const nameOf = (id: unknown): string | null =>
    id === null || id === undefined ? null : refs.people[String(id)]?.name || "Member " + id;
  const detail = await taskDetail(sb, row, ctx, byId(logs), nameOf);
  return {
    status: 200,
    body: { ...detail, assignees: assigneeOptions(refs.people), vendors: [] },
  };
}
