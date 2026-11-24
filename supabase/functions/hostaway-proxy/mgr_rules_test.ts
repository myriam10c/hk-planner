import { assertEquals } from "jsr:@std/assert@1";
import {
  arrivalStatus, byRoleThenName, checkoutKeys, dubaiMs, eliteLogDeadlineMs, fmtDur, hhmm, joinNames, keyDate,
  guestOfKey, normalizeMgrReservations, plural, reservationKey, reservationKeys, splitListing, usuallyEliteListings,
  withBareKeys, type PrevCleaning,
} from "./mgr_rules.ts";
import { dateFromKey } from "./autopilot.ts";
import { dateDeLaCle } from "./v3_finish_context.ts";

const DAY = "2026-10-09";
const at = (dubaiHHMM: string) => Date.parse(DAY + "T" + dubaiHHMM + ":00+04:00");
const ARR_15 = at("15:00");
const P = (o: Partial<PrevCleaning> = {}): PrevCleaning => ({
  key: DAY + "_Ann Lee", checkoutDate: DAY, checkoutHour: 12, cleaningDate: DAY,
  assignedNames: [], done: false, started: false, cancelled: false, usuallyElite: false, ...o,
});
const GAS = { id: 429, title: "Gas not working" };
const st = (prev: PrevCleaning | null, nowMs: number, o: any = {}) =>
  arrivalStatus({ day: DAY, nowMs, arrivalMs: ARR_15, riskHours: 6, prev, urgent: [], ...o });

Deno.test("normalise : guest, heure 00:00 = absente, doublons", () => {
  const raw = [
    { id: 1, listingMapId: 55, guestName: "Ann Lee", arrivalDate: "2026-10-06", departureDate: DAY, status: "confirmed", checkInTime: 15, checkOutTime: 0 },
    { id: 1, listingMapId: 55, guestName: "Ann Lee", arrivalDate: "2026-10-06", departureDate: DAY, status: "confirmed" },
    { id: 2, listingId: 56, guestFirstName: "Bob", guestLastName: "Ray", arrivalDate: DAY, departureDate: "2026-10-12", status: "ownerStay", checkInTime: "16", checkOutTime: 11 },
    { id: 3, arrivalDate: DAY, departureDate: "2026-10-12", status: "confirmed" },
  ];
  assertEquals(normalizeMgrReservations(raw), [
    { id: "1", listingId: "55", guest: "Ann Lee", arrival: "2026-10-06", departure: DAY, status: "confirmed", checkInTime: 15, checkOutTime: null },
    { id: "2", listingId: "56", guest: "Bob Ray", arrival: DAY, departure: "2026-10-12", status: "ownerStay", checkInTime: 16, checkOutTime: 11 },
  ]);
});

Deno.test("cle de menage : miroir de keyFor, Guest par defaut ; date d'une cle", () => {
  assertEquals(reservationKey({ departure: DAY, guest: "Ann Lee" }), "2026-10-09_Ann Lee");
  assertEquals(reservationKey({ departure: DAY, guest: "" }), "2026-10-09_Guest");
  assertEquals(keyDate("2026-10-07_Jo La"), "2026-10-07");
  assertEquals(keyDate("extra_2026-10-09_deep"), "2026-10-09");
  assertEquals(keyDate("nope"), null);
});

// Lot 1, tache 7 : un menage par logement quand deux reservations partagent la cle nue.
const S = (id: unknown, listingId: string, guest: string, departure = DAY) => ({ id, listingId, guest, departure });

Deno.test("cles de menage : deux logements, meme cle nue, la plus ancienne garde la cle nue", () => {
  // Identifiants compares en nombres : 9 est plus ancien que 10.
  assertEquals(reservationKeys([S("10", "L1", "Ann Lee"), S("9", "L2", "Ann Lee")]),
    ["2026-10-09_Ann Lee~L1", "2026-10-09_Ann Lee"]);
  // Independant de l'ordre de la liste et du type de l'identifiant (nombre du payload checkouts).
  assertEquals(reservationKeys([S(9, "L2", "Ann Lee"), S(10, "L1", "Ann Lee")]),
    ["2026-10-09_Ann Lee", "2026-10-09_Ann Lee~L1"]);
  // Trois logements : chaque autre logement recoit son propre suffixe.
  assertEquals(reservationKeys([S(5, "L1", "Bo"), S(7, "L3", "Bo"), S(6, "L2", "Bo")]),
    ["2026-10-09_Bo", "2026-10-09_Bo~L3", "2026-10-09_Bo~L2"]);
});

