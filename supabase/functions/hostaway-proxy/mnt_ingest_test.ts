import { assertEquals } from "jsr:@std/assert@1";
import { fakeDb } from "./v3_fakedb.ts";
import { mntIngest } from "./mnt_ingest.ts";

const NOW = Date.parse("2026-10-12T08:00:00Z");
const NOW_ISO = new Date(NOW).toISOString();

const issue = (o: Record<string, unknown> = {}) => ({
  conversationId: "C1", messageId: "M1", at: "2026-10-12T07:00:00Z", listingId: "L1", reservationId: "R1",
  guestName: "Anna", stayFrom: "2026-10-10", stayTo: "2026-10-15", title: "AC not cooling",
  category: "ac", urgency: "normal", quote: "The AC is not cooling at all", ...o,
});
const seed = (extra: Record<string, any[]> = {}) => fakeDb({
  maintenance_proposals: [],
  maintenance_tickets: [
    { id: 40, listing_id: "L1", category: "AC", status: "resolved", title: "Old AC" },
    { id: 41, listing_id: "L1", category: "Plumbing", status: "open", title: "Leak" },
  ],
  ...extra,
});
const run = (sb: any, issues: any[], deps: any = {}) => mntIngest(sb, { issues }, { nowMs: NOW, ...deps });
const props = (sb: any) => sb.tables.maintenance_proposals;

Deno.test("ingest : nouvelle proposition en attente avec citation et cle", async () => {
  const sb = seed();
  const r = await run(sb, [issue()]);
  assertEquals(r.status, 200);
  const p = props(sb)[0];
  assertEquals(r.body, { created: [p.id], appended: [], skipped: 0 });
  assertEquals(p.status, "pending");
  assertEquals(p.dedup_key, "C1|ac");
  assertEquals(p.conversation_id, "C1");
  assertEquals(p.listing_id, "L1");
  assertEquals(p.reservation_id, "R1");
  assertEquals(p.guest_name, "Anna");
  assertEquals(p.stay_from, "2026-10-10");
  assertEquals(p.stay_to, "2026-10-15");
  assertEquals(p.title, "AC not cooling");
  assertEquals(p.urgency, "normal");
  assertEquals(p.quotes, [{ message_id: "M1", at: "2026-10-12T07:00:00Z", text: "The AC is not cooling at all" }]);
  assertEquals(p.open_ticket_id, null); // ticket AC resolu ignore
  assertEquals(p.updated_at, NOW_ISO);
});

Deno.test("ingest : meme message deux fois, une seule citation, skipped 1", async () => {
  const sb = seed();
  await run(sb, [issue()]);
  const r = await run(sb, [issue()]);
  assertEquals(r.body, { created: [], appended: [], skipped: 1 });
  assertEquals(props(sb).length, 1);
  assertEquals(props(sb)[0].quotes.length, 1);
});

Deno.test("ingest : meme message deja cite sur une proposition acceptee, skipped", async () => {
  const sb = seed({
    maintenance_proposals: [{ id: 5, conversation_id: "C1", category: "ac", status: "accepted", dedup_key: "C1|ac",
      urgency: "normal", quotes: [{ message_id: "M1", at: "2026-10-12T07:00:00Z", text: "x" }] }],
  });
  const r = await run(sb, [issue()]);
  assertEquals(r.body, { created: [], appended: [], skipped: 1 });
  assertEquals(props(sb).length, 1);
});

Deno.test("ingest : second message meme conversation et categorie, citation ajoutee", async () => {
  const sb = seed();
  await run(sb, [issue()]);
  const id = props(sb)[0].id;
  const later = NOW + 60_000;
  const r = await mntIngest(sb, { issues: [issue({ messageId: "M2", at: "2026-10-12T07:30:00Z", quote: "Still hot" })] }, { nowMs: later });
  assertEquals(r.body, { created: [], appended: [id], skipped: 0 });
  assertEquals(props(sb).length, 1);
  assertEquals(props(sb)[0].quotes.map((q: any) => q.message_id), ["M1", "M2"]);
  assertEquals(props(sb)[0].updated_at, new Date(later).toISOString());
  assertEquals(props(sb)[0].urgency, "normal");
});

