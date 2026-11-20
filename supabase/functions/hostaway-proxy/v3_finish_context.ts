// Contexte et regles de la fin de menage (v3.finishJob) : contexte lu en cache
// pour la notification, role lead / aide, validation du rapport. Sorti de
// v3_write.ts a la tache 3 du branchement (2026-10-05) pour garder chaque module
// sous 400 lignes ; v3_write.ts re-exporte tout ce fichier, donc les imports
// existants (index.ts, tests) ne changent pas.
import { managerIds, pickSnapshot } from "./v3.ts";
import { checkoutKeys } from "./mgr_rules.ts";

export interface FinishContext {
  sameDay: boolean;
  listingName: string;
  managerIds: number[];
  // Logement du menage, lu cote serveur (instantane ou extra_cleanings). Pose
  // dans cleaning_reports.payload pour les references du menage suivant ; jamais
  // pris du corps de la requete.
  listingId?: string | null;
}

// Rapport de fin (branchement 2026-10-05, tache 3) : 20 Ko de JSON au plus, texte
// partage borne a 4000 caracteres.
export const V3_REPORT_MAX_BYTES = 20 * 1024;
export const V3_REPORT_TEXT_MAX = 4000;

// Lead ou aide, calcule cote serveur : aide quand une AUTRE personne a demarre
// (v3.startJob abouti) avant moi sur le meme menage, ou a demarre alors que je
// ne l'ai jamais fait. Apres un « Clean again », sur le menage relance seulement
// (roleFromStarts). Lu dans job_events et non dans cleaning_timer : le chrono
// est partage et ne garde que la premiere personne, et un chrono ouvert depuis
// l'app racine ne doit faire de personne une aide. La lecture leve : le role
// decide du linge exige.
export async function jobRole(sb: any, jobId: string, meId: number): Promise<"lead" | "helper"> {
  const { data, error } = await sb.from("job_events")
    .select("id, cleaner_id, created_at, result").eq("job_id", jobId).eq("event_type", "start_job");
  if (error) throw error;
  return roleFromStarts(data ?? [], meId).role;
}

// Demarrages aboutis du menage EN COURS, dans l'ordre d'arrivee (created_at puis
// id). Lot 1 des corrections cleaner, tache 5 : « Clean again » ouvre un nouveau
// menage sur la meme cle. Son demarrage porte `again: true` dans son resultat
// (pose seulement quand le serveur l'a accepte sur un menage fini), et seuls les
// demarrages depuis le dernier de ceux-la comptent. Sans aucun, tous comptent :
// le calcul est exactement celui d'avant.
export function startsOfCurrentCycle(rows: any[]): any[] {
  const departs = (rows ?? []).filter((d: any) => d && d.result)
    .sort((a: any, b: any) =>
      String(a.created_at ?? "").localeCompare(String(b.created_at ?? "")) || Number(a.id) - Number(b.id));
  let debut = 0;
  departs.forEach((d: any, i: number) => { if (d.result.again === true) debut = i; });
  return departs.slice(debut);
}

// Regle unique du role, partagee par jobRole (fin de menage), v3.startJob et
// v3.myDay (tache 5 du branchement) : apres un rechargement, le telephone doit
// savoir s'il est lead ou aide exactement comme le serveur le jugera a la fin.
// `rows` : les start_job d'UN menage. Rend aussi qui est le lead, son demarrage,
// mon premier demarrage, et `relance` : le menage en cours a ete ouvert par
// « Clean again ». La premiere du menage en cours est lead.
export function roleFromStarts(rows: any[], meId: number): {
  role: "lead" | "helper"; leadId: number | null; myStartedAt: string | null;
  leadStartedAt: string | null; relance: boolean;
} {
  const departs = startsOfCurrentCycle(rows);
  const mien = departs.find((d: any) => Number(d.cleaner_id) === Number(meId));
  const myStartedAt = mien && mien.created_at ? String(mien.created_at) : null;
  if (departs.length === 0) {
    return { role: "lead", leadId: null, myStartedAt, leadStartedAt: null, relance: false };
  }
  const leadId = Number(departs[0].cleaner_id);
  return {
    role: leadId === Number(meId) ? "lead" : "helper", leadId, myStartedAt,
    leadStartedAt: departs[0].created_at ? String(departs[0].created_at) : null,
    relance: departs[0].result.again === true,
  };
}

// Menage fini, regle unique de v3.myDay (etat « done » de la liste) et de
// v3.startJob (garde « menage fini ») : menage_done, ou chrono clos. Un chrono
// rouvert par « Clean again » (`relance`) est un menage en cours, meme si
// menage_done reste vrai jusqu'a la fin du second menage (comportement d'un
// redemarrage, inchange). Sans « Clean again », un chrono oublie ouvert sur un
// menage marque fait par un manager reste fini, comme avant.
export function menageFini(fait: boolean, timer: any, relance: boolean): boolean {
  const ouvert = !!(timer && timer.started_at && !timer.finished_at);
  if (relance && ouvert) return false;
  return fait || !!(timer && timer.finished_at);
}

