// Gestes de la section Maintenance (action mnt.act, phase 1 serveur) : valider,
// rejeter ou fusionner une proposition, creer un ticket, le faire avancer
// (start, waiting_parts, done, reopen), l'assigner, lui donner une echeance,
// le commenter. Meme ordre que mgr_problem_act.ts : validation, cle, rejeu,
// etat, ecriture ; une ecriture ratee libere la cle (et defait ce qui a deja
// ete ecrit), les effets secondaires (journal, notification) ne font jamais
// echouer un geste ecrit. Auteur toujours pris dans la session, jamais dans le corps.
import type { SessionUser } from "./auth.ts";
import {
  claimEvent, plusDays, recordResult, releaseEvent, replayResponse, todayDubai, v3Log, validIdem,
  type ActionResult,
} from "./v3.ts";
import { sansEchec } from "./v3_photos.ts";
import { MGR_CLOSED_TICKET_STATUSES, MGR_TICKET_ASSIGNEE_ROLES, problemRef } from "./mgr_inbox.ts";
import {
  MNT_CATEGORIES, MNT_REJECT_REASONS, MNT_TEXT_MAX, MNT_TITLE_MAX, MNT_URGENCIES, type MntCategory, type MntUrgency,
  priorityFor, proposalRef,
} from "./mnt_rules.ts";

export const MNT_ACT_EVENT = "mnt_act" as const;
export const MNT_DUE_MAX_DAYS = 60;
const PHOTO_PATH_MAX = 300;

export type MntActDeps = {
  nowMs?: number;
  notifyAssignee?: (t: { ticketId: number; memberId: number; title: string; urgent: boolean }) => void | Promise<void>;
};

type Who = { memberId: number | null; vendorId: number | null };
type NewTicket = { title: string; listingId: string | null; category: MntCategory; urgency: MntUrgency; note: string } & Who;
type Op =
  | ({ op: "proposal.accept"; proposalId: number } & NewTicket)
  | { op: "proposal.reject"; proposalId: number; reason: string; note: string }
  | { op: "proposal.merge"; proposalId: number; ticketId: number }
  | ({ op: "ticket.create" } & NewTicket)
  | { op: "ticket.start" | "ticket.reopen"; ticketId: number }
  | { op: "ticket.waiting_parts"; ticketId: number; note: string }
  | { op: "ticket.done"; ticketId: number; note: string; photoPath: string | null; cost: number | null }
  | ({ op: "ticket.assign"; ticketId: number; unassign: boolean } & Who)
  | { op: "ticket.due"; ticketId: number; date: string | null }
  | { op: "ticket.comment"; ticketId: number; text: string };

type Notice = { ticketId: number; memberId: number; title: string; urgent: boolean };
type Done = { result: Record<string, unknown>; after: Array<[string, () => Promise<unknown>]>; notify?: Notice };
type Ctx = { sb: any; me: SessionUser; nowIso: string; today: string; idem: string };

const CLOSED = "This ticket is closed. Reopen it first.";
const HANDLED = "This proposal was already handled.";
const NOT_FOUND = "Not found.";
const TODO = ["open", "assigned"];

const bad = (status: number, error: string): ActionResult => ({ status, body: { error } });
const has = (v: unknown) => v !== undefined && v !== null && v !== "";
const cleanText = (v: unknown) => (typeof v === "string" ? v.trim().slice(0, MNT_TEXT_MAX) : "");
function posInt(v: unknown): number | null {
  if (typeof v === "boolean") return null;
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
}
function validDay(d: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return false;
  const t = new Date(d + "T00:00:00Z");
  return Number.isFinite(t.getTime()) && t.toISOString().slice(0, 10) === d;
}

