// IO des relances automatiques par push (plan 2026-10-20-hk-reminders, T3).
// Les regles pures vivent dans reminders_rules.ts ; ici : lecture du snapshot
// (lecture seule sur les donnees existantes), envoi via sendPush et journal
// reminder_log. Seules ecritures : reminder_log, app_config cle « reminders » et
// une ligne de journal cleaning_log par changement de configuration.
import type { SessionUser } from "./auth.ts";
import { sessionActor } from "./actor.ts";
import { APP_URL, sendPush, type PushPayload } from "./push.ts";
import { INSP_VALID_STATUSES, type InspReservation } from "./insp_rules.ts";
import { MGR_OPEN_TICKET_STATUSES } from "./mgr_inbox.ts";
import { splitListing } from "./mgr_rules.ts";
import { readAllRows } from "./mgr_today.ts";
import { mgrPlanning, type CheckoutRow } from "./mgr_planning.ts";
import { readPendingProposals } from "./mnt_read.ts";
import { plusDays } from "./v3.ts";
import {
  applyLimits, dubaiDay, evaluate, mergeConfig, REM_DEFAULTS, REM_RULES, validateConfigPatch,
  type Due, type RemCleaning, type RemConfig, type RemHistoryRow, type RemProposal, type RemSnapshot, type RemTicket,
} from "./reminders_rules.ts";

export const REM_CONFIG_KEY = "reminders";
// Le compte de l'assistant IA a le role manager mais ne lit pas de notification.
export const REM_AI_ASSISTANT_EMAIL = "ai-assistant@medini-homes.com";
export const REM_HISTORY_DAYS = 3;
export const REM_ALERT_ICON = "/icons/alert-192.png";
const REM_URGENT_VIBRATE = [500, 200, 500, 200, 800];
// Instantane des reservations d'Inspections (insp:res:<jour>) : assez frais pour dire
// « guest sur place ». Au-dela, un rechargement (qui peut appeler Hostaway) : borne
// la charge Hostaway du moteur a une lecture par demi-heure au pire, pas toutes les 5 min.
export const REM_GUEST_CACHE_MAX_MS = 30 * 60_000;
const DEFAULT_CHECKOUT_HOUR = 11;
const LOG_STATUSES = ["sent", "no_subscription", "quiet", "capped", "duplicate", "error"];
const TICKET_COLS =
  "id, listing_id, title, priority, status, created_at, last_update, due_on, assigned_technician_id, assigned_vendor_id";
const DUBAI_MS = 4 * 3_600_000;

type Person = { id: number; name: string; role: string; active: boolean; email: string | null };

const str = (v: unknown): string | null => (v === null || v === undefined || v === "" ? null : String(v));
const idOrNull = (v: unknown): number | null => (v === null || v === undefined || v === "" ? null : Number(v));
const maxIso = (...xs: Array<string | null | undefined>): string | null => {
  let best: string | null = null, bestMs = -Infinity;
  for (const x of xs) {
    const t = x ? Date.parse(x) : NaN;
    if (!Number.isNaN(t) && t > bestMs) { bestMs = t; best = x!; }
  }
  return best;
};

// Jeton de lecture : 24 octets aleatoires en base64url (aucune information dedans).
export function randomToken(): string {
  const b = crypto.getRandomValues(new Uint8Array(24));
  return btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// --- Configuration --------------------------------------------------------------------

// Valeur stockee (texte JSON dans app_config.value, ou deja objet). Illisible = aucune surcharge.
export async function readStoredConfig(sb: any): Promise<Record<string, unknown>> {
  const { data, error } = await sb.from("app_config").select("value").eq("key", REM_CONFIG_KEY).maybeSingle();
  if (error) throw new Error("[rem] app_config: " + (error.message ?? "read failed"));
  let v: unknown = data?.value ?? null;
  if (typeof v === "string") {
    try { v = JSON.parse(v); } catch (_e) { console.warn("[rem] stored config is not JSON, ignored"); v = null; }
  }
  return v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {};
}

// Fusion profonde d'un patch valide dans les surcharges stockees : les objets
// (quiet, rules, texts) sont fusionnes cle a cle, le reste remplace.
export function mergeOverrides(stored: Record<string, unknown>, patch: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...stored };
  for (const [k, v] of Object.entries(patch)) {
    const prev = out[k];
    if (v && typeof v === "object" && !Array.isArray(v) && prev && typeof prev === "object" && !Array.isArray(prev)) {
      out[k] = { ...(prev as Record<string, unknown>), ...(v as Record<string, unknown>) };
    } else {
      out[k] = v;
    }
  }
  return out;
}

