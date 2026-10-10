import { assertEquals } from "jsr:@std/assert@1";
import { fakeDb } from "./v3_fakedb.ts";
import { mgrSettings, mgrSettingsSet, parseSettingSet, TARGET_ERROR } from "./mgr_settings.ts";

const ME = { cleaner_id: 8, name: "Walter", role: "manager", color: "" };

const seed = () => fakeDb({
  app_config: [
    { key: "auto_send_cleaners", value: "false" },
    { key: "inspections_daily_target", value: "6" },
  ],
  listing_config: [
    { listing_id: "L1", inspection_excluded: true },
    { listing_id: "L2", inspection_excluded: false },
    { listing_id: "L3", inspection_excluded: true },
  ],
  checklist_templates: [
    { id: 1, name: "Standard", items: ["Beds", "Bathroom", "Kitchen"] },
    { id: 2, name: "Empty", items: null },
  ],
  cleaning_log: [],
});

Deno.test("mgr.settings: forme complete", async () => {
  const s = await mgrSettings(seed(), "VAPIDKEY");
  assertEquals(s, {
    autopilot: false,
    inspectionTarget: 6,
    excludedCount: 2,
    templates: [{ id: 1, name: "Standard", items: 3 }, { id: 2, name: "Empty", items: 0 }],
    push: { vapidPublicKey: "VAPIDKEY" },
  });
});

Deno.test("mgr.settings: valeurs par defaut (autopilot actif, objectif 4, cle absente)", async () => {
  const s = await mgrSettings(fakeDb({}), null);
  assertEquals(s, { autopilot: true, inspectionTarget: 4, excludedCount: 0, templates: [], push: { vapidPublicKey: null } });
});

Deno.test("mgr.settings: objectif hors bornes en base = defaut 4", async () => {
  const db = seed();
  db.tables.app_config[1].value = "99";
  assertEquals((await mgrSettings(db, null)).inspectionTarget, 4);
});

Deno.test("parseSettingSet: objectif d inspections", () => {
  for (const bad of [-1, 51, 4.5, "7", null, undefined]) {
    assertEquals(parseSettingSet({ key: "inspectionTarget", value: bad }), { ok: false, error: TARGET_ERROR });
  }
  assertEquals(TARGET_ERROR, "Inspection target must be a whole number from 0 to 50.");
  assertEquals(parseSettingSet({ key: "inspectionTarget", value: 0 }), { ok: true, key: "inspectionTarget", value: 0 });
  assertEquals(parseSettingSet({ key: "inspectionTarget", value: 50 }), { ok: true, key: "inspectionTarget", value: 50 });
});

Deno.test("parseSettingSet: autopilot booleen seulement, cle inconnue", () => {
  assertEquals(parseSettingSet({ key: "autopilot", value: false }), { ok: true, key: "autopilot", value: false });
  for (const bad of ["false", 0, 1, null]) {
    assertEquals(parseSettingSet({ key: "autopilot", value: bad }).ok, false);
  }
  assertEquals(parseSettingSet({ key: "nope", value: 1 }), { ok: false, error: "Unknown setting." });
  assertEquals(parseSettingSet(null), { ok: false, error: "Unknown setting." });
});

Deno.test("mgr.settings.set: ecrit app_config, journalise avec l auteur de la session", async () => {
  const db = seed();
  const r = await mgrSettingsSet(db, { key: "autopilot", value: true, actor: "Faked" }, ME, null);
  assertEquals(r.status, 200);
  assertEquals((r.body as any).ok, true);
  assertEquals((r.body as any).settings.autopilot, true);
  const row = db.tables.app_config.find((c: any) => c.key === "auto_send_cleaners");
  assertEquals(row.value, "true");
  assertEquals(typeof row.updated_at, "string");
  assertEquals(db.tables.cleaning_log.length, 1);
  const log = db.tables.cleaning_log[0];
  assertEquals([log.reservation_key, log.action, log.actor, log.details],
    ["settings", "setting_changed", "Walter", { key: "autopilot", value: true }]);
});

Deno.test("mgr.settings.set: objectif ecrit en texte, une seule ligne par cle", async () => {
  const db = seed();
  const r = await mgrSettingsSet(db, { key: "inspectionTarget", value: 0 }, ME, null);
  assertEquals((r.body as any).settings.inspectionTarget, 0);
  const rows = db.tables.app_config.filter((c: any) => c.key === "inspections_daily_target");
  assertEquals(rows.length, 1);
  assertEquals(rows[0].value, "0");
});

Deno.test("mgr.settings.set: refus 400 sans ecriture", async () => {
  const db = seed();
  const r = await mgrSettingsSet(db, { key: "inspectionTarget", value: 51 }, ME, null);
  assertEquals(r, { status: 400, body: { error: TARGET_ERROR } });
  assertEquals(db.writes.length, 0);
});

Deno.test("mgr.settings: les etapes d un modele stocke en texte JSON sont comptees", async () => {
  const db = seed();
  db.tables.checklist_templates.push({ id: 3, name: "Texte", items: JSON.stringify(["A", "B"]) });
  db.tables.checklist_templates.push({ id: 4, name: "Casse", items: "{pas du json" });
  const s = await mgrSettings(db, null);
  assertEquals(s.templates.map((t: any) => [t.id, t.items]), [[1, 3], [2, 0], [3, 2], [4, 0]]);
});
