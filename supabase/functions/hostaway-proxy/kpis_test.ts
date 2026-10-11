import { assertEquals } from "jsr:@std/assert@1";
import { fakeDb } from "./v3_fakedb.ts";
import { dashboardKpis } from "./kpis.ts";
import { todayDubai } from "./v3.ts";

const seed = () => fakeDb({
  cleaning_timer: [
    { reservation_key: "r1", cleaner_id: 1, started_at: "2026-10-05T06:00:00Z", duration_minutes: 40 },
    { reservation_key: "r2", cleaner_id: 1, started_at: "2026-10-06T06:00:00Z", duration_minutes: 60 },
    { reservation_key: "r3", cleaner_id: 2, started_at: "2026-09-30T21:00:00Z", duration_minutes: 90 },
    { reservation_key: "r4", cleaner_id: 1, started_at: "2026-10-07T06:00:00Z", duration_minutes: 600 },
  ],
  cleaning_assignments: [
    { reservation_key: "r1", cleaner_id: 1 }, { reservation_key: "r2", cleaner_id: 1 },
    { reservation_key: "r2", cleaner_id: 2 }, { reservation_key: "r3", cleaner_id: 2 },
    { reservation_key: "r4", cleaner_id: 1 },
  ],
  menage_done: [
    { reservation_key: "r1", done: true, updated_at: "2026-10-09T10:00:00Z" },
    { reservation_key: "r2", done: true, updated_at: "2026-10-10T21:30:00Z" },
    { reservation_key: "r3", done: true, updated_at: "2026-09-30T21:30:00Z" },
    { reservation_key: "r4", done: false, updated_at: "2026-10-10T09:00:00Z" },
  ],
  cleaners: [
    { id: 1, name: "Zara", color: "#111", role: "cleaner", is_active: true },
    { id: 2, name: "Amir", color: "#222", role: "cleaner", is_active: true },
    { id: 3, name: "Walter", color: "#333", role: "manager", is_active: true },
    { id: 4, name: "Old", color: "#444", role: "cleaner", is_active: false },
  ],
  maintenance_tickets: [
    { id: 1, status: "open", created_at: "2026-10-01T00:00:00Z", resolved_at: null },
    { id: 2, status: "resolved", created_at: "2026-10-01T00:00:00Z", resolved_at: "2026-10-03T00:00:00Z" },
  ],
});

Deno.test("kpis: memes champs que l'ancien handler", async () => {
  const k = await dashboardKpis(seed(), "2026-10", "2026-10-11");
  assertEquals(Object.keys(k).sort(), [
    "avgCleaningTime", "avgResolutionHours", "cleanerPerformance", "last7DaysCompletions",
    "openMaintenanceTickets", "resolvedThisMonth", "totalTimerSessions"]);
  // 600 min est ignore (>= 480) : 40, 60, 90.
  assertEquals([k.avgCleaningTime, k.totalTimerSessions], [63, 3]);
  assertEquals([k.openMaintenanceTickets, k.resolvedThisMonth, k.avgResolutionHours], [1, 1, 48]);
  // Seuls les cleaners actifs de role cleaner.
  assertEquals(k.cleanerPerformance.map((p: any) => p.id), [1, 2]);
  assertEquals(k.cleanerPerformance[0], { id: 1, name: "Zara", color: "#111", totalCleanings: 2, avgTime: 50, fastest: 40, slowest: 60, timerCount: 2 });
  assertEquals(k.cleanerPerformance[1], { id: 2, name: "Amir", color: "#222", totalCleanings: 2, avgTime: 75, fastest: 60, slowest: 90, timerCount: 2 });
});

Deno.test("kpis: sans mois, resolvedThisMonth vaut 0", async () => {
  const k = await dashboardKpis(seed(), null, "2026-10-11");
  assertEquals(k.resolvedThisMonth, 0);
});

Deno.test("kpis: 7 jours calcules depuis le jour Dubai injecte (01:00 Dubai = veille en UTC)", async () => {
  // 2026-10-10T21:00Z = 2026-10-11 01:00 a Dubai.
  const today = todayDubai(Date.parse("2026-10-10T21:00:00Z"));
  assertEquals(today, "2026-10-11");
  const k = await dashboardKpis(seed(), "2026-10", today);
  assertEquals(k.last7DaysCompletions.map((d: any) => d.date),
    ["2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08", "2026-10-09", "2026-10-10", "2026-10-11"]);
  const by = Object.fromEntries(k.last7DaysCompletions.map((d: any) => [d.date, d.completions]));
  // r2 (done 2026-10-10T21:30Z) tombe le 11 a Dubai (01:30), pas le 10 comme le prefixe UTC.
  assertEquals([by["2026-10-09"], by["2026-10-10"], by["2026-10-11"]], [1, 0, 1]);
});
