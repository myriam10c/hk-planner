// Tickets v3 : signalement d'une panne pendant un menage, verification d'un
// ticket existant. Le televersement d'un cliche vit dans v3_photos.ts depuis la
// revue de la tache 3 (le module depassait 400 lignes) et est re-exporte ici :
// index.ts et les tests importent toujours `from "./v3_tickets.ts"`.
//
// Deux identifiants cohabitent, comme dans v3_write.ts : `jobId` est l'id oppose
// rendu par v3.myDay, le seul que le telephone connait ; `reservationKey` est la
// cle interne « <date>_<guest> », qui ne quitte jamais le proxy.
import type { SessionUser } from "./auth.ts";
import {
  ActionResult, claimEvent, onDutyTechnician, ownKey, recordResult, releaseEvent,
  replayResponse, resolveJob, todayDubai, V3_PHOTO_OPTIONAL_KINDS, V3_PROBLEM_KINDS,
  V3_URGENCY_PRIORITY, v3Log, validIdem,
} from "./v3.ts";
import { ownedPhoto, resolvePhotoId, sansEchec } from "./v3_photos.ts";
import { cleanNote, cleanWhere, notifyProblem, problemTitle } from "./v3_problems.ts";
import type { PushFn } from "./v3_problems.ts";
import { APP_URL, sendPush } from "./push.ts";

export {
  ownedPhoto, resolvePhotoId, uploadPhoto, V3_MAX_PHOTO_BYTES, V3_MAX_UPLOAD_BODY_BYTES,
  V3_PHOTO_MIME,
} from "./v3_photos.ts";
export {
  addProblemPhoto, cleanNote, cleanWhere, deleteProblem, setProblemNote, updateProblem,
  V3_PROBLEM_ACTIONS,
} from "./v3_problems.ts";
export type { PushFn } from "./v3_problems.ts";

// ===========================================================================
// Signalement d'une panne et verification d'un ticket pendant un menage
// ===========================================================================

// Statuts dont une cleaner ne fait jamais sortir un ticket. `to_confirm` n'en
// fait pas partie : re-verifier un ticket deja en attente de confirmation est
// sans effet de bord.
export const V3_TICKET_CLOSED = ["resolved", "cancelled"];

