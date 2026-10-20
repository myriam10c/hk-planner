// API en lecture seule de HK Planner, pour un assistant IA externe.
// GET uniquement, cle secrete (X-API-Key ou Authorization: Bearer), aucune
// ecriture : le client base n'est utilise qu'a travers ro(), qui n'expose que
// select(). Les departs (menages) viennent de l'action checkouts du proxy, la
// meme source que le Planning manager.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import {
  cleaningOut, cleaningRange, type CheckoutIn, type CleaningCtx, dateParam, hourOrNull, intParam, isBad, keyOk,
  listingOut, listParam, placeMap, plusDays, RO_CATEGORIES, RO_CLEANING_STATUSES, RO_LIMIT_DEFAULT, RO_LIMIT_MAX,
  reservationKey, RO_OPEN, RO_TECH_ROLES, TICKET_COLS, ticketOut, ticketStatuses,
} from "./ro_rules.ts";

const KEY_SHA = Deno.env.get("READONLY_API_KEY_SHA256") ?? "";
const SB_URL = Deno.env.get("SUPABASE_URL") ?? "";
const APP_SECRET = Deno.env.get("APP_SHARED_SECRET") ?? "";
const VALID_RES = ["new", "modified", "confirmed", "ownerStay", "reserved"];
const PAGE = 1000;

const db = createClient(SB_URL, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "", { auth: { persistSession: false } });
// Seule porte vers la base : select() et rien d'autre.
const ro = (table: string, cols: string) => db.from(table).select(cols);

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
    all((a, b) => ro("cleaners", "id, name, role, is_active").in("role", RO_TECH_ROLES).order("id").range(a, b), "cleaners"),
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

  let res: CheckoutIn[];
  try {
    res = (await loadCheckouts(from, to)).filter((r) => r && r.listingId && r.checkOut && VALID_RES.includes(String(r.status ?? "")));
  } catch (e) {
    console.error("[readonly-api] checkouts failed:", e);
    return json({ error: "Bookings are unavailable right now. Try again in a few minutes." }, 503);
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
  const push = (key: string, row: any) => { if (row && !seen.has(key)) { seen.add(key); out.push(row); } };
  for (const r of res) {
    const k = keyOf(r);
    const ng = r.nextGuest?.date ? { date: String(r.nextGuest.date), hour: hourOrNull(r.nextGuest.checkInTime) } : null;
    push(k, cleaningOut(k, "checkout", String(r.id ?? k.slice(0, 10)), String(r.listingId), String(r.checkOut), hourOrNull(r.checkOutTime), ng, null, c));
  }
  for (const e of extras) {
    const k = String(e.reservation_key);
    push(k, cleaningOut(k, "extra", "extra-" + e.id, String(e.listing_id ?? ""), String(e.cleaning_date), null, null, e.label ?? "Extra cleaning", c));
  }
  const data = out
    .filter((j) => !status || (status as string[]).includes(j.status))
    .filter((j) => !listingId || j.listingId === listingId)
    .filter((j) => cleanerId === null || j.assigned.some((a: any) => a.id === cleanerId))
    .sort((a, b) => a.date.localeCompare(b.date) || String(a.checkoutTime ?? "99").localeCompare(String(b.checkoutTime ?? "99")) ||
      a.building.localeCompare(b.building));
  return json({ from, to, count: data.length, data });
}

const INDEX = {
  name: "HK Planner read-only API",
  auth: "X-API-Key: <key>  (or Authorization: Bearer <key>)",
  endpoints: {
    "GET /listings": "apartments (id, apartment, building, area, bedrooms, unit type)",
    "GET /technicians": "people and vendors who can take a maintenance ticket, with open ticket counts",
    "GET /maintenance": "tickets. Filters: listing_id, status (open | closed | comma list), category, technician_id, from, to, date_field (created|resolved|closed), limit (max 500), offset",
    "GET /cleanings": "cleanings (checkouts and extras). Filters: from (required), to (max 31 days), listing_id, status, cleaner_id",
  },
  values: { ticketStatus: [...RO_OPEN, "resolved", "closed", "cancelled"], category: RO_CATEGORIES, cleaningStatus: RO_CLEANING_STATUSES },
  dates: "YYYY-MM-DD, Dubai time",
};

Deno.serve(async (req) => {
  if (req.method !== "GET") return json({ error: "read-only API: GET only" }, 405);
  if (!(await keyOk(req.headers, KEY_SHA))) return json({ error: "invalid or missing API key" }, 401);
  const url = new URL(req.url);
  const route = url.pathname.replace(/\/+$/, "").split("/readonly-api")[1] ?? "";
  try {
    switch (route) {
      case "": return json(INDEX);
      case "/listings": return await listings();
      case "/technicians": return await technicians();
      case "/maintenance": return await maintenance(url.searchParams);
      case "/cleanings": return await cleanings(url.searchParams);
      default: return json({ error: "unknown endpoint", endpoints: Object.keys(INDEX.endpoints) }, 404);
    }
  } catch (e) {
    console.error("[readonly-api]", route, e);
    return json({ error: "internal error" }, 500);
  }
});
