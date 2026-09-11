// Photos et tickets v3 : televersement d'un cliche, signalement d'une panne
// pendant un menage, verification d'un ticket existant.
// Le bucket est prive : rien n'en sort sans URL signee, et aucune de ces actions
// ne rend d'URL publique.
import type { SessionUser } from "./auth.ts";
import {
  ActionResult, claimEvent, managerIds, onDutyTechnician, recordResult, releaseEvent,
  replayResponse, todayDubai, V3_CATEGORIES, V3_PHOTO_BUCKET, v3Log, validIdem,
} from "./v3.ts";
import { sendPush } from "./push.ts";

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

  // jobId est la reservation_key, donc du texte (colonne photos.job_id en TEXT),
  // pas un entier : la symetrie avec ticketId porte sur le type attendu, pas sur
  // la forme. Une partie multipart qui n'est pas du texte est refusee plutot que
  // stringifiee en « [object File] ».
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

  const claim = await claimEvent(sb, String(idem), "upload_photo", jobId, me.cleaner_id, {
    mime, size, ticketId, itemName,
  });
  // Rejeu : 200 avec le photoId memorise, ou 409 si la cle a ete posee sans que
  // le depot aboutisse. Jamais de succes fabrique, sinon le telephone effacerait
  // de sa file hors ligne une photo qui n'est jamais arrivee dans le bucket.
  const rejeu = replayResponse(claim);
  if (rejeu) return rejeu;
  // Le chemin ne porte que la date et un identifiant aleatoire : la cle du
  // menage contient le nom du guest, elle ne doit jamais se retrouver dans un
  // chemin de stockage (ruling 9). Le rattachement vit dans la table photos.
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

// ===========================================================================
// Signalement d'une panne et verification d'un ticket pendant un menage
// ===========================================================================

// L'envoi de push est injecte pour que les tests observent qui est prevenu sans
// dependre des secrets VAPID ni des heures de silence.
export type PushFn = (sb: any, cleanerId: number, payload: any, opts?: any) => Promise<any>;

// Priorite d'un signalement de cleaner. Jamais `urgent` : les heures de silence
// de push.ts (22h00 a 08h30 Dubai) ne laissent passer que l'urgent, et une panne
// constatee pendant un menage n'a pas a reveiller la permanence la nuit. Un
// signalement nocturne part donc en notification silencieuse, ce qui est le
// comportement voulu. La montee en urgence reste une decision de manager, par
// l'ecran desktop existant.
export const V3_REPORT_PRIORITY = "medium";

// Statuts dont une cleaner ne fait jamais sortir un ticket. `to_confirm` n'en
// fait pas partie : re-verifier un ticket deja en attente de confirmation est
// sans effet de bord.
export const V3_TICKET_CLOSED = ["resolved", "cancelled"];

// La photo est designee soit par son identifiant (chemin en ligne : la cleaner
// vient de la televerser), soit par la cle d'idempotence de ce televersement
// (chemin hors ligne : la file rejoue la photo puis le geste, dans cet ordre, et
// le second retrouve le premier dans job_events.result).
export async function resolvePhotoId(sb: any, body: any): Promise<number | null> {
  if (body?.photoId) {
    const n = Number(body.photoId);
    return Number.isFinite(n) && n > 0 ? n : null;
  }
  if (!validIdem(body?.photoIdem)) return null;
  const { data } = await sb.from("job_events")
    .select("result").eq("idem_key", String(body.photoIdem)).maybeSingle();
  const pid = data && data.result ? (data.result as any).photoId : null;
  return pid ? Number(pid) : null;
}

// Lit la ligne photos et verifie qu'elle appartient bien a la cleaner qui parle.
// Les identifiants de photos sont des entiers de sequence, donc previsibles : le
// controle coute zero requete de plus (le chemin de stockage est de toute facon
// a lire) et il evite qu'un compte attache le cliche d'une autre a un ticket.
// Rend null dans les deux cas, le telephone n'a rien a faire de la distinction.
async function ownedPhoto(
  sb: any, photoId: number, me: SessionUser,
): Promise<{ storage_path: string } | null> {
  const { data } = await sb.from("photos")
    .select("id, storage_path, cleaner_id").eq("id", photoId).maybeSingle();
  if (!data) return null;
  if (Number(data.cleaner_id) !== Number(me.cleaner_id)) {
    console.warn("[v3] photo " + String(photoId) + " refusee: elle n'est pas a " +
      String(me.cleaner_id));
    return null;
  }
  return data as { storage_path: string };
}

// Enveloppe une ecriture accessoire : journalisee si elle rate, jamais propagee.
// A n'utiliser qu'APRES l'ecriture decisive d'une action : passe ce point,
// liberer la cle ferait recreer le ticket au rejeu (revue tache 6, constat 4).
async function sansEchec(quoi: string, fn: () => Promise<unknown>): Promise<void> {
  try {
    await fn();
  } catch (e) {
    console.warn("[v3] " + quoi + ": " + String((e as any)?.message ?? e));
  }
}