Deno.test("cles de menage : guest absent, la cle « Guest » par defaut se partage aussi", () => {
  assertEquals(reservationKeys([S(3, "L1", ""), S(4, "L2", "")]), ["2026-10-09_Guest", "2026-10-09_Guest~L2"]);
});

Deno.test("cles de menage : sans collision, exactement la cle d'avant", () => {
  const list = [S(1, "L1", "Ann Lee"), S(2, "L1", "Bob Ray"), S(3, "L2", "Ann Lee", "2026-10-10"), S(4, "L3", "")];
  assertEquals(reservationKeys(list), list.map(reservationKey));
  assertEquals(reservationKeys([]), []);
});

Deno.test("cles de menage : meme logement en double, toujours un seul menage", () => {
  assertEquals(reservationKeys([S(8, "L1", "Ann Lee"), S(3, "L1", "Ann Lee")]), ["2026-10-09_Ann Lee", "2026-10-09_Ann Lee"]);
  // Le logement de la plus ancienne garde la cle nue pour toutes ses reservations.
  assertEquals(reservationKeys([S(8, "L1", "Ann Lee"), S(3, "L1", "Ann Lee"), S(5, "L2", "Ann Lee")]),
    ["2026-10-09_Ann Lee", "2026-10-09_Ann Lee", "2026-10-09_Ann Lee~L2"]);
});

Deno.test("cles de menage : identifiant illisible apres les lisibles, puis ordre des logements", () => {
  assertEquals(reservationKeys([S(null, "L1", "Ann"), S(12, "L2", "Ann")]), ["2026-10-09_Ann~L1", "2026-10-09_Ann"]);
  // Deux identifiants illisibles : le logement departage, quel que soit l'ordre ou l'identifiant de repli.
  assertEquals(reservationKeys([S("L2|a|b", "L2", "Ann"), S(undefined, "L1", "Ann")]), ["2026-10-09_Ann~L2", "2026-10-09_Ann"]);
  // Une reservation sans logement garde la cle nue et ne la prend a personne.
  assertEquals(reservationKeys([S(1, "", "Ann"), S(5, "L1", "Ann"), S(6, "L2", "Ann")]),
    ["2026-10-09_Ann", "2026-10-09_Ann", "2026-10-09_Ann~L2"]);
});

Deno.test("cles de menage : lignes du payload checkouts (checkOut, guest nul)", () => {
  assertEquals(checkoutKeys([
    { id: 101, listingId: "L2", checkOut: DAY, guest: null },
    { id: 100, listingId: "L1", checkOut: DAY, guest: "" },
    { id: 102, listingId: "L3", checkOut: DAY, guest: "Ann Lee" },
  ]), ["2026-10-09_Guest~L2", "2026-10-09_Guest", "2026-10-09_Ann Lee"]);
  // Statut non valide (Today l'ecarte avant ses cles) : il ne prend la cle nue a personne.
  assertEquals(checkoutKeys([
    { id: 99, listingId: "L9", checkOut: DAY, guest: "Ann", status: "cancelled" },
    { id: 101, listingId: "L2", checkOut: DAY, guest: "Ann", status: "confirmed" },
    { id: 100, listingId: "L1", checkOut: DAY, guest: "Ann", status: "ownerStay" },
  ]), ["2026-10-09_Ann", "2026-10-09_Ann~L2", "2026-10-09_Ann"]);
});

Deno.test("cle suffixee : date lue partout, cles nues des reports", () => {
  assertEquals(keyDate("2026-10-09_Ann Lee~L2"), "2026-10-09");
  assertEquals(dateFromKey("2026-10-09_Ann Lee~L2"), "2026-10-09");
  assertEquals(dateDeLaCle("2026-10-09_Ann Lee~L2"), "2026-10-09");
  assertEquals([...withBareKeys(["2026-10-07_Jo La", "2026-10-07_Ann~L2", "extra_2026-10-01_x"])].sort(),
    ["2026-10-07_Ann", "2026-10-07_Ann~L2", "2026-10-07_Jo La", "extra_2026-10-01_x"]);
});

