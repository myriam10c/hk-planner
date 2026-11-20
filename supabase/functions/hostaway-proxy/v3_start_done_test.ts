// Lot 1 des corrections cleaner, tache 5 : un menage fini ne se rouvre plus par
// erreur. v3.startJob sur un menage fini : accepte pour une aide (son demarrage
// arrive apres la fin de la lead, hors ligne), refuse pour qui serait lead, sauf
// avec l'indicateur « Clean again ». Celle qui confirme « Clean again » fait le
// rapport du nouveau menage, au demarrage, a la fin (jobRole) et dans la journee
// relue (loadRoles, buildMyDay). Fichier separe de v3_write_test.ts, deja long.
import { assertEquals, assertNotEquals } from "jsr:@std/assert@1";
import { fakeDb } from "./v3_fakedb.ts";
import { jobKeyFor } from "./v3.ts";
import { jobRole, startJob } from "./v3_write.ts";
import { loadRoles } from "./v3_day_extras.ts";
import { buildMyDay } from "./v3_myday.ts";

const FAIZA = { cleaner_id: 3, name: "Faiza", role: "cleaner", color: "#e94560" };
const HARLENE = { cleaner_id: 4, name: "Harlene", role: "cleaner", color: "#0f3460" };
const PIONAH = { cleaner_id: 7, name: "Pionah", role: "cleaner", color: "#16213e" };
const JOB = "2026-09-12_Marc Lefevre";
const JOB_ID = "job_1a2b3c4d5e6f70819a2b";
const sansPause = () => Promise.resolve();

// Chrono du menage de Faiza, clos a 07:30.
const CHRONO_CLOS = {
  reservation_key: JOB, cleaner_id: 3, started_at: "2026-09-12T06:00:00Z",
  finished_at: "2026-09-12T07:30:00Z", duration_minutes: 90, paused_at: null,
  total_pause_seconds: 0, pause_count: 0,
};
// Demarrage abouti de Faiza, seule sur le menage : elle en est la lead.
const DEPART_FAIZA = {
  id: 1, idem_key: "idem-faiza-0001", event_type: "start_job", job_id: JOB_ID, cleaner_id: 3,
  payload: { jobId: JOB_ID }, result: { status: "success", role: "lead" }, created_at: "2026-09-12T06:00:00Z",
};

// Menage fini par Faiza : demarrage journalise, chrono clos, menage_done.
function fini(seed: Record<string, any[]> = {}) {
  return fakeDb({
    v3_job_keys: [{ job_id: JOB_ID, reservation_key: JOB }],
    job_events: [{ ...DEPART_FAIZA }],
    cleaning_timer: [{ ...CHRONO_CLOS }],
    menage_done: [{ reservation_key: JOB, done: true }],
    cleaning_log: [],
    cleaners: [{ id: 3, name: "Faiza" }, { id: 4, name: "Harlene" }, { id: 7, name: "Pionah" }],
    ...seed,
  });
}

const corps = (r: any) => r.body as any;

Deno.test("startJob : l'aide dont le demarrage arrive apres la fin est acceptee, chrono clos intact", async () => {
  const sb = fini();
  const r = await startJob(sb, HARLENE as any, { jobId: JOB_ID, idem: "idem-harl-0001" }, sansPause);
  assertEquals(r.status, 200);
  assertEquals(corps(r).role, "helper");
  assertEquals(corps(r).lead.id, 3);
  assertEquals(corps(r).lead.name, "Faiza");
  // Ni nouvelle heure de depart, ni fin effacee, ni journal du chrono.
  assertEquals(sb.tables.cleaning_timer, [CHRONO_CLOS]);
  assertEquals(sb.tables.cleaning_log.length, 0);
  assertEquals(sb.tables.menage_done, [{ reservation_key: JOB, done: true }]);
  // Le demarrage est garde : sa fin sera celle d'une aide (ses ajouts vont au rapport de Faiza).
  assertEquals(await jobRole(sb, JOB_ID, 4), "helper");
  // Rejeu de la meme cle : meme reponse, toujours rien sur le chrono.
  const rejeu = await startJob(sb, HARLENE as any, { jobId: JOB_ID, idem: "idem-harl-0001" }, sansPause);
  assertEquals(rejeu.body, r.body);
  assertEquals(sb.tables.cleaning_timer, [CHRONO_CLOS]);
});

