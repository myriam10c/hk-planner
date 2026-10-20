import { assert, assertEquals } from "jsr:@std/assert@1";
import { cleaningOut, cleaningRange, type CleaningCtx, isBad, keyOk, listParam, proposalOut, redact, scrub, sha256Hex, ticketOut, ticketStatuses } from "./ro_rules.ts";

const qs = (s: string) => new URLSearchParams(s);

Deno.test("keyOk: X-API-Key ou Bearer, rien d'autre", async () => {
  const sha = await sha256Hex("hkro_secret");
  assert(await keyOk(new Headers({ "X-API-Key": "hkro_secret" }), sha));
  assert(await keyOk(new Headers({ Authorization: "Bearer hkro_secret" }), sha));
  assert(!(await keyOk(new Headers({ "X-API-Key": "hkro_wrong" }), sha)));
  assert(!(await keyOk(new Headers({}), sha)));
  // Empreinte serveur absente ou mal formee : tout est refuse.
  assert(!(await keyOk(new Headers({ "X-API-Key": "hkro_secret" }), "")));
});

Deno.test("filtres: statuts, categories, plage des menages", () => {
  assertEquals((ticketStatuses(qs("status=open")) as string[]).includes("waiting_parts"), true);
  assertEquals(ticketStatuses(qs("status=resolved,closed")), ["resolved", "closed"]);
  assert(isBad(ticketStatuses(qs("status=fixed"))));
  assert(isBad(listParam(qs("category=ac,boiler"), "category", ["ac"])));
  assertEquals(listParam(qs("category=ac,ac"), "category", ["ac"]), ["ac"]);
  assertEquals(cleaningRange(qs("from=2026-10-20")), { from: "2026-10-20", to: "2026-10-26" });
  assert(isBad(cleaningRange(qs(""))));
  assert(isBad(cleaningRange(qs("from=2026-10-20&to=2026-11-20"))));
  assert(isBad(cleaningRange(qs("from=2026-10-20&to=2026-10-19"))));
  assert(isBad(cleaningRange(qs("from=20-10-2026"))));
});

Deno.test("redact: masque telephones et emails, garde les petits nombres", () => {
  assertEquals(redact("Guest +971 50 123 4567 says AC broken in 1203"), "Guest [phone hidden] says AC broken in 1203");
  assertEquals(redact("mail john.doe@gmail.com"), "mail [email hidden]");
  assertEquals(redact("2 towels, room 305"), "2 towels, room 305");
  assertEquals(redact("   "), null);
});

Deno.test("ticketOut: liste blanche, jamais de cout ni d'identifiant WhatsApp", () => {
  const t = ticketOut({
    id: 470, listing_id: "171299", title: "AC leaking", description: "call 0501234567", category: "ac", priority: "high",
    status: "assigned", assigned_technician_id: 7, actual_cost: 300, source_sender: "+971501234567", photo_path: "x.jpg",
  }, { "171299": { apartment: "2201A", building: "Bloom Height" } }, { "7": "Semax" }, {});
  assertEquals(t.ref, "MNT-470");
  assertEquals(t.assignee, { type: "technician", id: 7, name: "Semax" });
  assertEquals(t.description, "call [phone hidden]");
  assertEquals(t.open, true);
  const s = JSON.stringify(t);
  for (const banned of ["actual_cost", "300", "source_sender", "photo", "+971"]) assert(!s.includes(banned), banned);
});

Deno.test("cleaningOut: statut, report, pas de nom de guest", () => {
  const c: CleaningCtx = {
    from: "2026-10-20", to: "2026-10-26", place: { "1": { apartment: "305", building: "Neva" } }, people: { "4": "Faiza" },
    post: { "2026-10-19_Jane Doe": { from: "2026-10-19", to: "2026-10-21" } },
    asg: { "2026-10-19_Jane Doe": [{ id: 4, st: "CHC" }] }, done: new Set(), canc: {},
    timer: { "2026-10-19_Jane Doe": { started_at: "2026-10-21T08:00:00Z", finished_at: null, duration_minutes: null } },
  };
  const j = cleaningOut("2026-10-19_Jane Doe", "checkout", "998877", "1", "2026-10-19", 12, { date: "2026-10-21", hour: 15 }, null, c)!;
  assertEquals(j.date, "2026-10-21");
  assertEquals(j.postponedFrom, "2026-10-19");
  assertEquals(j.checkoutTime, null);
  assertEquals(j.status, "in_progress");
  assertEquals(j.nextCheckIn, { date: "2026-10-21", time: "15:00", sameDay: true });
  assertEquals(j.assigned, [{ id: 4, name: "Faiza" }]);
  assert(!JSON.stringify(j).includes("Jane"));
  // Hors plage apres report : absent.
  assertEquals(cleaningOut("k", "checkout", "1", "1", "2026-10-27", null, null, null, c), null);
  // Annule l'emporte sur fait.
  c.done.add("k2"); c.canc["k2"] = "owner stay";
  assertEquals(cleaningOut("k2", "checkout", "2", "1", "2026-10-22", 11, null, null, c)!.status, "cancelled");
});

Deno.test("proposalOut: citations masquees, ni nom de guest ni identifiant de message", () => {
  const p = proposalOut({
    id: 57, listing_id: "1", guest_name: "John Smith", conversation_id: "c9", title: "Ants",
    quotes: [{ at: "x", text: "call me +971 50 123 4567", message_id: "511319821" }], status: "pending",
  }, { "1": { apartment: "305", building: "Neva" } });
  assertEquals(p.ref, "PRP-57");
  assertEquals(p.quotes, ["call me [phone hidden]"]);
  const s = JSON.stringify(p);
  for (const banned of ["John", "c9", "511319821"]) assert(!s.includes(banned), banned);
});

Deno.test("scrub: retire cle interne et champs guest des reponses du proxy", () => {
  assertEquals(scrub({ status: "success", key: "2026-10-18_Jane", done: true, extra: { id: 3, guest_name: "Jane", reservation_key: "x" } }),
    { status: "success", done: true, extra: { id: 3 } });
});
