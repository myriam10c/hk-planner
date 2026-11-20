// Lot 1, tache 7 : la cle d'un menage est la meme dans Today (app manager), dans
// Planning et dans la journee de la cleaner, alors que les trois lectures ne
// chargent pas le meme ensemble de reservations :
//   - Today : departs des 14 derniers jours et arrivees des 14 prochains jours,
//     tous logements, tous statuts, filtres ensuite (loadMgrReservations) ;
//   - Planning : departs de la semaine, statuts valides (payload checkouts) ;
//   - journee de la cleaner : departs du jour et des six suivants, meme payload,
//     dans un autre ordre, et seuls ses menages affectes sont rendus.
import { assertEquals } from "jsr:@std/assert@1";
import { fakeDb } from "./v3_fakedb.ts";
import { jobKeyFor, plusDays, V3_LINEN_FIELDS } from "./v3.ts";
import { checkoutKeys, normalizeMgrReservations } from "./mgr_rules.ts";
import { buildJobs, loadCore } from "./mgr_today.ts";
import { mgrPlanning, type MgrPlanning } from "./mgr_planning.ts";
import { buildMyDay } from "./v3_myday.ts";
import { finishJob, loadFinishContext, startJob } from "./v3_write.ts";

const DAY = "2026-11-21";
const NOW = Date.parse("2026-11-21T06:00:00Z"); // 10:00 Dubai
const FAIZA = { cleaner_id: 3, name: "Faiza", role: "cleaner", color: "#e94560" };
const HARLENE = { cleaner_id: 4, name: "Harlene", role: "cleaner", color: "#0f3460" };
const WALTER = { cleaner_id: 8, name: "Walter", role: "manager", color: "" };
const VALID = ["new", "modified", "confirmed", "ownerStay", "reserved"];
const NUE = DAY + "_Kim Wu";
const SUFFIXEE = DAY + "_Kim Wu~11";

// Hostaway, une seule verite. Kim Wu quitte deux logements le 21 : 5001 (logement
// 10) est la plus ancienne, 5002 (logement 11) la plus recente. 4999 (logement 12)
// est plus ancienne encore, mais annulee : elle ne compte dans aucune lecture.
const HOSTAWAY: any[] = [
  { id: 4999, listingMapId: 12, listingName: "112 Twin C", guestName: "Kim Wu", arrivalDate: "2026-11-17", departureDate: DAY, status: "cancelled" },
  { id: 5001, listingMapId: 10, listingName: "110 Twin A", guestName: "Kim Wu", arrivalDate: "2026-11-18", departureDate: DAY, status: "confirmed", checkOutTime: 11 },
  { id: 5002, listingMapId: 11, listingName: "111 Twin B", guestName: "Kim Wu", arrivalDate: "2026-11-18", departureDate: DAY, status: "confirmed", checkOutTime: 11 },
  { id: 5003, listingMapId: 11, listingName: "111 Twin B", guestName: "Max Oh", arrivalDate: DAY, departureDate: "2026-11-25", status: "confirmed", checkInTime: 15 },
  { id: 4800, listingMapId: 10, listingName: "110 Twin A", guestName: "Old One", arrivalDate: "2026-11-10", departureDate: "2026-11-15", status: "confirmed" },
  { id: 5010, listingMapId: 10, listingName: "110 Twin A", guestName: "Lea Ng", arrivalDate: "2026-11-23", departureDate: "2026-11-26", status: "confirmed" },
];

// Today : meme fenetre que loadMgrReservations (index.ts), arrivees listees d'abord.
function todayReservations() {
  const deps = HOSTAWAY.filter((r) => r.departureDate >= plusDays(DAY, -14) && r.departureDate <= DAY);
  const arrs = HOSTAWAY.filter((r) => r.arrivalDate >= DAY && r.arrivalDate <= plusDays(DAY, 14));
  return normalizeMgrReservations([...arrs, ...deps]);
}

// Lignes du payload checkouts telles que buildCheckoutsPayload (index.ts) les rend.
function checkouts(start: string, end: string) {
  return HOSTAWAY.filter((r) => VALID.includes(r.status) && r.departureDate >= start && r.departureDate <= end)
    .map((r) => ({
      id: r.id, guest: r.guestName, listing: r.listingName, listingId: String(r.listingMapId),
      checkIn: r.arrivalDate, checkOut: r.departureDate, checkInTime: r.checkInTime ?? null,
      checkOutTime: r.checkOutTime ?? null, status: r.status, nextGuest: null,
    }));
}

