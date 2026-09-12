import { assertEquals } from "jsr:@std/assert@1";
import { fakeDb } from "./v3_fakedb.ts";
import { finishJob, loadFinishContext, startJob, tickItem } from "./v3_write.ts";
import { V3_LINEN_FIELDS } from "./v3.ts";

const FAIZA = { cleaner_id: 3, name: "Faiza", role: "cleaner", color: "#e94560" };
const JOB = "2026-09-12_Marc Lefevre";
// Identifiant oppose rendu par v3.myDay. Le corps d'une requete ne porte plus
// jamais la reservation_key : elle contient le nom complet du guest (revue
// tache 3, constat 5). Les tables metier, elles, restent indexees sur la cle.
const JOB_ID = "job_1a2b3c4d5e6f70819a2b";
const LIEN = { job_id: JOB_ID, reservation_key: JOB };

// Toutes les bases de test portent la correspondance : sans elle, chaque action
// repondrait 404 avant d'ecrire quoi que ce soit.
function base(seed: Record<string, any[]> = {}) {
  return fakeDb({ v3_job_keys: [LIEN], ...seed });
}

Deno.test("startJob ouvre un chrono et journalise", async () => {
  const sb = base({ job_events: [], cleaning_timer: [], cleaning_log: [] });
  const r = await startJob(sb, FAIZA as any, { jobId: JOB_ID, idem: "idem-start-0001" });
  assertEquals(r.status, 200);
  assertEquals((r.body as any).status, "success");
  assertEquals(sb.tables.cleaning_timer.length, 1);
  assertEquals(sb.tables.cleaning_timer[0].cleaner_id, 3);
  assertEquals(sb.tables.cleaning_timer[0].finished_at, null);
  assertEquals(sb.tables.cleaning_log[0].action, "timer_started");
});

Deno.test("startJob rejoue la meme cle sans remettre le chrono a zero", async () => {
  const sb = base({ job_events: [], cleaning_timer: [], cleaning_log: [] });
  const un = await startJob(sb, FAIZA as any, { jobId: JOB_ID, idem: "idem-start-0002" });
  const depart = sb.tables.cleaning_timer[0].started_at;
  const deux = await startJob(sb, FAIZA as any, { jobId: JOB_ID, idem: "idem-start-0002" });
  assertEquals(deux.status, 200);
  assertEquals((deux.body as any).startedAt, (un.body as any).startedAt);
  assertEquals(sb.tables.cleaning_timer[0].started_at, depart);
  assertEquals(sb.tables.cleaning_log.length, 1);
});

// Ruling du controleur : un rejeu dont l'ecriture metier n'a jamais abouti ne rend
// JAMAIS un succes fabrique. Le telephone doit garder son entree hors ligne.
Deno.test("startJob rend 409 quand la cle est posee sans resultat", async () => {
  const sb = base({
    job_events: [{
      id: 1, idem_key: "idem-start-0009", event_type: "start_job", job_id: JOB_ID,
      cleaner_id: 3, payload: {}, result: null, created_at: "2026-09-12T06:00:00Z",
    }],
    cleaning_timer: [],
    cleaning_log: [],
  });
  const r = await startJob(sb, FAIZA as any, { jobId: JOB_ID, idem: "idem-start-0009" });
  assertEquals(r.status, 409);
  assertEquals((r.body as any).error, "Still processing. Retry.");
  assertEquals(sb.tables.cleaning_timer.length, 0);
  assertEquals(sb.tables.job_events.length, 1);
});

Deno.test("startJob n'ecrase pas un chrono deja ouvert par un autre telephone", async () => {
  const sb = base({
    job_events: [],
    cleaning_timer: [{ reservation_key: JOB, cleaner_id: 4, started_at: "2026-09-12T06:00:00Z", finished_at: null }],
    cleaning_log: [],
  });
  const r = await startJob(sb, FAIZA as any, { jobId: JOB_ID, idem: "idem-start-0003" });
  assertEquals((r.body as any).startedAt, "2026-09-12T06:00:00Z");
  assertEquals(sb.tables.cleaning_timer[0].cleaner_id, 4);
  assertEquals(sb.tables.cleaning_log.length, 0);
});

