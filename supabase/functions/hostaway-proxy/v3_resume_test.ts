// Branchement 2026-10-05, tache 5 (ecritures du front, hors ligne et reprise) :
//   - v3.myDay rend, par arret, le role lead / aide calcule avec la regle de
//     v3.finishJob (jobRole), pour que le telephone soit d'accord avec le serveur
//     apres un rechargement ;
//   - les gestes sur un probleme acceptent `ticketIdem` (la cle du signalement)
//     a la place de `ticketId` : un probleme cree hors ligne peut recevoir ses
//     photos et sa note en file avant que l'id du ticket soit connu.
import { assertEquals } from "jsr:@std/assert@1";
import { fakeDb } from "./v3_fakedb.ts";
import { jobKeyFor } from "./v3.ts";
import { buildMyDay } from "./v3_myday.ts";
import { jobRole } from "./v3_write.ts";
import { deletePhoto } from "./v3_photos.ts";
import {
  addProblemPhoto, deleteProblem, reportProblem, setProblemNote, updateProblem,
} from "./v3_tickets.ts";

const FAIZA = { cleaner_id: 3, name: "Faiza", role: "cleaner", color: "#e94560" };
const PIONAH = { cleaner_id: 4, name: "Pionah", role: "cleaner", color: "#3366ff" };
const CLE = "2026-09-12_Marc Lefevre";

// ---------------------------------------------------------------------------
// Role dans v3.myDay
// ---------------------------------------------------------------------------

function jour(jobEvents: any[]) {
  return {
    sb: fakeDb({
      v3_job_keys: [], job_events: jobEvents,
      cleaning_assignments: [
        { reservation_key: CLE, cleaner_id: 3 }, { reservation_key: CLE, cleaner_id: 4 },
      ],
      cleaners: [{ id: 3, name: "Faiza" }, { id: 4, name: "Pionah" }],
    }),
    date: "2026-09-12",
    me: FAIZA,
    reservations: [{
      listingId: "102", listing: "623 Samana Park View", guest: "Marc Lefevre",
      checkOut: "2026-09-12", checkOutTime: 12, nextGuest: null,
    }],
    extras: [],
    listings: { "102": { listing_id: "102", internal_name: "623 Samana Park View", unit_type: "1 BHK" } },
    templates: [], assignedKeys: [CLE], postponed: {}, cancelled: [], done: [],
    timers: {}, tickets: [], progress: {},
  };
}

const depart = (id: number, job: string, qui: number, quand: string, ok = true) => ({
  id, idem_key: "k-start-" + String(id).padStart(8, "0"), event_type: "start_job", job_id: job,
  cleaner_id: qui, result: ok ? { status: "success" } : null, created_at: quand,
});

Deno.test("myDay : role, lead et mon demarrage suivent exactement jobRole", async () => {
  const job = await jobKeyFor(CLE);
  const cas: Array<{ nom: string; evts: any[]; attendu: any }> = [
    { nom: "personne n'a demarre", evts: [], attendu: { role: "lead", leadId: null, myStartedAt: null } },
    {
      nom: "j'ai demarre la premiere",
      evts: [depart(1, job, 3, "2026-09-12T08:00:00Z"), depart(2, job, 4, "2026-09-12T08:10:00Z")],
      attendu: { role: "lead", leadId: 3, myStartedAt: "2026-09-12T08:00:00Z" },
    },
    {
      nom: "Pionah a demarre avant moi",
      evts: [depart(1, job, 4, "2026-09-12T07:50:00Z"), depart(2, job, 3, "2026-09-12T08:00:00Z")],
      attendu: { role: "helper", leadId: 4, myStartedAt: "2026-09-12T08:00:00Z" },
    },
    {
      nom: "Pionah a demarre, moi jamais",
      evts: [depart(1, job, 4, "2026-09-12T07:50:00Z")],
      attendu: { role: "helper", leadId: 4, myStartedAt: null },
    },
    {
      nom: "cle posee sans resultat : pas un demarrage",
      evts: [depart(1, job, 4, "2026-09-12T07:00:00Z", false), depart(2, job, 3, "2026-09-12T08:00:00Z")],
      attendu: { role: "lead", leadId: 3, myStartedAt: "2026-09-12T08:00:00Z" },
    },
    {
      // Quelqu'un qui n'est pas dans othersOnJob (non assigne) compte aussi.
      nom: "demarrage d'une personne non assignee",
      evts: [depart(1, job, 9, "2026-09-12T07:00:00Z"), depart(2, job, 3, "2026-09-12T08:00:00Z")],
      attendu: { role: "helper", leadId: 9, myStartedAt: "2026-09-12T08:00:00Z" },
    },
    {
      nom: "meme seconde : l'id departage",
      evts: [depart(5, job, 3, "2026-09-12T08:00:00Z"), depart(4, job, 4, "2026-09-12T08:00:00Z")],
      attendu: { role: "helper", leadId: 4, myStartedAt: "2026-09-12T08:00:00Z" },
    },
  ];
  for (const c of cas) {
    const input = jour(c.evts);
    const out = await buildMyDay(input as any);
    const s = out.stops[0] as any;
    assertEquals({ role: s.role, leadId: s.leadId, myStartedAt: s.myStartedAt }, c.attendu, c.nom);
    assertEquals(s.role, await jobRole(input.sb, job, FAIZA.cleaner_id), c.nom + " (jobRole)");
  }
});