async function readPeople(sb: any): Promise<Person[]> {
  const rows = await readAllRows((a: number, b: number) =>
    sb.from("cleaners").select("id, name, role, is_active, email").order("id").range(a, b), "cleaners");
  return rows.map((p: any) => ({
    id: Number(p.id), name: String(p.name ?? "").trim() || "Member " + p.id, role: String(p.role ?? ""),
    active: p.is_active !== false, email: str(p.email),
  }));
}

// Managers candidats : actifs, role manager, sauf le compte de l'assistant IA.
export function managerCandidates(people: Person[]): Person[] {
  return people.filter((p) =>
    p.active && p.role === "manager" && String(p.email ?? "").trim().toLowerCase() !== REM_AI_ASSISTANT_EMAIL);
}

// --- Guest sur place ------------------------------------------------------------------

// Reservation valide avec arrivee <= aujourd'hui < depart, ou depart aujourd'hui avant
// l'heure de checkout (11:00 par defaut).
export function guestOnSiteSet(reservations: InspReservation[], today: string, nowMs: number): Set<string> {
  const hour = new Date(nowMs + DUBAI_MS).getUTCHours() + new Date(nowMs + DUBAI_MS).getUTCMinutes() / 60;
  const out = new Set<string>();
  for (const r of reservations ?? []) {
    if (!r || !r.listingId || !INSP_VALID_STATUSES.includes(String(r.status ?? ""))) continue;
    if (r.arrival > today) continue;
    if (r.departure > today || (r.departure === today && hour < (r.checkOutTime ?? DEFAULT_CHECKOUT_HOUR))) {
      out.add(String(r.listingId));
    }
  }
  return out;
}

// Lit l'instantane insp:res:<jour> tel quel s'il a moins de 30 min ; sinon passe par
// le chargeur du proxy (loadReservationsCached, qui peut appeler Hostaway).
export async function loadGuestReservations(
  sb: any, day: string, nowMs: number, reload: (day: string) => Promise<InspReservation[]>,
): Promise<InspReservation[]> {
  try {
    const { data: row } = await sb.from("proxy_cache").select("payload, updated_at").eq("key", "insp:res:" + day).maybeSingle();
    const age = row?.updated_at ? nowMs - Date.parse(row.updated_at) : Infinity;
    if (row?.payload && Array.isArray(row.payload.reservations) && age < REM_GUEST_CACHE_MAX_MS) return row.payload.reservations;
  } catch (e) {
    console.warn("[rem] proxy_cache read failed:", (e as Error)?.message ?? e);
  }
  return await reload(day);
}

// --- Snapshot -------------------------------------------------------------------------

export type RemDeps = {
  nowMs?: number;
  loadCheckouts: (start: string, end: string) => Promise<{ reservations: CheckoutRow[]; cachedAt: string | null }>;
  // Rechargement des reservations du jour (index.ts : loadInspReservations).
  loadReservations: (day: string) => Promise<InspReservation[]>;
  ackUrl: string;
  appSecret: string;
  // Couture de test : la prod envoie avec sendPush.
  send?: typeof sendPush;
  // Couture de test : identifiant du passage (bail anti-chevauchement), sinon UUID.
  runId?: string;
  // Mode essai : evalue et applique les limites, renvoie la liste, n'envoie rien et
  // n'ecrit rien dans reminder_log.
  dryRun?: boolean;
};

// Utilisateur systeme pour mgrPlanning : role manager, aucun geste n'est fait en son nom.
const SYSTEM_USER: SessionUser = { cleaner_id: 0, name: "Reminders", role: "manager", color: "" };