// Constat 1 de la revue : une lecture ratee ne doit jamais valoir « pas de chrono ».
// Sans le controle d'erreur, l'action ecrivait un chrono neuf par-dessus celui d'une
// collegue, changeait le cleaner_id et annoncait une fausse heure de debut.
Deno.test("startJob ne touche a rien quand la lecture du chrono echoue", async () => {
  const sb = base({
    job_events: [],
    cleaning_timer: [{ reservation_key: JOB, cleaner_id: 4, started_at: "2026-09-12T06:00:00Z", finished_at: null }],
    cleaning_log: [],
  });
  sb.fail["cleaning_timer.select"] = { code: "XX000", message: "read failed" };
  let leve = false;
  try {
    await startJob(sb, FAIZA as any, { jobId: JOB_ID, idem: "idem-start-0010" });
  } catch (_e) {
    leve = true;
  }
  assertEquals(leve, true);
  assertEquals(sb.tables.cleaning_timer.length, 1);
  assertEquals(sb.tables.cleaning_timer[0].cleaner_id, 4);
  assertEquals(sb.tables.cleaning_timer[0].started_at, "2026-09-12T06:00:00Z");
  assertEquals(sb.tables.cleaning_log.length, 0);
  // La cle est liberee : le rejeu de la file hors ligne doit pouvoir reessayer.
  assertEquals(sb.tables.job_events.length, 0);
});

Deno.test("startJob refuse une cle d'idempotence absente ou malformee", async () => {
  const sb = base({ job_events: [] });
  assertEquals((await startJob(sb, FAIZA as any, { jobId: JOB_ID })).status, 400);
  assertEquals((await startJob(sb, FAIZA as any, { jobId: JOB_ID, idem: "court" })).status, 400);
  assertEquals((await startJob(sb, FAIZA as any, { idem: "idem-start-0004" })).status, 400);
  assertEquals(sb.tables.job_events.length, 0);
});

Deno.test("startJob libere la cle quand l'ecriture du chrono echoue", async () => {
  const sb = base({ job_events: [], cleaning_timer: [] });
  sb.fail["cleaning_timer.upsert"] = { code: "XX000", message: "boom" };
  let leve = false;
  try {
    await startJob(sb, FAIZA as any, { jobId: JOB_ID, idem: "idem-start-0005" });
  } catch (_e) {
    leve = true;
  }
  assertEquals(leve, true);
  assertEquals(sb.tables.job_events.length, 0);
});

Deno.test("tickItem ecrit la ligne de checklist", async () => {
  const sb = base({ job_events: [], checklist_progress: [] });
  const r = await tickItem(sb, FAIZA as any, {
    jobId: JOB_ID, itemId: "Bathroom", checked: true, idem: "idem-tick-0001",
  });
  assertEquals(r.status, 200);
  assertEquals(sb.tables.checklist_progress.length, 1);
  assertEquals(sb.tables.checklist_progress[0].is_done, true);
  assertEquals(sb.tables.checklist_progress[0].item_name, "Bathroom");
});

Deno.test("tickItem est idempotent et ne double jamais une ligne", async () => {
  const sb = base({ job_events: [], checklist_progress: [] });
  const corps = { jobId: JOB_ID, itemId: "Bathroom", checked: true, idem: "idem-tick-0002" };
  await tickItem(sb, FAIZA as any, corps);
  await tickItem(sb, FAIZA as any, corps);
  await tickItem(sb, FAIZA as any, corps);
  assertEquals(sb.tables.checklist_progress.length, 1);
  assertEquals(sb.tables.job_events.length, 1);
  assertEquals(sb.writes.filter((w) => w.table === "checklist_progress").length, 1);
});

// Ruling du controleur, jumeau du test startJob ci-dessus.
Deno.test("tickItem rend 409 quand la cle est posee sans resultat", async () => {
  const sb = base({
    job_events: [{
      id: 1, idem_key: "idem-tick-0009", event_type: "tick", job_id: JOB_ID,
      cleaner_id: 3, payload: {}, result: null, created_at: "2026-09-12T06:00:00Z",
    }],
    checklist_progress: [],
  });
  const r = await tickItem(sb, FAIZA as any, {
    jobId: JOB_ID, itemId: "Bathroom", checked: true, idem: "idem-tick-0009",
  });
  assertEquals(r.status, 409);
  assertEquals((r.body as any).error, "Still processing. Retry.");
  assertEquals(sb.tables.checklist_progress.length, 0);
  assertEquals(sb.tables.job_events.length, 1);
});

