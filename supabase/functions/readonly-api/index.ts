// API de HK Planner pour un assistant IA externe (cle secrete en X-API-Key ou
// Authorization: Bearer). Le nom de la fonction date de la v1 en lecture seule.
// Lectures (GET) : directement en base, mais seulement a travers ro(), qui
// n'expose que select(). Ecritures (POST) : jamais en base depuis ici. Elles
// passent par les actions du proxy, comme l'app manager, sous le compte
// « AI Assistant » (manager, id en base, session email reelle) : memes regles,
// conges bloquants, notifications, journal et auteur. Les departs (menages)
// viennent de l'action checkouts du proxy, la meme source que le Planning.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import {
  scrub, cleaningOut, cleaningRange, type CheckoutIn, type CleaningCtx, dateParam, hourOrNull, intParam, isBad, keyOk,
  listingOut, listParam, placeMap, plusDays, RO_CATEGORIES, RO_CLEANING_STATUSES, RO_LIMIT_DEFAULT, RO_LIMIT_MAX,
  proposalOut, reservationKey, RO_OPEN, RO_TECH_ROLES, TICKET_COLS, ticketOut, ticketStatuses,
} from "./ro_rules.ts";

const KEY_SHA = Deno.env.get("READONLY_API_KEY_SHA256") ?? "";
const SB_URL = Deno.env.get("SUPABASE_URL") ?? "";
const APP_SECRET = Deno.env.get("APP_SHARED_SECRET") ?? "";
const VALID_RES = ["new", "modified", "confirmed", "ownerStay", "reserved"];
const PAGE = 1000;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
export const ASSISTANT_EMAIL = "ai-assistant@medini-homes.com";

const db = createClient(SB_URL, SERVICE_KEY, { auth: { persistSession: false } });
// Seule porte vers la base : select() et rien d'autre.
const ro = (table: string, cols: string) => db.from(table).select(cols);

// ---------- Session du compte AI Assistant ----------
// Lien magique genere cote admin (aucun email envoye) puis echange contre une
// session : un vrai JWT que le proxy verifie comme celui d'un manager connecte.
// Garde en memoire de l'isolat jusqu'a une minute avant son expiration.
let session: { jwt: string; exp: number } | null = null;
async function assistantJwt(): Promise<string> {
  if (session && session.exp - 60 > Date.now() / 1000) return session.jwt;
  const h = { apikey: SERVICE_KEY, Authorization: "Bearer " + SERVICE_KEY, "Content-Type": "application/json" };
  const g = await fetch(SB_URL + "/auth/v1/admin/generate_link", {
    method: "POST", headers: h, body: JSON.stringify({ type: "magiclink", email: ASSISTANT_EMAIL }),
  });
  const gl = await g.json().catch(() => ({}));
  const hashed = gl?.hashed_token ?? gl?.properties?.hashed_token;
  if (!g.ok || !hashed) throw new Error("assistant link " + g.status);
  const v = await fetch(SB_URL + "/auth/v1/verify", {
    method: "POST", headers: { apikey: ANON_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ type: "magiclink", token_hash: hashed }),
  });
  const vs = await v.json().catch(() => ({}));
  if (!v.ok || !vs?.access_token) throw new Error("assistant session " + v.status);
  session = { jwt: vs.access_token, exp: Number(vs.expires_at) || Date.now() / 1000 + 3000 };
  return session.jwt;
}