async function readTicketsAndHistory(sb: any, nowMs: number) {
  const since = new Date(nowMs - REM_HISTORY_DAYS * 86_400_000).toISOString();
  const [tickets, proposals, listingRows, history] = await Promise.all([
    readAllRows((a: number, b: number) => sb.from("maintenance_tickets").select(TICKET_COLS)
      .in("status", MGR_OPEN_TICKET_STATUSES).order("id").range(a, b), "maintenance_tickets"),
    readPendingProposals(sb),
    readAllRows((a: number, b: number) => sb.from("listing_config")
      .select("listing_id, internal_name, listing_name, apt_number").order("listing_id").range(a, b), "listing_config"),
    readAllRows((a: number, b: number) => sb.from("reminder_log")
      .select("id, rule, subject_kind, subject_id, cleaner_id, title, status, sent_at")
      .gte("sent_at", since).order("id").range(a, b), "reminder_log"),
  ]);
  return { tickets, proposals, listingRows, history };
}

// Heures d'assignation (cleaning_log mnt_ticket.assign, ticket_events to_status
// 'assigned') et dernier changement de statut (ticket_events), par ticket.
async function ticketTimes(sb: any, ids: number[]): Promise<{ assign: Record<string, string>; change: Record<string, string> }> {
  const assign: Record<string, string> = {}, change: Record<string, string> = {};
  const bump = (m: Record<string, string>, k: string, at: unknown) => {
    const v = str(at);
    if (v) m[k] = maxIso(m[k], v)!;
  };
  for (let i = 0; i < ids.length; i += 100) {
    const part = ids.slice(i, i + 100);
    const [logs, events] = await Promise.all([
      readAllRows((a: number, b: number) => sb.from("cleaning_log").select("id, reservation_key, action, created_at")
        .in("reservation_key", part.map((id) => "ticket_" + id)).eq("action", "mnt_ticket.assign").order("id").range(a, b), "cleaning_log"),
      readAllRows((a: number, b: number) => sb.from("ticket_events").select("id, ticket_id, event, to_status, at")
        .in("ticket_id", part).order("id").range(a, b), "ticket_events"),
    ]);
    for (const l of logs) bump(assign, String(l.reservation_key).replace(/^ticket_/, ""), l.created_at);
    for (const e of events) {
      const k = String(e.ticket_id);
      bump(change, k, e.at);
      if (e.to_status === "assigned") bump(assign, k, e.at);
    }
  }
  return { assign, change };
}

