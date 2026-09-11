// Garde d'idempotence des gestes cleaner v3 (ruling 7).
// Extrait de v3.ts lors de la revue de la tache 2 : le bloc a grossi (rejeu
// explicite, purge, liste fermee des types) et v3.ts approchait le plafond de
// 400 lignes. v3.ts re-exporte tout ce fichier, donc les imports des taches
// 4 a 7 (`from "./v3.ts"`) continuent de fonctionner sans changement.
import type { ActionResult } from "./v3.ts";

// Liste fermee, copie exacte de la contrainte CHECK de job_events.event_type
// (migration 20260912090000_v3_cleaner.sql). Sans elle, une faute de frappe dans
// une action passe les tests Deno (le faux client ne simule aucun CHECK) puis
// remonte en production sous la forme d'un 23514 propage, donc un 500 pour la
// cleaner. Toute modification ici veut dire une migration en face.
export const V3_EVENT_TYPES = [
  "start_job", "tick", "upload_photo", "finish_job", "report_problem", "check_ticket",
] as const;

export type V3EventType = typeof V3_EVENT_TYPES[number];

// Age au dela duquel une cle posee sans resultat est consideree comme abandonnee.
// Six heures : bien plus long que la plus longue coupure reseau plausible pendant
// un menage, bien plus court qu'une journee de travail.
export const V3_CLAIM_TTL_MS = 6 * 3600_000;

// Pose la cle AVANT l'ecriture metier. Si elle existe deja, le geste a deja ete
// traite : on rend le resultat memorise sans rien reecrire. C'est ce qui rend le
// rejeu de la file hors ligne sans effet de bord (ruling 7).
export async function claimEvent(
  sb: any,
  idem: string,
  eventType: V3EventType,
  jobId: string | null,
  cleanerId: number,
  payload: Record<string, unknown>,
): Promise<{ fresh: boolean; result: any }> {
  // Echoue avant d'ecrire : un type absent de la liste violerait le CHECK de la
  // base, et le message serait un 500 illisible au lieu d'une erreur de code.
  if ((V3_EVENT_TYPES as readonly string[]).indexOf(eventType) === -1) {
    throw new Error("v3: unknown event type " + String(eventType));
  }
  const { error } = await sb.from("job_events").insert({
    idem_key: idem, event_type: eventType, job_id: jobId,
    cleaner_id: cleanerId, payload,
  });
  if (!error) return { fresh: true, result: null };
  if (String((error as any).code ?? "") !== "23505") throw error;
  const { data } = await sb.from("job_events")
    .select("result").eq("idem_key", idem).maybeSingle();
  return { fresh: false, result: data?.result ?? null };
}

// Traduit un rejeu en reponse HTTP. Rend null quand la cle est neuve : l'appelant
// continue son ecriture metier. Un seul chemin de code pour les taches 4, 6 et 7.
//
// Les deux cas de rejeu ne doivent JAMAIS etre confondus :
//   - `result` memorise : l'ecriture metier a abouti, on rend la meme reponse ;
//   - `result` a null : la cle a ete posee mais l'ecriture metier n'a pas abouti
//     (fonction edge morte entre les deux, ou releaseEvent lui-meme rate). Rendre
//     ici un succes synthetise confirmerait un geste jamais ecrit, le telephone
//     retirerait l'entree de sa file hors ligne, et l'action serait perdue en
//     silence. C'est exactement ce que le critere « zero action perdue » interdit.
//     On rend 409 : le telephone garde l'entree et rejoue plus tard.
export function replayResponse(claim: { fresh: boolean; result: any }): ActionResult | null {
  if (claim.fresh) return null;
  if (claim.result === null || claim.result === undefined) {
    return { status: 409, body: { error: "Still processing. Retry." } };
  }
  return { status: 200, body: claim.result as Record<string, unknown> };
}

// Memorise la reponse rendue pour que le rejeu rende exactement la meme chose.
// Un echec ici est journalise et non propage : l'ecriture metier, elle, a abouti.
export async function recordResult(
  sb: any, idem: string, result: Record<string, unknown>,
): Promise<void> {
  const { error } = await sb.from("job_events").update({ result }).eq("idem_key", idem);
  if (error) {
    console.warn("[v3] resultat non memorise pour " + idem + ": " +
      String((error as any).message ?? error));
  }
}

// Ecriture metier ratee : on rend la cle reutilisable, sinon le rejeu croirait que
// le geste est passe et la cleaner perdrait son action en silence.
export async function releaseEvent(sb: any, idem: string): Promise<void> {
  try {
    const { error } = await sb.from("job_events").delete().eq("idem_key", idem);
    if (error) console.warn("[v3] cle non liberee: " + String((error as any).message ?? error));
  } catch (e) {
    console.warn("[v3] cle non liberee: " + String(e));
  }
}

// Filtre pur : les cles posees sans resultat et plus vieilles que le seuil. Isole
// de la requete pour etre testable, et parce que c'est cette decision qui fait
// foi, pas les filtres envoyes a PostgREST.
export function staleClaimIds(
  rows: any[], olderThanMs: number = V3_CLAIM_TTL_MS, nowMs: number = Date.now(),
): number[] {
  const cutoff = nowMs - olderThanMs;
  return (rows ?? [])
    // Date.parse d'un horodatage illisible rend NaN, et NaN < cutoff est faux :
    // une ligne qu'on ne sait pas dater n'est jamais supprimee.
    .filter((r: any) => (r?.result === null || r?.result === undefined) &&
      Date.parse(String(r?.created_at ?? "")) < cutoff)
    .map((r: any) => r.id);
}

// Purge les cles restees sans resultat. Sans elle, une cle posee dont l'ecriture
// metier n'a jamais abouti et dont releaseEvent a echoue rend 409 pour toujours :
// le geste est bloque definitivement cote telephone. A lancer par la tache 14, en
// planifie ou a la main. Rend le nombre de lignes supprimees.
export async function purgeStaleClaims(
  sb: any, olderThanMs: number = V3_CLAIM_TTL_MS,
): Promise<number> {
  const cutoffIso = new Date(Date.now() - olderThanMs).toISOString();
  // Les filtres partent quand meme a PostgREST pour ne pas lire toute la table en
  // production ; la decision reste celle de staleClaimIds.
  const { data, error } = await sb.from("job_events")
    .select("id, result, created_at").is("result", null).lt("created_at", cutoffIso);
  if (error) {
    console.warn("[v3] purge impossible: " + String((error as any).message ?? error));
    return 0;
  }
  const ids = staleClaimIds(data ?? [], olderThanMs);
  if (ids.length === 0) return 0;
  const { error: delError } = await sb.from("job_events").delete().in("id", ids);
  if (delError) {
    console.warn("[v3] purge incomplete: " + String((delError as any).message ?? delError));
    return 0;
  }
  return ids.length;
}