Deno.test("guestOfKey : voyageur d'une cle, sans le suffixe du logement (export CSV des chronos)", () => {
  assertEquals(guestOfKey("2026-12-01_Ann Lee~621030"), "Ann Lee");
  assertEquals(guestOfKey("2026-12-01_Ann Lee"), "Ann Lee");
  // Un « _ » dans le nom du voyageur reste tel quel.
  assertEquals(guestOfKey("2026-12-01_Ann_Lee"), "Ann_Lee");
  assertEquals(guestOfKey("2026-12-01_Ann_Lee~L2"), "Ann_Lee");
  assertEquals(guestOfKey("2026-12-01_Guest"), "Guest");
  assertEquals(guestOfKey("nope"), "");
});

Deno.test("formats : heures, durees, noms, pluriels, heure Dubai", () => {
  assertEquals(hhmm(9), "09:00");
  assertEquals(hhmm(null), null);
  assertEquals(fmtDur(3 * 3600_000), "3 h");
  assertEquals(fmtDur(150 * 60_000), "2 h 30");
  assertEquals(fmtDur(65 * 60_000), "1 h 05");
  assertEquals(fmtDur(30 * 60_000), "30 min");
  assertEquals(joinNames(["Faiza"]), "Faiza");
  assertEquals(joinNames(["Faiza", "Pionah"]), "Faiza and Pionah");
  assertEquals(joinNames(["A", "B", "C"]), "A, B and C");
  assertEquals(plural(1, "cleaning"), "1 cleaning");
  assertEquals(plural(0, "cleaning"), "0 cleanings");
  assertEquals(dubaiMs(DAY, 15), Date.parse("2026-10-09T11:00:00Z"));
});

Deno.test("logement : numero et immeuble", () => {
  assertEquals(splitListing({ internal_name: "623 - Azizi Riviera 20" }), { apt: "623", bld: "Azizi Riviera 20" });
  assertEquals(splitListing({ internal_name: "", listing_name: "Nice flat", apt_number: "12" }), { apt: "12", bld: "Nice flat" });
  assertEquals(splitListing(null), { apt: "", bld: "Apartment" });
});

Deno.test("tri : cleaners, puis sous-traitant, puis le reste, par nom", () => {
  const l = [
    { role: "manager", name: "Semax" }, { role: "subcontractor", name: "Elite Cleaning" },
    { role: "cleaner", name: "Pionah" }, { role: "cleaner", name: "Faiza" },
  ];
  assertEquals(l.sort(byRoleThenName).map((x) => x.name), ["Faiza", "Pionah", "Elite Cleaning", "Semax"]);
});

Deno.test("habituellement Elite : au moins 2 jobs dans les 60 jours avant le jour", () => {
  const rows = [
    { listing_id: 3, cleaning_date: "2026-09-20" }, { listing_id: 3, cleaning_date: "2026-09-28" },
    { listing_id: "L4", cleaning_date: "2026-09-21" },
    { listing_id: "L5", cleaning_date: "2026-07-01" }, { listing_id: "L5", cleaning_date: "2026-07-02" },
    { listing_id: "L6", cleaning_date: DAY }, { listing_id: "L6", cleaning_date: DAY },
  ];
  assertEquals([...usuallyEliteListings(rows, DAY)], ["3"]);
  assertEquals(eliteLogDeadlineMs("2026-10-08"), Date.parse("2026-10-09T10:00:00Z"));
});

Deno.test("Ready : menage fait, aucun ticket urgent", () => {
  assertEquals(st(P({ done: true, assignedNames: ["Faiza"] }), at("11:00")),
    { tone: "ok", word: "Ready", cause: "Cleaned by Faiza after the 12:00 checkout." });
  assertEquals(st(P({ done: true, assignedNames: ["Faiza"], checkoutHour: null }), at("11:00")).cause,
    "Cleaned by Faiza after today's checkout (checkout time not set).");
  assertEquals(st(P({ done: true, assignedNames: ["Elite Cleaning"], checkoutDate: "2026-10-05", cleaningDate: "2026-10-05" }), at("11:00")).cause,
    "Cleaned by Elite Cleaning after the 05/10 checkout.");
});

