// Photos de l'app cleaner v3 dans le planning (28/10/2026). La v3 range ses
// photos dans `photos` (par job_id, bucket V3), le planning lisait seulement
// `cleaning_photos` (par reservation_key) : l'equipe ne voyait plus ni l'avant
// ni l'apres. On rejoint les deux par v3_job_keys, en lecture seule.
//   arrival:<piece> -> before · end:<piece> -> after · problem:<x> -> before
// L'id rendu est « v3-<id> » pour ne jamais croiser un id de cleaning_photos.
import { V3_PHOTO_BUCKET } from "./v3.ts";

export const V3_LEGACY_URL_SECONDS = 3600;

export function v3PhotoType(itemName: string): "before" | "after" {
  return String(itemName || "").startsWith("end:") ? "after" : "before";
}

export function v3PhotoLabel(itemName: string): string {
  const s = String(itemName || "");
  const i = s.indexOf(":");
  const pre = i < 0 ? "" : s.slice(0, i);
  const rest = i < 0 ? s : s.slice(i + 1);
  if (pre === "problem") return "Problem" + (rest ? " · " + rest : "");
  if (pre === "arrival") return "Arrival" + (rest ? " · " + rest : "");
  return rest;
}

export async function v3PhotosForKey(sb: any, key: string): Promise<any[]> {
  const { data: cles, error: e1 } = await sb.from("v3_job_keys").select("job_id").eq("reservation_key", key);
  if (e1) throw e1;
  const jobs = [...new Set((cles ?? []).map((k: any) => String(k.job_id)).filter(Boolean))];
  if (jobs.length === 0) return [];
  const { data: rows, error: e2 } = await sb.from("photos")
    .select("id, job_id, item_name, storage_path, kind, cleaner_id, created_at").in("job_id", jobs);
  if (e2) throw e2;
  const photos = (rows ?? []).filter((p: any) => String(p.kind ?? "photo") === "photo" && p.storage_path);
  if (photos.length === 0) return [];
  const ids = [...new Set(photos.map((p: any) => p.cleaner_id).filter((c: any) => c !== null && c !== undefined))];
  const noms: Record<string, string> = {};
  if (ids.length) {
    const { data: cl } = await sb.from("cleaners").select("id, name").in("id", ids);
    for (const c of cl ?? []) noms[String(c.id)] = String(c.name ?? "");
  }
  const urls: Record<string, string> = {};
  const { data: signees, error: e3 } = await sb.storage.from(V3_PHOTO_BUCKET)
    .createSignedUrls(photos.map((p: any) => String(p.storage_path)), V3_LEGACY_URL_SECONDS);
  if (e3) console.warn("[getPhotos] signature v3 impossible: " + String(e3?.message ?? e3));
  for (const s of signees ?? []) if (s && !s.error && s.path && s.signedUrl) urls[String(s.path)] = String(s.signedUrl);
  return photos.map((p: any) => ({
    id: "v3-" + p.id,
    reservation_key: key,
    photo_type: v3PhotoType(p.item_name),
    label: v3PhotoLabel(p.item_name),
    author: noms[String(p.cleaner_id)] || null,
    created_at: p.created_at,
    url: urls[String(p.storage_path)] || null,
  }));
}

// getPhoto pour un id « v3-<id> » : une URL signee fraiche.
export async function v3PhotoUrl(sb: any, id: number): Promise<string | null> {
  const { data, error } = await sb.from("photos").select("storage_path").eq("id", id).maybeSingle();
  if (error || !data?.storage_path) return null;
  const { data: s, error: e } = await sb.storage.from(V3_PHOTO_BUCKET)
    .createSignedUrl(String(data.storage_path), V3_LEGACY_URL_SECONDS);
  if (e || !s) return null;
  return s.signedUrl;
}
