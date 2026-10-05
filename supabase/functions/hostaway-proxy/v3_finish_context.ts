// Contexte et regles de la fin de menage (v3.finishJob) : contexte lu en cache
// pour la notification, role lead / aide, validation du rapport. Sorti de
// v3_write.ts a la tache 3 du branchement (2026-10-05) pour garder chaque module
// sous 400 lignes ; v3_write.ts re-exporte tout ce fichier, donc les imports
// existants (index.ts, tests) ne changent pas.
import { managerIds, pickSnapshot } from "./v3.ts";

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
// ne l'ai jamais fait. Lu dans job_events et non dans cleaning_timer : le chrono
// est partage et ne garde que la premiere personne, et un chrono ouvert depuis
// l'app racine ne doit faire de personne une aide. La lecture leve : le role
// decide du linge exige.
export async function jobRole(sb: any, jobId: string, meId: number): Promise<"lead" | "helper"> {
  const { data, error } = await sb.from("job_events")
    .select("id, cleaner_id, created_at, result").eq("job_id", jobId).eq("event_type", "start_job");
  if (error) throw error;
  const departs = (data ?? []).filter((d: any) => d.result)
    .sort((a: any, b: any) =>
      String(a.created_at ?? "").localeCompare(String(b.created_at ?? "")) || Number(a.id) - Number(b.id));
  if (departs.length === 0) return "lead";
  return Number(departs[0].cleaner_id) === Number(meId) ? "lead" : "helper";
}

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
      const hit = reservations.find((r: any) =>
        String(r.checkOut) + "_" + (r.guest || "Guest") === reservationKey);
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
