// Tests de la garde d'idempotence (v3_idem.ts). Fichier separe de v3_test.ts :
// la suite partagee a depasse le plafond de 400 lignes une fois les correctifs de
// la revue ajoutes, et ces tests couvrent un module distinct.
//
// Les imports passent volontairement par ./v3.ts et non par ./v3_idem.ts : c'est
// le chemin qu'empruntent les taches 4 a 7, donc le re-export est teste avec.
import { assertEquals, assertRejects } from "jsr:@std/assert@1";
import { fakeDb } from "./v3_fakedb.ts";
import {
  claimEvent, purgeStaleClaims, recordResult, releaseEvent, replayResponse,
  staleClaimIds, V3_CLAIM_TTL_MS, V3_EVENT_TYPES,
} from "./v3.ts";

Deno.test("claimEvent laisse passer la premiere cle et rejoue les suivantes", async () => {
  const sb = fakeDb({ job_events: [] });
  const first = await claimEvent(sb, "cle-idempotente-1", "start_job", "k1", 7, { jobId: "k1" });
  assertEquals(first.fresh, true);
  await recordResult(sb, "cle-idempotente-1", { status: "success", jobId: "k1" });
  const second = await claimEvent(sb, "cle-idempotente-1", "start_job", "k1", 7, { jobId: "k1" });
  assertEquals(second.fresh, false);
  assertEquals(second.result, { status: "success", jobId: "k1" });
  assertEquals(sb.tables.job_events.length, 1);
});

Deno.test("releaseEvent rend la cle reutilisable quand l'ecriture metier a echoue", async () => {
  const sb = fakeDb({ job_events: [] });
  assertEquals((await claimEvent(sb, "cle-idempotente-2", "tick", "k1", 7, {})).fresh, true);
  await releaseEvent(sb, "cle-idempotente-2");
  assertEquals(sb.tables.job_events.length, 0);
  assertEquals((await claimEvent(sb, "cle-idempotente-2", "tick", "k1", 7, {})).fresh, true);
});

Deno.test("claimEvent refuse un type d'evenement absent de la contrainte CHECK", async () => {
  const sb = fakeDb({ job_events: [] });
  await assertRejects(
    () => claimEvent(sb, "cle-type-inconnu", "start_jobb" as any, "k1", 7, {}),
    Error,
    "unknown event type",
  );
  // Rien n'a ete ecrit : la cle reste disponible pour le vrai geste.
  assertEquals(sb.tables.job_events.length, 0);
  assertEquals(V3_EVENT_TYPES.length, 6);
  assertEquals([...V3_EVENT_TYPES], [
    "start_job", "tick", "upload_photo", "finish_job", "report_problem", "check_ticket",
  ]);
});

Deno.test("replayResponse distingue un rejeu abouti d'un rejeu sans resultat", () => {
  // Cle neuve : l'appelant continue son ecriture metier.
  assertEquals(replayResponse({ fresh: true, result: null }), null);
  // Rejeu avec resultat memorise : exactement la meme reponse qu'au premier coup.
  assertEquals(replayResponse({ fresh: false, result: { status: "success", jobId: "k1" } }),
    { status: 200, body: { status: "success", jobId: "k1" } });
  // Rejeu sans resultat : l'ecriture metier n'a jamais abouti. Un 200 synthetise
  // ferait supprimer l'entree de la file hors ligne et perdrait le geste.
  assertEquals(replayResponse({ fresh: false, result: null }),
    { status: 409, body: { error: "Still processing. Retry." } });
  assertEquals(replayResponse({ fresh: false, result: undefined }),
    { status: 409, body: { error: "Still processing. Retry." } });
});

Deno.test("un claim interrompu se rejoue en 409, jamais en succes", async () => {
  const sb = fakeDb({ job_events: [] });
  // Premier appel : la cle est posee, puis la fonction edge meurt avant
  // recordResult et avant releaseEvent.
  assertEquals((await claimEvent(sb, "cle-interrompue", "finish_job", "k1", 7, {})).fresh, true);
  const rejeu = await claimEvent(sb, "cle-interrompue", "finish_job", "k1", 7, {});
  assertEquals(rejeu.fresh, false);
  assertEquals(rejeu.result, null);
  assertEquals(replayResponse(rejeu)?.status, 409);
});

Deno.test("staleClaimIds ne retient que les cles sans resultat et assez vieilles", () => {
  const now = Date.parse("2026-09-12T12:00:00Z");
  const h = (n: number) => new Date(now - n * 3600_000).toISOString();
  const ids = staleClaimIds([
    { id: 1, result: null, created_at: h(8) },              // bloquee depuis 8 h
    { id: 2, result: { status: "success" }, created_at: h(8) }, // aboutie, on garde
    { id: 3, result: null, created_at: h(1) },              // trop recente
    { id: 4, result: null, created_at: "pas une date" },    // indatable, on garde
    { id: 5, created_at: h(9) },                            // result absent
  ], V3_CLAIM_TTL_MS, now);
  assertEquals(ids, [1, 5]);
});

Deno.test("purgeStaleClaims supprime les cles bloquees et laisse les autres", async () => {
  const vieux = new Date(Date.now() - 9 * 3600_000).toISOString();
  const recent = new Date(Date.now() - 60_000).toISOString();
  const sb = fakeDb({
    job_events: [
      { id: 1, idem_key: "bloquee", result: null, created_at: vieux },
      { id: 2, idem_key: "aboutie", result: { status: "success" }, created_at: vieux },
      { id: 3, idem_key: "en-cours", result: null, created_at: recent },
    ],
  });
  assertEquals(await purgeStaleClaims(sb), 1);
  assertEquals(sb.tables.job_events.map((r: any) => r.idem_key), ["aboutie", "en-cours"]);
  // Deuxieme passage : plus rien a purger, et aucune suppression a vide.
  assertEquals(await purgeStaleClaims(sb), 0);
  assertEquals(sb.tables.job_events.length, 2);
});