Deno.test("tickItem decoche aussi bien qu'il coche", async () => {
  const sb = base({ job_events: [], checklist_progress: [] });
  await tickItem(sb, FAIZA as any, { jobId: JOB_ID, itemId: "Balcony", checked: true, idem: "idem-tick-0003" });
  await tickItem(sb, FAIZA as any, { jobId: JOB_ID, itemId: "Balcony", checked: false, idem: "idem-tick-0004" });
  assertEquals(sb.tables.checklist_progress.length, 1);
  assertEquals(sb.tables.checklist_progress[0].is_done, false);
});

Deno.test("tickItem rattache la photo de la ligne quand il y en a une", async () => {
  const sb = base({
    job_events: [],
    checklist_progress: [],
    photos: [{ id: 55, storage_path: "v3/2026-09-12/abc.jpg", job_id: null, item_name: null, cleaner_id: 3 }],
  });
  await tickItem(sb, FAIZA as any, {
    jobId: JOB_ID, itemId: "Final Check", checked: true, photoId: 55, idem: "idem-tick-0005",
  });
  assertEquals(sb.tables.photos[0].job_id, JOB_ID);
  assertEquals(sb.tables.photos[0].item_name, "Final Check");
});

// Constat 3 de la revue : un photoId qui n'est pas un entier positif est refuse
// avant la pose de la cle. Un 500 repete bloquerait la file hors ligne du
// telephone (branche « panne serveur »), un 400 la libere.
Deno.test("tickItem refuse un photoId qui n'est pas un entier positif", async () => {
  const sb = base({ job_events: [], checklist_progress: [], photos: [] });
  for (const mauvais of ["abc", true, 1.5, 0, -3, {}]) {
    const r = await tickItem(sb, FAIZA as any, {
      jobId: JOB_ID, itemId: "Final Check", checked: true, photoId: mauvais, idem: "idem-tick-0010",
    });
    assertEquals(r.status, 400);
    assertEquals((r.body as any).error, "Invalid photo id.");
  }
  assertEquals(sb.tables.job_events.length, 0);
  assertEquals(sb.tables.checklist_progress.length, 0);
});

// Constat 3 de la revue : les identifiants de photos sont des entiers sequentiels,
// donc devinables. Le rattachement est borne au proprietaire du cliche, sinon une
// photo changerait de menage et disparaitrait de celui d'origine.
Deno.test("tickItem ne rattache pas la photo d'une autre cleaner", async () => {
  const sb = base({
    job_events: [],
    checklist_progress: [],
    photos: [{ id: 55, storage_path: "v3/2026-09-12/abc.jpg", job_id: "job_00000000000000000000", item_name: "Kitchen", cleaner_id: 4 }],
  });
  const r = await tickItem(sb, FAIZA as any, {
    jobId: JOB_ID, itemId: "Final Check", checked: true, photoId: 55, idem: "idem-tick-0011",
  });
  // Le cochage aboutit : c'est le fait principal. Seul le rattachement est refuse.
  assertEquals(r.status, 200);
  assertEquals(sb.tables.checklist_progress.length, 1);
  assertEquals(sb.tables.photos[0].job_id, "job_00000000000000000000");
  assertEquals(sb.tables.photos[0].item_name, "Kitchen");
});

Deno.test("tickItem refuse un corps incomplet", async () => {
  const sb = base({ job_events: [] });
  assertEquals((await tickItem(sb, FAIZA as any, { jobId: JOB_ID, checked: true, idem: "idem-tick-0006" })).status, 400);
  assertEquals((await tickItem(sb, FAIZA as any, { jobId: JOB_ID, itemId: "X", idem: "idem-tick-0007" })).status, 400);
  assertEquals((await tickItem(sb, FAIZA as any, { jobId: JOB_ID, itemId: "X", checked: "oui", idem: "idem-tick-0008" })).status, 400);
  assertEquals(sb.tables.job_events.length, 0);
});

// ===========================================================================
// Tache 7 · finishJob et loadFinishContext
// ===========================================================================

const ELITE = { cleaner_id: 9, name: "Elite Cleaning", role: "subcontractor", color: "#000000" };

function lingePlein(): Record<string, number> {
  const l: Record<string, number> = {};
  for (const f of V3_LINEN_FIELDS) l[f] = 2;
  return l;
}

