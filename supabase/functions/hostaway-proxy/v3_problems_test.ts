// Problemes de l'app conversation (branchement, tache 2) : types, urgence,
// photos multiples, note texte, mise a jour et annulation. Pas de vocal
// (decision du 2026-10-05).
import { assertEquals } from "jsr:@std/assert@1";
import { fakeDb } from "./v3_fakedb.ts";
import * as tickets from "./v3_tickets.ts";
import {
  addProblemPhoto, deleteProblem, reportProblem, setProblemNote, updateProblem,
} from "./v3_tickets.ts";
import { roleAllowed, V3_EVENT_TYPES, V3_PROBLEM_KINDS, V3_ROLES } from "./v3.ts";
import { sendPush } from "./push.ts";

const FAIZA = { cleaner_id: 3, name: "Faiza", role: "cleaner", color: "#e94560" };
const PIONAH = { cleaner_id: 4, name: "Pionah", role: "cleaner", color: "#3366ff" };
const JOB = "2026-09-12_Marc Lefevre";
const JOB_ID = "job_1a2b3c4d5e6f70819a2b";

function espionPush() {
  const envois: Array<{ cleanerId: number; payload: any; opts: any }> = [];
  const push = async (_sb: any, cleanerId: number, payload: any, opts: any = {}) => {
    envois.push({ cleanerId, payload, opts });
    return { sent: 1, pruned: 0, skipped: null };
  };
  return { envois, push };
}

function base() {
  return fakeDb({
    v3_job_keys: [{ job_id: JOB_ID, reservation_key: JOB }],
    job_events: [],
    photos: [
      { id: 55, storage_path: "v3/2026-09-12/abc.jpg", job_id: null, ticket_id: null, cleaner_id: 3 },
      { id: 56, storage_path: "v3/2026-09-12/def.jpg", job_id: null, ticket_id: null, cleaner_id: 3 },
      { id: 57, storage_path: "v3/2026-09-12/ghi.jpg", job_id: null, ticket_id: null, cleaner_id: 4 },
      { id: 60, storage_path: "v3/voice/2026-09-12/a.webm", kind: "voice", ticket_id: null, cleaner_id: 3 },
    ],
    maintenance_tickets: [],
    maintenance_sla: [],
    ticket_comments: [],
    cleaning_log: [],
    on_duty: [],
    cleaners: [
      { id: 5, name: "Semax", role: "maintenance", is_active: true },
      { id: 1, name: "Walter", role: "manager", is_active: true },
    ],
  });
}

function corps(extra: Record<string, unknown> = {}) {
  return {
    jobId: JOB_ID, listingId: "102", kind: "Leak", urgency: "soon", where: "Bathroom",
    photoId: 55, idem: "idem-prob-0001", ...extra,
  };
}

// Cree un ticket par reportProblem, comme le ferait le telephone.
async function signale(sb: any, me: any = FAIZA, extra: Record<string, unknown> = {}): Promise<number> {
  const r = await reportProblem(sb, me, corps(extra), { push: espionPush().push });
  assertEquals(r.status, 200);
  return Number((r.body as any).ticketId);
}

// ---------------------------------------------------------------------------
// Tables et roles
// ---------------------------------------------------------------------------

Deno.test("V3_EVENT_TYPES suit la contrainte CHECK de la migration 20261013090000", () => {
  assertEquals([...V3_EVENT_TYPES].sort(), [
    "add_problem_photo", "check_ticket", "delete_photo", "delete_problem", "finish_job",
    "mgr_problem_act", "mnt_act", "mnt_ingest", "report_problem", "set_problem_note", "set_problem_voice", "start_job", "tick",
    "ticket_still", "update_problem", "upload_photo", "upload_voice",
  ]);
});

Deno.test("table des types : quinze types et leur categorie de ticket", () => {
  assertEquals(V3_PROBLEM_KINDS, {
    "Gas smell": "appliance", "Leak": "plumbing", "AC": "ac", "AC not working": "ac",
    "Power": "electrical",
    "Insects": "pest", "Missing": "general", "Broken": "general", "Stain": "general",
    "Very dirty": "general", "Guest forgot": "general", "Wall damage": "general",
    "Can't get in": "general", "Gas not working": "appliance", "Wi-Fi not working": "general",
  });
});