Deno.test("ingest : meme conversation, autre categorie, nouvelle proposition", async () => {
  const sb = seed();
  await run(sb, [issue()]);
  const r = await run(sb, [issue({ messageId: "M2", category: "plumbing", title: "Leak under sink" })]);
  assertEquals(r.status, 200);
  assertEquals((r.body as any).created.length, 1);
  assertEquals(props(sb).length, 2);
  assertEquals(props(sb)[1].dedup_key, "C1|plumbing");
});

Deno.test("ingest : une proposition acceptee de meme cle ne bloque pas une nouvelle en attente", async () => {
  const sb = seed({
    maintenance_proposals: [{ id: 5, conversation_id: "C1", category: "ac", status: "accepted", dedup_key: "C1|ac",
      urgency: "normal", quotes: [{ message_id: "M0", at: "2026-10-11T07:00:00Z", text: "x" }] }],
  });
  const r = await run(sb, [issue()]);
  assertEquals(r.status, 200);
  assertEquals((r.body as any).created.length, 1);
  assertEquals(props(sb).length, 2);
  assertEquals(props(sb)[0].quotes.length, 1); // l'acceptee n'est pas touchee
  assertEquals(props(sb)[1].status, "pending");
});

Deno.test("ingest : ticket ouvert meme logement et categorie, open_ticket_id le plus recent", async () => {
  const sb = seed({
    maintenance_tickets: [
      { id: 40, listing_id: "L1", category: "AC", status: "resolved", title: "Old AC" },
      { id: 41, listing_id: "L1", category: "Plumbing", status: "open", title: "Leak" },
      { id: 42, listing_id: "L1", category: "ac", status: "in_progress", title: "AC noisy" },
      { id: 43, listing_id: "L1", category: "AC", status: "to_confirm", title: "AC again" },
      { id: 44, listing_id: "L2", category: "ac", status: "open", title: "Other flat" },
    ],
  });
  await run(sb, [issue()]);
  assertEquals(props(sb)[0].open_ticket_id, 43);
});

Deno.test("ingest : logement inconnu, aucun ticket rattache", async () => {
  const sb = seed({ maintenance_tickets: [{ id: 42, listing_id: "L1", category: "ac", status: "open" }] });
  await run(sb, [issue({ listingId: null })]);
  assertEquals(props(sb)[0].open_ticket_id, null);
  assertEquals(props(sb)[0].listing_id, null);
});

Deno.test("ingest : urgent notifie une fois a la creation et une fois a la montee, pas a un second urgent", async () => {
  const sb = seed();
  const calls: any[] = [];
  const notifyUrgent = (p: any) => calls.push(p);
  await run(sb, [issue({ urgency: "urgent", title: "No AC at all" })], { notifyUrgent });
  assertEquals(calls.length, 1);
  assertEquals(calls[0], { id: props(sb)[0].id, title: "No AC at all", listingId: "L1" });

  const sb2 = seed();
  const calls2: any[] = [];
  const n2 = (p: any) => calls2.push(p);
  await run(sb2, [issue()], { notifyUrgent: n2 });
  assertEquals(calls2.length, 0);
  await run(sb2, [issue({ messageId: "M2", at: "2026-10-12T07:20:00Z", urgency: "urgent" })], { notifyUrgent: n2 });
  assertEquals(calls2.length, 1);
  assertEquals(props(sb2)[0].urgency, "urgent");
  await run(sb2, [issue({ messageId: "M3", at: "2026-10-12T07:40:00Z", urgency: "urgent" })], { notifyUrgent: n2 });
  assertEquals(calls2.length, 1);
  // un message moins urgent ne fait pas baisser l'urgence
  await run(sb2, [issue({ messageId: "M4", at: "2026-10-12T07:50:00Z", urgency: "high" })], { notifyUrgent: n2 });
  assertEquals(props(sb2)[0].urgency, "urgent");
  // rejeu d'un message urgent deja cite : pas de notification
  await run(sb2, [issue({ messageId: "M2", at: "2026-10-12T07:20:00Z", urgency: "urgent" })], { notifyUrgent: n2 });
  assertEquals(calls2.length, 1);
});

