// Lecture de la section Maintenance (action mnt.list, phase 1 serveur) : propositions
// tirees des messages des guests, tickets ouverts et tickets faits. Les compteurs
// portent toujours sur tout l'ouvert et toutes les propositions en attente, quels
// que soient l'onglet et le filtre. Toute erreur de lecture rend un 503.
import { listingMap, readAllRows } from "./mgr_today.ts";
import { MGR_CLOSED_TICKET_STATUSES, MGR_OPEN_TICKET_STATUSES, problemRef } from "./mgr_inbox.ts";
import { guestInNow, MNT_CATEGORY_LABEL, MNT_ROLES, type MntCategory, proposalRef } from "./mnt_rules.ts";
import { todayDubai } from "./v3.ts";

export const MNT_TABS = ["proposals", "open", "done"] as const;
export const MNT_FILTERS = ["all", "mine", "urgent", "unassigned"] as const;
export const MNT_WINDOW_DAYS = 30;
const MNT_Q_MAX = 100;
export const MNT_UNAVAILABLE = "Maintenance is unavailable right now. Try again.";

export type MntQuery = { tab: "proposals" | "open" | "done"; filter: "all" | "mine" | "urgent" | "unassigned"; q: string; rejected: boolean };

export function parseMntQuery(p: URLSearchParams): MntQuery | { error: string } {
  const tab = (p.get("tab") ?? "").trim() || "proposals";
  if (!(MNT_TABS as readonly string[]).includes(tab)) return { error: "Invalid tab." };
  const filter = (p.get("filter") ?? "").trim() || "all";
  if (!(MNT_FILTERS as readonly string[]).includes(filter)) return { error: "Invalid filter." };
  const q = (p.get("q") ?? "").trim().slice(0, MNT_Q_MAX);
  const r = (p.get("rejected") ?? "").trim().toLowerCase();
  return { tab: tab as MntQuery["tab"], filter: filter as MntQuery["filter"], q, rejected: r === "1" || r === "true" };
}

type Quote = { message_id: string; at: string; text: string };
export type MntProposalRow = {
  id: number; ref: string; listingId: string | null; apt: string; bld: string; title: string;
  category: string; categoryLabel: string; urgency: string; guestName: string | null; stayFrom: string | null; stayTo: string | null;
  guestInNow: boolean; quotes: Quote[]; conversationId: string; reservationId: string | null;
  openTicket: { id: number; ref: string; title: string } | null; status: string; rejectReason: string | null; rejectNote: string | null;
  ticket: { id: number; ref: string } | null; decidedBy: string | null;
  decidedAt: string | null; createdAt: string; updatedAt: string;
};
export type MntStage = "todo" | "in_progress" | "waiting_parts" | "to_confirm" | "done";
export type MntOrigin = "guest_message" | "cleaner_report" | "inspection" | "manual";
export type MntTicketRow = {
  id: number; ref: string; listingId: string | null; apt: string; bld: string; title: string; category: string | null;
  priority: string; status: string; stage: MntStage; origin: MntOrigin;
  assignee: { kind: "member" | "vendor"; id: number; name: string } | null; dueOn: string | null; createdAt: string; startedAt: string | null;
  resolvedAt: string | null; resolvedBy: string | null; resolutionNotes: string | null; actualCost: number | null; proposalId: number | null;
};
export type MntList = {
  tab: MntQuery["tab"]; counts: { proposals: number; open: number; urgent: number; unassigned: number; mine: number };
  proposals: MntProposalRow[]; tickets: MntTicketRow[]; team: Array<{ id: number; name: string; role: string }>; vendors: Array<{ id: number; name: string }>;
  listings: Array<{ id: string; apt: string; bld: string }>;
};

export const MNT_TICKET_COLS =
  "id, listing_id, title, category, priority, status, source, assigned_technician_id, assigned_vendor_id, created_at, started_at, resolved_at, closed_at, resolution_notes, actual_cost, proposal_id, due_on";
export const MNT_PROPOSAL_COLS =
  "id, listing_id, reservation_id, conversation_id, guest_name, stay_from, stay_to, title, category, urgency, quotes, status, open_ticket_id, ticket_id, decided_by, decided_at, reject_reason, reject_note, created_at, updated_at";

