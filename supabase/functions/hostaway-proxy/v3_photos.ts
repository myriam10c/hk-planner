// Televersement d'un cliche de menage ou de ticket.
// Sorti de v3_tickets.ts a la revue de la tache 3 : le module depassait le plafond
// de 400 lignes une fois la resolution de l'identifiant oppose ajoutee. Meme
// decoupage que v3_myday.ts hors de v3.ts. v3_tickets.ts re-exporte tout ce
// fichier, donc les imports existants (index.ts, tests) ne changent pas.
//
// Le bucket est prive : rien n'en sort sans URL signee, et cette action ne rend
// aucune URL publique.
import type { SessionUser } from "./auth.ts";
import {
  ActionResult, claimEvent, recordResult, releaseEvent, replayResponse, resolveJob,
  todayDubai, V3_PHOTO_BUCKET, validIdem,
} from "./v3.ts";

// 6 Mo : une photo d'iPhone en pleine resolution passe largement, un fichier
// aberrant est refuse avant de toucher au bucket.
export const V3_MAX_PHOTO_BYTES = 6 * 1024 * 1024;

// Plafond du corps multipart complet, lu sur Content-Length avant de bufferiser.
// Volontairement plus large que le fichier : une enveloppe multipart porte des
// bornes, des en-tetes de partie et les champs texte. Au-dela, le corps est
// refuse sans etre lu (revue tache 5, constatation 3).
export const V3_MAX_UPLOAD_BODY_BYTES = 8 * 1024 * 1024;

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

// ticketId optionnel : absent, null ou vide veut dire « photo rattachee au seul
// menage ». Present, il doit etre un entier positif. Meme regle que readPhotoId
// de v3_write.ts : une chaine non numerique partait jusqu'ici en NaN, que
// supabase-js serialise en null, donc le lien vers le ticket sautait en silence.
function readTicketId(v: unknown): number | null | "invalid" {
  if (v === undefined || v === null || v === "") return null;
  if (typeof v !== "string" && typeof v !== "number") return "invalid";
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) return "invalid";
  return n;
}

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

  // jobId est l'identifiant oppose rendu par v3.myDay, donc du texte (colonne
  // photos.job_id en TEXT), pas un entier : la symetrie avec ticketId porte sur le
  // type attendu, pas sur la forme. Une partie multipart qui n'est pas du texte est
  // refusee plutot que stringifiee en « [object File] ».
  const jobRaw = form.get("jobId");
  if (jobRaw !== null && typeof jobRaw !== "string") {
    return { status: 400, body: { error: "jobId must be text" } };
  }
  const jobId = jobRaw ? String(jobRaw) : null;
  const ticketId = readTicketId(form.get("ticketId"));
  if (ticketId === "invalid") {
    return { status: 400, body: { error: "ticketId must be a number" } };
  }
  const itemName = form.get("itemName") ? String(form.get("itemName")) : null;
  if (!jobId && !ticketId) return { status: 400, body: { error: "jobId or ticketId required" } };
  // Un jobId fourni doit correspondre a un menage reel. Verifie AVANT la pose de
  // la cle d'idempotence et avant de toucher au bucket : un id inconnu ne doit ni
  // bruler la cle du telephone ni laisser un objet orphelin dans le stockage.
  // Seule la validite est verifiee ici : photos.job_id garde l'id OPPOSE, jamais
  // la reservation_key, qui porte le nom du guest (ruling 9).
  if (jobId && !(await resolveJob(sb, jobId))) {
    return { status: 404, body: { error: "Job not found." } };
  }

  const claim = await claimEvent(sb, String(idem), "upload_photo", jobId, me.cleaner_id, {
    mime, size, ticketId, itemName,
  });
  // Rejeu : 200 avec le photoId memorise, ou 409 si la cle a ete posee sans que
  // le depot aboutisse. Jamais de succes fabrique, sinon le telephone effacerait
  // de sa file hors ligne une photo qui n'est jamais arrivee dans le bucket.
  const rejeu = replayResponse(claim);
  if (rejeu) return rejeu;
  // Le chemin ne porte que la date et un identifiant aleatoire : ni la cle du
  // menage, qui contient le nom du guest, ni meme son id oppose ne se retrouvent
  // dans un chemin de stockage (ruling 9). Le rattachement vit dans la table photos.
  // Il est calcule hors du try pour que le rattrapage puisse retirer du bucket un
  // objet deja depose.
  const path = "v3/" + todayDubai() + "/" + crypto.randomUUID() + "." + ext;
  let depose = false;
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const { error: upErr } = await sb.storage.from(V3_PHOTO_BUCKET)
      .upload(path, bytes, { contentType: mime, upsert: false });
    if (upErr) throw upErr;
    depose = true;
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
    // Depot reussi mais ligne photos manquante : sans ce retrait, l'objet reste
    // dans le bucket sans que rien ne le reference, et le rejeu de la file en
    // depose un second (revue tache 5, constatation 1). Au mieux : un nettoyage
    // rate est journalise, jamais propage, pour ne pas masquer l'erreur d'origine.
    if (depose) await removeQuietly(sb, path);
    throw e;
  }
}

// Retrait best-effort d'un objet du bucket. Ne leve jamais : l'appelant est deja
// dans un chemin d'erreur et c'est l'erreur d'origine qui doit remonter.
async function removeQuietly(sb: any, path: string): Promise<void> {
  try {
    const { error } = await sb.storage.from(V3_PHOTO_BUCKET).remove([path]);
    if (error) {
      console.warn("[v3] objet orphelin non retire " + path + ": " +
        String((error as any).message ?? error));
    }
  } catch (e) {
    console.warn("[v3] objet orphelin non retire " + path + ": " + String(e));
  }
}