function parseWho(body: any): Who | { error: string } {
  if (has(body?.memberId) && has(body?.vendorId)) return { error: "Choose a person or a vendor, not both." };
  if (has(body?.memberId)) {
    const m = posInt(body.memberId);
    return m ? { memberId: m, vendorId: null } : { error: "Invalid person." };
  }
  if (has(body?.vendorId)) {
    const v = posInt(body.vendorId);
    return v ? { memberId: null, vendorId: v } : { error: "Invalid vendor." };
  }
  return { memberId: null, vendorId: null };
}

function parseNewTicket(body: any): NewTicket | { error: string } {
  const title = (typeof body?.title === "string" ? body.title.trim() : "").slice(0, MNT_TITLE_MAX).trim();
  if (!title) return { error: "Write a title first." };
  if (!(MNT_CATEGORIES as readonly string[]).includes(body?.category)) return { error: "Choose a category." };
  if (!(MNT_URGENCIES as readonly string[]).includes(body?.urgency)) return { error: "Choose an urgency." };
  const w = parseWho(body);
  if ("error" in w) return w;
  const lid = typeof body?.listingId === "string" || typeof body?.listingId === "number" ? String(body.listingId).trim() : "";
  return { title, listingId: lid || null, category: body.category, urgency: body.urgency, note: cleanText(body?.note), ...w };
}

// Cout : absent ou vide = pas de cout ; un nombre fini >= 0 est un vrai cout (0 compris).
// En texte, seulement un decimal simple (2 decimales au plus) : ni signe, ni hexa, ni exposant.
const COST_RE = /^\d+(\.\d{1,2})?$/;
const NOT_A_COST = { error: "Cost must be a number." };
function parseCost(v: unknown): { cost: number | null } | { error: string } {
  if (v === undefined || v === null) return { cost: null };
  if (typeof v === "number") return Number.isFinite(v) && v >= 0 ? { cost: v } : NOT_A_COST;
  if (typeof v !== "string") return NOT_A_COST;
  const t = v.trim();
  if (!t) return { cost: null };
  return COST_RE.test(t) ? { cost: Number(t) } : NOT_A_COST;
}

export function parseMntAct(body: any, today: string): Op | { error: string; status?: number } {
  const op = String(body?.op ?? "");
  if (op === "proposal.accept" || op === "proposal.reject" || op === "proposal.merge") {
    const proposalId = posInt(body?.proposalId);
    if (op === "proposal.accept") {
      const t = parseNewTicket(body);
      if ("error" in t) return t;
      return proposalId ? { op, proposalId, ...t } : { error: NOT_FOUND, status: 404 };
    }
    if (op === "proposal.reject") {
      const reason = String(body?.reason ?? "");
      if (!(MNT_REJECT_REASONS as readonly string[]).includes(reason)) return { error: "Choose a reason." };
      const note = cleanText(body?.note);
      if (reason === "other" && !note) return { error: "Write why." };
      return proposalId ? { op, proposalId, reason, note } : { error: NOT_FOUND, status: 404 };
    }
    const ticketId = posInt(body?.ticketId);
    return proposalId && ticketId ? { op, proposalId, ticketId } : { error: NOT_FOUND, status: 404 };
  }
  if (op === "ticket.create") {
    const t = parseNewTicket(body);
    if ("error" in t) return t;
    if (!t.listingId) return { error: "Choose an apartment." };
    return { op, ...t };
  }
  const ops = ["ticket.start", "ticket.reopen", "ticket.waiting_parts", "ticket.done", "ticket.assign", "ticket.due", "ticket.comment"];
  if (!ops.includes(op)) return { error: "Unknown action." };
  const ticketId = posInt(body?.ticketId);
  let parsed: Op | { error: string };
  if (op === "ticket.start" || op === "ticket.reopen") parsed = { op, ticketId: 0 };
  else if (op === "ticket.waiting_parts") parsed = { op, ticketId: 0, note: cleanText(body?.note) };
  else if (op === "ticket.done") {
    const c = parseCost(body?.cost);
    if ("error" in c) return c;
    const p = body?.photoPath;
    const photoPath = typeof p === "string" && p.trim() && p.length < PHOTO_PATH_MAX ? p.trim() : null;
    parsed = { op, ticketId: 0, note: cleanText(body?.note), photoPath, cost: c.cost };
  } else if (op === "ticket.assign") {
    if (body?.unassign === true) parsed = { op, ticketId: 0, unassign: true, memberId: null, vendorId: null };
    else {
      const w = parseWho(body);
      if ("error" in w) return w;
      if (w.memberId === null && w.vendorId === null) return { error: "Choose a person or a vendor." };
      parsed = { op, ticketId: 0, unassign: false, ...w };
    }
  } else if (op === "ticket.due") {
    if (!has(body?.date)) parsed = { op, ticketId: 0, date: null };
    else {
      const d = String(body.date);
      if (!validDay(d)) return { error: "Invalid date." };
      if (d < today) return { error: "The date cannot be in the past." };
      if (d > plusDays(today, MNT_DUE_MAX_DAYS)) return { error: "The date is too far ahead." };
      parsed = { op, ticketId: 0, date: d };
    }
  } else {
    const text = cleanText(body?.text);
    if (!text) return { error: "Write a comment first." };
    parsed = { op: "ticket.comment", ticketId: 0, text };
  }
  if (!ticketId) return { error: NOT_FOUND, status: 404 };
  return { ...parsed, ticketId } as Op;
}

