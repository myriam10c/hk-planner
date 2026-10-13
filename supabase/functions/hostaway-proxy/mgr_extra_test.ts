import { assert, assertEquals, assertRejects } from "jsr:@std/assert@1";
import { fakeDb } from "./v3_fakedb.ts";
import { extraReservationKey, extraTimeOut, extraUpdateValues, insertExtraOnce, parseExtraTime, withExtraTime } from "./mgr_extra.ts";
import { keyDate } from "./mgr_rules.ts";

Deno.test("cle d'un extra : derivee de la cle d'idempotence, sinon aleatoire", () => {
  const k = extraReservationKey("2026-10-10", "mgr-0123456789abcdef0123456789abcdef", "r4nd0m00");
  assertEquals(k, "extra_2026-10-10_mcdef0123456789abcdef");
  assertEquals(keyDate(k), "2026-10-10");
  assertEquals(extraReservationKey("2026-10-10", "short", "r4nd0m00"), "extra_2026-10-10_r4nd0m00");
  assertEquals(extraReservationKey("2026-10-10", undefined, "r4nd0m00"), "extra_2026-10-10_r4nd0m00");
  assertEquals(extraReservationKey("2026-10-10", "bad key with spaces!!", "r4nd0m00"), "extra_2026-10-10_r4nd0m00");
});

Deno.test("insertExtraOnce : le meme geste rejoue rend la ligne deja creee, sans doublon", async () => {
  const db = fakeDb({ extra_cleanings: [] });
  const row = { reservation_key: "extra_2026-10-10_mabc", listing_id: "L8", cleaning_date: "2026-10-10", status: "pending" };
  const a = await insertExtraOnce(db, row);
  assertEquals(a.replay, false);
  const b = await insertExtraOnce(db, { ...row, notes: "second try" });
  assertEquals(b.replay, true);
  assertEquals(b.row.id, a.row.id);
  assertEquals(db.tables.extra_cleanings.length, 1);
  const c = await insertExtraOnce(db, { ...row, reservation_key: "extra_2026-10-10_other" });
  assertEquals(c.replay, false);
  assertEquals(db.tables.extra_cleanings.length, 2);
});

Deno.test("insertExtraOnce : une autre erreur de la base remonte", async () => {
  const db = fakeDb({ extra_cleanings: [] });
  db.fail["extra_cleanings.insert"] = { code: "23503", message: "listing missing" };
  const e = await assertRejects(() => insertExtraOnce(db, { reservation_key: "extra_2026-10-10_x", listing_id: "L0" }));
  assert(String((e as any).message).includes("listing missing"));
});

Deno.test("heure d'un extra : HH:MM, vide ou null = pas d'heure, le reste refuse", () => {
  assertEquals(parseExtraTime("14:00"), { ok: true, value: "14:00" });
  assertEquals(parseExtraTime("09:30"), { ok: true, value: "09:30" });
  assertEquals(parseExtraTime(" 07:05 "), { ok: true, value: "07:05" });
  assertEquals(parseExtraTime(""), { ok: true, value: null });
  assertEquals(parseExtraTime(null), { ok: true, value: null });
  assertEquals(parseExtraTime(undefined), { ok: true, value: null });
  // Une valeur brute de la base (HH:MM:SS) renvoyee telle quelle est acceptee et ramenee a HH:MM.
  assertEquals(parseExtraTime("14:00:00"), { ok: true, value: "14:00" });
  assertEquals(parseExtraTime("08:15:59"), { ok: true, value: "08:15" });
  for (const bad of ["24:00", "12:60", "9:30", "14h00", "14:00:60", "14:00:00.5", 14, "abc", {}]) {
    assertEquals(parseExtraTime(bad), { ok: false }, String(bad));
  }
});

Deno.test("heure d'un extra en sortie : HH:MM, jamais 00:00 invente", () => {
  assertEquals(extraTimeOut("14:00:00"), "14:00");
  assertEquals(extraTimeOut("14:30"), "14:30");
  assertEquals(extraTimeOut(null), null);
  assertEquals(extraTimeOut(undefined), null);
  assertEquals(extraTimeOut(""), null);
  assertEquals(extraTimeOut("garbage"), null);
});

