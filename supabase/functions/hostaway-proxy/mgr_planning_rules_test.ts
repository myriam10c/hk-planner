import { assertEquals } from "jsr:@std/assert@1";
import {
  hourOrNull, LAUNDRY_FIELDS, laundryRow, parsePlanningStart, personSlots, planStatus, weekDays, weekStart,
} from "./mgr_planning_rules.ts";

const TODAY = "2026-10-09";
const AT_11 = Date.parse("2026-10-09T07:00:00Z"); // vendredi 11:00 Dubai

Deno.test("semaine du lundi au dimanche", () => {
  assertEquals(weekStart("2026-10-09"), "2026-10-05");
  assertEquals(weekStart("2026-10-05"), "2026-10-05");
  assertEquals(weekStart("2026-10-11"), "2026-10-05");
  assertEquals(weekStart("2026-11-01"), "2026-10-26");
  assertEquals(weekDays("2026-09-28"), [
    "2026-09-28", "2026-09-29", "2026-09-30", "2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04",
  ]);
});

Deno.test("start : absent = cette semaine, ramene au lundi, 26 semaines au plus", () => {
  assertEquals(parsePlanningStart(null, TODAY), { ok: true, start: "2026-10-05" });
  assertEquals(parsePlanningStart("", TODAY), { ok: true, start: "2026-10-05" });
  assertEquals(parsePlanningStart("2026-10-14", TODAY), { ok: true, start: "2026-10-12" });
  assertEquals(parsePlanningStart("2027-04-05", TODAY), { ok: true, start: "2027-04-05" });
  assertEquals(parsePlanningStart("2026-04-06", TODAY), { ok: true, start: "2026-04-06" });
  assertEquals(parsePlanningStart("2027-04-12", TODAY), { ok: false, error: "start must be within 26 weeks of today" });
  assertEquals(parsePlanningStart("2026-03-30", TODAY), { ok: false, error: "start must be within 26 weeks of today" });
  assertEquals(parsePlanningStart("x", TODAY), { ok: false, error: "start must be YYYY-MM-DD" });
  assertEquals(parsePlanningStart("2026-02-30", TODAY), { ok: false, error: "start must be YYYY-MM-DD" });
});

Deno.test("heure Hostaway : 0, vide ou hors plage = non renseignee", () => {
  assertEquals(hourOrNull(0), null);
  assertEquals(hourOrNull(null), null);
  assertEquals(hourOrNull(""), null);
  assertEquals(hourOrNull(24), null);
  assertEquals(hourOrNull(11), 11);
  assertEquals(hourOrNull("11"), 11);
  assertEquals(hourOrNull(11.5), 11);
});

Deno.test("statut d'un menage de la semaine", () => {
  const base = { date: TODAY, today: TODAY, nowMs: AT_11, assigned: 1, state: "not_started" as const, cancelled: false, usuallyElite: false, nextBefore: false };
  assertEquals(planStatus({ ...base, cancelled: true, assigned: 0 }), { tone: "idle", word: "Cancelled" });
  assertEquals(planStatus({ ...base, state: "done", nextBefore: true }), { tone: "ok", word: "Done" });
  assertEquals(planStatus({ ...base, nextBefore: true }), { tone: "bad", word: "Guest arrives first" });
  assertEquals(planStatus({ ...base, assigned: 0 }), { tone: "bad", word: "Unassigned" });
  assertEquals(planStatus({ ...base, assigned: 0, usuallyElite: true }), { tone: "warn", word: "Usually Elite · not logged yet" });
  assertEquals(planStatus({ ...base, assigned: 0, usuallyElite: true, date: "2026-10-11" }), { tone: "warn", word: "Usually Elite" });
  // Menage Elite du 07 : saisie attendue le 08 a 14:00, depassee le 09 a 11:00.
  assertEquals(planStatus({ ...base, assigned: 0, usuallyElite: true, date: "2026-10-07" }), { tone: "bad", word: "Unassigned" });
  assertEquals(planStatus({ ...base, state: "in_progress" }), { tone: "idle", word: "In progress" });
  assertEquals(planStatus({ ...base, date: "2026-10-08" }), { tone: "warn", word: "Not marked done" });
  assertEquals(planStatus(base), { tone: "idle", word: "Scheduled" });
  assertEquals(planStatus({ ...base, date: "2026-10-10" }), { tone: "idle", word: "Scheduled" });
});

Deno.test("couleurs : cleaners actifs par nom, puis inactifs, sous-traitant a part", () => {
  const P = (id: number, name: string, role: string, active = true) => ({ id, name, role, active });
  assertEquals(personSlots([
    P(10, "Pionah", "cleaner"), P(4, "Faiza", "cleaner"), P(12, "Elite Cleaning", "subcontractor"),
    P(3, "Old", "cleaner", false), P(8, "Walter", "manager"),
  ]), { "4": "p1", "10": "p2", "3": "p3", "12": "sub" });
  assertEquals(personSlots([
    P(1, "Amy", "cleaner"), P(2, "Bea", "cleaner"), P(3, "Cat", "cleaner"), P(4, "Dee", "cleaner"), P(5, "Eve", "cleaner"),
  ]), { "1": "p1", "2": "p2", "3": "p3", "4": "p4", "5": "p1" });
});

Deno.test("linge : sept champs, total, valeur absente = 0", () => {
  assertEquals([...LAUNDRY_FIELDS], ["pillowcases", "bed_sheets", "duvet_covers", "small_towels", "face_towels", "large_towels", "bath_mats"]);
  assertEquals(laundryRow({ pillowcases: 4, bed_sheets: 2, duvet_covers: 2, small_towels: 4, face_towels: null, large_towels: "4", bath_mats: 2 }), {
    total: 18, pillowcases: 4, bed_sheets: 2, duvet_covers: 2, small_towels: 4, face_towels: 0, large_towels: 4, bath_mats: 2,
  });
});
