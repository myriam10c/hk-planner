import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const HOSTAWAY_ACCOUNT_ID = Deno.env.get("HOSTAWAY_ACCOUNT_ID") ?? "";
const HOSTAWAY_API_SECRET = Deno.env.get("HOSTAWAY_API_KEY") ?? "";
const APP_SHARED_SECRET = Deno.env.get("APP_SHARED_SECRET") ?? "";
const STRICT_AUTH = (Deno.env.get("STRICT_AUTH") ?? "true") !== "false";
const TOKEN_URL = "https://api.hostaway.com/v1/accessTokens";
const API_BASE = "https://api.hostaway.com/v1";

const DEFAULT_CORS_HEADERS = {
  "Access-Control-Allow-Origin": "https://stunning-kleicha-f61101.netlify.app",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-App-Secret, X-Cleaner-Token",
  "Vary": "Origin",
};
const ALLOWED_ORIGINS = new Set([
  "https://stunning-kleicha-f61101.netlify.app",
  "http://localhost:3000",
  "http://localhost:8080",
]);
function corsHeaders(origin: string | null): Record<string, string> {
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    return { ...DEFAULT_CORS_HEADERS, "Access-Control-Allow-Origin": origin };
  }
  return DEFAULT_CORS_HEADERS;
}
// Alias pour code existant qui utilise CORS_HEADERS
const CORS_HEADERS = DEFAULT_CORS_HEADERS;

let cachedToken: string | null = null;
let tokenExpiry = 0;

function getSupabase() {
  return createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
  );
}

function jsonResp(data: any, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

async function getAccessToken(): Promise<string> {
  if (cachedToken && Date.now() < tokenExpiry) return cachedToken;
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: HOSTAWAY_ACCOUNT_ID,
    client_secret: HOSTAWAY_API_SECRET,
    scope: "general",
  });
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  if (!response.ok) {
    const errText = await response.text();
    throw new Error("Token failed: " + response.status + " - " + errText);
  }
  const data = await response.json();
  cachedToken = data.access_token;
  tokenExpiry = Date.now() + (data.expires_in - 300) * 1000;
  return cachedToken!;
}

const BEDROOM_PRICES: Record<number, number> = { 0: 250, 1: 300, 2: 450 };
function priceForBedrooms(b: number): number {
  return BEDROOM_PRICES[b] ?? (b >= 3 ? 450 : 250);
}

const TAG_PRICES: Record<string, number> = { "studio": 250, "1 bhk": 300, "2 bhk": 450, "3 bhk": 550 };
function priceForTag(tag: string | null, bedrooms: number): number {
  if (tag) {
    const normalized = tag.toLowerCase().trim();
    if (TAG_PRICES[normalized] != null) return TAG_PRICES[normalized];
  }
  return priceForBedrooms(bedrooms);
}

function extractUnitType(listing: any): string | null {
  const tags = listing.listingTags || [];
  if (tags.length > 0) return tags[0].name || null;
  return null;
}

