import { assert, assertEquals } from "jsr:@std/assert@1";
import { fakeDb } from "./v3_fakedb.ts";
import { mntGet, type MntProposalDetail, type MntTicketDetail, mntPhoto } from "./mnt_get.ts";

const NOW = Date.parse("2026-10-12T21:30:00Z");
const ME = { cleaner_id: 7, name: "Semax", role: "manager" } as any;
let batches: string[][] = [];
const sign = async (ps: string[]) => {
  batches.push(ps);
  return Object.fromEntries(ps.map((p) => [p, "https://signed.test/" + p]));
};

const TK = (id: number, o: any = {}) => ({
  id, listing_id: "L1", title: "Ticket " + id, category: "ac", priority: "high", status: "open", source: "guest_message",
  assigned_technician_id: null, assigned_vendor_id: null, created_at: "2026-10-01T08:00:00Z", started_at: null,
  resolved_at: null, closed_at: null, resolution_notes: null, actual_cost: null, proposal_id: null, due_on: null,
  description: null, photo_path: null, resolution_photo_path: null, ...o,
});
const PR = (id: number, o: any = {}) => ({
  id, listing_id: "L1", reservation_id: "R" + id, conversation_id: "C" + id, guest_name: "Guest " + id,
  stay_from: "2026-10-10", stay_to: "2026-10-14", title: "Proposal " + id, category: "ac", urgency: "high",
  quotes: [{ message_id: "m" + id, at: "2026-10-01T07:00:00Z", text: "The AC is not cooling" }], status: "pending", ticket_id: null,
  open_ticket_id: null, decided_by: null, decided_at: null, reject_reason: null, reject_note: null, dedup_key: "C" + id + "|ac",
  created_at: "2026-10-01T07:00:00Z", updated_at: "2026-10-01T07:00:00Z", ...o,
});

const db = () => fakeDb({
  maintenance_tickets: [
    TK(12, { proposal_id: 5, description: "AC leaking", status: "resolved", resolved_at: "2026-10-03T12:00:00Z",
      assigned_technician_id: 9, due_on: "2026-10-04", resolution_photo_path: "v3/2026-10-03/after.jpg", actual_cost: "80" }),
    TK(13, { title: "Leak", category: "plumbing", status: "in_progress" }),
    TK(14, { title: "Door", category: "lock_door", status: "assigned" }),
    TK(15, { title: "Old fix", status: "resolved" }),
    TK(16, { listing_id: "L2", title: "Other flat", status: "open" }),
  ],
  maintenance_proposals: [
    PR(5, { status: "accepted", ticket_id: 12, decided_by: "Semax", decided_at: "2026-10-01T08:00:00Z" }),
    PR(6, { open_ticket_id: 13 }),
    PR(7, { listing_id: null }),
  ],
  ticket_comments: [
    { id: 1, ticket_id: 12, author: "Guest", comment: "Still leaking", created_at: "2026-10-01T09:00:00Z", photo_path: null },
    { id: 2, ticket_id: 12, author: "Ismael", comment: "Need a part", created_at: "2026-10-02T10:00:00Z", photo_path: "v3/2026-10-02/c.jpg" },
    { id: 3, ticket_id: 13, author: "Ismael", comment: "Not mine", created_at: "2026-10-02T10:00:00Z", photo_path: null },
  ],
  cleaning_log: [
    { id: 1, reservation_key: "ticket_12", action: "mnt_proposal.accept", actor: "Semax", details: { proposalId: 5 }, created_at: "2026-10-01T08:00:00Z" },
    { id: 2, reservation_key: "ticket_12", action: "mnt_ticket.assign", actor: "Semax", details: { to: "Ismael", kind: "member" }, created_at: "2026-10-01T08:30:00Z" },
    { id: 3, reservation_key: "ticket_12", action: "mnt_ticket.due", actor: "Semax", details: { date: "2026-10-04" }, created_at: "2026-10-01T08:40:00Z" },
    { id: 4, reservation_key: "ticket_12", action: "mnt_ticket.start", actor: "Ismael", details: {}, created_at: "2026-10-02T08:00:00Z" },
    { id: 5, reservation_key: "ticket_12", action: "mnt_ticket.comment", actor: "Ismael", details: {}, created_at: "2026-10-02T10:00:00Z" },
    { id: 6, reservation_key: "ticket_12", action: "mnt_ticket.waiting_parts", actor: "Ismael", details: {}, created_at: "2026-10-02T11:00:00Z" },
    { id: 7, reservation_key: "ticket_12", action: "mnt_ticket.done", actor: "Ismael", details: {}, created_at: "2026-10-03T12:00:00Z" },
    { id: 8, reservation_key: "ticket_12", action: "ticket_updated", actor: "Old", details: {}, created_at: "2026-10-03T12:30:00Z" },
    { id: 9, reservation_key: "ticket_13", action: "mnt_ticket.start", actor: "Ismael", details: {}, created_at: "2026-10-02T08:00:00Z" },
    { id: 10, reservation_key: "ticket_12", action: "mnt_ticket.reopen", actor: "Semax", details: {}, created_at: "2026-10-03T13:00:00Z" },
    { id: 11, reservation_key: "ticket_12", action: "mnt_ticket.assign", actor: "Semax", details: { to: null, kind: null }, created_at: "2026-10-03T13:10:00Z" },
    { id: 12, reservation_key: "ticket_12", action: "mnt_ticket.create", actor: "Walter", details: {}, created_at: "2026-10-03T13:20:00Z" },
  ],
  photos: [
    { id: 1, storage_path: "v3/2026-10-02/p1.jpg", ticket_id: 12, cleaner_id: 9, kind: "photo", created_at: "2026-10-02T09:00:00Z" },
    { id: 2, storage_path: "v3/2026-10-02/voice.m4a", ticket_id: 12, cleaner_id: 9, kind: "voice", created_at: "2026-10-02T09:05:00Z" },
    { id: 3, storage_path: "v3/2026-10-02/other.jpg", ticket_id: 13, cleaner_id: 9, kind: "photo", created_at: "2026-10-02T09:00:00Z" },
  ],
  listing_config: [
    { listing_id: "L1", internal_name: "103 - Damac Reva" }, { listing_id: "L2", internal_name: "2609 - Nobles by Tiger" },
  ],
  cleaners: [
    { id: 7, name: "Semax", role: "manager", is_active: true }, { id: 9, name: "Ismael", role: "maintenance", is_active: true },
  ],
  vendors: [{ id: 3, name: "CoolFix", is_active: true }],
});

