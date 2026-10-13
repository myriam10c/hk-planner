// Fiche Maintenance (phase 2, ecran manager) : mnt.get rend un ticket (MNT-n) ou une
// proposition (PRP-n) avec son detail, mnt.photo depose une photo sur un ticket.
// Les lignes reprennent les constructeurs de mnt_read.ts : la fiche et la liste
// montrent exactement les memes champs. Toute erreur de lecture rend un 503.
import type { SessionUser } from "./auth.ts";
import { ddmm } from "./mgr_rules.ts";
import { MGR_CLOSED_TICKET_STATUSES, MGR_OPEN_TICKET_STATUSES, problemRef } from "./mgr_inbox.ts";
import { readAllRows } from "./mgr_today.ts";
import {
  MNT_PROPOSAL_COLS, MNT_TICKET_COLS, MNT_UNAVAILABLE, mntCtx, type MntProposalRow, mntProposalRow, type MntTicketRow,
  mntTicketRow,
} from "./mnt_read.ts";
import { type ActionResult, todayDubai, V3_PHOTO_BUCKET } from "./v3.ts";
import { uploadPhoto } from "./v3_photos.ts";

export type MntHistoryItem = { at: string; who: string; kind: "guest" | "comment" | "event"; text: string; photoUrl: string | null };
export type MntTicketDetail = MntTicketRow & {
  description: string | null; history: MntHistoryItem[];
  photos: Array<{ url: string; at: string }>; resolutionPhotoUrl: string | null; proposal: MntProposalRow | null;
};
export type MntProposalDetail = MntProposalRow & {
  sameListingOpen: Array<{ id: number; ref: string; title: string; category: string | null }>;
};
type GetBody = { kind: "ticket"; ticket: MntTicketDetail } | { kind: "proposal"; proposal: MntProposalDetail } | { error: string };

export const MNT_SIGN_SECONDS = 3600;
const NOT_FOUND = "Not found.";

export function parseMntRef(ref: unknown): { kind: "MNT" | "PRP"; id: number } | null {
  if (typeof ref !== "string") return null;
  const m = ref.trim().toUpperCase().match(/^(MNT|PRP)-(\d{1,9})$/);
  if (!m) return null;
  const id = Number(m[2]);
  return id > 0 ? { kind: m[1] as "MNT" | "PRP", id } : null;
}

const str = (v: unknown): string | null => (v === null || v === undefined || String(v).trim() === "" ? null : String(v));

// Signature par lot (un seul createSignedUrls par fiche, comme l'ancienne fiche
// Problems). Seuls des chemins du bucket sont signes : ni http(s), ni data (revue
// finale #9). Un lot rate rend {} : la fiche s'affiche sans les photos.
export type MntSigner = (paths: string[]) => Promise<Record<string, string>>;
export function bucketSigner(sb: any): MntSigner {
  return async (paths) => {
    const { data, error } = await sb.storage.from(V3_PHOTO_BUCKET).createSignedUrls(paths, MNT_SIGN_SECONDS);
    if (error || !Array.isArray(data)) return {};
    const out: Record<string, string> = {};
    for (const d of data) if (d && d.signedUrl && !d.error) out[String(d.path)] = String(d.signedUrl);
    return out;
  };
}
const storagePath = (p: unknown): string | null => {
  const s = String(p ?? "").trim();
  return !s || /^[a-z][a-z0-9+.-]*:/i.test(s) ? null : s;
};
async function signAll(signer: MntSigner, raw: unknown[]): Promise<(p: unknown) => string | null> {
  const paths = [...new Set(raw.map(storagePath).filter((p): p is string => p !== null))];
  let urls: Record<string, string> = {};
  if (paths.length) {
    try {
      urls = (await signer(paths)) ?? {};
    } catch (e) {
      console.warn("[mnt_get] signature des photos ratee: " + String((e as any)?.message ?? e));
    }
  }
  return (p) => {
    const s = storagePath(p);
    return s && urls[s] ? String(urls[s]) : null;
  };
}

// Ligne de journal mnt_* en phrase lisible. Rend null pour ce qui est deja montre
// ailleurs (un commentaire est lu dans ticket_comments).
function eventText(action: string, d: any): string | null {
  switch (action) {
    case "mnt_ticket.create":
    case "mnt_proposal.accept":
      return "created the ticket";
    case "mnt_proposal.merge":
      return d.proposalId ? "added guest messages from PRP-" + d.proposalId : "added guest messages";
    case "mnt_ticket.start": return "started";
    case "mnt_ticket.waiting_parts": return "set waiting parts";
    case "mnt_ticket.done": return "closed the ticket";
    case "mnt_ticket.reopen": return "reopened";
    case "mnt_ticket.edit_closed": return "edited the closing details";
    case "mnt_ticket.assign": return d.to ? "assigned to " + String(d.to) : "unassigned";
    case "mnt_ticket.due": return d.date ? "set due date " + ddmm(String(d.date)) : "removed the due date";
    case "mnt_ticket.comment": return null;
    default: return action.replace(/^mnt_(ticket|proposal)\./, "").replace(/[._]/g, " ");
  }
}

