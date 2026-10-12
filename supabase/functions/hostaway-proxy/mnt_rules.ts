// Regles pures de la section Maintenance (phase 1, serveur). Aucune base, aucun
// reseau : acces, categories, ingestion des problemes et citations vivent ici.

export const MNT_CATEGORIES = ["ac", "plumbing", "electrical", "appliance", "lock_door", "wifi_tv", "hot_water", "pest", "furniture", "other"] as const;
export type MntCategory = typeof MNT_CATEGORIES[number];
export const MNT_URGENCIES = ["urgent", "high", "normal"] as const;
export type MntUrgency = typeof MNT_URGENCIES[number];
export const MNT_REJECT_REASONS = ["not_maintenance", "already_fixed", "duplicate", "other"] as const;
export const MNT_ROLES = ["manager", "maintenance"] as const;

export const MNT_CATEGORY_LABEL: Record<MntCategory, string> = {
  ac: "AC", plumbing: "Plumbing", electrical: "Electrical", appliance: "Appliance",
  lock_door: "Lock or door", wifi_tv: "Wi-Fi or TV", hot_water: "Hot water", pest: "Pests",
  furniture: "Furniture", other: "Other",
};

export const MNT_TITLE_MAX = 120;
export const MNT_TEXT_MAX = 2000;
export const MNT_QUOTE_MAX = 600;
export const MNT_QUOTES_MAX = 10;
const MNT_INGEST_MAX = 50;

// Comme mgrAccess : hasBearer = en-tete Authorization: Bearer present ; un Bearer
// invalide donne me = null (401), jamais de repli sur le PIN.
export function mntAccess(hasBearer: boolean, me: { role: string } | null): { ok: true } | { ok: false; status: number; error: string } {
  if (!me) return { ok: false, status: 401, error: "auth required" };
  if (!hasBearer) return { ok: false, status: 403, error: "email sign-in required" };
  if (!(MNT_ROLES as readonly string[]).includes(me.role)) return { ok: false, status: 403, error: "forbidden" };
  return { ok: true };
}

export function priorityFor(u: MntUrgency): "urgent" | "high" | "medium" {
  return u === "urgent" ? "urgent" : u === "high" ? "high" : "medium";
}

export function proposalRef(id: number): string {
  return "PRP-" + id;
}

export function dedupKey(conversationId: string, category: MntCategory): string {
  return conversationId + "|" + category;
}

// Le jour du depart compte encore comme « en sejour ».
export function guestInNow(p: { stay_from: string | null; stay_to: string | null }, today: string): boolean {
  if (!p.stay_from || !p.stay_to) return false;
  return p.stay_from <= today && today <= p.stay_to;
}

export type IngestIssue = {
  conversationId: string; messageId: string; at: string; listingId: string | null; reservationId: string | null;
  guestName: string | null; stayFrom: string | null; stayTo: string | null; title: string;
  category: MntCategory; urgency: MntUrgency; quote: string;
};

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const isDay = (s: string) => DAY_RE.test(s) && !Number.isNaN(Date.parse(s + "T00:00:00Z"));
const ISO_DT_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;

export function parseIngest(body: any): { issues: IngestIssue[] } | { error: string } {
  const list = body?.issues;
  if (!Array.isArray(list)) return { error: "Invalid issues." };
  if (list.length > MNT_INGEST_MAX) return { error: "Too many issues." };
  const out: IngestIssue[] = [];
  for (let i = 0; i < list.length; i++) {
    const it = list[i];
    const bad = (f: string) => ({ error: "Invalid issue " + (i + 1) + ": " + f + "." });
    if (!it || typeof it !== "object") return bad("item");
    const str = (v: unknown) => (typeof v === "string" || typeof v === "number" ? String(v).trim() : "");
    const optStr = (v: unknown): string | null => {
      const s = str(v);
      return s ? s : null;
    };
    const conversationId = str(it.conversationId);
    if (!conversationId) return bad("conversationId");
    const messageId = str(it.messageId);
    if (!messageId) return bad("messageId");
    const at = typeof it.at === "string" ? it.at.trim() : "";
    if (!ISO_DT_RE.test(at) || Number.isNaN(Date.parse(at))) return bad("at");
    const title = str(it.title).slice(0, MNT_TITLE_MAX).trim();
    if (!title) return bad("title");
    if (!(MNT_CATEGORIES as readonly string[]).includes(it.category)) return bad("category");
    if (!(MNT_URGENCIES as readonly string[]).includes(it.urgency)) return bad("urgency");
    const quote = str(it.quote).slice(0, MNT_QUOTE_MAX).trim();
    if (!quote) return bad("quote");
    const days: Record<string, string | null> = {};
    for (const f of ["stayFrom", "stayTo"]) {
      const v = it[f];
      if (v === null || v === undefined || v === "") { days[f] = null; continue; }
      if (typeof v !== "string" || !isDay(v)) return bad(f);
      days[f] = v;
    }
    out.push({
      conversationId, messageId, at, listingId: optStr(it.listingId), reservationId: optStr(it.reservationId),
      guestName: optStr(it.guestName), stayFrom: days.stayFrom, stayTo: days.stayTo, title,
      category: it.category, urgency: it.urgency, quote,
    });
  }
  return { issues: out };
}

type Quote = { message_id: string; at: string; text: string };

// Pas de doublon sur message_id ; on garde les MNT_QUOTES_MAX plus recentes, tri par date croissante.
export function appendQuote(quotes: Quote[], q: Quote): { quotes: Quote[]; added: boolean } {
  if (quotes.some((x) => x.message_id === q.message_id)) return { quotes, added: false };
  const all = [...quotes, q].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  return { quotes: all.slice(-MNT_QUOTES_MAX), added: true };
}
