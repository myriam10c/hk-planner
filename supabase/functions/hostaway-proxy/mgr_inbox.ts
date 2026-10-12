// Boite Problems de l'app manager (spec 2026-10-09-hk-manager-app-design.md,
// sections 3, 4 et 6) : regles pures, aucune base, aucun reseau. Les lectures
// vivent dans mgr_problems.ts, la fiche dans mgr_problem_get.ts, les gestes dans
// mgr_problem_act.ts. Un seul format de reference : MNT-<id ticket>, TSK-<id tache>.
// Les constats d'inspection envoyes en maintenance et les signalements cleaner v3
// sont deja des tickets (source inspection / hk_planner_v3) : MNT avec un badge.
import { dubaiDay, INSP_VALID_STATUSES } from "./insp_rules.ts";
import { ddmm, dubaiMs, hhmm, MGR_DEFAULT_CHECKIN_HOUR, type MgrReservation, type Tone } from "./mgr_rules.ts";
import { plusDays } from "./v3.ts";

// Statuts ouverts d'un ticket : la liste « open » de l'ecran Maintenance actuel
// (getMaintenanceTickets). to_confirm = verifie par une cleaner, reste a clore.
export const MGR_OPEN_TICKET_STATUSES = ["open", "assigned", "in_progress", "waiting_parts", "to_confirm"];
export const MGR_CLOSED_TICKET_STATUSES = ["resolved", "closed", "cancelled"];
export const MGR_OPEN_TASK_STATUSES = ["open", "in_progress"];
export const MGR_CLOSED_TASK_STATUSES = ["done", "cancelled"];
export const MGR_CLEANER_REPORT_SOURCE = "hk_planner_v3";
export const MGR_INSPECTION_SOURCE = "inspection";
// dispatchMaintenance (Hermes) recopiait chaque ticket non assigne en tache d'equipe
// avec source_ref « maint:<id> » (arrete en phase 2) : la copie n'est jamais listee,
// et mnt.act ticket.done ferme celles qui restent ouvertes.
export const MGR_MIRROR_PREFIX = "maint:";
export const MGR_TICKET_ASSIGNEE_ROLES = ["manager", "maintenance", "cleaner"];
export const MGR_TASK_ASSIGNEE_ROLES = ["manager", "maintenance"];
export const MGR_PAGE_DEFAULT = 50;
export const MGR_PAGE_MAX = 200;
export const MGR_SCHEDULE_MAX_DAYS = 365;

export type InboxKind = "MNT" | "TSK";
export type InboxSource = "Maintenance" | "Inspection" | "Cleaner report" | "Team task";
export type InboxPriority = "urgent" | "high" | "normal" | "low";
export type InboxAssignee = { kind: "member" | "vendor"; id: number; name: string };
export type InboxRow = {
  ref: string; kind: InboxKind; id: number; source: InboxSource;
  priority: InboxPriority; label: string; tone: Tone;
  title: string; status: string; closed: boolean;
  listingId: string | null; apt: string; bld: string;
  assignee: InboxAssignee | null;
  createdAt: string; since: string;
  dueAt: string | null; due: string | null; overdue: boolean;
  todayBoost: 0 | 1 | 2;   // 0 arrivee aujourd'hui, 1 depart aujourd'hui, 2 rien
  why: string;
};
export type RawTicket = {
  id: number | string; listing_id: string | null; title: string | null; priority: string | null; status: string | null;
  source: string | null; assigned_technician_id: number | null; assigned_vendor_id: number | null;
  created_at: string | null; sla_deadline: string | null; resolved_at?: string | null;
};
export type RawTask = {
  id: number | string; title: string | null; priority: string | null; status: string | null; listing_id: string | null;
  assigned_cleaner_id: number | null; due_at: string | null; created_at: string | null;
  completed_at?: string | null; source_ref: string | null;
};
export type TodayIdx = {
  arrivals: Record<string, { owner: boolean; time: string }>;
  checkouts: Record<string, { time: string | null }>;
};
export type InboxCtx = {
  nowMs: number;
  listings: Record<string, { apt: string; bld: string }>;
  people: Record<string, { name: string }>;
  vendors: Record<string, { name: string }>;
  today: TodayIdx;
};
export type InboxQuery = {
  urgent: boolean; mine: boolean; unassigned: boolean; listingId: string | null; source: InboxSource | null;
  q: string; offset: number; limit: number;
};
export type InboxCounts = {
  open: number; urgent: number; mine: number; unassigned: number; overdue: number;
  bySource: Record<InboxSource, number>;
};