const LISTINGS: Record<string, any> = {
  "10": { listing_id: "10", internal_name: "110 - Twin A", bedrooms: 0, unit_type: "Studio" },
  "11": { listing_id: "11", internal_name: "111 - Twin B", bedrooms: 0, unit_type: "Studio" },
  "12": { listing_id: "12", internal_name: "112 - Twin C", bedrooms: 0, unit_type: "Studio" },
};

// Faiza est affectee au menage du logement 10 (cle nue), Harlene a celui du
// logement 11 (cle suffixee).
const base = () => fakeDb({
  v3_job_keys: [], job_events: [], cleaning_timer: [], menage_done: [], cleaning_log: [],
  checklist_progress: [], laundry_counts: [], cleaning_reports: [], photos: [],
  listing_config: Object.values(LISTINGS),
  cleaners: [
    { id: 3, name: "Faiza", role: "cleaner", is_active: true },
    { id: 4, name: "Harlene", role: "cleaner", is_active: true },
    { id: 8, name: "Walter", role: "manager", is_active: true },
  ],
  cleaning_assignments: [
    { reservation_key: NUE, cleaner_id: 3, service_type: "CHC" },
    { reservation_key: SUFFIXEE, cleaner_id: 4, service_type: "CHC" },
  ],
  cleaning_cancelled: [], cleaning_postponed: [], extra_cleanings: [], maintenance_tickets: [],
});

// Journee de la cleaner comme index.ts la monte : les lectures d'etat sont bornees
// aux cles du payload (checkoutKeys, voir le test sur index.ts plus bas).
async function journee(sb: any, me: any, reservations: any[], postponed: Record<string, string> = {}) {
  const keys = checkoutKeys(reservations);
  const parCle = (table: string) => sb.tables[table].filter((r: any) => keys.includes(r.reservation_key));
  return await buildMyDay({
    sb, date: DAY, me, reservations, extras: [], listings: LISTINGS,
    templates: [{ name: "Studio", items: ["Living Room", "Bathroom"], photo_required_items: [] }],
    assignedKeys: parCle("cleaning_assignments").filter((a: any) => a.cleaner_id === me.cleaner_id)
      .map((a: any) => a.reservation_key),
    postponed, cancelled: [],
    done: parCle("menage_done").filter((d: any) => d.done).map((d: any) => d.reservation_key),
    timers: Object.fromEntries(parCle("cleaning_timer").map((t: any) => [t.reservation_key, t])),
    tickets: [], progress: {},
  });
}

const today = async (sb: any) =>
  buildJobs(await loadCore(sb, { day: DAY, nowMs: NOW, riskHours: 6, reservations: todayReservations() }))
    .filter((j) => j.kind === "checkout");

Deno.test("tache 7 : la journee de la cleaner rend la meme cle que Today et Planning", async () => {
  const sb = base();
  assertEquals((await today(sb)).map((j) => [j.listingId, j.key, j.assigned]), [
    ["10", NUE, [3]],
    ["11", SUFFIXEE, [4]],
  ]);
  const plan = await mgrPlanning(sb, {
    start: "2026-11-16", today: DAY, nowMs: NOW, me: WALTER as any,
    loadCheckouts: async (s: string, e: string) => ({ reservations: checkouts(s, e), cachedAt: null }),
  });
  assertEquals((plan.body as MgrPlanning).jobs.filter((j) => j.date === DAY).map((j) => [j.listingId, j.key, j.assigned]), [
    ["10", NUE, [3]],
    ["11", SUFFIXEE, [4]],
  ]);
  // Harlene, affectee au logement qui recoit le suffixe : la journee ne porte que
  // ce menage-la, sous l'identifiant oppose de la cle suffixee. Payload a
  // l'envers : l'ordre de la liste ne decide pas.
  const harlene = await journee(sb, HARLENE, checkouts(DAY, plusDays(DAY, 6)).reverse());
  assertEquals(harlene.stops.map((s) => [s.listingId, s.jobId]), [["11", await jobKeyFor(SUFFIXEE)]]);
  const faiza = await journee(sb, FAIZA, checkouts(DAY, plusDays(DAY, 6)));
  assertEquals(faiza.stops.map((s) => [s.listingId, s.jobId]), [["10", await jobKeyFor(NUE)]]);
  // Chaque identifiant oppose renvoie a sa cle et a son logement.
  assertEquals(sb.tables.v3_job_keys.map((k: any) => [k.reservation_key, k.listing_id]).sort(), [[NUE, "10"], [SUFFIXEE, "11"]]);
});