// Refus de v3.startJob sur un menage fini, pour qui serait lead sans « Clean
// again ». 422 : un 4xx autre que 409 et 429, donc jamais relance par la file du
// telephone, et distinct du 503 « Still starting. Retry. ». Le code est lu par le
// telephone ; le texte est fait pour etre lu tel quel par une ancienne version de
// l'app, qui l'affiche dans « Not sent: <texte>. Tell your manager. ».
export const V3_JOB_DONE_STATUS = 422;
export const V3_JOB_DONE_CODE = "job_done";
export const V3_JOB_DONE_ERROR = "Cleaning already done";

// Rend le rapport valide, null s'il est absent, ou un message d'erreur.
export function readReport(v: unknown): { report: Record<string, unknown> | null } | { error: string } {
  if (v === undefined || v === null) return { report: null };
  if (typeof v !== "object" || Array.isArray(v)) return { error: "report must be an object" };
  let taille: number;
  try {
    taille = new TextEncoder().encode(JSON.stringify(v)).length;
  } catch (_e) {
    return { error: "report must be an object" };
  }
  if (taille > V3_REPORT_MAX_BYTES) return { error: "report is too large" };
  return { report: v as Record<string, unknown> };
}

// Prefixe date d'une cle de reservation. « 2026-09-12_Marc Lefevre » et
// « extra_2026-09-12_Deep clean » rendent tous deux « 2026-09-12 ».
export function dateDeLaCle(jobId: string): string | null {
  const m = String(jobId).match(/^(?:extra_)?(\d{4}-\d{2}-\d{2})_/);
  return m ? m[1] : null;
}

// Prend la reservation_key, et non l'id oppose : les instantanes de proxy_cache
// sont indexes sur « <checkOut>_<guest> ». C'est l'appelant (le bloc de dispatch
// d'index.ts) qui resout l'id avant d'appeler ici.
//
// Contexte lu sans jamais appeler Hostaway : uniquement les instantanes deja poses
// dans proxy_cache (par l'app actuelle ou par v3.myDay), choisis par le meme
// `pickSnapshot` que la lecture de la journee. Aucun instantane utilisable = on
// finit quand meme, sans notification, et on le journalise. Rien ici ne leve :
// une notification est un confort, elle ne doit jamais empecher une cleaner de
// finir son menage.
export async function loadFinishContext(sb: any, reservationKey: string): Promise<FinishContext> {
  let sameDay = false;
  let listingName = "";
  let listingId = "";
  // Menage hors Hostaway : son logement est dans extra_cleanings, pas dans les
  // instantanes de reservations.
  if (reservationKey.startsWith("extra_")) {
    try {
      const { data } = await sb.from("extra_cleanings")
        .select("reservation_key, listing_id").eq("reservation_key", reservationKey).maybeSingle();
      if (data && data.listing_id) listingId = String(data.listing_id);
    } catch (e) {
      console.warn("[v3.finishJob] logement de l'extra indisponible: " + String(e));
    }
  }
  const date = dateDeLaCle(reservationKey);
  if (date && !listingId) {
    try {
      const { data } = await sb.from("proxy_cache")
        .select("key, payload, updated_at").like("key", "checkouts:%");
      const snap = pickSnapshot(data ?? [], date);
      const reservations = (snap && snap.payload && snap.payload.reservations) || [];
      // Meme attribution que la journee de la cleaner (checkoutKeys, lot 1 tache
      // 7) : une cle suffixee trouve la reservation de son logement, la cle nue
      // d'une collision celle de la reservation gardienne.
      const hit = reservations[checkoutKeys(reservations).indexOf(reservationKey)];
      if (hit) {
        sameDay = !!(hit.nextGuest && hit.nextGuest.sameDay);
        listingName = String(hit.listing ?? "");
        listingId = String(hit.listingId ?? "");
      } else {
        console.log("[v3.finishJob] aucun instantane ne couvre " + date + ", pas de notification");
      }
    } catch (e) {
      console.warn("[v3.finishJob] contexte indisponible: " + String(e));
    }
  }
  // Meme precedence que l'ecran Today (v3_myday.nomDuLogement) : le nom interne
  // « Apt - Immeuble » d'abord, le titre Hostaway ensuite, le titre marketing
  // OTA en dernier. La notification manager dit donc exactement ce que la
  // cleaner a lu sur son telephone. L'ordre etait inverse ici aussi : un manager
  // recevait « Modern 1bdr, 10' to Burj Khalifa » au lieu de « 3207 - Sobha
  // Waves » (revue de branche, finding 1).
  if (listingId) {
    try {
      const { data } = await sb.from("listing_config")
        .select("listing_id, listing_name, internal_name").eq("listing_id", listingId).maybeSingle();
      const propre = (v: unknown) => (v === null || v === undefined ? "" : String(v).trim());
      listingName = propre(data?.internal_name) || propre(listingName) ||
        propre(data?.listing_name);
    } catch (e) {
      console.warn("[v3.finishJob] nom de logement indisponible: " + String(e));
    }
  }
  let managers: number[] = [];
  try {
    managers = await managerIds(sb);
  } catch (e) {
    console.warn("[v3.finishJob] liste des managers indisponible: " + String(e));
  }
  return { sameDay, listingName, managerIds: managers, listingId: listingId || null };
}