export async function loadSnapshot(sb: any, cfg: RemConfig, deps: RemDeps, nowMs: number): Promise<{ snap: RemSnapshot; warnings: string[] }> {
  const today = dubaiDay(nowMs);
  const tomorrow = plusDays(today, 1);
  const warnings: string[] = [];
  const [{ tickets, proposals, listingRows, history }, people] = await Promise.all([
    readTicketsAndHistory(sb, nowMs), readPeople(sb),
  ]);
  const labels: Record<string, string> = {};
  for (const l of listingRows) {
    const s = splitListing(l);
    labels[String(l.listing_id)] = (s.apt + " " + s.bld).trim();
  }
  const labelOf = (lid: unknown) =>
    lid === null || lid === undefined || lid === "" ? "No apartment" : labels[String(lid)] ?? "Listing " + lid;

  const times = await ticketTimes(sb, tickets.map((t: any) => Number(t.id)).filter(Number.isFinite));
  const remTickets: RemTicket[] = tickets.map((t: any) => {
    const k = String(t.id);
    return {
      id: Number(t.id), listing_id: str(t.listing_id), title: String(t.title ?? "Ticket"), priority: str(t.priority),
      status: String(t.status ?? "open"), created_at: String(t.created_at ?? ""), last_update: str(t.last_update),
      due_on: str(t.due_on), assigned_technician_id: idOrNull(t.assigned_technician_id),
      assigned_vendor_id: idOrNull(t.assigned_vendor_id),
      assignedAt: times.assign[k] ?? str(t.last_update) ?? str(t.created_at),
      lastChangeAt: maxIso(str(t.last_update), times.change[k]),
      label: labelOf(t.listing_id),
    };
  });
  const remProposals: RemProposal[] = proposals.map((p: any) => ({
    id: Number(p.id), listing_id: str(p.listing_id), title: String(p.title ?? "Proposal"), urgency: str(p.urgency),
    created_at: String(p.created_at ?? ""), label: labelOf(p.listing_id),
  }));

  const roleOf: Record<string, string> = Object.fromEntries(people.map((p) => [String(p.id), p.role]));
  // Menages d'aujourd'hui et demain : la semaine de mgrPlanning commencant aujourd'hui.
  // Les regles r7/r8 sont seules a en dependre : un planning indisponible ne coupe pas
  // les relances des tickets.
  let cleanings: RemCleaning[] = [];
  if (cfg.rules.r7 || cfg.rules.r8) {
    try {
      const r = await mgrPlanning(sb, { start: today, today, nowMs, me: SYSTEM_USER, loadCheckouts: deps.loadCheckouts });
      if (r.status === 200 && "jobs" in r.body) {
        cleanings = r.body.jobs.filter((j) => j.date === today || j.date === tomorrow).map((j) => ({
          key: j.key, date: j.date, listingId: j.listingId, label: (j.apt + " " + j.bld).trim(),
          assigned: j.assigned.map((id) => ({ id, role: roleOf[String(id)] ?? "cleaner" })),
          state: j.state, cancelled: !!j.cancelled, time: j.extra?.cleaningTime ?? j.checkout ?? null,
        }));
      } else {
        warnings.push("planning unavailable");
      }
    } catch (e) {
      console.warn("[rem] planning failed:", (e as Error)?.message ?? e);
      warnings.push("planning unavailable");
    }
  }

  // Guest sur place : sans reservations, les delais ne sont simplement pas raccourcis.
  let guestOnSite = new Set<string>();
  try {
    guestOnSite = guestOnSiteSet(await loadGuestReservations(sb, today, nowMs, deps.loadReservations), today, nowMs);
  } catch (e) {
    console.warn("[rem] reservations failed:", (e as Error)?.message ?? e);
    warnings.push("bookings unavailable");
  }

  // Toute tentative (envoyee, sans abonnement, en erreur) compte pour les limites :
  // sinon un manager sans telephone abonne recevrait une ligne toutes les 5 min.
  const hist: RemHistoryRow[] = history.map((h: any) => ({
    rule: String(h.rule), subject_kind: String(h.subject_kind), subject_id: String(h.subject_id),
    cleaner_id: idOrNull(h.cleaner_id), title: str(h.title), sent_at: String(h.sent_at),
    status: ["sent", "no_subscription", "error"].includes(String(h.status)) ? "sent" : String(h.status),
  }));

  return {
    snap: {
      today, tickets: remTickets, proposals: remProposals, cleanings, guestOnSite,
      managers: managerCandidates(people).map((p) => p.id),
      people: Object.fromEntries(people.map((p) => [String(p.id), { name: p.name, role: p.role }])),
      history: hist,
    },
    warnings,
  };
}

// --- Envoi ----------------------------------------------------------------------------

type LogStatus = "sent" | "no_subscription" | "error";
function statusFrom(r: { sent: number; skipped: string | null }): LogStatus {
  if (r.sent > 0) return "sent";
  return r.skipped === "no_subscription" ? "no_subscription" : "error";
}

type RemItem = {
  rule: string; subjectKind: string; subjectId: string; ref: string; title: string; body: string; url: string; urgent: boolean; tag: string;
};