Deno.test("mnt.get ticket : ligne, description, citations, historique trie, photos signees", async () => {
  const r = await mntGet(db(), "MNT-12", { nowMs: NOW, signUrls: sign });
  assertEquals(r.status, 200);
  const b = r.body as { kind: "ticket"; ticket: MntTicketDetail };
  assertEquals(b.kind, "ticket");
  const t = b.ticket;
  assertEquals(t.ref, "MNT-12");
  assertEquals([t.apt, t.bld], ["103", "Damac Reva"]);
  assertEquals(t.stage, "done");
  assertEquals(t.resolvedBy, "Ismael");
  assertEquals(t.actualCost, 80);
  assertEquals(t.assignee, { kind: "member", id: 9, name: "Ismael" });
  assertEquals(t.description, "AC leaking");
  assertEquals(t.resolutionPhotoUrl, "https://signed.test/v3/2026-10-03/after.jpg");
  assertEquals(t.photos, [{ url: "https://signed.test/v3/2026-10-02/p1.jpg", at: "2026-10-02T09:00:00Z" }]);
  assert(t.proposal);
  assertEquals(t.proposal!.ref, "PRP-5");
  assertEquals(t.proposal!.quotes[0].text, "The AC is not cooling");
  assertEquals(t.proposal!.ticket, { id: 12, ref: "MNT-12" });
  assertEquals(t.history.map((h) => [h.at, h.who, h.kind, h.text, h.photoUrl]), [
    ["2026-10-01T08:00:00Z", "Semax", "event", "created the ticket", null],
    ["2026-10-01T08:30:00Z", "Semax", "event", "assigned to Ismael", null],
    ["2026-10-01T08:40:00Z", "Semax", "event", "set due date 04/10", null],
    ["2026-10-01T09:00:00Z", "Guest", "guest", "Still leaking", null],
    ["2026-10-02T08:00:00Z", "Ismael", "event", "started", null],
    ["2026-10-02T09:00:00Z", "Ismael", "event", "added a photo", "https://signed.test/v3/2026-10-02/p1.jpg"],
    ["2026-10-02T10:00:00Z", "Ismael", "comment", "Need a part", "https://signed.test/v3/2026-10-02/c.jpg"],
    ["2026-10-02T11:00:00Z", "Ismael", "event", "set waiting parts", null],
    ["2026-10-03T12:00:00Z", "Ismael", "event", "closed the ticket", null],
    ["2026-10-03T13:00:00Z", "Semax", "event", "reopened", null],
    ["2026-10-03T13:10:00Z", "Semax", "event", "unassigned", null],
    ["2026-10-03T13:20:00Z", "Walter", "event", "created the ticket", null],
  ]);
});

