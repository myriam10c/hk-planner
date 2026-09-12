// Tests de la garde d'idempotence (v3_idem.ts). Fichier separe de v3_test.ts :
// la suite partagee a depasse le plafond de 400 lignes une fois les correctifs de
// la revue ajoutes, et ces tests couvrent un module distinct.
//
// Les imports passent volontairement par ./v3.ts et non par ./v3_idem.ts : c'est
// le chemin qu'empruntent les taches 4 a 7, donc le re-export est teste avec.
import { assertEquals, assertRejects } from "jsr:@std/assert@1";
import { fakeDb } from "./v3_fakedb.ts";
import {
  claimEvent, ensureJobKey, ensureJobKeys, jobKeyFor, purgeStaleClaims,
  purgeStaleClaimsIfDue, recordResult, releaseEvent, replayResponse, resolveJob,
  staleClaimIds, V3_CLAIM_TTL_MS, V3_EVENT_TYPES, V3_PURGE_INTERVAL_MS,
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

// La purge avait des tests mais aucun appelant (revue de branche, finding 3).
// Elle part maintenant de v3.myDay, bornee a une fois par heure et par isolat :
// sans cette borne, chaque ouverture de l'ecran Today, pour chaque cleaner,
// paierait deux requetes de plus sur un plan Supabase gratuit.
Deno.test("purgeStaleClaimsIfDue ne purge qu'une fois par heure et par isolat", async () => {
  const vieux = new Date(Date.now() - 9 * 3600_000).toISOString();
  const sb = fakeDb({
    job_events: [
      { id: 1, idem_key: "bloquee", result: null, created_at: vieux },
      { id: 2, idem_key: "aboutie", result: { status: "success" }, created_at: vieux },
    ],
  });
  // Premier appel de cet isolat : la purge part.
  const t0 = Date.now();
  const premier = purgeStaleClaimsIfDue(sb, t0);
  assertEquals(premier === null, false);
  assertEquals(await premier, 1);
  // Rejeu immediat : rien ne part, l'appelant n'a rien a attendre.
  assertEquals(purgeStaleClaimsIfDue(sb, t0), null);
  assertEquals(purgeStaleClaimsIfDue(sb, t0 + V3_PURGE_INTERVAL_MS - 1), null);
  // Une heure plus tard, la purge repart, et ne trouve plus rien a purger.
  const plusTard = purgeStaleClaimsIfDue(sb, t0 + V3_PURGE_INTERVAL_MS);
  assertEquals(plusTard === null, false);
  assertEquals(await plusTard, 0);
  assertEquals(sb.tables.job_events.map((r: any) => r.idem_key), ["aboutie"]);
});

Deno.test("purgeStaleClaimsIfDue ne rejette jamais : elle part en arriere-plan", async () => {
  const casse = {
    from() { throw new Error("base injoignable"); },
  };
  // Horodatage tres au-dela du dernier appel du test precedent, pour que la
  // borne d'une heure ne masque pas ce qu'on veut verifier.
  const p = purgeStaleClaimsIfDue(casse as any, Date.now() + 10 * V3_PURGE_INTERVAL_MS);
  assertEquals(p === null, false);
  assertEquals(await p, 0);
});

// ===========================================================================
// Identifiant de menage oppose (revue tache 3, constat 5)
// ===========================================================================

Deno.test("jobKeyFor est deterministe et ne laisse rien filtrer de la cle", async () => {
  const a = await jobKeyFor("2026-09-12_Marc Lefevre");
  const b = await jobKeyFor("2026-09-12_Marc Lefevre");
  const c = await jobKeyFor("2026-09-12_Anna Weber");
  assertEquals(a, b);
  assertEquals(a === c, false);
  // Forme figee : le front (taches 10 a 13) met cet id dans le hash de l'URL.
  assertEquals(/^job_[0-9a-f]{20}$/.test(a), true);
  assertEquals(a.includes("Marc"), false);
  assertEquals(a.includes("Lefevre"), false);
  assertEquals(a.includes("2026"), false);
  // Une cle d'extra passe par le meme chemin.
  const extra = await jobKeyFor("extra_2026-09-12_ab12cd34");
  assertEquals(/^job_[0-9a-f]{20}$/.test(extra), true);
  assertEquals(extra === a, false);
});

Deno.test("ensureJobKey n'ecrit qu'une ligne, meme appele deux fois", async () => {
  const sb = fakeDb({ v3_job_keys: [] });
  const un = await ensureJobKey(sb, "2026-09-12_Marc Lefevre");
  const deux = await ensureJobKey(sb, "2026-09-12_Marc Lefevre");
  assertEquals(un, deux);
  assertEquals(un, await jobKeyFor("2026-09-12_Marc Lefevre"));
  assertEquals(sb.tables.v3_job_keys.length, 1);
  assertEquals(sb.tables.v3_job_keys[0].reservation_key, "2026-09-12_Marc Lefevre");
  // Une deuxieme reservation ajoute sa propre ligne.
  await ensureJobKey(sb, "2026-09-12_Anna Weber");
  assertEquals(sb.tables.v3_job_keys.length, 2);
});

Deno.test("ensureJobKey leve quand l'ecriture de la correspondance echoue", async () => {
  const sb = fakeDb({ v3_job_keys: [] });
  sb.fail["v3_job_keys.upsert"] = { message: "permission denied" };
  // Une correspondance non ecrite rendrait un id que plus aucune ecriture ne
  // saurait resoudre : mieux vaut un 500 qu'une journee dont rien n'est cliquable.
  await assertRejects(() => ensureJobKey(sb, "2026-09-12_Marc Lefevre"));
});

Deno.test("ensureJobKeys pose tout le lot en une ecriture et dedoublonne", async () => {
  const sb = fakeDb({ v3_job_keys: [] });
  const map = await ensureJobKeys(sb, [
    "2026-09-12_Marc Lefevre",
    "2026-09-12_Anna Weber",
    "2026-09-12_Marc Lefevre",
    "",
  ]);
  assertEquals(Object.keys(map).sort(), ["2026-09-12_Anna Weber", "2026-09-12_Marc Lefevre"]);
  assertEquals(map["2026-09-12_Marc Lefevre"], await jobKeyFor("2026-09-12_Marc Lefevre"));
  assertEquals(sb.tables.v3_job_keys.length, 2);
  // Une seule ecriture pour tout le lot : l'ecran Today ne paie pas un
  // aller-retour PostgREST par arret.
  assertEquals(sb.writes.filter((w: any) => w.table === "v3_job_keys").length, 1);
  // Lot vide : aucune ecriture du tout.
  assertEquals(Object.keys(await ensureJobKeys(sb, [])).length, 0);
  assertEquals(sb.writes.filter((w: any) => w.table === "v3_job_keys").length, 1);
});

Deno.test("resolveJob rend la cle d'un id connu et null d'un id inconnu", async () => {
  const sb = fakeDb({ v3_job_keys: [] });
  const id = await ensureJobKey(sb, "2026-09-12_Marc Lefevre");
  assertEquals(await resolveJob(sb, id), "2026-09-12_Marc Lefevre");
  assertEquals(await resolveJob(sb, "job_0000000000000000dead"), null);
  assertEquals(await resolveJob(sb, ""), null);
});

Deno.test("resolveJob leve quand la lecture echoue, sans rendre null", async () => {
  const sb = fakeDb({ v3_job_keys: [] });
  const id = await ensureJobKey(sb, "2026-09-12_Marc Lefevre");
  sb.fail["v3_job_keys.select"] = { message: "lecture indisponible" };
  // Un null avale en silence deviendrait un 404 « Job not found » sur un menage
  // qui existe : la cleaner croirait son geste refuse alors que la base a toussote.
  await assertRejects(() => resolveJob(sb, id));
});
