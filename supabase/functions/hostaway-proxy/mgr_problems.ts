// Boite Problems : lecture des tables (tickets et taches d'equipe ouverts,
// prestataires) et bloc « Open problems » de Today. Les regles (references,
// priorites, tri, filtres) vivent dans mgr_inbox.ts ; la meme boite sert Today
// (5 premiers) et l'ecran Problems (mgr.problems, ajoute par la tache 4).
import {
  buildInbox, MGR_OPEN_TASK_STATUSES, MGR_OPEN_TICKET_STATUSES, todayFromBoard,
  type InboxRow, type RawTask, type RawTicket,
} from "./mgr_inbox.ts";
import { readAllRows, type MgrArrival, type MgrCore, type MgrJob } from "./mgr_today.ts";

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