Deno.test("Blocked : ticket urgent, meme menage fait", () => {
  assertEquals(st(P({ done: true, assignedNames: ["Faiza"] }), at("11:00"), { urgent: [GAS] }),
    { tone: "bad", word: "Blocked", cause: "Clean, but urgent ticket open: Gas not working (MNT-429)." });
  assertEquals(st(P(), at("11:00"), { urgent: [GAS] }).cause,
    "No cleaner assigned, and urgent ticket open: Gas not working (MNT-429).");
  assertEquals(st(P({ assignedNames: ["Faiza"] }), at("11:00"), { urgent: [GAS] }).cause,
    "Urgent ticket open: Gas not working (MNT-429).");
});

Deno.test("Blocked : non assigne, avec rotation ; heure de depart absente", () => {
  assertEquals(st(P(), at("11:00")),
    { tone: "bad", word: "Blocked", cause: "No cleaner assigned. Checkout 12:00, 3 h turnaround." });
  assertEquals(st(P({ checkoutHour: null }), at("11:00")).cause, "No cleaner assigned. Checkout time not set.");
});

Deno.test("Elite le lendemain : ambre avant 14:00 le lendemain du menage, rouge apres", () => {
  const prev = P({ checkoutDate: "2026-10-08", cleaningDate: "2026-10-08", usuallyElite: true });
  assertEquals(st(prev, Date.parse("2026-10-09T09:59:00Z")), {
    tone: "warn", word: "At risk",
    cause: "Not logged yet. Elite logs its jobs the next day around 14:00.",
  });
  assertEquals(st(prev, Date.parse("2026-10-09T10:00:00Z")),
    { tone: "bad", word: "Blocked", cause: "No cleaner assigned. Checkout 08/10." });
  assertEquals(st(prev, Date.parse("2026-10-09T09:00:00Z"), { urgent: [GAS] }).tone, "bad");
});

Deno.test("At risk : assigne, pas fait, arrivee dans le seuil", () => {
  assertEquals(st(P({ assignedNames: ["Faiza"] }), at("11:00")),
    { tone: "warn", word: "At risk", cause: "Not started yet, Faiza. Guest in 4 h, checkout 12:00." });
  assertEquals(st(P({ assignedNames: ["Faiza", "Pionah"], started: true }), at("12:30")).cause,
    "Cleaning in progress, Faiza and Pionah. Guest in 2 h 30, checkout 12:00.");
  assertEquals(st(P({ assignedNames: ["Faiza"], checkoutHour: null }), at("11:00")).cause,
    "Not started yet, Faiza. Guest in 4 h, checkout time not set.");
  assertEquals(st(P({ assignedNames: ["Faiza"] }), at("15:30")).cause,
    "Not started yet, Faiza. Guest due now, checkout 12:00.");
});

Deno.test("Scheduled : assigne, arrivee au-dela du seuil ; seuil configurable", () => {
  assertEquals(st(P({ assignedNames: ["Faiza"] }), at("06:00")),
    { tone: "idle", word: "Scheduled", cause: "Not cleaned yet, Faiza assigned. Guest in 9 h." });
  assertEquals(st(P({ assignedNames: ["Faiza"] }), at("06:00"), { riskHours: 10 }).tone, "warn");
  assertEquals(st(P({ assignedNames: ["Faiza"] }), at("11:00"), { riskHours: 2 }).tone, "idle");
});

Deno.test("annule, reporte, aucun depart connu", () => {
  assertEquals(st(P({ cancelled: true }), at("11:00")).cause, "Cleaning cancelled in HK Planner after the 12:00 checkout.");
  assertEquals(st(P({ cleaningDate: "2026-10-10", assignedNames: ["Faiza"] }), at("11:00")),
    { tone: "bad", word: "Blocked", cause: "Cleaning postponed to 10/10." });
  assertEquals(st(null, at("11:00")),
    { tone: "ok", word: "Ready", cause: "No checkout in the last 14 days, apartment empty." });
  assertEquals(st(null, at("11:00"), { urgent: [GAS] }),
    { tone: "bad", word: "Blocked", cause: "Urgent ticket open: Gas not working (MNT-429)." });
});

import { mgrAccess, parseRiskHours, planningAccess } from "./mgr_rules.ts";