// Tri stable par date : une date illisible part a la fin, l'ordre d'arrivee departage.
function byTime<T extends { at: string }>(xs: T[]): T[] {
  return xs.map((x, i) => ({ x, i, t: Date.parse(x.at) }))
    .sort((a, b) => (Number.isFinite(a.t) ? a.t : Infinity) - (Number.isFinite(b.t) ? b.t : Infinity) || a.i - b.i)
    .map((e) => e.x);
}

async function refs(sb: any) {
  const page = (table: string, cols: string) =>
    readAllRows((a: number, b: number) => sb.from(table).select(cols).order("id").range(a, b), table);
  const [listingRows, people, vendorRows] = await Promise.all([
    readAllRows((a: number, b: number) => sb.from("listing_config").select("listing_id, internal_name, listing_name, apt_number")
      .order("listing_id").range(a, b), "listing_config"),
    page("cleaners", "id, name, role, is_active"),
    page("vendors", "id, name, is_active"),
  ]);
  return { listingRows, people, vendorRows };
}

async function one(sb: any, table: string, cols: string, id: number): Promise<any | null> {
  const { data, error } = await sb.from(table).select(cols).eq("id", id).maybeSingle();
  if (error) throw error;
  return data ?? null;
}

const isOpen = (t: any) => t && (MGR_OPEN_TICKET_STATUSES as readonly string[]).includes(String(t.status));

async function ticketDetail(sb: any, t: any, today: string, signer: MntSigner): Promise<MntTicketDetail> {
  const id = Number(t.id);
  const pid = t.proposal_id === null || t.proposal_id === undefined || t.proposal_id === "" ? null : Number(t.proposal_id);
  const [r, comments, logs, shots, prop] = await Promise.all([
    refs(sb),
    readAllRows((a: number, b: number) => sb.from("ticket_comments").select("id, author, comment, created_at, photo_path")
      .eq("ticket_id", id).order("id").range(a, b), "ticket_comments"),
    readAllRows((a: number, b: number) => sb.from("cleaning_log").select("id, action, actor, details, created_at")
      .eq("reservation_key", "ticket_" + id).order("id").range(a, b), "cleaning_log"),
    readAllRows((a: number, b: number) => sb.from("photos").select("id, storage_path, cleaner_id, kind, created_at")
      .eq("ticket_id", id).order("id").range(a, b), "photos"),
    pid ? one(sb, "maintenance_proposals", MNT_PROPOSAL_COLS, pid) : Promise.resolve(null),
  ]);
  const byId = (xs: any[]) => xs.slice().sort((a, b) => Number(a.id) - Number(b.id));
  const mntLogs = byId(logs).filter((l: any) => String(l.action ?? "").startsWith("mnt_"));
  // Auteur de la cloture : dernier mnt_ticket.done, comme dans la liste.
  const resolvedBy: Record<string, string> = {};
  for (const l of byTime(mntLogs.map((l: any) => ({ ...l, at: String(l.created_at ?? "") })))) {
    if (l.action === "mnt_ticket.done" && str(l.actor)) resolvedBy["ticket_" + id] = String(l.actor);
  }
  // Le ticket ouvert d'une proposition liee peut etre ce ticket meme.
  const openById: Record<string, any> = {};
  if (prop && prop.open_ticket_id != null) {
    const ot = Number(prop.open_ticket_id) === id ? t : await one(sb, "maintenance_tickets", "id, title, status", Number(prop.open_ticket_id));
    if (isOpen(ot)) openById[String(ot.id)] = ot;
  }
  const ctx = mntCtx(r.listingRows, r.people, r.vendorRows, { today, openById, resolvedBy });
  const isDone = (MGR_CLOSED_TICKET_STATUSES as readonly string[]).includes(String(t.status));
  const row = mntTicketRow(t, ctx, isDone);

  const pics = byId(shots).filter((s: any) => String(s.kind ?? "photo") !== "voice");
  // Photo du signalement d'origine, si elle n'est pas deja une ligne de photos.
  const reported = t.photo_path && !pics.some((s: any) => String(s.storage_path) === String(t.photo_path)) ? t.photo_path : null;
  const sign = await signAll(signer, [...pics.map((s: any) => s.storage_path), ...comments.map((c: any) => c.photo_path),
    t.resolution_photo_path, reported]);
  const picUrls = pics.map((s: any) => sign(s.storage_path));
  const commentUrls = comments.map((c: any) => sign(c.photo_path));
  const resolutionPhotoUrl = sign(t.resolution_photo_path);
  const reportedUrl = reported ? sign(reported) : null;
  const who = (cid: unknown) => (cid === null || cid === undefined ? "Unknown" : ctx.names[String(cid)] ?? "Member " + cid);

  const history: MntHistoryItem[] = [];
  comments.forEach((c: any, i: number) => {
    const author = String(c.author ?? "").trim() || "Unknown";
    history.push({
      at: String(c.created_at ?? ""), who: author, kind: author.toLowerCase() === "guest" ? "guest" : "comment",
      text: String(c.comment ?? ""), photoUrl: commentUrls[i],
    });
  });
  for (const l of mntLogs) {
    const text = eventText(String(l.action), l.details && typeof l.details === "object" ? l.details : {});
    if (text === null) continue;
    history.push({ at: String(l.created_at ?? ""), who: str(l.actor) ?? "Unknown", kind: "event", text, photoUrl: null });
  }
  pics.forEach((s: any, i: number) => {
    history.push({ at: String(s.created_at ?? ""), who: who(s.cleaner_id), kind: "event", text: "added a photo", photoUrl: picUrls[i] });
  });

  const photos: Array<{ url: string | null; at: string }> = [];
  if (reportedUrl) photos.push({ url: reportedUrl, at: String(t.created_at ?? "") });
  pics.forEach((s: any, i: number) => photos.push({ url: picUrls[i], at: String(s.created_at ?? "") }));

  return {
    ...row, description: str(t.description), history: byTime(history),
    photos: byTime(photos.filter((p) => p.url)) as Array<{ url: string; at: string }>,
    resolutionPhotoUrl, proposal: prop ? mntProposalRow(prop, ctx) : null,
  };
}