// Recapitulatif d'un lot (plus de digestOver relances pour une personne dans un passage) :
// une notification, une ligne de journal par relance, meme jeton de lecture pour le lot.
export function digestOf(items: RemItem[]): RemItem {
  const urgent = items.some((i) => i.urgent);
  const head = items.length + " reminders";
  const shown = items.slice(0, 4).map((i) => i.ref);
  const more = items.length - shown.length;
  const urls = new Set(items.map((i) => i.url));
  const url = urls.size === 1 ? items[0].url
    : items.some((i) => i.url.startsWith("/manager/")) ? "/manager/#/maintenance" : "/v3/";
  return {
    rule: "digest", subjectKind: "digest", subjectId: "", ref: "", url, urgent,
    title: urgent ? ("URGENT · " + head).toUpperCase() : head,
    body: shown.join(", ") + (more > 0 ? " and " + more + " more" : "") + ". Open the app to act.",
    tag: urgent ? "rem-digest-urgent" : "rem-digest",
  };
}

// Journal d'abord (le jeton de lecture voyage dans la notification), envoi ensuite,
// statut corrige apres. Sans ligne de journal on n'envoie pas : le moteur ne verrait
// pas l'envoi et le referait toutes les 5 minutes. Plusieurs relances = un recapitulatif.
async function deliver(
  sb: any, deps: RemDeps, nowMs: number, items: RemItem[], cleanerId: number,
): Promise<{ status: LogStatus | "log_error"; sent: number; skipped: string | null }> {
  const token = randomToken();
  const sentAt = new Date(nowMs).toISOString();
  const { data: rows, error } = await sb.from("reminder_log").insert(items.map((item) => ({
    rule: item.rule, subject_kind: item.subjectKind, subject_id: item.subjectId, subject_ref: item.ref,
    cleaner_id: cleanerId, title: item.title, body: item.body, urgent: item.urgent, status: "sent",
    sent_at: sentAt, read_token: token,
  }))).select("id");
  if (error || !rows?.length) {
    console.error("[rem] reminder_log insert failed:", error?.message ?? error);
    return { status: "log_error", sent: 0, skipped: "log_error" };
  }
  const ids = rows.map((r: any) => Number(r.id));
  const one = items.length === 1 ? items[0] : digestOf(items);
  const payload: PushPayload = {
    title: one.title, body: one.body, url: APP_URL + one.url, tag: one.tag,
    urgent: one.urgent, icon: one.urgent ? REM_ALERT_ICON : undefined,
    requireInteraction: one.urgent ? true : undefined, vibrate: one.urgent ? REM_URGENT_VIBRATE : undefined,
    ack: { url: deps.ackUrl, id: ids[0], token, secret: deps.appSecret },
  };
  const r = await (deps.send ?? sendPush)(sb, cleanerId, payload, { priority: one.urgent ? "urgent" : "normal", quietHandled: true, nowMs });
  const status = statusFrom(r);
  if (status !== "sent") {
    const { error: upErr } = await sb.from("reminder_log").update({ status }).in("id", ids);
    if (upErr) console.error("[rem] reminder_log status update failed:", upErr.message ?? upErr);
  }
  return { status, sent: r.sent, skipped: r.skipped };
}

export type RemRunSummary = {
  ok: boolean; disabled: boolean; evaluated: number; sent: number;
  skipped: Record<string, number>; warnings: string[]; error?: string;
  // 'busy' : un autre passage tient le bail, rien n'a ete evalue ni envoye.
  skipped_run?: "busy";
  dryRun?: boolean;
  // Notifications recapitulatives envoyees dans ce passage.
  digests?: number;
  preview?: { rule: string; ref: string; urgent: boolean; recipients: number[]; title: string }[];
};

// Bail anti-chevauchement : deux passages simultanes (cron qui se recouvre, appel
// manuel) n'envoient jamais tous les deux. Une ligne proxy_cache 'rem:lease' ; un bail
// plus vieux que REM_LEASE_STALE_MS (passage mort en cours) est repris par un UPDATE
// filtre sur updated_at, atomique comme claimPushDedupe (push.ts).
export const REM_LEASE_KEY = "rem:lease";
export const REM_LEASE_STALE_MS = 4 * 60_000;

const isUniqueConflict = (e: any) => String(e?.code ?? "") === "23505" || Number(e?.status) === 409;