function espionPushFin() {
  const envois: Array<{ cleanerId: number; payload: any }> = [];
  return {
    envois,
    push: (_sb: any, cleanerId: number, payload: any) => {
      envois.push({ cleanerId, payload });
      return Promise.resolve({ sent: 1, pruned: 0, skipped: null });
    },
  };
}

function baseFin() {
  return base({
    job_events: [],
    cleaning_timer: [{
      reservation_key: JOB, cleaner_id: 3,
      started_at: new Date(Date.now() - 92 * 60_000).toISOString(),
      finished_at: null, total_pause_seconds: 0, pause_count: 0,
    }],
    checklist_progress: [],
    menage_done: [],
    laundry_counts: [],
    cleaning_notes: [],
    cleaning_log: [],
    photos: [{ id: 55, storage_path: "v3/2026-09-12/abc.jpg", job_id: null, cleaner_id: 3 }],
    cleaners: [{ id: 1, name: "Walter", role: "manager", is_active: true }],
  });
}

// Client dont une table precise fait tomber l'appel, pour verifier qu'une lecture
// de confort ne peut jamais empecher une cleaner de finir son menage.
function dbQuiTombe(sb: any, table: string) {
  return {
    ...sb,
    from: (t: string) => {
      if (t === table) throw new Error("lecture indisponible");
      return sb.from(t);
    },
  };
}

const CONTEXTE = { sameDay: false, listingName: "623 Samana Park View", managerIds: [1] };

Deno.test("finishJob clot le chrono, marque fait, ecrit la checklist et le linge", async () => {
  const sb = baseFin();
  const spy = espionPushFin();
  const r = await finishJob(sb, FAIZA as any, {
    jobId: JOB_ID,
    checklist: { "Master Bed & Linens": true, "Bathroom": true, "Final Check": true },
    photos: [55],
    linen: lingePlein(),
    idem: "idem-finish-0001",
  }, CONTEXTE, { push: spy.push });
  assertEquals(r.status, 200);
  const corps = r.body as any;
  assertEquals(corps.unchecked, 0);
  assertEquals(corps.durationMinutes >= 91 && corps.durationMinutes <= 93, true);
  assertEquals(sb.tables.cleaning_timer[0].finished_at !== null, true);
  assertEquals(sb.tables.cleaning_timer[0].duration_minutes, corps.durationMinutes);
  assertEquals(sb.tables.menage_done[0].done, true);
  assertEquals(sb.tables.checklist_progress.length, 3);
  assertEquals(sb.tables.laundry_counts.length, 1);
  assertEquals(sb.tables.laundry_counts[0].bed_sheets, 2);
  assertEquals(sb.tables.laundry_counts[0].counted_on, "2026-09-12");
  assertEquals(sb.tables.laundry_counts[0].author, "Faiza");
  assertEquals(sb.tables.photos[0].job_id, JOB_ID);
  assertEquals(spy.envois.length, 0); // pas un same-day
});

Deno.test("finishJob previent les managers sur un same-day", async () => {
  const sb = baseFin();
  const spy = espionPushFin();
  await finishJob(sb, FAIZA as any, {
    jobId: JOB_ID, checklist: { "Bathroom": true }, photos: [], linen: lingePlein(),
    idem: "idem-finish-0002",
  }, { ...CONTEXTE, sameDay: true }, { push: spy.push });
  assertEquals(spy.envois.map((e) => e.cleanerId), [1]);
  assertEquals(spy.envois[0].payload.title, "Same-day cleaning finished");
  assertEquals(spy.envois[0].payload.body.includes("623 Samana Park View"), true);
  // Aucun nom de guest dans la notification.
  assertEquals(spy.envois[0].payload.body.includes("Marc"), false);
});

Deno.test("finishJob compte les lignes non cochees sans refuser la fin", async () => {
  const sb = baseFin();
  const r = await finishJob(sb, FAIZA as any, {
    jobId: JOB_ID,
    checklist: { "Master Bed & Linens": true, "Bathroom": false, "Final Check": false },
    photos: [], linen: lingePlein(), idem: "idem-finish-0003",
  }, CONTEXTE, { push: espionPushFin().push });
  assertEquals(r.status, 200);
  assertEquals((r.body as any).unchecked, 2);
  assertEquals(sb.tables.menage_done[0].done, true);
});