// Intervenant : membre actif d'un role autorise, ou prestataire actif.
async function checkWho(sb: any, w: Who): Promise<{ name: string | null } | { error: string }> {
  if (w.memberId !== null) {
    const { data: c, error } = await sb.from("cleaners").select("id, name, role, is_active").eq("id", w.memberId).maybeSingle();
    if (error) throw error;
    if (!c || c.is_active === false || !MGR_TICKET_ASSIGNEE_ROLES.includes(String(c.role ?? ""))) return { error: "Invalid person." };
    return { name: String(c.name ?? "").trim() || "Member " + w.memberId };
  }
  if (w.vendorId !== null) {
    const { data: v, error } = await sb.from("vendors").select("id, name, is_active").eq("id", w.vendorId).maybeSingle();
    if (error) throw error;
    if (!v || v.is_active === false) return { error: "Invalid vendor." };
    return { name: String(v.name ?? "").trim() || "Vendor " + w.vendorId };
  }
  return { name: null };
}

async function readRow(sb: any, table: string, id: number): Promise<any | null> {
  const { data, error } = await sb.from(table).select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  return data ?? null;
}

const isClosed = (t: any) => MGR_CLOSED_TICKET_STATUSES.includes(String(t?.status ?? ""));

// Etat au moment du geste, lu apres la cle : un rejeu rend son resultat memorise
// meme si la ligne a change entre-temps.
function refusal(a: Op, prop: any, tk: any): string | null {
  if (a.op === "proposal.accept" || a.op === "proposal.reject" || a.op === "proposal.merge") {
    if (String(prop?.status ?? "") !== "pending") return HANDLED;
    if (a.op === "proposal.merge" && isClosed(tk)) return CLOSED;
    return null;
  }
  if (a.op === "ticket.create" || a.op === "ticket.comment") return null;
  const st = String(tk?.status ?? "open");
  if (a.op === "ticket.reopen") return isClosed(tk) ? null : "This ticket is not closed.";
  if (isClosed(tk)) return CLOSED;
  if (a.op === "ticket.start") {
    if (st === "in_progress") return "This ticket is already in progress.";
    if (!TODO.includes(st) && st !== "waiting_parts") return "This ticket cannot be started now.";
  }
  return null;
}

async function mustWrite(q: any): Promise<any[]> {
  const { data, error } = await q;
  if (error) throw error;
  return Array.isArray(data) ? data : data ? [data] : [];
}

const quoteTexts = (prop: any): string[] =>
  (Array.isArray(prop?.quotes) ? prop.quotes : []).map((q: any) => String(q?.text ?? "").trim()).filter(Boolean);

