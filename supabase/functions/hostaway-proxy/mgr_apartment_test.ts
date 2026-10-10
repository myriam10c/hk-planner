import { assertEquals } from "jsr:@std/assert@1";
import { fakeDb } from "./v3_fakedb.ts";
import type { CheckoutRow } from "./mgr_planning.ts";
import { healthScore, mgrApartment, mgrApartments, readHealthInputs, type MgrApartment } from "./mgr_apartment.ts";

const TODAY = "2026-10-09";
const NOW = Date.parse("2026-10-09T07:00:00Z"); // 11:00 Dubai
const ME = { cleaner_id: 8, name: "Walter", role: "manager", color: "" };
const REQ = new Request("https://x.test/?action=mgr.apartment");
const C = (listingId: string, guest: string, checkOut: string, o: any = {}): CheckoutRow =>
  ({ listingId, guest, checkOut, checkOutTime: 11, status: "confirmed", nextGuest: null, ...o });

const CHECKOUTS: CheckoutRow[] = [
  C("L1", "Ann Lee", "2026-10-06"),                       // fait, linge compte, Faiza
  C("L1", "Bo Ray", "2026-10-12"),                        // a venir, personne
  C("L1", "Cy Doe", "2026-10-01"),                        // annule
  C("L1", "Di Fox", "2026-10-03"),                        // reporte au 04
  C("L1", "Old", "2026-08-20"),                           // hors fenetre (30 jours)
  C("L1", "Far", "2026-10-20"),                           // hors fenetre (7 jours)
  C("L1", "Inq", "2026-10-05", { status: "inquiry" }),    // pas une reservation
  C("L2", "Other", "2026-10-06"),                         // autre logement
];

const DOC = {
  buildings: [
    { name: "Bahia", groups: [{ units: ["605"], emails: ["sec@bahia.test"], phoneDigits: "971500000000" }] },
    {
      name: "Binghatti Lavender",
      groups: [
        { units: ["308", "309"], emails: ["sec@bl.test"], phone: "+971 50 111 2222", phoneDigits: "971501112222",
          portal: "https://portal.bl.test", portalId: "medini", portalPassword: "S3cret!", notes: ["Gate code at desk"] },
        { units: [], emails: [], notes: [] },
      ],
    },
    { name: "Élysée 1", groups: [{ units: ["404"], emails: ["sec@elysee.test"], portalPassword: "hidden" }] },
  ],
};

