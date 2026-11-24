import { assertEquals } from "jsr:@std/assert@1";
import { fakeDb } from "./v3_fakedb.ts";
import { autopilotDepartures, runAutopilot } from "./autopilot.ts";
import { checkoutKeys, normalizeMgrReservations, reservationKeys } from "./mgr_rules.ts";
import { INSP_VALID_STATUSES } from "./insp_rules.ts";

// Jour Dubai passe a la fonction : le 11 alors qu'a 01:00 Dubai la date UTC est encore le 10.
const DAY = "2026-10-11";

const R = (guest: string, listingName: string, id: number) => ({
  departureDate: DAY, guestName: guest, listingName, listingMapId: id, status: "confirmed",
});

const seed = () => fakeDb({
  app_config: [{ key: "auto_send_cleaners", value: "true" }],
  cleaners: [
    { id: 4, name: "Faiza", phone: "+971 50 111 2222", role: "cleaner", is_active: true },
    { id: 10, name: "Pionah", phone: "+971 50 333 4444", role: "cleaner", is_active: true },
    { id: 8, name: "Walter", phone: "+971 50 999 9999", role: "manager", is_active: true },
  ],
  cleaning_assignments: [],
  cleaning_postponed: [],
  // Conge approuve uniquement le jour passe : il doit etre respecte.
  leave_requests: [{ cleaner_id: 4, start_date: DAY, end_date: DAY, status: "approved" }],
});

Deno.test("runAutopilot: le cleaner en conge ce jour-la ne recoit rien, le jour passe est utilise", async () => {
  const db = seed();
  const asked: string[] = [];
  const out = await runAutopilot(db, DAY, async (d) => {
    asked.push(d);
    return [R("Ann Lee", "308 - Binghatti Lavender", 1), R("Bo Ray", "103 - Damac Reva", 2), R("Cy Doe", "909 - Bloom Height", 3)];
  });
  assertEquals(asked, [DAY]);
  assertEquals(out.checkouts, 3);
  assertEquals(out.alreadyAssigned, 0);
  assertEquals(out.newlyAssigned, 3);
  assertEquals(out.autoSendEnabled, true);
  const ids = db.tables.cleaning_assignments.map((a: any) => a.cleaner_id);
  assertEquals(ids, [10, 10, 10]);
  assertEquals(db.tables.cleaning_assignments.map((a: any) => a.reservation_key),
    [DAY + "_Ann Lee", DAY + "_Bo Ray", DAY + "_Cy Doe"]);
  assertEquals(out.notified.length, 1);
  assertEquals(out.notified[0].cleaner, "Pionah");
  assertEquals(out.notified[0].tasks, 3);
  assertEquals(String(out.notified[0].waLink).startsWith("https://wa.me/+971503334444?text="), true);
});

Deno.test("runAutopilot: deja assigne compte a part, auto-send desactive remonte false", async () => {
  const db = seed();
  db.tables.app_config[0].value = "false";
  db.tables.cleaning_assignments.push({ reservation_key: DAY + "_Ann Lee", cleaner_id: 4 });
  const out = await runAutopilot(db, DAY, async () => [R("Ann Lee", "308", 1), R("Bo Ray", "103", 2)]);
  assertEquals(out.alreadyAssigned, 1);
  assertEquals(out.newlyAssigned, 1);
  assertEquals(out.autoSendEnabled, false);
  assertEquals(out.notified.map((n: any) => n.cleaner).sort(), ["Faiza", "Pionah"]);
});

Deno.test("runAutopilot: aucun depart garde les champs de l ancienne reponse", async () => {
  const out: any = await runAutopilot(seed(), DAY, async () => []);
  assertEquals(out.message, "No checkouts today");
  assertEquals(out.checkouts, 0);
  assertEquals(out.assigned, 0);
  assertEquals(out.notified, []);
});