export async function reportProblem(
  sb: any, me: SessionUser, body: any,
  deps: { push?: PushFn } = {},
): Promise<ActionResult> {
  const push = deps.push ?? sendPush;
  const jobId = body?.jobId ? String(body.jobId) : null;
  const listingId = body?.listingId ? String(body.listingId) : "";
  const category = String(body?.category ?? "").toLowerCase();
  const idem = body?.idem;
  if (!listingId) return { status: 400, body: { error: "listingId required" } };
  // hasOwnProperty et non une simple lecture : « constructor » ou « toString »
  // sont heritees d'Object.prototype, donc verite pour `!V3_CATEGORIES[category]`,
  // et le technicien lisait « undefined problem reported » (revue tache 6,
  // constat 3).
  const meta = Object.prototype.hasOwnProperty.call(V3_CATEGORIES, category)
    ? V3_CATEGORIES[category]
    : null;
  if (!meta) return { status: 400, body: { error: "unknown category" } };
  if (!validIdem(idem)) return { status: 400, body: { error: "idem required" } };
  // Photo obligatoire : un signalement sans image repart en aller-retour WhatsApp,
  // c'est exactement ce que cette action supprime. Resolue AVANT la pose de la cle
  // d'idempotence, pour qu'un refus ne brule pas la cle.
  const photoId = await resolvePhotoId(sb, body);
  if (!photoId) return { status: 400, body: { error: "photoId required" } };

  const claim = await claimEvent(sb, String(idem), "report_problem", jobId, me.cleaner_id, {
    listingId, category, photoId, note: body?.note ?? null,
  });
  // Rejeu : 200 avec le ticket memorise, ou 409 si la cle a ete posee sans que
  // le ticket soit cree. Jamais de succes fabrique, sinon le telephone effacerait
  // de sa file hors ligne un signalement qui n'a jamais rien ouvert.
  const rejeu = replayResponse(claim);
  if (rejeu) return rejeu;

  let result: Record<string, unknown>;
  try {
    const photo = await ownedPhoto(sb, photoId, me);
    // La cle est deja posee : la liberer avant de refuser, sinon un rejeu de la
    // file rendrait 200 pour un signalement qui n'a jamais cree de ticket.
    if (!photo) {
      await releaseEvent(sb, String(idem));
      return { status: 400, body: { error: "photo not found" } };
    }

    const cat = meta.ticketCategory;
    const priority = V3_REPORT_PRIORITY;
    const { data: sla } = await sb.from("maintenance_sla")
      .select("max_hours").eq("category", cat).eq("priority", priority).maybeSingle();
    const slaHours = sla && sla.max_hours ? Number(sla.max_hours) : 72;
    const technicianId = await onDutyTechnician(sb, todayDubai());

    // Ecriture decisive du signalement. Tout ce qui precede peut encore liberer
    // la cle et rejouer ; plus rien apres, sinon le rejeu creerait un second
    // ticket et un second push (revue tache 6, constat 4).
    const title = meta.label + " problem reported during a cleaning";
    const { data: ticket, error } = await sb.from("maintenance_tickets").insert({
      listing_id: listingId,
      title,
      description: body?.note ? String(body.note).slice(0, 1000) : null,
      category: cat,
      priority,
      assigned_technician_id: technicianId,
      reported_by: me.name,
      source: "hk_planner_v3",
      source_ref: jobId,
      photo_path: photo.storage_path,
      sla_deadline: new Date(Date.now() + slaHours * 3600_000).toISOString(),
      status: technicianId ? "assigned" : "open",
    }).select("id").single();
    if (error) throw error;
    result = { status: "success", ticketId: Number(ticket.id), technicianId: technicianId ?? null };
  } catch (e) {
    await releaseEvent(sb, String(idem));
    throw e;
  }

  // Le ticket existe : la cle n'est plus jamais liberee et rien ne leve.
  const ticketId = Number(result.ticketId);
  await sansEchec("resultat non memorise pour " + String(idem),
    () => recordResult(sb, String(idem), result));
  // Le ticket porte deja photo_path : ce retro-lien est un confort de lecture
  // cote table photos, pas une donnee dont le ticket depend.
  await sansEchec("retro-lien photo absent sur le ticket " + String(ticketId), async () => {
    const { error } = await sb.from("photos").update({ ticket_id: ticketId }).eq("id", photoId);
    if (error) throw error;
  });
  await sansEchec("journal du ticket " + String(ticketId), () =>
    v3Log(sb, "ticket_" + String(ticketId), "ticket_created", me.name, {
      category: meta.ticketCategory, via: "v3", job_id: jobId,
    }));

  // Notification apres l'ecriture : un push rate ne doit jamais annuler un ticket
  // deja cree. sendPush ne leve pas, la garde est doublee par le try.
  const destinataires = [
    ...(result.technicianId ? [Number(result.technicianId)] : []),
    ...(await managerIds(sb)),
  ];
  // Le titre porte la categorie : sur l'ecran verrouille d'un telephone, c'est la
  // seule ligne lue. Aucun nom de guest, aucun numero (ruling 9).
  const payload = {
    title: meta.label + " problem reported",
    body: "Reported by " + me.name + ". Open HK Planner to see the photo.",
    url: "https://stunning-kleicha-f61101.netlify.app/",
    tag: "v3-ticket-" + String(result.ticketId),
  };
  for (const cid of [...new Set(destinataires)]) {
    try {
      await push(sb, cid, payload, { dedupeKey: "v3-ticket:" + String(result.ticketId) + ":" + String(cid) });
    } catch (e) {
      console.warn("[v3.reportProblem] push failed for cleaner " + String(cid) + ":", e);
    }
  }
  return { status: 200, body: result };
}

