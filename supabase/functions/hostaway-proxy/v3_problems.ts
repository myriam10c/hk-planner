// Problemes de l'app conversation (branchement 2026-10-05, tache 2) : gestes sur
// un ticket deja signale par v3.reportProblem. Photos de plus, note texte,
// changement d'urgence ou de piece, annulation. Pas de vocal (decision du
// 2026-10-05 : un vocal ne part pas avec le message WhatsApp ; la cleaner dicte
// sa note au clavier du telephone).
//
// Regle commune : seule la personne qui a signale le probleme, le jour meme
// (Dubai), peut y toucher. La preuve d'identite est la ligne job_events
// « report_problem » posee par SA session (cleaner_id) et dont le resultat porte
// ce ticket, jamais un champ du corps ni le nom en clair de reported_by.
//
// Meme ossature que checkTicket : validation, cle d'idempotence, rejeu, puis
// controle du ticket (la cle est liberee sur tout refus), ecriture decisive,
// resultat memorise, et seulement ensuite les ecritures accessoires.
import type { SessionUser } from "./auth.ts";
import {
  ActionResult, claimEvent, managerIds, ownKey, recordResult, releaseEvent,
  replayResponse, todayDubai, V3_URGENCY_PRIORITY, v3Log, validIdem,
} from "./v3.ts";
import type { V3EventType } from "./v3.ts";
import { ownedPhoto, resolvePhotoId, sansEchec } from "./v3_photos.ts";
import { sendPush } from "./push.ts";

// L'envoi de push est injecte pour que les tests observent qui est prevenu, et
// avec quelle priorite, sans dependre des secrets VAPID.
export type PushFn = (sb: any, cleanerId: number, payload: any, opts?: any) => Promise<any>;

export const V3_NOTE_MAX = 300;
export const V3_WHERE_MAX = 60;
export const V3_WHOLE_APARTMENT = "Whole apartment";

// Statuts dont une cleaner ne fait jamais sortir un ticket.
const FERMES = ["resolved", "cancelled"];

// Caracteres de controle hors saut de ligne : un vocal transcrit par le clavier
// ou un copier-coller en laisse passer, et ils finissent illisibles cote desktop.
const CONTROLES = /[\u0000-\u0008\u000B-\u001F\u007F]/g;

// Note nettoyee : controles retires, espaces ramasses, 300 caracteres au plus
// (tronquee plutot que refusee : un 400 enverrait le geste au magasin mort de la
// file hors ligne pour quelques lettres de trop), vide -> null.
export function cleanNote(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).replace(/\r\n?/g, "\n").replace(/\t/g, " ").replace(CONTROLES, "")
    .replace(/[ ]{2,}/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  const coupe = Array.from(s).slice(0, V3_NOTE_MAX).join("").trim();
  return coupe === "" ? null : coupe;
}

// Piece du probleme, pour le titre « <type> · <piece> ». Absente : tout le logement.
export function cleanWhere(v: unknown): string {
  const s = typeof v === "string"
    ? v.replace(CONTROLES, " ").replace(/\s+/g, " ").trim()
    : "";
  const coupe = Array.from(s).slice(0, V3_WHERE_MAX).join("").trim();
  return coupe === "" ? V3_WHOLE_APARTMENT : coupe;
}

export function problemTitle(kind: string, where: string): string {
  return kind + " · " + where;
}

// Previent le technicien du ticket et les managers. `urgent` passe les heures de
// silence de push.ts ; tout le reste y reste soumis. Ne leve jamais : un push
// rate n'annule pas un ticket deja ecrit.
export async function notifyProblem(
  sb: any, push: PushFn, ticketId: number, technicianId: number | null,
  title: string, me: SessionUser, urgent: boolean, dedupePrefix: string,
): Promise<void> {
  let destinataires: number[] = technicianId ? [Number(technicianId)] : [];
  try {
    destinataires = [...destinataires, ...(await managerIds(sb))];
  } catch (e) {
    console.warn("[v3] managers illisibles pour le ticket " + String(ticketId) + ": " + String(e));
  }
  // Aucun nom de guest, aucun numero (ruling 9) : le titre porte type et piece.
  const payload = {
    title: (urgent ? "Urgent: " : "") + title,
    body: "Reported by " + me.name + ". Open HK Planner to see the details.",
    url: "https://stunning-kleicha-f61101.netlify.app/",
    tag: "v3-ticket-" + String(ticketId),
  };
  for (const cid of [...new Set(destinataires)]) {
    const opts: Record<string, unknown> = {
      dedupeKey: dedupePrefix + ":" + String(ticketId) + ":" + String(cid),
    };
    if (urgent) opts.priority = "urgent";
    try {
      await push(sb, cid, payload, opts);
    } catch (e) {
      console.warn("[v3] push rate pour " + String(cid) + ": " + String(e));
    }
  }
}