// Extract apartment/unit number from any free-form string.
// Patterns recognised (in priority order):
//   "1503 - Building"  → 1503
//   "1503 | Building"  → 1503
//   "1503 Building"    → 1503 (digits at start)
//   "Apt 1503", "Unit 1503", "#1503" → 1503
//   "G8", "B12" letter+digits at start → G8
function extractAptNumber(s: string | null | undefined): string | null {
  if (!s) return null;
  const str = String(s).trim();
  if (!str) return null;
  // 1) digits + optional suffix letter then separator (- | : , ·)  — e.g. "2410B - Bloom Height", "705a · 15th Northside"
  let m = str.match(/^([0-9]{1,5}[A-Za-z]?)\s*[-|:,·]/);
  if (m) return m[1];
  // 2) "Apt|Unit|Apartment|Studio|#" + number
  m = str.match(/(?:^|\s)(?:apt|unit|apartment|studio|#)\s*\.?\s*([0-9]{1,5}[A-Za-z]?)\b/i);
  if (m) return m[1];
  // 3) letter+digits at start (e.g. G8, B12)
  m = str.match(/^([A-Za-z]\s*[0-9]{1,3})\b/);
  if (m) return m[1].replace(/\s+/g, '');
  // 4) digits at very start, then space + word
  m = str.match(/^([0-9]{2,5})\s+[A-Za-z]/);
  if (m) return m[1];
  return null;
}

async function fetchAllPages(baseUrl: string, authHeaders: Record<string, string>, pageSize = 200): Promise<any[]> {
  let all: any[] = [];
  let offset = 0;
  while (true) {
    const sep = baseUrl.includes("?") ? "&" : "?";
    const pageUrl = baseUrl + sep + "limit=" + pageSize + "&offset=" + offset;
    const resp = await fetch(pageUrl, { headers: authHeaders });
    if (!resp.ok) break;
    const data = await resp.json();
    const results = data.result || [];
    all = all.concat(results);
    if (results.length < pageSize) break;
    offset += pageSize;
  }
  return all;
}

async function addLog(sb: any, key: string, action: string, actor?: string, details?: any) {
  await sb.from("cleaning_log").insert({ reservation_key: key, action, actor: actor || null, details: details || {} });
}

// ========== Phase 1 : Cleaner auth helpers ==========
function generateSessionToken(): string {
  const arr = new Uint8Array(32);
  crypto.getRandomValues(arr);
  return btoa(String.fromCharCode(...arr))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function getClientIp(req: Request): string {
  return req.headers.get("cf-connecting-ip")
      ?? req.headers.get("x-real-ip")
      ?? req.headers.get("x-forwarded-for")?.split(',')[0]?.trim()
      ?? "unknown";
}

// Validate X-Cleaner-Token, return cleaner info or null (no error if token missing)
async function validateCleanerToken(sb: any, token: string | null): Promise<{ cleaner_id: number; name: string; role: string; color: string } | null> {
  if (!token) return null;
  const { data, error } = await sb.rpc('validate_cleaner_session', { p_token: token });
  if (error || !data || data.length === 0) return null;
  return data[0];
}

// ========== Phase 3 : photos bucket helpers ==========
const PHOTO_BUCKET = "cleaning-photos";

function parseDataUrl(s: string): { mime: string; bytes: Uint8Array } | null {
  if (typeof s !== "string" || !s.startsWith("data:")) return null;
  const m = s.match(/^data:([^;]+);base64,(.+)$/);
  if (!m) return null;
  const bin = atob(m[2]);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return { mime: m[1], bytes };
}

function extFromMime(mime: string): string {
  if (mime.includes("png")) return "png";
  if (mime.includes("webp")) return "webp";
  if (mime.includes("gif")) return "gif";
  return "jpg";
}

// Upload data URL vers bucket, retourne path ou null
async function uploadPhotoDataUrl(sb: any, dataUrl: string | null | undefined, tableName: string, columnName: string, rowId: number | string): Promise<string | null> {
  if (!dataUrl) return null;
  const parsed = parseDataUrl(dataUrl);
  if (!parsed) return null;
  const path = `${tableName}/${columnName}/${rowId}_${Date.now()}.${extFromMime(parsed.mime)}`;
  const { error } = await sb.storage.from(PHOTO_BUCKET).upload(path, parsed.bytes, {
    contentType: parsed.mime, upsert: false,
  });
  if (error) { console.log(`[uploadPhoto] ${error.message}`); return null; }
  return path;
}

// Signed URL valide 1h
async function getPhotoUrl(sb: any, path: string | null): Promise<string | null> {
  if (!path) return null;
  const { data, error } = await sb.storage.from(PHOTO_BUCKET).createSignedUrl(path, 3600);
  if (error || !data) return null;
  return data.signedUrl;
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin");
  const CORS_HEADERS = corsHeaders(origin);
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  // Soft/strict app-level auth
  const providedSecret = req.headers.get("x-app-secret") ?? "";
  const hasSecret = APP_SHARED_SECRET !== "" && providedSecret === APP_SHARED_SECRET;
  if (STRICT_AUTH && !hasSecret) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }
  if (!hasSecret) {
    console.log("[hostaway-proxy] missing/invalid X-App-Secret from origin=" + origin);
  }
  try {
    const url = new URL(req.url);
    const action = url.searchParams.get("action");
    const sb = getSupabase();

    // ==================== CHECKOUTS ====================
    if (action === "checkouts") {
      const startDate = url.searchParams.get("startDate");
      const endDate = url.searchParams.get("endDate");
      if (!startDate || !endDate) return jsonResp({ error: "startDate and endDate required" }, 400);
      const token = await getAccessToken();
      const validStatuses = ['new','modified','confirmed','ownerStay','reserved'];
      const departuresUrl = API_BASE + "/reservations?departureStartDate=" + startDate + "&departureEndDate=" + endDate + "&sortOrder=departureDate&orderDirection=asc";
      const arrivalsUrl = API_BASE + "/reservations?arrivalStartDate=" + startDate + "&arrivalEndDate=" + endDate + "&sortOrder=arrivalDate&orderDirection=asc";
      const authHeaders = { "Authorization": "Bearer " + token, "Content-Type": "application/json" };
      const [depResults, arrResults] = await Promise.all([
        fetchAllPages(departuresUrl, authHeaders),
        fetchAllPages(arrivalsUrl, authHeaders),
      ]);
      const arrivalsMap: Record<string, Array<{ date: string; guest: string; checkInTime: number | null }>> = {};
      arrResults.forEach((r: any) => {
        if (!validStatuses.includes(r.status)) return;
        const listingId = String(r.listingMapId || r.listingId || "");
        if (!listingId) return;
        if (!arrivalsMap[listingId]) arrivalsMap[listingId] = [];
        arrivalsMap[listingId].push({ date: r.arrivalDate, guest: r.guestName || ((r.guestFirstName || "") + " " + (r.guestLastName || "")).trim() || "Guest", checkInTime: r.checkInTime != null ? Number(r.checkInTime) : null });
      });
      const reservations = depResults.filter((r: any) => validStatuses.includes(r.status)).map((r: any) => {
        const listingId = String(r.listingMapId || r.listingId || "");
        const depDate = r.departureDate;
        let nextGuest: any = null;
        const arrivals = arrivalsMap[listingId] || [];
        for (const arr of arrivals) {
          if (arr.date === depDate) { nextGuest = arr; break; }
          const depD = new Date(depDate + "T00:00:00Z"); const nextDay = new Date(depD); nextDay.setUTCDate(nextDay.getUTCDate() + 1);
          const nextDayStr = nextDay.toISOString().split("T")[0];
          if (arr.date === nextDayStr) { if (!nextGuest) nextGuest = arr; }
        }
        return {
          id: r.id, guest: r.guestName || ((r.guestFirstName || "") + " " + (r.guestLastName || "")).trim(),
          listing: r.listingName || "", listingId, checkIn: r.arrivalDate, checkOut: r.departureDate,
          checkInTime: r.checkInTime != null ? Number(r.checkInTime) : null,
          checkOutTime: r.checkOutTime != null ? Number(r.checkOutTime) : null,
          status: r.status, channel: r.channelName || "", phone: r.phone || r.guestPhone || "",
          numberOfGuests: r.numberOfGuests || 0, cleaningFee: r.cleaningFee != null ? Number(r.cleaningFee) : 0,
          nextGuest: nextGuest ? { guest: nextGuest.guest, date: nextGuest.date, checkInTime: nextGuest.checkInTime, sameDay: nextGuest.date === depDate } : null,
        };
      });
      return jsonResp({ status: "success", count: reservations.length, reservations });
    }

    // ==================== SYNC LISTINGS ====================
    if (action === "syncListings") {
      const token = await getAccessToken();
      const authHeaders = { "Authorization": "Bearer " + token, "Content-Type": "application/json" };
      const listResp = await fetch(API_BASE + "/listings?limit=200", { headers: authHeaders });
      if (!listResp.ok) throw new Error("Failed to fetch listings: " + listResp.status);
      const listData = await listResp.json();
      const listings = listData.result || [];
      let synced = 0;
      for (const l of listings) {
        const lid = String(l.id);
        const bedrooms = l.bedroomsNumber != null ? Number(l.bedroomsNumber) : 0;
        const unitType = extractUnitType(l);
        const price = priceForTag(unitType, bedrooms);
        const internalName = l.internalListingName || null;
        // Try in order: internalListingName, name, address — first that yields a number wins
        const aptNumber = extractAptNumber(internalName) || extractAptNumber(l.name) || extractAptNumber(l.address) || null;
        const { error } = await sb.from("listing_config").upsert({ listing_id: lid, listing_name: l.name || "", bedrooms, price, unit_type: unitType, internal_name: internalName, apt_number: aptNumber, updated_at: new Date().toISOString() }, { onConflict: "listing_id" });
        if (!error) synced++;
      }
      return jsonResp({ status: "success", synced, total: listings.length });
    }

    // ==================== DONE STATES ====================
    if (action === "getDone") {
      const { data, error } = await sb.from("menage_done").select("reservation_key, done");
      if (error) throw error;
      const doneMap: Record<string, boolean> = {};
      (data || []).forEach((row: any) => { doneMap[row.reservation_key] = row.done; });
      return jsonResp({ status: "success", done: doneMap });
    }
    if (action === "setDone" && req.method === "POST") {
      const body = await req.json();
      const { key, done: isDone, actor } = body;
      if (!key || typeof isDone !== "boolean") return jsonResp({ error: "key and done required" }, 400);
      if (isDone) {
        const { error } = await sb.from("menage_done").upsert({ reservation_key: key, done: true, updated_at: new Date().toISOString() }, { onConflict: "reservation_key" });
        if (error) throw error;
      } else {
        const { error } = await sb.from("menage_done").delete().eq("reservation_key", key);
        if (error) throw error;
      }
      await addLog(sb, key, isDone ? "marked_done" : "marked_undone", actor);
      return jsonResp({ status: "success", key, done: isDone });
    }

    // ==================== CANCEL CLEANING ====================
    if (action === "setCancelled" && req.method === "POST") {
      const body = await req.json();
      const { key, cancelled, reason, actor } = body;
      if (!key || typeof cancelled !== "boolean") return jsonResp({ error: "key and cancelled required" }, 400);
      if (cancelled) {
        const { error } = await sb.from("cleaning_cancelled").upsert({ reservation_key: key, reason: reason || "", cancelled_by: actor || "Manager", cancelled_at: new Date().toISOString() }, { onConflict: "reservation_key" });
        if (error) throw error;
      } else {
        const { error } = await sb.from("cleaning_cancelled").delete().eq("reservation_key", key);
        if (error) throw error;
      }
      await addLog(sb, key, cancelled ? "cancelled" : "uncancelled", actor);
      return jsonResp({ status: "success", key, cancelled });
    }

    // ==================== CLEANERS ====================
    if (action === "getCleaners") {
      const { data, error } = await sb.from("cleaners").select("*").eq("is_active", true).order("name");
      if (error) throw error;
      return jsonResp({ status: "success", cleaners: data });
    }
    if (action === "saveCleaner" && req.method === "POST") {
      const body = await req.json();
      const { id, name, phone, color, pin, role } = body;
      if (!name || typeof name !== 'string' || name.length > 100) return jsonResp({ error: "name required" }, 400);
      if (pin !== undefined && pin !== null && pin !== "" && (typeof pin !== 'string' || !/^\d{3,8}$/.test(pin))) {
        return jsonResp({ error: "pin must be 3-8 digits" }, 400);
      }
      let cleanerId: number;
      if (id) {
        const upd: any = { name, phone: phone || null, color: color || "#e94560" };
        if (role !== undefined) upd.role = role;
        const { error } = await sb.from("cleaners").update(upd).eq("id", id);
        if (error) throw error;
        cleanerId = Number(id);
      } else {
        const { data: inserted, error } = await sb.from("cleaners")
          .insert({ name, phone: phone || null, color: color || "#e94560", role: role || "cleaner", is_active: true })
          .select("id").single();
        if (error) throw error;
        cleanerId = inserted.id;
      }
      // Hash PIN server-side if provided (never store plaintext)
      if (pin && typeof pin === 'string' && pin.length >= 3) {
        const { error: pinErr } = await sb.rpc('set_cleaner_pin', { p_cleaner_id: cleanerId, p_pin: pin });
        if (pinErr) throw pinErr;
      }
      return jsonResp({ status: "success", id: cleanerId });
    }
    if (action === "deleteCleaner" && req.method === "POST") {
      const body = await req.json();
      if (!body.id) return jsonResp({ error: "id required" }, 400);
      const { error } = await sb.from("cleaners").update({ is_active: false }).eq("id", body.id);
      if (error) throw error;
      // Revoke all sessions of this cleaner
      await sb.from("cleaner_sessions").delete().eq("cleaner_id", body.id);
      return jsonResp({ status: "success" });
    }
    if (action === "cleanerLogin" && req.method === "POST") {
      const body = await req.json();
      const { pin } = body;
      if (!pin || typeof pin !== 'string' || pin.length < 3 || pin.length > 20) {
        return jsonResp({ error: "pin required" }, 400);
      }
      // Rate limit : max 5 failed attempts / 60 sec / IP
      const ip = getClientIp(req);
      const ipHash = await sha256Hex(ip);
      const since = new Date(Date.now() - 60_000).toISOString();
      const { count: failedCount } = await sb.from("login_attempts")
        .select("*", { count: "exact", head: true })
        .eq("ip_hash", ipHash).eq("success", false)
        .gte("attempted_at", since);
      if ((failedCount ?? 0) >= 5) {
        return jsonResp({ error: "Too many attempts. Try again in 1 minute." }, 429);
      }
      // Verify PIN via stored proc (bcrypt compare)
      const { data: verifyData, error: verifyErr } = await sb.rpc('verify_cleaner_pin', { p_pin: pin });
      if (verifyErr || !verifyData || verifyData.length === 0) {
        await sb.from("login_attempts").insert({ ip_hash: ipHash, success: false });
        return jsonResp({ error: "Invalid PIN" }, 401);
      }
      const cleaner = verifyData[0];
      // Issue session token
      const token = generateSessionToken();
      const ua = req.headers.get("user-agent") ?? null;
      const { error: sessErr } = await sb.from("cleaner_sessions").insert({
        token, cleaner_id: cleaner.id, user_agent: ua,
      });
      if (sessErr) throw sessErr;
      await sb.from("login_attempts").insert({ ip_hash: ipHash, success: true });
      return jsonResp({
        status: "success",
        token,
        cleaner: { id: cleaner.id, name: cleaner.name, color: cleaner.color, role: cleaner.role },
      });
    }
    if (action === "cleanerLogout" && req.method === "POST") {
      const token = req.headers.get("x-cleaner-token");
      if (token) {
        await sb.from("cleaner_sessions").delete().eq("token", token);
      }
      return jsonResp({ status: "success" });
    }
    if (action === "cleanerMe") {
      const token = req.headers.get("x-cleaner-token");
      const cleaner = await validateCleanerToken(sb, token);
      if (!cleaner) return jsonResp({ status: "success", cleaner: null });
      return jsonResp({ status: "success", cleaner: { id: cleaner.cleaner_id, name: cleaner.name, color: cleaner.color, role: cleaner.role } });
    }

    // ==================== ASSIGNMENTS ====================
    if (action === "getAssignments") {
      const { data, error } = await sb.from("cleaning_assignments").select("reservation_key, cleaner_id");
      if (error) throw error;
      const map: Record<string, number> = {};
      (data || []).forEach((r: any) => { map[r.reservation_key] = r.cleaner_id; });
      return jsonResp({ status: "success", assignments: map });
    }
    if (action === "assignCleaner" && req.method === "POST") {
      const body = await req.json();
      const { reservation_key, cleaner_id, actor } = body;
      if (!reservation_key) return jsonResp({ error: "reservation_key required" }, 400);
      if (cleaner_id) {
        const { error } = await sb.from("cleaning_assignments").upsert({ reservation_key, cleaner_id, assigned_at: new Date().toISOString() }, { onConflict: "reservation_key" });
        if (error) throw error;
        await addLog(sb, reservation_key, "assigned", actor, { cleaner_id });
      } else {
        const { error } = await sb.from("cleaning_assignments").delete().eq("reservation_key", reservation_key);
        if (error) throw error;
        await addLog(sb, reservation_key, "unassigned", actor);
      }
      return jsonResp({ status: "success" });
    }
    if (action === "autoAssign" && req.method === "POST") {
      const body = await req.json();
      const { reservations } = body;
      if (!reservations || !reservations.length) return jsonResp({ error: "reservations required" }, 400);
      const { data: cleanerData } = await sb.from("cleaners").select("id, name").eq("is_active", true).eq("role", "cleaner").order("name");
      const cls = cleanerData || [];
      if (cls.length === 0) return jsonResp({ error: "No cleaners available" }, 400);
      const { data: existingAssign } = await sb.from("cleaning_assignments").select("reservation_key, cleaner_id");
      const existingMap: Record<string, number> = {};
      (existingAssign || []).forEach((r: any) => { existingMap[r.reservation_key] = r.cleaner_id; });
      const load: Record<number, number> = {};
      cls.forEach((c: any) => { load[c.id] = 0; });
      Object.values(existingMap).forEach((cid: number) => { if (load[cid] !== undefined) load[cid]++; });
      let assigned = 0;
      for (const r of reservations) {
        if (existingMap[r.key]) continue;
        let minLoad = Infinity, minId = cls[0].id;
        for (const c of cls) { if (load[c.id] < minLoad) { minLoad = load[c.id]; minId = c.id; } }
        const { error } = await sb.from("cleaning_assignments").upsert({ reservation_key: r.key, cleaner_id: minId, assigned_at: new Date().toISOString() }, { onConflict: "reservation_key" });
        if (!error) {
          load[minId]++; assigned++;
          await addLog(sb, r.key, "auto_assigned", "system", { cleaner_id: minId });
        }
      }
      return jsonResp({ status: "success", assigned });
    }

    // ==================== CHECKLIST ====================
    if (action === "getChecklistTemplates") {
      const { data, error } = await sb.from("checklist_templates").select("*").order("name");
      if (error) throw error;
      return jsonResp({ status: "success", templates: data });
    }
    if (action === "getChecklistProgress") {
      const key = url.searchParams.get("key");
      if (!key) return jsonResp({ error: "key required" }, 400);
      const { data, error } = await sb.from("checklist_progress").select("item_name, is_done").eq("reservation_key", key);
      if (error) throw error;
      const map: Record<string, boolean> = {};
      (data || []).forEach((r: any) => { map[r.item_name] = r.is_done; });
      return jsonResp({ status: "success", progress: map });
    }
    if (action === "saveChecklistItem" && req.method === "POST") {
      const body = await req.json();
      const { reservation_key, item_name, is_done } = body;
      if (!reservation_key || !item_name || typeof is_done !== "boolean") return jsonResp({ error: "reservation_key, item_name, is_done required" }, 400);
      const { error } = await sb.from("checklist_progress").upsert({ reservation_key, item_name, is_done, updated_at: new Date().toISOString() }, { onConflict: "reservation_key,item_name" });
      if (error) throw error;
      return jsonResp({ status: "success" });
    }

    // ==================== NOTES ====================
    if (action === "getNotes") {
      const key = url.searchParams.get("key");
      if (!key) return jsonResp({ error: "key required" }, 400);
      const { data, error } = await sb.from("cleaning_notes").select("*").eq("reservation_key", key).order("created_at", { ascending: false });
      if (error) throw error;
      return jsonResp({ status: "success", notes: data });
    }
    if (action === "addNote" && req.method === "POST") {
      const body = await req.json();
      const { reservation_key, note_text, author } = body;
      if (!reservation_key || !note_text) return jsonResp({ error: "reservation_key and note_text required" }, 400);
      const { error } = await sb.from("cleaning_notes").insert({ reservation_key, note_text, author: author || null });
      if (error) throw error;
      await addLog(sb, reservation_key, "note_added", author, { text: note_text });
      return jsonResp({ status: "success" });
    }

    // ==================== PHOTOS ====================
    if (action === "getPhotos") {
      const key = url.searchParams.get("key");
      if (!key) return jsonResp({ error: "key required" }, 400);
      const { data, error } = await sb.from("cleaning_photos").select("id, reservation_key, photo_type, author, created_at").eq("reservation_key", key).order("created_at", { ascending: false });
      if (error) throw error;
      return jsonResp({ status: "success", photos: data });
    }
    if (action === "getPhoto") {
      const photoId = url.searchParams.get("id");
      if (!photoId) return jsonResp({ error: "id required" }, 400);
      const { data, error } = await sb.from("cleaning_photos").select("photo_path, photo_type").eq("id", Number(photoId)).single();
      if (error) throw error;
      const photoField = data.photo_path ? await getPhotoUrl(sb, data.photo_path) : null;
      return jsonResp({ status: "success", photo: { photo_data: photoField, photo_type: data.photo_type } });
    }
    if (action === "addPhoto" && req.method === "POST") {
      const body = await req.json();
      const { reservation_key, photo_data, photo_type, author } = body;
      if (!reservation_key || !photo_data) return jsonResp({ error: "reservation_key and photo_data required" }, 400);

      // Insert row d'abord pour avoir un ID
      const { data: inserted, error } = await sb.from("cleaning_photos").insert({
        reservation_key, photo_type: photo_type || "after", author: author || null,
      }).select().single();
      if (error) throw error;

      // Upload photo vers bucket
      const path = await uploadPhotoDataUrl(sb, photo_data, "cleaning_photos", "photo_data", inserted.id);
      if (!path) {
        await sb.from("cleaning_photos").delete().eq("id", inserted.id);
        return jsonResp({ error: "photo upload failed" }, 500);
      }
      await sb.from("cleaning_photos").update({ photo_path: path }).eq("id", inserted.id);
      // Note: legacy fallback to photo_data column removed (column dropped). If upload fails, photo is lost — return error to client.
      await addLog(sb, reservation_key, "photo_added", author);
      return jsonResp({ status: "success" });
    }

    // ==================== TIMER ====================
    if (action === "startTimer" && req.method === "POST") {
      const body = await req.json();
      const { reservation_key, cleaner_id } = body;
      if (!reservation_key) return jsonResp({ error: "reservation_key required" }, 400);
      const { error } = await sb.from("cleaning_timer").upsert({
        reservation_key, cleaner_id: cleaner_id || null,
        started_at: new Date().toISOString(),
        finished_at: null, duration_minutes: null,
        paused_at: null, total_pause_seconds: 0, pause_count: 0,
      }, { onConflict: "reservation_key" });
      if (error) throw error;
      await addLog(sb, reservation_key, "timer_started", null, { cleaner_id });
      return jsonResp({ status: "success" });
    }
    if (action === "pauseTimer" && req.method === "POST") {
      const body = await req.json();
      const { reservation_key } = body;
      if (!reservation_key) return jsonResp({ error: "reservation_key required" }, 400);
      const { data: t } = await sb.from("cleaning_timer").select("*").eq("reservation_key", reservation_key).single();
      if (!t || !t.started_at) return jsonResp({ error: "Timer not started" }, 400);
      if (t.finished_at) return jsonResp({ error: "Timer already stopped" }, 400);
      if (t.paused_at) return jsonResp({ error: "Timer already paused" }, 400);
      const { error } = await sb.from("cleaning_timer").update({ paused_at: new Date().toISOString() }).eq("reservation_key", reservation_key);
      if (error) throw error;
      await addLog(sb, reservation_key, "timer_paused", null);
      return jsonResp({ status: "success" });
    }
    if (action === "resumeTimer" && req.method === "POST") {
      const body = await req.json();
      const { reservation_key } = body;
      if (!reservation_key) return jsonResp({ error: "reservation_key required" }, 400);
      const { data: t } = await sb.from("cleaning_timer").select("*").eq("reservation_key", reservation_key).single();
      if (!t || !t.paused_at) return jsonResp({ error: "Timer not paused" }, 400);
      if (t.finished_at) return jsonResp({ error: "Timer already stopped" }, 400);
      const pauseMs = Date.now() - new Date(t.paused_at).getTime();
      const pauseSec = Math.max(0, Math.round(pauseMs / 1000));
      const newTotal = (t.total_pause_seconds || 0) + pauseSec;
      const newCount = (t.pause_count || 0) + 1;
      const { error } = await sb.from("cleaning_timer").update({
        paused_at: null, total_pause_seconds: newTotal, pause_count: newCount
      }).eq("reservation_key", reservation_key);
      if (error) throw error;
      await addLog(sb, reservation_key, "timer_resumed", null, { pause_seconds: pauseSec });
      return jsonResp({ status: "success" });
    }
    if (action === "stopTimer" && req.method === "POST") {
      const body = await req.json();
      const { reservation_key } = body;
      if (!reservation_key) return jsonResp({ error: "reservation_key required" }, 400);
      const { data: timer } = await sb.from("cleaning_timer").select("*").eq("reservation_key", reservation_key).single();
      if (!timer || !timer.started_at) return jsonResp({ error: "Timer not started" }, 400);
      const now = Date.now();
      const started = new Date(timer.started_at).getTime();
      let totalPauseSec = timer.total_pause_seconds || 0;
      let pauseCount = timer.pause_count || 0;
      if (timer.paused_at) {
        const pauseMs = now - new Date(timer.paused_at).getTime();
        totalPauseSec += Math.max(0, Math.round(pauseMs / 1000));
        pauseCount += 1;
      }
      const effectiveMs = now - started - totalPauseSec * 1000;
      const duration = Math.max(0, Math.round(effectiveMs / 60000));
      const { error } = await sb.from("cleaning_timer").update({
        finished_at: new Date().toISOString(),
        duration_minutes: duration,
        paused_at: null,
        total_pause_seconds: totalPauseSec,
        pause_count: pauseCount,
      }).eq("reservation_key", reservation_key);
      if (error) throw error;
      await addLog(sb, reservation_key, "timer_stopped", null, { duration_minutes: duration, pause_count: pauseCount, pause_seconds: totalPauseSec });
      return jsonResp({ status: "success", duration_minutes: duration, pause_count: pauseCount });
    }
    if (action === "getTimers") {
      const { data, error } = await sb.from("cleaning_timer").select("*");
      if (error) throw error;
      const map: Record<string, any> = {};
      (data || []).forEach((t: any) => { map[t.reservation_key] = t; });
      return jsonResp({ status: "success", timers: map });
    }

    // ==================== LOGS ====================
    if (action === "getLogs") {
      const key = url.searchParams.get("key");
      const limit = Number(url.searchParams.get("limit") || 50);
      let query = sb.from("cleaning_log").select("*").order("created_at", { ascending: false }).limit(limit);
      if (key) query = query.eq("reservation_key", key);
      const { data, error } = await query;
      if (error) throw error;
      return jsonResp({ status: "success", logs: data });
    }

    // ==================== CUSTOM PRICING ====================
    if (action === "setCustomPrice" && req.method === "POST") {
      const body = await req.json();
      const { listing_id, custom_price } = body;
      if (!listing_id) return jsonResp({ error: "listing_id required" }, 400);
      const { error } = await sb.from("listing_config").update({ custom_price: custom_price || null }).eq("listing_id", listing_id);
      if (error) throw error;
      return jsonResp({ status: "success" });
    }

    // ==================== APT NUMBER (manual override) ====================
    if (action === "setAptNumber" && req.method === "POST") {
      const body = await req.json();
      const { listing_id, apt_number } = body;
      if (!listing_id) return jsonResp({ error: "listing_id required" }, 400);
      const { error } = await sb.from("listing_config").update({ apt_number: apt_number || null }).eq("listing_id", listing_id);
      if (error) throw error;
      return jsonResp({ status: "success" });
    }

    // ==================== INVENTORY ====================
    if (action === "getInventory") {
      const listingId = url.searchParams.get("listingId");
      let query = sb.from("inventory_items").select("*").order("item_name");
      if (listingId) query = query.eq("listing_id", listingId);
      const { data, error } = await query;
      if (error) throw error;
      return jsonResp({ status: "success", items: data });
    }
    if (action === "saveInventoryItem" && req.method === "POST") {
      const body = await req.json();
      const { id, listing_id, item_name, current_qty, min_qty, unit } = body;
      if (id) {
        const { error } = await sb.from("inventory_items").update({ item_name, current_qty, min_qty, unit, updated_at: new Date().toISOString() }).eq("id", id);
        if (error) throw error;
      } else {
        const { error } = await sb.from("inventory_items").insert({ listing_id, item_name, current_qty: current_qty || 0, min_qty: min_qty || 1, unit: unit || "pcs" });
        if (error) throw error;
      }
      return jsonResp({ status: "success" });
    }
    if (action === "reportLowStock" && req.method === "POST") {
      const body = await req.json();
      const { inventory_item_id, reservation_key, reported_by, note } = body;
      const { error } = await sb.from("inventory_alerts").insert({ inventory_item_id, reservation_key, reported_by, note });
      if (error) throw error;
      return jsonResp({ status: "success" });
    }
    if (action === "getAlerts") {
      const { data, error } = await sb.from("inventory_alerts").select("*, inventory_items(item_name, listing_id)").eq("resolved", false).order("created_at", { ascending: false });
      if (error) throw error;
      return jsonResp({ status: "success", alerts: data });
    }

    // ==================== GUEST FEEDBACK ====================
    if (action === "saveGuestFeedback" && req.method === "POST") {
      const body = await req.json();
      const { reservation_key, listing_id, cleaner_id, source, rating, comment } = body;
      const { error } = await sb.from("guest_feedback").insert({ reservation_key, listing_id, cleaner_id, source: source || "manual", rating, comment });
      if (error) throw error;
      return jsonResp({ status: "success" });
    }
    if (action === "getGuestFeedback") {
      const cleanerId = url.searchParams.get("cleanerId");
      const listingId = url.searchParams.get("listingId");
      let query = sb.from("guest_feedback").select("*").order("created_at", { ascending: false }).limit(100);
      if (cleanerId) query = query.eq("cleaner_id", Number(cleanerId));
      if (listingId) query = query.eq("listing_id", listingId);
      const { data, error } = await query;
      if (error) throw error;
      return jsonResp({ status: "success", feedback: data });
    }

    // ==================== ISSUES ====================
    if (action === "reportIssue" && req.method === "POST") {
      const body = await req.json();
      const { reservation_key, listing_id, reported_by, cleaner_id, title, description, photo_data, severity, create_ticket } = body;
      if (!title) return jsonResp({ error: "title required" }, 400);
      const { data, error } = await sb.from("cleaning_issues").insert({
        reservation_key: reservation_key || null, listing_id: listing_id || null,
        reported_by: reported_by || null, cleaner_id: cleaner_id || null,
        title, description: description || null,
        severity: severity || "medium",
      }).select().single();
      if (error) throw error;
      // Phase 3 : upload photo vers bucket si data URL
      if (photo_data) {
        const issuePath = await uploadPhotoDataUrl(sb, photo_data, "cleaning_issues", "photo_data", data.id);
        if (issuePath) {
          await sb.from("cleaning_issues").update({ photo_path: issuePath }).eq("id", data.id);
        }
      }
      // Auto-create maintenance ticket if flagged
      if (create_ticket || severity === 'urgent' || severity === 'high') {
        const catMap: Record<string, string> = { 'ac': 'ac', 'plumb': 'plumbing', 'electr': 'electrical', 'water': 'plumbing', 'leak': 'plumbing', 'pipe': 'plumbing', 'drain': 'plumbing', 'power': 'electrical', 'light': 'electrical', 'pest': 'pest', 'paint': 'painting' };
        let category = 'general';
        const titleLower = (title + ' ' + (description || '')).toLowerCase();
        for (const [keyword, cat] of Object.entries(catMap)) {
          if (titleLower.includes(keyword)) { category = cat; break; }
        }
        // Get SLA
        const { data: slaData } = await sb.from("maintenance_sla").select("max_hours").eq("category", category).eq("priority", severity || 'medium').single();
        const slaHours = slaData ? slaData.max_hours : 72;
        const slaDeadline = new Date(Date.now() + slaHours * 3600000).toISOString();
        const { data: ticketData } = await sb.from("maintenance_tickets").insert({
          listing_id: listing_id || null, title: '[Cleaning] ' + title,
          description: description || null, category, priority: severity || 'medium',
          source: 'cleaning_issue', source_issue_id: data.id,
          reported_by: reported_by || (cleaner_id ? 'cleaner_' + cleaner_id : null),
          sla_deadline: slaDeadline,
        }).select().single();
        if (ticketData && photo_data) {
          const ticketPath = await uploadPhotoDataUrl(sb, photo_data, "maintenance_tickets", "photo_data", ticketData.id);
          if (ticketPath) {
            await sb.from("maintenance_tickets").update({ photo_path: ticketPath }).eq("id", ticketData.id);
          }
        }
      }
      if (reservation_key) await addLog(sb, reservation_key, "issue_reported", reported_by, { title, severity });
      return jsonResp({ status: "success", issue: data });
    }
    if (action === "getIssues") {
      const status_filter = url.searchParams.get("status") || "open";
      const listingId = url.searchParams.get("listingId");
      let query = sb.from("cleaning_issues").select("*").order("created_at", { ascending: false }).limit(100);
      if (status_filter !== "all") {
        if (status_filter === "open") query = query.in("status", ["open", "in_progress"]);
        else query = query.eq("status", status_filter);
      }
      if (listingId) query = query.eq("listing_id", listingId);
      const { data, error } = await query;
      if (error) throw error;
      return jsonResp({ status: "success", issues: data });
    }
    if (action === "updateIssue" && req.method === "POST") {
      const body = await req.json();
      const { id, status: newStatus, resolved_by } = body;
      if (!id) return jsonResp({ error: "id required" }, 400);
      const upd: any = {};
      if (newStatus) upd.status = newStatus;
      if (newStatus === "resolved") { upd.resolved_at = new Date().toISOString(); upd.resolved_by = resolved_by || null; }
      const { error } = await sb.from("cleaning_issues").update(upd).eq("id", id);
      if (error) throw error;
      return jsonResp({ status: "success" });
    }

    // ==================== RECURRING TASKS ====================
    if (action === "getRecurringTasks") {
      const { data, error } = await sb.from("recurring_tasks").select("*").eq("is_active", true).order("next_due_at", { ascending: true });
      if (error) throw error;
      return jsonResp({ status: "success", tasks: data });
    }
    if (action === "saveRecurringTask" && req.method === "POST") {
      const body = await req.json();
      const { id, listing_id, task_name, description, frequency_days, assigned_cleaner_id } = body;
      if (!task_name) return jsonResp({ error: "task_name required" }, 400);
      const nextDue = new Date(); nextDue.setDate(nextDue.getDate() + (frequency_days || 30));
      if (id) {
        const { error } = await sb.from("recurring_tasks").update({ listing_id, task_name, description, frequency_days, assigned_cleaner_id: assigned_cleaner_id || null }).eq("id", id);
        if (error) throw error;
      } else {
        const { error } = await sb.from("recurring_tasks").insert({ listing_id: listing_id || null, task_name, description: description || null, frequency_days: frequency_days || 30, assigned_cleaner_id: assigned_cleaner_id || null, next_due_at: nextDue.toISOString() });
        if (error) throw error;
      }
      return jsonResp({ status: "success" });
    }
    if (action === "completeRecurringTask" && req.method === "POST") {
      const body = await req.json();
      const { id, actor } = body;
      if (!id) return jsonResp({ error: "id required" }, 400);
      const { data: task } = await sb.from("recurring_tasks").select("*").eq("id", id).single();
      if (!task) return jsonResp({ error: "Task not found" }, 404);
      const nextDue = new Date(); nextDue.setDate(nextDue.getDate() + (task.frequency_days || 30));
      const { error } = await sb.from("recurring_tasks").update({ last_done_at: new Date().toISOString(), next_due_at: nextDue.toISOString() }).eq("id", id);
      if (error) throw error;
      await addLog(sb, "recurring_" + id, "recurring_completed", actor, { task_name: task.task_name });
      return jsonResp({ status: "success" });
    }
    if (action === "deleteRecurringTask" && req.method === "POST") {
      const body = await req.json();
      if (!body.id) return jsonResp({ error: "id required" }, 400);
      const { error } = await sb.from("recurring_tasks").update({ is_active: false }).eq("id", body.id);
      if (error) throw error;
      return jsonResp({ status: "success" });
    }

    // ==================== MAINTENANCE TICKETS ====================
    if (action === "getMaintenanceTickets") {
      const status_filter = url.searchParams.get("status") || "open";
      const listingId = url.searchParams.get("listingId");
      const techId = url.searchParams.get("technicianId");
      let query = sb.from("maintenance_tickets").select("*").order("created_at", { ascending: false }).limit(200);
      if (status_filter === "open") query = query.in("status", ["open", "assigned", "in_progress", "waiting_parts"]);
      else if (status_filter !== "all") query = query.eq("status", status_filter);
      if (listingId) query = query.eq("listing_id", listingId);
      if (techId) query = query.eq("assigned_technician_id", Number(techId));
      const [ticketsRes, listingsRes] = await Promise.all([
        query,
        sb.from("listing_config").select("listing_id, listing_name")
      ]);
      if (ticketsRes.error) throw ticketsRes.error;
      const listingMap: Record<string, string> = {};
      (listingsRes.data || []).forEach((l: any) => {
        if (l.listing_id && l.listing_name) listingMap[String(l.listing_id)] = l.listing_name;
      });
      const tickets = (ticketsRes.data || []).map((t: any) => ({
        ...t,
        listing_name: t.listing_id ? (listingMap[String(t.listing_id)] || null) : null,
      }));
      return jsonResp({ status: "success", tickets });
    }
    if (action === "createTicket" && req.method === "POST") {
      const body = await req.json();
      const { listing_id, equipment_id, title, description, category, priority, assigned_vendor_id, assigned_technician_id, reported_by, photo_data, estimated_cost } = body;
      if (!title) return jsonResp({ error: "title required" }, 400);
      // Get SLA deadline
      const cat = category || 'general';
      const pri = priority || 'medium';
      const { data: slaData } = await sb.from("maintenance_sla").select("max_hours").eq("category", cat).eq("priority", pri).single();
      const slaHours = slaData ? slaData.max_hours : 72;
      const slaDeadline = new Date(Date.now() + slaHours * 3600000).toISOString();
      const { data, error } = await sb.from("maintenance_tickets").insert({
        listing_id: listing_id || null, equipment_id: equipment_id || null,
        title, description: description || null, category: cat, priority: pri,
        assigned_vendor_id: assigned_vendor_id || null, assigned_technician_id: assigned_technician_id || null,
        reported_by: reported_by || null,
        estimated_cost: estimated_cost || null, sla_deadline: slaDeadline,
        status: assigned_technician_id ? 'assigned' : 'open',
      }).select().single();
      if (error) throw error;
      if (photo_data && data) {
        const p = await uploadPhotoDataUrl(sb, photo_data, "maintenance_tickets", "photo_data", data.id);
        if (p) await sb.from("maintenance_tickets").update({ photo_path: p }).eq("id", data.id);
      }
      await addLog(sb, 'ticket_' + data.id, 'ticket_created', reported_by, { title, category: cat, priority: pri });
      return jsonResp({ status: "success", ticket: data });
    }
    if (action === "updateTicket" && req.method === "POST") {
      const body = await req.json();
      const { id, status: newStatus, assigned_vendor_id, assigned_technician_id, resolution_notes, resolution_photo, actual_cost, actor } = body;
      if (!id) return jsonResp({ error: "id required" }, 400);
      const upd: any = {};
      if (newStatus) {
        upd.status = newStatus;
        if (newStatus === 'in_progress' && !upd.started_at) upd.started_at = new Date().toISOString();
        if (newStatus === 'resolved') upd.resolved_at = new Date().toISOString();
        if (newStatus === 'closed') upd.closed_at = new Date().toISOString();
      }
      if (assigned_vendor_id !== undefined) upd.assigned_vendor_id = assigned_vendor_id;
      if (assigned_technician_id !== undefined) { upd.assigned_technician_id = assigned_technician_id; if (!upd.status) upd.status = 'assigned'; }
      if (resolution_notes) upd.resolution_notes = resolution_notes;
      if (resolution_photo) {
        const rp = await uploadPhotoDataUrl(sb, resolution_photo, "maintenance_tickets", "resolution_photo", id);
        if (rp) upd.resolution_photo_path = rp;
        // Note: legacy fallback to resolution_photo column removed (column dropped).
      }
      if (actual_cost !== undefined) upd.actual_cost = actual_cost;
      const { error } = await sb.from("maintenance_tickets").update(upd).eq("id", id);
      if (error) throw error;
      // Log cost if resolved with actual_cost
      if (actual_cost && newStatus === 'resolved') {
        const { data: ticket } = await sb.from("maintenance_tickets").select("listing_id, category, title, assigned_vendor_id").eq("id", id).single();
        if (ticket) {
          await sb.from("maintenance_costs").insert({
            ticket_id: id, listing_id: ticket.listing_id, category: ticket.category,
            description: ticket.title, amount: actual_cost, vendor_id: ticket.assigned_vendor_id,
          });
        }
      }
      await addLog(sb, 'ticket_' + id, 'ticket_updated', actor, { status: newStatus });
      return jsonResp({ status: "success" });
    }

    // ==================== VENDORS ====================
    if (action === "getVendors") {
      const { data, error } = await sb.from("vendors").select("*").eq("is_active", true).order("name");
      if (error) throw error;
      return jsonResp({ status: "success", vendors: data });
    }
    if (action === "saveVendor" && req.method === "POST") {
      const body = await req.json();
      const { id, name, phone, email, specialty, hourly_rate, notes } = body;
      if (!name || !specialty) return jsonResp({ error: "name and specialty required" }, 400);
      if (id) {
        const { error } = await sb.from("vendors").update({ name, phone, email, specialty, hourly_rate, notes }).eq("id", id);
        if (error) throw error;
      } else {
        const { error } = await sb.from("vendors").insert({ name, phone: phone || null, email: email || null, specialty, hourly_rate: hourly_rate || null, notes: notes || null });
        if (error) throw error;
      }
      return jsonResp({ status: "success" });
    }
    if (action === "deleteVendor" && req.method === "POST") {
      const body = await req.json();
      if (!body.id) return jsonResp({ error: "id required" }, 400);
      const { error } = await sb.from("vendors").update({ is_active: false }).eq("id", body.id);
      if (error) throw error;
      return jsonResp({ status: "success" });
    }

    // ==================== EQUIPMENT ====================
    if (action === "getEquipment") {
      const listingId = url.searchParams.get("listingId");
      let query = sb.from("equipment").select("*").order("name");
      if (listingId) query = query.eq("listing_id", listingId);
      const { data, error } = await query;
      if (error) throw error;
      return jsonResp({ status: "success", equipment: data });
    }
    if (action === "saveEquipment" && req.method === "POST") {
      const body = await req.json();
      const { id, listing_id, name, category, brand, model, serial_number, install_date, warranty_until, service_interval_days, condition, notes } = body;
      if (!name || !listing_id) return jsonResp({ error: "name and listing_id required" }, 400);
      const nextService = install_date ? new Date(new Date(install_date).getTime() + (service_interval_days || 180) * 86400000).toISOString().split('T')[0] : null;
      if (id) {
        const { error } = await sb.from("equipment").update({ listing_id, name, category, brand, model, serial_number, install_date, warranty_until, service_interval_days, condition, notes, next_service: nextService }).eq("id", id);
        if (error) throw error;
      } else {
        const { error } = await sb.from("equipment").insert({ listing_id, name, category: category || 'other', brand, model, serial_number, install_date, warranty_until, service_interval_days: service_interval_days || 180, condition: condition || 'good', notes, next_service: nextService });
        if (error) throw error;
      }
      return jsonResp({ status: "success" });
    }

    // ==================== MAINTENANCE COSTS ====================
    if (action === "getMaintenanceCosts") {
      const listingId = url.searchParams.get("listingId");
      const month = url.searchParams.get("month"); // YYYY-MM
      let query = sb.from("maintenance_costs").select("*").order("date", { ascending: false }).limit(200);
      if (listingId) query = query.eq("listing_id", listingId);
      if (month) { query = query.gte("date", month + "-01").lte("date", month + "-31"); }
      const { data, error } = await query;
      if (error) throw error;
      return jsonResp({ status: "success", costs: data });
    }
    if (action === "addMaintenanceCost" && req.method === "POST") {
      const body = await req.json();
      const { ticket_id, listing_id, category, description, amount, vendor_id, receipt_photo, date } = body;
      if (!amount) return jsonResp({ error: "amount required" }, 400);
      const { data: costRow, error } = await sb.from("maintenance_costs").insert({
        ticket_id, listing_id, category, description, amount, vendor_id,
        date: date || new Date().toISOString().split('T')[0],
      }).select().single();
      if (error) throw error;
      if (receipt_photo && costRow) {
        const p = await uploadPhotoDataUrl(sb, receipt_photo, "maintenance_costs", "receipt_photo", costRow.id);
        if (p) {
          await sb.from("maintenance_costs").update({ receipt_photo_path: p }).eq("id", costRow.id);
        }
        // Note: legacy fallback to receipt_photo column removed.
      }
      return jsonResp({ status: "success" });
    }

    // ==================== PREVENTIVE MAINTENANCE ====================
    if (action === "getPreventiveMaintenance") {
      const { data, error } = await sb.from("preventive_maintenance").select("*").eq("is_active", true).order("next_due_at");
      if (error) throw error;
      return jsonResp({ status: "success", schedules: data });
    }
    if (action === "savePreventiveMaintenance" && req.method === "POST") {
      const body = await req.json();
      const { id, listing_id, equipment_id, task_name, description, category, frequency_days, assigned_vendor_id, estimated_cost } = body;
      if (!task_name) return jsonResp({ error: "task_name required" }, 400);
      const nextDue = new Date(); nextDue.setDate(nextDue.getDate() + (frequency_days || 90));
      if (id) {
        const { error } = await sb.from("preventive_maintenance").update({ listing_id, equipment_id, task_name, description, category, frequency_days, assigned_vendor_id, estimated_cost }).eq("id", id);
        if (error) throw error;
      } else {
        const { error } = await sb.from("preventive_maintenance").insert({ listing_id, equipment_id, task_name, description, category, frequency_days: frequency_days || 90, assigned_vendor_id, estimated_cost, next_due_at: nextDue.toISOString() });
        if (error) throw error;
      }
      return jsonResp({ status: "success" });
    }
    if (action === "completePreventive" && req.method === "POST") {
      const body = await req.json();
      const { id, actual_cost, notes, actor } = body;
      if (!id) return jsonResp({ error: "id required" }, 400);
      const { data: pm } = await sb.from("preventive_maintenance").select("*").eq("id", id).single();
      if (!pm) return jsonResp({ error: "Not found" }, 404);
      const nextDue = new Date(); nextDue.setDate(nextDue.getDate() + (pm.frequency_days || 90));
      await sb.from("preventive_maintenance").update({ last_done_at: new Date().toISOString(), next_due_at: nextDue.toISOString() }).eq("id", id);
      // Log cost
      if (actual_cost) {
        await sb.from("maintenance_costs").insert({ listing_id: pm.listing_id, category: pm.category || 'preventive', description: 'Preventive: ' + pm.task_name, amount: actual_cost, vendor_id: pm.assigned_vendor_id });
      }
      // Update equipment last_service if linked
      if (pm.equipment_id) {
        await sb.from("equipment").update({ last_service: new Date().toISOString().split('T')[0] }).eq("id", pm.equipment_id);
      }
      await addLog(sb, 'preventive_' + id, 'preventive_completed', actor, { task_name: pm.task_name });
      return jsonResp({ status: "success" });
    }

    // ==================== MAINTENANCE SLA ====================
    if (action === "getSLA") {
      const { data, error } = await sb.from("maintenance_sla").select("*").order("category").order("priority");
      if (error) throw error;
      return jsonResp({ status: "success", sla: data });
    }

    // ==================== PROPERTY HEALTH SCORE ====================
    if (action === "getPropertyHealth") {
      const listingId = url.searchParams.get("listingId");
      if (!listingId) return jsonResp({ error: "listingId required" }, 400);
      const [ticketsRes, equipRes, costsRes, feedbackRes] = await Promise.all([
        sb.from("maintenance_tickets").select("id, priority, status, created_at").eq("listing_id", listingId),
        sb.from("equipment").select("id, condition, next_service").eq("listing_id", listingId),
        sb.from("maintenance_costs").select("amount").eq("listing_id", listingId),
        sb.from("guest_feedback").select("rating").eq("listing_id", listingId),
      ]);
      const tickets = ticketsRes.data || [];
      const equip = equipRes.data || [];
      const costs = costsRes.data || [];
      const feedback = feedbackRes.data || [];
      const openTickets = tickets.filter((t: any) => ['open','assigned','in_progress','waiting_parts'].includes(t.status));
      const urgentOpen = openTickets.filter((t: any) => t.priority === 'urgent' || t.priority === 'high');
      const totalCost = costs.reduce((s: number, c: any) => s + Number(c.amount), 0);
      const avgRating = feedback.length > 0 ? feedback.reduce((s: number, f: any) => s + f.rating, 0) / feedback.length : 0;
      const overdueEquip = equip.filter((e: any) => e.next_service && e.next_service < new Date().toISOString().split('T')[0]);
      // Score: 100 base, deduct for issues
      let score = 100;
      score -= openTickets.length * 5;
      score -= urgentOpen.length * 10;
      score -= overdueEquip.length * 8;
      if (avgRating > 0 && avgRating < 4) score -= (4 - avgRating) * 10;
      score = Math.max(0, Math.min(100, score));
      return jsonResp({ status: "success", health: { score, openTickets: openTickets.length, urgentOpen: urgentOpen.length, totalEquipment: equip.length, overdueService: overdueEquip.length, totalCost, avgRating: Math.round(avgRating * 10) / 10, totalFeedback: feedback.length } });
    }

    // ==================== TICKET COMMENTS ====================
    if (action === "getTicketComments") {
      const ticketId = url.searchParams.get("ticketId");
      if (!ticketId) return jsonResp({ error: "ticketId required" }, 400);
      const { data, error } = await sb.from("ticket_comments").select("*").eq("ticket_id", Number(ticketId)).order("created_at", { ascending: true });
      if (error) throw error;
      return jsonResp({ status: "success", comments: data });
    }
    if (action === "addTicketComment" && req.method === "POST") {
      const body = await req.json();
      const { ticket_id, author, comment, photo_data } = body;
      if (!ticket_id || !comment) return jsonResp({ error: "ticket_id and comment required" }, 400);
      const { data, error } = await sb.from("ticket_comments").insert({ ticket_id, author: author || null, comment }).select().single();
      if (error) throw error;
      if (photo_data) {
        const p = await uploadPhotoDataUrl(sb, photo_data, "ticket_comments", "photo_data", data.id);
        if (p) await sb.from("ticket_comments").update({ photo_path: p }).eq("id", data.id);
      }
      return jsonResp({ status: "success", comment: data });
    }

    // ==================== RECURRING ISSUES ====================
    if (action === "getRecurringIssues") {
      const { data, error } = await sb.from("maintenance_tickets").select("listing_id, category, title, priority, status, created_at").order("created_at", { ascending: false });
      if (error) throw error;
      // Detect patterns: same listing+category with 2+ tickets in last 90 days
      const patterns: Record<string, any[]> = {};
      (data || []).forEach((t: any) => {
        const key = (t.listing_id || 'none') + '_' + t.category;
        if (!patterns[key]) patterns[key] = [];
        patterns[key].push(t);
      });
      const recurring: any[] = [];
      const cutoff = Date.now() - 90 * 86400000;
      Object.entries(patterns).forEach(([key, tickets]) => {
        const recent = tickets.filter((t: any) => new Date(t.created_at).getTime() > cutoff);
        if (recent.length >= 2) {
          recurring.push({ listing_id: recent[0].listing_id, category: recent[0].category, count: recent.length, total_all_time: tickets.length, recent_tickets: recent.slice(0, 5) });
        }
      });
      recurring.sort((a, b) => b.count - a.count);
      return jsonResp({ status: "success", recurring });
    }

    // ==================== APP CONFIG ====================
    if (action === "getConfig") {
      const key = url.searchParams.get("key");
      if (key) {
        const { data, error } = await sb.from("app_config").select("value").eq("key", key).single();
        if (error) return jsonResp({ status: "success", value: null });
        return jsonResp({ status: "success", value: data.value });
      }
      const { data, error } = await sb.from("app_config").select("*");
      if (error) throw error;
      const config: Record<string, string> = {};
      (data || []).forEach((r: any) => { config[r.key] = r.value; });
      return jsonResp({ status: "success", config });
    }
    if (action === "setConfig" && req.method === "POST") {
      const body = await req.json();
      const { key, value } = body;
      if (!key) return jsonResp({ error: "key required" }, 400);
      const { error } = await sb.from("app_config").upsert({ key, value: String(value), updated_at: new Date().toISOString() }, { onConflict: "key" });
      if (error) throw error;
      return jsonResp({ status: "success" });
    }

    // ==================== AUTOPILOT ====================
    if (action === "runAutopilot") {
      // 1. Check if auto-send is enabled
      const { data: configData } = await sb.from("app_config").select("value").eq("key", "auto_send_cleaners").single();
      const autoSendEnabled = configData ? configData.value === 'true' : true;

      // 2. Get today's date
      const today = new Date().toISOString().split('T')[0];

      // 3. Fetch today's checkouts from Hostaway
      const token = await getAccessToken();
      const authHeaders = { "Authorization": "Bearer " + token, "Content-Type": "application/json" };
      const depUrl = API_BASE + "/reservations?departureStartDate=" + today + "&departureEndDate=" + today + "&limit=200&sortOrder=departureDate&orderDirection=asc";
      const depResponse = await fetch(depUrl, { headers: authHeaders });
      if (!depResponse.ok) return jsonResp({ error: "Hostaway API error" }, 500);
      const depData = await depResponse.json();
      const validStatuses = ['new','modified','confirmed','ownerStay','reserved'];
      const reservations = (depData.result || []).filter((r: any) => validStatuses.includes(r.status)).map((r: any) => ({
        key: r.departureDate + '_' + (r.guestName || ((r.guestFirstName || '') + ' ' + (r.guestLastName || '')).trim()),
        listing: r.listingName || '',
        listingId: String(r.listingMapId || r.listingId || ''),
        guest: r.guestName || ((r.guestFirstName || '') + ' ' + (r.guestLastName || '')).trim(),
      }));

      if (reservations.length === 0) {
        return jsonResp({ status: "success", message: "No checkouts today", checkouts: 0, assigned: 0, notified: [] });
      }

      // 4. Get current assignments + cleaners
      const { data: assignData } = await sb.from("cleaning_assignments").select("reservation_key, cleaner_id");
      const existingMap: Record<string, number> = {};
      (assignData || []).forEach((r: any) => { existingMap[r.reservation_key] = r.cleaner_id; });

      const { data: cleanerData } = await sb.from("cleaners").select("*").eq("is_active", true).eq("role", "cleaner").order("name");
      const cls = cleanerData || [];

      // 5. Auto-assign unassigned
      const unassigned = reservations.filter((r: any) => !existingMap[r.key]);
      let newlyAssigned = 0;
      if (unassigned.length > 0 && cls.length > 0) {
        const load: Record<number, number> = {};
        cls.forEach((c: any) => { load[c.id] = 0; });
        Object.values(existingMap).forEach((cid: number) => { if (load[cid] !== undefined) load[cid]++; });
        for (const r of unassigned) {
          let minLoad = Infinity, minId = cls[0].id;
          for (const c of cls) { if (load[c.id] < minLoad) { minLoad = load[c.id]; minId = c.id; } }
          const { error } = await sb.from("cleaning_assignments").upsert({ reservation_key: r.key, cleaner_id: minId, assigned_at: new Date().toISOString() }, { onConflict: "reservation_key" });
          if (!error) { load[minId]++; existingMap[r.key] = minId; newlyAssigned++; }
        }
      }

      // 6. Build WhatsApp messages per cleaner
      const notified: any[] = [];
      const cleanerTasks: Record<number, any[]> = {};
      reservations.forEach((r: any) => {
        const cid = existingMap[r.key];
        if (cid) { if (!cleanerTasks[cid]) cleanerTasks[cid] = []; cleanerTasks[cid].push(r); }
      });

      for (const c of cls) {
        const tasks = cleanerTasks[c.id];
        if (!tasks || tasks.length === 0) continue;
        let msg = '\uD83C\uDFE0 Hey ' + c.name + '! Your cleanings for today:\n\n';
        tasks.forEach((r: any, i: number) => { msg += (i + 1) + '. ' + r.listing + ' (' + r.guest + ')\n'; });
        msg += '\nTotal: ' + tasks.length + ' cleanings. Good luck! \uD83D\uDCAA';
        const phone = c.phone ? c.phone.replace(/[^0-9+]/g, '') : null;
        const waLink = phone ? 'https://wa.me/' + phone + '?text=' + encodeURIComponent(msg) : null;
        notified.push({ cleaner: c.name, phone: c.phone, tasks: tasks.length, message: msg, waLink, autoSendEnabled });
      }

      return jsonResp({
        status: "success",
        checkouts: reservations.length,
        alreadyAssigned: reservations.length - unassigned.length,
        newlyAssigned,
        autoSendEnabled,
        notified,
      });
    }

    // ==================== PROPERTY PROFILES ====================
    if (action === "getPropertyProfiles") {
      const listingId = url.searchParams.get("listingId");
      if (listingId) {
        const { data, error } = await sb.from("property_profiles").select("*").eq("listing_id", listingId).single();
        if (error && error.code !== 'PGRST116') throw error;
        return jsonResp({ status: "success", profile: data || null });
      }
      const { data, error } = await sb.from("property_profiles").select("*").order("listing_name");
      if (error) throw error;
      return jsonResp({ status: "success", profiles: data || [] });
    }
    if (action === "savePropertyProfile" && req.method === "POST") {
      const body = await req.json();
      const { listing_id, listing_name, access_code, wifi_name, wifi_password, special_instructions, contact_name, contact_phone, parking_info, trash_instructions, checkout_instructions, notes } = body;
      if (!listing_id) return jsonResp({ error: "listing_id required" }, 400);
      const { error } = await sb.from("property_profiles").upsert({
        listing_id, listing_name: listing_name || null,
        access_code: access_code || null, wifi_name: wifi_name || null, wifi_password: wifi_password || null,
        special_instructions: special_instructions || null, contact_name: contact_name || null,
        contact_phone: contact_phone || null, parking_info: parking_info || null,
        trash_instructions: trash_instructions || null, checkout_instructions: checkout_instructions || null,
        notes: notes || null, updated_at: new Date().toISOString(),
      }, { onConflict: "listing_id" });
      if (error) throw error;
      return jsonResp({ status: "success" });
    }

    // ==================== DASHBOARD KPIs ====================
    if (action === "getDashboardKPIs") {
      const month = url.searchParams.get("month"); // YYYY-MM
      const [timerRes, assignRes, doneRes, cleanerRes, ticketRes] = await Promise.all([
        sb.from("cleaning_timer").select("reservation_key, cleaner_id, started_at, finished_at, duration_minutes").not("duration_minutes", "is", null),
        sb.from("cleaning_assignments").select("reservation_key, cleaner_id"),
        sb.from("menage_done").select("reservation_key, done, updated_at"),
        sb.from("cleaners").select("id, name, color, role").eq("is_active", true),
        sb.from("maintenance_tickets").select("id, status, priority, category, created_at, resolved_at"),
      ]);
      const timers = timerRes.data || [];
      const assigns = assignRes.data || [];
      const dones = doneRes.data || [];
      const clnrs = cleanerRes.data || [];
      const tickets = ticketRes.data || [];

      // Global avg cleaning time
      const durations = timers.map((t: any) => t.duration_minutes).filter((d: number) => d > 0 && d < 480);
      const avgCleaningTime = durations.length > 0 ? Math.round(durations.reduce((a: number, b: number) => a + b, 0) / durations.length) : 0;

      // Per-cleaner performance
      const assignMap: Record<string, number> = {};
      assigns.forEach((a: any) => { assignMap[a.reservation_key] = a.cleaner_id; });
      const cleanerPerf: any[] = clnrs.filter((c: any) => c.role === 'cleaner').map((c: any) => {
        const cTimers = timers.filter((t: any) => assignMap[t.reservation_key] === c.id);
        const cDurations = cTimers.map((t: any) => t.duration_minutes).filter((d: number) => d > 0 && d < 480);
        const cDone = dones.filter((d: any) => d.done && assignMap[d.reservation_key] === c.id);
        const avgTime = cDurations.length > 0 ? Math.round(cDurations.reduce((a: number, b: number) => a + b, 0) / cDurations.length) : 0;
        const fastest = cDurations.length > 0 ? Math.min(...cDurations) : 0;
        const slowest = cDurations.length > 0 ? Math.max(...cDurations) : 0;
        return { id: c.id, name: c.name, color: c.color, totalCleanings: cDone.length, avgTime, fastest, slowest, timerCount: cDurations.length };
      });

      // Maintenance summary
      const openTickets = tickets.filter((t: any) => ['open','assigned','in_progress','waiting_parts'].includes(t.status));
      const resolvedThisMonth = month ? tickets.filter((t: any) => t.status === 'resolved' && t.resolved_at && t.resolved_at.startsWith(month)) : [];
      const avgResolutionTime = (() => {
        const resolved = tickets.filter((t: any) => t.resolved_at && t.created_at);
        if (resolved.length === 0) return 0;
        const total = resolved.reduce((sum: number, t: any) => {
          return sum + (new Date(t.resolved_at).getTime() - new Date(t.created_at).getTime()) / 3600000;
        }, 0);
        return Math.round(total / resolved.length);
      })();

      // Completion rate trends (last 7 days)
      const last7: any[] = [];
      for (let i = 6; i >= 0; i--) {
        const d = new Date(); d.setDate(d.getDate() - i);
        const ds = d.toISOString().split('T')[0];
        const dayDones = dones.filter((r: any) => r.done && r.updated_at && r.updated_at.startsWith(ds));
        last7.push({ date: ds, completions: dayDones.length });
      }

      return jsonResp({
        status: "success",
        kpis: {
          avgCleaningTime,
          totalTimerSessions: durations.length,
          cleanerPerformance: cleanerPerf,
          openMaintenanceTickets: openTickets.length,
          resolvedThisMonth: resolvedThisMonth.length,
          avgResolutionHours: avgResolutionTime,
          last7DaysCompletions: last7,
        },
      });
    }

    // ==================== BULK LOAD ====================
    if (action === "getAllData") {
      const [doneRes, assignRes, cleanerRes, templateRes, listingRes, timerRes, issueRes, recurRes, ticketRes, vendorRes, equipRes, prevRes, profileRes, cancelledRes, extraRes] = await Promise.all([
        sb.from("menage_done").select("reservation_key, done"),
        sb.from("cleaning_assignments").select("reservation_key, cleaner_id"),
        sb.from("cleaners").select("*").eq("is_active", true).order("name"),
        sb.from("checklist_templates").select("*").order("name"),
        sb.from("listing_config").select("listing_id, listing_name, bedrooms, price, custom_price, unit_type, apt_number, internal_name"),
        sb.from("cleaning_timer").select("*"),
        sb.from("cleaning_issues").select("*").in("status", ["open", "in_progress"]).order("created_at", { ascending: false }),
        sb.from("recurring_tasks").select("*").eq("is_active", true).order("next_due_at"),
        // Active tickets only (anything not closed). The dedicated /refreshMaintenance flow
        // fetches resolved/cancelled separately into resolvedTickets. Returning everything
        // here was the root cause of resolved tickets leaking into the "Open" view.
        sb.from("maintenance_tickets").select("*").not("status", "in", "(resolved,cancelled)").order("created_at", { ascending: false }).limit(200),
        sb.from("vendors").select("*").eq("is_active", true).order("name"),
        sb.from("equipment").select("*").order("listing_id, name"),
        sb.from("preventive_maintenance").select("*").eq("is_active", true).order("next_due_at"),
        sb.from("property_profiles").select("*"),
        sb.from("cleaning_cancelled").select("reservation_key, reason, cancelled_by, cancelled_at"),
        sb.from("extra_cleanings").select("*").gte("cleaning_date", new Date(Date.now() - 30*86400000).toISOString().split('T')[0]).lte("cleaning_date", new Date(Date.now() + 60*86400000).toISOString().split('T')[0]).order("cleaning_date"),
      ]);
      const cancelledMap: Record<string, any> = {};
      (cancelledRes.data || []).forEach((r: any) => { cancelledMap[r.reservation_key] = { reason: r.reason, cancelled_by: r.cancelled_by, cancelled_at: r.cancelled_at }; });
      const doneMap: Record<string, boolean> = {};
      (doneRes.data || []).forEach((r: any) => { doneMap[r.reservation_key] = r.done; });
      const assignMap: Record<string, number> = {};
      (assignRes.data || []).forEach((r: any) => { assignMap[r.reservation_key] = r.cleaner_id; });
      const listingPrices: Record<string, any> = {};
      (listingRes.data || []).forEach((r: any) => { listingPrices[r.listing_id] = { bedrooms: r.bedrooms, price: r.price, custom_price: r.custom_price, listing_name: r.listing_name, unit_type: r.unit_type, apt_number: r.apt_number, internal_name: r.internal_name }; });
      const timerMap: Record<string, any> = {};
      (timerRes.data || []).forEach((t: any) => { timerMap[t.reservation_key] = t; });
      const profileMap: Record<string, any> = {};
      (profileRes.data || []).forEach((p: any) => { profileMap[p.listing_id] = p; });
      return jsonResp({
        status: "success", done: doneMap, assignments: assignMap,
        cleaners: cleanerRes.data || [], templates: templateRes.data || [],
        listingPrices, timers: timerMap,
        issues: issueRes.data || [], recurringTasks: recurRes.data || [],
        maintenanceTickets: ticketRes.data || [], vendors: vendorRes.data || [],
        equipment: equipRes.data || [], preventiveMaintenance: prevRes.data || [],
        propertyProfiles: profileMap,
        cancelled: cancelledMap,
        extraCleanings: extraRes.data || [],
      });
    }

    // ========== PROPERTY HEATMAP ==========
    if (action === "getPropertyHeatmap") {
      const [ticketsRes, costsRes, timerRes, assignRes, feedbackRes, listingRes] = await Promise.all([
        sb.from("maintenance_tickets").select("id, listing_id, status, priority, created_at, resolved_at"),
        sb.from("maintenance_costs").select("listing_id, amount"),
        sb.from("cleaning_timer").select("reservation_key, duration_minutes").not("duration_minutes", "is", null),
        sb.from("cleaning_assignments").select("reservation_key, cleaner_id"),
        sb.from("guest_feedback").select("listing_id, rating"),
        sb.from("listing_config").select("listing_id, listing_name, bedrooms, price, custom_price"),
      ]);
      const byListing: Record<string, any> = {};
      (listingRes.data || []).forEach((l: any) => {
        byListing[l.listing_id] = {
          listing_id: l.listing_id,
          listing_name: l.listing_name || l.listing_id,
          bedrooms: l.bedrooms,
          price: l.custom_price || l.price,
          open_tickets: 0,
          urgent_tickets: 0,
          total_tickets: 0,
          avg_resolution_hours: null,
          total_cost: 0,
          avg_rating: null,
          feedback_count: 0,
          avg_cleaning_minutes: null,
          cleaning_count: 0,
          score: 100,
        };
      });
      const resolvedDurations: Record<string, number[]> = {};
      (ticketsRes.data || []).forEach((t: any) => {
        const lid = t.listing_id;
        if (!lid || !byListing[lid]) return;
        byListing[lid].total_tickets++;
        if (['open','assigned','in_progress','waiting_parts'].includes(t.status)) {
          byListing[lid].open_tickets++;
          if (['urgent','high'].includes(t.priority)) byListing[lid].urgent_tickets++;
        }
        if (t.resolved_at && t.created_at) {
          const hours = (new Date(t.resolved_at).getTime() - new Date(t.created_at).getTime()) / 3600000;
          if (!resolvedDurations[lid]) resolvedDurations[lid] = [];
          resolvedDurations[lid].push(hours);
        }
      });
      Object.entries(resolvedDurations).forEach(([lid, arr]) => {
        if (byListing[lid] && arr.length > 0) {
          byListing[lid].avg_resolution_hours = Math.round(arr.reduce((a, b) => a + b, 0) / arr.length);
        }
      });
      (costsRes.data || []).forEach((c: any) => {
        if (c.listing_id && byListing[c.listing_id]) byListing[c.listing_id].total_cost += Number(c.amount || 0);
      });
      const fbByListing: Record<string, number[]> = {};
      (feedbackRes.data || []).forEach((f: any) => {
        const lid = f.listing_id;
        if (!lid || !byListing[lid] || f.rating == null) return;
        if (!fbByListing[lid]) fbByListing[lid] = [];
        fbByListing[lid].push(Number(f.rating));
      });
      Object.entries(fbByListing).forEach(([lid, arr]) => {
        if (byListing[lid] && arr.length > 0) {
          byListing[lid].avg_rating = Math.round(arr.reduce((a, b) => a + b, 0) / arr.length * 10) / 10;
          byListing[lid].feedback_count = arr.length;
        }
      });
      Object.values(byListing).forEach((l: any) => {
        let s = 100;
        s -= l.open_tickets * 5;
        s -= l.urgent_tickets * 10;
        s -= Math.floor(l.total_cost / 500);
        if (l.avg_rating != null && l.avg_rating < 4) s -= Math.round((4 - l.avg_rating) * 10);
        l.score = Math.max(0, Math.min(100, s));
      });
      const properties = Object.values(byListing).sort((a: any, b: any) => a.score - b.score);
      return jsonResp({ status: "success", properties });
    }

    // ========== CSV EXPORTS ==========
    // Helper : array of objects → CSV string (avec échappement correct)
    function arrayToCsv(rows: any[]): string {
      if (!rows || rows.length === 0) return "";
      const headers = Object.keys(rows[0]);
      const escape = (v: any) => {
        if (v == null) return "";
        const s = typeof v === "object" ? JSON.stringify(v) : String(v);
        if (s.includes('"') || s.includes(',') || s.includes('\n')) return '"' + s.replace(/"/g, '""') + '"';
        return s;
      };
      const headerLine = headers.join(",");
      const lines = rows.map(r => headers.map(h => escape(r[h])).join(","));
      return [headerLine, ...lines].join("\n");
    }
    function csvResponse(filename: string, csv: string) {
      return new Response("\ufeff" + csv, { // BOM pour Excel
        headers: {
          ...CORS_HEADERS,
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="${filename}"`,
        },
      });
    }

    // Helper : next YYYY-MM from a given YYYY-MM (for exclusive upper bound)
    function nextMonthISO(ym: string): string {
      const [y, m] = ym.split('-').map(Number);
      const d = new Date(Date.UTC(y, m, 1)); // m is 1-indexed, so Date month m = month after
      return d.toISOString().slice(0, 10); // YYYY-MM-01
    }

    if (action === "exportCleaningsCsv") {
      const month = url.searchParams.get("month"); // YYYY-MM optionnel
      let q = sb.from("cleaning_timer").select("reservation_key, cleaner_id, started_at, finished_at, duration_minutes").order("started_at", { ascending: false });
      if (month) q = q.gte("started_at", month + "-01").lt("started_at", nextMonthISO(month));
      const [timerRes, cleanerRes, assignRes, doneRes, cancelRes] = await Promise.all([
        q,
        sb.from("cleaners").select("id, name"),
        sb.from("cleaning_assignments").select("reservation_key, cleaner_id"),
        sb.from("menage_done").select("reservation_key, done, updated_at"),
        sb.from("cleaning_cancelled").select("reservation_key, reason, cancelled_by, cancelled_at"),
      ]);
      if (timerRes.error) throw timerRes.error;
      const cleanerMap: Record<number, string> = {};
      (cleanerRes.data || []).forEach((c: any) => { cleanerMap[c.id] = c.name; });
      const assignMap: Record<string, number> = {};
      (assignRes.data || []).forEach((a: any) => { assignMap[a.reservation_key] = a.cleaner_id; });
      const doneMap: Record<string, any> = {};
      (doneRes.data || []).forEach((d: any) => { doneMap[d.reservation_key] = d; });
      const cancelMap: Record<string, any> = {};
      (cancelRes.data || []).forEach((c: any) => { cancelMap[c.reservation_key] = c; });
      const rows = (timerRes.data || []).map((t: any) => {
        const parts = t.reservation_key.split('_');
        const date = parts[0] || '';
        const guest = parts.slice(1).join(' ') || '';
        const cleanerId = t.cleaner_id ?? assignMap[t.reservation_key];
        return {
          checkout_date: date,
          guest_name: guest,
          cleaner: cleanerId ? (cleanerMap[cleanerId] || cleanerId) : '',
          started_at: t.started_at || '',
          finished_at: t.finished_at || '',
          duration_minutes: t.duration_minutes ?? '',
          done: doneMap[t.reservation_key]?.done ? 'yes' : 'no',
          done_at: doneMap[t.reservation_key]?.updated_at || '',
          cancelled: cancelMap[t.reservation_key] ? 'yes' : 'no',
          cancel_reason: cancelMap[t.reservation_key]?.reason || '',
        };
      });
      // Récupérer aussi les extras pour la période
      let qExtra = sb.from("extra_cleanings").select("*").order("cleaning_date", { ascending: false });
      if (month) qExtra = qExtra.gte("cleaning_date", month + "-01").lt("cleaning_date", nextMonthISO(month));
      const extraCsvRes = await qExtra;
      const extraRows = (extraCsvRes.data || []).map((e: any) => ({
        checkout_date: e.cleaning_date,
        guest_name: e.guest_name || e.label || 'Extra',
        cleaner: (() => {
          const a = assignMap[e.reservation_key];
          return a ? (cleanerMap[a] || a) : '';
        })(),
        started_at: '',
        finished_at: '',
        duration_minutes: '',
        done: doneMap[e.reservation_key]?.done ? 'yes' : 'no',
        done_at: doneMap[e.reservation_key]?.updated_at || '',
        cancelled: e.status === 'cancelled' ? 'yes' : 'no',
        cancel_reason: '',
        source: 'extra',
        label: e.label || '',
        price_billed: e.price_billed ?? '',
      }));
      const hostawayRows = rows.map((r: any) => ({ ...r, source: 'hostaway', label: '', price_billed: '' }));
      const allRows = [...hostawayRows, ...extraRows].sort((a: any, b: any) => (b.checkout_date || '').localeCompare(a.checkout_date || ''));
      const filename = `cleanings_${month || 'all'}.csv`;
      return csvResponse(filename, arrayToCsv(allRows));
    }

    if (action === "exportMaintenanceCsv") {
      const month = url.searchParams.get("month");
      const [ticketRes, costRes, vendorRes] = await Promise.all([
        sb.from("maintenance_tickets").select("*").order("created_at", { ascending: false }),
        sb.from("maintenance_costs").select("*").order("date", { ascending: false }),
        sb.from("vendors").select("id, name"),
      ]);
      const vendorMap: Record<number, string> = {};
      (vendorRes.data || []).forEach((v: any) => { vendorMap[v.id] = v.name; });
      const filteredCosts = month
        ? (costRes.data || []).filter((c: any) => c.date && c.date.startsWith(month))
        : (costRes.data || []);
      const rows = filteredCosts.map((c: any) => ({
        date: c.date,
        listing_id: c.listing_id || '',
        category: c.category || '',
        description: c.description || '',
        amount: c.amount,
        vendor: c.vendor_id ? (vendorMap[c.vendor_id] || c.vendor_id) : '',
        ticket_id: c.ticket_id || '',
      }));
      const filename = `maintenance_costs_${month || 'all'}.csv`;
      return csvResponse(filename, arrayToCsv(rows));
    }


    // ========== EXTRA CLEANINGS (hors Hostaway) ==========
    if (action === "addExtraCleaning" && req.method === "POST") {
      const body = await req.json();
      const { listing_id, cleaning_date, label, guest_name, price_billed, cleaner_price, notes, assigned_cleaner_id, created_by } = body;
      if (!listing_id || !cleaning_date) return jsonResp({ error: "listing_id and cleaning_date required" }, 400);

      // Generate unique reservation_key
      const rand = Math.random().toString(36).substring(2, 10);
      const reservation_key = `extra_${cleaning_date}_${rand}`;

      const { data, error } = await sb.from("extra_cleanings").insert({
        reservation_key, listing_id, cleaning_date,
        label: label || null,
        guest_name: guest_name || null,
        price_billed: price_billed ?? null,
        cleaner_price: cleaner_price ?? null,
        notes: notes || null,
        created_by: created_by || null,
        status: 'pending',
      }).select().single();
      if (error) throw error;

      if (assigned_cleaner_id) {
        await sb.from("cleaning_assignments").upsert({
          reservation_key, cleaner_id: assigned_cleaner_id, assigned_at: new Date().toISOString(),
        }, { onConflict: "reservation_key" });
      }
      await addLog(sb, reservation_key, "extra_created", created_by, { listing_id, label, price_billed, assigned_cleaner_id });
      return jsonResp({ status: "success", extra: data });
    }

    if (action === "updateExtraCleaning" && req.method === "POST") {
      const body = await req.json();
      const { id, label, guest_name, price_billed, cleaner_price, notes, status, cleaning_date, listing_id } = body;
      if (!id) return jsonResp({ error: "id required" }, 400);
      const upd: any = {};
      if (label !== undefined) upd.label = label;
      if (guest_name !== undefined) upd.guest_name = guest_name;
      if (price_billed !== undefined) upd.price_billed = price_billed;
      if (cleaner_price !== undefined) upd.cleaner_price = cleaner_price;
      if (notes !== undefined) upd.notes = notes;
      if (status !== undefined) upd.status = status;
      if (cleaning_date !== undefined) upd.cleaning_date = cleaning_date;
      if (listing_id !== undefined) upd.listing_id = listing_id;
      const { error } = await sb.from("extra_cleanings").update(upd).eq("id", id);
      if (error) throw error;
      return jsonResp({ status: "success" });
    }

    if (action === "deleteExtraCleaning" && req.method === "POST") {
      const body = await req.json();
      const { id } = body;
      if (!id) return jsonResp({ error: "id required" }, 400);
      // Fetch key to cleanup related rows
      const { data: ec } = await sb.from("extra_cleanings").select("reservation_key").eq("id", id).single();
      const key = ec?.reservation_key;
      const { error } = await sb.from("extra_cleanings").delete().eq("id", id);
      if (error) throw error;
      // Cleanup workflow rows
      if (key) {
        await sb.from("cleaning_assignments").delete().eq("reservation_key", key);
        await sb.from("menage_done").delete().eq("reservation_key", key);
        await sb.from("cleaning_timer").delete().eq("reservation_key", key);
        await sb.from("cleaning_cancelled").delete().eq("reservation_key", key);
        await sb.from("checklist_progress").delete().eq("reservation_key", key);
      }
      return jsonResp({ status: "success" });
    }

    if (action === "getExtraCleanings") {
      const startDate = url.searchParams.get("startDate");
      const endDate = url.searchParams.get("endDate");
      const listing = url.searchParams.get("listingId");
      let q = sb.from("extra_cleanings").select("*").order("cleaning_date", { ascending: true });
      if (startDate) q = q.gte("cleaning_date", startDate);
      if (endDate) q = q.lte("cleaning_date", endDate);
      if (listing) q = q.eq("listing_id", listing);
      const { data, error } = await q;
      if (error) throw error;
      return jsonResp({ status: "success", extras: data || [] });
    }

    return jsonResp({ error: "Unknown action" }, 400);
  } catch (error) {
    return jsonResp({ error: error.message }, 500);
  }
});