export async function checkTicket(sb: any, me: SessionUser, body: any): Promise<ActionResult> {
  const ticketId = body?.ticketId ? Number(body.ticketId) : 0;
  const idem = body?.idem;
  if (!ticketId) return { status: 400, body: { error: "ticketId required" } };
  if (!validIdem(idem)) return { status: 400, body: { error: "idem required" } };
  // Photo obligatoire (specification, ruling 3) : sans preuve, le technicien ne
  // peut rien confirmer.
  const photoId = await resolvePhotoId(sb, body);
  if (!photoId) return { status: 400, body: { error: "photoId required" } };

  const claim = await claimEvent(sb, String(idem), "check_ticket", body?.jobId ? String(body.jobId) : null,
    me.cleaner_id, { ticketId, photoId });
  // Le rejeu passe AVANT l'etat du ticket : un geste deja abouti rend son
  // resultat memorise meme si le technicien a clos le ticket entre-temps. La file
  // hors ligne (tache 9) traite tout 4xx autre que 409 comme definitif : elle
  // envoyait au magasin mort un geste passe (revue tache 6, constat 1).
  const rejeu = replayResponse(claim);
  if (rejeu) return rejeu;

  let result: Record<string, unknown>;
  try {
    // Le ticket doit exister et ne pas etre clos : une cleaner ne clot pas un
    // ticket (ruling 3) et ne rouvre pas celui qu'un technicien vient de clore.
    // La cle est posee, on la libere avant de refuser, comme pour la photo.
    const { data: ticket } = await sb.from("maintenance_tickets")
      .select("id, status").eq("id", ticketId).maybeSingle();
    if (!ticket) {
      await releaseEvent(sb, String(idem));
      return { status: 400, body: { error: "ticket not found" } };
    }
    if (V3_TICKET_CLOSED.indexOf(String(ticket.status ?? "")) !== -1) {
      await releaseEvent(sb, String(idem));
      return { status: 400, body: { error: "ticket is already closed" } };
    }

    const photo = await ownedPhoto(sb, photoId, me);
    // Meme regle que reportProblem : on ne garde jamais une cle posee sur un refus.
    if (!photo) {
      await releaseEvent(sb, String(idem));
      return { status: 400, body: { error: "photo not found" } };
    }

    // Retro-lien d'abord, et non fatal : il est rejouable a l'identique et le
    // ticket n'en depend pas.
    await sansEchec("retro-lien photo absent sur le ticket " + String(ticketId), async () => {
      const { error } = await sb.from("photos").update({ ticket_id: ticketId }).eq("id", photoId);
      if (error) throw error;
    });
    // Ecriture decisive. Seules ces deux colonnes bougent : la colonne booleenne
    // to_confirm (flux Gemini a relire, anterieure au chantier) n'a rien a voir
    // avec cette valeur de statut et n'est jamais ecrite ici.
    const { error: tErr } = await sb.from("maintenance_tickets").update({
      status: "to_confirm",
      resolution_photo_path: photo.storage_path,
    }).eq("id", ticketId);
    if (tErr) throw tErr;
    result = { status: "success", ticketId, status_value: "to_confirm" };
  } catch (e) {
    await releaseEvent(sb, String(idem));
    throw e;
  }

  // Le ticket est passe en to_confirm : la cle n'est plus liberee. Le commentaire
  // et le journal sont accessoires, rejouer pour eux doublerait ticket_comments.
  await sansEchec("resultat non memorise pour " + String(idem),
    () => recordResult(sb, String(idem), result));
  // Le commentaire passe par ticket_comments : ecrire « [horodatage] texte »
  // dans resolution_notes d'un ticket non resolu est intercepte par le trigger
  // trg_redirect_resolution_notes, qui restaure la colonne.
  await sansEchec("commentaire absent sur le ticket " + String(ticketId), async () => {
    const { error } = await sb.from("ticket_comments").insert({
      ticket_id: ticketId,
      author: me.name,
      comment: "Checked during the cleaning, photo attached.",
    });
    if (error) throw error;
  });
  await sansEchec("journal du ticket " + String(ticketId), () =>
    v3Log(sb, "ticket_" + String(ticketId), "ticket_checked", me.name, { via: "v3" }));

  return { status: 200, body: result };
}