function readTicketId(v: unknown): number | null {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
}

// Le ticket existe, vient de l'app, a ete signale aujourd'hui (Dubai) par la
// session qui parle. Rend le ticket, ou la reponse de refus.
async function monTicket(
  sb: any, me: SessionUser, ticketId: number,
): Promise<{ ticket: any } | { refus: ActionResult }> {
  const { data: ticket, error } = await sb.from("maintenance_tickets")
    .select("id, title, priority, status, photo_path, source, created_at, assigned_technician_id")
    .eq("id", ticketId).maybeSingle();
  if (error) throw error;
  if (!ticket) return { refus: { status: 400, body: { error: "ticket not found" } } };
  const interdit = { refus: { status: 403, body: { error: "not your problem" } } };
  const creeMs = Date.parse(String(ticket.created_at ?? ""));
  if (ticket.source !== "hk_planner_v3" || !Number.isFinite(creeMs) ||
      todayDubai(creeMs) !== todayDubai()) {
    return interdit;
  }
  const debutJour = new Date(todayDubai() + "T00:00:00+04:00").toISOString();
  const { data: evts, error: eErr } = await sb.from("job_events")
    .select("result").eq("event_type", "report_problem").eq("cleaner_id", me.cleaner_id)
    .gte("created_at", debutJour);
  if (eErr) throw eErr;
  const mien = (evts ?? []).some((e: any) => Number(e?.result?.ticketId) === ticketId);
  return mien ? { ticket } : interdit;
}

type Ecriture = { refus?: ActionResult; result?: Record<string, unknown> };

// Ossature commune. Rend la reponse, et le ticket quand l'ecriture decisive vient
// d'avoir lieu (null sur un rejeu ou un refus) : l'appelant ne fait ses
// ecritures accessoires que dans ce cas.
async function surMonTicket(
  sb: any, me: SessionUser, ticketId: number, idem: string, eventType: V3EventType,
  payload: Record<string, unknown>, ecrire: (ticket: any) => Promise<Ecriture>,
): Promise<{ reponse: ActionResult; ticket: any | null }> {
  const claim = await claimEvent(sb, idem, eventType, null, me.cleaner_id, { ticketId, ...payload });
  const rejeu = replayResponse(claim);
  if (rejeu) return { reponse: rejeu, ticket: null };
  let result: Record<string, unknown>;
  let ticket: any;
  try {
    const mt = await monTicket(sb, me, ticketId);
    if ("refus" in mt) {
      await releaseEvent(sb, idem);
      return { reponse: mt.refus, ticket: null };
    }
    ticket = mt.ticket;
    const w = await ecrire(ticket);
    if (w.refus) {
      await releaseEvent(sb, idem);
      return { reponse: w.refus, ticket: null };
    }
    result = w.result as Record<string, unknown>;
  } catch (e) {
    await releaseEvent(sb, idem);
    throw e;
  }
  await sansEchec("resultat non memorise pour " + idem, () => recordResult(sb, idem, result));
  return { reponse: { status: 200, body: result }, ticket };
}

const FERME: ActionResult = { status: 400, body: { error: "ticket is already closed" } };
const estFerme = (t: any) => FERMES.indexOf(String(t?.status ?? "")) !== -1;

function entree(body: any): { ticketId: number; idem: string } | ActionResult {
  const ticketId = readTicketId(body?.ticketId);
  if (!ticketId) return { status: 400, body: { error: "ticketId required" } };
  if (!validIdem(body?.idem)) return { status: 400, body: { error: "idem required" } };
  return { ticketId, idem: String(body.idem) };
}

export async function addProblemPhoto(sb: any, me: SessionUser, body: any): Promise<ActionResult> {
  const e = entree(body);
  if ("status" in e) return e;
  const photoId = await resolvePhotoId(sb, body);
  if (!photoId) return { status: 400, body: { error: "photo required" } };
  const { reponse } = await surMonTicket(sb, me, e.ticketId, e.idem, "add_problem_photo", { photoId },
    async (ticket) => {
      if (estFerme(ticket)) return { refus: FERME };
      const photo = await ownedPhoto(sb, photoId, me);
      if (!photo) return { refus: { status: 400, body: { error: "photo not found" } } };
      const { error } = await sb.from("photos").update({ ticket_id: e.ticketId }).eq("id", photoId);
      if (error) throw error;
      // Premiere photo d'un ticket ouvert sans image (gaz, porte) : elle devient
      // la photo principale que l'onglet Maintenance affiche.
      if (!ticket.photo_path) {
        const { error: tErr } = await sb.from("maintenance_tickets")
          .update({ photo_path: photo.storage_path }).eq("id", e.ticketId);
        if (tErr) throw tErr;
      }
      return { result: { status: "success", ticketId: e.ticketId, photoId } };
    });
  return reponse;
}

