// Ingestion des problemes de maintenance tires des messages des guests (phase 1,
// serveur seulement). Idempotente par message : un rejeu ne cree rien. Une seule
// proposition en attente par conversation et categorie ; un nouveau message y
// ajoute une citation. Chaque probleme est une seule ecriture, donc rien n'est
// ecrit a moitie ; une erreur de base arrete le lot avec un 503.
import { appendQuote, dedupKey, type IngestIssue, type MntUrgency, parseIngest } from "./mnt_rules.ts";
import { MGR_OPEN_TICKET_STATUSES } from "./mgr_inbox.ts";

export type IngestDeps = { nowMs?: number; notifyUrgent?: (p: { id: number; title: string; listingId: string | null }) => void };
type IngestBody = { created: number[]; appended: number[]; skipped: number };

const RANK: Record<MntUrgency, number> = { normal: 1, high: 2, urgent: 3 };
const higher = (a: MntUrgency, b: MntUrgency): MntUrgency => (RANK[b] > RANK[a] ? b : a);

class Retry extends Error {}

function rowsOrThrow(r: { data: any; error: any }, what: string): any[] {
  if (r.error) throw new Error("[mnt_ingest] " + what + ": " + (r.error.message ?? String(r.error)));
  return Array.isArray(r.data) ? r.data : (r.data ? [r.data] : []);
}

// Ticket ouvert le plus recent du meme logement et de la meme categorie (texte libre, compare en minuscules).
async function openTicketFor(sb: any, it: IngestIssue): Promise<number | null> {
  if (!it.listingId) return null;
  const rows = rowsOrThrow(
    await sb.from("maintenance_tickets").select("id, category, status")
      .eq("listing_id", it.listingId).in("status", MGR_OPEN_TICKET_STATUSES),
    "maintenance_tickets",
  );
  let best: number | null = null;
  for (const t of rows) {
    if (String(t.category ?? "").toLowerCase() !== it.category) continue;
    const id = Number(t.id);
    if (best === null || id > best) best = id;
  }
  return best;
}

type Outcome = { kind: "skipped" } | { kind: "created" | "appended"; id: number; notify: boolean; title: string };

async function ingestOne(sb: any, it: IngestIssue, nowIso: string): Promise<Outcome> {
  const key = dedupKey(it.conversationId, it.category);
  const quote = { message_id: it.messageId, at: it.at, text: it.quote };
  const rows = rowsOrThrow(
    await sb.from("maintenance_proposals").select("id, status, urgency, quotes, title, dedup_key, updated_at")
      .eq("conversation_id", it.conversationId).eq("category", it.category),
    "maintenance_proposals",
  );
  const quotesOf = (r: any) => (Array.isArray(r.quotes) ? r.quotes : []);
  if (rows.some((r) => quotesOf(r).some((q: any) => String(q?.message_id) === it.messageId))) return { kind: "skipped" };

  const pending = rows.find((r) => r.status === "pending" && r.dedup_key === key);
  if (pending) {
    const { quotes, added } = appendQuote(quotesOf(pending), quote);
    const before = (pending.urgency ?? "normal") as MntUrgency;
    const urgency = RANK[before] ? higher(before, it.urgency) : it.urgency;
    // Citation plus ancienne que les MNT_QUOTES_MAX gardees : elle tombe, mais son urgence
    // compte quand meme. Ni citation ni urgence nouvelle : rien a ecrire.
    if (!added && urgency === before) return { kind: "skipped" };
    // Verrou optimiste sur updated_at lu : un autre ajout entre la lecture et l'ecriture
    // donne 0 ligne, et on recommence depuis la lecture (aucune citation perdue).
    let upd = sb.from("maintenance_proposals").update(added ? { quotes, urgency, updated_at: nowIso } : { urgency, updated_at: nowIso })
      .eq("id", pending.id).eq("status", "pending");
    upd = pending.updated_at == null ? upd.is("updated_at", null) : upd.eq("updated_at", pending.updated_at);
    const hit = rowsOrThrow(await upd.select("id"), "maintenance_proposals update");
    // Decidee ou modifiee entre la lecture et l'ecriture : on recommence depuis la lecture.
    if (!hit.length) throw new Retry();
    return {
      kind: "appended", id: Number(pending.id), title: String(pending.title ?? it.title),
      notify: urgency === "urgent" && before !== "urgent",
    };
  }

  const openTicketId = await openTicketFor(sb, it);
  const ins = await sb.from("maintenance_proposals").insert({
    listing_id: it.listingId, reservation_id: it.reservationId, conversation_id: it.conversationId,
    guest_name: it.guestName, stay_from: it.stayFrom, stay_to: it.stayTo, title: it.title,
    category: it.category, urgency: it.urgency, quotes: [quote], status: "pending",
    open_ticket_id: openTicketId, dedup_key: key, created_at: nowIso, updated_at: nowIso,
  }).select("id");
  // Course sur l'index unique partiel : une autre ingestion vient de creer la proposition.
  if (ins.error && String(ins.error.code) === "23505") throw new Retry();
  const created = rowsOrThrow(ins, "maintenance_proposals insert");
  if (!created.length) throw new Error("[mnt_ingest] maintenance_proposals insert: no row");
  return { kind: "created", id: Number(created[0].id), title: it.title, notify: it.urgency === "urgent" };
}

export async function mntIngest(
  sb: any, body: any, deps: IngestDeps = {},
): Promise<{ status: number; body: IngestBody | { error: string } }> {
  const parsed = parseIngest(body);
  if ("error" in parsed) return { status: 400, body: { error: parsed.error } };
  const nowIso = new Date(deps.nowMs ?? Date.now()).toISOString();
  const out: IngestBody = { created: [], appended: [], skipped: 0 };
  for (const it of parsed.issues) {
    let res: Outcome | null = null;
    try {
      for (let attempt = 0; attempt < 2 && !res; attempt++) {
        try {
          res = await ingestOne(sb, it, nowIso);
        } catch (e) {
          if (!(e instanceof Retry) || attempt === 1) throw e instanceof Retry ? new Error("[mnt_ingest] retry exhausted") : e;
        }
      }
    } catch (e) {
      console.error("[mnt_ingest]", it.conversationId, it.messageId, e instanceof Error ? e.message : e);
      return { status: 503, body: { error: "Could not save proposals." } };
    }
    if (!res || res.kind === "skipped") { out.skipped++; continue; }
    (res.kind === "created" ? out.created : out.appended).push(res.id);
    if (res.notify && deps.notifyUrgent) {
      try {
        deps.notifyUrgent({ id: res.id, title: res.title, listingId: it.listingId });
      } catch (e) {
        console.error("[mnt_ingest] notifyUrgent", res.id, e instanceof Error ? e.message : e);
      }
    }
  }
  return { status: 200, body: out };
}
