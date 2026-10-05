// Journee enrichie de v3.myDay (branchement 2026-10-05, tache 3) : pieces par
// type, photo d'annonce, binome sur le meme menage et photos de reference du
// menage precedent. Sorti de v3_myday.ts pour garder chaque module sous 400
// lignes. Aucune dependance a index.ts.
//
// Les deux lectures de ce module (binome, references) sont un confort : une
// panne se journalise et laisse la liste vide, elle n'empeche jamais une cleaner
// d'ouvrir sa journee. Le role lead / aide qui compte pour le linge est
// recalcule cote serveur par v3.finishJob, jamais lu de cet affichage.
import { V3_PHOTO_BUCKET } from "./v3.ts";

// Duree des URL signees des references : une heure, comme getPhotoUrl d'index.ts.
export const V3_REFERENCE_URL_SECONDS = 3600;

// Plafonds de lecture : de quoi couvrir largement les menages precedents des
// logements du jour, sans rapatrier toute l'histoire des tables.
const MAX_RAPPORTS = 300;
const MAX_PHOTOS = 1000;

export interface OtherOnJob {
  id: number;
  name: string;
  startedAt: string | null;
}

// Pieces par type, une seule regle cote serveur (Global Constraints). Le tag
// Hostaway est du texte libre (« 2BHK », « 2 BHK ») ; a defaut, le nombre de
// chambres decide. Contrairement a normalizeUnitType (ponderation du temps, qui
// ne connait que trois types), trois chambres et plus donnent un 3 BHK.
export function roomsFor(unitType: unknown, bedrooms: unknown): string[] {
  const raw = typeof unitType === "string" ? unitType.toLowerCase().replace(/\s+/g, "") : "";
  let n: number;
  const m = raw.match(/^(\d+)bhk$/);
  if (raw === "studio") n = 0;
  else if (m) n = Number(m[1]);
  else {
    const b = Number(bedrooms);
    n = Number.isFinite(b) && b > 0 ? Math.floor(b) : 0;
  }
  if (n <= 0) return ["Bed", "Bathroom", "Kitchen"];
  if (n === 1) return ["Bedroom", "Living room", "Kitchen", "Bathroom", "Balcony"];
  const k = Math.min(n, 3);
  const chambres = Array.from({ length: k }, (_v, i) => "Bedroom " + String(i + 1));
  const sdb = Array.from({ length: k }, (_v, i) => "Bathroom " + String(i + 1));
  return [...chambres, "Living room", "Kitchen", ...sdb, "Balcony"];
}

// Premiere image de l'annonce, prise UNIQUEMENT dans les donnees deja en cache
// (aucun appel Hostaway par arret). Au 2026-10-05 aucune source n'existe en base :
// listing_config n'a pas de colonne d'image et proxy_cache ne porte que des
// instantanes de reservations. Le champ lu ici, `hero_photo_url`, est celui que
// syncListings remplirait depuis listingImages[0].url une fois la colonne creee ;
// d'ici la, la valeur est nulle. Seule une URL https passe.
export function heroPhotoFrom(listing: any): string | null {
  const v = listing && typeof listing.hero_photo_url === "string" ? listing.hero_photo_url.trim() : "";
  return /^https:\/\/\S+$/i.test(v) ? v : null;
}

async function parPaquets(
  ids: string[], lire: (paquet: string[]) => Promise<{ data: any; error: any }>,
): Promise<any[]> {
  const out: any[] = [];
  for (let i = 0; i < ids.length; i += 100) {
    const { data, error } = await lire(ids.slice(i, i + 100));
    if (error) throw error;
    out.push(...(data ?? []));
  }
  return out;
}