const LABEL: Record<InboxPriority, string> = { urgent: "Urgent", high: "High", normal: "Normal", low: "Low" };
const TONE: Record<InboxPriority, Tone> = { urgent: "bad", high: "warn", normal: "idle", low: "idle" };
const RANK: Record<InboxPriority, number> = { urgent: 0, high: 1, normal: 2, low: 3 };
const STATUS_NOTE: Record<string, string> = {
  in_progress: " Work in progress.",
  waiting_parts: " Waiting for parts.",
  to_confirm: " Checked by a cleaner, to confirm and close.",
};
const SOURCE_PARAM: Record<string, InboxSource> = { task: "Team task" };
// Anciennes sources de tickets : encore acceptees (liens deja ouverts), sans effet.
const OLD_TICKET_SOURCES = new Set(["maintenance", "inspection", "cleaner"]);

export function problemRef(kind: InboxKind, id: number): string {
  return kind + "-" + id;
}
// Refus d'une reference MNT par mgr.problem.get et mgr.problem.act : les tickets
// s'ouvrent dans l'ecran Maintenance (mnt.get, mnt.act).
export const MGR_MNT_ELSEWHERE = "Open it in Maintenance.";
export function parseRef(ref: unknown): { kind: InboxKind; id: number } | null {
  if (typeof ref !== "string") return null;
  const m = ref.trim().toUpperCase().match(/^(MNT|TSK)-(\d{1,9})$/);
  if (!m) return null;
  const id = Number(m[2]);
  return id > 0 ? { kind: m[1] as InboxKind, id } : null;
}
export function normPriority(p: unknown): InboxPriority {
  const s = String(p ?? "").trim().toLowerCase();
  return s === "urgent" || s === "high" || s === "low" ? s : "normal";
}
export function priorityLabel(p: InboxPriority): string { return LABEL[p]; }
export function priorityTone(p: InboxPriority): Tone { return TONE[p]; }
export function ticketSource(source: unknown): InboxSource {
  const s = String(source ?? "");
  return s === MGR_INSPECTION_SOURCE ? "Inspection" : s === MGR_CLEANER_REPORT_SOURCE ? "Cleaner report" : "Maintenance";
}
// Comparaison en temps, jamais en chaines : Postgres rend « +00:00 », toISOString « Z ».
export function isOverdue(iso: string | null | undefined, nowMs: number): boolean {
  if (!iso) return false;
  const t = Date.parse(String(iso));
  return Number.isFinite(t) && t < nowMs;
}
function dayOf(iso: unknown): string | null {
  if (!iso) return null;
  const t = Date.parse(String(iso));
  return Number.isFinite(t) ? dubaiDay(new Date(t).toISOString()) : null;
}
const dd = (iso: unknown): string | null => {
  const d = dayOf(iso);
  return d ? ddmm(d) : null;
};
// Echeance d'un jour choisi : 23:59:59 heure de Dubai.
export function dueIsoFor(day: string): string {
  return new Date(dubaiMs(plusDays(day, 1), 0) - 1000).toISOString();
}
export function mirrorTicketId(sourceRef: unknown): number | null {
  const m = String(sourceRef ?? "").match(/^maint:(\d+)$/);
  return m ? Number(m[1]) : null;
}

export function todayFromBoard(
  jobs: Array<{ kind: string; listingId: string; postponedFrom: string | null; checkout: string | null }>,
  arrivals: Array<{ listingId: string; kind: string; time: string }>,
): TodayIdx {
  const out: TodayIdx = { arrivals: {}, checkouts: {} };
  for (const a of arrivals) {
    const cur = out.arrivals[a.listingId];
    if (!cur || a.time < cur.time) out.arrivals[a.listingId] = { owner: a.kind === "Owner stay", time: a.time };
  }
  for (const j of jobs) {
    if (j.kind !== "checkout" || j.postponedFrom || out.checkouts[j.listingId]) continue;
    out.checkouts[j.listingId] = { time: j.checkout };
  }
  return out;
}
export function todayFromReservations(res: MgrReservation[], day: string): TodayIdx {
  const arrivals: Array<{ listingId: string; kind: string; time: string }> = [];
  const jobs: Array<{ kind: string; listingId: string; postponedFrom: string | null; checkout: string | null }> = [];
  for (const r of res) {
    if (!INSP_VALID_STATUSES.includes(r.status)) continue;
    if (r.arrival === day) {
      arrivals.push({ listingId: r.listingId, kind: r.status === "ownerStay" ? "Owner stay" : "Guest", time: hhmm(r.checkInTime ?? MGR_DEFAULT_CHECKIN_HOUR)! });
    }
    if (r.departure === day) jobs.push({ kind: "checkout", listingId: r.listingId, postponedFrom: null, checkout: hhmm(r.checkOutTime) });
  }
  return todayFromBoard(jobs, arrivals);
}