export async function remAcquireLease(sb: any, run: string, nowMs: number): Promise<boolean> {
  const nowIso = new Date(nowMs).toISOString();
  const { error } = await sb.from("proxy_cache").insert({ key: REM_LEASE_KEY, payload: { run }, updated_at: nowIso });
  if (!error) return true;
  if (!isUniqueConflict(error)) {
    // Table indisponible : on passe quand meme (le journal reminder_log borne deja les doublons).
    console.warn("[rem] lease insert failed, running anyway:", error.message ?? error);
    return true;
  }
  const cutoff = new Date(nowMs - REM_LEASE_STALE_MS).toISOString();
  const { data, error: upErr } = await sb.from("proxy_cache")
    .update({ payload: { run }, updated_at: nowIso })
    .eq("key", REM_LEASE_KEY)
    .lt("updated_at", cutoff)
    .select("key");
  if (upErr) {
    console.warn("[rem] lease takeover failed:", upErr.message ?? upErr);
    return false;
  }
  return (data ?? []).length > 0;
}

export async function remReleaseLease(sb: any, run: string): Promise<void> {
  try {
    const { error } = await sb.from("proxy_cache").delete().eq("key", REM_LEASE_KEY).eq("payload->>run", run);
    if (error) console.warn("[rem] lease release failed:", error.message ?? error);
  } catch (e) {
    console.warn("[rem] lease release failed:", (e as Error)?.message ?? e);
  }
}

// Un passage du moteur (cron toutes les 5 min). Les sauts (silence, plafond, doublon)
// ne sont PAS journalises dans reminder_log : ils se repeteraient a chaque passage ;
// ils sont comptes dans le resume. Le journal ne contient que les tentatives d'envoi.
export async function remRun(sb: any, deps: RemDeps): Promise<RemRunSummary> {
  const nowMs = deps.nowMs ?? Date.now();
  const run = deps.runId ?? crypto.randomUUID();
  if (!(await remAcquireLease(sb, run, nowMs))) {
    return { ok: true, disabled: false, evaluated: 0, sent: 0, skipped: {}, warnings: [], skipped_run: "busy" };
  }
  try {
    return await remRunLeased(sb, deps, nowMs);
  } finally {
    await remReleaseLease(sb, run);
  }
}

async function remRunLeased(sb: any, deps: RemDeps, nowMs: number): Promise<RemRunSummary> {
  const sum: RemRunSummary = { ok: true, disabled: false, evaluated: 0, sent: 0, skipped: {}, warnings: [] };
  const skip = (reason: string, n = 1) => { sum.skipped[reason] = (sum.skipped[reason] ?? 0) + n; };
  let cfg: RemConfig;
  let snap: RemSnapshot;
  try {
    cfg = mergeConfig(await readStoredConfig(sb));
    if (!cfg.enabled) return { ...sum, disabled: true };
    const s = await loadSnapshot(sb, cfg, deps, nowMs);
    snap = s.snap;
    sum.warnings = s.warnings;
  } catch (e) {
    console.error("[rem] snapshot failed:", (e as Error)?.message ?? e);
    return { ...sum, ok: false, error: "snapshot unavailable" };
  }
  const dues = evaluate(snap, cfg, nowMs);
  const lim = applyLimits(dues, snap.history, nowMs, cfg);
  sum.evaluated = dues.length;
  for (const s of lim.skipped) skip(s.reason);
  if (deps.dryRun) {
    sum.dryRun = true;
    sum.preview = lim.send.map((d) => ({ rule: d.rule, ref: d.ref, urgent: d.urgent, recipients: d.recipients, title: d.title }));
    return sum;
  }
  // Par destinataire : urgentes et ordinaires a part ; au-dela de digestOver, un lot.
  const batches = new Map<string, { cid: number; items: RemItem[] }>();
  for (const due of lim.send) {
    for (const cid of due.recipients) {
      const k = cid + ":" + (due.urgent ? "u" : "n");
      if (!batches.has(k)) batches.set(k, { cid, items: [] });
      batches.get(k)!.items.push(dueItem(due));
    }
  }
  const sends: Array<{ cid: number; items: RemItem[] }> = [];
  for (const b of batches.values()) {
    if (b.items.length > cfg.digestOver) sends.push(b);
    else for (const it of b.items) sends.push({ cid: b.cid, items: [it] });
  }
  for (const s of sends) {
    try {
      const r = await deliver(sb, deps, nowMs, s.items, s.cid);
      if (r.status === "sent") sum.sent += s.items.length;
      else skip(r.status, s.items.length);
      if (s.items.length > 1) sum.digests = (sum.digests ?? 0) + 1;
    } catch (e) {
      console.error("[rem] deliver failed:", s.cid, (e as Error)?.message ?? e);
      skip("error", s.items.length);
    }
  }
  return sum;
}

