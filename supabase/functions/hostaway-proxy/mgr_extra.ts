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