Deno.test("acces manager : session email obligatoire, role manager seulement", () => {
  assertEquals(mgrAccess(false, null), { ok: false, status: 401, error: "auth required" });
  assertEquals(mgrAccess(true, null), { ok: false, status: 401, error: "auth required" });
  assertEquals(mgrAccess(false, { role: "manager" }), { ok: false, status: 403, error: "email sign-in required" });
  assertEquals(mgrAccess(true, { role: "cleaner" }), { ok: false, status: 403, error: "forbidden" });
  assertEquals(mgrAccess(true, { role: "maintenance" }), { ok: false, status: 403, error: "forbidden" });
  assertEquals(mgrAccess(true, { role: "manager" }), { ok: true });
});

Deno.test("acces planning : session email, roles manager et maintenance", () => {
  assertEquals(planningAccess(false, null), { ok: false, status: 401, error: "auth required" });
  assertEquals(planningAccess(false, { role: "maintenance" }), { ok: false, status: 403, error: "email sign-in required" });
  assertEquals(planningAccess(true, { role: "cleaner" }), { ok: false, status: 403, error: "forbidden" });
  assertEquals(planningAccess(true, { role: "subcontractor" }), { ok: false, status: 403, error: "forbidden" });
  assertEquals(planningAccess(true, { role: "maintenance" }), { ok: true });
  assertEquals(planningAccess(true, { role: "manager" }), { ok: true });
});

Deno.test("seuil a risque : app_config.mgr_risk_hours, defaut 6", () => {
  assertEquals(parseRiskHours("3"), 3);
  assertEquals(parseRiskHours("2.5"), 2.5);
  for (const v of [null, undefined, "", "abc", "0", "-1", "25"]) assertEquals(parseRiskHours(v), 6);
});

// Lot 4b : garde « un collegue a change » d'assignCleaner (expect_ids).
import { assert } from "jsr:@std/assert@1";
import { assignConflict } from "./mgr_rules.ts";

Deno.test("assignConflict: no expect means no guard", () => {
  assertEquals(assignConflict([4], undefined), null);
  assertEquals(assignConflict([4], "x"), null);
});

Deno.test("assignConflict: same set in any order is no conflict", () => {
  assertEquals(assignConflict([10, 4], [4, 10]), null);
  assertEquals(assignConflict([], []), null);
  // Doublons ignores, valeurs comparees en nombres.
  assertEquals(assignConflict([4, 10, 4], ["10", 4, 10]), null);
});

Deno.test("assignConflict: different set returns current sorted", () => {
  assertEquals(assignConflict([10, 4], []), [4, 10]);
  assertEquals(assignConflict([], [4]), []);
  assertEquals(assignConflict([10, 4, 10], [4]), [4, 10]);
  assertEquals(assignConflict([4], [4, 12]), [4]);
});

// index.ts n'est pas importable en test (Deno.serve au chargement) : l'ordre des
// controles d'assignCleaner est verifie sur la source.
Deno.test("assignCleaner (source) : garde expect_ids avant les conges et toute ecriture, 409 propre", async () => {
  const src = await Deno.readTextFile(new URL("./index.ts", import.meta.url));
  const debut = src.indexOf('if (action === "assignCleaner"');
  assert(debut >= 0, "handler assignCleaner absent");
  const b = src.slice(debut, src.indexOf("if (action ===", debut + 10));
  const garde = b.indexOf("if (Array.isArray(body.expect_ids))");
  assert(garde > b.indexOf('"reservation_key required"'), "garde absente ou avant le 400");
  const lecture = b.indexOf('sb.from("cleaning_assignments")', garde);
  const calcul = b.indexOf("assignConflict(", garde);
  const refus = b.indexOf('return jsonResp({ error: "Changed by someone else.", current: c }, 409)', garde);
  assert(lecture > garde && calcul > lecture && refus > calcul, "lecture, comparaison puis 409");
  assert(b.indexOf('return jsonResp({ error: "Failed to verify the current assignment" }, 500)', garde) > lecture, "echec ferme");
  // Avant le controle des conges et avant toute ecriture, quel que soit le mode.
  for (const after of ['sb.from("leave_requests")', ".delete()", ".insert(", ".upsert(", ".update(", "addLog(", "sendPush("]) {
    const at = b.indexOf(after);
    assert(at > refus, after + " doit venir apres la garde");
  }
  // Le message d'idempotence (traite comme incertain par le front) reste distinct.
  assert(!b.includes('"Still processing. Retry."'), "aucune reponse du handler ne reprend ce message");
});