Deno.test("tache 7 : demarrer et finir le menage suffixe ecrit sous sa cle, l'autre menage reste intact", async () => {
  const sb = base();
  const [stop] = (await journee(sb, HARLENE, checkouts(DAY, plusDays(DAY, 6)))).stops;
  const s = await startJob(sb, HARLENE as any, { jobId: stop.jobId, idem: "idem-twin-0001" }, () => Promise.resolve());
  assertEquals(s.status, 200);
  assertEquals(sb.tables.cleaning_timer.map((t: any) => t.reservation_key), [SUFFIXEE]);
  const linen: Record<string, number> = {};
  for (const f of V3_LINEN_FIELDS) linen[f] = 1;
  const f = await finishJob(sb, HARLENE as any, {
    jobId: stop.jobId, checklist: { "Living Room": true, "Bathroom": true }, linen, idem: "idem-twin-0002",
  }, { sameDay: false, listingName: "", managerIds: [] }, { push: () => Promise.resolve({ sent: 0, pruned: 0, skipped: null }) });
  assertEquals(f.status, 200);
  assertEquals(sb.tables.menage_done.map((d: any) => [d.reservation_key, d.done]), [[SUFFIXEE, true]]);
  assertEquals(sb.tables.laundry_counts.map((l: any) => l.reservation_key), [SUFFIXEE]);
  assertEquals([...new Set(sb.tables.checklist_progress.map((c: any) => c.reservation_key))], [SUFFIXEE]);
  // Today : fini pour le logement 11 seulement ; Faiza a toujours son menage a faire.
  assertEquals((await today(sb)).map((j) => [j.listingId, j.state]), [["10", "not_started"], ["11", "done"]]);
  const faiza = await journee(sb, FAIZA, checkouts(DAY, plusDays(DAY, 6)));
  assertEquals(faiza.stops.map((s) => [s.listingId, s.state]), [["10", "todo"]]);
});

Deno.test("tache 7 : le menage suffixe reporte au jour de la cleaner arrive avec sa cle", async () => {
  // Departs du 20 reportes au 21 : le payload du 21 les garde tous les deux (cles
  // nues des reports, buildCheckoutsPayload), seul celui du logement 11 est reporte.
  const veille = HOSTAWAY.filter((r) => r.departureDate === DAY && r.status === "confirmed" && r.guestName === "Kim Wu")
    .map((r) => ({ ...r, departureDate: "2026-11-20" }));
  const payload = veille.map((r) => ({
    id: r.id, guest: r.guestName, listing: r.listingName, listingId: String(r.listingMapId),
    checkOut: r.departureDate, checkOutTime: r.checkOutTime, status: r.status, nextGuest: null,
  }));
  const sb = base();
  sb.tables.cleaning_assignments = [
    { reservation_key: "2026-11-20_Kim Wu", cleaner_id: 3, service_type: "CHC" },
    { reservation_key: "2026-11-20_Kim Wu~11", cleaner_id: 4, service_type: "CHC" },
  ];
  const report = { "2026-11-20_Kim Wu~11": DAY };
  const harlene = await journee(sb, HARLENE, payload, report);
  assertEquals(harlene.stops.map((s) => [s.listingId, s.jobId]), [["11", await jobKeyFor("2026-11-20_Kim Wu~11")]]);
  // Le menage du logement 10 n'est pas reporte : il n'est pas du 21.
  assertEquals((await journee(sb, FAIZA, payload, report)).stops, []);
});

// Correction avant revue : le contexte de fin (notification same-day aux managers,
// logement du rapport) retrouve la reservation d'un menage par la meme
// attribution que la journee de la cleaner. Instantane checkouts du 21 : Max Oh
// arrive le jour meme sur le logement 11 seulement.
function instantane(lignes: any[]) {
  return { key: "checkouts:" + DAY + "_" + plusDays(DAY, 6), updated_at: new Date().toISOString(), payload: { reservations: lignes } };
}
const LIGNES = checkouts(DAY, plusDays(DAY, 6)).map((r) => ({
  ...r,
  nextGuest: r.listingId === "11" && r.checkOut === DAY
    ? { guest: "Max Oh", date: DAY, checkInTime: 15, sameDay: true }
    : r.listingId === "10" && r.checkOut === DAY ? { guest: "Lea Ng", date: "2026-11-23", checkInTime: null, sameDay: false } : null,
}));
const contexteDb = (lignes: any[]) => {
  const sb = base();
  sb.tables.proxy_cache = [instantane(lignes)];
  return sb;
};