function todayNote(lid: string | null, t: TodayIdx): { boost: 0 | 1 | 2; text: string } {
  if (!lid) return { boost: 2, text: "" };
  const a = t.arrivals[lid];
  if (a) return { boost: 0, text: (a.owner ? "The owner arrives" : "A guest arrives") + " today at " + a.time + ". " };
  const c = t.checkouts[lid];
  if (c) return { boost: 1, text: (c.time ? "Checkout today at " + c.time : "Checkout today, checkout time not set") + ". " };
  return { boost: 2, text: "" };
}
function place(lid: string | null, c: InboxCtx): { apt: string; bld: string } {
  const l = lid ? c.listings[lid] : undefined;
  return { apt: l?.apt ?? "", bld: l?.bld ?? "" };
}
function memberOf(id: unknown, c: InboxCtx): InboxAssignee | null {
  if (id === null || id === undefined) return null;
  const n = Number(id);
  return { kind: "member", id: n, name: c.people[String(n)]?.name || "Member " + n };
}
function vendorOf(id: unknown, c: InboxCtx): InboxAssignee | null {
  if (id === null || id === undefined) return null;
  const n = Number(id);
  return { kind: "vendor", id: n, name: c.vendors[String(n)]?.name || "Vendor " + n };
}
const NO_TODAY = { boost: 2 as const, text: "" };

export function ticketRow(t: RawTicket, c: InboxCtx): InboxRow {
  const id = Number(t.id);
  const lid = t.listing_id ? String(t.listing_id) : null;
  const priority = normPriority(t.priority);
  const status = String(t.status ?? "open");
  const closed = MGR_CLOSED_TICKET_STATUSES.includes(status);
  const n = closed ? NO_TODAY : todayNote(lid, c.today);
  const assignee = memberOf(t.assigned_technician_id, c) ?? vendorOf(t.assigned_vendor_id, c);
  const createdAt = String(t.created_at ?? "");
  const dueAt = t.sla_deadline ? String(t.sla_deadline) : null;
  const who = assignee?.kind === "member" ? ", assigned to " + assignee.name + "."
    : assignee ? ", sent to vendor " + assignee.name + "." : ", no technician assigned.";
  const why = closed
    ? "Closed" + (dd(t.resolved_at) ? " on " + dd(t.resolved_at) : "") + "."
    : n.text + "Open since " + (dd(createdAt) ?? "?") + who + (STATUS_NOTE[status] ?? "");
  return {
    ref: problemRef("MNT", id), kind: "MNT", id, source: ticketSource(t.source),
    priority, label: LABEL[priority], tone: TONE[priority],
    title: String(t.title ?? "").trim() || "Ticket", status, closed,
    listingId: lid, ...place(lid, c), assignee,
    createdAt, since: dd(createdAt) ?? "", dueAt, due: dd(dueAt), overdue: !closed && isOverdue(dueAt, c.nowMs),
    todayBoost: n.boost, why,
  };
}

export function taskRow(t: RawTask, c: InboxCtx): InboxRow {
  const id = Number(t.id);
  const lid = t.listing_id ? String(t.listing_id) : null;
  const priority = normPriority(t.priority);
  const status = String(t.status ?? "open");
  const closed = MGR_CLOSED_TASK_STATUSES.includes(status);
  const n = closed ? NO_TODAY : todayNote(lid, c.today);
  const assignee = memberOf(t.assigned_cleaner_id, c);
  const createdAt = String(t.created_at ?? "");
  const dueAt = t.due_at ? String(t.due_at) : null;
  const overdue = !closed && isOverdue(dueAt, c.nowMs);
  const why = closed
    ? "Closed" + (dd(t.completed_at) ? " on " + dd(t.completed_at) : "") + "."
    : n.text + (assignee ? "Assigned to " + assignee.name : "Unassigned") +
      (overdue ? ", overdue since " + (dd(dueAt) ?? "?") : dueAt ? ", due " + (dd(dueAt) ?? "?") : ", open since " + (dd(createdAt) ?? "?")) + ".";
  return {
    ref: problemRef("TSK", id), kind: "TSK", id, source: "Team task",
    priority, label: LABEL[priority], tone: TONE[priority],
    title: String(t.title ?? "").trim() || "Task", status, closed,
    listingId: lid, ...place(lid, c), assignee,
    createdAt, since: dd(createdAt) ?? "", dueAt, due: dd(dueAt), overdue, todayBoost: n.boost, why,
  };
}