Deno.test("mnt.get ticket : reference en minuscules acceptee, ticket sans proposition", async () => {
  const r = await mntGet(db(), " mnt-14 ", { nowMs: NOW, signUrls: sign });
  assertEquals(r.status, 200);
  const t = (r.body as any).ticket as MntTicketDetail;
  assertEquals(t.proposal, null);
  assertEquals(t.history, []);
  assertEquals(t.photos, []);
  assertEquals(t.resolutionPhotoUrl, null);
  assertEquals(t.description, null);
});

Deno.test("mnt.get proposition : ouverts du meme logement, ticket ouvert signale", async () => {
  const r = await mntGet(db(), "PRP-6", { nowMs: NOW, signUrls: sign });
  assertEquals(r.status, 200);
  const b = r.body as { kind: "proposal"; proposal: MntProposalDetail };
  assertEquals(b.kind, "proposal");
  assertEquals(b.proposal.ref, "PRP-6");
  assertEquals(b.proposal.openTicket, { id: 13, ref: "MNT-13", title: "Leak" });
  assertEquals(b.proposal.guestInNow, true);
  assertEquals(b.proposal.sameListingOpen, [
    { id: 13, ref: "MNT-13", title: "Leak", category: "plumbing" },
    { id: 14, ref: "MNT-14", title: "Door", category: "lock_door" },
  ]);
  const sans = await mntGet(db(), "PRP-7", { nowMs: NOW, signUrls: sign });
  assertEquals((sans.body as any).proposal.sameListingOpen, []);
});

Deno.test("mnt.get : 404, 400, 503", async () => {
  assertEquals(await mntGet(db(), "MNT-99", { signUrls: sign }), { status: 404, body: { error: "Not found." } });
  assertEquals(await mntGet(db(), "PRP-99", { signUrls: sign }), { status: 404, body: { error: "Not found." } });
  for (const bad of ["", "MNT-", "MNT-0", "TSK-3", "PRP-abc", "MNT-12x"]) {
    assertEquals(await mntGet(db(), bad, { signUrls: sign }), { status: 400, body: { error: "Invalid reference." } });
  }
  const sb = db();
  sb.fail["maintenance_tickets.select"] = { message: "boom" };
  assertEquals(await mntGet(sb, "MNT-12", { signUrls: sign }), { status: 503, body: { error: "Maintenance is unavailable right now. Try again." } });
});

Deno.test("mnt.get : une signature ratee donne null, jamais une erreur", async () => {
  const r = await mntGet(db(), "MNT-12", { nowMs: NOW, signUrls: async () => { throw new Error("storage down"); } });
  assertEquals(r.status, 200);
  const t = (r.body as any).ticket as MntTicketDetail;
  assertEquals(t.resolutionPhotoUrl, null);
  assertEquals(t.photos, []);
  assertEquals(t.history.find((h) => h.text === "added a photo")!.photoUrl, null);
  const r2 = await mntGet(db(), "MNT-12", { nowMs: NOW, signUrls: async () => ({}) });
  assertEquals((r2.body as any).ticket.resolutionPhotoUrl, null);
});

Deno.test("mnt.get : signature par defaut via le bucket, 1 heure, un seul lot", async () => {
  const s0 = db();
  const r = await mntGet(s0, "MNT-12", { nowMs: NOW });
  assertEquals((r.body as any).ticket.resolutionPhotoUrl, "https://signed.test/v3/2026-10-03/after.jpg?exp=3600");
  assertEquals((s0 as any).storage.signBatches.length, 1);
  const sb = db();
  sb.fail["storage.sign"] = { message: "down" };
  const r2 = await mntGet(sb, "MNT-12", { nowMs: NOW });
  assertEquals(r2.status, 200);
  assertEquals((r2.body as any).ticket.resolutionPhotoUrl, null);
});

// ---------- mnt.photo ----------
const jpeg = (n = 10) => new File([new Uint8Array(n)], "a.jpg", { type: "image/jpeg" });
function form(o: Record<string, string | File | null>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) if (v !== null) f.set(k, v as any);
  return f;
}