const seed = () => fakeDb({
  listing_config: [
    { listing_id: "L1", internal_name: "308 - Binghatti Lavender", inspection_excluded: false },
    { listing_id: "L2", internal_name: "404 - ELYSEE 1", inspection_excluded: true },
    { listing_id: "L3", internal_name: "905 - Tower New" },
  ],
  cleaners: [
    { id: 4, name: "Faiza", role: "cleaner", is_active: true },
    { id: 10, name: "Pionah", role: "cleaner", is_active: true },
    { id: 8, name: "Walter", role: "manager", is_active: true },
    { id: 7, name: "Semax", role: "maintenance", is_active: true },
  ],
  vendors: [{ id: 3, name: "CoolFix", specialty: "AC", is_active: true }],
  cleaning_assignments: [
    { reservation_key: "2026-10-06_Ann Lee", cleaner_id: 4, service_type: "CHC" },
    { reservation_key: "2026-10-03_Di Fox", cleaner_id: 10, service_type: "CHC" },
    { reservation_key: "extra_2026-10-08_mx", cleaner_id: 4, service_type: "CHC" },
  ],
  menage_done: [{ reservation_key: "2026-10-06_Ann Lee", done: true }],
  cleaning_cancelled: [{ reservation_key: "2026-10-01_Cy Doe", reason: "Guest extended", cancelled_by: "Walter" }],
  cleaning_postponed: [{ reservation_key: "2026-10-03_Di Fox", original_date: "2026-10-03", new_date: "2026-10-04" }],
  laundry_counts: [{
    reservation_key: "2026-10-06_Ann Lee", pillowcases: 4, bed_sheets: 2, duvet_covers: 2,
    small_towels: 4, face_towels: 4, large_towels: 4, bath_mats: 2,
  }],
  extra_cleanings: [
    { id: 31, reservation_key: "extra_2026-10-08_mx", listing_id: "L1", cleaning_date: "2026-10-08", label: "Deep clean",
      guest_name: "Owner", status: "pending" },
    { id: 32, reservation_key: "extra_2026-10-07_gone", listing_id: "L1", cleaning_date: "2026-10-07", label: "Other", status: "cancelled" },
    { id: 33, reservation_key: "extra_2026-10-07_l2", listing_id: "L2", cleaning_date: "2026-10-07", label: "Other", status: "pending" },
  ],
  maintenance_tickets: [
    { id: 429, listing_id: "L1", title: "Gas not working", priority: "urgent", status: "open", source: "manual",
      assigned_technician_id: null, assigned_vendor_id: null, created_at: "2026-10-01T08:00:00Z", sla_deadline: null, resolved_at: null },
    { id: 430, listing_id: "L1", title: "AC noisy", priority: "normal", status: "assigned", source: "manual",
      assigned_technician_id: null, assigned_vendor_id: 3, created_at: "2026-09-20T08:00:00Z", sla_deadline: null, resolved_at: null },
    { id: 431, listing_id: "L1", title: "Lamp", priority: "low", status: "to_confirm", source: "inspection",
      assigned_technician_id: 7, assigned_vendor_id: null, created_at: "2026-10-05T08:00:00Z", sla_deadline: null, resolved_at: null },
    { id: 400, listing_id: "L1", title: "Leak fixed", priority: "high", status: "resolved", source: "manual",
      assigned_technician_id: 7, created_at: "2026-09-01T08:00:00Z", resolved_at: "2026-09-02T08:00:00Z" },
    { id: 300, listing_id: "L1", title: "Too old", priority: "low", status: "resolved", source: "manual",
      created_at: "2026-05-01T08:00:00Z", resolved_at: "2026-05-02T08:00:00Z" },
    { id: 301, listing_id: "L1", title: "Cancelled one", priority: "low", status: "cancelled", source: "manual",
      created_at: "2026-10-01T08:00:00Z", resolved_at: "2026-10-02T08:00:00Z" },
    { id: 500, listing_id: "L2", title: "Not mine", priority: "urgent", status: "open", source: "manual", created_at: "2026-10-01T08:00:00Z" },
  ],
  equipment: [
    { id: 1, listing_id: "L1", condition: "good", next_service: "2026-10-01" },
    { id: 2, listing_id: "L1", condition: "good", next_service: "2026-12-01" },
  ],
  maintenance_costs: [{ listing_id: "L1", amount: 120 }],
  guest_feedback: [{ listing_id: "L1", rating: 3 }, { listing_id: "L1", rating: 4 }],
  inspections: [
    { id: 71, listing_id: "L1", inspector_id: 8, started_at: "2026-10-08T06:00:00Z", finished_at: "2026-10-08T06:40:00Z", eligibility: "ok" },
    { id: 70, listing_id: "L1", inspector_id: 8, started_at: "2026-10-01T06:00:00Z", finished_at: "2026-10-01T06:40:00Z", eligibility: "ok" },
    { id: 69, listing_id: "L1", inspector_id: 7, started_at: "2026-09-20T06:00:00Z", finished_at: "2026-09-20T06:40:00Z", eligibility: "ok" },
    { id: 72, listing_id: "L1", inspector_id: 8, started_at: "2026-10-09T06:00:00Z", finished_at: null, eligibility: "ok" },
  ],
  inspection_items: [
    { inspection_id: 70, zone: "kitchen", status: "not_ok", outcome: "fixed", fix_note: "Wiped" },
    { inspection_id: 69, zone: "kitchen", status: "not_ok", outcome: "fixed", fix_note: "Wiped" },
    { inspection_id: 69, zone: "bathroom", status: "not_ok", outcome: "maintenance", ticket_id: 431 },
    { inspection_id: 71, zone: "bedroom", status: "ok" },
  ],
  inspection_photos: [],
  security_contacts_doc: [{ id: 1, data: DOC, updated_at: "2026-10-09T05:00:00Z" }],
});

// Les pannes simulees sont journalisees par le module : silence pendant ces tests.
async function quiet<T>(fn: () => Promise<T>): Promise<T> {
  const orig = console.error;
  console.error = () => {};
  try { return await fn(); } finally { console.error = orig; }
}

async function run(listingId: string, db: any = seed(), checkouts: () => Promise<any> = async () => ({ reservations: CHECKOUTS, cachedAt: null })) {
  const seen: Array<[string, string]> = [];
  const r = await mgrApartment(db, {
    listingId, today: TODAY, nowMs: NOW, me: ME, req: REQ,
    loadCheckouts: (s, e) => { seen.push([s, e]); return checkouts(); },
  });
  return { r, seen };
}