async function insertTicket(c: Ctx, t: NewTicket, source: "guest_message" | "manual", proposalId: number | null): Promise<number> {
  const taken = t.memberId !== null || t.vendorId !== null;
  const rows = await mustWrite(c.sb.from("maintenance_tickets").insert({
    listing_id: t.listingId, title: t.title, description: t.note || null, category: t.category, priority: priorityFor(t.urgency),
    status: taken ? "assigned" : "open", source, source_ref: proposalId ? "proposal:" + proposalId : null,
    proposal_id: proposalId, reported_by: c.me.name, assigned_technician_id: t.memberId, assigned_vendor_id: t.vendorId,
    last_update: c.nowIso,
  }).select("id"));
  if (!rows.length) throw new Error("[mnt_act] ticket insert: no row");
  return Number(rows[0].id);
}

const notice = (ticketId: number, memberId: number | null, title: string, urgent: boolean): Notice | undefined =>
  memberId !== null ? { ticketId, memberId, title, urgent } : undefined;

// Proposition prise sous condition (encore pending) : une autre decision entre la
// lecture et l'ecriture donne 0 ligne, donc 409 sans rien ecrire d'autre.
class Handled extends Error {}
// Etat change entre la lecture et l'ecriture conditionnelle : 409 avec ce message.
class Refused extends Error {}
async function takeProposal(c: Ctx, id: number, values: Record<string, unknown>): Promise<void> {
  const hit = await mustWrite(c.sb.from("maintenance_proposals")
    .update({ ...values, decided_by: c.me.name, decided_at: c.nowIso, updated_at: c.nowIso })
    .eq("id", id).eq("status", "pending").select("id"));
  if (!hit.length) throw new Handled();
}
async function giveBackProposal(c: Ctx, id: number): Promise<void> {
  await sansEchec("proposition " + id + " non remise en attente", () => mustWrite(c.sb.from("maintenance_proposals")
    .update({ status: "pending", ticket_id: null, decided_by: null, decided_at: null }).eq("id", id)));
}

async function doAccept(c: Ctx, a: Extract<Op, { op: "proposal.accept" }>, prop: any): Promise<Done> {
  await takeProposal(c, a.proposalId, { status: "accepted" });
  let ticketId: number | null = null;
  try {
    const t = { ...a, listingId: a.listingId ?? (prop.listing_id == null ? null : String(prop.listing_id)) };
    ticketId = await insertTicket(c, t, "guest_message", a.proposalId);
    const quotes = quoteTexts(prop);
    if (quotes.length) {
      await mustWrite(c.sb.from("ticket_comments").insert(quotes.map((q) => ({ ticket_id: ticketId, author: "Guest", comment: q }))));
    }
    await mustWrite(c.sb.from("maintenance_proposals").update({ ticket_id: ticketId }).eq("id", a.proposalId));
  } catch (e) {
    const id = ticketId;
    if (id !== null) {
      await sansEchec("commentaires du ticket " + id + " non retires", () => mustWrite(c.sb.from("ticket_comments").delete().eq("ticket_id", id)));
      await sansEchec("ticket " + id + " non retire", () => mustWrite(c.sb.from("maintenance_tickets").delete().eq("id", id)));
    }
    await giveBackProposal(c, a.proposalId);
    throw e;
  }
  const tid = ticketId;
  return {
    result: { ok: true, ticketId: tid, ref: problemRef("MNT", tid) },
    after: [["journal de MNT-" + tid, () => v3Log(c.sb, "ticket_" + tid, "mnt_proposal.accept", c.me.name, { proposalId: a.proposalId })]],
    notify: notice(tid, a.memberId, a.title, a.urgency === "urgent"),
  };
}