Deno.test("tache 7 : contexte de fin d'une cle suffixee, le logement suffixe et son same-day", async () => {
  const ctx = await loadFinishContext(contexteDb(LIGNES), SUFFIXEE);
  assertEquals([ctx.sameDay, ctx.listingId, ctx.listingName, ctx.managerIds], [true, "11", "111 - Twin B", [8]]);
});

Deno.test("tache 7 : contexte de fin de la cle nue d'une collision, la gardienne quel que soit l'ordre", async () => {
  for (const lignes of [LIGNES, [...LIGNES].reverse()]) {
    const ctx = await loadFinishContext(contexteDb(lignes), NUE);
    assertEquals([ctx.sameDay, ctx.listingId, ctx.listingName], [false, "10", "110 - Twin A"]);
  }
});

Deno.test("tache 7 : contexte de fin sans collision, comme avant", async () => {
  // Kim Wu ne quitte plus que le logement 11 : la cle nue est la sienne.
  const seule = LIGNES.filter((r) => !(r.listingId === "10" && r.checkOut === DAY));
  const ctx = await loadFinishContext(contexteDb(seule), NUE);
  assertEquals([ctx.sameDay, ctx.listingId, ctx.listingName], [true, "11", "111 - Twin B"]);
  // Une cle absente de l'instantane : aucune notification, aucun logement, sans erreur.
  const rien = await loadFinishContext(contexteDb(seule), SUFFIXEE);
  assertEquals([rien.sameDay, rien.listingId, rien.listingName], [false, null, ""]);
});

Deno.test("tache 7 : la fin du menage suffixe same-day notifie les managers et pose son logement", async () => {
  const sb = contexteDb(LIGNES);
  const [stop] = (await journee(sb, HARLENE, checkouts(DAY, plusDays(DAY, 6)))).stops;
  await startJob(sb, HARLENE as any, { jobId: stop.jobId, idem: "idem-twin-0101" }, () => Promise.resolve());
  const linen: Record<string, number> = {};
  for (const f of V3_LINEN_FIELDS) linen[f] = 1;
  const envois: Array<{ cid: number; payload: any }> = [];
  // Meme enchainement que index.ts : la cle resolue donne le contexte, puis la fin.
  const ctx = await loadFinishContext(sb, SUFFIXEE);
  const f = await finishJob(sb, HARLENE as any, {
    jobId: stop.jobId, checklist: { "Living Room": true, "Bathroom": true }, linen,
    report: { text: "All good" }, idem: "idem-twin-0102",
  }, ctx, { push: (_sb: any, cid: number, payload: any) => { envois.push({ cid, payload }); return Promise.resolve({ sent: 1, pruned: 0, skipped: null }); } });
  assertEquals(f.status, 200);
  assertEquals(envois.map((e) => [e.cid, e.payload.title]), [[8, "Same-day cleaning finished"]]);
  assertEquals(envois[0].payload.body.startsWith("111 - Twin B is ready."), true);
  assertEquals(sb.tables.cleaning_reports.map((r: any) => [r.reservation_key, r.payload.listingId]), [[SUFFIXEE, "11"]]);
});

async function sourceIndex(): Promise<string> {
  return await Deno.readTextFile(new URL("./index.ts", import.meta.url));
}

Deno.test("tache 7 : index.ts lit l'etat de myDay et filtre les reports avec les cles partagees", async () => {
  const src = await sourceIndex();
  const bloc = src.match(/if \(action === "v3\.myDay"\)[\s\S]*?return jsonResp\(body\);/);
  assertEquals(bloc !== null, true);
  // Les lectures d'etat de la journee portent les cles suffixees.
  assertEquals(bloc![0].includes("...checkoutKeys(reservations),"), true);
  assertEquals(bloc![0].includes('String(r.checkOut) + "_"'), false);
  // Un report du menage suffixe garde tout le groupe dans le payload de sa semaine
  // d'arrivee : sans l'autre reservation, la lecture ne saurait pas qui garde la cle nue.
  const payload = src.match(/async function buildCheckoutsPayload[\s\S]*?\n}\n/);
  assertEquals(payload !== null, true);
  assertEquals(payload![0].includes("const postKeys = withBareKeys(postponedIn.map((r) => r.reservation_key));"), true);
});
