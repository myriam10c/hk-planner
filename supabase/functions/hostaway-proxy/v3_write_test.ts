import { assertEquals } from "jsr:@std/assert@1";
import { fakeDb } from "./v3_fakedb.ts";
import { startJob, tickItem } from "./v3_write.ts";

const FAIZA = { cleaner_id: 3, name: "Faiza", role: "cleaner", color: "#e94560" };
const JOB = "2026-09-12_Marc Lefevre";

Deno.test("startJob ouvre un chrono et journalise", async () => {
  const sb = fakeDb({ job_events: [], cleaning_timer: [], cleaning_log: [] });
  const r = await startJob(sb, FAIZA as any, { jobId: JOB, idem: "idem-start-0001" });
  assertEquals(r.status, 200);
  assertEquals((r.body as any).status, "success");
  assertEquals(sb.tables.cleaning_timer.length, 1);
  assertEquals(sb.tables.cleaning_timer[0].cleaner_id, 3);
  assertEquals(sb.tables.cleaning_timer[0].finished_at, null);
  assertEquals(sb.tables.cleaning_log[0].action, "timer_started");
});

Deno.test("startJob rejoue la meme cle sans remettre le chrono a zero", async () => {
  const sb = fakeDb({ job_events: [], cleaning_timer: [], cleaning_log: [] });
  const un = await startJob(sb, FAIZA as any, { jobId: JOB, idem: "idem-start-0002" });
  const depart = sb.tables.cleaning_timer[0].started_at;
  const deux = await startJob(sb, FAIZA as any, { jobId: JOB, idem: "idem-start-0002" });
  assertEquals(deux.status, 200);
  assertEquals((deux.body as any).startedAt, (un.body as any).startedAt);
  assertEquals(sb.tables.cleaning_timer[0].started_at, depart);
  assertEquals(sb.tables.cleaning_log.length, 1);
});

// Ruling du controleur : un rejeu dont l'ecriture metier n'a jamais abouti ne rend
// JAMAIS un succes fabrique. Le telephone doit garder son entree hors ligne.
Deno.test("startJob rend 409 quand la cle est posee sans resultat", async () => {
  const sb = fakeDb({
    job_events: [{
      id: 1, idem_key: "idem-start-0009", event_type: "start_job", job_id: JOB,
      cleaner_id: 3, payload: {}, result: null, created_at: "2026-09-12T06:00:00Z",
    }],
    cleaning_timer: [],
    cleaning_log: [],
  });
  const r = await startJob(sb, FAIZA as any, { jobId: JOB, idem: "idem-start-0009" });
  assertEquals(r.status, 409);
  assertEquals((r.body as any).error, "Still processing. Retry.");
  assertEquals(sb.tables.cleaning_timer.length, 0);
  assertEquals(sb.tables.job_events.length, 1);
});

Deno.test("startJob n'ecrase pas un chrono deja ouvert par un autre telephone", async () => {
  const sb = fakeDb({
    job_events: [],
    cleaning_timer: [{ reservation_key: JOB, cleaner_id: 4, started_at: "2026-09-12T06:00:00Z", finished_at: null }],
    cleaning_log: [],
  });
  const r = await startJob(sb, FAIZA as any, { jobId: JOB, idem: "idem-start-0003" });
  assertEquals((r.body as any).startedAt, "2026-09-12T06:00:00Z");
  assertEquals(sb.tables.cleaning_timer[0].cleaner_id, 4);
  assertEquals(sb.tables.cleaning_log.length, 0);
});