Deno.test("finishJob exige le linge d'une cleaner interne, jamais d'un sous-traitant", async () => {
  const sb = baseFin();
  const sans = await finishJob(sb, FAIZA as any, {
    jobId: JOB_ID, checklist: {}, photos: [], idem: "idem-finish-0004",
  }, CONTEXTE, { push: espionPushFin().push });
  assertEquals(sans.status, 400);
  assertEquals(sb.tables.menage_done.length, 0);
  assertEquals(sb.tables.job_events.length, 0);

  const sb2 = baseFin();
  const elite = await finishJob(sb2, ELITE as any, {
    jobId: JOB_ID, checklist: {}, photos: [], idem: "idem-finish-0005",
  }, CONTEXTE, { push: espionPushFin().push });
  assertEquals(elite.status, 200);
  assertEquals(sb2.tables.laundry_counts.length, 0);
  assertEquals(sb2.tables.menage_done[0].done, true);
});

Deno.test("finishJob refuse un comptage de linge negatif ou non entier", async () => {
  const sb = baseFin();
  const negatif = await finishJob(sb, FAIZA as any, {
    jobId: JOB_ID, checklist: {}, photos: [],
    linen: { ...lingePlein(), bath_mats: -1 }, idem: "idem-finish-0020",
  }, CONTEXTE, { push: espionPushFin().push });
  assertEquals(negatif.status, 400);
  const flottant = await finishJob(sb, FAIZA as any, {
    jobId: JOB_ID, checklist: {}, photos: [],
    linen: { ...lingePlein(), bed_sheets: 1.5 }, idem: "idem-finish-0021",
  }, CONTEXTE, { push: espionPushFin().push });
  assertEquals(flottant.status, 400);
  // Un corps invalide ne brule aucune cle et n'ecrit rien.
  assertEquals(sb.tables.job_events.length, 0);
  assertEquals(sb.tables.laundry_counts.length, 0);
  assertEquals(sb.tables.menage_done.length, 0);
});

Deno.test("finishJob refuse un jobId absent ou une cle d'idempotence malformee", async () => {
  const sb = baseFin();
  assertEquals((await finishJob(sb, FAIZA as any, {
    checklist: {}, photos: [], linen: lingePlein(), idem: "idem-finish-0022",
  }, CONTEXTE, { push: espionPushFin().push })).status, 400);
  assertEquals((await finishJob(sb, FAIZA as any, {
    jobId: JOB_ID, checklist: {}, photos: [], linen: lingePlein(), idem: "court",
  }, CONTEXTE, { push: espionPushFin().push })).status, 400);
  assertEquals(sb.tables.job_events.length, 0);
  assertEquals(sb.tables.menage_done.length, 0);
});

Deno.test("finishJob refuse un identifiant de photo qui n'est pas un entier positif", async () => {
  const sb = baseFin();
  for (const mauvais of ["abc", true, 1.5, 0, -3, {}]) {
    const r = await finishJob(sb, FAIZA as any, {
      jobId: JOB_ID, checklist: {}, photos: [55, mauvais], linen: lingePlein(),
      idem: "idem-finish-0023",
    }, CONTEXTE, { push: espionPushFin().push });
    assertEquals(r.status, 400);
    assertEquals((r.body as any).error, "Invalid photo id.");
  }
  assertEquals(sb.tables.job_events.length, 0);
  assertEquals(sb.tables.photos[0].job_id, null);
});

Deno.test("finishJob ne rattache pas la photo d'une autre cleaner", async () => {
  const sb = baseFin();
  sb.tables.photos.push({
    id: 77, storage_path: "v3/2026-09-12/autre.jpg", job_id: "job_00000000000000000000", cleaner_id: 4,
  });
  const r = await finishJob(sb, FAIZA as any, {
    jobId: JOB_ID, checklist: {}, photos: [55, 77], linen: lingePlein(), idem: "idem-finish-0024",
  }, CONTEXTE, { push: espionPushFin().push });
  // La fin aboutit : c'est le fait principal. Seul le rattachement est refuse.
  assertEquals(r.status, 200);
  assertEquals(sb.tables.photos[0].job_id, JOB_ID);
  assertEquals(sb.tables.photos[1].job_id, "job_00000000000000000000");
});

