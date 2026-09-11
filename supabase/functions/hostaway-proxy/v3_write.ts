// Ecritures v3 d'un menage : demarrage, cochage d'une ligne, fin de menage.
// Meme regle pour les trois : la cle d'idempotence est posee avant l'ecriture
// metier, et liberee si cette ecriture echoue, pour que le rejeu de la file hors
// ligne ne perde ni ne double jamais un geste.
//
// Deux identifiants cohabitent, et ne doivent jamais etre confondus :
//   - `jobId` : l'id oppose « job_<20 hex> » rendu par v3.myDay. C'est le seul
//     que le telephone connait. Il part dans job_events.job_id, dans photos.job_id,
//     dans les resultats memorises et dans les etiquettes de notification.
//   - `reservationKey` : la cle interne « <date>_<guest> », resolue ici par
//     resolveJob. Elle seule indexe cleaning_timer, checklist_progress,
//     laundry_counts, menage_done, cleaning_notes et cleaning_log, et elle ne
//     quitte jamais le proxy (revue tache 3, constat 5).
import type { SessionUser } from "./auth.ts";
import {
  ActionResult, claimEvent, managerIds, pickSnapshot, readLinen, recordResult,
  releaseEvent, replayResponse, resolveJob, v3Log, validIdem,
} from "./v3.ts";
import { sendPush } from "./push.ts";
import type { PushFn } from "./v3_tickets.ts";

