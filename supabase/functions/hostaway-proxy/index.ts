import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { PDFDocument, StandardFonts, rgb } from "npm:pdf-lib@1.17.1";

// Shim type-only pour tsc hors Deno (erased au runtime, Deno fournit le vrai global).
declare const Deno: any;

const HOSTAWAY_ACCOUNT_ID = Deno.env.get("HOSTAWAY_ACCOUNT_ID") ?? "";
const HOSTAWAY_API_SECRET = Deno.env.get("HOSTAWAY_API_KEY") ?? "";
const APP_SHARED_SECRET = Deno.env.get("APP_SHARED_SECRET") ?? "";
// Server-to-server secret, NEVER shipped in the client bundle. Gates the
// server-only routes below (sync/dispatch/command-queue), which the browser
// never calls. Until it is configured these routes keep their previous
// X-App-Secret gating so deploying this code can't break the VPS jobs.
const SERVER_SHARED_SECRET = Deno.env.get("SERVER_SHARED_SECRET") ?? "";
const SERVER_ONLY_ACTIONS = new Set([
  "syncListings",
  "dispatchPendingEvents",
  "dispatchMaintenance",
  "syncReviewsCache",
  "syncDisputeAnalysis",
  "getAnalyzedDisputeIds",
  "syncHermesActionsCache",
  "syncCleaningAccounting",
  "syncCleanerRatings",
  "updateHermesCommand",
  "updateMacCommand",
  "submitMacCommand",
  "getMacCommands",
  "getHermesCommands",
  "hrCheckExpiries",
]);
const TOKEN_URL = "https://api.hostaway.com/v1/accessTokens";
const API_BASE = "https://api.hostaway.com/v1";

const DEFAULT_CORS_HEADERS = {
  "Access-Control-Allow-Origin": "https://stunning-kleicha-f61101.netlify.app",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-App-Secret, X-Cleaner-Token, X-Server-Secret",
  "Vary": "Origin",
};
const ALLOWED_ORIGINS = new Set([
  "https://stunning-kleicha-f61101.netlify.app",
  "http://localhost:3000",
  "http://localhost:8080",
]);
// Netlify deploy previews use sub-domain prefix : <deploy-id>--stunning-kleicha-f61101.netlify.app
const NETLIFY_PREVIEW_RE = /^https:\/\/[a-z0-9-]+--stunning-kleicha-f61101\.netlify\.app$/;
function corsHeaders(origin: string | null): Record<string, string> {
  if (origin && (ALLOWED_ORIGINS.has(origin) || NETLIFY_PREVIEW_RE.test(origin))) {
    return { ...DEFAULT_CORS_HEADERS, "Access-Control-Allow-Origin": origin };
  }
  return DEFAULT_CORS_HEADERS;
}
// Per-request CORS headers consumed by jsonResp(). Set at the top of the request
// handler so allowed non-prod origins (localhost, deploy previews) get the right
// Access-Control-Allow-Origin on actual responses, not only on preflight.
let REQUEST_CORS_HEADERS: Record<string, string> = DEFAULT_CORS_HEADERS;

// Error with a user-facing message + HTTP status. Anything thrown as HttpError is
// relayed to the client as-is by the catch-all; every other thrown error is logged
// server-side and genericized (no Postgres/Hostaway details leaked).
class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

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
    headers: { ...REQUEST_CORS_HEADERS, "Content-Type": "application/json" },
  });
}

// PostgREST caps responses at 1000 rows : un .select() non borné tronque en silence
// sur les tables qui grossissent. Pagine via .range() jusqu'à épuisement.
// NB: les query builders supabase-js sont one-shot — construire une query NEUVE dans
// le callback, avec un .order(...) stable pour que la pagination soit déterministe.
async function fetchAllRows<T>(buildQuery: (from: number, to: number) => any, pageSize = 1000): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await buildQuery(from, from + pageSize - 1);
    if (error) throw error;
    out.push(...(data ?? []));
    if (!data || data.length < pageSize) break;
  }
  return out;
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

const CHECKOUTS_FRESH_MS = 2 * 60 * 1000;   // newer: serve as-is, no revalidate
const CHECKOUTS_STALE_MS = 10 * 60 * 1000;  // older: fetch Hostaway synchronously

