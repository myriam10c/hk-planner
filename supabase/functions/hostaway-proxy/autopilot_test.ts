import { assertEquals } from "jsr:@std/assert@1";
import { fakeDb } from "./v3_fakedb.ts";
import { runAutopilot } from "./autopilot.ts";

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