Deno.test("roles des nouvelles actions", () => {
  for (const a of ["v3.addProblemPhoto", "v3.setProblemNote",
    "v3.updateProblem", "v3.deleteProblem", "v3.reportProblem"]) {
    assertEquals(roleAllowed(a, "cleaner"), true, a);
    assertEquals(roleAllowed(a, "subcontractor"), true, a);
    assertEquals(roleAllowed(a, "manager"), false, a);
    assertEquals(roleAllowed(a, "maintenance"), false, a);
  }
});

Deno.test("aucune action de vocal n'existe (abandon du 2026-10-05)", () => {
  assertEquals("v3.uploadVoice" in V3_ROLES, false);
  assertEquals("v3.setProblemVoice" in V3_ROLES, false);
  assertEquals("uploadVoice" in tickets, false);
  assertEquals("setProblemVoice" in tickets, false);
  assertEquals("v3.setProblemVoice" in tickets.V3_PROBLEM_ACTIONS, false);
});

Deno.test("index.ts route chaque nouvelle action en POST, derriere session et role", async () => {
  const src = await Deno.readTextFile(new URL("./index.ts", import.meta.url));
  for (const a of ["v3.addProblemPhoto", "v3.setProblemNote",
    "v3.updateProblem", "v3.deleteProblem"]) {
    assertEquals(src.includes('["' + a + '", "POST"]'), true, a);
  }
  assertEquals(src.includes("v3.uploadVoice"), false);
  assertEquals(src.includes("v3.setProblemVoice"), false);
  const json = src.slice(src.indexOf("V3_PROBLEM_ACTIONS[action]"));
  assertEquals(json.indexOf("currentUser") > 0, true);
  assertEquals(json.indexOf("roleAllowed(action, me.role)") > 0, true);
});

// ---------------------------------------------------------------------------
// reportProblem : types, urgence, photo, titre
// ---------------------------------------------------------------------------

Deno.test("reportProblem refuse un type inconnu et l'ancien champ category", async () => {
  const sb = base();
  const inconnu = await reportProblem(sb, FAIZA as any, corps({ kind: "Volcano" }), { push: espionPush().push });
  assertEquals(inconnu.status, 400);
  assertEquals((inconnu.body as any).error, "unknown kind");
  const ancien = await reportProblem(sb, FAIZA as any,
    { listingId: "102", category: "ac", photoId: 55, idem: "idem-prob-0002" }, { push: espionPush().push });
  assertEquals(ancien.status, 400);
  assertEquals((ancien.body as any).error, "unknown kind");
  assertEquals(sb.tables.job_events.length, 0);
});

Deno.test("reportProblem refuse une urgence invalide", async () => {
  const sb = base();
  for (const u of [undefined, "", "high", "URGENT", "constructor"]) {
    const r = await reportProblem(sb, FAIZA as any, corps({ urgency: u }), { push: espionPush().push });
    assertEquals(r.status, 400, String(u));
    assertEquals((r.body as any).error, "invalid urgency");
  }
  assertEquals(sb.tables.maintenance_tickets.length, 0);
});

Deno.test("photo obligatoire sauf gaz, porte et les trois « not working »", async () => {
  const sb = base();
  for (const k of Object.keys(V3_PROBLEM_KINDS)) {
    const r = await reportProblem(sb, FAIZA as any,
      corps({ kind: k, photoId: undefined, idem: "idem-nophoto-" + k.replace(/[^A-Za-z]/g, "") }),
      { push: espionPush().push });
    if (["Gas smell", "Can't get in", "AC not working", "Gas not working",
      "Wi-Fi not working"].includes(k)) {
      assertEquals(r.status, 200, k);
    } else {
      assertEquals(r.status, 400, k);
      assertEquals((r.body as any).error, "photo required");
    }
  }
  assertEquals(sb.tables.maintenance_tickets.length, 5);
  assertEquals(sb.tables.maintenance_tickets.every((t: any) => t.photo_path === null), true);
});