Deno.test("startJob : la lead qui redemarre son menage fini sans indicateur est refusee, rien n'est ecrit", async () => {
  const sb = fini();
  const r = await startJob(sb, FAIZA as any, { jobId: JOB_ID, idem: "idem-faiza-0002" }, sansPause);
  // Refus non relancable (4xx autre que 409 et 429), distinct du 503 « Still starting. Retry. ».
  assertEquals(r.status, 422);
  assertEquals(corps(r).code, "job_done");
  assertEquals(corps(r).error, "Cleaning already done");
  assertEquals(corps(r).role, undefined);
  assertEquals(sb.tables.cleaning_timer, [CHRONO_CLOS]);
  assertEquals(sb.tables.cleaning_log.length, 0);
  // Cle liberee : aucune ligne ne reste pour fausser les roles.
  assertEquals(sb.tables.job_events.map((e: any) => e.idem_key), ["idem-faiza-0001"]);
});

Deno.test("startJob : menage marque fait sans aucun demarrage (manager, ancienne app), refuse a qui serait lead", async () => {
  for (const etat of ["fait", "chrono"]) {
    const sb = fini({
      job_events: [],
      menage_done: etat === "fait" ? [{ reservation_key: JOB, done: true }] : [],
      cleaning_timer: etat === "chrono" ? [{ ...CHRONO_CLOS }] : [],
    });
    const r = await startJob(sb, HARLENE as any, { jobId: JOB_ID, idem: "idem-harl-0002" }, sansPause);
    assertEquals(r.status, 422, etat);
    assertEquals(corps(r).code, "job_done", etat);
    assertEquals(sb.tables.job_events.length, 0, etat);
    assertEquals(sb.tables.cleaning_timer.length, etat === "chrono" ? 1 : 0, etat);
  }
});

Deno.test("startJob : une ligne menage_done a false ne fait pas un menage fini", async () => {
  const sb = fini({ job_events: [], cleaning_timer: [], menage_done: [{ reservation_key: JOB, done: false }] });
  const r = await startJob(sb, FAIZA as any, { jobId: JOB_ID, idem: "idem-faiza-0009" }, sansPause);
  assertEquals(r.status, 200);
  assertEquals(corps(r).role, "lead");
  assertEquals(sb.tables.cleaning_timer.length, 1);
});

Deno.test("startJob : la lecture de menage_done leve, la cle est liberee et rien n'est ecrit", async () => {
  const sb = fini();
  sb.fail["menage_done.select"] = { code: "XX000", message: "read failed" };
  let leve = false;
  try {
    await startJob(sb, HARLENE as any, { jobId: JOB_ID, idem: "idem-harl-0003" }, sansPause);
  } catch (_e) { leve = true; }
  assertEquals(leve, true);
  assertEquals(sb.tables.job_events.map((e: any) => e.idem_key), ["idem-faiza-0001"]);
  assertEquals(sb.tables.cleaning_timer, [CHRONO_CLOS]);
});

Deno.test("startJob : « Clean again » par la meme cleaner, le menage repart et elle reste lead", async () => {
  const sb = fini();
  const r = await startJob(sb, FAIZA as any, { jobId: JOB_ID, idem: "idem-faiza-0003", again: true }, sansPause);
  assertEquals(r.status, 200);
  assertEquals(corps(r).role, "lead");
  assertEquals(corps(r).lead.id, 3);
  assertEquals(corps(r).again, true);
  // Comportement d'un redemarrage : chrono rouvert avec une nouvelle heure de depart.
  const t = sb.tables.cleaning_timer[0];
  assertEquals(t.finished_at, null);
  assertNotEquals(t.started_at, CHRONO_CLOS.started_at);
  assertEquals(corps(r).startedAt, t.started_at);
  assertEquals(sb.tables.cleaning_log.map((l: any) => l.action), ["timer_started"]);
  assertEquals(await jobRole(sb, JOB_ID, 3), "lead");
});

