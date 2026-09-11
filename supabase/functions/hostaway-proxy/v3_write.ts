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
    // La lecture leve : une panne transitoire rendrait `existant` a null, donc
    // `dejaOuvert` a faux, et l'action ecraserait le chrono ouvert d'une collegue
    // avec une fausse heure de depart. Meme regle que les lectures de v3.myDay.
    const { data: existant, error: lecture } = await sb.from("cleaning_timer")
      .select("started_at, finished_at").eq("reservation_key", jobId).maybeSingle();
    if (lecture) throw lecture;
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

// photoId optionnel : absent, null ou vide veut dire « pas de photo sur cette
// ligne ». Present, il doit etre un entier positif. Un booleen est refuse ici
// (Number(true) vaut 1, donc la photo numero 1 serait deplacee) et une chaine non
// numerique aussi : en base, elle partirait en 22P02, donc en 500, et un 500
// repete bloque la file hors ligne du telephone alors qu'un 4xx la libere.
function readPhotoId(v: unknown): number | null | "invalid" {
  if (v === undefined || v === null || v === "") return null;
  if (typeof v === "boolean") return "invalid";
  if (typeof v !== "number" && typeof v !== "string") return "invalid";
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) return "invalid";
  return n;
}

export async function tickItem(sb: any, me: SessionUser, body: any): Promise<ActionResult> {
  const jobId = String(body?.jobId ?? "");
  const itemId = String(body?.itemId ?? "");
  const checked = body?.checked;
  const idem = body?.idem;
  if (!jobId || !itemId) return { status: 400, body: { error: "jobId and itemId required" } };
  if (typeof checked !== "boolean") return { status: 400, body: { error: "checked must be a boolean" } };
  if (!validIdem(idem)) return { status: 400, body: { error: "idem required" } };
  const photoId = readPhotoId(body?.photoId);
  if (photoId === "invalid") return { status: 400, body: { error: "Invalid photo id." } };

  const claim = await claimEvent(sb, idem, "tick", jobId, me.cleaner_id, {
    itemId, checked, photoId,
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
    // Le rattachement est borne au proprietaire du cliche : les identifiants sont
    // des entiers sequentiels, donc devinables, et sans ce filtre la photo d'une
    // collegue changerait de menage et disparaitrait du sien. Une photo qui n'est
    // pas la sienne n'echoue pas le cochage, elle n'est simplement pas rattachee.
    if (photoId !== null) {
      const { error: pErr } = await sb.from("photos")
        .update({ job_id: jobId, item_name: itemId })
        .eq("id", photoId).eq("cleaner_id", me.cleaner_id);
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