export async function setProblemNote(sb: any, me: SessionUser, body: any): Promise<ActionResult> {
  const e = entree(body);
  if ("status" in e) return e;
  if (body?.note === undefined || (body.note !== null && typeof body.note !== "string")) {
    return { status: 400, body: { error: "note required" } };
  }
  const note = cleanNote(body.note);
  const { reponse } = await surMonTicket(sb, me, e.ticketId, e.idem, "set_problem_note", { note },
    async (ticket) => {
      if (estFerme(ticket)) return { refus: FERME };
      const { error } = await sb.from("maintenance_tickets")
        .update({ description: note }).eq("id", e.ticketId);
      if (error) throw error;
      return { result: { status: "success", ticketId: e.ticketId, note } };
    });
  return reponse;
}

export async function updateProblem(
  sb: any, me: SessionUser, body: any, deps: { push?: PushFn } = {},
): Promise<ActionResult> {
  const push = deps.push ?? sendPush;
  const e = entree(body);
  if ("status" in e) return e;
  const aUrgence = body?.urgency !== undefined;
  const priority = aUrgence ? ownKey(V3_URGENCY_PRIORITY, body.urgency) : null;
  if (aUrgence && !priority) return { status: 400, body: { error: "invalid urgency" } };
  const aPiece = body?.where !== undefined;
  if (!aUrgence && !aPiece) return { status: 400, body: { error: "nothing to update" } };
  const where = aPiece ? cleanWhere(body.where) : null;
  let devientUrgent = false;
  let titre = "";
  const { reponse, ticket } = await surMonTicket(sb, me, e.ticketId, e.idem, "update_problem",
    { urgency: aUrgence ? body.urgency : null, where }, async (t) => {
      if (estFerme(t)) return { refus: FERME };
      const patch: Record<string, unknown> = {};
      if (priority) patch.priority = priority;
      // Le type est la partie du titre avant « · », posee par reportProblem.
      titre = String(t.title ?? "");
      if (where !== null) {
        titre = problemTitle(titre.split(" · ")[0], where);
        patch.title = titre;
      }
      // Lu AVANT l'ecriture : apres, la ligne relue porte deja la nouvelle valeur.
      const avant = t.priority ?? null;
      devientUrgent = priority === "urgent" && avant !== "urgent";
      const { error } = await sb.from("maintenance_tickets").update(patch).eq("id", e.ticketId);
      if (error) throw error;
      return {
        result: {
          status: "success", ticketId: e.ticketId,
          priority: priority ?? avant, title: titre,
        },
      };
    });
  if (ticket) {
    await sansEchec("journal du ticket " + String(e.ticketId), () =>
      v3Log(sb, "ticket_" + String(e.ticketId), "ticket_updated", me.name, {
        via: "v3", priority, where,
      }));
    if (devientUrgent) {
      await notifyProblem(sb, push, e.ticketId, ticket.assigned_technician_id ?? null,
        titre, me, true, "v3-ticket-urgent");
    }
  }
  return reponse;
}

export async function deleteProblem(sb: any, me: SessionUser, body: any): Promise<ActionResult> {
  const e = entree(body);
  if ("status" in e) return e;
  const { reponse, ticket } = await surMonTicket(sb, me, e.ticketId, e.idem, "delete_problem", {},
    async (t) => {
      const fait = { result: { status: "success", ticketId: e.ticketId, status_value: "cancelled" } };
      // Deja annule : le geste est atteint, rien a reecrire.
      if (String(t.status) === "cancelled") return fait;
      if (estFerme(t)) return { refus: FERME };
      const { error } = await sb.from("maintenance_tickets")
        .update({ status: "cancelled" }).eq("id", e.ticketId);
      if (error) throw error;
      return fait;
    });
  if (ticket) {
    await sansEchec("journal du ticket " + String(e.ticketId), () =>
      v3Log(sb, "ticket_" + String(e.ticketId), "ticket_cancelled", me.name, { via: "v3" }));
  }
  return reponse;
}

// Actions JSON routees par index.ts, apres session et role. updateProblem prend
// un quatrieme argument de test (push injecte) : index.ts ne le passe jamais.
export const V3_PROBLEM_ACTIONS: Record<
  string, (sb: any, me: SessionUser, body: any) => Promise<ActionResult>
> = {
  "v3.addProblemPhoto": addProblemPhoto,
  "v3.setProblemNote": setProblemNote,
  "v3.updateProblem": (sb, me, body) => updateProblem(sb, me, body),
  "v3.deleteProblem": deleteProblem,
};