Deno.test("myDay : une lecture des roles ratee rend role null, la journee s'ouvre", async () => {
  const input = jour([]);
  (input.sb as any).fail["job_events.select"] = { message: "boom" };
  const out = await buildMyDay(input as any);
  const s = out.stops[0] as any;
  assertEquals([s.role, s.leadId, s.myStartedAt], [null, null, null]);
});

// ---------------------------------------------------------------------------
// ticketIdem
// ---------------------------------------------------------------------------

const JOB_ID = "job_1a2b3c4d5e6f70819a2b";
const pasDePush = async () => ({ sent: 0, pruned: 0, skipped: null });

function base() {
  return fakeDb({
    v3_job_keys: [{ job_id: JOB_ID, reservation_key: CLE }],
    job_events: [],
    photos: [
      { id: 55, storage_path: "v3/2026-09-12/abc.jpg", job_id: null, ticket_id: null, cleaner_id: 3 },
      { id: 56, storage_path: "v3/2026-09-12/def.jpg", job_id: null, ticket_id: null, cleaner_id: 3 },
    ],
    maintenance_tickets: [], maintenance_sla: [], cleaning_log: [], on_duty: [],
    cleaners: [{ id: 5, name: "Semax", role: "maintenance", is_active: true }],
  });
}

const REPORT_IDEM = "idem-report-0001";

async function signale(sb: any, me: any = FAIZA): Promise<number> {
  const r = await reportProblem(sb, me, {
    jobId: JOB_ID, listingId: "102", kind: "Leak", urgency: "soon", where: "Bathroom",
    photoId: 55, idem: REPORT_IDEM,
  }, { push: pasDePush });
  assertEquals(r.status, 200);
  return Number((r.body as any).ticketId);
}

Deno.test("ticketIdem : photo, note, urgence et annulation trouvent le ticket par la cle du signalement", async () => {
  const sb = base();
  const ticketId = await signale(sb);
  const photo = await addProblemPhoto(sb, FAIZA, { ticketIdem: REPORT_IDEM, photoId: 56, idem: "idem-addp-0001" });
  assertEquals(photo.status, 200);
  assertEquals((photo.body as any).ticketId, ticketId);
  assertEquals(sb.tables.photos.find((p: any) => p.id === 56).ticket_id, ticketId);
  const note = await setProblemNote(sb, FAIZA, { ticketIdem: REPORT_IDEM, note: "under the sink", idem: "idem-note-0001" });
  assertEquals(note.status, 200);
  assertEquals(sb.tables.maintenance_tickets[0].description, "under the sink");
  const maj = await updateProblem(sb, FAIZA, { ticketIdem: REPORT_IDEM, urgency: "later", idem: "idem-updt-0001" },
    { push: pasDePush });
  assertEquals(maj.status, 200);
  assertEquals(sb.tables.maintenance_tickets[0].priority, "low");
  const sup = await deleteProblem(sb, FAIZA, { ticketIdem: REPORT_IDEM, idem: "idem-dele-0001" });
  assertEquals(sup.status, 200);
  assertEquals(sb.tables.maintenance_tickets[0].status, "cancelled");
});

Deno.test("ticketIdem : ticketId gagne quand les deux sont presents", async () => {
  const sb = base();
  const ticketId = await signale(sb);
  const r = await setProblemNote(sb, FAIZA, {
    ticketId, ticketIdem: "idem-inconnue-0001", note: "x", idem: "idem-note-0002",
  });
  assertEquals(r.status, 200);
});