async function doReject(c: Ctx, a: Extract<Op, { op: "proposal.reject" }>): Promise<Done> {
  await takeProposal(c, a.proposalId, { status: "rejected", reject_reason: a.reason, reject_note: a.note || null });
  return {
    result: { ok: true, proposalId: a.proposalId },
    after: [["journal de " + proposalRef(a.proposalId), () =>
      v3Log(c.sb, "proposal_" + a.proposalId, "mnt_proposal.reject", c.me.name, { reason: a.reason, note: a.note || null })]],
  };
}

async function doMerge(c: Ctx, a: Extract<Op, { op: "proposal.merge" }>, prop: any): Promise<Done> {
  await takeProposal(c, a.proposalId, { status: "merged", ticket_id: a.ticketId });
  try {
    const quotes = quoteTexts(prop);
    if (quotes.length) {
      await mustWrite(c.sb.from("ticket_comments").insert(quotes.map((q) => ({ ticket_id: a.ticketId, author: "Guest", comment: q }))));
    }
  } catch (e) {
    await giveBackProposal(c, a.proposalId);
    throw e;
  }
  return {
    result: { ok: true, ticketId: a.ticketId, ref: problemRef("MNT", a.ticketId) },
    after: [
      ["derniere mise a jour de MNT-" + a.ticketId, () =>
        mustWrite(c.sb.from("maintenance_tickets").update({ last_update: c.nowIso }).eq("id", a.ticketId))],
      ["journal de MNT-" + a.ticketId, () =>
        v3Log(c.sb, "ticket_" + a.ticketId, "mnt_proposal.merge", c.me.name, { proposalId: a.proposalId })],
    ],
  };
}

async function doCreate(c: Ctx, a: Extract<Op, { op: "ticket.create" }>): Promise<Done> {
  const id = await insertTicket(c, a, "manual", null);
  return {
    result: { ok: true, ticketId: id, ref: problemRef("MNT", id) },
    after: [["journal de MNT-" + id, () => v3Log(c.sb, "ticket_" + id, "mnt_ticket.create", c.me.name, {})]],
    notify: notice(id, a.memberId, a.title, a.urgency === "urgent"),
  };
}

const updateTicket = (c: Ctx, id: number, values: Record<string, unknown>) =>
  mustWrite(c.sb.from("maintenance_tickets").update({ ...values, last_update: c.nowIso }).eq("id", id));

