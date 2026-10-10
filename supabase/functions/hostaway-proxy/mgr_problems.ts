// Boite Problems : lecture des tables (tickets et taches d'equipe ouverts,
// prestataires) et bloc « Open problems » de Today. Les regles (references,
// priorites, tri, filtres) vivent dans mgr_inbox.ts ; la meme boite sert Today
// (5 premiers) et l'ecran Problems (mgr.problems, ajoute par la tache 4).
import type { SessionUser } from "./auth.ts";
import type { MgrReservation } from "./mgr_rules.ts";
import {
  apartmentsOf, buildInbox, filterRows, inboxCounts, MGR_OPEN_TASK_STATUSES, MGR_OPEN_TICKET_STATUSES,
  MGR_TASK_ASSIGNEE_ROLES, MGR_TICKET_ASSIGNEE_ROLES, todayFromBoard, todayFromReservations,
  type InboxCounts, type InboxQuery, type InboxRow, type RawTask, type RawTicket, type TodayIdx,
} from "./mgr_inbox.ts";
import {
  listingMap, peopleMap, readAllRows, type MgrArrival, type MgrCore, type MgrJob, type MgrPerson,
} from "./mgr_today.ts";

export const MGR_TICKET_COLS =
  "id, listing_id, title, priority, status, source, assigned_technician_id, assigned_vendor_id, created_at, sla_deadline, resolved_at";
export const MGR_TASK_COLS =
  "id, title, priority, status, listing_id, assigned_cleaner_id, due_at, created_at, completed_at, source_ref";

export type RawVendor = { id: number; name: string | null; specialty: string | null; is_active: boolean | null };
export type InboxRaw = { tickets: RawTicket[]; tasks: RawTask[]; vendors: RawVendor[] };

export async function loadInboxRaw(sb: any): Promise<InboxRaw> {
  const [tickets, tasks, vendors] = await Promise.all([
    readAllRows((a: number, b: number) => sb.from("maintenance_tickets").select(MGR_TICKET_COLS)
      .in("status", MGR_OPEN_TICKET_STATUSES).order("id").range(a, b), "maintenance_tickets"),
    readAllRows((a: number, b: number) => sb.from("team_tasks").select(MGR_TASK_COLS)
      .in("status", MGR_OPEN_TASK_STATUSES).order("id").range(a, b), "team_tasks"),
    readAllRows((a: number, b: number) => sb.from("vendors").select("id, name, specialty, is_active").order("id").range(a, b), "vendors"),
  ]);
  return { tickets, tasks, vendors };
}

export function vendorNames(vs: RawVendor[]): Record<string, { name: string }> {
  return Object.fromEntries(vs.map((v) => [String(v.id), { name: String(v.name ?? "").trim() || "Vendor " + v.id }]));
}

export type MgrProblemCounts = {
  urgent: number; ticketsOpen: number; ticketsUrgent: number; ticketsNoTech: number;
  teamTasksOpen: number; teamTasksOverdue: number; inspectionTicketsOpen: number; cleanerReportsOpen: number;
};
export type MgrProblems = { counts: MgrProblemCounts; top: InboxRow[] };

export function todayCounts(rows: InboxRow[]): MgrProblemCounts {
  const mnt = rows.filter((r) => r.kind === "MNT");
  const tsk = rows.filter((r) => r.kind === "TSK");
  return {
    urgent: rows.filter((r) => r.priority === "urgent").length,
    ticketsOpen: mnt.length,
    ticketsUrgent: mnt.filter((r) => r.priority === "urgent").length,
    ticketsNoTech: mnt.filter((r) => !r.assignee).length,
    teamTasksOpen: tsk.length,
    teamTasksOverdue: tsk.filter((r) => r.overdue).length,
    inspectionTicketsOpen: mnt.filter((r) => r.source === "Inspection").length,
    cleanerReportsOpen: mnt.filter((r) => r.source === "Cleaner report").length,
  };
}

export async function loadProblems(sb: any, c: MgrCore, jobs: MgrJob[], arrivals: MgrArrival[]): Promise<MgrProblems> {
  const raw = await loadInboxRaw(sb);
  const rows = buildInbox(raw.tickets, raw.tasks, {
    nowMs: c.nowMs, listings: c.listings, people: c.people, vendors: vendorNames(raw.vendors),
    today: todayFromBoard(jobs, arrivals),
  });
  return { counts: todayCounts(rows), top: rows.slice(0, 5) };
}