// Une action d'ecriture du proxy, au nom de l'assistant. Sa reponse (statut et
// corps) est rendue telle quelle : memes messages d'erreur que l'app.
async function act(action: string, body: Record<string, unknown>): Promise<Response> {
  const jwt = await assistantJwt();
  const r = await fetch(SB_URL + "/functions/v1/hostaway-proxy?action=" + encodeURIComponent(action), {
    method: "POST",
    headers: { "X-App-Secret": APP_SECRET, Authorization: "Bearer " + jwt, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (r.status === 401) session = null;
  const out = scrub(await r.json().catch(() => ({ error: "proxy returned " + r.status })));
  console.log("[api] write", action, r.status);
  return json(out, r.status);
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
});

async function all(build: (a: number, b: number) => any, what: string): Promise<any[]> {
  const out: any[] = [];
  for (let a = 0; ; a += PAGE) {
    const { data, error } = await build(a, a + PAGE - 1);
    if (error) throw new Error(what + ": " + error.message);
    out.push(...(data ?? []));
    if ((data ?? []).length < PAGE || out.length >= 20000) return out;
  }
}
async function byKeys(table: string, cols: string, keys: string[]): Promise<any[]> {
  const out: any[] = [];
  for (let i = 0; i < keys.length; i += 100) {
    const { data, error } = await ro(table, cols).in("reservation_key", keys.slice(i, i + 100));
    if (error) throw new Error(table + ": " + error.message);
    out.push(...(data ?? []));
  }
  return out;
}
const listingsRows = () => all((a, b) => ro("listing_config",
  "listing_id, internal_name, listing_name, apt_number, bedrooms, unit_type, inspection_excluded").order("listing_id").range(a, b), "listing_config");
const peopleNames = async () => Object.fromEntries((await all((a, b) => ro("cleaners", "id, name").order("id").range(a, b), "cleaners"))
  .map((p: any) => [String(p.id), String(p.name)]));

// ---------- /listings ----------
async function listings() {
  const [rows, map] = await Promise.all([
    listingsRows(),
    all((a, b) => ro("listings_map", "listing_id, address").order("id").range(a, b), "listings_map"),
  ]);
  const byId = Object.fromEntries(map.map((m: any) => [String(m.listing_id), m]));
  const data = rows.map((r: any) => listingOut(r, byId))
    .sort((a, b) => a.building.localeCompare(b.building) || String(a.apartment).localeCompare(String(b.apartment), undefined, { numeric: true }));
  return json({ count: data.length, data });
}

// ---------- /technicians ----------
async function technicians() {
  const [members, vendors, open] = await Promise.all([
    // Le compte de l'assistant est un manager technique, pas un technicien.
    all((a, b) => ro("cleaners", "id, name, role, is_active, email").in("role", RO_TECH_ROLES)
      .order("id").range(a, b), "cleaners").then((rows) => rows.filter((m: any) => m.email !== ASSISTANT_EMAIL)),
    all((a, b) => ro("vendors", "id, name, is_active").order("id").range(a, b), "vendors"),
    all((a, b) => ro("maintenance_tickets", "assigned_technician_id, assigned_vendor_id").in("status", RO_OPEN).order("id").range(a, b), "maintenance_tickets"),
  ]);
  const count = (field: string, id: number) => open.filter((t: any) => Number(t[field]) === id).length;
  const data = [
    ...members.map((m: any) => ({ type: "technician", id: Number(m.id), name: m.name, role: m.role, active: m.is_active !== false,
      openTickets: count("assigned_technician_id", Number(m.id)) })),
    ...vendors.map((v: any) => ({ type: "vendor", id: Number(v.id), name: v.name, role: "vendor", active: v.is_active !== false,
      openTickets: count("assigned_vendor_id", Number(v.id)) })),
  ];
  return json({ count: data.length, data });
}

// ---------- /maintenance ----------
async function maintenance(q: URLSearchParams) {
  const status = ticketStatuses(q);
  const category = listParam(q, "category", RO_CATEGORIES);
  const from = dateParam(q, "from");
  const to = dateParam(q, "to");
  const limit = intParam(q, "limit", RO_LIMIT_DEFAULT, RO_LIMIT_MAX);
  const offset = intParam(q, "offset", 0, 1_000_000);
  const dateField = q.get("date_field") ?? "created";
  for (const p of [status, category, from, to, limit, offset]) if (isBad(p)) return json(p, 400);
  if (!["created", "resolved", "closed"].includes(dateField)) return json({ error: "date_field must be created, resolved or closed" }, 400);
  const listingId = q.get("listing_id");
  if (listingId && !/^\d+$/.test(listingId)) return json({ error: "listing_id must be numeric" }, 400);
  const tech = intParam(q, "technician_id", null, 1_000_000);
  if (isBad(tech)) return json(tech, 400);

  const col = dateField + "_at";
  // Dates en heure de Dubai (UTC+4) : from 00:00 a to 23:59:59 locales.
  let x = ro("maintenance_tickets", TICKET_COLS);
  if (status) x = x.in("status", status as string[]);
  if (category) x = x.in("category", category as string[]);
  if (listingId) x = x.eq("listing_id", listingId);
  if (tech !== null) x = x.eq("assigned_technician_id", tech as number);
  if (from) x = x.gte(col, from + "T00:00:00+04:00");
  if (to) x = x.lt(col, plusDays(to as string, 1) + "T00:00:00+04:00");
  const off = offset as number, lim = limit as number;
  const { data, error } = await x.order("id", { ascending: false }).range(off, off + lim);
  if (error) throw new Error("maintenance_tickets: " + error.message);

  const [lst, people, vendors] = await Promise.all([
    listingsRows(), peopleNames(),
    all((a, b) => ro("vendors", "id, name").order("id").range(a, b), "vendors"),
  ]);
  const place = placeMap(lst);
  const vend = Object.fromEntries(vendors.map((v: any) => [String(v.id), String(v.name)]));
  const rows = (data ?? []);
  const page = rows.slice(0, lim).map((t: any) => ticketOut(t, place, people, vend));
  return json({ count: page.length, offset: off, limit: lim, hasMore: rows.length > lim, data: page });
}

// ---------- /cleanings ----------
async function loadCheckouts(from: string, to: string): Promise<CheckoutIn[]> {
  const u = SB_URL + "/functions/v1/hostaway-proxy?action=checkouts&startDate=" + from + "&endDate=" + to;
  let r = await fetch(u, { headers: { "X-App-Secret": APP_SECRET } });
  // Un 5xx passager de Hostaway (vu en test) : un seul nouvel essai.
  if (r.status >= 500) r = await fetch(u, { headers: { "X-App-Secret": APP_SECRET } });
  if (!r.ok) throw new Error("checkouts " + r.status);
  const body = await r.json();
  return Array.isArray(body?.reservations) ? body.reservations : [];
}

class Unavailable extends Error {}
// Menages de la plage, chacun avec sa cle interne (_key, nom du guest compris)
// et sa date d'origine (_orig) : utiles aux ecritures, retires avant toute sortie.
async function buildCleanings(from: string, to: string): Promise<any[]> {
  let res: CheckoutIn[];
  try {
    res = (await loadCheckouts(from, to)).filter((r) => r && r.listingId && r.checkOut && VALID_RES.includes(String(r.status ?? "")));
  } catch (e) {
    console.error("[readonly-api] checkouts failed:", e);
    throw new Unavailable();
  }
  const EXTRA = "id, reservation_key, listing_id, cleaning_date, label, status";
  const [extrasWin, postIn] = await Promise.all([
    all((a, b) => ro("extra_cleanings", EXTRA).gte("cleaning_date", plusDays(from, -31)).lte("cleaning_date", to).order("id").range(a, b), "extra_cleanings"),
    all((a, b) => ro("cleaning_postponed", "reservation_key").gte("new_date", from).lte("new_date", to).order("reservation_key").range(a, b), "cleaning_postponed"),
  ]);
  const known = new Set(extrasWin.map((e: any) => String(e.reservation_key)));
  const missing = postIn.map((p: any) => String(p.reservation_key)).filter((k: string) => k.startsWith("extra_") && !known.has(k));
  const extras = [...extrasWin, ...(missing.length ? await byKeys("extra_cleanings", EXTRA, missing) : [])]
    .filter((e: any) => e.reservation_key && e.status !== "cancelled");

  const keyOf = (r: CheckoutIn) => reservationKey({ departure: String(r.checkOut), guest: String(r.guest ?? "") });
  const keys = [...new Set([...res.map(keyOf), ...extras.map((e: any) => String(e.reservation_key))])];
  const [post, asg, done, timers, canc, lst, people] = await Promise.all([
    byKeys("cleaning_postponed", "reservation_key, original_date, new_date", keys),
    byKeys("cleaning_assignments", "reservation_key, cleaner_id, service_type", keys),
    byKeys("menage_done", "reservation_key, done", keys),
    byKeys("cleaning_timer", "reservation_key, started_at, finished_at, duration_minutes", keys),
    byKeys("cleaning_cancelled", "reservation_key, reason", keys),
    listingsRows(), peopleNames(),
  ]);
  const c: CleaningCtx = { from, to, place: placeMap(lst), people, post: {}, asg: {}, done: new Set(), timer: {}, canc: {} };
  for (const p of post) if (p.new_date) c.post[String(p.reservation_key)] = { from: p.original_date ?? null, to: String(p.new_date) };
  for (const a of asg) (c.asg[String(a.reservation_key)] ??= []).push({ id: Number(a.cleaner_id), st: String(a.service_type || "CHC") });
  for (const d of done) if (d.done === true) c.done.add(String(d.reservation_key));
  for (const t of timers) c.timer[String(t.reservation_key)] = t;
  for (const x of canc) c.canc[String(x.reservation_key)] = String(x.reason ?? "");

  const seen = new Set<string>();
  const out: any[] = [];
  const push = (key: string, base: string, row: any) => {
    if (row && !seen.has(key)) { seen.add(key); out.push({ ...row, _key: key, _orig: c.post[key]?.from ?? base }); }
  };
  for (const r of res) {
    const k = keyOf(r);
    const ng = r.nextGuest?.date ? { date: String(r.nextGuest.date), hour: hourOrNull(r.nextGuest.checkInTime) } : null;
    push(k, String(r.checkOut),
      cleaningOut(k, "checkout", String(r.id ?? k.slice(0, 10)), String(r.listingId), String(r.checkOut), hourOrNull(r.checkOutTime), ng, null, c));
  }
  for (const e of extras) {
    const k = String(e.reservation_key);
    push(k, String(e.cleaning_date),
      cleaningOut(k, "extra", "extra-" + e.id, String(e.listing_id ?? ""), String(e.cleaning_date), null, null, e.label ?? "Extra cleaning", c));
  }
  return out;
}
const publicRow = ({ _key, _orig, ...row }: any) => row;

async function cleanings(q: URLSearchParams) {
  const range = cleaningRange(q);
  if (isBad(range)) return json(range, 400);
  const status = listParam(q, "status", RO_CLEANING_STATUSES);
  if (isBad(status)) return json(status, 400);
  const listingId = q.get("listing_id");
  if (listingId && !/^\d+$/.test(listingId)) return json({ error: "listing_id must be numeric" }, 400);
  const cleanerId = intParam(q, "cleaner_id", null, 1_000_000);
  if (isBad(cleanerId)) return json(cleanerId, 400);
  const { from, to } = range;
  const data = (await buildCleanings(from, to))
    .filter((j) => !status || (status as string[]).includes(j.status))
    .filter((j) => !listingId || j.listingId === listingId)
    .filter((j) => cleanerId === null || j.assigned.some((a: any) => a.id === cleanerId))
    .sort((a, b) => a.date.localeCompare(b.date) || String(a.checkoutTime ?? "99").localeCompare(String(b.checkoutTime ?? "99")) ||
      a.building.localeCompare(b.building))
    .map(publicRow);
  return json({ from, to, count: data.length, data });
}

// ---------- /proposals ----------
// Propositions de tickets tirees des messages Hostaway. Ni nom de guest ni
// identifiant de conversation ; les citations sont masquees comme les tickets.
async function proposals(q: URLSearchParams) {
  const status = listParam(q, "status", ["pending", "accepted", "rejected", "merged"]);
  if (isBad(status)) return json(status, 400);
  const limit = intParam(q, "limit", RO_LIMIT_DEFAULT, RO_LIMIT_MAX);
  if (isBad(limit)) return json(limit, 400);
  let x = ro("maintenance_proposals",
    "id, listing_id, stay_from, stay_to, title, category, urgency, quotes, status, ticket_id, open_ticket_id, decided_by, decided_at, reject_reason, created_at");
  x = x.in("status", (status as string[] | null) ?? ["pending"]);
  const { data, error } = await x.order("id", { ascending: false }).limit(limit as number);
  if (error) throw new Error("maintenance_proposals: " + error.message);
  const place = placeMap(await listingsRows());
  const out = (data ?? []).map((p: any) => proposalOut(p, place));
  return json({ count: out.length, data: out });
}

// ---------- Ecritures ----------
type Body = Record<string, any>;
async function readBody(req: Request): Promise<Body | Response> {
  const b = await req.json().catch(() => null);
  return b && typeof b === "object" && !Array.isArray(b) ? b : json({ error: "JSON object body required" }, 400);
}

// Retrouve la cle interne d'un menage a partir de ce que l'API publie : son id
// et sa date (celle rendue par GET /cleanings).
async function findCleaning(b: Body): Promise<any | Response> {
  const id = String(b.id ?? "").trim();
  const date = String(b.date ?? "");
  if (!id || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return json({ error: "id and date (YYYY-MM-DD, as returned by GET /cleanings) required" }, 400);
  const job = (await buildCleanings(date, date)).find((j) => j.id === id);
  return job ?? json({ error: "No cleaning " + id + " on " + date + "." }, 404);
}

async function writeCleaning(op: string, req: Request) {
  const b = await readBody(req);
  if (b instanceof Response) return b;
  const job = await findCleaning(b);
  if (job instanceof Response) return job;
  const key = job._key as string;
  if (op === "assign") {
    if (!Array.isArray(b.cleaner_ids)) return json({ error: "cleaner_ids (array, empty = unassign) required" }, 400);
    return act("assignCleaner", { reservation_key: key, mode: "set", cleaner_ids: b.cleaner_ids, service_type: b.service_type });
  }
  if (op === "done") {
    if (typeof b.done !== "boolean") return json({ error: "done (boolean) required" }, 400);
    return act("setDone", { key, done: b.done });
  }
  if (op === "cancel") {
    if (typeof b.cancelled !== "boolean") return json({ error: "cancelled (boolean) required" }, 400);
    return act("setCancelled", { key, cancelled: b.cancelled, reason: typeof b.reason === "string" ? b.reason : "" });
  }
  // postpone : new_date = nouvelle date, null = annule le report.
  if (b.new_date === null) return act("setPostponed", { key, postpone: false });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(b.new_date ?? ""))) return json({ error: "new_date (YYYY-MM-DD, or null to undo) required" }, 400);
  return act("setPostponed", { key, postpone: true, new_date: b.new_date, original_date: job._orig });
}

async function writeExtra(op: string, req: Request) {
  const b = await readBody(req);
  if (b instanceof Response) return b;
  if (op === "create") return act("addExtraCleaning", { ...b, idem: b.idem ?? crypto.randomUUID() });
  const id = Number(String(b.id ?? "").replace(/^extra-/, ""));
  if (!Number.isInteger(id) || id <= 0) return json({ error: "id (extra-N or N) required" }, 400);
  return act(op === "update" ? "updateExtraCleaning" : "deleteExtraCleaning", { ...b, id });
}

async function writeListing(req: Request) {
  const b = await readBody(req);
  if (b instanceof Response) return b;
  const lid = String(b.listing_id ?? "");
  if (!/^\d+$/.test(lid)) return json({ error: "listing_id required" }, 400);
  const steps: Array<[string, Body]> = [];
  if (b.apartment !== undefined) steps.push(["setAptNumber", { listing_id: lid, apt_number: b.apartment }]);
  if (b.inspection_excluded !== undefined) steps.push(["insp.setExcluded", { listingId: lid, excluded: b.inspection_excluded }]);
  if (b.custom_price !== undefined) steps.push(["setCustomPrice", { listing_id: lid, custom_price: b.custom_price }]);
  if (!steps.length) return json({ error: "Nothing to change. Fields: apartment, inspection_excluded, custom_price." }, 400);
  const done: string[] = [];
  for (const [action, body] of steps) {
    const r = await act(action, body);
    if (!r.ok) return json({ error: "Stopped at " + action + ": " + ((await r.json().catch(() => ({})))?.error ?? r.status), done }, r.status);
    done.push(action);
  }
  return json({ status: "success", listingId: lid, done });
}

async function writeMaintenance(req: Request) {
  const b = await readBody(req);
  if (b instanceof Response) return b;
  return act("mnt.act", { ...b, idem: b.idem ?? crypto.randomUUID() });
}

const INDEX = {
  name: "HK Planner API",
  auth: "X-API-Key: <key>  (or Authorization: Bearer <key>)",
  author: "Writes are made as the team member 'AI Assistant' (manager), with the same rules as the manager app.",
  read: {
    "GET /listings": "apartments (id, apartment, building, area, bedrooms, unit type)",
    "GET /technicians": "people and vendors who can take a maintenance ticket, with open ticket counts",
    "GET /maintenance": "tickets. Filters: listing_id, status (open | closed | comma list), category, technician_id, from, to, date_field (created|resolved|closed), limit (max 500), offset",
    "GET /proposals": "ticket proposals detected in guest messages. Filters: status (pending by default, accepted, rejected, merged), limit",
    "GET /cleanings": "cleanings (checkouts and extras). Filters: from (required), to (max 31 days), listing_id, status, cleaner_id",
  },
  write: {
    "POST /maintenance/act": {
      body: "{op, ...}. idem optional (sent twice = done once).",
      ops: {
        "ticket.create": "listingId, title, category, urgency (urgent|high|normal), note?, memberId? | vendorId?",
        "ticket.assign": "ticketId, memberId | vendorId, or unassign: true",
        "ticket.start / ticket.reopen": "ticketId",
        "ticket.waiting_parts": "ticketId, note?",
        "ticket.due": "ticketId, date (YYYY-MM-DD, null to clear)",
        "ticket.comment": "ticketId, text",
        "ticket.done": "ticketId, note?, cost?",
        "ticket.edit_closed": "ticketId, note?, cost?",
        "proposal.accept": "proposalId, title, category, urgency, listingId?, note?, memberId? | vendorId?",
        "proposal.reject": "proposalId, reason (not_maintenance|already_fixed|duplicate|other), note (required for other)",
        "proposal.merge": "proposalId, ticketId",
      },
    },
    "POST /cleanings/assign": "{id, date, cleaner_ids: [..] (empty = unassign), service_type?}",
    "POST /cleanings/done": "{id, date, done: true|false}",
    "POST /cleanings/cancel": "{id, date, cancelled: true|false, reason?}",
    "POST /cleanings/postpone": "{id, date, new_date: YYYY-MM-DD | null to undo}",
    "POST /extras": "{listing_id, cleaning_date, cleaning_time? HH:MM, label?, notes?, price_billed?, cleaner_price?, assigned_cleaner_id?}",
    "POST /extras/update": "{id, any of label, notes, status, cleaning_date, cleaning_time, listing_id, price_billed, cleaner_price}",
    "POST /extras/delete": "{id}",
    "POST /listings/update": "{listing_id, apartment?, inspection_excluded?, custom_price?}",
  },
  notes: "id and date of a cleaning are the values returned by GET /cleanings. Cleaner ids: GET /technicians lists maintenance people; cleaners appear in cleanings[].assigned (Faiza 4, Pionah 10, Elite Cleaning 12).",
  values: { ticketStatus: [...RO_OPEN, "resolved", "closed", "cancelled"], category: RO_CATEGORIES, cleaningStatus: RO_CLEANING_STATUSES },
  dates: "YYYY-MM-DD, Dubai time",
};

const GETS: Record<string, (q: URLSearchParams) => Promise<Response>> = {
  "": async () => json(INDEX), "/listings": () => listings(), "/technicians": () => technicians(),
  "/maintenance": maintenance, "/proposals": proposals, "/cleanings": cleanings,
};
const POSTS: Record<string, (req: Request) => Promise<Response>> = {
  "/maintenance/act": writeMaintenance,
  "/cleanings/assign": (r) => writeCleaning("assign", r), "/cleanings/done": (r) => writeCleaning("done", r),
  "/cleanings/cancel": (r) => writeCleaning("cancel", r), "/cleanings/postpone": (r) => writeCleaning("postpone", r),
  "/extras": (r) => writeExtra("create", r), "/extras/update": (r) => writeExtra("update", r), "/extras/delete": (r) => writeExtra("delete", r),
  "/listings/update": writeListing,
};

Deno.serve(async (req) => {
  if (!(await keyOk(req.headers, KEY_SHA))) return json({ error: "invalid or missing API key" }, 401);
  const url = new URL(req.url);
  const route = url.pathname.replace(/\/+$/, "").split("/readonly-api")[1] ?? "";
  try {
    if (req.method === "GET" && GETS[route]) return await GETS[route](url.searchParams);
    if (req.method === "POST" && POSTS[route]) return await POSTS[route](req);
    if (GETS[route] || POSTS[route]) return json({ error: "method not allowed on " + (route || "/") }, 405);
    return json({ error: "unknown endpoint", read: Object.keys(INDEX.read), write: Object.keys(INDEX.write) }, 404);
  } catch (e) {
    if (e instanceof Unavailable) return json({ error: "Bookings are unavailable right now. Try again in a few minutes." }, 503);
    console.error("[readonly-api]", route, e);
    return json({ error: "internal error" }, 500);
  }
});
