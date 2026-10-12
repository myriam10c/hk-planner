import { assert, assertEquals } from "jsr:@std/assert@1";
import {
  appendQuote, dedupKey, guestInNow, MNT_CATEGORIES, MNT_CATEGORY_LABEL, mntAccess, parseIngest,
  priorityFor, proposalRef,
} from "./mnt_rules.ts";

Deno.test("acces maintenance : session email obligatoire, manager ou maintenance", () => {
  assertEquals(mntAccess(false, null), { ok: false, status: 401, error: "auth required" });
  assertEquals(mntAccess(false, { role: "manager" }), { ok: false, status: 403, error: "email sign-in required" });
  assertEquals(mntAccess(true, { role: "cleaner" }), { ok: false, status: 403, error: "forbidden" });
  assertEquals(mntAccess(true, { role: "maintenance" }), { ok: true });
  assertEquals(mntAccess(true, { role: "manager" }), { ok: true });
});

Deno.test("priorite : urgent, high, normal -> medium", () => {
  assertEquals(priorityFor("urgent"), "urgent");
  assertEquals(priorityFor("high"), "high");
  assertEquals(priorityFor("normal"), "medium");
});

Deno.test("reference et cle de dedoublonnage", () => {
  assertEquals(proposalRef(12), "PRP-12");
  assertEquals(dedupKey("c1", "ac"), "c1|ac");
  assertEquals(MNT_CATEGORY_LABEL.lock_door, "Lock or door");
  assertEquals(Object.keys(MNT_CATEGORY_LABEL).length, MNT_CATEGORIES.length);
});

Deno.test("guest en sejour : bornes incluses, dates nulles = faux", () => {
  const p = { stay_from: "2026-10-10", stay_to: "2026-10-12" };
  assertEquals(guestInNow(p, "2026-10-09"), false);
  assertEquals(guestInNow(p, "2026-10-10"), true);
  assertEquals(guestInNow(p, "2026-10-12"), true);
  assertEquals(guestInNow(p, "2026-10-13"), false);
  assertEquals(guestInNow({ stay_from: null, stay_to: "2026-10-12" }, "2026-10-11"), false);
  assertEquals(guestInNow({ stay_from: "2026-10-10", stay_to: null }, "2026-10-11"), false);
});

const item = (o: any = {}) => ({
  conversationId: "c1", messageId: "m1", at: "2026-10-12T08:00:00Z", listingId: "55", reservationId: null,
  guestName: "Ann", stayFrom: "2026-10-10", stayTo: "2026-10-14", title: "AC leaking", category: "ac",
  urgency: "high", quote: "  The AC is leaking  ", ...o,
});

Deno.test("ingestion : lot valide, champs nettoyes", () => {
  const r: any = parseIngest({ issues: [item(), item({ messageId: "m2", stayFrom: null, stayTo: null, listingId: undefined })] });
  assertEquals(r.issues.length, 2);
  assertEquals(r.issues[0].quote, "The AC is leaking");
  assertEquals(r.issues[1].stayFrom, null);
  assertEquals(r.issues[1].listingId, null);
});

Deno.test("ingestion : 51 items refuses", () => {
  const issues = Array.from({ length: 51 }, (_, i) => item({ messageId: "m" + i }));
  assertEquals(parseIngest({ issues }), { error: "Too many issues." });
});

Deno.test("ingestion : categorie inconnue, citation vide, date invalide", () => {
  assertEquals(parseIngest({ issues: [item(), item({ category: "roof" })] }), { error: "Invalid issue 2: category." });
  assertEquals(parseIngest({ issues: [item({ quote: "   " })] }), { error: "Invalid issue 1: quote." });
  assertEquals(parseIngest({ issues: [item({ stayFrom: "12/10/2026" })] }), { error: "Invalid issue 1: stayFrom." });
  assertEquals(parseIngest({ issues: [item({ at: "yesterday" })] }), { error: "Invalid issue 1: at." });
  assertEquals(parseIngest({ issues: [item({ urgency: "now" })] }), { error: "Invalid issue 1: urgency." });
  assertEquals(parseIngest({ issues: [item({ messageId: "" })] }), { error: "Invalid issue 1: messageId." });
  assertEquals(parseIngest({}), { error: "Invalid issues." });
});

Deno.test("ingestion : titre coupe a 120", () => {
  const r: any = parseIngest({ issues: [item({ title: "x".repeat(300) })] });
  assertEquals(r.issues[0].title.length, 120);
});

Deno.test("citations : doublon refuse, 11e supprime la plus ancienne, tri par date", () => {
  const q = (n: number) => ({ message_id: "m" + n, at: "2026-10-" + String(10 + n).padStart(2, "0") + "T00:00:00Z", text: "t" + n });
  const dup = appendQuote([q(1)], q(1));
  assertEquals(dup.added, false);
  assertEquals(dup.quotes.length, 1);
  let quotes: any[] = [];
  for (let n = 1; n <= 10; n++) quotes = appendQuote(quotes, q(n)).quotes;
  assertEquals(quotes.length, 10);
  const r = appendQuote(quotes, q(11));
  assert(r.added);
  assertEquals(r.quotes.length, 10);
  assertEquals(r.quotes[0].message_id, "m2");
  assertEquals(r.quotes[9].message_id, "m11");
  const s = appendQuote([q(5)], q(2));
  assertEquals(s.quotes.map((x) => x.message_id), ["m2", "m5"]);
});

Deno.test("ingestion : titre vide et issues non tableau", () => {
  assertEquals(parseIngest({ issues: [item({ title: "   " })] }), { error: "Invalid issue 1: title." });
  assertEquals(parseIngest({ issues: "x" }), { error: "Invalid issues." });
});

Deno.test("ingestion : dates impossibles et fuseau absent refuses", () => {
  assertEquals(parseIngest({ issues: [item({ stayFrom: "2026-02-31" })] }), { error: "Invalid issue 1: stayFrom." });
  assertEquals(parseIngest({ issues: [item({ stayTo: "2026-13-01" })] }), { error: "Invalid issue 1: stayTo." });
  assertEquals(parseIngest({ issues: [item({ at: "2026-02-31T10:00:00Z" })] }), { error: "Invalid issue 1: at." });
  assertEquals(parseIngest({ issues: [item({ at: "2026-10-12T08:00" })] }), { error: "Invalid issue 1: at." });
  assert("issues" in (parseIngest({ issues: [item({ at: "2026-10-12T08:00:00+04:00" })] }) as any));
});

Deno.test("citations : added faux si la nouvelle est ecartee par la limite", () => {
  const q = (n: number) => ({ message_id: "m" + n, at: "2026-10-" + String(10 + n).padStart(2, "0") + "T00:00:00Z", text: "t" });
  let quotes: any[] = [];
  for (let n = 2; n <= 11; n++) quotes = appendQuote(quotes, q(n)).quotes;
  const r = appendQuote(quotes, q(1));
  assertEquals(r.added, false);
  assertEquals(r.quotes.length, 10);
  assertEquals(r.quotes[0].message_id, "m2");
});