Deno.test("ticketIdem : la cle d'une autre personne ne designe rien", async () => {
  const sb = base();
  await signale(sb, FAIZA);
  const r = await setProblemNote(sb, PIONAH, { ticketIdem: REPORT_IDEM, note: "x", idem: "idem-note-0003" });
  assertEquals(r.status, 400);
  assertEquals((r.body as any).error, "ticket not found");
  // Refus avant la pose de la cle : le rejeu n'est pas bloque.
  assertEquals(sb.tables.job_events.some((e: any) => e.idem_key === "idem-note-0003"), false);
});

Deno.test("ticketIdem : cle inconnue -> 400, signalement pose sans resultat -> 409 (rejouer plus tard)", async () => {
  const sb = base();
  const inconnue = await addProblemPhoto(sb, FAIZA, { ticketIdem: "idem-jamais-vue1", photoId: 56, idem: "idem-addp-0002" });
  assertEquals(inconnue.status, 400);
  sb.tables.job_events.push({
    id: 1, idem_key: "idem-encours-0001", event_type: "report_problem", job_id: JOB_ID,
    cleaner_id: 3, result: null,
  });
  const enCours = await addProblemPhoto(sb, FAIZA, { ticketIdem: "idem-encours-0001", photoId: 56, idem: "idem-addp-0003" });
  assertEquals(enCours.status, 409);
});

Deno.test("ticketIdem : une cle d'un autre geste (pas un signalement) ne designe rien", async () => {
  const sb = base();
  await signale(sb);
  const r = await deleteProblem(sb, FAIZA, { ticketIdem: "idem-note-0009", idem: "idem-dele-0002" });
  assertEquals(r.status, 400);
  await setProblemNote(sb, FAIZA, { ticketIdem: REPORT_IDEM, note: "x", idem: "idem-note-0009" });
  const r2 = await deleteProblem(sb, FAIZA, { ticketIdem: "idem-note-0009", idem: "idem-dele-0003" });
  assertEquals(r2.status, 400);
});

Deno.test("ticketIdem invalide et ticketId absent : 400 ticketId required", async () => {
  const sb = base();
  const r = await setProblemNote(sb, FAIZA, { ticketIdem: "x", note: "x", idem: "idem-note-0004" });
  assertEquals(r.status, 400);
  assertEquals((r.body as any).error, "ticketId required");
});

// ---------------------------------------------------------------------------
// deletePhoto par photoIdem
// ---------------------------------------------------------------------------

function avecTeleversement(result: any, qui = 3) {
  const sb = base();
  sb.tables.job_events.push({
    id: 1, idem_key: "idem-upload-0001", event_type: "upload_photo", job_id: JOB_ID,
    cleaner_id: qui, result,
  });
  sb.storage.uploads.push({ bucket: "cleaning-photos", path: "v3/2026-09-12/abc.jpg", bytes: 3, contentType: "image/jpeg" });
  return sb;
}

Deno.test("deletePhoto : photoIdem designe la photo televersee par la meme personne", async () => {
  const sb = avecTeleversement({ status: "success", photoId: 55 });
  const r = await deletePhoto(sb, FAIZA as any, { photoIdem: "idem-upload-0001", idem: "idem-delp-0001" });
  assertEquals(r.status, 200);
  assertEquals((r.body as any).photoId, 55);
  assertEquals(sb.tables.photos.some((p: any) => p.id === 55), false);
});

Deno.test("deletePhoto : photoIdem d'un televersement en cours -> 409 ; jamais arrive -> 200 sans rien toucher", async () => {
  const enCours = avecTeleversement(null);
  assertEquals((await deletePhoto(enCours, FAIZA as any, { photoIdem: "idem-upload-0001", idem: "idem-delp-0002" })).status, 409);
  const jamais = base();
  const r = await deletePhoto(jamais, FAIZA as any, { photoIdem: "idem-upload-0009", idem: "idem-delp-0003" });
  assertEquals(r.status, 200);
  assertEquals((r.body as any).photoId, null);
  assertEquals(jamais.tables.photos.length, 2);
});

Deno.test("deletePhoto : photoIdem d'une autre personne ne designe rien", async () => {
  const sb = avecTeleversement({ status: "success", photoId: 55 }, 4);
  const r = await deletePhoto(sb, FAIZA as any, { photoIdem: "idem-upload-0001", idem: "idem-delp-0004" });
  assertEquals(r.status, 200);
  assertEquals((r.body as any).photoId, null);
  assertEquals(sb.tables.photos.some((p: any) => p.id === 55), true);
});