Deno.test("finishJob est idempotent : rejouer ne double ni le linge ni le chrono", async () => {
  const sb = baseFin();
  const corps = {
    jobId: JOB_ID, checklist: { "Bathroom": true }, photos: [], linen: lingePlein(),
    idem: "idem-finish-0006",
  };
  const un = await finishJob(sb, FAIZA as any, corps, CONTEXTE, { push: espionPushFin().push });
  const deux = await finishJob(sb, FAIZA as any, corps, CONTEXTE, { push: espionPushFin().push });
  assertEquals((deux.body as any).durationMinutes, (un.body as any).durationMinutes);
  assertEquals(sb.tables.laundry_counts.length, 1);
  assertEquals(sb.writes.filter((w) => w.table === "laundry_counts").length, 1);
  assertEquals(sb.tables.job_events.length, 1);
});

// Ruling du controleur : jamais de succes fabrique sur un rejeu dont l'ecriture
// metier n'a pas abouti. Le telephone garde son entree hors ligne.
Deno.test("finishJob rend 409 quand la cle est posee sans resultat", async () => {
  const sb = baseFin();
  sb.tables.job_events.push({
    id: 1, idem_key: "idem-finish-0009", event_type: "finish_job", job_id: JOB_ID,
    cleaner_id: 3, payload: {}, result: null, created_at: "2026-09-12T06:00:00Z",
  });
  const r = await finishJob(sb, FAIZA as any, {
    jobId: JOB_ID, checklist: {}, photos: [], linen: lingePlein(), idem: "idem-finish-0009",
  }, CONTEXTE, { push: espionPushFin().push });
  assertEquals(r.status, 409);
  assertEquals((r.body as any).error, "Still processing. Retry.");
  assertEquals(sb.tables.menage_done.length, 0);
  assertEquals(sb.tables.laundry_counts.length, 0);
});

// Meme regle que startJob apres la revue de la tache 4 : une lecture ratee leve,
// la cle est liberee, et rien n'est marque fait sur une duree inventee.
Deno.test("finishJob ne marque pas fait quand la lecture du chrono echoue", async () => {
  const sb = baseFin();
  sb.fail["cleaning_timer.select"] = { message: "lecture indisponible" };
  let leve = false;
  try {
    await finishJob(sb, FAIZA as any, {
      jobId: JOB_ID, checklist: {}, photos: [], linen: lingePlein(), idem: "idem-finish-0010",
    }, CONTEXTE, { push: espionPushFin().push });
  } catch (_e) {
    leve = true;
  }
  assertEquals(leve, true);
  assertEquals(sb.tables.menage_done.length, 0);
  assertEquals(sb.tables.job_events.length, 0);
  assertEquals(sb.tables.cleaning_timer[0].finished_at, null);
});

// Un chrono deja clos n'est jamais recalcule : une deuxieme fin (deux telephones,
// ou une cle differente apres reinstallation) gonflerait la duree du menage, qui
// alimente les statistiques de l'equipe.
Deno.test("finishJob ne recalcule pas la duree d'un chrono deja clos", async () => {
  const sb = baseFin();
  sb.tables.cleaning_timer[0].finished_at = "2026-09-12T09:00:00.000Z";
  sb.tables.cleaning_timer[0].duration_minutes = 77;
  const r = await finishJob(sb, FAIZA as any, {
    jobId: JOB_ID, checklist: {}, photos: [], linen: lingePlein(), idem: "idem-finish-0011",
  }, CONTEXTE, { push: espionPushFin().push });
  assertEquals(r.status, 200);
  assertEquals((r.body as any).durationMinutes, 77);
  assertEquals(sb.tables.cleaning_timer[0].finished_at, "2026-09-12T09:00:00.000Z");
  assertEquals(sb.writes.filter((w) => w.table === "cleaning_timer").length, 0);
  assertEquals(sb.tables.cleaning_log.some((l: any) => l.action === "timer_stopped"), false);
  // Le menage est bien marque fait : la fin n'est pas perdue pour autant.
  assertEquals(sb.tables.menage_done[0].done, true);
});

Deno.test("finishJob ecrit la note libre quand il y en a une", async () => {
  const sb = baseFin();
  await finishJob(sb, FAIZA as any, {
    jobId: JOB_ID, checklist: {}, photos: [], linen: lingePlein(),
    notes: "Balcony door handle is loose", idem: "idem-finish-0007",
  }, CONTEXTE, { push: espionPushFin().push });
  assertEquals(sb.tables.cleaning_notes.length, 1);
  assertEquals(sb.tables.cleaning_notes[0].note_text, "Balcony door handle is loose");
  assertEquals(sb.tables.cleaning_notes[0].author, "Faiza");
});