Deno.test("titre, categorie, priorite et description suivent type, urgence, piece et note", async () => {
  const cas: Array<[string, string, string, string]> = [
    ["Leak", "urgent", "plumbing", "urgent"],
    ["AC", "soon", "ac", "medium"],
    ["Stain", "later", "general", "low"],
    ["Gas not working", "soon", "appliance", "medium"],
    ["AC not working", "urgent", "ac", "urgent"],
  ];
  for (const [kind, urgency, cat, prio] of cas) {
    const sb = base();
    const r = await reportProblem(sb, FAIZA as any,
      corps({ kind, urgency, where: "Bedroom 2", note: "  Under the sink\u0007  " }), { push: espionPush().push });
    assertEquals(r.status, 200);
    const t = sb.tables.maintenance_tickets[0];
    assertEquals(t.title, kind + " · Bedroom 2");
    assertEquals(t.category, cat);
    assertEquals(t.priority, prio);
    assertEquals(t.description, "Under the sink");
    assertEquals(t.source, "hk_planner_v3");
    assertEquals(t.reported_by, "Faiza");
    assertEquals(r.body, { status: "success", ticketId: t.id, technicianId: 5, priority: prio, sentTo: "Semax" });
  }
});

Deno.test("reportProblem : piece absente = Whole apartment, note tronquee a 300", async () => {
  const sb = base();
  await reportProblem(sb, FAIZA as any,
    corps({ where: "  ", note: "x".repeat(400) }), { push: espionPush().push });
  const t = sb.tables.maintenance_tickets[0];
  assertEquals(t.title, "Leak · Whole apartment");
  assertEquals(t.description.length, 300);
});

Deno.test("Can't get in sans photo, avant tout startJob, cree un ticket urgent", async () => {
  const sb = base();
  const spy = espionPush();
  const r = await reportProblem(sb, FAIZA as any, {
    jobId: JOB_ID, listingId: "102", kind: "Can't get in", urgency: "urgent",
    where: "Whole apartment", idem: "idem-prob-door",
  }, { push: spy.push });
  assertEquals(r.status, 200);
  assertEquals(sb.tables.maintenance_tickets[0].priority, "urgent");
  assertEquals(spy.envois.length, 2);
  assertEquals(spy.envois.every((e) => e.opts.priority === "urgent"), true);
});

Deno.test("seul un probleme urgent part en push priority urgent", async () => {
  const sb = base();
  const spy = espionPush();
  await reportProblem(sb, FAIZA as any, corps({ urgency: "urgent", idem: "idem-prob-u001" }), { push: spy.push });
  await reportProblem(sb, FAIZA as any, corps({ urgency: "soon", idem: "idem-prob-u002" }), { push: spy.push });
  await reportProblem(sb, FAIZA as any, corps({ urgency: "later", idem: "idem-prob-u003" }), { push: spy.push });
  const urgents = spy.envois.filter((e) => e.opts.priority === "urgent");
  assertEquals(urgents.length, 2); // technicien + manager du premier
  assertEquals(urgents.map((e) => e.cleanerId).sort(), [1, 5]);
  assertEquals(spy.envois.filter((e) => e.opts.priority === undefined).length, 4);
  for (const e of spy.envois) {
    assertEquals(String(e.opts.dedupeKey).startsWith("v3-ticket:"), true);
  }
});

// Heures de silence : on passe par le VRAI sendPush de push.ts, a 23:00 Dubai.
// L'urgent traverse la fenetre (il s'arrete plus loin, faute de cles VAPID dans
// l'environnement de test), le non urgent est filtre par la fenetre elle-meme.
Deno.test("23:00 Dubai : l'urgent traverse les heures de silence, le non urgent est filtre", async () => {
  const NUIT = Date.parse("2026-09-12T19:00:00Z"); // 23:00 a Dubai
  const sb = base();
  const resultats: Array<{ prio: unknown; skipped: string | null }> = [];
  const pushNuit = async (s: any, cid: number, payload: any, opts: any = {}) => {
    const r = await sendPush(s, cid, payload, { ...opts, nowMs: NUIT });
    resultats.push({ prio: opts.priority, skipped: r.skipped });
    return r;
  };
  await reportProblem(sb, FAIZA as any, corps({ urgency: "urgent", idem: "idem-night-001" }), { push: pushNuit });
  await reportProblem(sb, FAIZA as any, corps({ urgency: "soon", idem: "idem-night-002" }), { push: pushNuit });
  const urgents = resultats.filter((r) => r.prio === "urgent");
  const autres = resultats.filter((r) => r.prio !== "urgent");
  assertEquals(urgents.length, 2);
  assertEquals(autres.length, 2);
  assertEquals(urgents.every((r) => r.skipped !== "quiet_hours"), true);
  assertEquals(autres.every((r) => r.skipped === "quiet_hours"), true);
});