async function doTicket(c: Ctx, a: Exclude<Op, { op: `proposal.${string}` } | { op: "ticket.create" }>, tk: any, whoName: string | null):
  Promise<Done> {
  const id = a.ticketId;
  const after: Done["after"] = [];
  let result: Record<string, unknown> = { ok: true, ticketId: id };
  let details: Record<string, unknown> = {};
  let notify: Notice | undefined;
  if (a.op === "ticket.start") {
    await updateTicket(c, id, { status: "in_progress", started_at: c.nowIso });
    result.status = "in_progress";
    details = { from: tk.status ?? null };
  } else if (a.op === "ticket.waiting_parts") {
    await updateTicket(c, id, { status: "waiting_parts" });
    result.status = "waiting_parts";
    details = { from: tk.status ?? null, note: a.note || null };
    if (a.note) {
      after.push(["note de MNT-" + id, () =>
        mustWrite(c.sb.from("ticket_comments").insert({ ticket_id: id, author: c.me.name, comment: a.note }))]);
    }
  } else if (a.op === "ticket.done") {
    // Cloture gardee : seul un ticket pas clos (meme notion que isClosed, statut nul
    // compris) passe a resolved. Deux telephones en meme temps donnent une seule
    // cloture ; l'autre recoit 409 (cle liberee). actual_cost n'est pas touche ici :
    // sans cout, le cout precedent reste (lignes et actual_cost).
    const hit = await mustWrite(c.sb.from("maintenance_tickets").update({
      status: "resolved", resolved_at: c.nowIso, resolution_notes: a.note || null,
      resolution_photo_path: a.photoPath, last_update: c.nowIso,
    }).eq("id", id).or("status.is.null,status.not.in.(" + MGR_CLOSED_TICKET_STATUSES.join(",") + ")").select("id"));
    if (!hit.length) throw new Refused(CLOSED);
    // Avec un cout, il remplace celui du ticket (Reopen puis Done corrige un cout sans le compter deux fois) :
    // nouvelle ligne, puis retrait des anciennes, puis actual_cost. Si une etape rate, les anciennes lignes
    // sont remises et le ticket reprend son etat d'avant.
    if (a.cost !== null) {
      let oldRows: any[] = [];
      let newId: number | null = null;
      let oldGone = false;
      try {
        oldRows = await mustWrite(c.sb.from("maintenance_costs").select("*").eq("ticket_id", id));
        const ins = await mustWrite(c.sb.from("maintenance_costs").insert({
          ticket_id: id, listing_id: tk.listing_id ?? null, category: tk.category ?? null, description: tk.title ?? null,
          amount: a.cost, vendor_id: tk.assigned_vendor_id ?? null, date: c.today,
        }).select("id"));
        newId = ins.length ? Number(ins[0].id) : null;
        if (oldRows.length) {
          oldGone = true;
          await mustWrite(c.sb.from("maintenance_costs").delete().in("id", oldRows.map((r) => r.id)));
        }
        await mustWrite(c.sb.from("maintenance_tickets").update({ actual_cost: a.cost }).eq("id", id));
      } catch (e) {
        const nid = newId;
        if (nid !== null) {
          await sansEchec("cout " + nid + " de MNT-" + id + " non retire", () => mustWrite(c.sb.from("maintenance_costs").delete().eq("id", nid)));
        }
        if (oldGone) {
          // L'effacement a pu ne rien retirer : on ne remet que les lignes absentes.
          await sansEchec("anciens couts de MNT-" + id + " non remis", async () => {
            const still = new Set((await mustWrite(c.sb.from("maintenance_costs").select("id").eq("ticket_id", id))).map((r) => String(r.id)));
            const back = oldRows.filter((r) => !still.has(String(r.id)));
            if (back.length) await mustWrite(c.sb.from("maintenance_costs").insert(back));
          });
        }
        await sansEchec("ticket MNT-" + id + " non remis dans son etat", () => mustWrite(c.sb.from("maintenance_tickets").update({
          status: tk.status ?? "open", resolved_at: tk.resolved_at ?? null, resolution_notes: tk.resolution_notes ?? null,
          resolution_photo_path: tk.resolution_photo_path ?? null, actual_cost: tk.actual_cost ?? null,
          last_update: tk.last_update ?? c.nowIso,
        }).eq("id", id)));
        throw e;
      }
    }
    result.status = "resolved";
    details = { from: tk.status ?? null, cost: a.cost };
  } else if (a.op === "ticket.reopen") {
    const status = tk.assigned_technician_id != null || tk.assigned_vendor_id != null ? "assigned" : "open";
    await updateTicket(c, id, { status, resolved_at: null, closed_at: null });
    result.status = status;
    details = { from: tk.status ?? null };
  } else if (a.op === "ticket.assign") {
    const st = String(tk.status ?? "open");
    const taken = a.memberId !== null || a.vendorId !== null;
    // open et assigned suivent l'affectation ; in_progress, waiting_parts et to_confirm restent.
    const status = TODO.includes(st) ? (taken ? "assigned" : "open") : st;
    await updateTicket(c, id, { assigned_technician_id: a.memberId, assigned_vendor_id: a.vendorId, status });
    result.assignee = a.memberId !== null ? { kind: "member", id: a.memberId, name: whoName ?? "" }
      : a.vendorId !== null ? { kind: "vendor", id: a.vendorId, name: whoName ?? "" } : null;
    details = { to: whoName, kind: a.memberId !== null ? "member" : a.vendorId !== null ? "vendor" : null };
    if (a.memberId !== null && Number(tk.assigned_technician_id) !== a.memberId) {
      notify = notice(id, a.memberId, String(tk.title ?? "Ticket"), tk.priority === "urgent");
    }
  } else if (a.op === "ticket.due") {
    await updateTicket(c, id, { due_on: a.date });
    result.dueOn = a.date;
    details = { date: a.date };
  } else if (a.op === "ticket.comment") {
    const rows = await mustWrite(c.sb.from("ticket_comments").insert({ ticket_id: id, author: c.me.name, comment: a.text })
      .select("id, created_at"));
    const at = rows[0]?.created_at ? String(rows[0].created_at) : c.nowIso;
    result.comment = { author: c.me.name, text: a.text, at };
    after.push(["derniere mise a jour de MNT-" + id, () => updateTicket(c, id, {})]);
  }
  after.unshift(["journal de MNT-" + id, () => v3Log(c.sb, "ticket_" + id, "mnt_" + a.op, c.me.name, details)]);
  return { result, after, notify };
}