Deno.test("startJob : « Clean again » par une autre cleaner, elle est lead au demarrage, a la fin et dans la journee", async () => {
  const sb = fini();
  const r = await startJob(sb, HARLENE as any, { jobId: JOB_ID, idem: "idem-harl-0004", again: true }, sansPause);
  assertEquals(r.status, 200);
  assertEquals(corps(r).role, "lead");
  assertEquals(corps(r).lead.id, 4);
  assertEquals(corps(r).lead.name, "Harlene");
  // L'heure de la lead est celle de SON demarrage, celui du nouveau menage.
  const ligne = sb.tables.job_events.find((e: any) => e.idem_key === "idem-harl-0004");
  assertEquals(corps(r).lead.startedAt, ligne.created_at);
  assertEquals(await jobRole(sb, JOB_ID, 4), "lead");
  assertEquals(await jobRole(sb, JOB_ID, 3), "helper");
  const pourHarlene = await loadRoles(sb, [JOB_ID], 4);
  assertEquals(pourHarlene[JOB_ID]?.role, "lead");
  assertEquals(pourHarlene[JOB_ID]?.leadId, 4);
  assertEquals(pourHarlene[JOB_ID]?.myStartedAt, ligne.created_at);
  const pourFaiza = await loadRoles(sb, [JOB_ID], 3);
  assertEquals(pourFaiza[JOB_ID]?.role, "helper");
  assertEquals(pourFaiza[JOB_ID]?.leadId, 4);
  // Faiza n'a pas demarre le nouveau menage.
  assertEquals(pourFaiza[JOB_ID]?.myStartedAt, null);
});

Deno.test("startJob : une collegue qui rejoint le second menage est l'aide de celle qui l'a relance", async () => {
  const sb = fini();
  await startJob(sb, HARLENE as any, { jobId: JOB_ID, idem: "idem-harl-0005", again: true }, sansPause);
  const chrono = { ...sb.tables.cleaning_timer[0] };
  // Pionah, puis Faiza (la lead du premier menage) : demarrages ordinaires, sans indicateur.
  const p = await startJob(sb, PIONAH as any, { jobId: JOB_ID, idem: "idem-pion-0001" }, sansPause);
  assertEquals(p.status, 200);
  assertEquals(corps(p).role, "helper");
  assertEquals(corps(p).lead.id, 4);
  const f = await startJob(sb, FAIZA as any, { jobId: JOB_ID, idem: "idem-faiza-0004" }, sansPause);
  assertEquals(f.status, 200);
  assertEquals(corps(f).role, "helper");
  assertEquals(corps(f).lead.name, "Harlene");
  // Le chrono rouvert par Harlene n'est pas ecrase.
  assertEquals(sb.tables.cleaning_timer, [chrono]);
  assertEquals(await jobRole(sb, JOB_ID, 7), "helper");
  assertEquals(await jobRole(sb, JOB_ID, 4), "lead");
});

Deno.test("startJob : un second « Clean again » pendant le menage relance ne vole pas la place de lead", async () => {
  const sb = fini();
  await startJob(sb, HARLENE as any, { jobId: JOB_ID, idem: "idem-harl-0006", again: true }, sansPause);
  const r = await startJob(sb, PIONAH as any, { jobId: JOB_ID, idem: "idem-pion-0002", again: true }, sansPause);
  assertEquals(r.status, 200);
  assertEquals(corps(r).role, "helper");
  assertEquals(corps(r).lead.id, 4);
  assertEquals(corps(r).again, undefined);
  assertEquals(await jobRole(sb, JOB_ID, 4), "lead");
});

