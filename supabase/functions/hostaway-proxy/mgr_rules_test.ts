import { assertEquals } from "jsr:@std/assert@1";
import {
  arrivalStatus, byRoleThenName, dubaiMs, eliteLogDeadlineMs, fmtDur, hhmm, joinNames, keyDate,
  normalizeMgrReservations, plural, reservationKey, splitListing, usuallyEliteListings,
  type PrevCleaning,
} from "./mgr_rules.ts";

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

import { mgrAccess, parseRiskHours } from "./mgr_rules.ts";

Deno.test("acces manager : session email obligatoire, role manager seulement", () => {
  assertEquals(mgrAccess(false, null), { ok: false, status: 401, error: "auth required" });
  assertEquals(mgrAccess(true, null), { ok: false, status: 401, error: "auth required" });
  assertEquals(mgrAccess(false, { role: "manager" }), { ok: false, status: 403, error: "email sign-in required" });
  assertEquals(mgrAccess(true, { role: "cleaner" }), { ok: false, status: 403, error: "forbidden" });
  assertEquals(mgrAccess(true, { role: "maintenance" }), { ok: false, status: 403, error: "forbidden" });
  assertEquals(mgrAccess(true, { role: "manager" }), { ok: true });
});

Deno.test("seuil a risque : app_config.mgr_risk_hours, defaut 6", () => {
  assertEquals(parseRiskHours("3"), 3);
  assertEquals(parseRiskHours("2.5"), 2.5);
  for (const v of [null, undefined, "", "abc", "0", "-1", "25"]) assertEquals(parseRiskHours(v), 6);
});