// Ordre total et stable des taches : urgence, puis ce qui touche aujourd'hui
// (arrivee, puis depart), puis le plus ancien (echeance, sinon creation), puis id.
// Meme ordre pour Today et Tasks. Les tickets sont tries par mnt_read.ts.
export function rankRows(rows: InboxRow[]): InboxRow[] {
  const key = (r: InboxRow) => {
    const t = Date.parse(r.dueAt ?? r.createdAt);
    return Number.isFinite(t) ? t : Number.MAX_SAFE_INTEGER;
  };
  return rows.slice().sort((a, b) =>
    RANK[a.priority] - RANK[b.priority] || a.todayBoost - b.todayBoost || key(a) - key(b) || a.id - b.id);
}

// Boite Problems (ecran Tasks) : taches d'equipe seulement depuis la phase 2
// maintenance ; les tickets sont servis par mnt.list (ecran Maintenance).
export function buildInbox(tasks: RawTask[], c: InboxCtx): InboxRow[] {
  const rows: InboxRow[] = [];
  for (const t of tasks) {
    if (!MGR_OPEN_TASK_STATUSES.includes(String(t.status ?? "open"))) continue;
    if (mirrorTicketId(t.source_ref) !== null) continue;
    rows.push(taskRow(t, c));
  }
  return rankRows(rows);
}

const isMine = (r: InboxRow, meId: number) => r.assignee?.kind === "member" && r.assignee.id === meId;
const fold = (s: unknown) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
function matches(r: InboxRow, q: string): boolean {
  const words = fold(q).split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const hay = fold([
    r.ref, r.title, r.apt ? "apt " + r.apt : "", r.bld, r.source, r.label,
    r.assignee ? r.assignee.name : "unassigned",
  ].join(" "));
  return words.every((w) => hay.includes(w));
}
export function filterRows(rows: InboxRow[], f: InboxQuery, meId: number): InboxRow[] {
  return rows.filter((r) =>
    (!f.urgent || r.priority === "urgent") && (!f.mine || isMine(r, meId)) && (!f.unassigned || !r.assignee) &&
    (!f.listingId || r.listingId === f.listingId) && (!f.source || r.source === f.source) && matches(r, f.q));
}
export function inboxCounts(rows: InboxRow[], meId: number): InboxCounts {
  const bySource: Record<InboxSource, number> = { Maintenance: 0, Inspection: 0, "Cleaner report": 0, "Team task": 0 };
  for (const r of rows) bySource[r.source]++;
  return {
    open: rows.length, urgent: rows.filter((r) => r.priority === "urgent").length,
    mine: rows.filter((r) => isMine(r, meId)).length, unassigned: rows.filter((r) => !r.assignee).length,
    overdue: rows.filter((r) => r.overdue).length, bySource,
  };
}
export function apartmentsOf(rows: InboxRow[]): Array<{ listingId: string; apt: string; bld: string; n: number }> {
  const m = new Map<string, { listingId: string; apt: string; bld: string; n: number }>();
  for (const r of rows) {
    if (!r.listingId) continue;
    const e = m.get(r.listingId) ?? { listingId: r.listingId, apt: r.apt, bld: r.bld, n: 0 };
    e.n++;
    m.set(r.listingId, e);
  }
  return [...m.values()].sort((a, b) => b.n - a.n || (a.apt + " " + a.bld).localeCompare(b.apt + " " + b.bld));
}

export function parseInboxQuery(p: URLSearchParams): { ok: true; q: InboxQuery } | { ok: false; error: string } {
  const src = p.get("source") ?? "";
  if (src && !Object.prototype.hasOwnProperty.call(SOURCE_PARAM, src) && !OLD_TICKET_SOURCES.has(src)) {
    return { ok: false, error: "Unknown source." };
  }
  const source = Object.prototype.hasOwnProperty.call(SOURCE_PARAM, src) ? SOURCE_PARAM[src] : null;
  const offset = p.has("offset") ? Number(p.get("offset")) : 0;
  if (!Number.isInteger(offset) || offset < 0) return { ok: false, error: "Invalid offset." };
  const limit = p.has("limit") ? Number(p.get("limit")) : MGR_PAGE_DEFAULT;
  if (!Number.isInteger(limit) || limit < 0 || limit > MGR_PAGE_MAX) return { ok: false, error: "Invalid limit." };
  return {
    ok: true,
    q: {
      urgent: p.get("urgent") === "1", mine: p.get("mine") === "1", unassigned: p.get("unassigned") === "1",
      listingId: p.get("listingId") || null, source,
      q: (p.get("q") ?? "").trim().slice(0, 100), offset, limit,
    },
  };
}