Deno.test("startJob : l'indicateur est ignore sur un menage en cours, la premiere reste lead", async () => {
  const sb = fini({
    cleaning_timer: [{ ...CHRONO_CLOS, finished_at: null, duration_minutes: null }],
    menage_done: [],
  });
  const r = await startJob(sb, HARLENE as any, { jobId: JOB_ID, idem: "idem-harl-0007", again: true }, sansPause);
  assertEquals(r.status, 200);
  assertEquals(corps(r).role, "helper");
  assertEquals(corps(r).lead.id, 3);
  assertEquals(corps(r).again, undefined);
  assertEquals(sb.tables.cleaning_timer[0].started_at, CHRONO_CLOS.started_at);
  assertEquals(await jobRole(sb, JOB_ID, 3), "lead");
});

// ---------------------------------------------------------------------------
// Journee relue : heure de fin, et menage relance vu en cours
// ---------------------------------------------------------------------------

async function jour(seed: (jobId: string) => Record<string, any[]>, timers: Record<string, any>, done: string[]) {
  const jobId = await jobKeyFor(JOB);
  return {
    jobId,
    input: {
      sb: fakeDb({ v3_job_keys: [], cleaners: [{ id: 3, name: "Faiza" }, { id: 4, name: "Harlene" }], ...seed(jobId) }),
      date: "2026-09-12",
      me: FAIZA,
      reservations: [{
        listingId: "102", listing: "623 Samana Park View", guest: "Marc Lefevre",
        checkOut: "2026-09-12", checkOutTime: 12, nextGuest: null,
      }],
      extras: [],
      listings: { "102": { listing_id: "102", internal_name: "623 Samana Park View", bedrooms: 1, unit_type: "1 BHK" } },
      templates: [],
      assignedKeys: [JOB],
      postponed: {},
      cancelled: [],
      done,
      timers,
      tickets: [],
      progress: {},
    },
  };
}

Deno.test("buildMyDay rend l'heure de fin au format de startedAt, null sans chrono clos", async () => {
  const clos = await jour((id) => ({ job_events: [{ ...DEPART_FAIZA, job_id: id }] }), { [JOB]: CHRONO_CLOS }, [JOB]);
  const s = (await buildMyDay(clos.input as any)).stops[0] as any;
  assertEquals(s.state, "done");
  assertEquals(s.startedAt, "2026-09-12T06:00:00Z");
  assertEquals(s.finishedAt, "2026-09-12T07:30:00Z");
  // Marque fait par un manager, sans chrono : fini, sans heure de fin connue.
  const marque = await jour(() => ({}), {}, [JOB]);
  const m = (await buildMyDay(marque.input as any)).stops[0] as any;
  assertEquals(m.state, "done");
  assertEquals(m.finishedAt, null);
  const ouvert = await jour(() => ({}), { [JOB]: { ...CHRONO_CLOS, finished_at: null } }, []);
  const o = (await buildMyDay(ouvert.input as any)).stops[0] as any;
  assertEquals(o.state, "running");
  assertEquals(o.finishedAt, null);
});

