// Fiche d'un probleme de la boite (spec 2026-10-09, section 4) : photos signees,
// commentaires, historique, copie Hermes, personnes et prestataires a qui
// l'affecter. Aucun appel Hostaway : la fiche ne depend que de la base.
import { V3_PHOTO_BUCKET, type ActionResult } from "./v3.ts";
import { ddmm } from "./mgr_rules.ts";
import { MGR_OPEN_TASK_STATUSES, parseRef, problemRef, taskRow, ticketRow, type InboxCtx } from "./mgr_inbox.ts";
import { assigneeOptions, loadRefs, vendorNames, vendorOptions } from "./mgr_problems.ts";
import { readAllRows } from "./mgr_today.ts";

export const MGR_SIGN_SECONDS = 3600;

// Un seul lot de signature par fiche. Rend null si la signature echoue (la fiche
// s'affiche quand meme, sans photos, avec un message).
export async function signPaths(sb: any, paths: string[]): Promise<Record<string, string> | null> {
  const uniq = [...new Set(paths.filter((p) => p && !/^(https?:|data:)/i.test(p)))];
  if (!uniq.length) return {};
  const { data, error } = await sb.storage.from(V3_PHOTO_BUCKET).createSignedUrls(uniq, MGR_SIGN_SECONDS);
  if (error || !Array.isArray(data)) return null;
  const out: Record<string, string> = {};
  for (const d of data) if (d && d.signedUrl && !d.error) out[String(d.path)] = String(d.signedUrl);
  return out;
}

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

async function ticketDetail(sb: any, t: any, ctx: InboxCtx, logs: any[], nameOf: (id: unknown) => string | null) {
  const id = Number(t.id);
  const m = String(t.source_ref ?? "").match(/^inspection:(\d+):(.+)$/);
  const [comments, shots, insp, mirrors] = await Promise.all([
    readAllRows((a: number, b: number) => sb.from("ticket_comments").select("id, author, comment, created_at, photo_path")
      .eq("ticket_id", id).order("id").range(a, b), "ticket_comments"),
    readAllRows((a: number, b: number) => sb.from("photos").select("id, storage_path, kind")
      .eq("ticket_id", id).order("id").range(a, b), "photos"),
    m ? readAllRows((a: number, b: number) => sb.from("inspection_photos").select("id, kind, storage_path")
      .eq("inspection_id", Number(m[1])).eq("zone", m[2]).order("id").range(a, b), "inspection_photos") : Promise.resolve([]),
    readAllRows((a: number, b: number) => sb.from("team_tasks").select("id, status, assigned_cleaner_id")
      .eq("source_ref", "maint:" + id).order("id").range(a, b), "team_tasks"),
  ]);
  const want: Array<{ path: string; label: string }> = [];
  const seen = new Set<string>();
  const add = (path: unknown, label: string) => {
    const s = String(path ?? "").trim();
    if (!s || seen.has(s) || /^data:/i.test(s)) return;
    seen.add(s);
    want.push({ path: s, label });
  };
  add(t.photo_path, "Reported");
  for (const s of byId(shots)) if (s.kind !== "voice") add(s.storage_path, "Cleaner photo");
  for (const s of byId(insp)) add(s.storage_path, s.kind === "after" ? "After the fix" : "Inspection");
  add(t.resolution_photo_path, "After the fix");
  const cs = byCreated(comments);
  const signed = await signPaths(sb, [...want.map((w) => w.path), ...cs.map((c: any) => String(c.photo_path ?? ""))]);
  const urlOf = (p: unknown): string | null => {
    const s = String(p ?? "").trim();
    if (!s) return null;
    if (/^https?:/i.test(s)) return s;
    return signed ? signed[s] ?? null : null;
  };
  const problem = ticketRow(t, ctx);
  const history: Item[] = [];
  if (!logs.some((l) => l.action === "ticket_created")) {
    history.push({ at: String(t.created_at ?? ""), text: "Reported" + (t.reported_by ? " by " + t.reported_by : "") });
  }
  for (const l of logs) history.push({ at: String(l.created_at ?? ""), text: logText(l) });
  const closedAt = t.resolved_at ?? t.closed_at;
  if (problem.closed && closedAt && !logs.some((l) => l.action === "problem_closed")) history.push({ at: String(closedAt), text: "Closed" });
  const mir = mirrors.find((x: any) => MGR_OPEN_TASK_STATUSES.includes(String(x.status))) ?? mirrors[0] ?? null;
  return {
    problem, description: String(t.description ?? "").trim(), category: t.category ?? null, reportedBy: t.reported_by ?? null,
    photos: want.map((w) => ({ url: urlOf(w.path), label: w.label })).filter((x) => x.url) as Array<{ url: string; label: string }>,
    photosError: signed === null ? "Photos could not be loaded." : null,
    comments: cs.map((c: any) => ({
      author: String(c.author ?? "").trim() || "Unknown", text: String(c.comment ?? ""), at: String(c.created_at ?? ""), photo: urlOf(c.photo_path),
    })),
    history: byTime(history),
    mirror: mir ? { ref: problemRef("TSK", Number(mir.id)), status: String(mir.status ?? ""), assignee: nameOf(mir.assigned_cleaner_id) } : null,
  };
}

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
  const ref = problemRef(p.kind, p.id);
  const { data: row, error } = await sb.from(p.kind === "MNT" ? "maintenance_tickets" : "team_tasks")
    .select("*").eq("id", p.id).maybeSingle();
  if (error) throw error;
  if (!row) return { status: 404, body: { error: ref + " not found." } };
  const key = (p.kind === "MNT" ? "ticket_" : "task_") + p.id;
  const [refs, vendors, logs] = await Promise.all([
    loadRefs(sb),
    readAllRows((a: number, b: number) => sb.from("vendors").select("id, name, specialty, is_active").order("id").range(a, b), "vendors"),
    readAllRows((a: number, b: number) => sb.from("cleaning_log").select("id, action, actor, details, created_at")
      .eq("reservation_key", key).order("id").range(a, b), "cleaning_log"),
  ]);
  const ctx: InboxCtx = {
    nowMs: o.nowMs, listings: refs.listings, people: refs.people, vendors: vendorNames(vendors),
    today: { arrivals: {}, checkouts: {} },
  };
  const nameOf = (id: unknown): string | null =>
    id === null || id === undefined ? null : refs.people[String(id)]?.name || "Member " + id;
  const detail = p.kind === "MNT"
    ? await ticketDetail(sb, row, ctx, byId(logs), nameOf)
    : await taskDetail(sb, row, ctx, byId(logs), nameOf);
  return {
    status: 200,
    body: { ...detail, assignees: assigneeOptions(refs.people), vendors: p.kind === "MNT" ? vendorOptions(vendors) : [] },
  };
}