Deno.test("reportProblem est idempotent par idem", async () => {
  const sb = base();
  const spy = espionPush();
  const un = await reportProblem(sb, FAIZA as any, corps({ urgency: "urgent" }), { push: spy.push });
  const deux = await reportProblem(sb, FAIZA as any, corps({ urgency: "urgent" }), { push: spy.push });
  assertEquals(deux.body, un.body);
  assertEquals(sb.tables.maintenance_tickets.length, 1);
  assertEquals(spy.envois.length, 2);
});

// ---------------------------------------------------------------------------
// addProblemPhoto
// ---------------------------------------------------------------------------

Deno.test("addProblemPhoto rattache une photo de plus, la principale ne change pas", async () => {
  const sb = base();
  const id = await signale(sb);
  const r = await addProblemPhoto(sb, FAIZA as any, { ticketId: id, photoId: 56, idem: "idem-add-0001" });
  assertEquals(r.status, 200);
  assertEquals(sb.tables.photos.find((p: any) => p.id === 56).ticket_id, id);
  assertEquals(sb.tables.maintenance_tickets[0].photo_path, "v3/2026-09-12/abc.jpg");
  // Rejeu : rien ne bouge, meme reponse.
  const deux = await addProblemPhoto(sb, FAIZA as any, { ticketId: id, photoId: 56, idem: "idem-add-0001" });
  assertEquals(deux.body, r.body);
  assertEquals(sb.tables.job_events.filter((e: any) => e.event_type === "add_problem_photo").length, 1);
});

Deno.test("addProblemPhoto donne la photo principale a un ticket qui n'en a pas", async () => {
  const sb = base();
  const id = await signale(sb, FAIZA, { kind: "Gas smell", urgency: "urgent", photoId: undefined });
  assertEquals(sb.tables.maintenance_tickets[0].photo_path, null);
  sb.tables.job_events.push({
    idem_key: "idem-upl-0001", event_type: "upload_photo", cleaner_id: 3,
    result: { status: "success", photoId: 56, path: "v3/2026-09-12/def.jpg" },
  });
  const r = await addProblemPhoto(sb, FAIZA as any, { ticketId: id, photoIdem: "idem-upl-0001", idem: "idem-add-0002" });
  assertEquals(r.status, 200);
  assertEquals(sb.tables.maintenance_tickets[0].photo_path, "v3/2026-09-12/def.jpg");
});

Deno.test("addProblemPhoto : 403 sur le ticket d'une autre, 400 sur la photo d'une autre", async () => {
  const sb = base();
  const id = await signale(sb);
  const autre = await addProblemPhoto(sb, PIONAH as any, { ticketId: id, photoId: 57, idem: "idem-add-0003" });
  assertEquals(autre.status, 403);
  const photoAutre = await addProblemPhoto(sb, FAIZA as any, { ticketId: id, photoId: 57, idem: "idem-add-0004" });
  assertEquals(photoAutre.status, 400);
  // Une ligne kind='voice' (colonne de la migration, inutilisee) n'est pas une photo.
  const vocal = await addProblemPhoto(sb, FAIZA as any, { ticketId: id, photoId: 60, idem: "idem-add-0005" });
  assertEquals(vocal.status, 400);
  // Aucune cle brulee par un refus.
  assertEquals(sb.tables.job_events.filter((e: any) => e.event_type === "add_problem_photo").length, 0);
  assertEquals(sb.tables.photos.find((p: any) => p.id === 57).ticket_id, null);
});

Deno.test("addProblemPhoto : 403 sur un ticket d'hier ou cree hors de l'app", async () => {
  const sb = base();
  const id = await signale(sb);
  sb.tables.maintenance_tickets[0].created_at = "2026-01-01T08:00:00Z";
  const hier = await addProblemPhoto(sb, FAIZA as any, { ticketId: id, photoId: 56, idem: "idem-add-0006" });
  assertEquals(hier.status, 403);
  sb.tables.maintenance_tickets.push({
    id: 900, title: "Leak · Bathroom", reported_by: "Faiza", source: "desktop",
    status: "open", created_at: new Date().toISOString(),
  });
  const desktop = await addProblemPhoto(sb, FAIZA as any, { ticketId: 900, photoId: 56, idem: "idem-add-0007" });
  assertEquals(desktop.status, 403);
});