export async function mntAct(sb: any, me: SessionUser, body: any, deps: MntActDeps = {}): Promise<ActionResult> {
  const nowMs = deps.nowMs ?? Date.now();
  const today = todayDubai(nowMs);
  const a = parseMntAct(body, today);
  if ("error" in a) return bad(a.status ?? 400, a.error);
  if (!validIdem(body?.idem)) return bad(400, "idem required");
  const idem = String(body.idem);

  let prop: any = null;
  let tk: any = null;
  if ("proposalId" in a) {
    prop = await readRow(sb, "maintenance_proposals", a.proposalId);
    if (!prop) return bad(404, NOT_FOUND);
    // Comme ticket.create : jamais de ticket sans appartement.
    if (a.op === "proposal.accept" && !a.listingId && !has(String(prop.listing_id ?? "").trim())) return bad(400, "Choose an apartment.");
  }
  if ("ticketId" in a) {
    tk = await readRow(sb, "maintenance_tickets", a.ticketId);
    if (!tk) return bad(404, NOT_FOUND);
  }
  let whoName: string | null = null;
  if ("memberId" in a) {
    const w = await checkWho(sb, a);
    if ("error" in w) return bad(400, w.error);
    whoName = w.name;
  }

  const jobId = "proposalId" in a ? proposalRef(a.proposalId) : "ticketId" in a ? problemRef("MNT", a.ticketId) : null;
  const claim = await claimEvent(sb, idem, MNT_ACT_EVENT, jobId, me.cleaner_id, { ...a });
  const replay = replayResponse(claim);
  if (replay) return replay;

  const refused = refusal(a, prop, tk);
  if (refused) {
    await releaseEvent(sb, idem);
    return bad(409, refused);
  }

  const c: Ctx = { sb, me, nowIso: new Date(nowMs).toISOString(), today, idem };
  let done: Done;
  try {
    if (a.op === "proposal.accept") done = await doAccept(c, a, { ...prop });
    else if (a.op === "proposal.reject") done = await doReject(c, a);
    else if (a.op === "proposal.merge") done = await doMerge(c, a, { ...prop });
    else if (a.op === "ticket.create") done = await doCreate(c, a);
    else done = await doTicket(c, a, { ...tk }, whoName);
  } catch (e) {
    await releaseEvent(sb, idem);
    if (e instanceof Handled) return bad(409, HANDLED);
    if (e instanceof Refused) return bad(409, e.message);
    throw e;
  }
  await sansEchec("resultat non memorise pour " + idem, () => recordResult(sb, idem, done.result));
  for (const [what, fn] of done.after) await sansEchec(what, fn);
  const n = done.notify;
  const notify = deps.notifyAssignee;
  if (n && notify) {
    // Jamais attendue par le geste, jamais une cause d'echec.
    Promise.resolve().then(() => notify(n)).catch((e) =>
      console.warn("[mnt_act] notification MNT-" + n.ticketId + ": " + String((e as any)?.message ?? e)));
  }
  return { status: 200, body: done.result };
}
