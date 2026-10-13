// Menages en plus (extra_cleanings) crees depuis l'app manager : la cle
// d'idempotence du geste donne la reservation_key, si bien qu'un geste rejoue
// (double clic, reessai apres un delai depasse) retombe sur la contrainte unique
// et retrouve la prestation deja creee au lieu d'en creer une seconde.
import { validIdem } from "./v3.ts";

export function extraReservationKey(date: string, idem: unknown, rand: string): string {
  if (validIdem(idem)) return "extra_" + date + "_m" + String(idem).replace(/[^A-Za-z0-9]/g, "").slice(-20);
  return "extra_" + date + "_" + rand;
}

export async function insertExtraOnce(sb: any, row: Record<string, unknown>): Promise<{ row: any; replay: boolean }> {
  const { data, error } = await sb.from("extra_cleanings").insert(row).select().single();
  if (!error) return { row: data, replay: false };
  if (error.code !== "23505") throw new Error(error.message ?? "insert failed");
  const { data: prev, error: e2 } = await sb.from("extra_cleanings").select("*")
    .eq("reservation_key", row.reservation_key).maybeSingle();
  if (e2 || !prev) throw new Error(error.message ?? "insert failed");
  return { row: prev, replay: true };
}

// Heure dediee d'un extra (optionnelle) : stockee HH:MM, heure de Dubai sans
// fuseau. Vide ou null = pas d'heure (l'extra se comporte comme avant).
export function parseExtraTime(v: unknown): { ok: true; value: string | null } | { ok: false } {
  if (v === undefined || v === null) return { ok: true, value: null };
  if (typeof v !== "string") return { ok: false };
  const s = v.trim();
  if (s === "") return { ok: true, value: null };
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(s)) return { ok: false };
  return { ok: true, value: s };
}

// La colonne time de Postgres sort en « 14:00:00 » : on rend « 14:00 », ou null
// (jamais un 00:00 invente pour une ligne sans heure).
export function extraTimeOut(v: unknown): string | null {
  const m = typeof v === "string" ? v.match(/^(\d{2}:\d{2})(:\d{2}(\.\d+)?)?$/) : null;
  return m ? m[1] : null;
}

export function withExtraTime<T extends Record<string, unknown>>(row: T): T & { cleaning_time: string | null } {
  return { ...row, cleaning_time: extraTimeOut(row?.cleaning_time) };
}