Deno.test("loadFinishContext lit le same-day dans le cache, sans appeler Hostaway", async () => {
  const sb = base({
    proxy_cache: [{
      // Cle de l'app actuelle : sept jours a partir du jour ouvert.
      key: "checkouts:2026-09-12_2026-09-18",
      updated_at: new Date().toISOString(),
      payload: {
        reservations: [{
          checkOut: "2026-09-12", guest: "Marc Lefevre", listing: "623 Samana Park View",
          nextGuest: { guest: "Anna Weber", date: "2026-09-12", checkInTime: 15, sameDay: true },
        }],
      },
    }],
    cleaners: [{ id: 1, name: "Walter", role: "manager", is_active: true }],
  });
  const ctx = await loadFinishContext(sb, JOB);
  assertEquals(ctx.sameDay, true);
  assertEquals(ctx.listingName, "623 Samana Park View");
  assertEquals(ctx.managerIds, [1]);
});

// Meme precedence que l'ecran Today (v3_myday.nomDuLogement) : le nom interne
// « Apt - Immeuble » d'abord, le titre Hostaway ensuite, le titre marketing OTA
// en dernier. La notification manager dit donc exactement ce que la cleaner a
// lu sur son telephone.
function cacheAvecTitre(titreHostaway: string, fiches: any[]) {
  return base({
    proxy_cache: [{
      key: "checkouts:2026-09-12_2026-09-18",
      updated_at: new Date().toISOString(),
      payload: {
        reservations: [{
          checkOut: "2026-09-12", guest: "Marc Lefevre", listingId: "208702",
          listing: titreHostaway,
          nextGuest: { guest: "Anna Weber", date: "2026-09-12", checkInTime: 15, sameDay: true },
        }],
      },
    }],
    listing_config: fiches,
    cleaners: [],
  });
}

Deno.test("loadFinishContext prefere le nom interne du logement, jamais le titre OTA", async () => {
  const sb = cacheAvecTitre("3207 - Sobha Waves", [{
    listing_id: "208702", listing_name: "Modern 1bdr, 10' to Burj Khalifa",
    internal_name: "3207 - Sobha Waves",
  }]);
  assertEquals((await loadFinishContext(sb, JOB)).listingName, "3207 - Sobha Waves");
});

Deno.test("loadFinishContext garde le titre Hostaway plutot que le titre OTA", async () => {
  // Fiche sans nom interne : le titre Hostaway porte deja « Apt - Immeuble »,
  // le titre marketing ne dit pas ou aller.
  const sb = cacheAvecTitre("3207 - Sobha Waves", [{
    listing_id: "208702", listing_name: "Modern 1bdr, 10' to Burj Khalifa",
  }]);
  assertEquals((await loadFinishContext(sb, JOB)).listingName, "3207 - Sobha Waves");
});

Deno.test("loadFinishContext se rabat sur le titre OTA quand c'est le seul nom connu", async () => {
  const sb = cacheAvecTitre("", [{
    listing_id: "208702", listing_name: "Modern 1bdr, 10' to Burj Khalifa",
  }]);
  assertEquals((await loadFinishContext(sb, JOB)).listingName, "Modern 1bdr, 10' to Burj Khalifa");
});

Deno.test("loadFinishContext ne bloque jamais une fin quand le cache est vide", async () => {
  const sb = base({ proxy_cache: [], cleaners: [] });
  const ctx = await loadFinishContext(sb, JOB);
  assertEquals(ctx.sameDay, false);
  assertEquals(ctx.listingName, "");
  assertEquals(ctx.managerIds, []);
});

Deno.test("loadFinishContext ne bloque jamais une fin quand la liste des managers tombe", async () => {
  const sb = baseFin();
  const ctx = await loadFinishContext(dbQuiTombe(sb, "cleaners"), JOB);
  assertEquals(ctx.managerIds, []);
  assertEquals(ctx.sameDay, false);
});

// ---------------------------------------------------------------------------
// Identifiant oppose (revue tache 3, constat 5) : les trois actions d'ecriture
// traduisent le jobId recu en reservation_key avant de toucher a une table.
// ---------------------------------------------------------------------------