// Autres personnes assignees au meme menage, avec l'heure de LEUR demarrage v3
// (premier start_job abouti, cle posee sans resultat exclue). Tri par demarrage
// croissant, les non demarres a la fin.
export async function loadOthersOnJob(
  sb: any, entries: Array<{ cle: string; jobId: string }>, meId: number,
): Promise<Record<string, OtherOnJob[]>> {
  const out: Record<string, OtherOnJob[]> = {};
  for (const e of entries) out[e.cle] = [];
  if (entries.length === 0) return out;
  try {
    const cles = entries.map((e) => e.cle);
    const assignations = await parPaquets(cles, (p) =>
      sb.from("cleaning_assignments").select("reservation_key, cleaner_id").in("reservation_key", p));
    const autres = assignations.filter((a) => Number(a.cleaner_id) !== Number(meId));
    if (autres.length === 0) return out;
    const ids = [...new Set(autres.map((a) => String(a.cleaner_id)))];
    const personnes = await parPaquets(ids, (p) =>
      sb.from("cleaners").select("id, name").in("id", p));
    const nom: Record<string, string> = {};
    for (const c of personnes) nom[String(c.id)] = String(c.name ?? "");
    const jobIds = entries.map((e) => e.jobId);
    const departs = await parPaquets(jobIds, (p) =>
      sb.from("job_events").select("id, job_id, cleaner_id, created_at, result")
        .in("job_id", p).eq("event_type", "start_job"));
    const debut: Record<string, string> = {};
    for (const d of departs) {
      if (!d.result || !d.created_at) continue;
      const k = String(d.job_id) + "|" + String(d.cleaner_id);
      const t = String(d.created_at);
      if (!debut[k] || t < debut[k]) debut[k] = t;
    }
    const jobDe: Record<string, string> = {};
    for (const e of entries) jobDe[e.cle] = e.jobId;
    for (const a of autres) {
      const cle = String(a.reservation_key);
      if (!out[cle] || out[cle].some((o) => o.id === Number(a.cleaner_id))) continue;
      out[cle].push({
        id: Number(a.cleaner_id),
        name: nom[String(a.cleaner_id)] || "Teammate",
        startedAt: debut[jobDe[cle] + "|" + String(a.cleaner_id)] ?? null,
      });
    }
    for (const cle of Object.keys(out)) {
      out[cle].sort((x, y) =>
        x.startedAt === y.startedAt
          ? x.id - y.id
          : x.startedAt === null ? 1 : y.startedAt === null ? -1 : x.startedAt.localeCompare(y.startedAt));
    }
  } catch (e) {
    console.warn("[v3.myDay] binome indisponible: " + String((e as any)?.message ?? e));
    for (const cle of Object.keys(out)) out[cle] = [];
  }
  return out;
}

// Photos de reference : pour chaque piece d'un arret, la photo « end:<piece> » la
// plus recente d'un menage PRECEDENT du meme logement, en URL signee 1 h.
//
// Le lien menage -> logement passe par cleaning_reports.payload.listingId, pose
// par le serveur a la fin du menage (v3.finishJob) : ni la reservation_key ni
// v3_job_keys ne portent le logement. Un menage fini sans rapport ne fournit
// donc pas de reference.
export async function loadReferences(
  sb: any, stops: Array<{ jobId: string; listingId: string; rooms: string[] }>,
): Promise<Array<Record<string, string>>> {
  const out: Array<Record<string, string>> = stops.map(() => ({}));
  const logements = [...new Set(stops.map((s) => s.listingId).filter((l) => !!l))];
  if (logements.length === 0) return out;
  try {
    const rapports = await parPaquets(logements, (p) =>
      sb.from("cleaning_reports").select("job_id, payload, created_at")
        .in("payload->>listingId", p).order("created_at", { ascending: false }).limit(MAX_RAPPORTS));
    const logementDuJob: Record<string, string> = {};
    for (const r of rapports) {
      const lid = r?.payload?.listingId;
      if (lid !== undefined && lid !== null) logementDuJob[String(r.job_id)] = String(lid);
    }
    const jobs = Object.keys(logementDuJob);
    if (jobs.length === 0) return out;
    const photos = (await parPaquets(jobs, (p) =>
      sb.from("photos").select("id, job_id, item_name, storage_path, kind, created_at")
        .in("job_id", p).order("created_at", { ascending: false }).limit(MAX_PHOTOS)))
      .filter((ph) => String(ph.kind ?? "photo") === "photo" &&
        String(ph.item_name ?? "").startsWith("end:") && ph.storage_path)
      // Plus recente d'abord ; l'id departage deux cliches de la meme seconde.
      .sort((a, b) =>
        String(b.created_at ?? "").localeCompare(String(a.created_at ?? "")) ||
        Number(b.id) - Number(a.id));
    const signees: Record<string, string | null> = {};
    for (let i = 0; i < stops.length; i++) {
      const s = stops[i];
      for (const piece of s.rooms) {
        const hit = photos.find((ph) =>
          String(ph.job_id) !== s.jobId &&
          logementDuJob[String(ph.job_id)] === s.listingId &&
          String(ph.item_name) === "end:" + piece);
        if (!hit) continue;
        const chemin = String(hit.storage_path);
        if (!(chemin in signees)) signees[chemin] = await signer(sb, chemin);
        if (signees[chemin]) out[i][piece] = signees[chemin] as string;
      }
    }
  } catch (e) {
    console.warn("[v3.myDay] references indisponibles: " + String((e as any)?.message ?? e));
    return stops.map(() => ({}));
  }
  return out;
}

async function signer(sb: any, chemin: string): Promise<string | null> {
  try {
    const { data, error } = await sb.storage.from(V3_PHOTO_BUCKET)
      .createSignedUrl(chemin, V3_REFERENCE_URL_SECONDS);
    if (error || !data?.signedUrl) {
      console.warn("[v3.myDay] signature impossible " + chemin + ": " +
        String((error as any)?.message ?? "no url"));
      return null;
    }
    return String(data.signedUrl);
  } catch (e) {
    console.warn("[v3.myDay] signature impossible " + chemin + ": " + String(e));
    return null;
  }
}