// Branchement 2026-10-05 (tache 2) : le corps est celui de l'app conversation,
// { jobId?, listingId, kind, urgency, where, note?, photoId? | photoIdem?, idem }.
// L'ancien champ `category` n'est plus lu : son seul client est remplace.
// La priorite vient de l'urgence choisie par la cleaner, et seul `urgent` part
// en push prioritaire (heures de silence traversees, Global Constraints).
export async function reportProblem(
  sb: any, me: SessionUser, body: any,
  deps: { push?: PushFn } = {},
): Promise<ActionResult> {
  const push = deps.push ?? sendPush;
  const jobId = body?.jobId ? String(body.jobId) : null;
  const listingId = body?.listingId ? String(body.listingId) : "";
  const idem = body?.idem;
  if (!listingId) return { status: 400, body: { error: "listingId required" } };
  const kind = typeof body?.kind === "string" ? body.kind : "";
  const cat = ownKey(V3_PROBLEM_KINDS, kind);
  if (!cat) return { status: 400, body: { error: "unknown kind" } };
  const priority = ownKey(V3_URGENCY_PRIORITY, body?.urgency);
  if (!priority) return { status: 400, body: { error: "invalid urgency" } };
  if (!validIdem(idem)) return { status: 400, body: { error: "idem required" } };
  const where = cleanWhere(body?.where);
  const note = cleanNote(body?.note);
  // Un signalement pendant un menage porte un jobId, un signalement depuis l'ecran
  // d'un logement n'en porte pas. Quand il y en a un, il doit designer un menage
  // reel : resolu AVANT la pose de la cle d'idempotence, comme partout ailleurs.
  // La cle resolue sert ensuite a `source_ref`, la seule colonne qui rend le ticket
  // rattachable au menage pour un manager ou un technicien cote desktop. Le
  // journal d'idempotence, lui, garde l'id oppose.
  let reservationKey: string | null = null;
  if (jobId) {
    reservationKey = await resolveJob(sb, jobId);
    if (!reservationKey) return { status: 404, body: { error: "Job not found." } };
  }
  // Photo obligatoire sauf pour les types de V3_PHOTO_OPTIONAL_KINDS (gaz, porte,
  // et les trois « not working » d'une ligne de verification). Designee mais introuvable, elle est refusee meme pour ces deux types. Resolue
  // AVANT la pose de la cle d'idempotence, pour qu'un refus ne brule pas la cle.
  const designee = body?.photoId !== undefined && body?.photoId !== null ||
    (body?.photoIdem !== undefined && body?.photoIdem !== null);
  const photoId = await resolvePhotoId(sb, body);
  if (!photoId && (designee || V3_PHOTO_OPTIONAL_KINDS.indexOf(kind) === -1)) {
    return { status: 400, body: { error: "photo required" } };
  }

  const claim = await claimEvent(sb, String(idem), "report_problem", jobId, me.cleaner_id, {
    listingId, kind, urgency: body.urgency, where, photoId, note,
  });
  // Rejeu : 200 avec le ticket memorise, ou 409 si la cle a ete posee sans que
  // le ticket soit cree. Jamais de succes fabrique, sinon le telephone effacerait
  // de sa file hors ligne un signalement qui n'a jamais rien ouvert.
  const rejeu = replayResponse(claim);
  if (rejeu) return rejeu;

  const title = problemTitle(kind, where);
  let result: Record<string, unknown>;
  try {
    let photoPath: string | null = null;
    if (photoId) {
      const photo = await ownedPhoto(sb, photoId, me);
      // La cle est deja posee : la liberer avant de refuser, sinon un rejeu de la
      // file rendrait 200 pour un signalement qui n'a jamais cree de ticket.
      if (!photo) {
        await releaseEvent(sb, String(idem));
        return { status: 400, body: { error: "photo not found" } };
      }
      photoPath = photo.storage_path;
    }

    const { data: sla } = await sb.from("maintenance_sla")
      .select("max_hours").eq("category", cat).eq("priority", priority).maybeSingle();
    const slaHours = sla && sla.max_hours ? Number(sla.max_hours) : 72;
    const technicianId = await onDutyTechnician(sb, todayDubai());

    // Ecriture decisive du signalement. Tout ce qui precede peut encore liberer
    // la cle et rejouer ; plus rien apres, sinon le rejeu creerait un second
    // ticket et un second push (revue tache 6, constat 4). created_at est pose
    // ici (meme valeur que le defaut de la base) : les gestes suivants
    // (v3_problems.ts) ne sont ouverts que le jour meme.
    const now = Date.now();
    const { data: ticket, error } = await sb.from("maintenance_tickets").insert({
      listing_id: listingId,
      title,
      description: note,
      category: cat,
      priority,
      assigned_technician_id: technicianId,
      reported_by: me.name,
      source: "hk_planner_v3",
      source_ref: reservationKey,
      photo_path: photoPath,
      sla_deadline: new Date(now + slaHours * 3600_000).toISOString(),
      status: technicianId ? "assigned" : "open",
      created_at: new Date(now).toISOString(),
    }).select("id").single();
    if (error) throw error;
    result = {
      status: "success", ticketId: Number(ticket.id), technicianId: technicianId ?? null, priority,
    };
  } catch (e) {
    await releaseEvent(sb, String(idem));
    throw e;
  }

  // Le ticket existe : la cle n'est plus jamais liberee et rien ne leve.
  const ticketId = Number(result.ticketId);
  // Maintenance phase 3 (C8) : le nom du technicien assigne a la creation, pour
  // « sent to <name> » cote telephone. Lecture de confort, posee avant la
  // memorisation pour que le rejeu rende le meme nom ; illisible, elle rend null
  // (« sent to the team »).
  result.sentTo = null;
  if (result.technicianId) {
    await sansEchec("nom du technicien du ticket " + String(ticketId), async () => {
      const { data, error } = await sb.from("cleaners").select("name")
        .eq("id", Number(result.technicianId)).maybeSingle();
      if (error) throw error;
      const nom = String(data?.name ?? "").trim();
      result.sentTo = nom || null;
    });
  }
  await sansEchec("resultat non memorise pour " + String(idem),
    () => recordResult(sb, String(idem), result));
  // Le ticket porte deja photo_path : ce retro-lien est un confort de lecture
  // cote table photos, pas une donnee dont le ticket depend.
  if (photoId) {
    await sansEchec("retro-lien photo absent sur le ticket " + String(ticketId), async () => {
      const { error } = await sb.from("photos").update({ ticket_id: ticketId }).eq("id", photoId);
      if (error) throw error;
    });
  }
  await sansEchec("journal du ticket " + String(ticketId), () =>
    v3Log(sb, "ticket_" + String(ticketId), "ticket_created", me.name, {
      category: cat, kind, urgency: body.urgency, via: "v3", job_id: jobId,
    }));

  // Notification apres l'ecriture : un push rate ne doit jamais annuler un ticket
  // deja cree. notifyProblem ne leve pas.
  await notifyProblem(sb, push, ticketId, (result.technicianId as number | null) ?? null,
    title, me, priority === "urgent", "v3-ticket");
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

// Maintenance phase 3 (C4) : « Still there ». La cleaner dit que le probleme est
// toujours la : un commentaire sur le ticket et un push au technicien assigne,
// sans changer le statut. Meme ossature que checkTicket : cle, rejeu, controle du
// ticket (cle liberee sur tout refus), ecriture decisive, puis accessoires.
export const V3_STILL_COMMENT = "Still there during the cleaning.";
const FERMES_STILL = ["resolved", "closed", "cancelled"];

export async function ticketStill(
  sb: any, me: SessionUser, body: any,
  deps: { push?: PushFn } = {},
): Promise<ActionResult> {
  const push = deps.push ?? sendPush;
  const ticketId = Number(body?.ticketId);
  const idem = body?.idem;
  if (!Number.isInteger(ticketId) || ticketId <= 0) return { status: 400, body: { error: "ticketId required" } };
  if (!validIdem(idem)) return { status: 400, body: { error: "idem required" } };

  const claim = await claimEvent(sb, String(idem), "ticket_still",
    typeof body?.jobId === "string" && body.jobId ? body.jobId : null, me.cleaner_id, { ticketId });
  const rejeu = replayResponse(claim);
  if (rejeu) return rejeu;

  let ticket: any;
  const result = { ok: true };
  try {
    const { data, error } = await sb.from("maintenance_tickets")
      .select("id, title, status, assigned_technician_id").eq("id", ticketId).maybeSingle();
    if (error) throw error;
    ticket = data;
    if (!ticket) {
      await releaseEvent(sb, String(idem));
      return { status: 400, body: { error: "ticket not found" } };
    }
    // 409 impose par le plan, avec ce message exact. Attention : la file hors
    // ligne traite 409 comme « a rejouer » ; elle doit reconnaitre ce message
    // pour ne pas rejouer sans fin un geste sur un ticket clos (tache 2).
    if (FERMES_STILL.indexOf(String(ticket.status ?? "")) !== -1) {
      await releaseEvent(sb, String(idem));
      return { status: 409, body: { error: "This problem is already closed." } };
    }
    // Ecriture decisive : le commentaire est tout le geste.
    const { error: cErr } = await sb.from("ticket_comments").insert({
      ticket_id: ticketId, author: me.name, comment: V3_STILL_COMMENT,
    });
    if (cErr) throw cErr;
  } catch (e) {
    await releaseEvent(sb, String(idem));
    throw e;
  }

  await sansEchec("resultat non memorise pour " + String(idem),
    () => recordResult(sb, String(idem), result));
  await sansEchec("journal du ticket " + String(ticketId), () =>
    v3Log(sb, "ticket_" + String(ticketId), "ticket_still", me.name, { via: "v3" }));

  // Push non urgent (heures de silence respectees), jamais bloquant.
  const tech = ticket.assigned_technician_id ? Number(ticket.assigned_technician_id) : null;
  if (tech) {
    try {
      await push(sb, tech, {
        title: "Still broken: " + String(ticket.title ?? "Ticket"),
        body: me.name + " checked it during the cleaning.",
        url: APP_URL + "/?mnt=" + String(ticketId),
        tag: "v3-ticket-" + String(ticketId),
      }, { dedupeKey: "v3-still:" + String(idem) });
    } catch (e) {
      console.warn("[v3] push still rate pour " + String(tech) + ": " + String(e));
    }
  }
  return { status: 200, body: result };
}
