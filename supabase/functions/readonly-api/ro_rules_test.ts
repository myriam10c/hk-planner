import { assert, assertEquals } from "jsr:@std/assert@1";
import {
  checkoutKeys, cleaningOut, cleaningRange, cleaningRows, type CleaningCtx, isBad, keyedCheckouts, keyOk, listParam, pickCleaning,
  proposalOut, redact, scrub, sha256Hex, ticketOut, ticketStatuses,
} from "./ro_rules.ts";
// Le test peut lire le proxy : la fonction, elle, reste autonome (voir ro_rules.ts).
import { checkoutKeys as proxyCheckoutKeys } from "../hostaway-proxy/mgr_rules.ts";

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

Deno.test("actorsFrom : ouvreur, fermeur, reouverture", async () => {
  const { actorsFrom } = await import("./ro_rules.ts");
  const r = actorsFrom([
    { id: 2, ticket_id: 5, event: "closed", actor: "Walter", at: "2026-10-02" },
    { id: 1, ticket_id: 5, event: "opened", actor: "Ismaël", at: "2026-10-01" },
    { id: 3, ticket_id: 6, event: "closed", actor: "Walter", at: "2026-10-02" },
    { id: 4, ticket_id: 6, event: "reopened", actor: "Hillal", at: "2026-10-03" },
  ]);
  assertEquals(r.openedBy, { "5": "Ismaël" });
  assertEquals(r.closedBy, { "5": { by: "Walter", at: "2026-10-02" } });
});

// Lot 1, tache 7 (seconde lecture Fable, I1) : memes cles de menage que le proxy.
// Meme voyageur dans deux logements le meme jour, plus une reservation simple.
const D = "2026-12-01";
const COLLISION = [
  { id: 9001, guest: "Ann Lee", listingId: "621030", checkOut: D, checkOutTime: 11, status: "confirmed", nextGuest: null },
  { id: 9000, guest: "Ann Lee", listingId: "621031", checkOut: D, checkOutTime: 10, status: "confirmed", nextGuest: null },
  { id: 9002, guest: "Bo Ray", listingId: "621032", checkOut: D, checkOutTime: null, status: "confirmed", nextGuest: null },
];

Deno.test("checkoutKeys mirrors the proxy on a collision", () => {
  assertEquals(checkoutKeys(COLLISION), proxyCheckoutKeys(COLLISION));
  assertEquals(checkoutKeys(COLLISION), [D + "_Ann Lee~621030", D + "_Ann Lee", D + "_Bo Ray"]);
  // Autres cas du proxy : statut non valide, logement absent, guest vide, meme logement en double, ordre.
  const cases: any[][] = [
    [{ id: 8, listingId: "L9", checkOut: D, guest: "Ann", status: "cancelled" }, { id: 9, listingId: "L2", checkOut: D, guest: "Ann", status: "confirmed" },
      { id: 10, listingId: "L1", checkOut: D, guest: "Ann", status: "ownerStay" }],
    [{ id: 1, listingId: "", checkOut: D, guest: "Ann" }, { id: 5, listingId: "L1", checkOut: D, guest: "Ann" }, { id: 6, listingId: "L2", checkOut: D, guest: "Ann" }],
    [{ id: 101, listingId: "L2", checkOut: D, guest: null }, { id: 100, listingId: "L1", checkOut: D, guest: "" }],
    [{ id: 8, listingId: "L1", checkOut: D, guest: "Ann" }, { id: 3, listingId: "L1", checkOut: D, guest: "Ann" }, { id: 5, listingId: "L2", checkOut: D, guest: "Ann" }],
    [{ id: null, listingId: "L1", checkOut: D, guest: "Ann" }, { id: "12", listingId: "L2", checkOut: D, guest: "Ann" }],
    [...COLLISION].reverse(),
    [],
  ];
  for (const rows of cases) assertEquals(checkoutKeys(rows), proxyCheckoutKeys(rows), JSON.stringify(rows));
});

Deno.test("cleanings: en collision, deux menages publies, chacun lu et ecrit sous sa cle finale", () => {
  const raw = [
    ...COLLISION,
    // Meme logement, meme voyageur, meme jour : un seul menage.
    { id: 9003, guest: "Bo Ray", listingId: "621032", checkOut: D, checkOutTime: null, status: "confirmed", nextGuest: null },
    // Annulee et plus ancienne : ni publiee ni gardienne de la cle nue.
    { id: 8999, guest: "Ann Lee", listingId: "621033", checkOut: D, checkOutTime: null, status: "cancelled", nextGuest: null },
  ];
  const deps = keyedCheckouts(raw);
  assertEquals(deps.map((d) => [d.r.id, d.key]), [
    [9001, D + "_Ann Lee~621030"], [9000, D + "_Ann Lee"], [9002, D + "_Bo Ray"], [9003, D + "_Bo Ray"],
  ]);
  const c: CleaningCtx = {
    from: D, to: D, place: {}, people: { "4": "Faiza", "10": "Pionah" }, post: {}, done: new Set([D + "_Ann Lee~621030"]), canc: {}, timer: {},
    asg: { [D + "_Ann Lee"]: [{ id: 4, st: "CHC" }], [D + "_Ann Lee~621030"]: [{ id: 10, st: "CHC" }] },
  };
  const rows = cleaningRows(deps, [], c);
  assertEquals(rows.map((j) => [j.id, j._key, j.listingId]), [
    ["9001", D + "_Ann Lee~621030", "621030"], ["9000", D + "_Ann Lee", "621031"], ["9002", D + "_Bo Ray", "621032"],
  ]);
  // Etat lu sous la cle finale de chaque logement.
  assertEquals(pickCleaning(rows, "9001")!.assigned, [{ id: 10, name: "Pionah" }]);
  assertEquals(pickCleaning(rows, "9001")!.status, "done");
  assertEquals(pickCleaning(rows, "9000")!.assigned, [{ id: 4, name: "Faiza" }]);
  assertEquals(pickCleaning(rows, "9000")!.status, "not_started");
  // Les ecritures partent de _key : chaque menage retrouve par son id porte sa cle finale.
  assertEquals(pickCleaning(rows, "9001")!._key, D + "_Ann Lee~621030");
  assertEquals(pickCleaning(rows, "9000")!._key, D + "_Ann Lee");
  // La cle nue ne designe que la reservation gardienne (la plus ancienne).
  assertEquals(rows.filter((j) => j._key === D + "_Ann Lee").map((j) => j.id), ["9000"]);
  assertEquals(pickCleaning(rows, "8999"), null);
  // Rien ne sort qui porte le nom du voyageur, hors _key retiree avant la sortie.
  assert(!JSON.stringify(rows.map(({ _key, _orig, ...row }) => row)).includes("Ann"));
});
