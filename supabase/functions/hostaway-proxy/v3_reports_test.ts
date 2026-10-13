// Tests de v3.myReports (maintenance phase 3, C12) : les signalements de la
// cleaner connectee sur les 7 derniers jours de Dubai.
import { assertEquals } from "jsr:@std/assert@1";
import { fakeDb } from "./v3_fakedb.ts";
import { myReports } from "./v3_reports.ts";

const FAIZA = { cleaner_id: 3, name: "Faiza", role: "cleaner", color: "#e94560" };
// 2026-09-12 12:00 a Dubai.
const NOW = Date.parse("2026-09-12T08:00:00Z");

function ticket(id: number, extra: Record<string, unknown>) {
  return {
    id, listing_id: "102", title: "AC · Bedroom", status: "open", source: "hk_planner_v3",
    reported_by: "Faiza", assigned_technician_id: null, assigned_vendor_id: null,
    created_at: "2026-09-12T06:00:00Z", ...extra,
  };
}

function base(tickets: any[]) {
  return fakeDb({
    maintenance_tickets: tickets,
    listing_config: [
      { listing_id: "102", internal_name: "623 Samana Park View", listing_name: "Sunny 1bdr", apt_number: "623" },
      { listing_id: "103", internal_name: "", listing_name: "Cosy studio", apt_number: "122" },
    ],
    cleaners: [{ id: 5, name: "Semax", role: "maintenance", is_active: true }],
    vendors: [{ id: 9, name: "Cool Air LLC", is_active: true }],
  });
}

Deno.test("myReports rend mes signalements des 7 derniers jours, le plus recent d'abord", async () => {
  const sb = base([
    ticket(1, { created_at: "2026-09-12T06:00:00Z", status: "assigned", assigned_technician_id: 5 }),
    ticket(2, { created_at: "2026-09-11T06:00:00Z", status: "in_progress", title: "Leak · Kitchen" }),
    // 2026-09-06 00:30 a Dubai : premier jour de la fenetre, compris.
    ticket(3, { created_at: "2026-09-05T20:30:00Z", status: "resolved", listing_id: "103" }),
    // 2026-09-05 23:30 a Dubai : hors fenetre.
    ticket(4, { created_at: "2026-09-05T19:30:00Z" }),
    // Annule : jamais rendu.
    ticket(5, { status: "cancelled" }),
    // Un autre auteur, une autre source : jamais rendus.
    ticket(6, { reported_by: "Pionah" }),
    ticket(7, { source: "manual" }),
    ticket(8, { created_at: "2026-09-10T06:00:00Z", status: "waiting_parts", assigned_vendor_id: 9 }),
    ticket(9, { created_at: "2026-09-09T06:00:00Z", status: "to_confirm" }),
    ticket(10, { created_at: "2026-09-08T06:00:00Z", status: "closed", title: "Broken" }),
    ticket(11, { created_at: "2026-09-07T06:00:00Z", status: "open", listing_id: "999" }),
  ]);
  const r = await myReports(sb, FAIZA as any, NOW);
  assertEquals(r.status, 200);
  assertEquals((r.body as any).reports, [
    { id: 1, title: "AC · Bedroom", place: "Bedroom", listingLabel: "623 Samana Park View",
      reportedOn: "2026-09-12", status: "with_tech", techName: "Semax" },
    { id: 2, title: "Leak · Kitchen", place: "Kitchen", listingLabel: "623 Samana Park View",
      reportedOn: "2026-09-11", status: "in_progress", techName: null },
    { id: 8, title: "AC · Bedroom", place: "Bedroom", listingLabel: "623 Samana Park View",
      reportedOn: "2026-09-10", status: "waiting_parts", techName: "Cool Air LLC" },
    { id: 9, title: "AC · Bedroom", place: "Bedroom", listingLabel: "623 Samana Park View",
      reportedOn: "2026-09-09", status: "to_confirm", techName: null },
    { id: 10, title: "Broken", place: "", listingLabel: "623 Samana Park View",
      reportedOn: "2026-09-08", status: "fixed", techName: null },
    { id: 11, title: "AC · Bedroom", place: "Bedroom", listingLabel: "Apartment",
      reportedOn: "2026-09-07", status: "open", techName: null },
    { id: 3, title: "AC · Bedroom", place: "Bedroom", listingLabel: "Cosy studio",
      reportedOn: "2026-09-06", status: "fixed", techName: null },
  ]);
});

Deno.test("myReports rend une liste vide pour une cleaner sans signalement", async () => {
  const r = await myReports(base([ticket(1, { reported_by: "Pionah" })]), FAIZA as any, NOW);
  assertEquals(r, { status: 200, body: { reports: [] } });
});

Deno.test("myReports rend les signalements meme si noms et logements sont illisibles", async () => {
  const sb = base([ticket(1, { status: "assigned", assigned_technician_id: 5 })]);
  sb.fail["cleaners.select"] = { message: "boom" };
  sb.fail["vendors.select"] = { message: "boom" };
  sb.fail["listing_config.select"] = { message: "boom" };
  const r = await myReports(sb, FAIZA as any, NOW);
  const rows = (r.body as any).reports;
  assertEquals(rows.length, 1);
  assertEquals(rows[0].techName, null);
  assertEquals(rows[0].listingLabel, "Apartment");
});

// Revue finale (G9) : une date de creation illisible ne s'invente pas en
// « aujourd'hui » ; le Profile n'affiche alors aucun jour.
Deno.test("myReports rend reportedOn null quand created_at est illisible", async () => {
  const sb = base([ticket(1, { created_at: "pas une date" })]);
  const r = await myReports(sb, FAIZA as any, NOW);
  const rows = (r.body as any).reports;
  assertEquals(rows.length, 1);
  assertEquals(rows[0].reportedOn, null);
});

Deno.test("myReports leve quand les tickets sont illisibles", async () => {
  const sb = base([]);
  sb.fail["maintenance_tickets.select"] = { message: "boom" };
  let leve = false;
  try { await myReports(sb, FAIZA as any, NOW); } catch { leve = true; }
  assertEquals(leve, true);
});

// Branchement dans index.ts : assertions sur la source, comme mnt_routes_test.ts
// (index.ts n'est pas importable en test).
Deno.test("index.ts declare v3.ticketStill et v3.myReports, sous session et roleAllowed", async () => {
  const src = await Deno.readTextFile(new URL("./index.ts", import.meta.url));
  for (const [action, methode, appel] of [
    ["v3.ticketStill", "POST", "ticketStill(sb, me, body)"],
    ["v3.myReports", "GET", "myReports(sb, me, Date.now())"],
  ]) {
    assertEquals(src.includes(`["${action}", "${methode}"]`), true, action);
    const debut = src.indexOf(`if (action === "${action}" && req.method === "${methode}")`);
    assertEquals(debut >= 0, true, "handler absent pour " + action);
    const b = src.slice(debut, src.indexOf("if (action ===", debut + 10));
    const session = b.indexOf("await currentUser(sb, req)");
    const role = b.indexOf("roleAllowed(action, me.role)");
    assertEquals(session >= 0 && role > session && b.indexOf(appel) > role, true, action);
  }
});
