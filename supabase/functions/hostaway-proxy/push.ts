// Web Push (RFC 8291 / RFC 8292) pour HK Planner.
// Isolé de index.ts pour être testable : index.ts appelle Deno.serve au chargement,
// ce module non. Les tests importent uniquement ce fichier.
import * as webpush from "jsr:@negrel/webpush@0.5.0";

declare const Deno: any;

const APP_URL = "https://stunning-kleicha-f61101.netlify.app";
const PUSH_DEDUPE_WINDOW_MS = 60_000;
const PUSH_TTL_SECONDS = 3600;
// Dubai est en UTC+4 toute l'année, aucun changement d'heure : un décalage fixe
// suffit, pas besoin d'Intl ni de base tzdata dans l'edge runtime.
const DUBAI_UTC_OFFSET_MS = 4 * 3600_000;

export interface PushPayload {
  title: string;
  body: string;
  url: string;
  tag: string;
}

// Construit le contenu de la notification d'une team_task.
// Anglais : l'app est utilisée par toute l'équipe.
export function taskPushPayload(
  task: any,
  createdBy: { name?: string } | null,
): PushPayload {
  const priority = String(task?.priority ?? "normal");
  const prefix = priority === "urgent"
    ? "Urgent task: "
    : priority === "high"
    ? "Priority task: "
    : "New task: ";
  const title = prefix + String(task?.title ?? "Task");
  const body = createdBy?.name
    ? "From " + createdBy.name
    : "Open HK Planner to see the details";
  return {
    title,
    body,
    url: APP_URL + "/?task=" + String(task?.id ?? ""),
    tag: "team-task-" + String(task?.id ?? "0"),
  };
}

// Notification d'affectation d'un ménage (action assignCleaner, ruling Q1).
// La clé de réservation porte la date : "YYYY-MM-DD_guest" pour un ménage Hostaway,
// "extra_YYYY-MM-DD_..." pour un ménage hors Hostaway. On n'expose ni le nom du
// guest ni le logement dans la notification : l'assigné ouvre l'app pour le détail.
export function assignmentPushPayload(
  reservationKey: string,
  serviceType: string,
): PushPayload {
  const m = String(reservationKey).match(/(\d{4}-\d{2}-\d{2})/);
  const datePart = m ? m[1] + " · " : "";
  return {
    title: "New cleaning assigned",
    body: datePart + String(serviceType) + ". Open HK Planner to see the property.",
    url: APP_URL + "/",
    tag: "cleaning-" + String(reservationKey),
  };
}

// Heures de silence Dubai : 22:00 inclus à 08:30 exclu (ruling Q3).
// Seules les priorités `urgent` traversent cette fenêtre.
export function isQuietHoursDubai(nowMs: number): boolean {
  const d = new Date(nowMs + DUBAI_UTC_OFFSET_MS);
  const minutes = d.getUTCHours() * 60 + d.getUTCMinutes();
  return minutes >= 22 * 60 || minutes < 8 * 60 + 30;
}

// Vrai si un envoi identique a déjà eu lieu dans la fenêtre.
export function isDuplicatePush(
  prevSentAt: string | null | undefined,
  nowMs: number,
  windowMs: number = PUSH_DEDUPE_WINDOW_MS,
): boolean {
  if (!prevSentAt) return false;
  const prev = Date.parse(prevSentAt);
  if (!Number.isFinite(prev)) return false;
  return nowMs - prev < windowMs;
}

// 404 et 410 = l'abonnement n'existe plus côté push service : on le désactive.
// Tout le reste (429, 5xx) est temporaire : on garde l'abonnement.
export function pushPruneReason(status: number): "gone" | null {
  return status === 404 || status === 410 ? "gone" : null;
}

let cachedServer: { server: any; applicationServerKey: string } | null = null;

// Lit les secrets à l'appel (pas au chargement du module) pour rester testable.
async function getPushAppServer(): Promise<
  { server: any; applicationServerKey: string } | null