function dueItem(due: Due): RemItem {
  return {
    rule: due.rule, subjectKind: due.subjectKind, subjectId: due.subjectId, ref: due.ref, title: due.title,
    body: due.body, url: due.url, urgent: due.urgent, tag: "rem-" + due.rule + "-" + due.subjectId,
  };
}

// --- Actions --------------------------------------------------------------------------

type Resp = { status: number; body: unknown };

// rem.read : pose read_at au premier clic si le jeton correspond. Toujours 200 {ok}
// pour ne rien reveler (ni l'existence de la ligne, ni la validite du jeton).
export async function remRead(sb: any, body: unknown, nowMs = Date.now()): Promise<Resp> {
  const b = body && typeof body === "object" ? body as Record<string, unknown> : {};
  const id = Number(b.id);
  const token = typeof b.token === "string" ? b.token : "";
  if (!Number.isInteger(id) || id <= 0 || token.length < 16 || token.length > 64) return { status: 200, body: { ok: true } };
  try {
    const { data: row } = await sb.from("reminder_log").select("id, read_token, read_at").eq("id", id).maybeSingle();
    if (row && row.read_token && row.read_token === token && !row.read_at) {
      // Un recapitulatif partage son jeton entre ses lignes : toutes passent lues.
      const { error } = await sb.from("reminder_log").update({ read_at: new Date(nowMs).toISOString() })
        .eq("read_token", token).is("read_at", null);
      if (error) console.warn("[rem.read] update failed:", error.message ?? error);
    }
  } catch (e) {
    console.warn("[rem.read] failed:", (e as Error)?.message ?? e);
  }
  return { status: 200, body: { ok: true } };
}

export async function remConfigGet(sb: any): Promise<Resp> {
  const [stored, people] = await Promise.all([readStoredConfig(sb), readPeople(sb)]);
  return {
    status: 200,
    body: {
      config: mergeConfig(stored), defaults: REM_DEFAULTS,
      managers: managerCandidates(people).map((p) => ({ id: p.id, name: p.name })),
      people: people.filter((p) => p.active && p.role !== "system").map((p) => ({ id: p.id, name: p.name, role: p.role })),
    },
  };
}

// rem.config.set {patch} : patch valide fusionne dans les surcharges stockees (seules
// les surcharges sont gardees, les defauts restent dans le code). {patch:{reset:true}}
// efface les surcharges.
export async function remConfigSet(sb: any, body: unknown, me: SessionUser): Promise<Resp> {
  const b = body && typeof body === "object" ? body as Record<string, unknown> : {};
  const raw = b.patch;
  const reset = !!raw && typeof raw === "object" && (raw as Record<string, unknown>).reset === true
    && Object.keys(raw as object).length === 1;
  let next: Record<string, unknown> | null = null;
  let logged: unknown = raw;
  if (reset) {
    const { error } = await sb.from("app_config").delete().eq("key", REM_CONFIG_KEY);
    if (error) throw new Error("[rem] app_config delete: " + (error.message ?? "failed"));
    logged = { reset: true };
  } else {
    const v = validateConfigPatch(raw);
    if (!v.ok) return { status: 400, body: { error: v.error } };
    if (!Object.keys(v.patch).length) return { status: 400, body: { error: "Nothing to change." } };
    next = mergeOverrides(await readStoredConfig(sb), v.patch);
    const { error } = await sb.from("app_config")
      .upsert({ key: REM_CONFIG_KEY, value: JSON.stringify(next), updated_at: new Date().toISOString() }, { onConflict: "key" });
    if (error) throw new Error("[rem] app_config upsert: " + (error.message ?? "failed"));
    logged = v.patch;
  }
  // Journal rate = ecriture gardee (meme regle qu'addLog).
  const { error: logErr } = await sb.from("cleaning_log").insert({
    reservation_key: "reminders_config", action: "reminders_config", actor: sessionActor(me, null), details: logged,
  });
  if (logErr) console.error("[rem.config.set] log insert failed:", logErr.message);
  return { status: 200, body: { config: mergeConfig(next ?? {}) } };
}