Deno.test("mgr.apartment : fiche complete (menages, tickets, inspections, contacts, sante)", async () => {
  const { r, seen } = await run("L1");
  assertEquals(r.status, 200);
  const b = r.body as MgrApartment;
  assertEquals(seen, [["2026-09-09", "2026-10-16"]]);
  assertEquals(b.listing, { id: "L1", apt: "308", bld: "Binghatti Lavender" });
  assertEquals(b.unavailable, []);
  assertEquals(b.cleanings.map((c) => [c.date, c.guest, c.by, c.done, c.cancelled]), [
    ["2026-10-12", "Bo Ray", [], false, false],
    ["2026-10-08", "Owner", ["Faiza"], false, false],
    ["2026-10-06", "Ann Lee", ["Faiza"], true, false],
    ["2026-10-04", "Di Fox", ["Pionah"], false, false],
    ["2026-10-01", "Cy Doe", [], false, true],
  ]);
  assertEquals(b.cleanings[2].linen, { total: 22, pillowcases: 4, bed_sheets: 2, duvet_covers: 2, small_towels: 4, face_towels: 4, large_towels: 4, bath_mats: 2 });
  assertEquals(b.cleanings[0].linen, null);
  assertEquals(b.cleanings[1].extra, "Deep clean");
  assertEquals(b.cleanings[0].extra, null);

  assertEquals(b.tickets.open, [
    { ref: "MNT-429", title: "Gas not working", priority: "urgent", createdAt: "2026-10-01T08:00:00Z", assignee: null },
    { ref: "MNT-430", title: "AC noisy", priority: "normal", createdAt: "2026-09-20T08:00:00Z", assignee: "Vendor CoolFix" },
    { ref: "MNT-431", title: "Lamp", priority: "low", createdAt: "2026-10-05T08:00:00Z", assignee: "Semax" },
  ]);
  assertEquals(b.tickets.recent, [{ ref: "MNT-400", title: "Leak fixed", resolvedAt: "2026-09-02T08:00:00Z" }]);

  assertEquals(b.inspections, [
    { id: 71, finishedAt: "2026-10-08T06:40:00Z", inspector: "Walter", result: "clean", issues: 0 },
    { id: 70, finishedAt: "2026-10-01T06:40:00Z", inspector: "Walter", result: "fixed", issues: 1 },
    { id: 69, finishedAt: "2026-09-20T06:40:00Z", inspector: "Semax", result: "maintenance", issues: 2 },
  ]);

  // 3 ouverts (-15), 1 urgent (-10), 1 entretien en retard (-8), note 3.5 (-5).
  assertEquals(b.health, { score: 62, openTickets: 3, urgentOpen: 1, overdueService: 1, ratingPenalty: 5 });

  assertEquals(b.security, {
    building: "Binghatti Lavender",
    groups: [
      { units: ["308", "309"], phone: "+971 50 111 2222", emails: ["sec@bl.test"], portal: "https://portal.bl.test", notes: ["Gate code at desk"] },
      { units: [], phone: null, emails: [], portal: null, notes: [] },
    ],
  });
  assertEquals(JSON.stringify(b).includes("S3cret"), false);
  assertEquals(JSON.stringify(b).includes("portalPassword"), false);
  assertEquals(b.generatedAt, new Date(NOW).toISOString());
});

Deno.test("mgr.apartment : logement neuf sans donnees, chaque section vide, sante 100", async () => {
  const { r } = await run("L3", seed(), async () => ({ reservations: [], cachedAt: null }));
  assertEquals(r.status, 200);
  const b = r.body as MgrApartment;
  assertEquals(b.listing, { id: "L3", apt: "905", bld: "Tower New" });
  assertEquals([b.cleanings, b.tickets, b.inspections, b.security], [[], { open: [], recent: [] }, [], null]);
  assertEquals(b.health, { score: 100, openTickets: 0, urgentOpen: 0, overdueService: 0, ratingPenalty: 0 });
  assertEquals(b.unavailable, []);
});

Deno.test("mgr.apartment : listingId absent 400, logement inconnu 404", async () => {
  assertEquals((await run("")).r, { status: 400, body: { error: "listingId required" } });
  assertEquals((await run("L404")).r, { status: 404, body: { error: "Apartment not found" } });
});

Deno.test("mgr.apartment : une source en panne vide sa section, jamais de 500", async () => {
  const db = seed();
  db.fail["maintenance_tickets.select"] = { message: "boom" };
  db.fail["security_contacts_doc.select"] = { message: "boom" };
  db.fail["cleaning_assignments.select"] = { message: "boom" };
  const { r } = await quiet(() => run("L1", db, async () => { throw new Error("Hostaway API error 502"); }));
  assertEquals(r.status, 200);
  const b = r.body as MgrApartment;
  assertEquals(b.cleanings, []);
  assertEquals(b.tickets, { open: [], recent: [] });
  assertEquals(b.security, null);
  assertEquals(b.inspections.length, 3);
  assertEquals(b.unavailable.sort(), ["cleanings", "health", "security", "tickets"]);
});