> {
  const pub = Deno.env.get("VAPID_PUBLIC_KEY") ?? "";
  const priv = Deno.env.get("VAPID_PRIVATE_KEY") ?? "";
  const subject = Deno.env.get("VAPID_SUBJECT") ?? "";
  if (!pub || !priv || !subject) return null;
  if (cachedServer) return cachedServer;
  const vapidKeys = await webpush.importVapidKeys(
    { publicKey: JSON.parse(pub), privateKey: JSON.parse(priv) },
    { extractable: false },
  );
  cachedServer = {
    server: await webpush.ApplicationServer.new({
      contactInformation: subject,
      vapidKeys,
    }),
    applicationServerKey: await webpush.exportApplicationServerKey(vapidKeys),
  };
  return cachedServer;
}

// Clé publique VAPID en base64url, à passer au client pour pushManager.subscribe().
export async function getApplicationServerKey(): Promise<string | null> {
  try {
    const as = await getPushAppServer();
    return as ? as.applicationServerKey : null;
  } catch (e) {
    console.warn("[push] getApplicationServerKey failed:", e);
    return null;
  }
}

// Envoie une notification à tous les abonnements vivants d'un cleaner.
// NE LEVE JAMAIS : appelée depuis notifyAssignee, qui ne doit jamais casser une écriture.
// `opts.nowMs` est une couture de test : la prod ne le passe jamais.
export async function sendPush(
  sb: any,
  cleanerId: number,
  payload: PushPayload,
  opts: { dedupeKey?: string; priority?: string; nowMs?: number } = {},
): Promise<{ sent: number; pruned: number; skipped: string | null }> {
  try {
    const nowMs = opts.nowMs ?? Date.now();
    // Heures de silence (ruling Q3) : entre 22:00 et 08:30 Dubai, seul l'urgent
    // réveille quelqu'un. Le reste n'est PAS mis en file : la tâche reste visible
    // dans l'app, elle sera vue au réveil. Journalisé, jamais levé.
    if (opts.priority !== "urgent" && isQuietHoursDubai(nowMs)) {
      console.log("[push] quiet hours, skipped for cleaner " + String(cleanerId) + ": " + payload.tag);
      return { sent: 0, pruned: 0, skipped: "quiet_hours" };
    }
    const as = await getPushAppServer();
    if (!as) return { sent: 0, pruned: 0, skipped: "vapid_not_configured" };

    if (opts.dedupeKey) {
      const { data: prev } = await sb.from("push_dedupe")
        .select("sent_at").eq("dedupe_key", opts.dedupeKey).maybeSingle();
      if (isDuplicatePush(prev?.sent_at, nowMs)) {
        return { sent: 0, pruned: 0, skipped: "duplicate" };
      }
    }

    const { data: subs, error } = await sb.from("push_subscriptions")
      .select("id, endpoint, p256dh, auth")
      .eq("cleaner_id", cleanerId)
      .is("disabled_at", null);
    if (error) throw error;
    const rows = subs ?? [];
    if (rows.length === 0) return { sent: 0, pruned: 0, skipped: "no_subscription" };

    const message = JSON.stringify(payload);
    let sent = 0;
    let pruned = 0;
    for (const row of rows) {
      try {
        const subscriber = as.server.subscribe({
          endpoint: row.endpoint,
          keys: { p256dh: row.p256dh, auth: row.auth },
        });
        await subscriber.pushTextMessage(message, {
          ttl: PUSH_TTL_SECONDS,
          urgency: webpush.Urgency.High,
        });
        sent++;
        await sb.from("push_subscriptions")
          .update({ last_success_at: new Date().toISOString(), last_error: null })
          .eq("id", row.id);
      } catch (e: any) {
        const status = e?.response?.status ?? 0;
        const detail = "HTTP " + String(status) + " " + String(e?.message ?? e).slice(0, 180);
        if (pushPruneReason(status) === "gone") {
          pruned++;
          await sb.from("push_subscriptions")
            .update({ disabled_at: new Date().toISOString(), last_error: detail })
            .eq("id", row.id);
        } else {
          await sb.from("push_subscriptions")
            .update({ last_error: detail })
            .eq("id", row.id);
        }
        console.warn("[push] endpoint " + String(row.id) + " failed: " + detail);
      }
    }

    if (opts.dedupeKey && sent > 0) {
      await sb.from("push_dedupe")
        .upsert({ dedupe_key: opts.dedupeKey, sent_at: new Date().toISOString() });
    }
    return { sent, pruned, skipped: null };
  } catch (e) {
    console.warn("[push] sendPush failed:", e);
    return { sent: 0, pruned: 0, skipped: "error" };
  }
}