export type RemLogQuery = { limit: number; status: string | null; rule: string | null };
export function parseRemLogQuery(p: URLSearchParams): RemLogQuery | { error: string } {
  const rawLimit = (p.get("limit") ?? "").trim();
  let limit = 200;
  if (rawLimit) {
    const n = Number(rawLimit);
    if (!Number.isInteger(n) || n < 1) return { error: "Invalid limit." };
    limit = Math.min(n, 500);
  }
  const status = (p.get("status") ?? "").trim() || null;
  if (status && !LOG_STATUSES.includes(status)) return { error: "Invalid status." };
  const rule = (p.get("rule") ?? "").trim() || null;
  if (rule && !([...REM_RULES, "test"] as string[]).includes(rule)) return { error: "Invalid rule." };
  return { limit, status, rule };
}

export async function remLog(sb: any, q: RemLogQuery): Promise<Resp> {
  let query = sb.from("reminder_log")
    .select("id, rule, subject_kind, subject_ref, subject_id, cleaner_id, title, body, urgent, status, sent_at, read_at");
  if (q.status) query = query.eq("status", q.status);
  if (q.rule) query = query.eq("rule", q.rule);
  const [{ data, error }, people] = await Promise.all([
    query.order("sent_at", { ascending: false }).order("id", { ascending: false }).limit(q.limit),
    readPeople(sb),
  ]);
  if (error) throw new Error("[rem] reminder_log: " + (error.message ?? "read failed"));
  const names: Record<string, string> = Object.fromEntries(people.map((p) => [String(p.id), p.name]));
  const rows = (data ?? []).slice()
    .sort((a: any, b: any) => String(b.sent_at).localeCompare(String(a.sent_at)) || Number(b.id) - Number(a.id))
    .slice(0, q.limit)
    .map((r: any) => ({
      id: Number(r.id), sentAt: String(r.sent_at), rule: String(r.rule), subjectKind: String(r.subject_kind),
      subjectRef: str(r.subject_ref) ?? String(r.subject_id ?? ""), recipientId: idOrNull(r.cleaner_id),
      recipientName: r.cleaner_id == null ? null : names[String(r.cleaner_id)] ?? "Member " + r.cleaner_id,
      title: String(r.title ?? ""), body: String(r.body ?? ""), urgent: r.urgent === true, status: String(r.status),
      readAt: str(r.read_at),
    }));
  return { status: 200, body: { rows } };
}

// rem.test : une notification URGENTE a soi-meme, hors silence et hors interrupteur
// global, journalisee comme les autres (regle 'test').
export async function remTest(sb: any, me: SessionUser, deps: Pick<RemDeps, "ackUrl" | "appSecret" | "send" | "nowMs">): Promise<Resp> {
  const nowMs = deps.nowMs ?? Date.now();
  const r = await deliver(sb, { ...deps, loadCheckouts: async () => ({ reservations: [], cachedAt: null }), loadReservations: async () => [] }, nowMs, [{
    rule: "test", subjectKind: "ticket", subjectId: "test", ref: "TEST",
    title: "URGENT · TEST NOTIFICATION",
    body: "Test from HK Planner reminders. If you see this, urgent alerts work on this phone.",
    url: "/manager/#/more/reminders", urgent: true, tag: "rem-test-" + me.cleaner_id,
  }], me.cleaner_id);
  if (r.status === "log_error") return { status: 503, body: { error: "Reminders are unavailable right now. Try again." } };
  return { status: 200, body: { sent: r.sent, skipped: r.skipped } };
}