Deno.test("ingest : montee normal vers high sans notification", async () => {
  const sb = seed();
  const calls: any[] = [];
  await run(sb, [issue()], { notifyUrgent: (p: any) => calls.push(p) });
  await run(sb, [issue({ messageId: "M2", urgency: "high" })], { notifyUrgent: (p: any) => calls.push(p) });
  assertEquals(props(sb)[0].urgency, "high");
  assertEquals(calls.length, 0);
});

Deno.test("ingest : une notification qui leve ne fait pas echouer l'ingestion", async () => {
  const sb = seed();
  const r = await run(sb, [issue({ urgency: "urgent" })], { notifyUrgent: () => { throw new Error("boom"); } });
  assertEquals(r.status, 200);
  assertEquals(props(sb).length, 1);
});

Deno.test("ingest : corps invalide, 400 avec l'erreur de parseIngest", async () => {
  const sb = seed();
  assertEquals(await mntIngest(sb, {}, { nowMs: NOW }), { status: 400, body: { error: "Invalid issues." } });
  const r = await run(sb, [issue({ category: "nope" })]);
  assertEquals(r, { status: 400, body: { error: "Invalid issue 1: category." } });
  assertEquals(props(sb).length, 0);
});

Deno.test("ingest : erreur de lecture ou d'ecriture, 503", async () => {
  const sb = seed();
  sb.fail["maintenance_proposals.select"] = { message: "down" };
  assertEquals(await run(sb, [issue()]), { status: 503, body: { error: "Could not save proposals." } });
  const sb2 = seed();
  sb2.fail["maintenance_proposals.insert"] = { message: "down" };
  assertEquals(await run(sb2, [issue()]), { status: 503, body: { error: "Could not save proposals." } });
  assertEquals(props(sb2).length, 0);
  const sb3 = seed();
  sb3.fail["maintenance_tickets.select"] = { message: "down" };
  assertEquals(await run(sb3, [issue()]), { status: 503, body: { error: "Could not save proposals." } });
  assertEquals(props(sb3).length, 0);
  const sb4 = seed();
  await run(sb4, [issue()]);
  sb4.fail["maintenance_proposals.update"] = { message: "down" };
  assertEquals(await run(sb4, [issue({ messageId: "M2" })]), { status: 503, body: { error: "Could not save proposals." } });
  assertEquals(props(sb4)[0].quotes.length, 1);
});

Deno.test("ingest : course sur l'index unique, repli sur l'ajout de citation", async () => {
  const db = seed();
  let first = true;
  // La premiere lecture des propositions ne voit rien ; une proposition concurrente
  // arrive juste apres, l'insert prend alors un 23505.
  const sb = {
    ...db,
    from(t: string) {
      const q = db.from(t);
      if (t !== "maintenance_proposals" || !first) return q;
      first = false;
      const then = q.then;
      q.then = (res: any, rej: any) => then((r: any) => {
        db.tables.maintenance_proposals.push({ id: 77, conversation_id: "C1", category: "ac", status: "pending",
          dedup_key: "C1|ac", urgency: "normal", quotes: [{ message_id: "M0", at: "2026-10-12T06:00:00Z", text: "x" }] });
        return res(r);
      }, rej);
      return q;
    },
  };
  const r = await run(sb, [issue()]);
  assertEquals(r.body, { created: [], appended: [77], skipped: 0 });
  assertEquals(db.tables.maintenance_proposals.length, 1);
  assertEquals(db.tables.maintenance_proposals[0].quotes.map((q: any) => q.message_id), ["M0", "M1"]);
});

Deno.test("ingest : plusieurs problemes dans un lot", async () => {
  const sb = seed();
  const r = await run(sb, [issue(), issue({ messageId: "M2" }), issue({ conversationId: "C2", messageId: "M9" })]);
  const ids = props(sb).map((p: any) => p.id);
  assertEquals(r.body, { created: [ids[0], ids[1]], appended: [ids[0]], skipped: 0 });
});
