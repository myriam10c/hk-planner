// Reglages de l'app manager (More > Settings) : lecture groupee et ecriture d'un
// reglage a la fois. L'auteur du journal vient de la session, jamais du corps.
import type { SessionUser } from "./auth.ts";
import { sessionActor } from "./actor.ts";
import { readTarget } from "./insp_read.ts";

export const TARGET_ERROR = "Inspection target must be a whole number from 0 to 50.";
const AUTOPILOT_ERROR = "Autopilot must be true or false.";
const UNKNOWN_ERROR = "Unknown setting.";

export type MgrSettings = {
  autopilot: boolean;
  inspectionTarget: number;
  excludedCount: number;
  templates: Array<{ id: number | string; name: string; items: number }>;
  push: { vapidPublicKey: string | null };
};

export type SettingSet =
  | { ok: true; key: "autopilot"; value: boolean }
  | { ok: true; key: "inspectionTarget"; value: number }
  | { ok: false; error: string };

export function parseSettingSet(body: unknown): SettingSet {
  const b = body && typeof body === "object" ? body as Record<string, unknown> : {};
  if (b.key === "autopilot") {
    return typeof b.value === "boolean" ? { ok: true, key: "autopilot", value: b.value } : { ok: false, error: AUTOPILOT_ERROR };
  }
  if (b.key === "inspectionTarget") {
    const v = b.value;
    return typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= 50
      ? { ok: true, key: "inspectionTarget", value: v }
      : { ok: false, error: TARGET_ERROR };
  }
  return { ok: false, error: UNKNOWN_ERROR };
}

// vapidPublicKey : lu par l'appelant avec getApplicationServerKey (meme source que getVapidPublicKey).
export async function mgrSettings(sb: any, vapidPublicKey: string | null): Promise<MgrSettings> {
  const [{ data: auto }, inspectionTarget, { data: excluded, error: exErr }, { data: tpl, error: tplErr }] = await Promise.all([
    sb.from("app_config").select("value").eq("key", "auto_send_cleaners").maybeSingle(),
    readTarget(sb),
    sb.from("listing_config").select("listing_id").eq("inspection_excluded", true),
    sb.from("checklist_templates").select("id, name, items").order("name"),
  ]);
  if (exErr) throw exErr;
  if (tplErr) throw tplErr;
  return {
    // Meme defaut que l'autopilote : cle absente = envoi actif.
    autopilot: auto ? auto.value === "true" : true,
    inspectionTarget,
    excludedCount: (excluded ?? []).length,
    templates: (tpl ?? []).map((t: any) => ({
      id: t.id, name: String(t.name ?? ""), items: Array.isArray(t.items) ? t.items.length : 0,
    })),
    push: { vapidPublicKey: vapidPublicKey || null },
  };
}

export async function mgrSettingsSet(
  sb: any, body: unknown, me: SessionUser, vapidPublicKey: string | null,
): Promise<{ status: number; body: unknown }> {
  const p = parseSettingSet(body);
  if (!p.ok) return { status: 400, body: { error: p.error } };
  const row = p.key === "autopilot"
    ? { key: "auto_send_cleaners", value: p.value ? "true" : "false" }
    : { key: "inspections_daily_target", value: String(p.value) };
  const { error } = await sb.from("app_config")
    .upsert({ ...row, updated_at: new Date().toISOString() }, { onConflict: "key" });
  if (error) throw error;
  // cleaning_log.reservation_key est NOT NULL : un reglage n'a pas de menage, cle « settings ».
  // Un journal rate ne casse pas l'ecriture (meme regle qu'addLog).
  const { error: logErr } = await sb.from("cleaning_log").insert({
    reservation_key: "settings", action: "setting_changed", actor: sessionActor(me, null),
    details: { key: p.key, value: p.value },
  });
  if (logErr) console.error("[mgr.settings.set] log insert failed:", logErr.message);
  return { status: 200, body: { ok: true, settings: await mgrSettings(sb, vapidPublicKey) } };
}
