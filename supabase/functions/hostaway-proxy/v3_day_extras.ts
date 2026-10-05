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

// Premiere image de l'annonce, prise UNIQUEMENT dans listing_config.hero_photo_url
// (migration 20261005141000), que syncListings remplit depuis les donnees
// Hostaway qu'il lit deja. Aucun appel Hostaway par arret. Seule une URL https
// passe, sinon null.
export function heroPhotoFrom(listing: any): string | null {
  const v = listing && typeof listing.hero_photo_url === "string" ? listing.hero_photo_url.trim() : "";
  return /^https:\/\/\S+$/i.test(v) ? v : null;
}

// Valeur ecrite par syncListings dans listing_config.hero_photo_url : la premiere
// image de l'annonce telle que Hostaway la rend deja dans /listings
// (listingImages[0].url). Aucun appel supplementaire. Seule une URL https passe,
// sinon null.
export function heroPhotoFromHostaway(listing: any): string | null {
  const imgs = listing && Array.isArray(listing.listingImages) ? listing.listingImages : [];
  const v = imgs.length > 0 && typeof imgs[0]?.url === "string" ? imgs[0].url.trim() : "";
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

// Photos de reference : pour chaque piece d'un arret, la photo « end:<piece> » du
// menage PRECEDENT du meme logement, en URL signee 1 h.
//
// Menage precedent = le plus recent menage v3 du logement dont la date (prefixe
// de la reservation_key) ne depasse pas la date demandee, le menage de l'arret
// lui-meme exclu. Un seul menage par logement : les photos ne sont lues que pour
// ceux-la, et toutes les URL partent en UN appel de signature.
//
// Le lien menage -> logement vient de v3_job_keys.listing_id, pose par myDay
// (ensureJobKeys). Les lignes d'avant cette colonne se rattrapent par
// cleaning_reports.payload.listingId, pose par le serveur a la fin du menage.
export async function loadReferences(
  sb: any, stops: Array<{ jobId: string; listingId: string; rooms: string[] }>, date: string,
): Promise<Array<Record<string, string>>> {
  const out: Array<Record<string, string>> = stops.map(() => ({}));
  const logements = [...new Set(stops.map((s) => s.listingId).filter((l) => !!l))];
  if (logements.length === 0) return out;
  try {
    // job_id -> { logement, date }
    const candidats: Record<string, { listingId: string; date: string }> = {};
    const poser = (jobId: unknown, cle: unknown, lid: unknown) => {
      const d = dateDuMenage(String(cle ?? ""));
      if (!jobId || !d || d > date || lid === undefined || lid === null || lid === "") return;
      if (!candidats[String(jobId)]) candidats[String(jobId)] = { listingId: String(lid), date: d };
    };
    const cles = await parPaquets(logements, (p) =>
      sb.from("v3_job_keys").select("job_id, reservation_key, listing_id").in("listing_id", p));
    for (const k of cles) poser(k.job_id, k.reservation_key, k.listing_id);
    const rapports = await parPaquets(logements, (p) =>
      sb.from("cleaning_reports").select("job_id, reservation_key, payload")
        .in("payload->>listingId", p).limit(MAX_RAPPORTS));
    for (const r of rapports) poser(r.job_id, r.reservation_key, r?.payload?.listingId);

    // Par logement, du plus recent au plus ancien ; l'id departage un meme jour.
    const parLogement: Record<string, string[]> = {};
    for (const [jobId, c] of Object.entries(candidats)) (parLogement[c.listingId] ||= []).push(jobId);
    for (const l of Object.keys(parLogement)) {
      parLogement[l].sort((a, b) =>
        candidats[b].date.localeCompare(candidats[a].date) || b.localeCompare(a));
    }
    const precedent = stops.map((s) =>
      (parLogement[s.listingId] ?? []).find((j) => j !== s.jobId) ?? null);
    const jobs = [...new Set(precedent.filter((j): j is string => !!j))];
    if (jobs.length === 0) return out;

    const photos = (await parPaquets(jobs, (p) =>
      sb.from("photos").select("id, job_id, item_name, storage_path, kind, created_at")
        .in("job_id", p).limit(MAX_PHOTOS)))
      .filter((ph) => String(ph.kind ?? "photo") === "photo" &&
        String(ph.item_name ?? "").startsWith("end:") && ph.storage_path)
      // Plus recente d'abord ; l'id departage deux cliches de la meme seconde.
      .sort((a, b) =>
        String(b.created_at ?? "").localeCompare(String(a.created_at ?? "")) ||
        Number(b.id) - Number(a.id));
    const choix: Array<Record<string, string>> = stops.map(() => ({}));
    stops.forEach((s, i) => {
      const job = precedent[i];
      if (!job) return;
      for (const piece of s.rooms) {
        const hit = photos.find((ph) =>
          String(ph.job_id) === job && String(ph.item_name) === "end:" + piece);
        if (hit) choix[i][piece] = String(hit.storage_path);
      }
    });
    const chemins = [...new Set(choix.flatMap((c) => Object.values(c)))];
    if (chemins.length === 0) return out;
    const signees = await signerTout(sb, chemins);
    choix.forEach((c, i) => {
      for (const [piece, chemin] of Object.entries(c)) {
        if (signees[chemin]) out[i][piece] = signees[chemin];
      }
    });
  } catch (e) {
    console.warn("[v3.myDay] references indisponibles: " + String((e as any)?.message ?? e));
    return stops.map(() => ({}));
  }
  return out;
}

// Date d'un menage, prise du prefixe de sa cle : « 2026-09-12_Marc » et
// « extra_2026-09-12_Deep clean » rendent « 2026-09-12 ».
function dateDuMenage(cle: string): string | null {
  const m = cle.match(/^(?:extra_)?(\d{4}-\d{2}-\d{2})_/);
  return m ? m[1] : null;
}

// Un seul appel de signature pour toute la journee. Un chemin que le stockage
// refuse sort simplement de la reponse ; une panne entiere vide les references.
async function signerTout(sb: any, chemins: string[]): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const { data, error } = await sb.storage.from(V3_PHOTO_BUCKET)
    .createSignedUrls(chemins, V3_REFERENCE_URL_SECONDS);
  if (error) {
    console.warn("[v3.myDay] signature impossible: " + String((error as any)?.message ?? error));
    return out;
  }
  for (const d of data ?? []) {
    if (d && !d.error && d.path && d.signedUrl) out[String(d.path)] = String(d.signedUrl);
  }
  return out;
}