Deno.test("mgr.apartment : contacts securite, immeuble trouve sans casse ni accents, sans mot de passe", async () => {
  const { r } = await run("L2", seed(), async () => ({ reservations: [], cachedAt: null }));
  const b = r.body as MgrApartment;
  assertEquals(b.listing.bld, "ELYSEE 1");
  assertEquals(b.security, {
    building: "Élysée 1",
    groups: [{ units: ["404"], phone: null, emails: ["sec@elysee.test"], portal: null, notes: [] }],
  });
  assertEquals(JSON.stringify(b.security).includes("hidden"), false);
  // Pas de document publie : section vide, sans erreur.
  const db = seed();
  db.tables.security_contacts_doc = [];
  const r2 = await run("L1", db);
  assertEquals((r2.r.body as MgrApartment).security, null);
  assertEquals((r2.r.body as MgrApartment).unavailable, []);
});

// Formule de l'ancien getPropertyHealth (index.ts avant cette tache), recopiee telle
// quelle comme reference : healthScore doit rendre les memes nombres.
function legacyHealth(tickets: any[], equip: any[], costs: any[], feedback: any[], today: string) {
  const openTickets = tickets.filter((t: any) => ["open", "assigned", "in_progress", "waiting_parts"].includes(t.status));
  const urgentOpen = openTickets.filter((t: any) => t.priority === "urgent" || t.priority === "high");
  const totalCost = costs.reduce((s: number, c: any) => s + Number(c.amount), 0);
  const avgRating = feedback.length > 0 ? feedback.reduce((s: number, f: any) => s + f.rating, 0) / feedback.length : 0;
  const overdueEquip = equip.filter((e: any) => e.next_service && e.next_service < today);
  let score = 100;
  score -= openTickets.length * 5;
  score -= urgentOpen.length * 10;
  score -= overdueEquip.length * 8;
  if (avgRating > 0 && avgRating < 4) score -= (4 - avgRating) * 10;
  score = Math.max(0, Math.min(100, score));
  return { score, openTickets: openTickets.length, urgentOpen: urgentOpen.length, totalEquipment: equip.length, overdueService: overdueEquip.length, totalCost, avgRating: Math.round(avgRating * 10) / 10, totalFeedback: feedback.length };
}

Deno.test("healthScore : memes nombres que l'ancien getPropertyHealth", () => {
  const cases = [
    { t: [], e: [], c: [], f: [] },
    { t: [{ status: "open", priority: "urgent" }, { status: "in_progress", priority: "high" }, { status: "resolved", priority: "urgent" }],
      e: [{ next_service: "2026-10-01" }, { next_service: null }, { next_service: "2026-10-09" }], c: [{ amount: "100.5" }, { amount: 20 }], f: [{ rating: 2 }, { rating: 3 }, { rating: 5 }] },
    { t: Array.from({ length: 12 }, () => ({ status: "waiting_parts", priority: "urgent" })), e: [], c: [], f: [{ rating: 1 }] },
    { t: [{ status: "assigned", priority: "normal" }], e: [], c: [], f: [{ rating: 4.5 }] },
  ];
  for (const k of cases) {
    const h = healthScore({ tickets: k.t, equipment: k.e, costs: k.c, feedback: k.f, today: TODAY });
    const { ratingPenalty: _p, ...rest } = h;
    assertEquals(rest, legacyHealth(k.t, k.e, k.c, k.f, TODAY));
  }
  // to_confirm compte comme ouvert (liste unique MGR_OPEN_TICKET_STATUSES, comme Problems).
  assertEquals(healthScore({ tickets: [{ status: "to_confirm", priority: "low" }], equipment: [], costs: [], feedback: [], today: TODAY }).openTickets, 1);
  assertEquals(healthScore({ tickets: [], equipment: [], costs: [], feedback: [{ rating: 3.5 }], today: TODAY }).ratingPenalty, 5);
});

Deno.test("readHealthInputs : lit les quatre tables du logement, une table en panne est signalee", async () => {
  const db = seed();
  db.fail["guest_feedback.select"] = { message: "boom" };
  const h = await quiet(() => readHealthInputs(db, "L1"));
  assertEquals([h.tickets.length, h.equipment.length, h.costs.length, h.feedback.length], [6, 2, 1, 0]);
  assertEquals(h.failed, ["guest_feedback"]);
});

Deno.test("mgr.apartments : liste des logements (meme source que Planning) avec exclusion", async () => {
  const r = await mgrApartments(seed());
  assertEquals(r.status, 200);
  assertEquals((r.body as any).listings, [
    { id: "L1", apt: "308", bld: "Binghatti Lavender", excluded: false },
    { id: "L2", apt: "404", bld: "ELYSEE 1", excluded: true },
    { id: "L3", apt: "905", bld: "Tower New", excluded: false },
  ]);
});
