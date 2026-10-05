import { assertEquals } from "jsr:@std/assert@1";
import {
  daysBetween, dubaiDay, eligibilityFor, fleetColor, INSP_ZONES, inspRoleAllowed, listingLabel, rankToday,
} from "./insp_rules.ts";

const R = (listingId: string, arrival: string, departure: string, extra: any = {}) =>
  ({ listingId, arrival, departure, status: "confirmed", checkInTime: 15, checkOutTime: 12, ...extra });
const D = "2026-10-06";

Deno.test("10 zones dans l'ordre", () => {
  assertEquals(INSP_ZONES.length, 10);
  assertEquals(INSP_ZONES[0].key, "entrance");
  assertEquals(INSP_ZONES[9].key, "cleanliness");
});

Deno.test("checkout le jour J : eligible meme avec check-in le meme jour", () => {
  const e = eligibilityFor("A", [R("A", "2026-10-02", D), R("A", D, "2026-10-09")], D);
  assertEquals(e, { kind: "checkout", checkOutTime: 12, nextCheckIn: { date: D, time: 15 } });
});

Deno.test("checkout sans arrivee suivante connue", () => {
  assertEquals(eligibilityFor("A", [R("A", "2026-10-02", D)], D),
    { kind: "checkout", checkOutTime: 12, nextCheckIn: null });
});

Deno.test("vacant : personne la nuit d'avant ni celle d'apres", () => {
  assertEquals(eligibilityFor("A", [R("A", "2026-10-10", "2026-10-12")], D),
    { kind: "vacant", nextArrival: "2026-10-10" });
  assertEquals(eligibilityFor("A", [], D), { kind: "vacant", nextArrival: null });
});

Deno.test("occupe : sejour en cours, ou arrivee ce jour sans depart", () => {
  assertEquals(eligibilityFor("A", [R("A", "2026-10-04", "2026-10-08")], D), null);
  assertEquals(eligibilityFor("A", [R("A", D, "2026-10-08")], D), null);
});

Deno.test("statut annule ignore", () => {
  assertEquals(eligibilityFor("A", [R("A", "2026-10-04", "2026-10-08", { status: "cancelled" })], D),
    { kind: "vacant", nextArrival: null });
});

Deno.test("daysBetween et pastilles", () => {
  assertEquals(daysBetween("2026-09-06T10:00:00+04:00", D), 30);
  assertEquals(fleetColor(null), "red");
  assertEquals(fleetColor(29), "green");
  assertEquals(fleetColor(30), "orange");
  assertEquals(fleetColor(45), "orange");
  assertEquals(fleetColor(46), "red");
});

Deno.test("daysBetween across Dubai day boundary", () => {
  // 21:00 UTC on 2026-09-05 is 01:00 on 2026-09-06 in Dubai (UTC+4)
  // So from 2026-09-06 to 2026-10-06 is 30 days
  assertEquals(daysBetween("2026-09-05T21:00:00Z", D), 30);
});

Deno.test("listingLabel", () => {
  assertEquals(listingLabel({ internal_name: "3207 - Sobha Waves" }), "Apt 3207 · Sobha Waves");
  assertEquals(listingLabel({ internal_name: "414 | Azizi Riviera 11" }), "Apt 414 · Azizi Riviera 11");
  assertEquals(listingLabel({ internal_name: "503 WILTON PARK 2" }), "Apt 503 · WILTON PARK 2");
  assertEquals(listingLabel({ internal_name: "1011c - Bloom Tower" }), "Apt 1011c · Bloom Tower");
  assertEquals(listingLabel({ internal_name: "418 · Elysée 1" }), "Apt 418 · Elysée 1");
  assertEquals(listingLabel({ internal_name: "261 Elysee 1 V2 - ok" }), "Apt 261 · Elysee 1 V2 - ok");
  assertEquals(listingLabel({ internal_name: "Villa Jumeirah" }), "Villa Jumeirah");
  assertEquals(listingLabel({ listing_name: "Nice 2br" }), "Nice 2br");
  assertEquals(listingLabel({}), "Apartment");
});

Deno.test("listingLabel requires digit in apartment token", () => {
  // No digit: should not match regex, return as-is
  assertEquals(listingLabel({ internal_name: "Villa - Jumeirah" }), "Villa - Jumeirah");
  assertEquals(listingLabel({ internal_name: "Dubai-Marina Tower" }), "Dubai-Marina Tower");
  // Digit present: should match regex and format as "Apt X · Y"
  assertEquals(listingLabel({ internal_name: "G05 - Marina Gate" }), "Apt G05 · Marina Gate");
});

Deno.test("roles", () => {
  assertEquals(inspRoleAllowed("insp.today", "cleaner"), true);
  assertEquals(inspRoleAllowed("insp.today", "subcontractor"), false);
  assertEquals(inspRoleAllowed("insp.assign", "cleaner"), false);
  assertEquals(inspRoleAllowed("insp.assign", "manager"), true);
});

const L = (id: string, extra: any = {}) => ({ listing_id: id, internal_name: id + " - Tower", ...extra });

Deno.test("rankToday : jamais verifie en tete, puis plus vieux, quota, exclus et occupes ecartes", () => {
  const out = rankToday({
    day: D, target: 2,
    listings: [L("1"), L("2"), L("3"), L("4"), L("5", { inspection_excluded: true }), L("6")],
    reservations: [R("6", "2026-10-04", "2026-10-08")], // 6 occupe
    lastDone: {
      "1": { finishedAt: "2026-09-01T09:00:00+04:00", inspector: "Walter" }, // 35 j
      "2": { finishedAt: "2026-10-03T09:00:00+04:00", inspector: "Harlene" }, // 3 j : < 7, ecarte
      "4": { finishedAt: "2026-08-01T09:00:00+04:00", inspector: "Walter" }, // 66 j
    },
    openIssueListings: new Set(), missed: { "1": 2 },
  });
  assertEquals(out.today.map((c) => c.listingId), ["3", "4"]);
  assertEquals(out.also.map((c) => c.listingId), ["1"]);
  assertEquals(out.also[0].missed, 2);
  assertEquals(out.today[0].daysSince, null);
});

Deno.test("rankToday : < 7 jours mais probleme ouvert = propose", () => {
  const out = rankToday({
    day: D, target: 4, listings: [L("2")], reservations: [],
    lastDone: { "2": { finishedAt: "2026-10-04T09:00:00+04:00", inspector: "W" } },
    openIssueListings: new Set(["2"]), missed: {},
  });
  assertEquals(out.today.map((c) => c.listingId), ["2"]);
  assertEquals(out.today[0].openIssue, true);
});

Deno.test("dubaiDay : jour Dubai d'un horodatage UTC ou +04:00", () => {
  assertEquals(dubaiDay("2026-09-30T21:00:00+00:00"), "2026-10-01");
  assertEquals(dubaiDay("2026-09-30T19:59:59+00:00"), "2026-09-30");
  assertEquals(dubaiDay("2026-10-01T00:30:00+04:00"), "2026-10-01");
});