Deno.test("buildMyDay : un menage relance par « Clean again » est en cours, la relanceuse est lead", async () => {
  const relance = await jour((id) => ({
    job_events: [
      { ...DEPART_FAIZA, job_id: id },
      { id: 2, idem_key: "idem-harl-0008", event_type: "start_job", job_id: id, cleaner_id: 4,
        payload: { jobId: id, again: true }, result: { status: "success", role: "lead", again: true },
        created_at: "2026-09-12T09:00:00Z" },
    ],
    cleaning_assignments: [{ reservation_key: JOB, cleaner_id: 3 }, { reservation_key: JOB, cleaner_id: 4 }],
  }), { [JOB]: { ...CHRONO_CLOS, started_at: "2026-09-12T09:00:00Z", finished_at: null } }, [JOB]);
  const s = (await buildMyDay(relance.input as any)).stops[0] as any;
  // menage_done reste vrai jusqu'a la fin du second menage : le chrono rouvert dit « en cours ».
  assertEquals(s.state, "running");
  assertEquals(s.finishedAt, null);
  assertEquals(s.role, "helper");
  assertEquals(s.leadId, 4);
  assertEquals(s.myStartedAt, null);
  // L'heure de demarrage de Harlene est celle du nouveau menage.
  assertEquals(s.othersOnJob, [{ id: 4, name: "Harlene", startedAt: "2026-09-12T09:00:00Z" }]);
  // Second menage fini : de nouveau « done ».
  const refait = await jour((id) => ({
    job_events: [
      { ...DEPART_FAIZA, job_id: id },
      { id: 2, idem_key: "idem-harl-0008", event_type: "start_job", job_id: id, cleaner_id: 4,
        payload: { jobId: id, again: true }, result: { status: "success", role: "lead", again: true },
        created_at: "2026-09-12T09:00:00Z" },
    ],
  }), { [JOB]: { ...CHRONO_CLOS, started_at: "2026-09-12T09:00:00Z", finished_at: "2026-09-12T10:00:00Z" } }, [JOB]);
  assertEquals((await buildMyDay(refait.input as any)).stops[0].state, "done");
});

Deno.test("buildMyDay : menage marque fait par un manager pendant un chrono oublie, toujours fini sans « Clean again »", async () => {
  const oublie = await jour((id) => ({ job_events: [{ ...DEPART_FAIZA, job_id: id }] }),
    { [JOB]: { ...CHRONO_CLOS, finished_at: null } }, [JOB]);
  assertEquals((await buildMyDay(oublie.input as any)).stops[0].state, "done");
});

// Correction 1 (revue) : deux « Clean again » au meme moment. La seconde attend le demarrage
// de la premiere, puis lit le chrono que la premiere vient de rouvrir : le menage n'est plus
// fini, son indicateur est ignore et elle rejoint en aide. Lu avant l'attente, le chrono
// paraissait encore clos : deux cycles, deux leads, chrono ecrit deux fois.
Deno.test("startJob : deux « Clean again » au meme moment, une seule lead, un seul cycle, un seul chrono ecrit", async () => {
  const sb = fini();
  let pauses = 0;
  const premier = startJob(sb, HARLENE as any, { jobId: JOB_ID, idem: "idem-harl-0009", again: true }, sansPause);
  const second = startJob(sb, PIONAH as any, { jobId: JOB_ID, idem: "idem-pion-0009", again: true },
    async () => { pauses++; await premier; });
  const [a, b] = await Promise.all([premier, second]);
  assertEquals(pauses >= 1, true);
  assertEquals(a.status, 200);
  assertEquals(corps(a).role, "lead");
  assertEquals(corps(a).again, true);
  assertEquals(b.status, 200);
  assertEquals(corps(b).role, "helper");
  assertEquals(corps(b).lead.id, 4);
  assertEquals("again" in corps(b), false);
  // Un seul cycle ouvert, par Harlene.
  assertEquals(sb.tables.job_events.filter((e: any) => e.result && e.result.again === true)
    .map((e: any) => e.idem_key), ["idem-harl-0009"]);
  // Un seul chrono ecrit : celui de Harlene, rouvert une fois.
  assertEquals(sb.tables.cleaning_timer.length, 1);
  assertEquals(sb.tables.cleaning_timer[0].cleaner_id, 4);
  assertEquals(sb.tables.cleaning_timer[0].started_at, corps(a).startedAt);
  assertEquals(sb.tables.cleaning_timer[0].finished_at, null);
  assertEquals(sb.tables.cleaning_log.filter((l: any) => l.action === "timer_started").length, 1);
  assertEquals(await jobRole(sb, JOB_ID, 4), "lead");
  assertEquals(await jobRole(sb, JOB_ID, 7), "helper");
});