const URGENCY_RANK: Record<string, number> = { urgent: 0, high: 1, normal: 2 };
const urgRank = (u: unknown) => URGENCY_RANK[String(u ?? "")] ?? 2;
const PRIORITY_RANK: Record<string, number> = { urgent: 0, high: 1, medium: 2, low: 3 };
const prioRank = (p: unknown) => PRIORITY_RANK[String(p ?? "")] ?? 2;
const STAGE: Record<string, MntStage> = {
  open: "todo", assigned: "todo", in_progress: "in_progress", waiting_parts: "waiting_parts", to_confirm: "to_confirm",
};
const ORIGIN: Record<string, MntOrigin> = { guest_message: "guest_message", hk_planner_v3: "cleaner_report", inspection: "inspection" };
const DONE_STATUSES = MGR_CLOSED_TICKET_STATUSES.filter((s) => s !== "cancelled");

const str = (v: unknown): string | null => (v === null || v === undefined || v === "" ? null : String(v));
const idOrNull = (v: unknown): number | null => (v === null || v === undefined || v === "" ? null : Number(v));
// Date de cloture d'un ticket : resolved_at, sinon closed_at (cloture par l'ancien chemin).
const closedAt = (t: any): string | null => str(t.resolved_at) ?? str(t.closed_at);
const desc = (a: unknown, b: unknown) => String(b ?? "").localeCompare(String(a ?? ""));
const asc = (a: unknown, b: unknown) => String(a ?? "").localeCompare(String(b ?? ""));

export type Label = { apt: string; bld: string };
function labelOf(listings: Record<string, Label>, lid: unknown): Label {
  if (lid === null || lid === undefined || lid === "") return { apt: "", bld: "" };
  return listings[String(lid)] ?? { apt: "", bld: "Listing " + lid };
}
function matchesQ(l: Label, q: string): boolean {
  if (!q) return true;
  const n = q.toLowerCase();
  return l.apt.toLowerCase().includes(n) || l.bld.toLowerCase().includes(n);
}

// Pas d'intervenant = ni technicien ni prestataire.
const unassigned = (t: any) => t.assigned_technician_id == null && t.assigned_vendor_id == null;

// Contexte commun aux lignes (liste et fiche) : libelles, noms, tickets ouverts, auteurs de cloture.
export type MntCtx = {
  listings: Record<string, Label>; names: Record<string, string>; vendorNames: Record<string, string>;
  openById: Record<string, any>; resolvedBy: Record<string, string>; today: string;
};
export function mntCtx(
  listingRows: any[], people: any[], vendorRows: any[],
  o: { today: string; openById?: Record<string, any>; resolvedBy?: Record<string, string> },
): MntCtx {
  return {
    listings: listingMap(listingRows),
    names: Object.fromEntries(people.map((p: any) => [String(p.id), String(p.name ?? "").trim() || "Member " + p.id])),
    vendorNames: Object.fromEntries(vendorRows.map((v: any) => [String(v.id), String(v.name ?? "").trim() || "Vendor " + v.id])),
    openById: o.openById ?? {}, resolvedBy: o.resolvedBy ?? {}, today: o.today,
  };
}

export function mntTicketRow(t: any, ctx: MntCtx, isDone: boolean): MntTicketRow {
  const l = labelOf(ctx.listings, t.listing_id);
  const tech = idOrNull(t.assigned_technician_id), vendor = idOrNull(t.assigned_vendor_id);
  const cost = t.actual_cost === null || t.actual_cost === undefined || t.actual_cost === "" ? null : Number(t.actual_cost);
  return {
    id: Number(t.id), ref: problemRef("MNT", Number(t.id)), listingId: str(t.listing_id), apt: l.apt, bld: l.bld,
    title: String(t.title ?? "Ticket"), category: str(t.category), priority: String(t.priority ?? "medium"),
    status: String(t.status ?? "open"), stage: isDone ? "done" : STAGE[String(t.status)] ?? "todo",
    origin: ORIGIN[String(t.source ?? "")] ?? "manual",
    assignee: tech != null ? { kind: "member", id: tech, name: ctx.names[String(tech)] ?? "Member " + tech }
      : vendor != null ? { kind: "vendor", id: vendor, name: ctx.vendorNames[String(vendor)] ?? "Vendor " + vendor } : null,
    dueOn: str(t.due_on), createdAt: String(t.created_at ?? ""), startedAt: str(t.started_at), resolvedAt: closedAt(t),
    resolvedBy: isDone ? ctx.resolvedBy["ticket_" + t.id] ?? null : null, resolutionNotes: str(t.resolution_notes),
    actualCost: cost === null || Number.isNaN(cost) ? null : cost, proposalId: idOrNull(t.proposal_id),
  };
}