Deno.test("runAutopilot: statuts hors reservation ignores, config absente = auto-send actif", async () => {
  const db = seed();
  db.tables.app_config = [];
  const out = await runAutopilot(db, DAY, async () => [{ ...R("Zed", "x", 9), status: "inquiry" }, R("Bo Ray", "103", 2)]);
  assertEquals(out.checkouts, 1);
  assertEquals(out.autoSendEnabled, true);
});

// Lot 1, tache 7 (seconde lecture Fable, M2) : memes cles que Today, Planning et
// la journee de la cleaner. Meme voyageur dans deux logements le meme jour.
const RAW = [
  { id: 502, departureDate: DAY, arrivalDate: "2026-10-08", guestName: "Ann Lee", listingName: "622 - Bloom Height", listingMapId: 22, status: "confirmed" },
  { id: 501, departureDate: DAY, arrivalDate: "2026-10-07", guestName: "Ann Lee", listingName: "611 - Damac Reva", listingMapId: 11, status: "confirmed" },
  { id: 503, departureDate: DAY, arrivalDate: "2026-10-09", guestName: "", guestFirstName: "Bo", guestLastName: "Ray", listingName: "633 - Neva", listingMapId: 33, status: "ownerStay" },
  { id: 504, departureDate: DAY, arrivalDate: "2026-10-10", listingName: "644 - Neva", listingMapId: 44, status: "new" },
  // Annulee et plus ancienne : ecartee, elle ne prend la cle nue a personne.
  { id: 400, departureDate: DAY, arrivalDate: "2026-10-01", guestName: "Ann Lee", listingName: "655 - Neva", listingMapId: 55, status: "cancelled" },
];

Deno.test("autopilotDepartures: cles de checkoutKeys, texte voyageur de Today (normalizeMgrReservations)", () => {
  const deps = autopilotDepartures(RAW);
  assertEquals(deps.map((d) => d.key), [DAY + "_Ann Lee~22", DAY + "_Ann Lee", DAY + "_Bo Ray", DAY + "_Guest"]);
  assertEquals(deps.map((d) => d.listingId), ["22", "11", "33", "44"]);
  assertEquals(deps.map((d) => d.listing), ["622 - Bloom Height", "611 - Damac Reva", "633 - Neva", "644 - Neva"]);
  // Today : reservations normalisees, statuts valides, reservationKeys.
  const today = normalizeMgrReservations(RAW).filter((r) => INSP_VALID_STATUSES.includes(r.status));
  const todayKeys = reservationKeys(today);
  const byId = Object.fromEntries(today.map((r, i) => [r.id, { key: todayKeys[i], guest: r.guest }]));
  assertEquals(deps.map((d) => ({ key: d.key, guest: d.guest })), ["502", "501", "503", "504"].map((id) => byId[id]));
  // Planning et la journee de la cleaner : checkoutKeys sur les memes reservations.
  const rows = RAW.map((r: any) => ({ id: r.id, listingId: String(r.listingMapId), checkOut: r.departureDate,
    guest: r.guestName || ((r.guestFirstName || "") + " " + (r.guestLastName || "")).trim(), status: r.status }));
  assertEquals(deps.map((d) => d.key), checkoutKeys(rows).slice(0, 4));
});

Deno.test("runAutopilot: collision, chaque logement lu et ecrit sous sa propre cle", async () => {
  const db = seed();
  // La reservation gardienne (501, plus ancienne) a deja Faiza sous la cle nue.
  db.tables.cleaning_assignments.push({ reservation_key: DAY + "_Ann Lee", cleaner_id: 4 });
  const out = await runAutopilot(db, DAY, async () => RAW.slice(0, 2));
  assertEquals(out.checkouts, 2);
  assertEquals(out.alreadyAssigned, 1);
  assertEquals(out.newlyAssigned, 1);
  assertEquals(db.tables.cleaning_assignments.map((a: any) => [a.reservation_key, a.cleaner_id]),
    [[DAY + "_Ann Lee", 4], [DAY + "_Ann Lee~22", 10]]);
  assertEquals(out.notified.map((n) => [n.cleaner, n.tasks]).sort(), [["Faiza", 1], ["Pionah", 1]]);
});