export type AssigneeOption = { id: number; name: string; role: string; takesTasks: boolean };
export type VendorOption = { id: number; name: string; specialty: string };
const ROLE_ORDER: Record<string, number> = { manager: 0, maintenance: 1, cleaner: 2 };

export function assigneeOptions(people: Record<string, MgrPerson>): AssigneeOption[] {
  return Object.values(people)
    .filter((p) => p.active && MGR_TICKET_ASSIGNEE_ROLES.includes(p.role))
    .sort((a, b) => (ROLE_ORDER[a.role] ?? 9) - (ROLE_ORDER[b.role] ?? 9) || a.name.localeCompare(b.name))
    .map((p) => ({ id: p.id, name: p.name, role: p.role, takesTasks: MGR_TASK_ASSIGNEE_ROLES.includes(p.role) }));
}
export function vendorOptions(vs: RawVendor[]): VendorOption[] {
  return vs.filter((v) => v.is_active !== false)
    .map((v) => ({ id: Number(v.id), name: String(v.name ?? "").trim() || "Vendor " + v.id, specialty: String(v.specialty ?? "") }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
export async function loadRefs(sb: any): Promise<{ listings: Record<string, { apt: string; bld: string }>; people: Record<string, MgrPerson> }> {
  const [l, p] = await Promise.all([
    readAllRows((a: number, b: number) => sb.from("listing_config")
      .select("listing_id, internal_name, listing_name, apt_number").order("listing_id").range(a, b), "listing_config"),
    readAllRows((a: number, b: number) => sb.from("cleaners").select("id, name, role, is_active").order("id").range(a, b), "cleaners"),
  ]);
  return { listings: listingMap(l), people: peopleMap(p) };
}

export type MgrProblemsList = {
  day: string; generatedAt: string; bookingsCachedAt: string | null; bookingsUnavailable: boolean;
  me: { id: number; name: string };
  counts: InboxCounts; apartments: Array<{ listingId: string; apt: string; bld: string; n: number }>;
  total: number; offset: number; limit: number; rows: InboxRow[];
  assignees: AssigneeOption[]; vendors: VendorOption[];
};

// Action mgr.problems. Hostaway (cache mgr:res:<jour>) ne sert qu'a remonter ce
// qui touche une arrivee ou un depart du jour : s'il manque, la liste est servie
// quand meme, triee sans ce coup de pouce, et le front le signale.
export async function mgrProblems(sb: any, o: {
  day: string; nowMs: number; me: SessionUser; query: InboxQuery;
  loadReservations: (day: string) => Promise<{ reservations: MgrReservation[]; cachedAt: string | null }>;
}): Promise<{ status: 200; body: MgrProblemsList }> {
  const [booked, raw, refs] = await Promise.all([
    o.loadReservations(o.day).then((r) => ({ ok: true as const, r }), () => ({ ok: false as const, r: null })),
    loadInboxRaw(sb),
    loadRefs(sb),
  ]);
  const today: TodayIdx = booked.ok ? todayFromReservations(booked.r.reservations, o.day) : { arrivals: {}, checkouts: {} };
  const all = buildInbox(raw.tickets, raw.tasks, {
    nowMs: o.nowMs, listings: refs.listings, people: refs.people, vendors: vendorNames(raw.vendors), today,
  });
  const rows = filterRows(all, o.query, o.me.cleaner_id);
  return {
    status: 200,
    body: {
      day: o.day, generatedAt: new Date(o.nowMs).toISOString(),
      bookingsCachedAt: booked.ok ? booked.r.cachedAt : null, bookingsUnavailable: !booked.ok,
      me: { id: o.me.cleaner_id, name: o.me.name },
      counts: inboxCounts(all, o.me.cleaner_id), apartments: apartmentsOf(all),
      total: rows.length, offset: o.query.offset, limit: o.query.limit,
      rows: rows.slice(o.query.offset, o.query.offset + o.query.limit),
      assignees: assigneeOptions(refs.people), vendors: vendorOptions(raw.vendors),
    },
  };
}
