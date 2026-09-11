// Photos et tickets v3 : televersement d'un cliche, signalement d'une panne
// pendant un menage, verification d'un ticket existant.
// Le bucket est prive : rien n'en sort sans URL signee, et aucune de ces actions
// ne rend d'URL publique.
import type { SessionUser } from "./auth.ts";
import {
  ActionResult, claimEvent, recordResult, releaseEvent, replayResponse, todayDubai,
  V3_PHOTO_BUCKET, validIdem,
} from "./v3.ts";

// 6 Mo : une photo d'iPhone en pleine resolution passe largement, un fichier
// aberrant est refuse avant de toucher au bucket.
export const V3_MAX_PHOTO_BYTES = 6 * 1024 * 1024;

// Types acceptes, et extension du fichier depose. iOS convertit generalement en
// JPEG a l'envoi, mais un HEIC peut arriver d'un partage direct.
export const V3_PHOTO_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
  "image/heif": "heic",
};

export async function uploadPhoto(
  sb: any, me: SessionUser, form: FormData,
): Promise<ActionResult> {
  const idem = form.get("idem");
  if (!validIdem(idem)) return { status: 400, body: { error: "idem required" } };
  const file = form.get("file") as any;
  if (!file || typeof file.arrayBuffer !== "function") {
    return { status: 400, body: { error: "file required" } };
  }
  const mime = String(file.type ?? "").toLowerCase();
  const ext = V3_PHOTO_MIME[mime];
  if (!ext) return { status: 400, body: { error: "unsupported image type" } };
  const size = Number(file.size ?? 0);
  if (!(size > 0)) return { status: 400, body: { error: "empty file" } };
  if (size > V3_MAX_PHOTO_BYTES) return { status: 413, body: { error: "photo is too large" } };

  const jobId = form.get("jobId") ? String(form.get("jobId")) : null;
  const ticketRaw = form.get("ticketId");
  const ticketId = ticketRaw !== null && String(ticketRaw) !== "" ? Number(ticketRaw) : null;
  const itemName = form.get("itemName") ? String(form.get("itemName")) : null;
  if (!jobId && !ticketId) return { status: 400, body: { error: "jobId or ticketId required" } };

  const claim = await claimEvent(sb, String(idem), "upload_photo", jobId, me.cleaner_id, {
    mime, size, ticketId, itemName,
  });
  // Rejeu : 200 avec le photoId memorise, ou 409 si la cle a ete posee sans que
  // le depot aboutisse. Jamais de succes fabrique, sinon le telephone effacerait
  // de sa file hors ligne une photo qui n'est jamais arrivee dans le bucket.
  const rejeu = replayResponse(claim);
  if (rejeu) return rejeu;
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    // Le chemin ne porte que la date et un identifiant aleatoire : la cle du
    // menage contient le nom du guest, elle ne doit jamais se retrouver dans un
    // chemin de stockage (ruling 9). Le rattachement vit dans la table photos.
    const path = "v3/" + todayDubai() + "/" + crypto.randomUUID() + "." + ext;
    const { error: upErr } = await sb.storage.from(V3_PHOTO_BUCKET)
      .upload(path, bytes, { contentType: mime, upsert: false });
    if (upErr) throw upErr;
    const { data: row, error } = await sb.from("photos").insert({
      storage_path: path, job_id: jobId, ticket_id: ticketId,
      item_name: itemName, cleaner_id: me.cleaner_id,
    }).select("id").single();
    if (error) throw error;
    const result = { status: "success", photoId: Number(row.id), path };
    await recordResult(sb, String(idem), result);
    return { status: 200, body: result };
  } catch (e) {
    await releaseEvent(sb, String(idem));
    throw e;
  }
}