export function mntProposalRow(p: any, ctx: MntCtx): MntProposalRow {
  const l = labelOf(ctx.listings, p.listing_id);
  const ot = p.open_ticket_id == null ? null : ctx.openById[String(p.open_ticket_id)];
  const cat = String(p.category ?? "other");
  const tid = idOrNull(p.ticket_id);
  return {
    id: Number(p.id), ref: proposalRef(Number(p.id)), listingId: str(p.listing_id), apt: l.apt, bld: l.bld,
    title: String(p.title ?? ""), category: cat, categoryLabel: MNT_CATEGORY_LABEL[cat as MntCategory] ?? "Other",
    urgency: String(p.urgency ?? "normal"), guestName: str(p.guest_name), stayFrom: str(p.stay_from), stayTo: str(p.stay_to),
    guestInNow: guestInNow({ stay_from: str(p.stay_from), stay_to: str(p.stay_to) }, ctx.today),
    quotes: Array.isArray(p.quotes) ? p.quotes : [], conversationId: String(p.conversation_id ?? ""), reservationId: str(p.reservation_id),
    // Seul un ticket encore ouvert est signale : un ticket clos ne bloque plus rien.
    openTicket: ot ? { id: Number(ot.id), ref: problemRef("MNT", Number(ot.id)), title: String(ot.title ?? "Ticket") } : null,
    status: String(p.status ?? "pending"), rejectReason: str(p.reject_reason), rejectNote: str(p.reject_note),
    // Ticket ne d'une proposition acceptee ou fusionnee dans un ticket.
    ticket: tid !== null && (p.status === "accepted" || p.status === "merged") ? { id: tid, ref: problemRef("MNT", tid) } : null,
    decidedBy: str(p.decided_by),
    decidedAt: str(p.decided_at), createdAt: String(p.created_at ?? ""), updatedAt: String(p.updated_at ?? ""),
  };
}

