// Gestes de la boite Problems (spec 2026-10-09-hk-manager-app-design.md, sections
// 3 et 6). Auteur toujours pris dans la session (me), jamais dans le corps.
// Idempotence par cle, meme convention que v3 et inspections (job_events) :
// validation, puis cle, puis rejeu, puis etat du probleme, puis ecriture ;
// une ecriture ratee libere la cle, les effets secondaires (journal, copie
// Hermes, notification) ne font jamais echouer un geste deja ecrit.
import type { SessionUser } from "./auth.ts";
import {
  claimEvent, plusDays, recordResult, releaseEvent, replayResponse, todayDubai, v3Log, validIdem,
  type ActionResult,
} from "./v3.ts";
import { sansEchec } from "./v3_photos.ts";
import { setFixSchedule } from "./insp_write.ts";
import {
  dueIsoFor, MGR_CLOSED_TASK_STATUSES, MGR_CLOSED_TICKET_STATUSES, MGR_INSPECTION_SOURCE, MGR_MIRROR_PREFIX,
  MGR_OPEN_TASK_STATUSES, MGR_OPEN_TICKET_STATUSES, MGR_SCHEDULE_MAX_DAYS, MGR_TASK_ASSIGNEE_ROLES,
  MGR_TICKET_ASSIGNEE_ROLES, parseRef, problemRef, type InboxAssignee, type InboxKind,
} from "./mgr_inbox.ts";
import { readAllRows } from "./mgr_today.ts";

export const MGR_ACT_EVENT = "mgr_problem_act" as const;
export const MGR_TEXT_MAX = 2000;

export type ActDeps = { nowMs?: number; notifyTask?: (task: any) => void };
export type Act =
  | { verb: "assign"; memberId: number | null; vendorId: number | null }
  | { verb: "schedule"; date: string | null }
  | { verb: "comment"; text: string }
  | { verb: "close"; note: string }
  | { verb: "reopen" };
type Target = { kind: InboxKind; id: number; ref: string; row: any; logKey: string };
type Done = { result: Record<string, unknown>; after: Array<[string, () => Promise<unknown>]> };
type Ctx = { sb: any; me: SessionUser; t: Target; nowMs: number; nowIso: string; deps: ActDeps };