// Constat 1 de la revue : une lecture ratee ne doit jamais valoir « pas de chrono ».
// Sans le controle d'erreur, l'action ecrivait un chrono neuf par-dessus celui d'une
// collegue, changeait le cleaner_id et annoncait une fausse heure de debut.
Deno.test("startJob ne touche a rien quand la lecture du chrono echoue", async () => {
  const sb = fakeDb({
    job_events: [],
    cleaning_timer: [{ reservation_key: JOB, cleaner_id: 4, started_at: "2026-09-12T06:00:00Z", finished_at: null }],
    cleaning_log: [],
  });
  sb.fail["cleaning_timer.select"] = { code: "XX000", message: "read failed" };
  let leve = false;
  try {
    await startJob(sb, FAIZA as any, { jobId: JOB, idem: "idem-start-0010" });
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
  const sb = fakeDb({ job_events: [] });
  assertEquals((await startJob(sb, FAIZA as any, { jobId: JOB })).status, 400);
  assertEquals((await startJob(sb, FAIZA as any, { jobId: JOB, idem: "court" })).status, 400);
  assertEquals((await startJob(sb, FAIZA as any, { idem: "idem-start-0004" })).status, 400);
  assertEquals(sb.tables.job_events.length, 0);
});

Deno.test("startJob libere la cle quand l'ecriture du chrono echoue", async () => {
  const sb = fakeDb({ job_events: [], cleaning_timer: [] });
  sb.fail["cleaning_timer.upsert"] = { code: "XX000", message: "boom" };
  let leve = false;
  try {
    await startJob(sb, FAIZA as any, { jobId: JOB, idem: "idem-start-0005" });
  } catch (_e) {
    leve = true;
  }
  assertEquals(leve, true);
  assertEquals(sb.tables.job_events.length, 0);
});

Deno.test("tickItem ecrit la ligne de checklist", async () => {
  const sb = fakeDb({ job_events: [], checklist_progress: [] });
  const r = await tickItem(sb, FAIZA as any, {
    jobId: JOB, itemId: "Bathroom", checked: true, idem: "idem-tick-0001",
  });
  assertEquals(r.status, 200);
  assertEquals(sb.tables.checklist_progress.length, 1);
  assertEquals(sb.tables.checklist_progress[0].is_done, true);
  assertEquals(sb.tables.checklist_progress[0].item_name, "Bathroom");
});

Deno.test("tickItem est idempotent et ne double jamais une ligne", async () => {
  const sb = fakeDb({ job_events: [], checklist_progress: [] });
  const corps = { jobId: JOB, itemId: "Bathroom", checked: true, idem: "idem-tick-0002" };
  await tickItem(sb, FAIZA as any, corps);
  await tickItem(sb, FAIZA as any, corps);
  await tickItem(sb, FAIZA as any, corps);
  assertEquals(sb.tables.checklist_progress.length, 1);
  assertEquals(sb.tables.job_events.length, 1);
  assertEquals(sb.writes.filter((w) => w.table === "checklist_progress").length, 1);
});

// Ruling du controleur, jumeau du test startJob ci-dessus.
Deno.test("tickItem rend 409 quand la cle est posee sans resultat", async () => {
  const sb = fakeDb({
    job_events: [{
      id: 1, idem_key: "idem-tick-0009", event_type: "tick", job_id: JOB,
      cleaner_id: 3, payload: {}, result: null, created_at: "2026-09-12T06:00:00Z",
    }],
    checklist_progress: [],
  });
  const r = await tickItem(sb, FAIZA as any, {
    jobId: JOB, itemId: "Bathroom", checked: true, idem: "idem-tick-0009",
  });
  assertEquals(r.status, 409);
  assertEquals((r.body as any).error, "Still processing. Retry.");
  assertEquals(sb.tables.checklist_progress.length, 0);
  assertEquals(sb.tables.job_events.length, 1);
});

Deno.test("tickItem decoche aussi bien qu'il coche", async () => {
  const sb = fakeDb({ job_events: [], checklist_progress: [] });
  await tickItem(sb, FAIZA as any, { jobId: JOB, itemId: "Balcony", checked: true, idem: "idem-tick-0003" });
  await tickItem(sb, FAIZA as any, { jobId: JOB, itemId: "Balcony", checked: false, idem: "idem-tick-0004" });
  assertEquals(sb.tables.checklist_progress.length, 1);
  assertEquals(sb.tables.checklist_progress[0].is_done, false);
});

Deno.test("tickItem rattache la photo de la ligne quand il y en a une", async () => {
  const sb = fakeDb({
    job_events: [],
    checklist_progress: [],
    photos: [{ id: 55, storage_path: "v3/2026-09-12/abc.jpg", job_id: null, item_name: null, cleaner_id: 3 }],
  });
  await tickItem(sb, FAIZA as any, {
    jobId: JOB, itemId: "Final Check", checked: true, photoId: 55, idem: "idem-tick-0005",
  });
  assertEquals(sb.tables.photos[0].job_id, JOB);
  assertEquals(sb.tables.photos[0].item_name, "Final Check");
});

// Constat 3 de la revue : un photoId qui n'est pas un entier positif est refuse
// avant la pose de la cle. Un 500 repete bloquerait la file hors ligne du
// telephone (branche « panne serveur »), un 400 la libere.
Deno.test("tickItem refuse un photoId qui n'est pas un entier positif", async () => {
  const sb = fakeDb({ job_events: [], checklist_progress: [], photos: [] });
  for (const mauvais of ["abc", true, 1.5, 0, -3, {}]) {
    const r = await tickItem(sb, FAIZA as any, {
      jobId: JOB, itemId: "Final Check", checked: true, photoId: mauvais, idem: "idem-tick-0010",
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
  const sb = fakeDb({
    job_events: [],
    checklist_progress: [],
    photos: [{ id: 55, storage_path: "v3/2026-09-12/abc.jpg", job_id: "2026-09-12_Autre", item_name: "Kitchen", cleaner_id: 4 }],
  });
  const r = await tickItem(sb, FAIZA as any, {
    jobId: JOB, itemId: "Final Check", checked: true, photoId: 55, idem: "idem-tick-0011",
  });
  // Le cochage aboutit : c'est le fait principal. Seul le rattachement est refuse.
  assertEquals(r.status, 200);
  assertEquals(sb.tables.checklist_progress.length, 1);
  assertEquals(sb.tables.photos[0].job_id, "2026-09-12_Autre");
  assertEquals(sb.tables.photos[0].item_name, "Kitchen");
});

Deno.test("tickItem refuse un corps incomplet", async () => {
  const sb = fakeDb({ job_events: [] });
  assertEquals((await tickItem(sb, FAIZA as any, { jobId: JOB, checked: true, idem: "idem-tick-0006" })).status, 400);
  assertEquals((await tickItem(sb, FAIZA as any, { jobId: JOB, itemId: "X", idem: "idem-tick-0007" })).status, 400);
  assertEquals((await tickItem(sb, FAIZA as any, { jobId: JOB, itemId: "X", checked: "oui", idem: "idem-tick-0008" })).status, 400);
  assertEquals(sb.tables.job_events.length, 0);
});