// ---------------------------------------------------------------------------
// setProblemNote
// ---------------------------------------------------------------------------

Deno.test("setProblemNote nettoie, borne a 300 et vide vaut null", async () => {
  const sb = base();
  const id = await signale(sb);
  const r = await setProblemNote(sb, FAIZA as any, { ticketId: id, note: " \tDrips\u0000 slowly  ", idem: "idem-note-0001" });
  assertEquals(r.status, 200);
  assertEquals(sb.tables.maintenance_tickets[0].description, "Drips slowly");
  await setProblemNote(sb, FAIZA as any, { ticketId: id, note: "y".repeat(350), idem: "idem-note-0002" });
  assertEquals(sb.tables.maintenance_tickets[0].description.length, 300);
  await setProblemNote(sb, FAIZA as any, { ticketId: id, note: "   ", idem: "idem-note-0003" });
  assertEquals(sb.tables.maintenance_tickets[0].description, null);
  // Rejeu de la premiere cle : ne reecrit pas l'ancienne note.
  const rejeu = await setProblemNote(sb, FAIZA as any, { ticketId: id, note: " \tDrips\u0000 slowly  ", idem: "idem-note-0001" });
  assertEquals(rejeu.body, r.body);
  assertEquals(sb.tables.maintenance_tickets[0].description, null);
});

Deno.test("setProblemNote : 403 pour une autre personne, 400 sans note ni cle", async () => {
  const sb = base();
  const id = await signale(sb);
  assertEquals((await setProblemNote(sb, PIONAH as any, { ticketId: id, note: "x", idem: "idem-note-0004" })).status, 403);
  assertEquals((await setProblemNote(sb, FAIZA as any, { ticketId: id, idem: "idem-note-0005" })).status, 400);
  assertEquals((await setProblemNote(sb, FAIZA as any, { ticketId: id, note: "x" })).status, 400);
  assertEquals(sb.tables.maintenance_tickets[0].description, null);
});

// ---------------------------------------------------------------------------
// updateProblem
// ---------------------------------------------------------------------------

Deno.test("updateProblem change priorite et titre, passage a urgent = push urgent", async () => {
  const sb = base();
  const id = await signale(sb);
  const spy = espionPush();
  const r = await updateProblem(sb, FAIZA as any,
    { ticketId: id, urgency: "urgent", where: "Bathroom 2", idem: "idem-upd-0001" }, { push: spy.push });
  assertEquals(r.status, 200);
  const t = sb.tables.maintenance_tickets[0];
  assertEquals(t.priority, "urgent");
  assertEquals(t.title, "Leak · Bathroom 2");
  assertEquals(spy.envois.map((e) => e.cleanerId).sort(), [1, 5]);
  assertEquals(spy.envois.every((e) => e.opts.priority === "urgent"), true);
  // Rejeu : aucun second push.
  await updateProblem(sb, FAIZA as any,
    { ticketId: id, urgency: "urgent", where: "Bathroom 2", idem: "idem-upd-0001" }, { push: spy.push });
  assertEquals(spy.envois.length, 2);
});

Deno.test("updateProblem sans passage a urgent ne pousse rien", async () => {
  const sb = base();
  const id = await signale(sb, FAIZA, { urgency: "urgent" });
  const spy = espionPush();
  await updateProblem(sb, FAIZA as any, { ticketId: id, where: "Kitchen", idem: "idem-upd-0002" }, { push: spy.push });
  await updateProblem(sb, FAIZA as any, { ticketId: id, urgency: "later", idem: "idem-upd-0003" }, { push: spy.push });
  assertEquals(sb.tables.maintenance_tickets[0].priority, "low");
  assertEquals(sb.tables.maintenance_tickets[0].title, "Leak · Kitchen");
  assertEquals(spy.envois.length, 0);
});

Deno.test("updateProblem : urgence invalide, rien a changer, ticket d'une autre", async () => {
  const sb = base();
  const id = await signale(sb);
  const spy = espionPush();
  assertEquals((await updateProblem(sb, FAIZA as any, { ticketId: id, urgency: "asap", idem: "idem-upd-0004" }, { push: spy.push })).status, 400);
  assertEquals((await updateProblem(sb, FAIZA as any, { ticketId: id, idem: "idem-upd-0005" }, { push: spy.push })).status, 400);
  assertEquals((await updateProblem(sb, PIONAH as any, { ticketId: id, urgency: "urgent", idem: "idem-upd-0006" }, { push: spy.push })).status, 403);
  assertEquals(sb.tables.maintenance_tickets[0].priority, "medium");
  assertEquals(spy.envois.length, 0);
});