async function proposalDetail(sb: any, p: any, today: string): Promise<MntProposalDetail> {
  const lid = str(p.listing_id);
  const [r, same] = await Promise.all([
    refs(sb),
    lid
      ? readAllRows((a: number, b: number) => sb.from("maintenance_tickets").select("id, title, category, status")
        .eq("listing_id", lid).in("status", MGR_OPEN_TICKET_STATUSES).order("id").range(a, b), "maintenance_tickets")
      : Promise.resolve([]),
  ]);
  const openById: Record<string, any> = Object.fromEntries(same.map((t: any) => [String(t.id), t]));
  if (p.open_ticket_id != null && !openById[String(p.open_ticket_id)]) {
    const ot = await one(sb, "maintenance_tickets", "id, title, status", Number(p.open_ticket_id));
    if (isOpen(ot)) openById[String(ot.id)] = ot;
  }
  const ctx = mntCtx(r.listingRows, r.people, r.vendorRows, { today, openById });
  return {
    ...mntProposalRow(p, ctx),
    sameListingOpen: same.slice().sort((a: any, b: any) => Number(a.id) - Number(b.id)).map((t: any) => ({
      id: Number(t.id), ref: problemRef("MNT", Number(t.id)), title: String(t.title ?? "Ticket"), category: str(t.category),
    })),
  };
}

export async function mntGet(
  sb: any, ref: string, o: { nowMs?: number; signUrls?: MntSigner } = {},
): Promise<{ status: number; body: GetBody }> {
  const p = parseMntRef(ref);
  if (!p) return { status: 400, body: { error: "Invalid reference." } };
  const today = todayDubai(o.nowMs ?? Date.now());
  try {
    if (p.kind === "MNT") {
      const t = await one(sb, "maintenance_tickets", MNT_TICKET_COLS + ", description, photo_path, resolution_photo_path", p.id);
      if (!t) return { status: 404, body: { error: NOT_FOUND } };
      const ticket = await ticketDetail(sb, t, today, o.signUrls ?? bucketSigner(sb));
      return { status: 200, body: { kind: "ticket", ticket } };
    }
    const row = await one(sb, "maintenance_proposals", MNT_PROPOSAL_COLS, p.id);
    if (!row) return { status: 404, body: { error: NOT_FOUND } };
    return { status: 200, body: { kind: "proposal", proposal: await proposalDetail(sb, row, today) } };
  } catch (e) {
    console.error("[mnt_get] " + p.kind + "-" + p.id + " failed:", (e as Error)?.message ?? String(e));
    return { status: 503, body: { error: MNT_UNAVAILABLE } };
  }
}

// Photo d'un ticket depuis l'ecran Maintenance. Meme depot que v3.uploadPhoto
// (types, tailles, chemin, ligne photos, idempotence upload_photo) : on lui passe
// un formulaire reduit a idem, file et ticketId, donc jamais de menage ni d'objet.
// Le ticket doit exister (ouvert ou clos : une photo s'ajoute a un ticket ferme sans le
// rouvrir) ; ce controle passe avant la pose de la cle.
export async function mntPhoto(sb: any, me: SessionUser, form: FormData): Promise<ActionResult> {
  const raw = form.get("ticketId");
  const n = typeof raw === "string" && raw.trim() !== "" ? Number(raw) : NaN;
  if (!Number.isInteger(n) || n <= 0) return { status: 400, body: { error: "ticketId required" } };
  const { data: tk, error } = await sb.from("maintenance_tickets").select("id").eq("id", n).maybeSingle();
  if (error) {
    console.error("[mnt_get] mnt.photo MNT-" + n + " illisible:", (error as any)?.message ?? String(error));
    return { status: 503, body: { error: MNT_UNAVAILABLE } };
  }
  if (!tk) return { status: 404, body: { error: NOT_FOUND } };
  const f = new FormData();
  const idem = form.get("idem");
  if (idem !== null) f.set("idem", idem);
  const file = form.get("file");
  if (file !== null) f.set("file", file);
  f.set("ticketId", String(n));
  return await uploadPhoto(sb, me, f);
}