export async function startJob(sb: any, me: SessionUser, body: any): Promise<ActionResult> {
  const jobId = String(body?.jobId ?? "");
  const idem = body?.idem;
  if (!jobId) return { status: 400, body: { error: "jobId required" } };
  if (!validIdem(idem)) return { status: 400, body: { error: "idem required" } };
  // Resolu AVANT claimEvent : un id inconnu ne doit pas bruler la cle
  // d'idempotence du telephone, sinon le rejeu du meme geste rendrait 409 pour
  // toujours une fois l'id repare.
  const reservationKey = await resolveJob(sb, jobId);
  if (!reservationKey) return { status: 404, body: { error: "Job not found." } };

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
      .select("started_at, finished_at").eq("reservation_key", reservationKey).maybeSingle();
    if (lecture) throw lecture;
    const dejaOuvert = !!(existant && existant.started_at && !existant.finished_at);
    const startedAt = dejaOuvert ? String(existant.started_at) : new Date().toISOString();
    if (!dejaOuvert) {
      const { error } = await sb.from("cleaning_timer").upsert({
        reservation_key: reservationKey,
        cleaner_id: me.cleaner_id,
        started_at: startedAt,
        finished_at: null,
        duration_minutes: null,
        paused_at: null,
        total_pause_seconds: 0,
        pause_count: 0,
      }, { onConflict: "reservation_key" });
      if (error) throw error;
      await v3Log(sb, reservationKey, "timer_started", me.name, { cleaner_id: me.cleaner_id, via: "v3" });
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
  const reservationKey = await resolveJob(sb, jobId);
  if (!reservationKey) return { status: 404, body: { error: "Job not found." } };

  const claim = await claimEvent(sb, idem, "tick", jobId, me.cleaner_id, {
    itemId, checked, photoId,
  });
  const rejeu = replayResponse(claim);
  if (rejeu) return rejeu;
  try {
    const { error } = await sb.from("checklist_progress").upsert({
      reservation_key: reservationKey, item_name: itemId, is_done: checked,
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

// ===========================================================================
// Fin de menage
// ===========================================================================

export interface FinishContext {
  sameDay: boolean;
  listingName: string;
  managerIds: number[];
}

// Prefixe date d'une cle de reservation. « 2026-09-12_Marc Lefevre » et
// « extra_2026-09-12_Deep clean » rendent tous deux « 2026-09-12 ».
function dateDeLaCle(jobId: string): string | null {
  const m = String(jobId).match(/^(?:extra_)?(\d{4}-\d{2}-\d{2})_/);
  return m ? m[1] : null;
}

// Prend la reservation_key, et non l'id oppose : les instantanes de proxy_cache
// sont indexes sur « <checkOut>_<guest> ». C'est l'appelant (le bloc de dispatch
// d'index.ts) qui resout l'id avant d'appeler ici.
//
// Contexte lu sans jamais appeler Hostaway : uniquement les instantanes deja poses
// dans proxy_cache (par l'app actuelle ou par v3.myDay), choisis par le meme
// `pickSnapshot` que la lecture de la journee. Aucun instantane utilisable = on
// finit quand meme, sans notification, et on le journalise. Rien ici ne leve :
// une notification est un confort, elle ne doit jamais empecher une cleaner de
// finir son menage.
export async function loadFinishContext(sb: any, reservationKey: string): Promise<FinishContext> {
  let sameDay = false;
  let listingName = "";
  let listingId = "";
  const date = dateDeLaCle(reservationKey);
  if (date) {
    try {
      const { data } = await sb.from("proxy_cache")
        .select("key, payload, updated_at").like("key", "checkouts:%");
      const snap = pickSnapshot(data ?? [], date);
      const reservations = (snap && snap.payload && snap.payload.reservations) || [];
      const hit = reservations.find((r: any) =>
        String(r.checkOut) + "_" + (r.guest || "Guest") === reservationKey);
      if (hit) {
        sameDay = !!(hit.nextGuest && hit.nextGuest.sameDay);
        listingName = String(hit.listing ?? "");
        listingId = String(hit.listingId ?? "");
      } else {
        console.log("[v3.finishJob] aucun instantane ne couvre " + date + ", pas de notification");
      }
    } catch (e) {
      console.warn("[v3.finishJob] contexte indisponible: " + String(e));
    }
  }
  // Le nom montre par la v3 est celui de listing_config (« Apt + Immeuble »),
  // pas le titre commercial Hostaway : la notification manager dit la meme chose
  // que l'ecran Today. Le titre Hostaway reste le repli.
  if (listingId) {
    try {
      const { data } = await sb.from("listing_config")
        .select("listing_id, listing_name, internal_name").eq("listing_id", listingId).maybeSingle();
      const interne = data && (data.listing_name || data.internal_name);
      if (interne) listingName = String(interne);
    } catch (e) {
      console.warn("[v3.finishJob] nom de logement indisponible: " + String(e));
    }
  }
  let managers: number[] = [];
  try {
    managers = await managerIds(sb);
  } catch (e) {
    console.warn("[v3.finishJob] liste des managers indisponible: " + String(e));
  }
  return { sameDay, listingName, managerIds: managers };
}

export async function finishJob(
  sb: any, me: SessionUser, body: any, ctx: FinishContext,
  deps: { push?: PushFn } = {},
): Promise<ActionResult> {
  const push = deps.push ?? sendPush;
  const jobId = String(body?.jobId ?? "");
  const idem = body?.idem;
  if (!jobId) return { status: 400, body: { error: "jobId required" } };
  if (!validIdem(idem)) return { status: 400, body: { error: "idem required" } };
  const reservationKey = await resolveJob(sb, jobId);
  if (!reservationKey) return { status: 404, body: { error: "Job not found." } };
  const checklist: Record<string, boolean> = (body?.checklist && typeof body.checklist === "object")
    ? body.checklist
    : {};
  const unchecked = Object.values(checklist).filter((v) => v !== true).length;
  // Memes regles que le photoId de tickItem : entier positif, jamais un booleen,
  // jamais une chaine non numerique. Un identifiant mal type partirait en 22P02,
  // donc en 500, et un 500 repete bloque la file hors ligne du telephone.
  const photos: number[] = [];
  for (const brut of Array.isArray(body?.photos) ? body.photos : []) {
    const pid = readPhotoId(brut);
    if (pid === "invalid") return { status: 400, body: { error: "Invalid photo id." } };
    if (pid !== null) photos.push(pid);
  }

  // Elite ne compte pas le linge (specification, section 3) ; une cleaner interne,
  // si : ce comptage alimente laundry_balances, qui est un vrai solde d'inventaire.
  const linenRequired = me.role !== "subcontractor";
  let linen: Record<string, number> | null = null;
  if (linenRequired) {
    const lu = readLinen((body?.linen && typeof body.linen === "object") ? body.linen : {});
    if ("error" in lu) return { status: 400, body: { error: lu.error } };
    linen = lu.values;
  }

  const claim = await claimEvent(sb, idem, "finish_job", jobId, me.cleaner_id, {
    unchecked, photos, linen, sameDay: ctx.sameDay,
  });
  // Rejeu : 200 avec le resultat memorise, ou 409 si la cle a ete posee sans que
  // la fin aboutisse. Jamais de succes fabrique : le telephone effacerait de sa
  // file hors ligne une fin de menage qui n'a jamais ete ecrite.
  const rejeu = replayResponse(claim);
  if (rejeu) return rejeu;

  let result: Record<string, unknown>;
  try {
    const items = Object.keys(checklist);
    if (items.length > 0) {
      const rows = items.map((name) => ({
        reservation_key: reservationKey, item_name: name, is_done: checklist[name] === true,
        updated_at: new Date().toISOString(),
      }));
      const { error } = await sb.from("checklist_progress")
        .upsert(rows, { onConflict: "reservation_key,item_name" });
      if (error) throw error;
    }
    // Rattachement borne au proprietaire des cliches, comme tickItem : les
    // identifiants de photos sont des entiers sequentiels, donc devinables.
    if (photos.length > 0) {
      const { error } = await sb.from("photos").update({ job_id: jobId })
        .in("id", photos).eq("cleaner_id", me.cleaner_id);
      if (error) throw error;
    }
    if (linen) {
      // counted_on vient du prefixe date de la cle, pas de l'heure de saisie : un
      // menage du 12 valide a 1h du matin le 13 reste impute au 12 (meme regle que
      // l'action saveLaundryCount).
      const countedOn = dateDeLaCle(reservationKey) ?? new Date().toISOString().slice(0, 10);
      const { error } = await sb.from("laundry_counts").upsert({
        reservation_key: reservationKey, ...linen, counted_on: countedOn,
        author: me.name, updated_at: new Date().toISOString(),
      }, { onConflict: "reservation_key" });
      if (error) throw error;
      await v3Log(sb, reservationKey, "laundry_counted", me.name, linen);
    }
    if (body?.notes && String(body.notes).trim()) {
      const noteText = String(body.notes).trim().slice(0, 2000);
      const { error } = await sb.from("cleaning_notes").insert({
        reservation_key: reservationKey, note_text: noteText, author: me.name,
      });
      if (error) throw error;
      await v3Log(sb, reservationKey, "note_added", me.name, { text: noteText });
    }

    // Chrono : meme calcul que l'action stopTimer, pauses comprises (un menage
    // demarre dans l'app actuelle peut en porter). La lecture leve, comme celle de
    // startJob : une panne transitoire ferait marquer le menage fait avec une
    // duree nulle memorisee, et le rejeu rendrait cette meme duree nulle.
    const { data: timer, error: lecture } = await sb.from("cleaning_timer")
      .select("started_at, finished_at, duration_minutes, total_pause_seconds, pause_count, paused_at")
      .eq("reservation_key", reservationKey).maybeSingle();
    if (lecture) throw lecture;
    let durationMinutes: number | null = null;
    if (timer && timer.finished_at) {
      // Chrono deja clos (deuxieme fin, ou fin apres un stopTimer de l'app
      // actuelle) : on rend la duree enregistree sans la recalculer. Recalculer
      // depuis started_at gonflerait le menage et fausserait les statistiques.
      durationMinutes = timer.duration_minutes === null || timer.duration_minutes === undefined
        ? null
        : Number(timer.duration_minutes);
    } else if (timer && timer.started_at) {
      const now = Date.now();
      let pauseSec = Number(timer.total_pause_seconds ?? 0);
      let pauseCount = Number(timer.pause_count ?? 0);
      if (timer.paused_at) {
        pauseSec += Math.max(0, Math.round((now - new Date(timer.paused_at).getTime()) / 1000));
        pauseCount += 1;
      }
      const effectiveMs = now - new Date(timer.started_at).getTime() - pauseSec * 1000;
      durationMinutes = Math.max(0, Math.round(effectiveMs / 60_000));
      const { error } = await sb.from("cleaning_timer").update({
        finished_at: new Date(now).toISOString(),
        duration_minutes: durationMinutes,
        paused_at: null,
        total_pause_seconds: pauseSec,
        pause_count: pauseCount,
      }).eq("reservation_key", reservationKey);
      if (error) throw error;
      await v3Log(sb, reservationKey, "timer_stopped", me.name, { duration_minutes: durationMinutes, via: "v3" });
    }

    const { error: dErr } = await sb.from("menage_done").upsert({
      reservation_key: reservationKey, done: true, updated_at: new Date().toISOString(),
    }, { onConflict: "reservation_key" });
    if (dErr) throw dErr;
    await v3Log(sb, reservationKey, "marked_done", me.name, { via: "v3", unchecked });

    result = { status: "success", jobId, durationMinutes, unchecked };
    await recordResult(sb, idem, result);
  } catch (e) {
    await releaseEvent(sb, idem);
    throw e;
  }

  // Push manager sur un same-day uniquement (specification, tableau des actions).
  // Jamais de nom de guest dans la notification : le manager ouvre l'app.
  if (ctx.sameDay) {
    const payload = {
      title: "Same-day cleaning finished",
      body: (ctx.listingName || "A same-day apartment") + " is ready. " +
        (result.durationMinutes ? String(result.durationMinutes) + " min." : "Open HK Planner for the detail."),
      url: "https://stunning-kleicha-f61101.netlify.app/",
      tag: "v3-sameday-" + jobId,
    };
    for (const cid of ctx.managerIds) {
      try {
        await push(sb, cid, payload, { dedupeKey: "v3-sameday:" + jobId + ":" + String(cid) });
      } catch (e) {
        console.warn("[v3.finishJob] push failed for manager " + String(cid) + ":", e);
      }
    }
  }
  return { status: 200, body: result };
}
