import { assertEquals } from "jsr:@std/assert@1";
import { buildDisputeUpdate, disputeAccess, DISPUTE_STATUSES } from "./disputes.ts";

const NOW = "2026-10-10T08:00:00.000Z";

Deno.test("statuts autorises", () => {
  assertEquals([...DISPUTE_STATUSES], ["todo", "submitted", "removed", "rejected", "not_disputable"]);
});

Deno.test("statut invalide refuse", () => {
  const r = buildDisputeUpdate({ review_id: 1, dispute_status: "deleted" }, "Walter", NOW);
  assertEquals(r, { ok: false, error: "invalid dispute_status" });
});

Deno.test("reply_posted non booleen refuse", () => {
  const r = buildDisputeUpdate({ review_id: 1, reply_posted: "yes" }, "Walter", NOW);
  assertEquals(r, { ok: false, error: "invalid reply_posted" });
});

Deno.test("corps vide ou sans review_id refuse", () => {
  assertEquals(buildDisputeUpdate({}, "Walter", NOW), { ok: false, error: "review_id required" });
  assertEquals(buildDisputeUpdate(null, "Walter", NOW), { ok: false, error: "review_id required" });
});

Deno.test("auteur pris de l argument, updated_by du corps ignore", () => {
  const r = buildDisputeUpdate(
    { review_id: "7", dispute_status: "submitted", reply_posted: true, updated_by: "walter" }, "Hillal", NOW);
  assertEquals(r, {
    ok: true,
    patch: { review_id: 7, updated_at: NOW, dispute_status: "submitted", reply_posted: true, updated_by: "Hillal" },
  });
});

Deno.test("auteur tronque a 40 caracteres", () => {
  const r = buildDisputeUpdate({ review_id: 1 }, "x".repeat(60), NOW);
  assertEquals(r.ok && r.patch.updated_by.length, 40);
});

Deno.test("acces: 401 sans session, 403 non manager, ok manager", () => {
  assertEquals(disputeAccess(null), { status: 401, error: "auth required" });
  assertEquals(disputeAccess({ role: "cleaner" }), { status: 403, error: "Only managers can do this." });
  assertEquals(disputeAccess({ role: "manager" }), null);
});