// ---------------------------------------------------------------------------
// deleteProblem
// ---------------------------------------------------------------------------

Deno.test("deleteProblem annule le ticket du jour de la meme personne, idempotent", async () => {
  const sb = base();
  const id = await signale(sb);
  const r = await deleteProblem(sb, FAIZA as any, { ticketId: id, idem: "idem-del-0001" });
  assertEquals(r.status, 200);
  assertEquals(sb.tables.maintenance_tickets[0].status, "cancelled");
  const deux = await deleteProblem(sb, FAIZA as any, { ticketId: id, idem: "idem-del-0001" });
  assertEquals(deux.body, r.body);
  assertEquals(sb.tables.job_events.filter((e: any) => e.event_type === "delete_problem").length, 1);
});

Deno.test("deleteProblem : 403 pour une autre personne ou un ticket d'hier", async () => {
  const sb = base();
  const id = await signale(sb);
  assertEquals((await deleteProblem(sb, PIONAH as any, { ticketId: id, idem: "idem-del-0002" })).status, 403);
  sb.tables.maintenance_tickets[0].created_at = "2026-01-01T08:00:00Z";
  assertEquals((await deleteProblem(sb, FAIZA as any, { ticketId: id, idem: "idem-del-0003" })).status, 403);
  assertEquals(sb.tables.maintenance_tickets[0].status, "assigned");
  assertEquals(sb.tables.job_events.filter((e: any) => e.event_type === "delete_problem").length, 0);
});

Deno.test("deleteProblem refuse un ticket deja resolu, rend 400 sur un ticket inconnu", async () => {
  const sb = base();
  const id = await signale(sb);
  sb.tables.maintenance_tickets[0].status = "resolved";
  assertEquals((await deleteProblem(sb, FAIZA as any, { ticketId: id, idem: "idem-del-0004" })).status, 400);
  assertEquals((await deleteProblem(sb, FAIZA as any, { ticketId: 4242, idem: "idem-del-0005" })).status, 400);
  assertEquals(sb.tables.maintenance_tickets[0].status, "resolved");
});

Deno.test("les gestes sur un ticket rendent 409 quand la cle est posee sans resultat", async () => {
  const sb = base();
  const id = await signale(sb);
  for (const [type, idem] of [["delete_problem", "idem-409-del"], ["set_problem_note", "idem-409-note"]]) {
    sb.tables.job_events.push({ idem_key: idem, event_type: type, cleaner_id: 3, result: null });
  }
  assertEquals((await deleteProblem(sb, FAIZA as any, { ticketId: id, idem: "idem-409-del" })).status, 409);
  assertEquals((await setProblemNote(sb, FAIZA as any, { ticketId: id, note: "x", idem: "idem-409-note" })).status, 409);
  assertEquals(sb.tables.maintenance_tickets[0].status, "assigned");
});

// ---------------------------------------------------------------------------
// Maintenance phase 3 : le signalement dit a qui il est parti
// ---------------------------------------------------------------------------

Deno.test("reportProblem rend sentTo, le nom du technicien assigne a la creation", async () => {
  const sb = base();
  const r = await reportProblem(sb, FAIZA as any, corps({ idem: "idem-sent-0001" }), { push: espionPush().push });
  assertEquals(r.status, 200);
  assertEquals((r.body as any).sentTo, "Semax");
  // Le rejeu rend la meme reponse, sentTo compris.
  const encore = await reportProblem(sb, FAIZA as any, corps({ idem: "idem-sent-0001" }), { push: espionPush().push });
  assertEquals((encore.body as any).sentTo, "Semax");
});

Deno.test("reportProblem rend sentTo null quand personne n'est de permanence", async () => {
  const sb = base();
  sb.tables.cleaners = [{ id: 1, name: "Walter", role: "manager", is_active: true }];
  const r = await reportProblem(sb, FAIZA as any, corps({ idem: "idem-sent-0002" }), { push: espionPush().push });
  assertEquals(r.status, 200);
  assertEquals((r.body as any).sentTo, null);
});