Deno.test("ligne d'extra en sortie : cleaning_time normalise, ligne sans la colonne = null", () => {
  assertEquals(withExtraTime({ id: 1, cleaning_time: "08:15:00" }), { id: 1, cleaning_time: "08:15" });
  assertEquals(withExtraTime({ id: 2 }), { id: 2, cleaning_time: null });
});

// ---------- Actions addExtraCleaning / updateExtraCleaning (index.ts) ----------
// index.ts n'est pas importable en test (Deno.serve au chargement) : la regle des
// champs vit dans extraUpdateValues, l'ordre des controles est verifie sur la source.
const src = await Deno.readTextFile(new URL("./index.ts", import.meta.url));
function bloc(action: string): string {
  const debut = src.indexOf(`if (action === "${action}"`);
  assert(debut >= 0, "handler absent pour " + action);
  const fin = src.indexOf("if (action ===", debut + 10);
  return src.slice(debut, fin < 0 ? undefined : fin);
}

Deno.test("updateExtraCleaning : heure absente = gardee, null ou vide = effacee (null), invalide = 400 sans rien changer", async () => {
  assertEquals(extraUpdateValues({ id: 1, notes: "x" }), { upd: { notes: "x" } });
  assertEquals(extraUpdateValues({ id: 1, cleaning_time: null }), { upd: { cleaning_time: null } });
  assertEquals(extraUpdateValues({ id: 1, cleaning_time: "" }), { upd: { cleaning_time: null } });
  assertEquals(extraUpdateValues({ id: 1, cleaning_time: "14:30" }), { upd: { cleaning_time: "14:30" } });
  assertEquals(extraUpdateValues({ id: 1, cleaning_time: "14:30:00" }), { upd: { cleaning_time: "14:30" } });
  assertEquals(extraUpdateValues({ id: 1, cleaning_time: "25:00", notes: "x" }), { error: "Invalid time." });
  // Aller-retour sur la table : posee, gardee quand absente, effacee en null.
  const db = fakeDb({ extra_cleanings: [] });
  const { row } = await insertExtraOnce(db, { reservation_key: "extra_2026-10-10_t", listing_id: "L8", cleaning_date: "2026-10-10", cleaning_time: "14:00" });
  const apply = async (body: any) => {
    const r = extraUpdateValues(body);
    if ("error" in r) return r.error;
    await db.from("extra_cleanings").update(r.upd).eq("id", row.id);
    return withExtraTime(db.tables.extra_cleanings[0]).cleaning_time;
  };
  assertEquals(await apply({ notes: "keep" }), "14:00");
  assertEquals(await apply({ cleaning_time: "nope" }), "Invalid time.");
  assertEquals(withExtraTime(db.tables.extra_cleanings[0]).cleaning_time, "14:00");
  assertEquals(await apply({ cleaning_time: "" }), null);
  assertEquals(await apply({ cleaning_time: "09:45" }), "09:45");
  assertEquals(await apply({ cleaning_time: null }), null);
  assertEquals(db.tables.extra_cleanings[0].cleaning_time, null);
});

Deno.test("updateExtraCleaning (source) : champs lus par extraUpdateValues, 400 avant toute lecture ou ecriture", () => {
  const b = bloc("updateExtraCleaning");
  const parse = b.indexOf("extraUpdateValues(body)");
  assert(parse >= 0);
  const refus = b.indexOf("return jsonResp({ error: built.error }, 400)");
  assert(refus > parse);
  assert(b.indexOf("sb.from(") > refus);
  assert(b.includes('.update(built.upd)'));
});

Deno.test("addExtraCleaning (source) : heure validee (400 « Invalid time. ») avant le conge et l'insertion, puis inseree", () => {
  const b = bloc("addExtraCleaning");
  const parse = b.indexOf("parseExtraTime(body.cleaning_time)");
  const refus = b.indexOf('return jsonResp({ error: "Invalid time." }, 400)');
  assert(parse >= 0 && refus > parse);
  assert(b.indexOf("sb.from(") > refus);
  assert(b.indexOf("insertExtraOnce(") > refus);
  assert(b.includes("cleaning_time: addTime.value"));
});