const bad = (status: number, error: string): ActionResult => ({ status, body: { error } });
const has = (v: unknown) => v !== undefined && v !== null && v !== "";
function validDay(d: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return false;
  const t = new Date(d + "T00:00:00Z");
  return Number.isFinite(t.getTime()) && t.toISOString().slice(0, 10) === d;
}
function cleanText(v: unknown): string {
  return typeof v === "string" ? v.trim().slice(0, MGR_TEXT_MAX) : "";
}
function posInt(v: unknown): number | null {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export function parseAct(body: any, today: string): Act | { error: string } {
  const verb = String(body?.verb ?? "");
  if (verb === "assign") {
    if (body?.unassign === true) return { verb, memberId: null, vendorId: null };
    if (has(body?.memberId) && has(body?.vendorId)) return { error: "Choose a person or a vendor, not both." };
    if (has(body?.memberId)) {
      const n = posInt(body.memberId);
      return n ? { verb, memberId: n, vendorId: null } : { error: "Invalid person." };
    }
    if (has(body?.vendorId)) {
      const n = posInt(body.vendorId);
      return n ? { verb, memberId: null, vendorId: n } : { error: "Invalid vendor." };
    }
    return { error: "Choose a person or a vendor." };
  }
  if (verb === "schedule") {
    if (!has(body?.date)) return { verb, date: null };
    const d = String(body.date);
    if (!validDay(d)) return { error: "Invalid date." };
    if (d < today) return { error: "The date cannot be in the past." };
    if (d > plusDays(today, MGR_SCHEDULE_MAX_DAYS)) return { error: "The date is too far ahead." };
    return { verb, date: d };
  }
  if (verb === "comment") {
    const text = cleanText(body?.text);
    return text ? { verb, text } : { error: "Write a comment first." };
  }
  if (verb === "close") return { verb, note: cleanText(body?.note) };
  if (verb === "reopen") return { verb };
  return { error: "Unknown action." };
}

// Etat du probleme au moment du geste, lu apres la cle : un rejeu rend son
// resultat memorise meme si le probleme a change entre-temps.
export function stateRefusal(verb: string, closed: boolean, ref: string): string | null {
  if (closed && (verb === "assign" || verb === "schedule")) return ref + " is closed. Reopen it first.";
  if (closed && verb === "close") return ref + " is already closed.";
  if (!closed && verb === "reopen") return ref + " is not closed.";
  return null;
}

async function assigneeName(sb: any, kind: InboxKind, a: { memberId: number | null; vendorId: number | null }):
  Promise<{ name: string | null } | ActionResult> {
  if (a.memberId !== null) {
    const { data: c, error } = await sb.from("cleaners").select("id, name, role, is_active").eq("id", a.memberId).maybeSingle();
    if (error) throw error;
    const roles = kind === "MNT" ? MGR_TICKET_ASSIGNEE_ROLES : MGR_TASK_ASSIGNEE_ROLES;
    if (!c || c.is_active === false || !roles.includes(String(c.role ?? ""))) {
      return bad(400, kind === "MNT" ? "This person cannot take tickets." : "This person cannot take team tasks.");
    }
    return { name: String(c.name ?? "").trim() || "Member " + a.memberId };
  }
  if (a.vendorId !== null) {
    if (kind === "TSK") return bad(400, "Team tasks go to a team member, not a vendor.");
    const { data: v, error } = await sb.from("vendors").select("id, name, is_active").eq("id", a.vendorId).maybeSingle();
    if (error) throw error;
    if (!v || v.is_active === false) return bad(400, "This vendor is not active.");
    return { name: String(v.name ?? "").trim() || "Vendor " + a.vendorId };
  }
  return { name: null };
}

async function doAssign(c: Ctx, a: { memberId: number | null; vendorId: number | null }, who: string | null): Promise<Done> {
  const { sb, t } = c;
  const after: Done["after"] = [];
  if (t.kind === "MNT") {
    const st = String(t.row.status ?? "open");
    const taken = a.memberId !== null || a.vendorId !== null;
    // open et assigned suivent l'affectation ; in_progress, waiting_parts et to_confirm restent.
    const status = st === "open" || st === "assigned" ? (taken ? "assigned" : "open") : st;
    const { error } = await sb.from("maintenance_tickets").update({
      assigned_technician_id: a.memberId, assigned_vendor_id: a.vendorId, status, last_update: c.nowIso,
    }).eq("id", t.id);
    if (error) throw error;
  } else {
    const { data: task, error } = await sb.from("team_tasks").update({ assigned_cleaner_id: a.memberId })
      .eq("id", t.id).select().single();
    if (error) throw error;
    const notify = c.deps.notifyTask;
    if (a.memberId !== null && Number(t.row.assigned_cleaner_id) !== a.memberId && notify) {
      after.push(["notification de " + t.ref, async () => notify(task)]);
    }
  }
  const assignee: InboxAssignee | null = a.memberId !== null ? { kind: "member", id: a.memberId, name: who ?? "" }
    : a.vendorId !== null ? { kind: "vendor", id: a.vendorId, name: who ?? "" } : null;
  after.unshift(["journal de " + t.ref, () =>
    v3Log(sb, t.logKey, "problem_assigned", c.me.name, { to: who, kind: assignee ? assignee.kind : null })]);
  return { result: { assignee }, after };
}

async function doSchedule(c: Ctx, a: { date: string | null }): Promise<Done> {
  const { sb, t } = c;
  const due = a.date ? dueIsoFor(a.date) : null;
  const after: Done["after"] = [];
  if (t.kind === "MNT") {
    const { error } = await sb.from("maintenance_tickets").update({ sla_deadline: due, last_update: c.nowIso }).eq("id", t.id);
    if (error) throw error;
    if (String(t.row.source ?? "") === MGR_INSPECTION_SOURCE) {
      // La date de rectification de la zone (ecran Inspections) suit la meme date.
      after.push(["date de rectification de " + t.ref, async () => {
        const { data: items, error: e } = await sb.from("inspection_items").select("inspection_id, zone, outcome").eq("ticket_id", t.id);
        if (e) throw e;
        for (const it of items ?? []) {
          if (it.outcome !== "maintenance") continue;
          const r = await setFixSchedule(sb, c.me, { inspectionId: it.inspection_id, zone: it.zone, date: a.date, slot: null }, c.nowMs);
          if (r.status !== 200) throw new Error(String(r.body.error ?? "fix date refused"));
        }
      }]);
    }
  } else {
    const { error } = await sb.from("team_tasks").update({ due_at: due }).eq("id", t.id);
    if (error) throw error;
  }
  after.unshift(["journal de " + t.ref, () => v3Log(sb, t.logKey, "problem_scheduled", c.me.name, { date: a.date })]);
  return { result: { dueAt: due }, after };
}

async function doComment(c: Ctx, a: { text: string }): Promise<Done> {
  const { sb, t } = c;
  const ins = t.kind === "MNT"
    ? sb.from("ticket_comments").insert({ ticket_id: t.id, author: c.me.name, comment: a.text })
    : sb.from("team_task_comments").insert({ task_id: t.id, cleaner_id: c.me.cleaner_id, body: a.text });
  const { data, error } = await ins.select("id, created_at").single();
  if (error) throw error;
  return { result: { comment: { author: c.me.name, text: a.text, at: data?.created_at ? String(data.created_at) : c.nowIso } }, after: [] };
}

async function doClose(c: Ctx, a: { note: string }): Promise<Done> {
  const { sb, t } = c;
  const from = String(t.row.status ?? "open");
  const after: Done["after"] = [];
  if (t.kind === "MNT") {
    // Copies Hermes encore ouvertes : lues avant l'ecriture, fermees apres (effet secondaire).
    const mirrors = (await readAllRows((x: number, y: number) => sb.from("team_tasks").select("id, status")
      .eq("source_ref", MGR_MIRROR_PREFIX + t.id).order("id").range(x, y), "team_tasks"))
      .filter((m: any) => MGR_OPEN_TASK_STATUSES.includes(String(m.status ?? ""))).map((m: any) => Number(m.id));
    const { error } = await sb.from("maintenance_tickets").update({
      status: "resolved", resolved_at: c.nowIso, last_update: c.nowIso, ...(a.note ? { resolution_notes: a.note } : {}),
    }).eq("id", t.id);
    if (error) throw error;
    after.push(["journal de " + t.ref, () => v3Log(sb, t.logKey, "problem_closed", c.me.name, {
      from, notes: t.row.resolution_notes ?? null, mirrors, note: a.note || null,
    })]);
    if (mirrors.length) {
      after.push(["copies Hermes de " + t.ref, async () => {
        const { error: e } = await sb.from("team_tasks")
          .update({ status: "done", completed_at: c.nowIso, completed_by_cleaner_id: c.me.cleaner_id }).in("id", mirrors);
        if (e) throw e;
      }]);
    }
    if (a.note) {
      after.push(["note de " + t.ref, async () => {
        const { error: e } = await sb.from("ticket_comments").insert({ ticket_id: t.id, author: c.me.name, comment: a.note });
        if (e) throw e;
      }]);
    }
  } else {
    const { error } = await sb.from("team_tasks")
      .update({ status: "done", completed_at: c.nowIso, completed_by_cleaner_id: c.me.cleaner_id }).eq("id", t.id);
    if (error) throw error;
    after.push(["journal de " + t.ref, () => v3Log(sb, t.logKey, "problem_closed", c.me.name, { from, note: a.note || null })]);
    if (a.note) {
      after.push(["note de " + t.ref, async () => {
        const { error: e } = await sb.from("team_task_comments").insert({ task_id: t.id, cleaner_id: c.me.cleaner_id, body: a.note });
        if (e) throw e;
      }]);
    }
  }
  return { result: { closed: true }, after };
}

// Ordre de deux lignes du journal : par created_at (Date.parse, decalage Postgres
// compris), a defaut par id (meme table, ids croissants). > 0 si x est plus recent.
function newer(x: any, y: any): number {
  const a = Date.parse(String(x?.created_at ?? "")), b = Date.parse(String(y?.created_at ?? ""));
  if (Number.isFinite(a) && Number.isFinite(b)) return a - b;
  return Number(x?.id) - Number(y?.id);
}
function latest(rows: any[]): any | null {
  return rows.reduce((m: any, r: any) => (m === null || newer(r, m) > 0 || (newer(r, m) === 0 && Number(r.id) > Number(m.id)) ? r : m), null);
}

// Undo de Close : l'etat d'avant vient du dernier journal problem_closed. Sans
// journal (probleme clos ailleurs), retour a assigned ou open. Un problem_closed
// pas plus recent que le dernier problem_reopened est perime (clos ensuite dans
// l'ancienne app) : on l'ignore, notes et copies Hermes ne sont pas touchees.
async function doReopen(c: Ctx): Promise<Done> {
  const { sb, t } = c;
  const logs = await readAllRows((x: number, y: number) => sb.from("cleaning_log").select("id, action, details, created_at")
    .eq("reservation_key", t.logKey).in("action", ["problem_closed", "problem_reopened"]).order("id").range(x, y), "cleaning_log");
  const closedLog = latest(logs.filter((l: any) => l.action === "problem_closed"));
  const reopenedLog = latest(logs.filter((l: any) => l.action === "problem_reopened"));
  const last = closedLog && (!reopenedLog || newer(closedLog, reopenedLog) > 0) ? closedLog : null;
  const d = last && last.details && typeof last.details === "object" ? last.details : null;
  const after: Done["after"] = [];
  let state: string;
  if (t.kind === "MNT") {
    const fallback = t.row.assigned_technician_id != null || t.row.assigned_vendor_id != null ? "assigned" : "open";
    state = d && MGR_OPEN_TICKET_STATUSES.includes(String(d.from)) ? String(d.from) : fallback;
    const { error } = await sb.from("maintenance_tickets").update({
      status: state, resolved_at: null, closed_at: null, last_update: c.nowIso,
      ...(d ? { resolution_notes: d.notes ?? null } : {}),
    }).eq("id", t.id);
    if (error) throw error;
    const mirrors = d && Array.isArray(d.mirrors)
      ? d.mirrors.map(Number).filter((n: number) => Number.isInteger(n) && n > 0) : [];
    if (mirrors.length) {
      after.push(["copies Hermes de " + t.ref, async () => {
        const { error: e } = await sb.from("team_tasks")
          .update({ status: "open", completed_at: null, completed_by_cleaner_id: null }).in("id", mirrors).eq("status", "done");
        if (e) throw e;
      }]);
    }
  } else {
    state = d && MGR_OPEN_TASK_STATUSES.includes(String(d.from)) ? String(d.from) : "open";
    const { error } = await sb.from("team_tasks")
      .update({ status: state, completed_at: null, completed_by_cleaner_id: null }).eq("id", t.id);
    if (error) throw error;
  }
  after.unshift(["journal de " + t.ref, () => v3Log(sb, t.logKey, "problem_reopened", c.me.name, { to: state })]);
  return { result: { state }, after };
}

const WRITERS: Record<string, (c: Ctx, a: any, who: string | null) => Promise<Done>> = {
  assign: doAssign, schedule: doSchedule, comment: doComment, close: doClose, reopen: doReopen,
};

export async function mgrProblemAct(sb: any, me: SessionUser, body: any, deps: ActDeps = {}): Promise<ActionResult> {
  const nowMs = deps.nowMs ?? Date.now();
  const p = parseRef(body?.ref);
  if (!p) return bad(400, "Unknown problem reference.");
  const ref = problemRef(p.kind, p.id);
  const a = parseAct(body, todayDubai(nowMs));
  if ("error" in a) return bad(400, a.error);
  if (!validIdem(body?.idem)) return bad(400, "idem required");
  const idem = String(body.idem);
  const { data: row, error } = await sb.from(p.kind === "MNT" ? "maintenance_tickets" : "team_tasks")
    .select("*").eq("id", p.id).maybeSingle();
  if (error) throw error;
  if (!row) return bad(404, ref + " not found.");
  let who: string | null = null;
  if (a.verb === "assign") {
    const w = await assigneeName(sb, p.kind, a);
    if ("status" in w) return w;
    who = w.name;
  }
  const claim = await claimEvent(sb, idem, MGR_ACT_EVENT, ref, me.cleaner_id, { ...a });
  const replay = replayResponse(claim);
  if (replay) return replay;
  // Copie de la ligne lue : l'etat d'avant ne doit pas suivre l'ecriture.
  const closed = (p.kind === "MNT" ? MGR_CLOSED_TICKET_STATUSES : MGR_CLOSED_TASK_STATUSES).includes(String(row.status ?? ""));
  const refusal = stateRefusal(a.verb, closed, ref);
  if (refusal) {
    await releaseEvent(sb, idem);
    return bad(409, refusal);
  }
  const t: Target = { kind: p.kind, id: p.id, ref, row: { ...row }, logKey: (p.kind === "MNT" ? "ticket_" : "task_") + p.id };
  const c: Ctx = { sb, me, t, nowMs, nowIso: new Date(nowMs).toISOString(), deps };
  let done: Done;
  try {
    done = await WRITERS[a.verb](c, a, who);
  } catch (e) {
    await releaseEvent(sb, idem);
    throw e;
  }
  const result = { status: "success", ref, verb: a.verb, ...done.result };
  await sansEchec("resultat non memorise pour " + idem, () => recordResult(sb, idem, result));
  for (const [what, fn] of done.after) await sansEchec(what, fn);
  return { status: 200, body: result };
}