export async function mntList(
  sb: any, me: { cleaner_id: number; name: string }, q: MntQuery, o: { nowMs?: number } = {},
): Promise<{ status: number; body: MntList | { error: string } }> {
  const nowMs = o.nowMs ?? Date.now();
  const today = todayDubai(nowMs);
  const cutoff = new Date(nowMs - MNT_WINDOW_DAYS * 86400000).toISOString();
  try {
    const page = (table: string, cols: string, f: (x: any) => any) =>
      readAllRows((a: number, b: number) => f(sb.from(table).select(cols)).order("id").range(a, b), table);
    const [open, pending, decided, doneResolved, doneLegacy, listingRows, people, vendorRows] = await Promise.all([
      page("maintenance_tickets", MNT_TICKET_COLS, (x) => x.in("status", MGR_OPEN_TICKET_STATUSES)),
      page("maintenance_proposals", MNT_PROPOSAL_COLS, (x) => x.eq("status", "pending")),
      q.tab === "proposals" && q.rejected
        ? page("maintenance_proposals", MNT_PROPOSAL_COLS, (x) => x.in("status", ["rejected", "merged"]).gte("decided_at", cutoff))
        : Promise.resolve([]),
      // Date de cloture = resolved_at ?? closed_at (l'ancien chemin « closed » ne pose que closed_at) :
      // deux lectures disjointes couvrent exactement coalesce(resolved_at, closed_at) >= cutoff.
      q.tab === "done"
        ? page("maintenance_tickets", MNT_TICKET_COLS, (x) => x.in("status", DONE_STATUSES).gte("resolved_at", cutoff))
        : Promise.resolve([]),
      q.tab === "done"
        ? page("maintenance_tickets", MNT_TICKET_COLS, (x) => x.in("status", DONE_STATUSES).is("resolved_at", null).gte("closed_at", cutoff))
        : Promise.resolve([]),
      page("listing_config", "listing_id, internal_name, listing_name, apt_number", (x) => x),
      page("cleaners", "id, name, role, is_active", (x) => x),
      page("vendors", "id, name, is_active", (x) => x),
    ]);

    const done = [...doneResolved, ...doneLegacy];

    // Auteur de la cloture : dernier mnt_ticket.done journalise par v3Log sur ticket_<id>.
    const resolvedBy: Record<string, string> = {};
    const keys = done.map((t: any) => "ticket_" + t.id);
    for (let i = 0; i < keys.length; i += 100) {
      const part = keys.slice(i, i + 100);
      const logs = await readAllRows((a: number, b: number) => sb.from("cleaning_log").select("id, reservation_key, action, actor, created_at")
        .in("reservation_key", part).eq("action", "mnt_ticket.done").order("id").range(a, b), "cleaning_log");
      logs.sort((x: any, y: any) => asc(x.created_at, y.created_at) || Number(x.id) - Number(y.id));
      for (const l of logs) if (str(l.actor)) resolvedBy[String(l.reservation_key)] = String(l.actor);
    }

    const ctx = mntCtx(listingRows, people, vendorRows, { today, openById: Object.fromEntries(open.map((t: any) => [String(t.id), t])), resolvedBy });
    const ticketRow = (t: any, isDone: boolean) => mntTicketRow(t, ctx, isDone);
    const proposalRow = (p: any) => mntProposalRow(p, ctx);

    const counts = {
      proposals: pending.length, open: open.length,
      urgent: open.filter((t: any) => t.priority === "urgent").length,
      unassigned: open.filter(unassigned).length,
      mine: open.filter((t: any) => Number(t.assigned_technician_id) === me.cleaner_id).length,
    };

    let proposals: MntProposalRow[] = [];
    let tickets: MntTicketRow[] = [];
    if (q.tab === "proposals") {
      const src = q.rejected
        ? decided.slice().sort((a: any, b: any) => desc(a.decided_at, b.decided_at) || Number(b.id) - Number(a.id))
        : pending.slice().sort((a: any, b: any) =>
          urgRank(a.urgency) - urgRank(b.urgency) || desc(a.updated_at, b.updated_at) || Number(b.id) - Number(a.id));
      proposals = src.map(proposalRow).filter((p: MntProposalRow) => matchesQ(p, q.q));
    } else if (q.tab === "open") {
      const keep = (t: any) => q.filter === "mine" ? Number(t.assigned_technician_id) === me.cleaner_id
        : q.filter === "urgent" ? t.priority === "urgent"
        : q.filter === "unassigned" ? unassigned(t) : true;
      tickets = open.filter(keep)
        .sort((a: any, b: any) => prioRank(a.priority) - prioRank(b.priority) || asc(a.created_at, b.created_at) || Number(a.id) - Number(b.id))
        .map((t: any) => ticketRow(t, false)).filter((t: MntTicketRow) => matchesQ(t, q.q));
    } else {
      tickets = done.slice().sort((a: any, b: any) => desc(closedAt(a), closedAt(b)) || Number(b.id) - Number(a.id))
        .map((t: any) => ticketRow(t, true)).filter((t: MntTicketRow) => matchesQ(t, q.q));
    }

    const team = people
      .filter((p: any) => p.is_active !== false && (MNT_ROLES as readonly string[]).includes(String(p.role)))
      .map((p: any) => ({ id: Number(p.id), name: ctx.names[String(p.id)], role: String(p.role) }));
    const vendors = vendorRows.filter((v: any) => v.is_active !== false)
      .map((v: any) => ({ id: Number(v.id), name: ctx.vendorNames[String(v.id)] }));
    // Tous les logements, pour les listes de choix d'appartement de l'ecran.
    const listings = Object.entries(ctx.listings).map(([id, l]) => ({ id, apt: l.apt, bld: l.bld }))
      .sort((a, b) => a.bld.localeCompare(b.bld) || a.apt.localeCompare(b.apt, undefined, { numeric: true }) || a.id.localeCompare(b.id));

    return { status: 200, body: { tab: q.tab, counts, proposals, tickets, team, vendors, listings } };
  } catch (e) {
    console.error("[mnt_read] list failed:", (e as Error)?.message ?? String(e));
    return { status: 503, body: { error: MNT_UNAVAILABLE } };
  }
}