Deno.test("startJob rend 404 sur un jobId inconnu, sans bruler la cle", async () => {
  const sb = base({ job_events: [], cleaning_timer: [], cleaning_log: [] });
  const r = await startJob(sb, FAIZA as any, {
    jobId: "job_ffffffffffffffffffff", idem: "idem-start-0404",
  });
  assertEquals(r.status, 404);
  assertEquals((r.body as any).error, "Job not found.");
  // Rien d'ecrit, et surtout pas la cle d'idempotence : le telephone doit pouvoir
  // rejouer le meme geste avec la meme cle une fois l'id repare.
  assertEquals(sb.tables.job_events.length, 0);
  assertEquals(sb.tables.cleaning_timer.length, 0);
});

Deno.test("tickItem rend 404 sur un jobId inconnu", async () => {
  const sb = base({ job_events: [], checklist_progress: [] });
  const r = await tickItem(sb, FAIZA as any, {
    jobId: "job_ffffffffffffffffffff", itemId: "Bathroom", checked: true, idem: "idem-tick-0404",
  });
  assertEquals(r.status, 404);
  assertEquals(sb.tables.job_events.length, 0);
  assertEquals(sb.tables.checklist_progress.length, 0);
});

Deno.test("finishJob rend 404 sur un jobId inconnu", async () => {
  const sb = baseFin();
  const r = await finishJob(sb, FAIZA as any, {
    jobId: "job_ffffffffffffffffffff", linen: lingePlein(), idem: "idem-finish-0404",
  }, CONTEXTE, { push: espionPushFin().push });
  assertEquals(r.status, 404);
  assertEquals(sb.tables.job_events.length, 0);
  assertEquals(sb.tables.menage_done.length, 0);
  assertEquals(sb.tables.cleaning_timer[0].finished_at, null);
});

Deno.test("startJob ecrit sur la reservation_key et journalise l'id oppose", async () => {
  const sb = base({ job_events: [], cleaning_timer: [], cleaning_log: [] });
  const r = await startJob(sb, FAIZA as any, { jobId: JOB_ID, idem: "idem-start-0101" });
  assertEquals(r.status, 200);
  // Les tables metier portent la cle interne...
  assertEquals(sb.tables.cleaning_timer[0].reservation_key, JOB);
  assertEquals(sb.tables.cleaning_log[0].reservation_key, JOB);
  // ...et tout ce qui est rendu au telephone ou journalise cote v3 porte l'id
  // oppose, jamais le nom du guest.
  assertEquals((r.body as any).jobId, JOB_ID);
  assertEquals(sb.tables.job_events[0].job_id, JOB_ID);
  assertEquals(JSON.stringify(sb.tables.job_events[0]).includes("Lefevre"), false);
});

Deno.test("tickItem coche la bonne reservation_key et rattache la photo a l'id oppose", async () => {
  const sb = base({
    job_events: [], checklist_progress: [],
    photos: [{ id: 55, storage_path: "v3/2026-09-12/abc.jpg", job_id: null, item_name: null, cleaner_id: 3 }],
  });
  const r = await tickItem(sb, FAIZA as any, {
    jobId: JOB_ID, itemId: "Bathroom", checked: true, photoId: 55, idem: "idem-tick-0101",
  });
  assertEquals(r.status, 200);
  assertEquals(sb.tables.checklist_progress[0].reservation_key, JOB);
  assertEquals(sb.tables.checklist_progress[0].item_name, "Bathroom");
  // photos.job_id porte l'id oppose (le chemin de stockage non plus ne porte
  // jamais la cle, voir uploadPhoto).
  assertEquals(sb.tables.photos[0].job_id, JOB_ID);
});

Deno.test("finishJob ecrit linge, chrono et fait sur la reservation_key", async () => {
  const sb = baseFin();
  const r = await finishJob(sb, FAIZA as any, {
    jobId: JOB_ID, checklist: { "Bathroom": true }, linen: lingePlein(),
    notes: "Balcony door stiff.", idem: "idem-finish-0101",
  }, CONTEXTE, { push: espionPushFin().push });
  assertEquals(r.status, 200);
  assertEquals(sb.tables.menage_done[0].reservation_key, JOB);
  assertEquals(sb.tables.checklist_progress[0].reservation_key, JOB);
  assertEquals(sb.tables.laundry_counts[0].reservation_key, JOB);
  assertEquals(sb.tables.cleaning_notes[0].reservation_key, JOB);
  // counted_on vient du prefixe date de la CLE, que l'id oppose ne porte plus.
  assertEquals(sb.tables.laundry_counts[0].counted_on, "2026-09-12");
  assertEquals((r.body as any).jobId, JOB_ID);
});
