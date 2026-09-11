// Ecritures v3 d'un menage : demarrage, cochage d'une ligne, fin de menage.
// Meme regle pour les trois : la cle d'idempotence est posee avant l'ecriture
// metier, et liberee si cette ecriture echoue, pour que le rejeu de la file hors
// ligne ne perde ni ne double jamais un geste.
import type { SessionUser } from "./auth.ts";
import {
  ActionResult, claimEvent, recordResult, releaseEvent, replayResponse, v3Log, validIdem,
} from "./v3.ts";

export async function startJob(sb: any, me: SessionUser, body: any): Promise<ActionResult> {
  const jobId = String(body?.jobId ?? "");
  const idem = body?.idem;
  if (!jobId) return { status: 400, body: { error: "jobId required" } };
  if (!validIdem(idem)) return { status: 400, body: { error: "idem required" } };

  const claim = await claimEvent(sb, idem, "start_job", jobId, me.cleaner_id, { jobId });
  // Rejeu : 200 avec le resultat memorise, ou 409 si la cle a ete posee sans que
  // l'ecriture metier aboutisse. Jamais de succes fabrique : le telephone
  // supprimerait l'entree de sa file hors ligne et le geste serait perdu.
  const rejeu = replayResponse(claim);
  if (rejeu) return rejeu;
  try {
    // Un chrono deja ouvert n'est jamais ecrase : deux telephones sur le meme
    // menage ne doivent pas remettre le compteur a zero. Un chrono clos, lui, est
    // repris (re-nettoyage, ou redemarrage apres un arret accidentel), comme le
    // fait deja l'action startTimer.
    const { data: existant } = await sb.from("cleaning_timer")
      .select("started_at, finished_at").eq("reservation_key", jobId).maybeSingle();
    const dejaOuvert = !!(existant && existant.started_at && !existant.finished_at);
    const startedAt = dejaOuvert ? String(existant.started_at) : new Date().toISOString();
    if (!dejaOuvert) {
      const { error } = await sb.from("cleaning_timer").upsert({
        reservation_key: jobId,
        cleaner_id: me.cleaner_id,
        started_at: startedAt,
        finished_at: null,
        duration_minutes: null,
        paused_at: null,
        total_pause_seconds: 0,
        pause_count: 0,
      }, { onConflict: "reservation_key" });
      if (error) throw error;
      await v3Log(sb, jobId, "timer_started", me.name, { cleaner_id: me.cleaner_id, via: "v3" });
    }
    const result = { status: "success", jobId, startedAt };
    await recordResult(sb, idem, result);
    return { status: 200, body: result };
  } catch (e) {
    await releaseEvent(sb, idem);
    throw e;
  }
}

export async function tickItem(sb: any, me: SessionUser, body: any): Promise<ActionResult> {
  const jobId = String(body?.jobId ?? "");
  const itemId = String(body?.itemId ?? "");
  const checked = body?.checked;
  const idem = body?.idem;
  if (!jobId || !itemId) return { status: 400, body: { error: "jobId and itemId required" } };
  if (typeof checked !== "boolean") return { status: 400, body: { error: "checked must be a boolean" } };
  if (!validIdem(idem)) return { status: 400, body: { error: "idem required" } };

  const claim = await claimEvent(sb, idem, "tick", jobId, me.cleaner_id, {
    itemId, checked, photoId: body?.photoId ?? null,
  });
  const rejeu = replayResponse(claim);
  if (rejeu) return rejeu;
  try {
    const { error } = await sb.from("checklist_progress").upsert({
      reservation_key: jobId, item_name: itemId, is_done: checked,
      updated_at: new Date().toISOString(),
    }, { onConflict: "reservation_key,item_name" });
    if (error) throw error;
    // La photo a ete televersee avant le cochage : on la rattache maintenant a la
    // ligne, c'est ce rattachement qui fait la preuve « photo de cette ligne ».
    if (body?.photoId) {
      const { error: pErr } = await sb.from("photos")
        .update({ job_id: jobId, item_name: itemId }).eq("id", Number(body.photoId));
      if (pErr) throw pErr;
    }
    const result = { status: "success", jobId, itemId, checked };
    await recordResult(sb, idem, result);
    return { status: 200, body: result };
  } catch (e) {
    await releaseEvent(sb, idem);
    throw e;
  }
}