async function buildCheckoutsPayload(startDate: string, endDate: string) {
  const token = await getAccessToken();
  const validStatuses = ['new','modified','confirmed','ownerStay','reserved'];
  const departuresUrl = API_BASE + "/reservations?departureStartDate=" + startDate + "&departureEndDate=" + endDate + "&sortOrder=departureDate&orderDirection=asc";
  // Arrivals window extends 14 days past endDate so each departure can be
  // matched to the NEXT arrival even when it falls outside the queried week.
  const arrEndD = new Date(endDate + "T00:00:00Z");
  arrEndD.setUTCDate(arrEndD.getUTCDate() + 14);
  const arrivalsEnd = arrEndD.toISOString().split("T")[0];
  const arrivalsUrl = API_BASE + "/reservations?arrivalStartDate=" + startDate + "&arrivalEndDate=" + arrivalsEnd + "&sortOrder=arrivalDate&orderDirection=asc";
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
    // Next guest = earliest arrival on/after the departure date (list is
    // already sorted by arrivalDate asc). Same-day flagged for urgency.
    let nextGuest: any = null;
    const arrivals = arrivalsMap[listingId] || [];
    for (const arr of arrivals) {
      if (arr.date >= depDate) { nextGuest = arr; break; }
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
  return { status: "success", count: reservations.length, reservations };
}

async function fetchAllPages(baseUrl: string, authHeaders: Record<string, string>, pageSize = 500): Promise<any[]> {
  const headers = { ...authHeaders };
  let retriedAuth = false;
  const fetchPage = async (offset: number): Promise<any> => {
    const sep = baseUrl.includes("?") ? "&" : "?";
    const pageUrl = baseUrl + sep + "limit=" + pageSize + "&offset=" + offset;
    let resp = await fetch(pageUrl, { headers });
    if (resp.status === 401 && cachedToken && !retriedAuth) {
      // Cached token revoked/expired server-side : clear cache, mint a new one, retry once.
      retriedAuth = true;
      cachedToken = null;
      tokenExpiry = 0;
      headers["Authorization"] = "Bearer " + (await getAccessToken());
      resp = await fetch(pageUrl, { headers });
    }
    // Ne JAMAIS retourner une liste partielle comme un succès (assignments/cleanings
    // disparaîtraient silencieusement côté front).
    if (!resp.ok) throw new HttpError(502, "Hostaway API error " + resp.status);
    return await resp.json();
  };
  const first = await fetchPage(0);
  let all: any[] = first.result || [];
  const total = typeof first.count === "number" ? first.count : null;
  if (total != null && total > all.length && all.length > 0) {
    // Hostaway gives the total count: fetch remaining pages in parallel.
    // Step by the ACTUAL first-page size in case the API caps `limit` below pageSize.
    const step = all.length;
    const offsets: number[] = [];
    for (let o = step; o < total; o += step) offsets.push(o);
    const rest = await Promise.all(offsets.map(fetchPage));
    for (const d of rest) all = all.concat(d.result || []);
  } else if (total == null && all.length === pageSize) {
    // No count field: sequential fallback.
    let offset = pageSize;
    while (true) {
      const d = await fetchPage(offset);
      const results = d.result || [];
      all = all.concat(results);
      if (results.length < pageSize) break;
      offset += pageSize;
    }
  }
  return all;
}

async function addLog(sb: any, key: string, action: string, actor?: string | null, details?: any) {
  // Un log raté ne doit jamais casser l'action qu'il enregistre, mais l'erreur
  // n'était pas seulement avalée : elle n'était même pas lue. C'est comme ça que
  // la table est restée vide pendant des mois sans que rien ne le signale.
  const { error } = await sb.from("cleaning_log")
    .insert({ reservation_key: key, action, actor: actor || null, details: details || {} });
  if (error) console.error("[addLog] insert failed:", action, key, error.message);
}

// ========== Date effective d'un ménage ==========
// Une prestation reportée garde VOLONTAIREMENT sa reservation_key figée sur la date
// d'origine (voir applyPostponements dans app.js : l'assignation, l'état "fait" et la
// checklist sont indexés sur cette clé). La date réelle vit dans cleaning_postponed.
// Toute vérification de congé doit donc raisonner sur new_date ?? date de la clé, sinon
// un ménage déplacé DANS une période de congé passe a travers le blocage strict, et un
// ménage déplacé HORS de la période est bloqué a tort.
function dateFromKey(key: string): string | null {
  const m = String(key || "").match(/^(?:extra_)?(\d{4}-\d{2}-\d{2})_/);
  return m ? m[1] : null;
}

// Charge en UNE fois (jamais dans une boucle par ménage) les reports d'une liste de
// clés. Renvoie une map clé -> new_date. Les clés sont découpées par paquets de 100
// pour ne pas fabriquer une URL PostgREST démesurée sur un gros lot.
// Lève en cas d'erreur de lecture : c'est a l'appelant de décider s'il échoue fermé
// (assignation unitaire) ou ouvert (traitement par lot).
async function loadPostponedDates(sb: any, keys: string[]): Promise<Record<string, string>> {
  const map: Record<string, string> = {};
  const uniq = [...new Set((keys || []).map((k) => String(k)).filter((k) => !!k))];
  for (let i = 0; i < uniq.length; i += 100) {
    const { data, error } = await sb.from("cleaning_postponed")
      .select("reservation_key, new_date").in("reservation_key", uniq.slice(i, i + 100));
    if (error) throw error;
    (data || []).forEach((p: any) => { if (p.new_date) map[p.reservation_key] = p.new_date; });
  }
  return map;
}

// ========== Linge : champs quantités ==========
const LAUNDRY_FIELDS = [
  "pillowcases", "bed_sheets", "duvet_covers",
  "small_towels", "large_towels", "bath_mats",
] as const;

// Retourne {values} ou {error}. allowNegative est vrai uniquement pour les
// ajustements d'inventaire, où une correction peut ramener un solde vers le bas.
// null est rejeté comme un champ absent : une valeur que personne n'a saisie
// ne doit jamais être écrite comme zéro dans la base.
function readLaundryQty(body: Record<string, any>, allowNegative: boolean) {
  const values: Record<string, number> = {};
  for (const f of LAUNDRY_FIELDS) {
    if (body[f] === null) return { error: `${f} must be an integer` };
    const n = Number(body[f]);
    if (!Number.isInteger(n)) return { error: `${f} must be an integer` };
    if (!allowNegative && n < 0) return { error: `${f} must be >= 0` };
    if (Math.abs(n) > 999) return { error: `${f} is out of range` };
    values[f] = n;
  }
  return { values };
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

// Validate X-Cleaner-Token, return cleaner info or null (no error if token missing)
async function validateCleanerToken(sb: any, token: string | null): Promise<{ cleaner_id: number; name: string; role: string; color: string } | null> {
  if (!token) return null;
  const { data, error } = await sb.rpc('validate_cleaner_session', { p_token: token });
  if (error || !data || data.length === 0) return null;
  return data[0];
}

// Gate d'auth du module RH, a trois niveaux :
//   staff   : n'importe quel membre authentifié (agit sur son propre dossier)
//   manager : role === 'manager'
//   owner   : role === 'manager' ET cleaners.is_owner (Hillal uniquement)
// Retourne { me, isOwner, err }. Si err n'est pas null, le handler doit le
// retourner immédiatement sans rien faire d'autre.
async function hrAuth(sb: any, req: Request, level: "staff" | "manager" | "owner") {
  const me = await validateCleanerToken(sb, req.headers.get("x-cleaner-token"));
  if (!me) return { me: null, isOwner: false, err: jsonResp({ error: "auth required" }, 401) };
  const { data } = await sb.from("cleaners").select("is_owner").eq("id", me.cleaner_id).maybeSingle();
  const isOwner = !!(data && data.is_owner);
  if (level !== "staff" && me.role !== "manager") {
    return { me: null, isOwner, err: jsonResp({ error: "manager auth required" }, 403) };
  }
  if (level === "owner" && !isOwner) {
    return { me: null, isOwner, err: jsonResp({ error: "owner auth required" }, 403) };
  }
  return { me, isOwner, err: null };
}

// Jours calendaires bornes incluses. Miroir serveur de leaveDays() de hr.js :
// la valeur envoyée par le client n'est jamais utilisée.
function hrLeaveDays(start: string, end: string): number {
  const a = Date.parse(String(start) + "T00:00:00Z");
  const b = Date.parse(String(end) + "T00:00:00Z");
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return 0;
  return Math.round((b - a) / 86400000) + 1;
}

// Signature dessinée : uniquement un data-URL PNG base64, 100 Ko max.
// Tout le reste est refusé (pas de SVG, pas d'URL externe, pas de JPEG).
const HR_SIG_PREFIX = "data:image/png;base64,";
function hrValidSignature(s: unknown): string | null {
  if (typeof s !== "string" || !s.startsWith(HR_SIG_PREFIX)) return null;
  if (s.length > 100_000) return null;
  if (!/^[A-Za-z0-9+/]+=*$/.test(s.slice(HR_SIG_PREFIX.length))) return null;
  return s;
}

const HR_TODAY = () => new Date().toISOString().slice(0, 10);

// Colonnes non sensibles d'employees. Utilisée par toutes les routes SAUF
// hrGetCompensation. Ne jamais remplacer par un select("*") : les colonnes de
// salaire sortiraient vers les managers non-owner.
const HR_EMPLOYEE_PUBLIC_COLS =
  "id, cleaner_id, hire_date, end_date, job_title, nationality, opening_annual_days, opening_date, notes, created_at, updated_at";

// Labels lisibles par type de congé. Ajoutez ici tout nouveau type avant
// de l'autoriser dans hrSubmitLeave.
const HR_LEAVE_LABELS: Record<string, string> = {
  annual: "Annual leave", sick: "Sick leave", unpaid: "Unpaid leave",
  maternity: "Maternity leave", parental: "Parental leave",
  bereavement: "Bereavement leave", hajj: "Hajj leave", other: "Leave",
};

// Notifie tous les managers actifs ayant un chat Telegram. Best-effort : toute
// erreur (reseau, Supabase, Telegram) est avalee afin de ne jamais impacter
// la reponse HTTP de la route appelante.
async function hrNotifyManagers(sb: any, text: string) {
  try {
    const { data } = await sb.from("cleaners")
      .select("telegram_chat_id").eq("role", "manager").eq("is_active", true)
      .not("telegram_chat_id", "is", null);
    await Promise.all((data || []).map((c: any) => sendTelegram(c.telegram_chat_id, text)));
  } catch (e) {
    console.warn("[hrNotifyManagers] notification failed:", e);
  }
}

// Notifie un salarie specifique par son cleaner_id. Best-effort : toute
// erreur (reseau, Supabase, Telegram) est avalee afin de ne jamais impacter
// la reponse HTTP de la route appelante.
async function hrNotifyCleaner(sb: any, cleanerId: number, text: string) {
  try {
    const { data } = await sb.from("cleaners").select("telegram_chat_id").eq("id", cleanerId).maybeSingle();
    if (data && data.telegram_chat_id) await sendTelegram(data.telegram_chat_id, text);
  } catch (e) {
    console.warn("[hrNotifyCleaner] notification failed:", e);
  }
}

// ===========================================================================
// Formulaire de congé PDF (A4). Régénérable à tout moment depuis la base :
// le fichier archivé dans hr-forms n'est qu'une copie de commodité.
// ===========================================================================
async function hrBuildLeaveFormPdf(sb: any, lr: any): Promise<Uint8Array> {
  const [{ data: who }, { data: emp }, takenRes] = await Promise.all([
    sb.from("cleaners").select("name").eq("id", lr.cleaner_id).maybeSingle(),
    sb.from("employees").select(HR_EMPLOYEE_PUBLIC_COLS).eq("cleaner_id", lr.cleaner_id).maybeSingle(),
    sb.from("leave_requests").select("days").eq("cleaner_id", lr.cleaner_id).eq("leave_type", "annual").eq("status", "approved"),
  ]);
  const name = (who && who.name) || `#${lr.cleaner_id}`;
  // Compute annual leave balance at generation time (same logic as hr.js accruedAnnualDays).
  const asOf = new Date().toISOString().slice(0, 10);
  const hireDate = (emp && emp.hire_date) || null;
  const openingDays = Number((emp && emp.opening_annual_days) || 0);
  const openingDate = (emp && emp.opening_date) || hireDate;
  let accruedAnnual = openingDays;
  if (hireDate) {
    const completeMonths = (from: string, to: string): number => {
      const f = new Date(from + "T00:00:00Z");
      const t = new Date(to + "T00:00:00Z");
      if (isNaN(f.getTime()) || isNaN(t.getTime()) || t < f) return 0;
      let m = (t.getUTCFullYear() - f.getUTCFullYear()) * 12 + (t.getUTCMonth() - f.getUTCMonth());
      if (t.getUTCDate() < f.getUTCDate()) m--;
      return Math.max(0, m);
    };
    const tenureMonths = completeMonths(hireDate, asOf);
    if (tenureMonths >= 6) {
      const earnedMonths = completeMonths(openingDate || hireDate, asOf);
      const rate = tenureMonths >= 12 ? 2.5 : 2;
      accruedAnnual = Math.round((openingDays + earnedMonths * rate) * 100) / 100;
    }
  }
  const takenAnnual = (takenRes.data || []).reduce((s: number, r: any) => s + Number(r.days || 0), 0);
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([595, 842]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const ink = rgb(0.12, 0.12, 0.12);
  const grey = rgb(0.45, 0.45, 0.45);
  let y = 780;
  const text = (s: string, x: number, size: number, f = font, c = ink) =>
    page.drawText(String(s), { x, y, size, font: f, color: c });
  const row = (label: string, value: string) => {
    text(label, 60, 10, bold, grey); text(String(value || "-"), 220, 10);
    y -= 22;
  };

  text("Hillal Medini Vacation Homes Rental LLC", 60, 14, bold); y -= 20;
  text("Leave Application Form", 60, 18, bold); y -= 14;
  page.drawLine({ start: { x: 60, y }, end: { x: 535, y }, thickness: 1, color: grey });
  y -= 26;

  row("Request #", String(lr.id));
  row("Employee", name);
  row("Job title", (emp && emp.job_title) || "-");
  row("Hire date", hireDate || "-");
  row("Nationality", (emp && emp.nationality) || "-");
  y -= 8;
  row("Leave type", HR_LEAVE_LABELS[lr.leave_type] || lr.leave_type);
  row("From", lr.start_date);
  row("To", lr.end_date);
  row("Days (calendar)", String(lr.days));
  row("Reason", lr.reason || "-");
  y -= 8;
  row("Annual leave balance at time of generation",
    `${accruedAnnual} days accrued, ${takenAnnual} taken`);
  y -= 8;
  row("Status", String(lr.status).toUpperCase());
  row("Requested by", lr.requested_by || name);
  row("Requested at", String(lr.requested_at || "").slice(0, 16).replace("T", " "));
  if (lr.decided_by) {
    row("Decided by", lr.decided_by);
    row("Decided at", String(lr.decided_at || "").slice(0, 16).replace("T", " "));
    if (lr.decision_note) row("Decision note", lr.decision_note);
  }

  // Blocs signatures côte à côte.
  y -= 30;
  const sigYBaseline = y;
  const sigBlock = async (x: number, title: string, sig: string | null, fallback: string, signerName: string, signerDate: string) => {
    page.drawText(title, { x, y: sigYBaseline, size: 10, font: bold, color: grey });
    page.drawRectangle({ x, y: sigYBaseline - 84, width: 210, height: 74, borderColor: grey, borderWidth: 0.8 });
    if (sig) {
      try {
        const png = await pdf.embedPng(sig);
        const dims = png.scaleToFit(190, 58);
        page.drawImage(png, { x: x + 10, y: sigYBaseline - 76, width: dims.width, height: dims.height });
      } catch (_e) {
        page.drawText("Signature on file (image unreadable)", { x: x + 10, y: sigYBaseline - 48, size: 8, font, color: grey, maxWidth: 190, lineHeight: 10 });
      }
    } else {
      page.drawText(fallback, { x: x + 10, y: sigYBaseline - 48, size: 8, font, color: grey, maxWidth: 190, lineHeight: 10 });
    }
    // Name + date below the box (spec: image + nom + date).
    page.drawText(signerName, { x, y: sigYBaseline - 96, size: 8, font: bold, color: ink });
    page.drawText(signerDate, { x, y: sigYBaseline - 108, size: 8, font, color: grey });
  };
  const empFallback = lr.requested_by && lr.requested_by !== name
    ? `Recorded by ${lr.requested_by} on behalf of employee`
    : `Submitted in app by ${lr.requested_by || name} on ${String(lr.requested_at || "").slice(0, 10)}`;
  const mgrFallback = lr.decided_by
    ? `${String(lr.status)} in app by ${lr.decided_by} on ${String(lr.decided_at || "").slice(0, 10)}`
    : "Pending decision";
  await sigBlock(60, "Employee signature", lr.employee_signature || null, empFallback,
    name, String(lr.requested_at || "").slice(0, 10));
  await sigBlock(325, "Manager signature", lr.manager_signature || null, mgrFallback,
    lr.decided_by || "-", String(lr.decided_at || "").slice(0, 10) || "-");
  y = sigYBaseline - 125;
  page.drawText(`Generated by HK Planner on ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC`,
    { x: 60, y, size: 8, font, color: grey });
  return pdf.save();
}

// Archive (ou re-archive) le PDF d'une demande. Best-effort : ne lève jamais,
// renvoie le chemin ou null. Le PDF se régénérera au premier téléchargement.
async function hrArchiveLeaveForm(sb: any, lr: any): Promise<string | null> {
  try {
    const bytes = await hrBuildLeaveFormPdf(sb, lr);
    const path = `leave-forms/${lr.id}.pdf`;
    const { error } = await sb.storage.from("hr-forms")
      .upload(path, bytes, { contentType: "application/pdf", upsert: true });
    if (error) throw error;
    await sb.from("leave_requests").update({ form_path: path }).eq("id", lr.id);
    return path;
  } catch (e) {
    console.error("[hr] leave form archive failed", e);
    return null;
  }
}

// Alertes d'expiration de documents. Un document déclenche au plus une alerte
// par palier (60 / 30 / 7 / 0 jours) : la clé app_config `hr_doc_alert_<id>_<palier>`
// sert de verrou, sinon chaque ouverture de l'onglet RH renverrait la même notif.
const HR_EXPIRY_THRESHOLDS = [60, 30, 7, 0];

async function hrRunExpiryAlerts(sb: any): Promise<number> {
  const today = HR_TODAY();
  const horizon = new Date(Date.now() + 60 * 86400000).toISOString().slice(0, 10);
  const { data: docs } = await sb.from("employee_documents")
    .select("id, cleaner_id, doc_type, expiry_date")
    .not("expiry_date", "is", null).lte("expiry_date", horizon);
  if (!docs || !docs.length) return 0;

  const { data: cRows } = await sb.from("cleaners").select("id, name");
  const nameOf = (id: number) => {
    const c = (cRows || []).find((x: any) => x.id === id);
    return (c && c.name) || ("#" + id);
  };

  let sent = 0;
  for (const d of docs) {
    const left = Math.round((Date.parse(d.expiry_date + "T00:00:00Z") - Date.parse(today + "T00:00:00Z")) / 86400000);
    // Palier franchi le plus proche : 45 jours restants déclenche le palier 60.
    const threshold = HR_EXPIRY_THRESHOLDS.find((t) => left <= t);
    if (threshold === undefined) continue;
    const key = `hr_doc_alert_${d.id}_${threshold}`;
    const { data: seen } = await sb.from("app_config").select("key").eq("key", key).maybeSingle();
    if (seen) continue;
    await hrNotifyManagers(sb,
      `📄 <b>Document expiring</b>\n${nameOf(d.cleaner_id)} - ${d.doc_type}\n` +
      (left < 0 ? `Expired ${Math.abs(left)} day(s) ago (${d.expiry_date})` : `Expires in ${left} day(s) (${d.expiry_date})`));
    await sb.from("app_config").upsert({ key, value: today, updated_at: new Date().toISOString() }, { onConflict: "key" });
    sent++;
  }
  return sent;
}

// ========== Telegram notifications (team_tasks) ==========
// Side-effect : si fail, ne pas faire échouer la requête principale.
const TELEGRAM_BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN") ?? "";
async function sendTelegram(chatId: string | null | undefined, text: string): Promise<void> {
  if (!chatId || !TELEGRAM_BOT_TOKEN) return;
  try {
    const r = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML", disable_web_page_preview: true }),
    });
    if (!r.ok) {
      const body = await r.text();
      console.warn(`[telegram] HTTP ${r.status}: ${body.slice(0, 200)}`);
    }
  } catch (e) {
    console.warn(`[telegram] fetch failed:`, e);
  }
}

function formatTaskNotification(task: any, createdBy: { name?: string } | null, assignee: { name?: string } | null): string {
  const lines: string[] = [];
  const priorityEmoji = task.priority === "urgent" ? "🚨" : task.priority === "high" ? "🔥" : task.priority === "low" ? "🟢" : "📌";
  lines.push(`${priorityEmoji} <b>New task assigned</b>`);
  lines.push("");
  lines.push(`<b>${escapeHtml(task.title)}</b>`);
  if (task.description) lines.push(escapeHtml(task.description).slice(0, 400));
  lines.push("");
  const meta: string[] = [];
  meta.push(`Priority: <b>${task.priority || "normal"}</b>`);
  if (task.due_at) meta.push(`Due: ${task.due_at.slice(0, 10)}`);
  if (task.category) meta.push(`Category: ${task.category}`);
  if (createdBy?.name) meta.push(`From: ${createdBy.name}`);
  lines.push(meta.join(" · "));
  lines.push("");
  lines.push(`👉 https://stunning-kleicha-f61101.netlify.app/`);
  return lines.join("\n");
}

function escapeHtml(s: string): string {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// ========== Decision rules : monitoring_events → team_task spec ==========
// Renvoie un objet avec les champs team_tasks (title, description, assigned_cleaner_id, priority,
// category, listing_id, due_at) si l'event mérite une tâche. Renvoie null si on ignore.
//
// Règles MVP (à étoffer au fil de l'usage) :
// - reservation.updated avec status cancelled → tâche Hillal high
// - reservation.created avec check-in <48h → tâche Walter high (urgent si <12h)
// - Autres : ignore (Hostaway tasks natives, messages team, etc.)
function decideTaskFromEvent(ev: any, ids: any): any | null {
  const p = ev.raw_payload || {};
  const type = ev.event_type;

  if (type === "reservation.updated") {
    const status = String(p.status || "").toLowerCase();
    if (status.includes("cancel")) {
      const checkIn = p.arrivalDate || p.checkInDate || "?";
      const guest = ev.guest_name || p.guestName || "Guest";
      const apt = ev.apartment_no || ev.building || (ev.listing_id ? `listing ${ev.listing_id}` : "logement ?");
      return {
        title: `❌ Cancellation: ${guest} — ${apt} (${checkIn})`,
        description: `Booking cancelled (status: ${status}). Channel: ${ev.channel || "?"}. Check: rebook possible? Compensation to claim from OTA?`,
        assigned_cleaner_id: ids.HILLAL,
        priority: "high",
        category: "ops",
        listing_id: ev.listing_id ? String(ev.listing_id) : null,
      };
    }
    return null;
  }

  if (type === "reservation.created") {
    const checkIn = p.arrivalDate || p.checkInDate;
    if (!checkIn) return null;
    const ciTs = new Date(checkIn).getTime();
    if (isNaN(ciTs)) return null;
    const hoursUntil = (ciTs - Date.now()) / 3600000;
    if (hoursUntil < 0) return null; // already past, ignore
    if (hoursUntil > 48) return null; // normal flow HK Planner, no task needed
    const guest = ev.guest_name || p.guestName || "Guest";
    const apt = ev.apartment_no || ev.building || (ev.listing_id ? `listing ${ev.listing_id}` : "unknown unit");
    return {
      title: `⚡ Last-minute: ${guest} arrives ${checkIn} — ${apt}`,
      description: `Last-minute booking (check-in in ~${Math.round(hoursUntil)}h). Check: cleaning scheduled? access code sent? instructions OK? Channel: ${ev.channel || "?"}.`,
      assigned_cleaner_id: ids.WALTER,
      priority: hoursUntil <= 12 ? "urgent" : "high",
      category: "ops",
      listing_id: ev.listing_id ? String(ev.listing_id) : null,
    };
  }

  // task.*, team.message, autres : ignore pour MVP
  return null;
}

// Notifie l'assigné de la tâche par Telegram si chat_id configuré.
// Idempotent côté Telegram (un message envoyé = un message reçu, pas de dédup nécessaire pour ce MVP).
async function notifyAssignee(sb: any, task: any): Promise<void> {
  if (!task?.assigned_cleaner_id) return;
  const { data: assignee } = await sb.from("cleaners")
    .select("id, name, telegram_chat_id")
    .eq("id", task.assigned_cleaner_id).single();
  if (!assignee?.telegram_chat_id) return;
  let createdBy: { name?: string } | null = null;
  if (task.created_by_cleaner_id) {
    const { data: c } = await sb.from("cleaners").select("name").eq("id", task.created_by_cleaner_id).single();
    createdBy = c || null;
  }
  await sendTelegram(assignee.telegram_chat_id, formatTaskNotification(task, createdBy, assignee));
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

// Route registry — single source of truth for all 75 actions.
// Used at request entry for 404 (unknown) + 405 (method mismatch) before reaching the dispatch logic below.
const ROUTES: ReadonlyMap<string, "GET" | "POST"> = new Map([
  // ===== Checkouts / sync =====
  ["checkouts", "GET"],
  ["syncListings", "GET"],
  // ===== Cleaning state =====
  ["getDone", "GET"],
  ["setDone", "POST"],
  ["setCancelled", "POST"],
  ["setPostponed", "POST"],
  // ===== Cleaners CRUD + auth =====
  ["getCleaners", "GET"],
  ["saveCleaner", "POST"],
  ["deleteCleaner", "POST"],
  ["cleanerLogin", "POST"],
  ["cleanerLogout", "POST"],
  ["cleanerMe", "GET"],
  // ===== Assignments =====
  ["getAssignments", "GET"],
  ["assignCleaner", "POST"],
  ["autoAssign", "POST"],
  // ===== Checklists =====
  ["getChecklistTemplates", "GET"],
  ["getChecklistProgress", "GET"],
  ["saveChecklistItem", "POST"],
  // ===== Notes =====
  ["getNotes", "GET"],
  ["addNote", "POST"],
  // ===== Photos =====
  ["getPhotos", "GET"],
  ["getPhoto", "GET"],
  ["addPhoto", "POST"],
  // ===== Timers =====
  ["startTimer", "POST"],
  ["pauseTimer", "POST"],
  ["resumeTimer", "POST"],
  ["stopTimer", "POST"],
  ["getTimers", "GET"],
  // ===== Logs =====
  ["getLogs", "GET"],
  // ===== Pricing / apt number =====
  ["setCustomPrice", "POST"],
  ["setAptNumber", "POST"],
  // ===== Guest feedback =====
  ["saveGuestFeedback", "POST"],
  ["getGuestFeedback", "GET"],
  // ===== Maintenance tickets =====
  ["getMaintenanceTickets", "GET"],
  ["getTicketPhoto", "GET"],
  ["createTicket", "POST"],
  ["updateTicket", "POST"],
  // ===== Vendors =====
  ["getVendors", "GET"],
  ["saveVendor", "POST"],
  ["deleteVendor", "POST"],
  // ===== Equipment =====
  ["getEquipment", "GET"],
  ["saveEquipment", "POST"],
  // ===== Maintenance costs =====
  ["getMaintenanceCosts", "GET"],
  ["addMaintenanceCost", "POST"],
  // ===== Preventive maintenance =====
  ["getPreventiveMaintenance", "GET"],
  ["savePreventiveMaintenance", "POST"],
  ["completePreventive", "POST"],
  // ===== SLA / Health =====
  ["getSLA", "GET"],
  ["getPropertyHealth", "GET"],
  // ===== Ticket comments =====
  ["getTicketComments", "GET"],
  ["addTicketComment", "POST"],
  // ===== Recurring issues =====
  ["getRecurringIssues", "GET"],
  // ===== Config =====
  ["getConfig", "GET"],
  ["setConfig", "POST"],
  // ===== Autopilot =====
  ["runAutopilot", "GET"],
  // ===== Dashboard / aggregates =====
  ["getDashboardKPIs", "GET"],
  ["getAllData", "GET"],
  ["getPropertyHeatmap", "GET"],
  // ===== CSV exports =====
  ["exportCleaningsCsv", "GET"],
  ["exportMaintenanceCsv", "GET"],
  // ===== Extra cleanings (hors Hostaway) =====
  ["addExtraCleaning", "POST"],
  ["updateExtraCleaning", "POST"],
  ["deleteExtraCleaning", "POST"],
  ["getExtraCleanings", "GET"],
  // ===== Team tasks (to-do partagée multi-rôles) =====
  ["listTeamTasks", "GET"],
  ["getTeamTask", "GET"],
  ["createTeamTask", "POST"],
  ["updateTeamTask", "POST"],
  ["completeTeamTask", "POST"],
  ["addTeamTaskComment", "POST"],
  ["dispatchPendingEvents", "POST"],
  ["dispatchMaintenance", "POST"],
  // ===== Subcontractor pricing =====
  ["getSubcontractorPricing", "GET"],
  // ===== Reviews + Hermes cache (VPS-pushed mirrors) =====
  ["syncReviewsCache", "POST"],
  ["syncHermesActionsCache", "POST"],
  ["getRecentReviews", "GET"],
  ["getHermesActivity", "GET"],
  // ===== Review disputes tracker =====
  ["getDisputes", "GET"],
  ["updateDisputeStatus", "POST"],
  ["syncDisputeAnalysis", "POST"],
  ["getAnalyzedDisputeIds", "GET"],
  ["getCleaningAccounting", "GET"],
  ["listCleaningAccountingMonths", "GET"],
  ["syncCleaningAccounting", "POST"],
  ["getCleanerRatings", "GET"],
  ["syncCleanerRatings", "POST"],
  ["submitHermesCommand", "POST"],
  ["getHermesCommands", "GET"],
  ["updateHermesCommand", "POST"],
  // Mac commands (reverse channel : VPS Hermes → Mac launchd)
  ["submitMacCommand", "POST"],
  ["getMacCommands", "GET"],
  ["updateMacCommand", "POST"],
  // ===== Laundry =====
  ["saveLaundryCount", "POST"],
  ["getLaundryCount", "GET"],
  ["getLaundrySummary", "GET"],
  ["getLaundryMovements", "GET"],
  ["addLaundryMovement", "POST"],
  // ===== RH (congés, dossier employé, documents) =====
  ["hrOverview", "GET"],
  ["hrMyLeave", "GET"],
  ["hrSubmitLeave", "POST"],
  ["hrDecideLeave", "POST"],
  ["hrCancelLeave", "POST"],
  ["hrSaveHoliday", "POST"],
  ["hrDeleteHoliday", "POST"],
  ["hrLeaveForm", "GET"],
  ["hrSaveEmployee", "POST"],
  ["hrDeleteEmployee", "POST"],
  ["hrSaveDocument", "POST"],
  ["hrDeleteDocument", "POST"],
  ["hrCheckExpiries", "POST"],
  ["hrGetCompensation", "GET"],
]);

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin");
  const CORS_HEADERS = corsHeaders(origin);
  REQUEST_CORS_HEADERS = CORS_HEADERS; // consumed by jsonResp() for this request
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  // App-level auth — toujours stricte (pas de kill-switch env : un STRICT_AUTH=false
  // oublié désactiverait silencieusement toute l'auth).
  const providedSecret = req.headers.get("x-app-secret") ?? "";
  const hasSecret = APP_SHARED_SECRET !== "" && providedSecret === APP_SHARED_SECRET;
  if (!hasSecret) {
    console.log("[hostaway-proxy] missing/invalid X-App-Secret from origin=" + origin);
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }
  try {
    const url = new URL(req.url);
    const action = url.searchParams.get("action");
    const sb = getSupabase();

    // Route validation (404 unknown action + 405 method mismatch) — runs before legacy dispatcher below.
    if (action !== null) {
      const expectedMethod = ROUTES.get(action);
      if (!expectedMethod) {
        return jsonResp({ error: `Unknown action: ${action}` }, 404);
      }
      if (expectedMethod !== req.method) {
        return jsonResp({ error: `Method ${req.method} not allowed for "${action}" (expected ${expectedMethod})` }, 405);
      }
    }

    // Server-only routes: require a secret that never ships to the browser.
    // If SERVER_SHARED_SECRET is unset, HARD FAIL (403) — falling back to
    // X-App-Secret would let anyone with the public JS bundle hit routes like
    // getMacCommands (pushed credentials). Configure the env var on the edge
    // function AND the callers before deploying server-only jobs.
    if (action !== null && SERVER_ONLY_ACTIONS.has(action)) {
      if (SERVER_SHARED_SECRET === "") {
        console.error(`[hostaway-proxy] SERVER_SHARED_SECRET not set — refusing server-only action "${action}".`);
        return jsonResp({ error: "server auth required" }, 403);
      }
      if ((req.headers.get("x-server-secret") ?? "") !== SERVER_SHARED_SECRET) {
        console.log(`[hostaway-proxy] missing/invalid X-Server-Secret for "${action}" from origin=${origin}`);
        return jsonResp({ error: "server auth required" }, 403);
      }
    }

    // ==================== CHECKOUTS ====================
    if (action === "checkouts") {
      const startDate = url.searchParams.get("startDate");
      const endDate = url.searchParams.get("endDate");
      if (!startDate || !endDate) return jsonResp({ error: "startDate and endDate required" }, 400);
      const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
      if (!DATE_RE.test(startDate) || !DATE_RE.test(endDate)) {
        return jsonResp({ error: "startDate and endDate must be YYYY-MM-DD" }, 400);
      }
      // Server-side stale-while-revalidate: the Hostaway pagination is the slow
      // path (~5-10s on month ranges). Serve a recent snapshot instantly and
      // revalidate in background; only fetch synchronously when too old.
      const cacheKey = "checkouts:" + startDate + "_" + endDate;
      if (url.searchParams.get("fresh") !== "1") {
        try {
          const { data: row } = await sb.from("proxy_cache").select("payload, updated_at").eq("key", cacheKey).maybeSingle();
          if (row && row.payload) {
            const age = Date.now() - new Date(row.updated_at).getTime();
            if (age < CHECKOUTS_STALE_MS) {
              if (age > CHECKOUTS_FRESH_MS) {
                const revalidate = buildCheckoutsPayload(startDate, endDate)
                  .then((payload) => sb.from("proxy_cache").upsert({ key: cacheKey, payload, updated_at: new Date().toISOString() }))
                  .catch((e) => console.error("[hostaway-proxy] checkouts revalidate failed:", e));
                try { (globalThis as any).EdgeRuntime?.waitUntil?.(revalidate); } catch (_e) { /* best effort */ }
              }
              return jsonResp({ ...row.payload, cachedAt: row.updated_at });
            }
          }
        } catch (e) {
          console.error("[hostaway-proxy] proxy_cache read failed:", e);
        }
      }
      const payload = await buildCheckoutsPayload(startDate, endDate);
      try {
        await sb.from("proxy_cache").upsert({ key: cacheKey, payload, updated_at: new Date().toISOString() });
      } catch (e) {
        console.error("[hostaway-proxy] proxy_cache write failed:", e);
      }
      return jsonResp(payload);
    }

    // ==================== SYNC LISTINGS ====================
    if (action === "syncListings") {
      const token = await getAccessToken();
      const authHeaders = { "Authorization": "Bearer " + token, "Content-Type": "application/json" };
      const listings = await fetchAllPages(API_BASE + "/listings", authHeaders);
      let synced = 0;
      // Pre-load existing rows to know which ones have manual overrides locked.
      // For locked rows we only refresh metadata that's safe (apt_number, internal_name,
      // updated_at) and skip bedrooms/unit_type/listing_name overwrites.
      const { data: existing } = await sb.from("listing_config")
        .select("listing_id, overrides_locked");
      const lockedIds = new Set((existing || []).filter((r:any)=>r.overrides_locked).map((r:any)=>String(r.listing_id)));
      let lockedSkipped = 0;
      for (const l of listings) {
        const lid = String(l.id);
        const bedrooms = l.bedroomsNumber != null ? Number(l.bedroomsNumber) : 0;
        const unitType = extractUnitType(l);
        const price = priceForTag(unitType, bedrooms);
        const internalName = l.internalListingName || null;
        const aptNumber = extractAptNumber(internalName) || extractAptNumber(l.name) || extractAptNumber(l.address) || null;
        const isLocked = lockedIds.has(lid);
        const payload: any = isLocked
          ? { listing_id: lid, internal_name: internalName, apt_number: aptNumber, updated_at: new Date().toISOString() }
          : { listing_id: lid, listing_name: l.name || "", bedrooms, price, unit_type: unitType, internal_name: internalName, apt_number: aptNumber, updated_at: new Date().toISOString() };
        const { error } = await sb.from("listing_config").upsert(payload, { onConflict: "listing_id" });
        if (!error) { synced++; if (isLocked) lockedSkipped++; }
      }
      return jsonResp({ status: "success", synced, total: listings.length, lockedSkipped });
    }

    // ==================== DONE STATES ====================
    if (action === "getDone") {
      const data = await fetchAllRows<any>((from, to) =>
        sb.from("menage_done").select("reservation_key, done").order("reservation_key").range(from, to));
      const doneMap: Record<string, boolean> = {};
      data.forEach((row: any) => { doneMap[row.reservation_key] = row.done; });
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
    // Manager-only : une session authentifiée non-manager (cleaner/maintenance/subcontractor)
    // est rejetée. Pas de token = vue manager historique (sans login) → autorisé.
    if (action === "setCancelled" && req.method === "POST") {
      const me = await validateCleanerToken(sb, req.headers.get("x-cleaner-token"));
      if (me && me.role !== "manager") return jsonResp({ error: "manager role required" }, 403);
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

    // ==================== POSTPONE CLEANING ====================
    // Date override : déplace un ménage à un jour ultérieur sans toucher Hostaway.
    // postpone=true → upsert (new_date/original_date) ; postpone=false → retire l'override.
    if (action === "setPostponed" && req.method === "POST") {
      // Manager-only (même règle que setCancelled).
      const me = await validateCleanerToken(sb, req.headers.get("x-cleaner-token"));
      if (me && me.role !== "manager") return jsonResp({ error: "manager role required" }, 403);
      const body = await req.json();
      const { key, postpone, new_date, original_date, actor } = body;
      if (!key || typeof postpone !== "boolean") return jsonResp({ error: "key and postpone required" }, 400);
      if (postpone) {
        if (!new_date || !original_date) return jsonResp({ error: "new_date and original_date required" }, 400);
        const { error } = await sb.from("cleaning_postponed").upsert({ reservation_key: key, original_date, new_date, postponed_by: actor || "Manager", postponed_at: new Date().toISOString() }, { onConflict: "reservation_key" });
        if (error) throw error;
      } else {
        const { error } = await sb.from("cleaning_postponed").delete().eq("reservation_key", key);
        if (error) throw error;
      }
      await addLog(sb, key, postpone ? "postponed" : "unpostponed", actor, postpone ? { new_date, original_date } : null);
      return jsonResp({ status: "success", key, postpone });
    }

    // ==================== LAUNDRY ====================
    // Comptage du linge sale déclaré en fin de ménage. Ouvert aux cleaners,
    // même règle que addNote : c'est un fait du ménage, pas un privilège.
    if (action === "saveLaundryCount" && req.method === "POST") {
      const body = await req.json();
      const { reservation_key, author } = body;
      if (!reservation_key) return jsonResp({ error: "reservation_key required" }, 400);
      const q = readLaundryQty(body, false);
      if (q.error) return jsonResp({ error: q.error }, 400);
      // counted_on vient du préfixe date de la clé, pas de l'heure de saisie :
      // un ménage du 12 validé à 1h du matin le 13 reste imputé au 12.
      const m = String(reservation_key).match(/^(?:extra_)?(\d{4}-\d{2}-\d{2})_/);
      const counted_on = m ? m[1] : new Date().toISOString().slice(0, 10);
      const { error } = await sb.from("laundry_counts").upsert({
        reservation_key,
        ...q.values,
        counted_on,
        author: author || null,
        updated_at: new Date().toISOString(),
      }, { onConflict: "reservation_key" });
      if (error) throw error;
      await addLog(sb, reservation_key, "laundry_counted", author, q.values);
      return jsonResp({ status: "success" });
    }

    if (action === "getLaundryCount" && req.method === "GET") {
      const key = url.searchParams.get("key");
      if (!key) return jsonResp({ error: "key required" }, 400);
      const { data, error } = await sb.from("laundry_counts")
        .select("*").eq("reservation_key", key).maybeSingle();
      if (error) throw error;
      return jsonResp({ count: data || null });
    }

    // Les comptages du mois descendent bruts (le client agrège), mais les
    // soldes passent par la vue : ils somment tout l'historique, ce qui grossit
    // sans limite et n'a rien à faire dans le navigateur.
    if (action === "getLaundrySummary" && req.method === "GET") {
      const start = url.searchParams.get("start");
      const end = url.searchParams.get("end");
      if (!start || !end) return jsonResp({ error: "start and end required" }, 400);
      // Validation format YYYY-MM-DD, même style que moved_on dans addLaundryMovement.
      const dateRe = /^\d{4}-\d{2}-\d{2}$/;
      if (!dateRe.test(start)) return jsonResp({ error: "start must be YYYY-MM-DD" }, 400);
      if (!dateRe.test(end)) return jsonResp({ error: "end must be YYYY-MM-DD" }, 400);
      // Fenêtre bornée à 31 jours : le navigateur ne demande jamais plus d'un mois.
      const msPerDay = 86_400_000;
      const spanDays = (new Date(end).getTime() - new Date(start).getTime()) / msPerDay;
      if (spanDays < 0 || spanDays > 31) {
        return jsonResp({ error: "window must be between 0 and 31 days" }, 400);
      }
      const counts = await fetchAllRows<any>((from, to) =>
        sb.from("laundry_counts")
          .select(["reservation_key", "counted_on", ...LAUNDRY_FIELDS].join(","))
          .gte("counted_on", start).lte("counted_on", end)
          .order("counted_on").order("reservation_key").range(from, to));
      const { data: bal, error: e2 } = await sb.from("laundry_balances").select("*");
      if (e2) throw e2;
      const byBucket: Record<string, any> = {};
      for (const row of bal || []) byBucket[row.bucket] = row;
      return jsonResp({
        counts: counts || [],
        balances: { store: byBucket.store || null, laundry: byBucket.laundry || null },
      });
    }

    if (action === "getLaundryMovements" && req.method === "GET") {
      const raw = Number(url.searchParams.get("limit"));
      const limit = Number.isInteger(raw) && raw > 0 ? Math.min(raw, 200) : 50;
      const { data, error } = await sb.from("laundry_movements")
        .select("*")
        .order("moved_on", { ascending: false })
        .order("id", { ascending: false })
        .limit(limit);
      if (error) throw error;
      return jsonResp({ movements: data || [] });
    }

    // Manager-only, même règle que setCancelled / setPostponed : ce chiffre est
    // la référence opposée à la blanchisserie, il ne s'écrit pas depuis un compte cleaner.
    if (action === "addLaundryMovement" && req.method === "POST") {
      const me = await validateCleanerToken(sb, req.headers.get("x-cleaner-token"));
      if (me && me.role !== "manager") return jsonResp({ error: "manager role required" }, 403);
      const body = await req.json();
      const { kind, moved_on, note, author } = body;
      if (!["out", "in", "adjust_store", "adjust_laundry"].includes(kind)) {
        return jsonResp({ error: "invalid kind" }, 400);
      }
      if (!moved_on || !/^\d{4}-\d{2}-\d{2}$/.test(String(moved_on))) {
        return jsonResp({ error: "moved_on required (YYYY-MM-DD)" }, 400);
      }
      const q = readLaundryQty(body, String(kind).startsWith("adjust_"));
      if (q.error) return jsonResp({ error: q.error }, 400);
      const { data, error } = await sb.from("laundry_movements").insert({
        kind, ...q.values, moved_on,
        note: note || null,
        author: author || "Manager",
      }).select().single();
      if (error) throw error;
      return jsonResp({ status: "success", movement: data });
    }

    // ==================== CLEANERS ====================
    if (action === "getCleaners") {
      const { data, error } = await sb.from("cleaners").select("*").eq("is_active", true).order("name");
      if (error) throw error;
      return jsonResp({ status: "success", cleaners: data });
    }
    if (action === "saveCleaner" && req.method === "POST") {
      // X-App-Secret est embarqué dans le bundle JS public : insuffisant pour
      // créer/modifier des comptes (PIN inclus → escalade de privilèges). On exige
      // une session valide (X-Cleaner-Token) appartenant à un cleaner role=manager.
      const me = await validateCleanerToken(sb, req.headers.get("x-cleaner-token"));
      if (!me || me.role !== 'manager') {
        return jsonResp({ error: "manager auth required" }, 403);
      }
      const body = await req.json();
      const { id, name, phone, color, pin, role, telegram_chat_id } = body;
      if (!name || typeof name !== 'string' || name.length > 100) return jsonResp({ error: "name required" }, 400);
      if (pin !== undefined && pin !== null && pin !== "" && (typeof pin !== 'string' || !/^\d{3,8}$/.test(pin))) {
        return jsonResp({ error: "pin must be 3-8 digits" }, 400);
      }
      // role : allowlist stricte (valeurs utilisées par le front : select manager/cleaner/maintenance
      // + subcontractor pour Elite). Tout le reste → 400.
      const ALLOWED_ROLES = new Set(['cleaner', 'manager', 'maintenance', 'subcontractor']);
      if (role !== undefined && role !== null && (typeof role !== 'string' || !ALLOWED_ROLES.has(role))) {
        return jsonResp({ error: "invalid role" }, 400);
      }
      // telegram_chat_id : optionnel. Doit être numérique (positif ou négatif pour les groupes).
      let normalizedTgChat: string | null | undefined = undefined;
      if (telegram_chat_id !== undefined) {
        const raw = (telegram_chat_id ?? "").toString().trim();
        if (raw === "") normalizedTgChat = null;
        else if (!/^-?\d{4,16}$/.test(raw)) return jsonResp({ error: "telegram_chat_id must be a numeric chat id" }, 400);
        else normalizedTgChat = raw;
      }
      let cleanerId: number;
      if (id) {
        const upd: any = { name, phone: phone || null, color: color || "#e94560" };
        if (role !== undefined) upd.role = role;
        if (normalizedTgChat !== undefined) upd.telegram_chat_id = normalizedTgChat;
        const { error } = await sb.from("cleaners").update(upd).eq("id", id);
        if (error) throw error;
        cleanerId = Number(id);
      } else {
        const insRow: any = { name, phone: phone || null, color: color || "#e94560", role: role || "cleaner", is_active: true };
        if (normalizedTgChat !== undefined) insRow.telegram_chat_id = normalizedTgChat;
        const { data: inserted, error } = await sb.from("cleaners")
          .insert(insRow)
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
      // Rate limit GLOBAL, persistant en DB : max 25 échecs / 15 min toutes IPs
      // confondues (~5 utilisateurs réels). L'IP venait d'en-têtes falsifiables
      // (x-forwarded-for & co), donc un seuil par IP était contournable — un seuil
      // global tue le brute-force de PIN quel que soit le spoofing de headers.
      const since = new Date(Date.now() - 15 * 60_000).toISOString();
      const { count: failedCount, error: rlErr } = await sb.from("login_attempts")
        .select("*", { count: "exact", head: true })
        .eq("success", false)
        .gte("attempted_at", since);
      if (rlErr) throw rlErr;
      if ((failedCount ?? 0) >= 25) {
        // Message inchangé : le front (app.js) matche cette string exacte pour la traduction.
        return jsonResp({ error: "Too many attempts. Try again in 1 minute." }, 429);
      }
      // Purge opportuniste (fire-and-forget, ne bloque pas le login) : >24h inutile.
      const purgeCutoff = new Date(Date.now() - 24 * 3600_000).toISOString();
      sb.from("login_attempts").delete().lt("attempted_at", purgeCutoff)
        .then(({ error }: any) => { if (error) console.warn("[login_attempts] purge failed:", error); },
              (e: any) => console.warn("[login_attempts] purge failed:", e));
      // Verify PIN via stored proc (bcrypt compare)
      const { data: verifyData, error: verifyErr } = await sb.rpc('verify_cleaner_pin', { p_pin: pin });
      if (verifyErr || !verifyData || verifyData.length === 0) {
        // Hash SHA-256 du PIN tenté (échecs uniquement, pour le debug) — JAMAIS le PIN en clair.
        // Un SHA-256 non salé d'un PIN à 4 chiffres serait réversible : on ne stocke donc
        // jamais le hash d'un PIN valide (login réussi).
        const { error: insErr } = await sb.from("login_attempts")
          .insert({ pin_hash: await sha256Hex(pin), success: false });
        if (insErr) console.warn("[login_attempts] insert failed:", insErr);
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
      const { error: okErr } = await sb.from("login_attempts").insert({ success: true });
      if (okErr) console.warn("[login_attempts] insert failed:", okErr);
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
      const data = await fetchAllRows<any>((from, to) =>
        sb.from("cleaning_assignments").select("reservation_key, cleaner_id, service_type")
          .order("reservation_key").order("cleaner_id").range(from, to));
      // Multi-assign model: each reservation_key maps to an array of cleaner_ids.
      const map: Record<string, number[]> = {};
      const meta: Record<string, Record<string, string>> = {};
      data.forEach((r: any) => {
        if (!map[r.reservation_key]) map[r.reservation_key] = [];
        map[r.reservation_key].push(r.cleaner_id);
        if (!meta[r.reservation_key]) meta[r.reservation_key] = {};
        meta[r.reservation_key][String(r.cleaner_id)] = r.service_type || 'CHC';
      });
      return jsonResp({ status: "success", assignments: map, assignmentMeta: meta });
    }
    if (action === "getSubcontractorPricing") {
      // Retourne la grille active (effective au moment de la requête)
      const { data, error } = await sb.from("subcontractor_pricing")
        .select("subcontractor_cleaner_id, service_type, bedrooms, price_ht, tax_rate, effective_from, effective_to")
        .lte("effective_from", new Date().toISOString().split('T')[0])
        .order("effective_from", { ascending: false });
      if (error) throw error;
      // Filtre côté serveur : ne garde que les prix ENCORE actifs (effective_to null ou futur),
      // et le plus récent par tuple (sub, service, bedrooms).
      const today = new Date().toISOString().split('T')[0];
      const seen = new Set<string>();
      const active: any[] = [];
      for (const row of (data || [])) {
        if (row.effective_to && row.effective_to < today) continue;
        const k = `${row.subcontractor_cleaner_id}|${row.service_type}|${row.bedrooms}`;
        if (seen.has(k)) continue;
        seen.add(k);
        active.push(row);
      }
      return jsonResp({ status: "success", pricing: active });
    }
    if (action === "assignCleaner" && req.method === "POST") {
      const body = await req.json();
      const { reservation_key, cleaner_id, cleaner_ids, mode, actor, service_type } = body;
      if (!reservation_key) return jsonResp({ error: "reservation_key required" }, 400);

      // service_type optionnel : applique à la NOUVELLE row insérée (add/set). Default CHC.
      const ALLOWED_SERVICES = new Set(['CHC','INSTAY','INSTAY_WITH_LINENS','REFRESH','REFRESH_LINEN','CARPET_LAUNDRY','BALCONY','CHC_MATTRESS','STRIP_CLEAN','DEEP_CLEAN','CANCELLED','CANCELLED_WITH_FEE','RECTIFICATION','INSPECTION']);
      const stype = (typeof service_type === 'string' && ALLOWED_SERVICES.has(service_type)) ? service_type : 'CHC';

      // Three modes — all on the same endpoint for backwards-compatibility:
      //   1. mode='set' (default if cleaner_ids passed) — replace the assignment list with cleaner_ids[].
      //      Empty array clears all assignments for the key.
      //   2. mode='add' (default if cleaner_id passed and not already assigned) — append cleaner_id.
      //      Falsy cleaner_id with no cleaner_ids means "clear all" (legacy unassign call).
      //   3. mode='remove' — remove cleaner_id from the assignment list (does not error if absent).
      // Any other shape returns 400.

      const list: number[] | null = Array.isArray(cleaner_ids)
        ? cleaner_ids.map((x: any) => Number(x)).filter((x: number) => Number.isFinite(x) && x > 0)
        : null;
      const single: number | null = (cleaner_id !== undefined && cleaner_id !== null && cleaner_id !== "")
        ? Number(cleaner_id) : null;

      const op = mode || (list !== null ? "set" : (single ? "add" : "clear"));

      // Blocage strict : on n'assigne pas un menage a quelqu'un dont le conge
      // est approuve ce jour-la. La date de la cle (YYYY-MM-DD_guest, ou
      // extra_YYYY-MM-DD_... pour les menages hors Hostaway) n'est qu'un point de
      // depart : un menage reporte garde sa cle figee, sa vraie date est dans
      // cleaning_postponed.new_date.
      const keyDate = dateFromKey(String(reservation_key));
      const candidates: number[] = op === "set"
        ? (Array.isArray(list) ? list.map(Number) : (single ? [Number(single)] : []))
        : (op === "add" && single ? [Number(single)] : []);
      if (keyDate && candidates.length) {
        // Echec ferme aussi sur la lecture des reports : assigner sur une date fausse
        // reviendrait a contourner le blocage strict.
        let cleaningDate = keyDate;
        try {
          const postMap = await loadPostponedDates(sb, [String(reservation_key)]);
          if (postMap[String(reservation_key)]) cleaningDate = postMap[String(reservation_key)];
        } catch (_e) {
          return jsonResp({ error: "Failed to verify the cleaning date" }, 500);
        }
        // Echec ferme : si la lecture echoue, on bloque plutot que d'autoriser en silence.
        const { data: onLeave, error: leaveErr } = await sb.from("leave_requests")
          .select("cleaner_id").eq("status", "approved")
          .in("cleaner_id", candidates)
          .lte("start_date", cleaningDate).gte("end_date", cleaningDate);
        if (leaveErr) return jsonResp({ error: "Failed to verify leave status" }, 500);
        if (onLeave && onLeave.length) {
          const ids = [...new Set(onLeave.map((r: any) => r.cleaner_id))];
          const { data: names } = await sb.from("cleaners").select("name").in("id", ids);
          const who = (names || []).map((n: any) => n.name).join(", ") || "This person";
          return jsonResp({ error: `${who} is on approved leave on ${cleaningDate}` }, 409);
        }
      }

      if (op === "set") {
        // Replace all rows for this key.
        const { error: dErr } = await sb.from("cleaning_assignments").delete().eq("reservation_key", reservation_key);
        if (dErr) throw dErr;
        const newList = list || (single ? [single] : []);
        if (newList.length > 0) {
          const rows = newList.map((cid) => ({ reservation_key, cleaner_id: cid, service_type: stype, assigned_at: new Date().toISOString() }));
          const { error: iErr } = await sb.from("cleaning_assignments").insert(rows);
          if (iErr) throw iErr;
        }
        await addLog(sb, reservation_key, newList.length ? "assigned" : "unassigned", actor, { cleaner_ids: newList, service_type: stype });
      } else if (op === "add") {
        if (!single) return jsonResp({ error: "cleaner_id required for add" }, 400);
        const { error: iErr } = await sb.from("cleaning_assignments")
          .upsert({ reservation_key, cleaner_id: single, service_type: stype, assigned_at: new Date().toISOString() },
                  { onConflict: "reservation_key,cleaner_id" });
        if (iErr) throw iErr;
        await addLog(sb, reservation_key, "assigned", actor, { cleaner_id: single, mode: "add", service_type: stype });
      } else if (op === "update_service_type") {
        // Modif du service_type sans toucher aux assignés
        if (!single) return jsonResp({ error: "cleaner_id required for update_service_type" }, 400);
        const { error: uErr } = await sb.from("cleaning_assignments")
          .update({ service_type: stype }).eq("reservation_key", reservation_key).eq("cleaner_id", single);
        if (uErr) throw uErr;
      } else if (op === "remove") {
        if (!single) return jsonResp({ error: "cleaner_id required for remove" }, 400);
        const { error: dErr } = await sb.from("cleaning_assignments")
          .delete().eq("reservation_key", reservation_key).eq("cleaner_id", single);
        if (dErr) throw dErr;
        await addLog(sb, reservation_key, "unassigned", actor, { cleaner_id: single, mode: "remove" });
      } else if (op === "clear") {
        const { error: dErr } = await sb.from("cleaning_assignments").delete().eq("reservation_key", reservation_key);
        if (dErr) throw dErr;
        await addLog(sb, reservation_key, "unassigned", actor);
      } else {
        return jsonResp({ error: "unknown mode: " + op }, 400);
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
      // Les personnes en conge approuve sur la journee traitee sortent du pool.
      // On charge une fois tous les conges approuves qui touchent la fenetre,
      // puis on filtre par date de menage.
      const { data: leaveRows } = await sb.from("leave_requests")
        .select("cleaner_id, start_date, end_date").eq("status", "approved");
      const isOnLeave = (cid: number, day: string | null) =>
        !!day && (leaveRows || []).some((l: any) =>
          l.cleaner_id === cid && l.start_date <= day && l.end_date >= day);
      // Dates effectives du lot, chargees en une fois avant la boucle. Traitement par
      // lot => echec OUVERT : si la lecture des reports echoue, on retombe sur la date
      // de la cle plutot que de tuer tout le lot.
      let postMap: Record<string, string> = {};
      try {
        postMap = await loadPostponedDates(sb, reservations.map((r: any) => String(r.key)));
      } catch (e) {
        console.warn("[autoAssign] postponed lookup failed, falling back to key dates:", (e as any)?.message);
      }
      const effectiveDay = (key: string) => postMap[String(key)] || dateFromKey(key);
      const { data: existingAssign } = await sb.from("cleaning_assignments").select("reservation_key, cleaner_id");
      // Multi-assign: existingMap[key] is now a Set<cleaner_id>. "Already assigned" =
      // at least one cleaner attached to that key.
      const existingMap: Record<string, Set<number>> = {};
      (existingAssign || []).forEach((r: any) => {
        if (!existingMap[r.reservation_key]) existingMap[r.reservation_key] = new Set();
        existingMap[r.reservation_key].add(r.cleaner_id);
      });
      const load: Record<number, number> = {};
      cls.forEach((c: any) => { load[c.id] = 0; });
      Object.values(existingMap).forEach((set) => set.forEach((cid) => { if (load[cid] !== undefined) load[cid]++; }));
      let assigned = 0;
      for (const r of reservations) {
        if (existingMap[r.key] && existingMap[r.key].size > 0) continue;
        const day = effectiveDay(String(r.key));
        const pool = cls.filter((c: any) => !isOnLeave(c.id, day));
        if (!pool.length) continue; // personne de disponible ce jour-la
        let minLoad = Infinity, minId = pool[0].id;
        for (const c of pool) { if (load[c.id] < minLoad) { minLoad = load[c.id]; minId = c.id; } }
        const { error } = await sb.from("cleaning_assignments")
          .upsert({ reservation_key: r.key, cleaner_id: minId, assigned_at: new Date().toISOString() },
                  { onConflict: "reservation_key,cleaner_id" });
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
      // Re-starting a finished cleaning resets the timer for a fresh run (re-clean, or restart
      // after an accidental stop). The previous run stays in cleaning_log (timer_stopped event).
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
      const data = await fetchAllRows<any>((from, to) =>
        sb.from("cleaning_timer").select("*").order("reservation_key").range(from, to));
      const map: Record<string, any> = {};
      data.forEach((t: any) => { map[t.reservation_key] = t; });
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
    if (action === "getTicketPhoto") {
      const tid = url.searchParams.get("id");
      if (!tid) return jsonResp({ error: "id required" }, 400);
      const { data, error } = await sb.from("maintenance_tickets").select("photo_path, resolution_photo_path").eq("id", Number(tid)).single();
      if (error) throw error;
      const [photo, resolutionPhoto] = await Promise.all([
        getPhotoUrl(sb, data.photo_path),
        getPhotoUrl(sb, data.resolution_photo_path),
      ]);
      return jsonResp({ status: "success", photo, resolutionPhoto });
    }
    if (action === "createTicket" && req.method === "POST") {
      const body = await req.json();
      const { listing_id, equipment_id, title, description, category, priority, assigned_vendor_id, assigned_technician_id, reported_by, photo_data, estimated_cost, source, source_ref } = body;
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
        ...(source ? { source } : {}), source_ref: source_ref || null,
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
      if (month && !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return jsonResp({ error: "month must be YYYY-MM" }, 400);
      let query = sb.from("maintenance_costs").select("*").order("date", { ascending: false }).limit(200);
      if (listingId) query = query.eq("listing_id", listingId);
      // Borne haute exclusive sur le 1er du mois suivant ("-31" est une date invalide
      // pour les mois de 30 jours / février → erreur Postgres).
      if (month) { query = query.gte("date", month + "-01").lt("date", nextMonthISO(month)); }
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
      const data = await fetchAllRows<any>((from, to) =>
        sb.from("maintenance_tickets").select("id, listing_id, category, title, priority, status, created_at")
          .order("created_at", { ascending: false }).order("id").range(from, to));
      // Detect patterns: same listing+category with 2+ tickets in last 90 days
      const patterns: Record<string, any[]> = {};
      data.forEach((t: any) => {
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

      // 4. Get current assignments + cleaners (multi-assign aware)
      const { data: assignData } = await sb.from("cleaning_assignments").select("reservation_key, cleaner_id");
      const existingMap: Record<string, number[]> = {};
      (assignData || []).forEach((r: any) => {
        if (!existingMap[r.reservation_key]) existingMap[r.reservation_key] = [];
        existingMap[r.reservation_key].push(r.cleaner_id);
      });

      const { data: cleanerData } = await sb.from("cleaners").select("*").eq("is_active", true).eq("role", "cleaner").order("name");
      const cls = cleanerData || [];

      // 5. Auto-assign cleanings that have NO cleaner attached yet
      const unassigned = reservations.filter((r: any) => !(existingMap[r.key] && existingMap[r.key].length > 0));
      let newlyAssigned = 0;
      if (unassigned.length > 0 && cls.length > 0) {
        const load: Record<number, number> = {};
        cls.forEach((c: any) => { load[c.id] = 0; });
        Object.values(existingMap).forEach((arr) => arr.forEach((cid) => { if (load[cid] !== undefined) load[cid]++; }));
        // Chargement unique des conges approuves avant la boucle (meme approche qu'autoAssign).
        // En cas d'erreur lecture, on echoue en mode ouvert (le batch ne doit pas mourir
        // pour un conge non verifie) : isOnLeaveAuto retourne false pour tous.
        const { data: apLeaveRows } = await sb.from("leave_requests")
          .select("cleaner_id, start_date, end_date").eq("status", "approved");
        const isOnLeaveAuto = (cid: number, day: string | null) =>
          !!day && (apLeaveRows || []).some((l: any) =>
            l.cleaner_id === cid && l.start_date <= day && l.end_date >= day);
        // Dates effectives (reports) chargees une seule fois avant la boucle.
        // Meme regle d'echec ouvert que le reste de l'autopilote.
        let apPostMap: Record<string, string> = {};
        try {
          apPostMap = await loadPostponedDates(sb, unassigned.map((r: any) => String(r.key)));
        } catch (e) {
          console.warn("[runAutopilot] postponed lookup failed, falling back to key dates:", (e as any)?.message);
        }
        for (const r of unassigned) {
          // Date effective du menage : report eventuel, sinon date de la cle.
          const day2 = apPostMap[String(r.key)] || dateFromKey(String(r.key));
          const pool = cls.filter((c: any) => !isOnLeaveAuto(c.id, day2));
          if (!pool.length) continue; // aucun cleaner disponible ce jour-la, on saute
          let minLoad = Infinity, minId = pool[0].id;
          for (const c of pool) { if (load[c.id] < minLoad) { minLoad = load[c.id]; minId = c.id; } }
          const { error } = await sb.from("cleaning_assignments")
            .upsert({ reservation_key: r.key, cleaner_id: minId, assigned_at: new Date().toISOString() },
                    { onConflict: "reservation_key,cleaner_id" });
          if (!error) { load[minId]++; existingMap[r.key] = [minId]; newlyAssigned++; }
        }
      }

      // 6. Build WhatsApp messages per cleaner — every assigned cleaner gets the task in their list
      const notified: any[] = [];
      const cleanerTasks: Record<number, any[]> = {};
      reservations.forEach((r: any) => {
        const cids = existingMap[r.key] || [];
        cids.forEach((cid: number) => {
          if (!cleanerTasks[cid]) cleanerTasks[cid] = [];
          cleanerTasks[cid].push(r);
        });
        if (cids.length === 0) { /* no cleaner attached, nothing to notify */ }
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

    // ==================== DASHBOARD KPIs ====================
    if (action === "getDashboardKPIs") {
      const month = url.searchParams.get("month"); // YYYY-MM
      if (month && !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return jsonResp({ error: "invalid month, expected YYYY-MM" }, 400);
      // Tri par récence + limit : PostgREST clampe de toute façon à max-rows (1000 par
      // défaut), donc sans ORDER BY la troncature jetterait des lignes arbitraires et
      // fausserait les KPIs fenêtrés (7 jours / mois courant). Trié desc, le cap ne
      // coupe que du vieux.
      const [timerRes, assignRes, doneRes, cleanerRes, ticketRes] = await Promise.all([
        sb.from("cleaning_timer").select("reservation_key, cleaner_id, started_at, finished_at, duration_minutes").not("duration_minutes", "is", null).order("started_at", { ascending: false }).limit(5000),
        sb.from("cleaning_assignments").select("reservation_key, cleaner_id").order("assigned_at", { ascending: false }).limit(5000),
        sb.from("menage_done").select("reservation_key, done, updated_at").order("updated_at", { ascending: false }).limit(5000),
        sb.from("cleaners").select("id, name, color, role").eq("is_active", true).limit(200),
        sb.from("maintenance_tickets").select("id, status, priority, category, created_at, resolved_at").order("created_at", { ascending: false }).limit(5000),
      ]);
      const timers = timerRes.data || [];
      const assigns = assignRes.data || [];
      const dones = doneRes.data || [];
      const clnrs = cleanerRes.data || [];
      const tickets = ticketRes.data || [];

      // Global avg cleaning time
      const durations = timers.map((t: any) => t.duration_minutes).filter((d: number) => d > 0 && d < 480);
      const avgCleaningTime = durations.length > 0 ? Math.round(durations.reduce((a: number, b: number) => a + b, 0) / durations.length) : 0;

      // Per-cleaner performance — multi-assign aware: count any cleaning where the cleaner is in the list.
      const assignMap: Record<string, number[]> = {};
      assigns.forEach((a: any) => {
        if (!assignMap[a.reservation_key]) assignMap[a.reservation_key] = [];
        assignMap[a.reservation_key].push(a.cleaner_id);
      });
      const isAssigned = (key: string, cid: number) => (assignMap[key] || []).includes(cid);
      const cleanerPerf: any[] = clnrs.filter((c: any) => c.role === 'cleaner').map((c: any) => {
        const cTimers = timers.filter((t: any) => isAssigned(t.reservation_key, c.id));
        const cDurations = cTimers.map((t: any) => t.duration_minutes).filter((d: number) => d > 0 && d < 480);
        const cDone = dones.filter((d: any) => d.done && isAssigned(d.reservation_key, c.id));
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
      // Tables qui grossissent à chaque ménage (menage_done, cleaning_assignments,
      // cleaning_timer, cleaning_cancelled) : paginer pour éviter la troncature
      // silencieuse PostgREST à 1000 rows.
      const [doneRows, assignRows, timerRows, cancelledRows, postponedRows, cleanerRes, templateRes, listingRes, ticketRes, vendorRes, equipRes, prevRes, extraRes, leaveRes, holidayRes] = await Promise.all([
        fetchAllRows<any>((from, to) => sb.from("menage_done").select("reservation_key, done").order("reservation_key").range(from, to)),
        fetchAllRows<any>((from, to) => sb.from("cleaning_assignments").select("reservation_key, cleaner_id, service_type").order("reservation_key").order("cleaner_id").range(from, to)),
        fetchAllRows<any>((from, to) => sb.from("cleaning_timer").select("*").order("reservation_key").range(from, to)),
        fetchAllRows<any>((from, to) => sb.from("cleaning_cancelled").select("reservation_key, reason, cancelled_by, cancelled_at").order("reservation_key").range(from, to)),
        fetchAllRows<any>((from, to) => sb.from("cleaning_postponed").select("reservation_key, original_date, new_date, postponed_by, postponed_at").order("reservation_key").range(from, to)),
        sb.from("cleaners").select("*").eq("is_active", true).order("name"),
        sb.from("checklist_templates").select("*").order("name"),
        sb.from("listing_config").select("listing_id, listing_name, bedrooms, price, custom_price, unit_type, apt_number, internal_name"),
        // Active tickets only (anything not closed). The dedicated /refreshMaintenance flow
        // fetches resolved/cancelled separately into resolvedTickets. Returning everything
        // here was the root cause of resolved tickets leaking into the "Open" view.
        sb.from("maintenance_tickets").select("*").not("status", "in", "(resolved,cancelled)").order("created_at", { ascending: false }).limit(200),
        sb.from("vendors").select("*").eq("is_active", true).order("name"),
        sb.from("equipment").select("*").order("listing_id, name"),
        sb.from("preventive_maintenance").select("*").eq("is_active", true).order("next_due_at"),
        sb.from("extra_cleanings").select("*").gte("cleaning_date", new Date(Date.now() - 30*86400000).toISOString().split('T')[0]).lte("cleaning_date", new Date(Date.now() + 60*86400000).toISOString().split('T')[0]).order("cleaning_date"),
        // Conges approuves (J-7 a J+90) : trois colonnes uniquement, le type de conge
        // ne doit jamais atteindre le client cleaner (donnee medicale sensible).
        sb.from("leave_requests")
          .select("cleaner_id, start_date, end_date")
          .eq("status", "approved")
          .gte("end_date", new Date(Date.now() - 7 * 86400000).toISOString().split('T')[0])
          .lte("start_date", new Date(Date.now() + 90 * 86400000).toISOString().split('T')[0]),
        sb.from("public_holidays").select("holiday_date, name")
          .gte("holiday_date", `${new Date().getFullYear()}-01-01`)
          .lte("holiday_date", `${new Date().getFullYear() + 1}-12-31`)
          .order("holiday_date"),
      ]);
      const cancelledMap: Record<string, any> = {};
      cancelledRows.forEach((r: any) => { cancelledMap[r.reservation_key] = { reason: r.reason, cancelled_by: r.cancelled_by, cancelled_at: r.cancelled_at }; });
      const postponedMap: Record<string, any> = {};
      postponedRows.forEach((r: any) => { postponedMap[r.reservation_key] = { original_date: r.original_date, new_date: r.new_date, postponed_by: r.postponed_by, postponed_at: r.postponed_at }; });
      const doneMap: Record<string, boolean> = {};
      doneRows.forEach((r: any) => { doneMap[r.reservation_key] = r.done; });
      // Multi-assign: assignments[reservation_key] is now a number[].
      const assignMap: Record<string, number[]> = {};
      const assignMeta: Record<string, Record<string, string>> = {};
      assignRows.forEach((r: any) => {
        if (!assignMap[r.reservation_key]) assignMap[r.reservation_key] = [];
        assignMap[r.reservation_key].push(r.cleaner_id);
        if (!assignMeta[r.reservation_key]) assignMeta[r.reservation_key] = {};
        assignMeta[r.reservation_key][String(r.cleaner_id)] = r.service_type || 'CHC';
      });
      const listingPrices: Record<string, any> = {};
      (listingRes.data || []).forEach((r: any) => { listingPrices[r.listing_id] = { bedrooms: r.bedrooms, price: r.price, custom_price: r.custom_price, listing_name: r.listing_name, unit_type: r.unit_type, apt_number: r.apt_number, internal_name: r.internal_name }; });
      const timerMap: Record<string, any> = {};
      timerRows.forEach((t: any) => { timerMap[t.reservation_key] = t; });
      return jsonResp({
        status: "success", done: doneMap, assignments: assignMap, assignmentMeta: assignMeta,
        cleaners: cleanerRes.data || [], templates: templateRes.data || [],
        listingPrices, timers: timerMap,
        maintenanceTickets: ticketRes.data || [], vendors: vendorRes.data || [],
        equipment: equipRes.data || [], preventiveMaintenance: prevRes.data || [],
        cancelled: cancelledMap,
        postponed: postponedMap,
        extraCleanings: extraRes.data || [],
        leaves: leaveRes.data || [],
        holidays: holidayRes.data || [],
      });
    }

    // ========== RH : LECTURE ==========
    if (action === "hrOverview") {
      const g = await hrAuth(sb, req, "manager");
      if (g.err) return g.err;
      const today = HR_TODAY();
      const horizon = new Date(Date.now() + 90 * 86400000).toISOString().slice(0, 10);
      const [empRes, pendingRes, upcomingRes, takenRes, docRes, historyRes, holidayRes] = await Promise.all([
        sb.from("employees").select(HR_EMPLOYEE_PUBLIC_COLS).order("hire_date"),
        sb.from("leave_requests").select("id, cleaner_id, leave_type, start_date, end_date, days, status, reason, requested_by, requested_at, decided_by, decided_at, decision_note, updated_at, form_path").eq("status", "pending").order("start_date"),
        sb.from("leave_requests").select("id, cleaner_id, leave_type, start_date, end_date, days, status, reason, requested_by, requested_at, decided_by, decided_at, decision_note, updated_at, form_path").eq("status", "approved").gte("end_date", today).lte("start_date", horizon).order("start_date"),
        sb.from("leave_requests").select("cleaner_id, leave_type, days, start_date, end_date").eq("status", "approved"),
        sb.from("employee_documents").select("*").order("expiry_date", { nullsFirst: false }),
        sb.from("leave_requests").select("id, cleaner_id, leave_type, start_date, end_date, days, status, reason, requested_by, requested_at, decided_by, decided_at, decision_note, updated_at, form_path").order("start_date", { ascending: false }).limit(200),
        sb.from("public_holidays").select("id, holiday_date, name")
          .gte("holiday_date", `${today.slice(0, 4)}-01-01`)
          .lte("holiday_date", `${Number(today.slice(0, 4)) + 1}-12-31`)
          .order("holiday_date"),
      ]);
      // Cumul des jours approuvés par employé et par type, pour que le client
      // puisse afficher un solde sans refaire un aller-retour par personne.
      const taken: Record<string, Record<string, number>> = {};
      (takenRes.data || []).forEach((r: any) => {
        const k = String(r.cleaner_id);
        if (!taken[k]) taken[k] = {};
        taken[k][r.leave_type] = (taken[k][r.leave_type] || 0) + Number(r.days || 0);
      });
      // Documents expirant dans moins de 60 jours ou déjà expirés.
      const horizon60 = new Date(Date.now() + 60 * 86400000).toISOString().slice(0, 10);
      const expiring = (docRes.data || []).filter((d: any) => d.expiry_date && d.expiry_date <= horizon60);
      // Fire and forget : un envoi Telegram lent ne doit pas retarder l'écran.
      const alertsPromise = hrRunExpiryAlerts(sb).catch((e) => console.warn("[hr] expiry alerts failed", e));
      try { (globalThis as any).EdgeRuntime?.waitUntil?.(alertsPromise); } catch (_e) { /* best effort */ }
      return jsonResp({
        status: "success",
        employees: empRes.data || [],
        pending: pendingRes.data || [],
        upcoming: upcomingRes.data || [],
        taken,
        today,
        isOwner: g.isOwner,
        documents: docRes.data || [],
        expiring,
        history: historyRes.data || [],
        holidays: holidayRes.data || [],
      });
    }

    if (action === "hrMyLeave") {
      const g = await hrAuth(sb, req, "staff");
      if (g.err) return g.err;
      const [empRes, reqRes, holidayRes] = await Promise.all([
        sb.from("employees").select(HR_EMPLOYEE_PUBLIC_COLS).eq("cleaner_id", g.me!.cleaner_id).maybeSingle(),
        sb.from("leave_requests").select("id, cleaner_id, leave_type, start_date, end_date, days, status, reason, requested_by, requested_at, decided_by, decided_at, decision_note, updated_at, form_path").eq("cleaner_id", g.me!.cleaner_id).order("start_date", { ascending: false }).limit(100),
        sb.from("public_holidays").select("id, holiday_date, name")
          .gte("holiday_date", `${HR_TODAY().slice(0, 4)}-01-01`)
          .lte("holiday_date", `${Number(HR_TODAY().slice(0, 4)) + 1}-12-31`)
          .order("holiday_date"),
      ]);
      return jsonResp({
        status: "success",
        employee: empRes.data || null,
        requests: reqRes.data || [],
        today: HR_TODAY(),
        holidays: holidayRes.data || [],
      });
    }

    if (action === "hrSubmitLeave" && req.method === "POST") {
      const g = await hrAuth(sb, req, "staff");
      if (g.err) return g.err;
      const body = await req.json();
      const target = Number(body.cleaner_id) || g.me!.cleaner_id;
      // Deposer une demande pour quelqu'un d'autre est une action de manager.
      if (target !== g.me!.cleaner_id && g.me!.role !== "manager") {
        return jsonResp({ error: "manager auth required" }, 403);
      }
      const selfSubmit = target === g.me!.cleaner_id;
      const employeeSignature = hrValidSignature(body.employee_signature);
      if (selfSubmit && !employeeSignature) {
        return jsonResp({ error: "signature required" }, 400);
      }
      const leaveType = String(body.leave_type || "");
      if (!HR_LEAVE_LABELS[leaveType]) return jsonResp({ error: "invalid leave_type" }, 400);
      const start = String(body.start_date || "");
      const end = String(body.end_date || "");
      // days est TOUJOURS recalcule ici : la valeur envoyee par le client est ignoree.
      const days = hrLeaveDays(start, end);
      if (!days) return jsonResp({ error: "invalid date range" }, 400);
      if (days > 365) return jsonResp({ error: "range too long" }, 400);

      const { data: emp } = await sb.from("employees").select("id").eq("cleaner_id", target).maybeSingle();
      if (!emp) return jsonResp({ error: "no employee record for this person" }, 400);

      const { data: clash } = await sb.from("leave_requests")
        .select("id, start_date, end_date, status")
        .eq("cleaner_id", target).in("status", ["pending", "approved"])
        .lte("start_date", end).gte("end_date", start).limit(1);
      if (clash && clash.length) {
        return jsonResp({ error: `Overlaps an existing ${clash[0].status} request (${clash[0].start_date} to ${clash[0].end_date})` }, 409);
      }

      const { data, error } = await sb.from("leave_requests").insert({
        cleaner_id: target, leave_type: leaveType, start_date: start, end_date: end,
        days, status: "pending", reason: body.reason ? String(body.reason).slice(0, 500) : null,
        requested_by: g.me!.name,
        employee_signature: selfSubmit ? employeeSignature : null,
      }).select().single();
      if (error) return jsonResp({ error: error.message }, 500);

      const archivePromise = hrArchiveLeaveForm(sb, data);
      try { (globalThis as any).EdgeRuntime?.waitUntil?.(archivePromise); } catch (_e) { /* best effort */ }

      const { data: who } = await sb.from("cleaners").select("name").eq("id", target).maybeSingle();
      await hrNotifyManagers(sb,
        `\u{1F334} <b>Leave request</b>\n${(who && who.name) || "Someone"} - ${HR_LEAVE_LABELS[leaveType]}\n${start} to ${end} (${days} day${days > 1 ? "s" : ""})` +
        (body.reason ? `\nReason: ${String(body.reason).slice(0, 200)}` : ""));
      return jsonResp({ status: "success", request: data });
    }

    if (action === "hrDecideLeave" && req.method === "POST") {
      const g = await hrAuth(sb, req, "manager");
      if (g.err) return g.err;
      const body = await req.json();
      const id = Number(body.id);
      const decision = String(body.decision || "");
      if (!id) return jsonResp({ error: "id required" }, 400);
      if (decision !== "approved" && decision !== "rejected") return jsonResp({ error: "invalid decision" }, 400);
      const managerSignature = decision === "approved" ? hrValidSignature(body.manager_signature) : null;
      if (decision === "approved" && !managerSignature) {
        return jsonResp({ error: "manager signature required" }, 400);
      }

      const { data: lr } = await sb.from("leave_requests").select("*").eq("id", id).maybeSingle();
      if (!lr) return jsonResp({ error: "request not found" }, 404);
      if (lr.status !== "pending") return jsonResp({ error: `request already ${lr.status}` }, 409);
      // Un manager ne valide pas sa propre demande. Seul le CEO (isOwner) le peut.
      if (lr.cleaner_id === g.me!.cleaner_id && !g.isOwner) {
        return jsonResp({ error: "you cannot decide your own request" }, 403);
      }

      if (decision === "approved") {
        const { data: clash } = await sb.from("leave_requests")
          .select("id, start_date, end_date").eq("cleaner_id", lr.cleaner_id).eq("status", "approved")
          .lte("start_date", lr.end_date).gte("end_date", lr.start_date).limit(1);
        if (clash && clash.length) {
          return jsonResp({ error: `Overlaps an approved leave (${clash[0].start_date} to ${clash[0].end_date})` }, 409);
        }
      }

      const { data, error } = await sb.from("leave_requests").update({
        status: decision, decided_by: g.me!.name, decided_at: new Date().toISOString(),
        decision_note: body.note ? String(body.note).slice(0, 500) : null,
        updated_at: new Date().toISOString(),
        manager_signature: managerSignature,
      }).eq("id", id).eq("status", "pending").select().single();
      if (error) return jsonResp({ error: error.message }, 500);
      if (!data) return jsonResp({ error: "request already decided" }, 409);

      const archivePromise = hrArchiveLeaveForm(sb, data);
      try { (globalThis as any).EdgeRuntime?.waitUntil?.(archivePromise); } catch (_e) { /* best effort */ }

      await hrNotifyCleaner(sb, lr.cleaner_id,
        `${decision === "approved" ? "✅" : "❌"} <b>Leave ${decision}</b>\n${HR_LEAVE_LABELS[lr.leave_type] || "Leave"}: ${lr.start_date} to ${lr.end_date} (${lr.days} day${Number(lr.days) > 1 ? "s" : ""})\nBy ${g.me!.name}` +
        (body.note ? `\nNote: ${String(body.note).slice(0, 200)}` : ""));
      return jsonResp({ status: "success", request: data });
    }

    if (action === "hrCancelLeave" && req.method === "POST") {
      const g = await hrAuth(sb, req, "staff");
      if (g.err) return g.err;
      const id = Number((await req.json()).id);
      if (!id) return jsonResp({ error: "id required" }, 400);

      const { data: lr } = await sb.from("leave_requests").select("*").eq("id", id).maybeSingle();
      if (!lr) return jsonResp({ error: "request not found" }, 404);
      const isMine = lr.cleaner_id === g.me!.cleaner_id;
      const isManager = g.me!.role === "manager";
      if (!isMine && !isManager) return jsonResp({ error: "not your request" }, 403);
      // Un salarie n'annule que ses demandes encore en attente. Un manager peut
      // aussi annuler un conge deja approuve : c'est la soupape qui debloque
      // une assignation refusee par le blocage strict.
      if (!isManager && lr.status !== "pending") return jsonResp({ error: "only pending requests can be cancelled" }, 409);
      if (lr.status === "cancelled" || lr.status === "rejected") return jsonResp({ error: `already ${lr.status}` }, 409);

      const { data, error } = await sb.from("leave_requests").update({
        status: "cancelled", decided_by: g.me!.name, decided_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }).eq("id", id).select().single();
      if (error) return jsonResp({ error: error.message }, 500);

      if (!isMine) {
        await hrNotifyCleaner(sb, lr.cleaner_id,
          `\u{1F6AB} <b>Leave cancelled</b>\n${HR_LEAVE_LABELS[lr.leave_type] || "Leave"}: ${lr.start_date} to ${lr.end_date}\nBy ${g.me!.name}`);
      }
      return jsonResp({ status: "success", request: data });
    }

    if (action === "hrLeaveForm") {
      const g = await hrAuth(sb, req, "staff");
      if (g.err) return g.err;
      const id = Number(url.searchParams.get("id"));
      if (!id) return jsonResp({ error: "id required" }, 400);
      const { data: lr } = await sb.from("leave_requests").select("*").eq("id", id).maybeSingle();
      if (!lr) return jsonResp({ error: "request not found" }, 404);
      if (g.me!.role !== "manager" && lr.cleaner_id !== g.me!.cleaner_id) {
        return jsonResp({ error: "not your request" }, 403);
      }
      let path = lr.form_path as string | null;
      if (!path) path = await hrArchiveLeaveForm(sb, lr);
      if (!path) return jsonResp({ error: "failed to build the form, try again" }, 500);
      const { data: signed, error } = await sb.storage.from("hr-forms").createSignedUrl(path, 60, { download: `leave-form-${id}.pdf` });
      if (error || !signed?.signedUrl) return jsonResp({ error: "failed to sign the download link" }, 500);
      return jsonResp({ status: "success", url: signed.signedUrl });
    }

    if (action === "hrSaveHoliday" && req.method === "POST") {
      const g = await hrAuth(sb, req, "manager");
      if (g.err) return g.err;
      const body = await req.json();
      const date = String(body.holiday_date || "");
      const name = String(body.name || "").trim().slice(0, 120);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return jsonResp({ error: "invalid holiday_date" }, 400);
      if (!name) return jsonResp({ error: "name required" }, 400);
      const { data, error } = await sb.from("public_holidays")
        .upsert({ holiday_date: date, name }, { onConflict: "holiday_date" })
        .select().single();
      if (error) return jsonResp({ error: error.message }, 500);
      return jsonResp({ status: "success", holiday: data });
    }

    if (action === "hrDeleteHoliday" && req.method === "POST") {
      const g = await hrAuth(sb, req, "manager");
      if (g.err) return g.err;
      const id = Number((await req.json()).id);
      if (!id) return jsonResp({ error: "id required" }, 400);
      const { error } = await sb.from("public_holidays").delete().eq("id", id);
      if (error) return jsonResp({ error: error.message }, 500);
      return jsonResp({ status: "success" });
    }

    // ========== RH : dossier employe ==========
    if (action === "hrSaveEmployee" && req.method === "POST") {
      const g = await hrAuth(sb, req, "manager");
      if (g.err) return g.err;
      const body = await req.json();
      const cleanerId = Number(body.cleaner_id);
      if (!cleanerId) return jsonResp({ error: "cleaner_id required" }, 400);

      const isDate = (v: any) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
      if (!isDate(body.hire_date)) return jsonResp({ error: "hire_date must be YYYY-MM-DD" }, 400);
      if (body.end_date && !isDate(body.end_date)) return jsonResp({ error: "end_date must be YYYY-MM-DD" }, 400);
      const openingDate = isDate(body.opening_date) ? body.opening_date : body.hire_date;
      if (openingDate < body.hire_date) return jsonResp({ error: "opening_date cannot precede hire_date" }, 400);
      if (body.end_date && body.end_date < body.hire_date) return jsonResp({ error: "end_date cannot precede hire_date" }, 400);

      const { data: c } = await sb.from("cleaners").select("id, role").eq("id", cleanerId).maybeSingle();
      if (!c) return jsonResp({ error: "unknown cleaner" }, 404);
      // Les sous-traitants (Elite) ne sont pas des salaries : pas de dossier RH.
      if (c.role === "subcontractor") return jsonResp({ error: "subcontractors have no HR record" }, 400);

      const row: Record<string, any> = {
        cleaner_id: cleanerId,
        hire_date: body.hire_date,
        end_date: body.end_date || null,
        job_title: body.job_title ? String(body.job_title).slice(0, 120) : null,
        nationality: body.nationality ? String(body.nationality).slice(0, 80) : null,
        opening_annual_days: Number(body.opening_annual_days) || 0,
        opening_date: openingDate,
        notes: body.notes ? String(body.notes).slice(0, 2000) : null,
        updated_at: new Date().toISOString(),
      };
      // Les montants ne sont modifiables que par le CEO. Un manager qui poste
      // ces champs les voit simplement ignores : le reste de son edition passe.
      if (g.isOwner) {
        const money = (v: any) => (v === "" || v === null || v === undefined ? null : Number(v));
        ["basic_salary", "housing_allowance", "transport_allowance", "other_allowance"].forEach((k) => {
          if (k in body) {
            const n = money(body[k]);
            if (n !== null && (!Number.isFinite(n) || n < 0)) return;
            row[k] = n;
          }
        });
      }

      const { data, error } = await sb.from("employees")
        .upsert(row, { onConflict: "cleaner_id" })
        .select(HR_EMPLOYEE_PUBLIC_COLS).single();
      if (error) return jsonResp({ error: error.message }, 500);
      return jsonResp({ status: "success", employee: data });
    }

    if (action === "hrDeleteEmployee" && req.method === "POST") {
      // Suppression reservee au CEO : le dossier porte la remuneration et
      // l'historique d'anciennete, sa perte n'est pas rattrapable.
      const g = await hrAuth(sb, req, "owner");
      if (g.err) return g.err;
      const cleanerId = Number((await req.json()).cleaner_id);
      if (!cleanerId) return jsonResp({ error: "cleaner_id required" }, 400);
      const { count } = await sb.from("leave_requests")
        .select("id", { count: "exact", head: true }).eq("cleaner_id", cleanerId);
      if ((count || 0) > 0) return jsonResp({ error: `${count} leave request(s) exist, delete them first` }, 409);
      const { error } = await sb.from("employees").delete().eq("cleaner_id", cleanerId);
      if (error) return jsonResp({ error: error.message }, 500);
      return jsonResp({ status: "success" });
    }

    if (action === "hrSaveDocument" && req.method === "POST") {
      // Création ou mise à jour d'un document employé (passeport, visa, etc.).
      const g = await hrAuth(sb, req, "manager");
      if (g.err) return g.err;
      const body = await req.json();
      const DOC_TYPES = new Set(["passport", "emirates_id", "visa", "labour_card", "medical_insurance", "contract", "other"]);
      if (!DOC_TYPES.has(String(body.doc_type))) return jsonResp({ error: "invalid doc_type" }, 400);
      const cleanerId = Number(body.cleaner_id);
      if (!cleanerId) return jsonResp({ error: "cleaner_id required" }, 400);
      const isDate = (v: any) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
      if (body.issue_date && !isDate(body.issue_date)) return jsonResp({ error: "issue_date must be YYYY-MM-DD" }, 400);
      if (body.expiry_date && !isDate(body.expiry_date)) return jsonResp({ error: "expiry_date must be YYYY-MM-DD" }, 400);

      const row: Record<string, any> = {
        cleaner_id: cleanerId,
        doc_type: String(body.doc_type),
        // Un numéro de document n'a pas à être stocké en entier ici : on garde
        // ce que le manager saisit, borné, et on ne l'affiche qu'aux managers.
        doc_number: body.doc_number ? String(body.doc_number).slice(0, 60) : null,
        issue_date: body.issue_date || null,
        expiry_date: body.expiry_date || null,
        note: body.note ? String(body.note).slice(0, 500) : null,
        updated_at: new Date().toISOString(),
      };
      if (body.id) {
        // Mise a jour d'un document existant.
        // On n'insere pas id dans le payload : la colonne est GENERATED ALWAYS AS IDENTITY,
        // Postgres refuse l'ecriture directe dessus sans OVERRIDING SYSTEM VALUE.
        const docId = Number(body.id);
        const { data, error } = await sb
          .from("employee_documents")
          .update(row)
          .eq("id", docId)
          .select()
          .single();
        // PGRST116 = "The result contains 0 rows" : .single() sur un UPDATE sans correspondance.
        if (error && error.code === "PGRST116") return jsonResp({ error: "document not found" }, 404);
        if (error) return jsonResp({ error: error.message }, 500);
        return jsonResp({ status: "success", document: data });
      } else {
        // Creation d'un nouveau document ; id genere par Postgres.
        const { data, error } = await sb
          .from("employee_documents")
          .insert(row)
          .select()
          .single();
        if (error) return jsonResp({ error: error.message }, 500);
        return jsonResp({ status: "success", document: data });
      }
    }

    if (action === "hrDeleteDocument" && req.method === "POST") {
      // Suppression d'un document employé, réservée aux managers.
      const g = await hrAuth(sb, req, "manager");
      if (g.err) return g.err;
      const id = Number((await req.json()).id);
      if (!id) return jsonResp({ error: "id required" }, 400);
      const { error } = await sb.from("employee_documents").delete().eq("id", id);
      if (error) return jsonResp({ error: error.message }, 500);
      return jsonResp({ status: "success" });
    }

    if (action === "hrCheckExpiries" && req.method === "POST") {
      // Route serveur : un cron VPS peut la déclencher tous les jours sans
      // qu'un manager ait besoin d'ouvrir l'app.
      const sent = await hrRunExpiryAlerts(sb);
      return jsonResp({ status: "success", sent });
    }

    // ========== RH : REMUNERATION (CEO seulement) ==========
    if (action === "hrGetCompensation") {
      // SEULE route du proxy qui renvoie des montants de salaire. Gate owner :
      // les autres managers recoivent 403. Ne jamais elargir ce gate ni ajouter
      // ces colonnes a une autre route.
      const g = await hrAuth(sb, req, "owner");
      if (g.err) return g.err;
      const cleanerId = Number(url.searchParams.get("cleaner_id"));
      if (!cleanerId) return jsonResp({ error: "cleaner_id required" }, 400);
      const { data: emp } = await sb.from("employees")
        .select("cleaner_id, hire_date, end_date, basic_salary, housing_allowance, transport_allowance, other_allowance")
        .eq("cleaner_id", cleanerId).maybeSingle();
      if (!emp) return jsonResp({ error: "no employee record" }, 404);
      // Les conges non payes ne comptent pas dans l'anciennete servant a la gratuity.
      const { data: unpaid } = await sb.from("leave_requests")
        .select("days").eq("cleaner_id", cleanerId).eq("status", "approved").eq("leave_type", "unpaid");
      const unpaidDays = (unpaid || []).reduce((s: number, r: any) => s + Number(r.days || 0), 0);
      const n = (v: any) => Number(v || 0);
      return jsonResp({
        status: "success",
        compensation: {
          cleaner_id: emp.cleaner_id,
          hire_date: emp.hire_date,
          end_date: emp.end_date,
          basic_salary: emp.basic_salary,
          housing_allowance: emp.housing_allowance,
          transport_allowance: emp.transport_allowance,
          other_allowance: emp.other_allowance,
          total: n(emp.basic_salary) + n(emp.housing_allowance) + n(emp.transport_allowance) + n(emp.other_allowance),
          unpaid_days: unpaidDays,
        },
      });
    }

    // ========== PROPERTY HEATMAP ==========
    if (action === "getPropertyHeatmap") {
      // Même logique que getDashboardKPIs : tri desc pour que le cap (limit / max-rows
      // PostgREST) ne tronque que l'historique ancien, pas l'activité récente.
      const [ticketsRes, costsRes, timerRes, assignRes, feedbackRes, listingRes] = await Promise.all([
        sb.from("maintenance_tickets").select("id, listing_id, status, priority, created_at, resolved_at").order("created_at", { ascending: false }).limit(5000),
        sb.from("maintenance_costs").select("listing_id, amount").order("created_at", { ascending: false }).limit(5000),
        sb.from("cleaning_timer").select("reservation_key, duration_minutes").not("duration_minutes", "is", null).order("started_at", { ascending: false }).limit(5000),
        sb.from("cleaning_assignments").select("reservation_key, cleaner_id").order("assigned_at", { ascending: false }).limit(5000),
        sb.from("guest_feedback").select("listing_id, rating").order("created_at", { ascending: false }).limit(5000),
        sb.from("listing_config").select("listing_id, listing_name, bedrooms, price, custom_price").limit(500),
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
        let s = typeof v === "object" ? JSON.stringify(v) : String(v);
        // Neutralise l'injection de formules tableur (=, +, -, @ en début de cellule).
        if (/^[=+\-@]/.test(s)) s = "'" + s;
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
      const timerQuery = (from: number, to: number) => {
        let q = sb.from("cleaning_timer").select("reservation_key, cleaner_id, started_at, finished_at, duration_minutes")
          .order("started_at", { ascending: false }).order("reservation_key");
        if (month) q = q.gte("started_at", month + "-01").lt("started_at", nextMonthISO(month));
        return q.range(from, to);
      };
      const [timerRows, cleanerRes, assignRows, doneRows, cancelRows] = await Promise.all([
        fetchAllRows<any>(timerQuery),
        sb.from("cleaners").select("id, name"),
        fetchAllRows<any>((from, to) => sb.from("cleaning_assignments").select("reservation_key, cleaner_id").order("reservation_key").order("cleaner_id").range(from, to)),
        fetchAllRows<any>((from, to) => sb.from("menage_done").select("reservation_key, done, updated_at").order("reservation_key").range(from, to)),
        fetchAllRows<any>((from, to) => sb.from("cleaning_cancelled").select("reservation_key, reason, cancelled_by, cancelled_at").order("reservation_key").range(from, to)),
      ]);
      const cleanerMap: Record<number, string> = {};
      (cleanerRes.data || []).forEach((c: any) => { cleanerMap[c.id] = c.name; });
      // Multi-assign : agrège TOUS les cleaners co-assignés (avant : un seul, last-wins).
      const assignMap: Record<string, number[]> = {};
      assignRows.forEach((a: any) => {
        if (!assignMap[a.reservation_key]) assignMap[a.reservation_key] = [];
        assignMap[a.reservation_key].push(a.cleaner_id);
      });
      const cleanerNames = (key: string, fallbackId?: number | null): string => {
        const ids = (assignMap[key] && assignMap[key].length > 0) ? assignMap[key] : (fallbackId ? [fallbackId] : []);
        return ids.map((id) => cleanerMap[id] || String(id)).join(" + ");
      };
      const doneMap: Record<string, any> = {};
      doneRows.forEach((d: any) => { doneMap[d.reservation_key] = d; });
      const cancelMap: Record<string, any> = {};
      cancelRows.forEach((c: any) => { cancelMap[c.reservation_key] = c; });
      const rows = timerRows.map((t: any) => {
        const parts = t.reservation_key.split('_');
        const date = parts[0] || '';
        const guest = parts.slice(1).join(' ') || '';
        return {
          checkout_date: date,
          guest_name: guest,
          cleaner: cleanerNames(t.reservation_key, t.cleaner_id),
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
      const extraCsvRows = await fetchAllRows<any>((from, to) => {
        let qExtra = sb.from("extra_cleanings").select("*").order("cleaning_date", { ascending: false }).order("id");
        if (month) qExtra = qExtra.gte("cleaning_date", month + "-01").lt("cleaning_date", nextMonthISO(month));
        return qExtra.range(from, to);
      });
      const extraRows = extraCsvRows.map((e: any) => ({
        checkout_date: e.cleaning_date,
        guest_name: e.guest_name || e.label || 'Extra',
        cleaner: cleanerNames(e.reservation_key),
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

      // Blocage strict AVANT tout write : verifier que le cleaner n'est pas en conge approuve
      // a la date du menage. Le check utilise uniquement des donnees du body, aucune ecriture
      // n'a encore eu lieu, donc un 409 ici ne laisse aucun orphelin dans extra_cleanings.
      if (assigned_cleaner_id) {
        const { data: ecLeave, error: ecLeaveErr } = await sb.from("leave_requests")
          .select("cleaner_id").eq("status", "approved")
          .eq("cleaner_id", assigned_cleaner_id)
          .lte("start_date", cleaning_date).gte("end_date", cleaning_date);
        if (ecLeaveErr) return jsonResp({ error: "Failed to verify leave status" }, 500);
        if (ecLeave && ecLeave.length) {
          const { data: ecNames } = await sb.from("cleaners").select("name").eq("id", assigned_cleaner_id);
          const who = (ecNames && ecNames[0]) ? ecNames[0].name : "This person";
          return jsonResp({ error: `${who} is on approved leave on ${cleaning_date}` }, 409);
        }
      }

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
        // Unique constraint = (reservation_key, cleaner_id) depuis la migration
        // multi_cleaner_per_cleaning — un onConflict "reservation_key" seul fait
        // echouer l'upsert (42P10) et perdait l'assignation en silence.
        const { error: assignErr } = await sb.from("cleaning_assignments").upsert({
          reservation_key, cleaner_id: assigned_cleaner_id, assigned_at: new Date().toISOString(),
        }, { onConflict: "reservation_key,cleaner_id" });
        if (assignErr) throw assignErr;
      }
      await addLog(sb, reservation_key, "extra_created", created_by, { listing_id, label, price_billed, assigned_cleaner_id });
      return jsonResp({ status: "success", extra: data });
    }

    if (action === "updateExtraCleaning" && req.method === "POST") {
      const body = await req.json();
      const { id, label, guest_name, price_billed, cleaner_price, notes, status, cleaning_date, listing_id } = body;
      if (!id) return jsonResp({ error: "id required" }, 400);

      // Blocage strict AVANT tout write, comme addExtraCleaning : deplacer une prestation
      // vers un jour ou son cleaner est en conge approuve doit etre refuse. Sans ce
      // controle, updateExtraCleaning etait la porte derobee du blocage.
      // Assignation unitaire => echec FERME sur toute erreur de lecture.
      // saveExtra renvoie toujours cleaning_date, meme pour une edition de prix ou de
      // notes : ne declencher le controle que si la date change vraiment, sinon toute
      // edition legitime d'une prestation deja posee sur un conge devient impossible.
      if (cleaning_date !== undefined && cleaning_date) {
        const { data: ecRows, error: ecErr } = await sb.from("extra_cleanings")
          .select("reservation_key, cleaning_date").eq("id", id).limit(1);
        if (ecErr) return jsonResp({ error: "Failed to verify leave status" }, 500);
        const ecKey = ecRows && ecRows[0] ? ecRows[0].reservation_key : null;
        const ecOldDate = ecRows && ecRows[0] ? String(ecRows[0].cleaning_date || "") : "";
        if (ecKey && ecOldDate !== String(cleaning_date)) {
          // Date effective : un report deja pose prime sur la nouvelle cleaning_date,
          // exactement comme applyPostponements cote client.
          let effDate = String(cleaning_date);
          try {
            const ecPost = await loadPostponedDates(sb, [ecKey]);
            if (ecPost[ecKey]) effDate = ecPost[ecKey];
          } catch (_e) {
            return jsonResp({ error: "Failed to verify the cleaning date" }, 500);
          }
          const { data: ecAssign, error: ecAssignErr } = await sb.from("cleaning_assignments")
            .select("cleaner_id").eq("reservation_key", ecKey);
          if (ecAssignErr) return jsonResp({ error: "Failed to verify leave status" }, 500);
          const ecIds = [...new Set((ecAssign || []).map((a: any) => Number(a.cleaner_id)))];
          if (ecIds.length) {
            const { data: ecLeave, error: ecLeaveErr } = await sb.from("leave_requests")
              .select("cleaner_id").eq("status", "approved")
              .in("cleaner_id", ecIds)
              .lte("start_date", effDate).gte("end_date", effDate);
            if (ecLeaveErr) return jsonResp({ error: "Failed to verify leave status" }, 500);
            if (ecLeave && ecLeave.length) {
              const ids = [...new Set(ecLeave.map((r: any) => r.cleaner_id))];
              const { data: ecNames } = await sb.from("cleaners").select("name").in("id", ids);
              const who = (ecNames || []).map((n: any) => n.name).join(", ") || "This person";
              return jsonResp({ error: `${who} is on approved leave on ${effDate}` }, 409);
            }
          }
        }
      }

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

    // ==================== TEAM TASKS (to-do partagée multi-rôles) ====================
    // MVP : tout user authentifié peut créer/lire/modifier. La filtration par rôle se fait
    // côté front (manager voit tout, cleaner ne voit que ses tâches). Quand le besoin de
    // permissions plus fines arrivera, ajouter ici un check role-based.
    if (action === "listTeamTasks") {
      const mine = url.searchParams.get("mine") === "1";
      const statusFilter = url.searchParams.get("status") || "open"; // open|in_progress|done|cancelled|all
      const assignedTo = url.searchParams.get("assigned_to");
      const listingId = url.searchParams.get("listing_id");
      const me = await validateCleanerToken(sb, req.headers.get("x-cleaner-token"));
      let q = sb.from("team_tasks").select("*").order("due_at", { ascending: true, nullsFirst: false }).order("created_at", { ascending: false });
      if (statusFilter !== "all") q = q.eq("status", statusFilter);
      if (mine) {
        if (!me) return jsonResp({ error: "auth required" }, 401);
        q = q.eq("assigned_cleaner_id", me.cleaner_id);
      } else if (assignedTo) {
        q = q.eq("assigned_cleaner_id", parseInt(assignedTo, 10));
      }
      if (listingId) q = q.eq("listing_id", listingId);
      const { data, error } = await q;
      if (error) throw error;
      return jsonResp({ status: "success", tasks: data || [] });
    }
    if (action === "getTeamTask") {
      const id = url.searchParams.get("id");
      if (!id) return jsonResp({ error: "id required" }, 400);
      const { data: task, error: tErr } = await sb.from("team_tasks").select("*").eq("id", id).single();
      if (tErr) return jsonResp({ error: tErr.message }, 404);
      const { data: comments, error: cErr } = await sb.from("team_task_comments")
        .select("id, task_id, cleaner_id, body, created_at")
        .eq("task_id", id).order("created_at", { ascending: true });
      if (cErr) throw cErr;
      return jsonResp({ status: "success", task, comments: comments || [] });
    }
    if (action === "createTeamTask" && req.method === "POST") {
      const me = await validateCleanerToken(sb, req.headers.get("x-cleaner-token"));
      if (!me) return jsonResp({ error: "auth required" }, 401);
      const body = await req.json();
      const { title, description, assigned_cleaner_id, priority, due_at, listing_id, category, source, source_ref } = body;
      if (!title || typeof title !== "string" || !title.trim()) {
        return jsonResp({ error: "title required" }, 400);
      }
      // Idempotence : si source_ref fourni et déjà présent en DB, retourne la tâche existante (pas de doublon).
      if (source_ref && typeof source_ref === "string") {
        const { data: existing } = await sb.from("team_tasks").select("*").eq("source_ref", source_ref).maybeSingle();
        if (existing) {
          return jsonResp({ status: "success", task: existing, deduplicated: true });
        }
      }
      const row: Record<string, any> = {
        title: title.trim(),
        description: description ?? null,
        priority: priority || "normal",
        source: source || "manual",
        category: category ?? null,
        listing_id: listing_id ?? null,
        assigned_cleaner_id: assigned_cleaner_id ?? null,
        created_by_cleaner_id: me.cleaner_id,
        due_at: due_at ?? null,
        source_ref: source_ref ?? null,
      };
      const { data, error } = await sb.from("team_tasks").insert(row).select().single();
      if (error) {
        // Cas de course : une autre requête a inséré le même source_ref entre notre check et l'insert.
        // L'index unique partiel renvoie 23505. On retourne la tâche maintenant présente.
        if (error.code === "23505" && source_ref) {
          const { data: existing } = await sb.from("team_tasks").select("*").eq("source_ref", source_ref).single();
          if (existing) return jsonResp({ status: "success", task: existing, deduplicated: true });
        }
        throw error;
      }
      // Notif Telegram à l'assigné (si chat_id configuré) — side-effect, fail-soft
      notifyAssignee(sb, data).catch(e => console.warn("[notifyAssignee create]", e));
      return jsonResp({ status: "success", task: data });
    }
    if (action === "updateTeamTask" && req.method === "POST") {
      const me = await validateCleanerToken(sb, req.headers.get("x-cleaner-token"));
      if (!me) return jsonResp({ error: "auth required" }, 401);
      const body = await req.json();
      const { id } = body;
      if (!id) return jsonResp({ error: "id required" }, 400);
      // Récupérer l'ancien assigné pour détecter une réassignation
      const { data: prev } = await sb.from("team_tasks").select("assigned_cleaner_id").eq("id", id).single();
      const prevAssignee = prev?.assigned_cleaner_id ?? null;
      const allowed = ["title", "description", "status", "priority", "category", "listing_id", "assigned_cleaner_id", "due_at"];
      const upd: Record<string, any> = {};
      for (const k of allowed) if (k in body) upd[k] = body[k];
      if (upd.status === "done") {
        upd.completed_at = new Date().toISOString();
        upd.completed_by_cleaner_id = me.cleaner_id;
      } else if ("status" in upd && upd.status !== "done") {
        upd.completed_at = null;
        upd.completed_by_cleaner_id = null;
      }
      const { data, error } = await sb.from("team_tasks").update(upd).eq("id", id).select().single();
      if (error) throw error;
      // Notif Telegram uniquement si réassignation vers un NOUVEAU cleaner (pas si on update juste le titre)
      if (data && data.assigned_cleaner_id && data.assigned_cleaner_id !== prevAssignee) {
        notifyAssignee(sb, data).catch(e => console.warn("[notifyAssignee reassign]", e));
      }
      return jsonResp({ status: "success", task: data });
    }
    if (action === "completeTeamTask" && req.method === "POST") {
      const me = await validateCleanerToken(sb, req.headers.get("x-cleaner-token"));
      if (!me) return jsonResp({ error: "auth required" }, 401);
      const body = await req.json();
      const { id } = body;
      if (!id) return jsonResp({ error: "id required" }, 400);
      const { data, error } = await sb.from("team_tasks")
        .update({ status: "done", completed_at: new Date().toISOString(), completed_by_cleaner_id: me.cleaner_id })
        .eq("id", id).select().single();
      if (error) throw error;
      return jsonResp({ status: "success", task: data });
    }
    // ========== DISPATCH monitoring_events → team_tasks ==========
    // Job système : scan les events Hostaway pas encore examinés et crée les tâches selon
    // règles métier. Idempotent via source_ref. Auth = X-App-Secret uniquement (pas besoin
    // d'un cleaner token, c'est le serveur qui s'appelle lui-même via cron VPS).
    if (action === "dispatchPendingEvents" && req.method === "POST") {
      const body = await req.json().catch(() => ({}));
      const limit = Math.min(Number(body.limit) || 50, 200);

      // Lookup cleaners par nom (plus robuste que hardcoder les ids)
      const { data: cleanersData } = await sb.from("cleaners")
        .select("id, name").eq("is_active", true);
      const cmap = new Map<string, number>();
      (cleanersData || []).forEach((c: any) => cmap.set(c.name.trim().toLowerCase(), c.id));
      const ids = {
        HILLAL: cmap.get("hillal") ?? null,
        WALTER: cmap.get("walter") ?? null,
        HARLENE: cmap.get("harlene") ?? null,
        SEMAX: cmap.get("semax") ?? null,
        AGENT: cmap.get("medini ceo agent") ?? null,
      };

      const { data: events, error: evErr } = await sb.from("monitoring_events")
        .select("*")
        .eq("task_dispatched", false)
        .order("received_at", { ascending: true })
        .limit(limit);
      if (evErr) throw evErr;

      const results: any = {
        scanned: events?.length || 0,
        dispatched: 0,
        ignored: 0,
        errors: 0,
        tasks: [] as any[],
      };

      for (const ev of events || []) {
        let decision: any = null;
        try {
          decision = decideTaskFromEvent(ev, ids);
        } catch (e) {
          console.warn(`[dispatch] decide failed ev=${ev.id}:`, e);
        }

        // Marquer dispatché si : ignoré, déjà créé, insert OK, ou doublon (23505).
        // Une VRAIE erreur d'insert laisse task_dispatched=false pour retenter au
        // prochain run (avant : l'event était perdu définitivement).
        let markDispatched = true;
        if (decision) {
          const sourceRef = `monit:${ev.id}`;
          // Upsert idempotent
          const { data: existing } = await sb.from("team_tasks").select("id").eq("source_ref", sourceRef).maybeSingle();
          if (existing) {
            // Déjà créée (re-run safe)
          } else {
            const row = {
              ...decision,
              source: "system",
              source_ref: sourceRef,
              created_by_cleaner_id: ids.AGENT,
            };
            const { data: newTask, error: insErr } = await sb.from("team_tasks").insert(row).select().single();
            if (insErr) {
              if (insErr.code !== "23505") {
                results.errors++;
                markDispatched = false;
                console.warn(`[dispatch] insert failed ev=${ev.id}:`, insErr);
              }
            } else {
              results.dispatched++;
              results.tasks.push({ event_id: ev.id, task_id: newTask.id, title: newTask.title, assignee_id: newTask.assigned_cleaner_id });
              notifyAssignee(sb, newTask).catch(e => console.warn("[notif dispatch]", e));
            }
          }
        } else {
          results.ignored++;
        }

        if (markDispatched) {
          await sb.from("monitoring_events")
            .update({ task_dispatched: true, task_dispatched_at: new Date().toISOString() })
            .eq("id", ev.id);
        }
      }

      return jsonResp({ status: "success", ...results });
    }

    // ========== DISPATCH maintenance_tickets → team_tasks ==========
    // Tickets maintenance ouverts, non assignés, créés depuis < N jours → tâche Semax.
    // Auth via X-App-Secret seul. Idempotent via source_ref=maint:{id}.
    if (action === "dispatchMaintenance" && req.method === "POST") {
      const body = await req.json().catch(() => ({}));
      const lookbackDays = Math.min(Number(body.lookback_days) || 3, 30);
      const limit = Math.min(Number(body.limit) || 50, 200);

      // Lookup Semax + agent system
      const { data: cleanersData } = await sb.from("cleaners")
        .select("id, name").eq("is_active", true);
      const cmap = new Map<string, number>();
      (cleanersData || []).forEach((c: any) => cmap.set(c.name.trim().toLowerCase(), c.id));
      const SEMAX = cmap.get("semax") ?? null;
      const AGENT = cmap.get("medini ceo agent") ?? null;
      if (!SEMAX) return jsonResp({ error: "Semax cleaner introuvable" }, 500);

      const sinceIso = new Date(Date.now() - lookbackDays * 86400_000).toISOString();
      const { data: tickets, error: tErr } = await sb.from("maintenance_tickets")
        .select("id, listing_id, title, description, category, priority, apartment_mention, sla_deadline, created_at, guest_risk")
        .eq("status", "open")
        .is("assigned_technician_id", null)
        .is("assigned_vendor_id", null)
        .or("to_confirm.is.null,to_confirm.eq.false")
        .gte("created_at", sinceIso)
        .order("created_at", { ascending: false })
        .limit(limit);
      if (tErr) throw tErr;

      const results: any = { scanned: tickets?.length || 0, dispatched: 0, deduped: 0, errors: 0, tasks: [] };

      // Mapping priorité ticket → team_task
      const prioMap: Record<string, string> = {
        urgent: "urgent", high: "high", medium: "normal", normal: "normal", low: "low",
      };
      // Échéance par défaut si pas de sla_deadline
      const dueFromPriority = (p: string): string => {
        const hours = p === "urgent" ? 24 : p === "high" ? 48 : 72;
        return new Date(Date.now() + hours * 3600_000).toISOString();
      };

      for (const t of tickets || []) {
        const sourceRef = `maint:${t.id}`;
        // Idempotence : skip si tâche existe déjà
        const { data: existing } = await sb.from("team_tasks").select("id").eq("source_ref", sourceRef).maybeSingle();
        if (existing) { results.deduped++; continue; }

        const tPriority = prioMap[(t.priority || "normal").toLowerCase()] || "normal";
        const titlePrefix = tPriority === "urgent" ? "🚨" : "🔧";
        const aptHint = t.apartment_mention || "";
        const row: Record<string, any> = {
          title: `${titlePrefix} ${t.title}`,
          description: [
            t.description?.trim() || "",
            t.category ? `Category: ${t.category}` : "",
            t.guest_risk ? `⚠ Guest risk: ${t.guest_risk}` : "",
            `Ticket #${t.id}` + (aptHint ? ` · ${aptHint}` : ""),
          ].filter(Boolean).join("\n"),
          priority: tPriority,
          source: "system",
          source_ref: sourceRef,
          category: "maintenance",
          listing_id: t.listing_id || null,
          assigned_cleaner_id: SEMAX,
          created_by_cleaner_id: AGENT,
          due_at: t.sla_deadline || dueFromPriority(tPriority),
        };

        const { data: newTask, error: insErr } = await sb.from("team_tasks").insert(row).select().single();
        if (insErr) {
          if (insErr.code === "23505") {
            results.deduped++;
          } else {
            results.errors++;
            console.warn(`[dispatchMaintenance] insert failed ticket=${t.id}:`, insErr);
          }
          continue;
        }
        results.dispatched++;
        results.tasks.push({ ticket_id: t.id, task_id: newTask.id, title: newTask.title, priority: newTask.priority });
        notifyAssignee(sb, newTask).catch(e => console.warn("[notif maintenance]", e));
      }

      return jsonResp({ status: "success", ...results });
    }

    // ========== REVIEWS + HERMES cache (synced from VPS) ==========
    // sync* actions : push from VPS, upsert rows. Auth via X-App-Secret only
    // (system job, no cleaner token). Bulk: up to a few hundred rows per call.
    if (action === "syncReviewsCache" && req.method === "POST") {
      const body = await req.json().catch(() => ({}));
      const rows: any[] = Array.isArray(body.rows) ? body.rows : [];
      if (rows.length === 0) return jsonResp({ status: "success", upserted: 0 });
      // Chunk to stay safely under any Supabase row limits
      const CHUNK = 200;
      let upserted = 0;
      for (let i = 0; i < rows.length; i += CHUNK) {
        const slice = rows.slice(i, i + CHUNK).map((r: any) => ({
          id: Number(r.id),
          listing_id: r.listing_id ?? null,
          listing_name: r.listing_name ?? null,
          reservation_id: r.reservation_id ?? null,
          type: r.type ?? null,
          rating: r.rating != null ? Number(r.rating) : null,
          reviewer_name: r.reviewer_name ?? null,
          public_review: r.public_review ?? null,
          reviewee_response: r.reviewee_response ?? null,
          submitted_at: r.submitted_at ?? null,
          arrival_date: r.arrival_date ?? null,
          departure_date: r.departure_date ?? null,
          channel_id: r.channel_id ?? null,
          is_hidden: !!r.is_hidden,
          is_cancelled: !!r.is_cancelled,
          synced_at: new Date().toISOString(),
        }));
        const { error } = await sb.from("reviews_cache").upsert(slice, { onConflict: "id" });
        if (error) throw error;
        upserted += slice.length;
      }
      return jsonResp({ status: "success", upserted });
    }
    if (action === "syncHermesActionsCache" && req.method === "POST") {
      const body = await req.json().catch(() => ({}));
      const rows: any[] = Array.isArray(body.rows) ? body.rows : [];
      if (rows.length === 0) return jsonResp({ status: "success", upserted: 0 });
      const CHUNK = 200;
      let upserted = 0;
      for (let i = 0; i < rows.length; i += CHUNK) {
        const slice = rows.slice(i, i + CHUNK).map((r: any) => ({
          id: Number(r.id),
          ts: r.ts,
          handler: r.handler,
          category: r.category ?? null,
          level: r.level ?? null,
          status: r.status ?? null,
          summary: r.summary ?? null,
          tg_message_id: r.tg_message_id != null ? Number(r.tg_message_id) : null,
          payload_json: r.payload_json ?? {},
          // Métriques LLM (depuis migration extend_hermes_actions_cache_llm_metrics)
          input_tokens: r.input_tokens != null ? Number(r.input_tokens) : null,
          output_tokens: r.output_tokens != null ? Number(r.output_tokens) : null,
          cost_usd_est: r.cost_usd_est != null ? Number(r.cost_usd_est) : null,
          latency_ms: r.latency_ms != null ? Number(r.latency_ms) : null,
          llm_model: r.llm_model ?? null,
          trigger: r.trigger ?? null,
          synced_at: new Date().toISOString(),
        }));
        const { error } = await sb.from("hermes_actions_cache").upsert(slice, { onConflict: "id" });
        if (error) throw error;
        upserted += slice.length;
      }
      return jsonResp({ status: "success", upserted });
    }
    if (action === "getRecentReviews") {
      const days = Math.min(Number(url.searchParams.get("days") || 30), 90);
      const filter = url.searchParams.get("filter") || "all"; // all | unanswered | low_rated
      const since = new Date(Date.now() - days * 86400_000).toISOString();
      let q = sb.from("reviews_cache").select("*")
        .gte("submitted_at", since)
        .eq("is_hidden", false).eq("is_cancelled", false)
        .order("submitted_at", { ascending: false }).limit(500);
      if (filter === "unanswered") {
        q = q.or("reviewee_response.is.null,reviewee_response.eq.");
      } else if (filter === "low_rated") {
        q = q.lte("rating", 6);
      }
      const { data, error } = await q;
      if (error) throw error;
      return jsonResp({ status: "success", reviews: data || [] });
    }
    if (action === "getDisputes") {
      // Base = review_disputes (every analyzed dispute, ~180 days). reviews_cache only
      // mirrors ~30 days, so it can't drive the list. We merge the cache when the review
      // is still mirrored there: it gives the freshest text and the is_hidden/is_cancelled
      // signal used to drop reviews Airbnb already pulled.
      const { data: disputes, error: e1 } = await sb.from("review_disputes").select("*")
        .order("submitted_at", { ascending: false, nullsFirst: false }).limit(500);
      if (e1) throw e1;
      const ids = (disputes || []).map((d: any) => d.review_id);
      let cache: any[] = [];
      if (ids.length) {
        const { data: c, error: e2 } = await sb.from("reviews_cache").select("*").in("id", ids).limit(500);
        if (e2) throw e2;
        cache = c || [];
      }
      const cById = new Map(cache.map((c: any) => [c.id, c]));
      const rows = (disputes || [])
        .filter((d: any) => {
          const c = cById.get(d.review_id);
          return !(c && (c.is_hidden || c.is_cancelled));
        })
        .map((d: any) => {
          const c = cById.get(d.review_id) || {};
          return {
            id: d.review_id,
            rating: c.rating ?? d.rating,
            listing_name: c.listing_name ?? d.listing_name,
            reviewer_name: c.reviewer_name ?? d.reviewer_name,
            public_review: c.public_review ?? d.public_review,
            submitted_at: c.submitted_at ?? d.submitted_at,
            reservation_id: c.reservation_id ?? d.reservation_id,
            dispute: d,
          };
        });
      return jsonResp({ status: "success", reviews: rows });
    }

    if (action === "updateDisputeStatus" && req.method === "POST") {
      const body = await req.json();
      const { review_id, dispute_status, reply_posted, updated_by } = body;
      if (!review_id) return jsonResp({ error: "review_id required" }, 400);
      const allowed = new Set(["todo", "submitted", "removed", "rejected", "not_disputable"]);
      const upd: Record<string, any> = { review_id: Number(review_id), updated_at: new Date().toISOString() };
      if (dispute_status !== undefined) {
        if (!allowed.has(dispute_status)) return jsonResp({ error: "invalid dispute_status" }, 400);
        upd.dispute_status = dispute_status;
      }
      if (reply_posted !== undefined) upd.reply_posted = !!reply_posted;
      if (updated_by !== undefined) upd.updated_by = String(updated_by).slice(0, 40);
      // UPDATE (not upsert): the analysis row already exists (created by the daily
      // syncDisputeAnalysis job). An upsert would fire the BEFORE INSERT trigger on its
      // insert attempt, and since this payload omits `removable` the trigger would read
      // the column default (false) and clobber dispute_status to 'not_disputable'.
      const { data, error } = await sb.from("review_disputes")
        .update(upd).eq("review_id", Number(review_id)).select().maybeSingle();
      if (error) throw error;
      if (!data) return jsonResp({ error: "review not analyzed yet" }, 404);
      return jsonResp({ status: "success", dispute: data });
    }

    if (action === "syncDisputeAnalysis" && req.method === "POST") {
      // Server-only : push from the daily Claude Max classifier job.
      const body = await req.json().catch(() => ({}));
      const rows: any[] = Array.isArray(body.rows) ? body.rows : [];
      if (rows.length === 0) return jsonResp({ status: "success", upserted: 0 });
      const slice = rows.map((r: any) => ({
        review_id: Number(r.review_id),
        reservation_id: r.reservation_id != null ? Number(r.reservation_id) : null,
        removable: !!r.removable,
        confidence: r.confidence ?? null,
        ground: r.ground ?? null,
        template: r.template != null ? Number(r.template) : null,
        quote: r.quote ?? null,
        angle: r.angle ?? null,
        evidence: Array.isArray(r.evidence) ? r.evidence : [],
        public_reply: r.public_reply ?? null,
        public_review_en: r.public_review_en ?? null,
        proposal_count: r.proposal_count != null ? Number(r.proposal_count) : 0,
        last_proposed: r.last_proposed ?? null,
        listing_name: r.listing_name ?? null,
        reviewer_name: r.reviewer_name ?? null,
        rating: r.rating != null ? Number(r.rating) : null,
        public_review: r.public_review ?? null,
        submitted_at: r.submitted_at ?? null,
        analyzed_at: new Date().toISOString(),
      }));
      // NB: payload omits dispute_status/reply_posted/updated_by so UPDATE never
      // clobbers a human-set status; INSERT lets the trigger set the initial status.
      const { error } = await sb.from("review_disputes").upsert(slice, { onConflict: "review_id" });
      if (error) throw error;
      return jsonResp({ status: "success", upserted: slice.length });
    }

    if (action === "getAnalyzedDisputeIds") {
      // Server-only : all review_ids already classified (analyzed_at set), unbounded by
      // reviews_cache. The daily job uses this to skip re-classifying — getDisputes is
      // limited to the 30-day reviews_cache mirror and would force needless re-runs.
      const data = await fetchAllRows<any>((from, to) =>
        sb.from("review_disputes").select("review_id").not("analyzed_at", "is", null)
          .order("review_id").range(from, to));
      return jsonResp({ status: "success", ids: data.map((r: any) => r.review_id) });
    }
    if (action === "getHermesActivity") {
      const days = Math.min(Number(url.searchParams.get("days") || 3), 7);
      const handler = url.searchParams.get("handler");
      const status = url.searchParams.get("status");
      const since = new Date(Date.now() - days * 86400_000).toISOString();
      let q = sb.from("hermes_actions_cache").select("*").gte("ts", since)
        .order("ts", { ascending: false }).limit(200);
      if (handler) q = q.eq("handler", handler);
      if (status) q = q.eq("status", status);
      const { data, error } = await q;
      if (error) throw error;
      return jsonResp({ status: "success", actions: data || [] });
    }
    // ========== CLEANING ACCOUNTING (Elite subcontractor) ==========
    // Read : current data for a month. Returns the cached snapshot computed by VPS handler.
    if (action === "getCleaningAccounting") {
      const month = url.searchParams.get("month");  // YYYY-MM
      if (!month || !/^\d{4}-\d{2}$/.test(month)) {
        return jsonResp({ error: "month param required (YYYY-MM)" }, 400);
      }
      const { data, error } = await sb.from("cleaning_accounting_cache")
        .select("*").eq("month", month).maybeSingle();
      if (error) throw error;
      return jsonResp({ status: "success", month, data: data || null });
    }
    // List all months that have cached data (for the month picker)
    if (action === "listCleaningAccountingMonths") {
      const { data, error } = await sb.from("cleaning_accounting_cache")
        .select("month, rows_count, unmatched_count, computed_at, totals_json")
        .order("month", { ascending: false });
      if (error) throw error;
      return jsonResp({ status: "success", months: data || [] });
    }
    // Write : VPS handler pushes computed snapshot.
    if (action === "syncCleaningAccounting" && req.method === "POST") {
      const body = await req.json().catch(() => ({}));
      const month = body.month;
      if (!month || !/^\d{4}-\d{2}$/.test(month)) {
        return jsonResp({ error: "month required (YYYY-MM)" }, 400);
      }
      const row = {
        month,
        payload_json: body.payload_json ?? {},
        totals_json: body.totals_json ?? {},
        rows_count: Number(body.rows_count || 0),
        unmatched_count: Number(body.unmatched_count || 0),
        computed_at: new Date().toISOString(),
        synced_at: new Date().toISOString(),
      };
      const { error } = await sb.from("cleaning_accounting_cache").upsert(row, { onConflict: "month" });
      if (error) throw error;
      return jsonResp({ status: "success", month, rows_count: row.rows_count });
    }

    // ========== CLEANER RATINGS (notes propreté par cleaner) ==========
    if (action === "getCleanerRatings") {
      const { data, error } = await sb.from("cleaner_ratings_cache")
        .select("*").eq("id", 1).maybeSingle();
      if (error) throw error;
      return jsonResp({ status: "success", data: data || null });
    }
    if (action === "syncCleanerRatings" && req.method === "POST") {
      const body = await req.json().catch(() => ({}));
      const row = {
        id: 1,
        payload_json: body.payload_json ?? {},
        cleaners_count: Number(body.cleaners_count || 0),
        unmatched_count: Number(body.unmatched_count || 0),
        computed_at: new Date().toISOString(),
        synced_at: new Date().toISOString(),
      };
      const { error } = await sb.from("cleaner_ratings_cache").upsert(row, { onConflict: "id" });
      if (error) throw error;
      return jsonResp({ status: "success", cleaners_count: row.cleaners_count });
    }

    // ========== HERMES COMMANDS (HK Planner → VPS bridge) ==========
    // Insert a command for the VPS poller to pick up. Authenticated via cleaner token
    // so we can log who initiated each action (Hillal, Walter, etc.).
    if (action === "submitHermesCommand" && req.method === "POST") {
      const me = await validateCleanerToken(sb, req.headers.get("x-cleaner-token"));
      const body = await req.json();
      const { command, target, payload } = body;
      const allowedCommands = new Set(["approve_action", "reject_action", "run_handler"]);
      if (!command || !allowedCommands.has(command)) return jsonResp({ error: "invalid command" }, 400);
      if (!target || typeof target !== "string") return jsonResp({ error: "target required" }, 400);
      const row = {
        command,
        target,
        payload: payload && typeof payload === "object" ? payload : {},
        status: "pending" as const,
        created_by: me?.name || "manager",
      };
      const { data, error } = await sb.from("hermes_commands").insert(row).select().single();
      if (error) throw error;
      return jsonResp({ status: "success", command: data });
    }
    if (action === "getHermesCommands") {
      // Lookup status of recently submitted commands (poll from UI to confirm exec)
      const target = url.searchParams.get("target");
      const status = url.searchParams.get("status");
      const limit = Math.min(Number(url.searchParams.get("limit") || 30), 200);
      let q = sb.from("hermes_commands").select("*").order("created_at", { ascending: false }).limit(limit);
      if (target) q = q.eq("target", target);
      if (status) q = q.eq("status", status);
      const { data, error } = await q;
      if (error) throw error;
      return jsonResp({ status: "success", commands: data || [] });
    }
    // ========== MAC COMMANDS (Hermes VPS → Mac launchd) ==========
    if (action === "submitMacCommand" && req.method === "POST") {
      const body = await req.json();
      const { command, payload, created_by } = body;
      const allowed = new Set(["push_claude_creds"]);
      if (!command || !allowed.has(command)) return jsonResp({ error: "invalid command" }, 400);
      const row = {
        command,
        payload: payload && typeof payload === "object" ? payload : {},
        status: "pending" as const,
        created_by: created_by || "system",
      };
      const { data, error } = await sb.from("mac_commands").insert(row).select().single();
      if (error) throw error;
      return jsonResp({ status: "success", command: data });
    }
    if (action === "getMacCommands") {
      const status = url.searchParams.get("status");
      const limit = Math.min(Number(url.searchParams.get("limit") || 30), 100);
      let q = sb.from("mac_commands").select("*").order("created_at", { ascending: false }).limit(limit);
      if (status) q = q.eq("status", status);
      const { data, error } = await q;
      if (error) throw error;
      return jsonResp({ status: "success", commands: data || [] });
    }
    if (action === "updateMacCommand" && req.method === "POST") {
      const body = await req.json();
      const { id, status: newStatus, result } = body;
      if (!id) return jsonResp({ error: "id required" }, 400);
      const allowed = new Set(["pending", "processing", "done", "failed"]);
      if (!allowed.has(newStatus)) return jsonResp({ error: "invalid status" }, 400);
      const upd: Record<string, any> = { status: newStatus };
      if (result !== undefined) upd.result = result;
      if (newStatus === "done" || newStatus === "failed") upd.processed_at = new Date().toISOString();
      const { data, error } = await sb.from("mac_commands").update(upd).eq("id", id).select().single();
      if (error) throw error;
      return jsonResp({ status: "success", command: data });
    }

    if (action === "updateHermesCommand" && req.method === "POST") {
      // Called by VPS poller to mark a command as processing/done/failed
      const body = await req.json();
      const { id, status: newStatus, result } = body;
      if (!id) return jsonResp({ error: "id required" }, 400);
      const allowed = new Set(["pending", "processing", "done", "failed"]);
      if (!allowed.has(newStatus)) return jsonResp({ error: "invalid status" }, 400);
      const upd: Record<string, any> = { status: newStatus };
      if (result !== undefined) upd.result = result;
      if (newStatus === "done" || newStatus === "failed") upd.processed_at = new Date().toISOString();
      const { data, error } = await sb.from("hermes_commands").update(upd).eq("id", id).select().single();
      if (error) throw error;
      return jsonResp({ status: "success", command: data });
    }

    if (action === "addTeamTaskComment" && req.method === "POST") {
      const me = await validateCleanerToken(sb, req.headers.get("x-cleaner-token"));
      if (!me) return jsonResp({ error: "auth required" }, 401);
      const body = await req.json();
      const { task_id, body: text } = body;
      if (!task_id || !text || !text.trim()) return jsonResp({ error: "task_id and body required" }, 400);
      const { data, error } = await sb.from("team_task_comments")
        .insert({ task_id, cleaner_id: me.cleaner_id, body: text.trim() }).select().single();
      if (error) throw error;
      return jsonResp({ status: "success", comment: data });
    }

    return jsonResp({ error: "Unknown action" }, 400);
  } catch (error: unknown) {
    // HttpError = message volontairement user-facing (ex. Hostaway down) → relayé tel quel.
    if (error instanceof HttpError) {
      return jsonResp({ error: error.message }, error.status);
    }
    // Tout le reste (erreurs Postgres, bugs…) : log complet côté serveur, réponse
    // générique au client avec un id de corrélation pour retrouver le log.
    const errorId = crypto.randomUUID().slice(0, 8);
    console.error(`[hostaway-proxy] unhandled error id=${errorId}:`, error);
    return jsonResp({ error: "Internal error", error_id: errorId }, 500);
  }
});