Deno.test("mnt.photo : depot rattache au ticket, rejeu rend le premier resultat", async () => {
  const sb = db();
  const r = await mntPhoto(sb, ME, form({ idem: "idem-mnt-photo-0001", file: jpeg(), ticketId: "12" }));
  assertEquals(r.status, 200);
  const b = r.body as any;
  assert(Number(b.photoId) > 0);
  assert(/^v3\/\d{4}-\d{2}-\d{2}\/[0-9a-f-]+\.jpg$/.test(b.path));
  const row = sb.tables.photos.find((p: any) => p.id === b.photoId);
  assertEquals([row.ticket_id, row.job_id, row.cleaner_id, row.storage_path], [12, null, 7, b.path]);
  assertEquals(sb.storage.uploads.length, 1);
  const again = await mntPhoto(sb, ME, form({ idem: "idem-mnt-photo-0001", file: jpeg(), ticketId: "12" }));
  assertEquals(again, r);
  assertEquals(sb.storage.uploads.length, 1);
});

Deno.test("mnt.photo : ticket absent 404, ticketId manquant ou invalide 400, limites du v3", async () => {
  const sb = db();
  assertEquals(await mntPhoto(sb, ME, form({ idem: "idem-mnt-photo-0002", file: jpeg(), ticketId: "99" })),
    { status: 404, body: { error: "Not found." } });
  assertEquals((await mntPhoto(sb, ME, form({ idem: "idem-mnt-photo-0003", file: jpeg(), ticketId: null }))).status, 400);
  assertEquals((await mntPhoto(sb, ME, form({ idem: "idem-mnt-photo-0004", file: jpeg(), ticketId: "abc" }))).status, 400);
  assertEquals((await mntPhoto(sb, ME, form({ idem: "x", file: jpeg(), ticketId: "12" }))).status, 400);
  const gif = new File([new Uint8Array(4)], "a.gif", { type: "image/gif" });
  assertEquals(await mntPhoto(sb, ME, form({ idem: "idem-mnt-photo-0005", file: gif, ticketId: "12" })),
    { status: 400, body: { error: "unsupported image type" } });
  assertEquals(await mntPhoto(sb, ME, form({ idem: "idem-mnt-photo-0006", file: jpeg(6 * 1024 * 1024 + 1), ticketId: "12" })),
    { status: 413, body: { error: "photo is too large" } });
  assertEquals(sb.storage.uploads.length, 0);
  assertEquals((sb.tables.job_events ?? []).length, 0);
});

Deno.test("mnt.photo : un jobId envoye est ignore, la photo ne va qu'au ticket", async () => {
  const sb = db();
  const r = await mntPhoto(sb, ME, form({ idem: "idem-mnt-photo-0007", file: jpeg(), ticketId: "13", jobId: "J1", itemName: "x" }));
  assertEquals(r.status, 200);
  const row = sb.tables.photos.find((p: any) => p.id === (r.body as any).photoId);
  assertEquals([row.ticket_id, row.job_id, row.item_name], [13, null, null]);
});

Deno.test("S7/S8 : un seul lot de signature, chemins du bucket seulement (http et data jamais rendus)", async () => {
  batches = [];
  const sb = db();
  sb.tables.maintenance_tickets.find((t: any) => t.id === 12).resolution_photo_path = "https://evil.test/x.jpg";
  sb.tables.ticket_comments.push({ id: 4, ticket_id: 12, author: "Ismael", comment: "Data", created_at: "2026-10-02T12:00:00Z",
    photo_path: "data:image/png;base64,AAAA" });
  const r = await mntGet(sb, "MNT-12", { nowMs: NOW, signUrls: sign });
  const t = (r.body as any).ticket as MntTicketDetail;
  assertEquals(t.resolutionPhotoUrl, null);
  assertEquals(t.history.find((h) => h.text === "Data")!.photoUrl, null);
  assertEquals(batches.length, 1);
  assertEquals(batches[0].sort(), ["v3/2026-10-02/c.jpg", "v3/2026-10-02/p1.jpg"]);
});

Deno.test("S8 : mnt.photo, lecture du ticket ratee = 503 lisible, rien depose", async () => {
  const sb = db();
  sb.fail["maintenance_tickets.select"] = { message: "boom" };
  assertEquals(await mntPhoto(sb, ME, form({ idem: "idem-mnt-photo-0008", file: jpeg(), ticketId: "12" })),
    { status: 503, body: { error: "Maintenance is unavailable right now. Try again." } });
  assertEquals(sb.storage.uploads.length, 0);
});
