import { assertEquals } from "jsr:@std/assert@1";
import { fakeDb } from "./v3_fakedb.ts";
import {
  checkTicket, reportProblem, uploadPhoto, V3_MAX_PHOTO_BYTES,
} from "./v3_tickets.ts";

const FAIZA = { cleaner_id: 3, name: "Faiza", role: "cleaner", color: "#e94560" };
const JOB = "2026-09-12_Marc Lefevre";
// Identifiant oppose rendu par v3.myDay : c'est lui, et jamais la
// reservation_key, que le telephone envoie (revue tache 3, constat 5).
const JOB_ID = "job_1a2b3c4d5e6f70819a2b";
const LIEN = { job_id: JOB_ID, reservation_key: JOB };

function base(seed: Record<string, any[]> = {}) {
  return fakeDb({ v3_job_keys: [LIEN], ...seed });
}

function formulaire(champs: Record<string, string>, octets = 64, type = "image/jpeg") {
  const form = new FormData();
  for (const [k, v] of Object.entries(champs)) form.set(k, v);
  form.set("file", new Blob([new Uint8Array(octets)], { type }), "photo.jpg");
  return form;
}

Deno.test("uploadPhoto depose dans le bucket prive et insere la ligne photos", async () => {
  const sb = base({ job_events: [], photos: [] });
  const r = await uploadPhoto(sb, FAIZA as any, formulaire({ idem: "idem-photo-0001", jobId: JOB_ID }));
  assertEquals(r.status, 200);
  const corps = r.body as any;
  assertEquals(typeof corps.photoId, "number");
  assertEquals(sb.storage.uploads.length, 1);
  assertEquals(sb.storage.uploads[0].bucket, "cleaning-photos");
  assertEquals(sb.storage.uploads[0].contentType, "image/jpeg");
  assertEquals(sb.tables.photos.length, 1);
  assertEquals(sb.tables.photos[0].job_id, JOB_ID);
  assertEquals(sb.tables.photos[0].cleaner_id, 3);
});

Deno.test("le chemin de stockage ne contient jamais le nom du guest", async () => {
  const sb = base({ job_events: [], photos: [] });
  const r = await uploadPhoto(sb, FAIZA as any, formulaire({ idem: "idem-photo-0002", jobId: JOB_ID }));
  const chemin = (r.body as any).path as string;
  assertEquals(chemin.startsWith("v3/"), true);
  assertEquals(chemin.includes("Marc"), false);
  assertEquals(chemin.includes("Lefevre"), false);
  assertEquals(chemin.endsWith(".jpg"), true);
});

Deno.test("uploadPhoto est idempotent : meme cle, meme photoId, un seul depot", async () => {
  const sb = base({ job_events: [], photos: [] });
  const form1 = formulaire({ idem: "idem-photo-0003", jobId: JOB_ID });
  const form2 = formulaire({ idem: "idem-photo-0003", jobId: JOB_ID });
  const un = await uploadPhoto(sb, FAIZA as any, form1);
  const deux = await uploadPhoto(sb, FAIZA as any, form2);
  assertEquals((deux.body as any).photoId, (un.body as any).photoId);
  assertEquals(sb.storage.uploads.length, 1);
  assertEquals(sb.tables.photos.length, 1);
});

// Ruling du controleur (revue de la tache 2, applique par la tache 4) : un rejeu
// dont l'ecriture metier n'a jamais abouti ne rend JAMAIS un succes fabrique.
// Sans ce 409 le telephone effacerait de sa file une photo jamais deposee.
Deno.test("uploadPhoto rend 409 quand la cle est posee sans resultat", async () => {
  const sb = base({
    job_events: [{
      id: 1, idem_key: "idem-photo-0009", event_type: "upload_photo", job_id: JOB_ID,
      cleaner_id: 3, payload: {}, result: null, created_at: "2026-09-12T06:00:00Z",
    }],
    photos: [],
  });
  const r = await uploadPhoto(sb, FAIZA as any, formulaire({ idem: "idem-photo-0009", jobId: JOB_ID }));
  assertEquals(r.status, 409);
  assertEquals((r.body as any).error, "Still processing. Retry.");
  assertEquals(sb.storage.uploads.length, 0);
  assertEquals(sb.tables.photos.length, 0);
  assertEquals(sb.tables.job_events.length, 1);
});

Deno.test("uploadPhoto refuse un type non image et un fichier trop gros", async () => {
  const sb = base({ job_events: [], photos: [] });
  const pdf = await uploadPhoto(sb, FAIZA as any,
    formulaire({ idem: "idem-photo-0004", jobId: JOB_ID }, 64, "application/pdf"));
  assertEquals(pdf.status, 400);
  const gros = await uploadPhoto(sb, FAIZA as any,
    formulaire({ idem: "idem-photo-0005", jobId: JOB_ID }, V3_MAX_PHOTO_BYTES + 1));
  assertEquals(gros.status, 413);
  assertEquals(sb.storage.uploads.length, 0);
  assertEquals(sb.tables.job_events.length, 0);
});

Deno.test("uploadPhoto exige une cle d'idempotence et une cible", async () => {
  const sb = base({ job_events: [], photos: [] });
  assertEquals((await uploadPhoto(sb, FAIZA as any, formulaire({ jobId: JOB_ID }))).status, 400);
  assertEquals((await uploadPhoto(sb, FAIZA as any, formulaire({ idem: "idem-photo-0006" }))).status, 400);
});

Deno.test("uploadPhoto libere la cle si le depot echoue, et n'insere rien", async () => {
  const sb = base({ job_events: [], photos: [] });
  sb.fail["storage.upload"] = { message: "bucket down" };
  let leve = false;
  try {
    await uploadPhoto(sb, FAIZA as any, formulaire({ idem: "idem-photo-0007", jobId: JOB_ID }));
  } catch (_e) {
    leve = true;
  }
  assertEquals(leve, true);
  assertEquals(sb.tables.photos.length, 0);
  assertEquals(sb.tables.job_events.length, 0);
});

// Revue tache 5, constatation 1 : le depot et l'insert ne sont pas atomiques.
// L'ordre choisi (fichier d'abord, ligne ensuite) garantit qu'aucune ligne photos
// ne pointe sur du vide ; ce test verrouille l'autre moitie, l'objet depose est
// retire quand la ligne ne suit pas, sinon le rejeu en deposerait un second.
Deno.test("uploadPhoto retire du bucket l'objet depose quand l'insert photos echoue", async () => {
  const sb = base({ job_events: [], photos: [] });
  sb.fail["photos.insert"] = { message: "db down" };
  let leve = false;
  try {
    await uploadPhoto(sb, FAIZA as any, formulaire({ idem: "idem-photo-0008", jobId: JOB_ID }));
  } catch (_e) {
    leve = true;
  }
  assertEquals(leve, true);
  assertEquals(sb.storage.removals.length, 1);
  assertEquals(sb.storage.removals[0].bucket, "cleaning-photos");
  assertEquals(sb.storage.removals[0].paths.length, 1);
  assertEquals(sb.storage.removals[0].paths[0].startsWith("v3/"), true);
  // Le bucket est revenu a l'etat d'avant, la cle est libre, rien en base.
  assertEquals(sb.storage.uploads.length, 0);
  assertEquals(sb.tables.photos.length, 0);
  assertEquals(sb.tables.job_events.length, 0);
});

// Un nettoyage impossible ne doit jamais masquer l'erreur d'origine : l'action
// leve quand meme, et la cle reste liberee pour que le telephone rejoue.
Deno.test("un nettoyage de bucket rate ne masque pas l'erreur d'origine", async () => {
  const sb = base({ job_events: [], photos: [] });
  sb.fail["photos.insert"] = { message: "db down" };
  sb.fail["storage.remove"] = { message: "storage down" };
  let leve = false;
  try {
    await uploadPhoto(sb, FAIZA as any, formulaire({ idem: "idem-photo-0010", jobId: JOB_ID }));
  } catch (_e) {
    leve = true;
  }
  assertEquals(leve, true);
  assertEquals(sb.tables.job_events.length, 0);
});

// Revue tache 5, constatation 4 : un ticketId illisible partait en NaN, que
// supabase-js serialise en null, donc le lien vers le ticket sautait en silence.
Deno.test("uploadPhoto refuse un ticketId qui n'est pas un entier positif", async () => {
  const sb = base({ job_events: [], photos: [] });
  for (const mauvais of ["abc", "12.5", "-3", "0"]) {
    const r = await uploadPhoto(sb, FAIZA as any,
      formulaire({ idem: "idem-photo-0011", jobId: JOB_ID, ticketId: mauvais }));
    assertEquals(r.status, 400);
    assertEquals((r.body as any).error, "ticketId must be a number");
  }
  // Refus avant la pose de la cle : le telephone peut rejouer la meme cle corrigee.
  assertEquals(sb.tables.job_events.length, 0);
  assertEquals(sb.storage.uploads.length, 0);
  // Un ticketId valide passe, et il est ecrit tel quel.
  const ok = await uploadPhoto(sb, FAIZA as any,
    formulaire({ idem: "idem-photo-0012", jobId: JOB_ID, ticketId: "71" }));
  assertEquals(ok.status, 200);
  assertEquals(sb.tables.photos[0].ticket_id, 71);
});

// jobId est un identifiant oppose, donc du texte : la symetrie avec ticketId porte
// sur le type attendu, pas sur la forme. Une partie qui n'est pas du texte ne
// doit pas finir stringifiee en « [object File] » dans photos.job_id.
Deno.test("uploadPhoto refuse un jobId qui n'est pas du texte", async () => {
  const sb = base({ job_events: [], photos: [] });
  const form = new FormData();
  form.set("idem", "idem-photo-0013");
  form.set("jobId", new Blob([new Uint8Array(8)], { type: "image/jpeg" }), "jobid.jpg");
  form.set("file", new Blob([new Uint8Array(64)], { type: "image/jpeg" }), "photo.jpg");
  const r = await uploadPhoto(sb, FAIZA as any, form);
  assertEquals(r.status, 400);
  assertEquals((r.body as any).error, "jobId must be text");
  assertEquals(sb.tables.job_events.length, 0);
});

// ===========================================================================
// Tache 6 : v3.reportProblem et v3.checkTicket
// ===========================================================================

// L'envoi de push est injecte pour que les tests observent qui est prevenu sans
// dependre des secrets VAPID ni des heures de silence de push.ts.
function espionPush() {
  const envois: Array<{ cleanerId: number; payload: any; opts: any }> = [];
  const push = async (_sb: any, cleanerId: number, payload: any, opts: any = {}) => {
    envois.push({ cleanerId, payload, opts });
    return { sent: 1, pruned: 0, skipped: null };
  };
  return { envois, push };
}

function baseTickets() {
  return base({
    job_events: [],
    photos: [{ id: 55, storage_path: "v3/2026-09-12/abc.jpg", job_id: null, ticket_id: null, cleaner_id: 3 }],
    maintenance_tickets: [],
    maintenance_sla: [{ category: "ac", priority: "medium", max_hours: 24 }],
    ticket_comments: [],
    cleaning_log: [],
    on_duty: [],
    cleaners: [
      { id: 5, name: "Semax", role: "maintenance", is_active: true },
      { id: 6, name: "Ismael", role: "maintenance", is_active: true },
      { id: 1, name: "Walter", role: "manager", is_active: true },
    ],
  });
}

Deno.test("reportProblem cree le ticket, l'assigne a la permanence et pousse", async () => {
  const sb = baseTickets();
  const spy = espionPush();
  const r = await reportProblem(sb, FAIZA as any, {
    jobId: JOB_ID, listingId: "102", category: "ac", photoId: 55,
    note: "Bedroom unit stops after 10 minutes", idem: "idem-report-0001",
  }, { push: spy.push });
  assertEquals(r.status, 200);
  assertEquals(sb.tables.maintenance_tickets.length, 1);
  const ticket = sb.tables.maintenance_tickets[0];
  assertEquals(ticket.listing_id, "102");
  assertEquals(ticket.category, "ac");
  assertEquals(ticket.status, "assigned");
  assertEquals(ticket.assigned_technician_id, 5);
  assertEquals(ticket.source, "hk_planner_v3");
  // source_ref garde la CLE interne : c'est la seule colonne qui rend le ticket
  // rattachable au menage pour un manager ou un technicien, cote desktop. Rien de
  // maintenance_tickets n'est jamais renvoye a une cleaner hormis id, titre,
  // categorie et priorite (voir la lecture de v3.myDay).
  assertEquals(ticket.source_ref, JOB);
  assertEquals(ticket.photo_path, "v3/2026-09-12/abc.jpg");
  assertEquals(sb.tables.photos[0].ticket_id, ticket.id);
  // Le technicien de permanence et le manager sont prevenus.
  assertEquals(spy.envois.map((e) => e.cleanerId).sort(), [1, 5]);
  assertEquals(spy.envois[0].payload.title, "AC problem reported");
  assertEquals(spy.envois[0].payload.body.includes("Faiza"), true);
});

// Un signalement n'est jamais urgent par defaut : les heures de silence de
// push.ts (22h00 a 08h30 Dubai) ne laissent passer que l'urgent, et une panne
// constatee pendant un menage n'a pas a reveiller la permanence la nuit.
Deno.test("reportProblem ne fabrique jamais une priorite urgente", async () => {
  const sb = baseTickets();
  const spy = espionPush();
  await reportProblem(sb, FAIZA as any, {
    jobId: JOB_ID, listingId: "102", category: "ac", photoId: 55,
    priority: "urgent", idem: "idem-report-0100",
  }, { push: spy.push });
  assertEquals(sb.tables.maintenance_tickets[0].priority, "medium");
  assertEquals(spy.envois.every((e) => e.opts.priority === undefined), true);
});

Deno.test("reportProblem exige une photo, une categorie connue et un logement", async () => {
  const sb = baseTickets();
  const spy = espionPush();
  const sansPhoto = await reportProblem(sb, FAIZA as any,
    { jobId: JOB_ID, listingId: "102", category: "ac", idem: "idem-report-0002" }, { push: spy.push });
  assertEquals(sansPhoto.status, 400);
  const mauvaiseCat = await reportProblem(sb, FAIZA as any,
    { jobId: JOB_ID, listingId: "102", category: "volcan", photoId: 55, idem: "idem-report-0003" }, { push: spy.push });
  assertEquals(mauvaiseCat.status, 400);
  const sansLogement = await reportProblem(sb, FAIZA as any,
    { jobId: JOB_ID, category: "ac", photoId: 55, idem: "idem-report-0004" }, { push: spy.push });
  assertEquals(sansLogement.status, 400);
  assertEquals(sb.tables.maintenance_tickets.length, 0);
  assertEquals(spy.envois.length, 0);
});

Deno.test("reportProblem rejoue sans creer un second ticket", async () => {
  const sb = baseTickets();
  const spy = espionPush();
  const corps = {
    jobId: JOB_ID, listingId: "102", category: "plumbing", photoId: 55, idem: "idem-report-0005",
  };
  const un = await reportProblem(sb, FAIZA as any, corps, { push: spy.push });
  const deux = await reportProblem(sb, FAIZA as any, corps, { push: spy.push });
  assertEquals((deux.body as any).ticketId, (un.body as any).ticketId);
  assertEquals(sb.tables.maintenance_tickets.length, 1);
  assertEquals(spy.envois.length, 2); // un envoi par destinataire, une seule fois
});

// Ruling du controleur (revue de la tache 2, applique par les taches 4 et 5) :
// un rejeu dont l'ecriture metier n'a jamais abouti ne rend JAMAIS un succes
// fabrique, sinon le telephone efface de sa file un signalement sans ticket.
Deno.test("reportProblem rend 409 quand la cle est posee sans resultat", async () => {
  const sb = baseTickets();
  sb.tables.job_events.push({
    id: 1, idem_key: "idem-report-0409", event_type: "report_problem", job_id: JOB_ID,
    cleaner_id: 3, payload: {}, result: null, created_at: "2026-09-12T06:00:00Z",
  });
  const spy = espionPush();
  const r = await reportProblem(sb, FAIZA as any, {
    jobId: JOB_ID, listingId: "102", category: "ac", photoId: 55, idem: "idem-report-0409",
  }, { push: spy.push });
  assertEquals(r.status, 409);
  assertEquals((r.body as any).error, "Still processing. Retry.");
  assertEquals(sb.tables.maintenance_tickets.length, 0);
  assertEquals(spy.envois.length, 0);
});

Deno.test("reportProblem reste ouvert quand aucun technicien n'est disponible", async () => {
  const sb = base({
    job_events: [], maintenance_tickets: [], maintenance_sla: [], ticket_comments: [], cleaning_log: [],
    on_duty: [], cleaners: [{ id: 1, name: "Walter", role: "manager", is_active: true }],
    photos: [{ id: 55, storage_path: "v3/2026-09-12/abc.jpg", job_id: null, ticket_id: null, cleaner_id: 3 }],
  });
  const spy = espionPush();
  const r = await reportProblem(sb, FAIZA as any, {
    jobId: JOB_ID, listingId: "102", category: "other", photoId: 55, idem: "idem-report-0006",
  }, { push: spy.push });
  assertEquals(r.status, 200);
  assertEquals(sb.tables.maintenance_tickets[0].status, "open");
  assertEquals(sb.tables.maintenance_tickets[0].category, "general");
  assertEquals((r.body as any).technicianId, null);
  assertEquals(spy.envois.map((e) => e.cleanerId), [1]);
});

Deno.test("checkTicket passe le ticket en to_confirm avec la photo de preuve", async () => {
  const sb = baseTickets();
  sb.tables.maintenance_tickets.push({
    id: 71, listing_id: "102", title: "Photo of the DEWA bill", status: "open",
    category: "general", priority: "urgent",
  });
  const r = await checkTicket(sb, FAIZA as any, { ticketId: 71, photoId: 55, idem: "idem-check-0001" });
  assertEquals(r.status, 200);
  const ticket = sb.tables.maintenance_tickets.find((t: any) => t.id === 71);
  assertEquals(ticket.status, "to_confirm");
  assertEquals(ticket.resolution_photo_path, "v3/2026-09-12/abc.jpg");
  assertEquals(sb.tables.photos[0].ticket_id, 71);
  // La colonne booleenne to_confirm (flux Gemini a relire) n'a rien a voir avec
  // la valeur de statut : la v3 ne l'ecrit jamais.
  assertEquals(ticket.to_confirm, undefined);
  // Le commentaire passe par ticket_comments, jamais par resolution_notes : un
  // « [horodatage] texte » sur un ticket non resolu est intercepte par un trigger.
  assertEquals(sb.tables.ticket_comments.length, 1);
  assertEquals(sb.tables.ticket_comments[0].author, "Faiza");
  assertEquals(sb.writes.some((w) => w.table === "maintenance_tickets" &&
    w.op === "update" && "resolution_notes" in (w.values ?? {})), false);
  assertEquals(sb.writes.some((w) => w.table === "maintenance_tickets" &&
    w.op === "update" && "to_confirm" in (w.values ?? {})), false);
});

Deno.test("reportProblem retrouve la photo par la cle de son televersement", async () => {
  const sb = baseTickets();
  // Ce que la file hors ligne a laisse derriere elle : le televersement rejoue
  // d'abord, avec son resultat memorise.
  sb.tables.job_events.push({
    idem_key: "idem-photo-9000", event_type: "upload_photo",
    result: { status: "success", photoId: 55, path: "v3/2026-09-12/abc.jpg" },
  });
  const spy = espionPush();
  const r = await reportProblem(sb, FAIZA as any, {
    jobId: JOB_ID, listingId: "102", category: "pest", photoIdem: "idem-photo-9000",
    idem: "idem-report-0007",
  }, { push: spy.push });
  assertEquals(r.status, 200);
  assertEquals(sb.tables.maintenance_tickets[0].photo_path, "v3/2026-09-12/abc.jpg");
});

Deno.test("un signalement dont la photo n'est pas retrouvee ne brule pas sa cle", async () => {
  const sb = baseTickets();
  const spy = espionPush();
  const r = await reportProblem(sb, FAIZA as any, {
    jobId: JOB_ID, listingId: "102", category: "pest", photoIdem: "idem-photo-9999",
    idem: "idem-report-0008",
  }, { push: spy.push });
  assertEquals(r.status, 400);
  assertEquals(sb.tables.job_events.length, 0);
  assertEquals(sb.tables.maintenance_tickets.length, 0);
});

// La cle est posee AVANT la lecture de la photo. Si la photo n'existe pas (elle a
// ete supprimee, ou l'identifiant vient d'un vieux telephone), le refus doit
// liberer la cle : sinon le rejeu de la file rendrait 200 sans ticket, et le
// signalement serait perdu en silence.
Deno.test("reportProblem libere sa cle quand la photo designee n'existe plus", async () => {
  const sb = baseTickets();
  const spy = espionPush();
  const r = await reportProblem(sb, FAIZA as any, {
    jobId: JOB_ID, listingId: "102", category: "ac", photoId: 4242, idem: "idem-report-0009",
  }, { push: spy.push });
  assertEquals(r.status, 400);
  assertEquals(sb.tables.job_events.length, 0);
  assertEquals(sb.tables.maintenance_tickets.length, 0);
  // Et le rejeu repart pour de vrai, au lieu de rendre un faux succes.
  sb.tables.photos.push({ id: 4242, storage_path: "v3/2026-09-12/def.jpg", job_id: null, ticket_id: null, cleaner_id: 3 });
  const deux = await reportProblem(sb, FAIZA as any, {
    jobId: JOB_ID, listingId: "102", category: "ac", photoId: 4242, idem: "idem-report-0009",
  }, { push: spy.push });
  assertEquals(deux.status, 200);
  assertEquals(sb.tables.maintenance_tickets.length, 1);
});

Deno.test("checkTicket libere sa cle quand la photo designee n'existe plus", async () => {
  const sb = baseTickets();
  sb.tables.maintenance_tickets.push({ id: 71, listing_id: "102", title: "X", status: "open" });
  const r = await checkTicket(sb, FAIZA as any, { ticketId: 71, photoId: 4242, idem: "idem-check-0009" });
  assertEquals(r.status, 400);
  assertEquals(sb.tables.job_events.length, 0);
  assertEquals(sb.tables.ticket_comments.length, 0);
  assertEquals(sb.tables.maintenance_tickets[0].status, "open");
});

Deno.test("checkTicket rend 409 quand la cle est posee sans resultat", async () => {
  const sb = baseTickets();
  sb.tables.maintenance_tickets.push({ id: 71, listing_id: "102", title: "X", status: "open" });
  sb.tables.job_events.push({
    id: 1, idem_key: "idem-check-0409", event_type: "check_ticket", job_id: JOB_ID,
    cleaner_id: 3, payload: {}, result: null, created_at: "2026-09-12T06:00:00Z",
  });
  const r = await checkTicket(sb, FAIZA as any, { ticketId: 71, photoId: 55, idem: "idem-check-0409" });
  assertEquals(r.status, 409);
  assertEquals((r.body as any).error, "Still processing. Retry.");
  assertEquals(sb.tables.maintenance_tickets[0].status, "open");
  assertEquals(sb.tables.ticket_comments.length, 0);
});

Deno.test("checkTicket exige la photo et une cle, et rejoue sans doubler", async () => {
  const sb = baseTickets();
  sb.tables.maintenance_tickets.push({ id: 71, listing_id: "102", title: "X", status: "open" });
  assertEquals((await checkTicket(sb, FAIZA as any, { ticketId: 71, idem: "idem-check-0002" })).status, 400);
  assertEquals((await checkTicket(sb, FAIZA as any, { photoId: 55, idem: "idem-check-0003" })).status, 400);
  const corps = { ticketId: 71, photoId: 55, idem: "idem-check-0004" };
  await checkTicket(sb, FAIZA as any, corps);
  await checkTicket(sb, FAIZA as any, corps);
  assertEquals(sb.tables.ticket_comments.length, 1);
});

// Une cleaner ne clot pas un ticket, et elle ne rouvre pas non plus celui qu'un
// technicien vient de clore : un rejeu tardif de la file hors ligne ne doit pas
// ramener un ticket resolu a to_confirm.
Deno.test("checkTicket refuse un ticket inconnu ou deja clos", async () => {
  const sb = baseTickets();
  sb.tables.maintenance_tickets.push({ id: 72, listing_id: "102", title: "X", status: "resolved" });
  const inconnu = await checkTicket(sb, FAIZA as any, { ticketId: 9999, photoId: 55, idem: "idem-check-0011" });
  assertEquals(inconnu.status, 400);
  const clos = await checkTicket(sb, FAIZA as any, { ticketId: 72, photoId: 55, idem: "idem-check-0012" });
  assertEquals(clos.status, 400);
  assertEquals(sb.tables.maintenance_tickets[0].status, "resolved");
  assertEquals(sb.tables.job_events.length, 0);
  assertEquals(sb.tables.ticket_comments.length, 0);
});

// La photo designee doit etre celle de la cleaner qui parle. Les identifiants de
// photos sont des entiers de sequence, donc previsibles : sans ce controle, un
// compte pourrait attacher le cliche d'une autre a un ticket.
Deno.test("une photo qui n'appartient pas a la cleaner est refusee", async () => {
  const sb = baseTickets();
  sb.tables.photos.push({
    id: 56, storage_path: "v3/2026-09-12/ghi.jpg", job_id: null, ticket_id: null, cleaner_id: 9,
  });
  sb.tables.maintenance_tickets.push({ id: 71, listing_id: "102", title: "X", status: "open" });
  const spy = espionPush();
  const signalement = await reportProblem(sb, FAIZA as any, {
    jobId: JOB_ID, listingId: "102", category: "ac", photoId: 56, idem: "idem-report-0010",
  }, { push: spy.push });
  assertEquals(signalement.status, 400);
  const verif = await checkTicket(sb, FAIZA as any, { ticketId: 71, photoId: 56, idem: "idem-check-0010" });
  assertEquals(verif.status, 400);
  assertEquals(sb.tables.job_events.length, 0);
  assertEquals(sb.tables.maintenance_tickets.length, 1);
  assertEquals(sb.tables.maintenance_tickets[0].status, "open");
  assertEquals(sb.tables.ticket_comments.length, 0);
  assertEquals(sb.tables.photos[1].ticket_id, null);
  assertEquals(spy.envois.length, 0);
});

// ===========================================================================
// Tache 6 · fix round 1 (revue, constats 1, 3 et 4)
// ===========================================================================

// Constat 1 : la garde « ticket clos » etait posee avant le rejeu, donc un geste
// deja abouti se faisait refuser en 400 si le technicien avait clos le ticket
// entre-temps. La file hors ligne de la tache 9 traite tout 4xx autre que 409
// comme definitif : elle envoyait au magasin mort un geste qui etait passe.
Deno.test("checkTicket rejoue son succes meme si le ticket a ete clos entre-temps", async () => {
  const sb = baseTickets();
  sb.tables.maintenance_tickets.push({ id: 71, listing_id: "102", title: "X", status: "open" });
  const corps = { ticketId: 71, photoId: 55, idem: "idem-check-0013" };
  const un = await checkTicket(sb, FAIZA as any, corps);
  assertEquals(un.status, 200);
  // Le technicien confirme et clot pendant que le telephone est hors reseau.
  sb.tables.maintenance_tickets[0].status = "resolved";
  const deux = await checkTicket(sb, FAIZA as any, corps);
  assertEquals(deux.status, 200);
  assertEquals((deux.body as any).status_value, "to_confirm");
  // Le rejeu ne reecrit rien : le ticket reste clos, le commentaire reste unique.
  assertEquals(sb.tables.maintenance_tickets[0].status, "resolved");
  assertEquals(sb.tables.ticket_comments.length, 1);
});

// Constat 3 : `if (!V3_CATEGORIES[cat])` est verite pour toute propriete heritee
// d'Object.prototype, et le ticket partait avec « undefined problem reported ».
Deno.test("reportProblem refuse une categorie heritee d'Object.prototype", async () => {
  const sb = baseTickets();
  const spy = espionPush();
  for (const cat of ["constructor", "toString", "valueOf", "hasOwnProperty", "__proto__"]) {
    const r = await reportProblem(sb, FAIZA as any, {
      jobId: JOB_ID, listingId: "102", category: cat, photoId: 55, idem: "idem-proto-" + cat,
    }, { push: spy.push });
    assertEquals(r.status, 400);
    assertEquals((r.body as any).error, "unknown category");
  }
  assertEquals(sb.tables.maintenance_tickets.length, 0);
  assertEquals(sb.tables.job_events.length, 0);
  assertEquals(spy.envois.length, 0);
});

// Constat 4 : le retro-lien photo echouait en levant, la cle etait liberee et le
// rejeu creait un second ticket. L'ecriture decisive est l'insert du ticket ;
// tout ce qui vient apres est accessoire et ne fait plus rejouer le signalement.
Deno.test("reportProblem ne duplique pas le ticket quand le retro-lien photo echoue", async () => {
  const sb = baseTickets();
  sb.fail["photos.update"] = { message: "photos down" };
  const spy = espionPush();
  const corps = { jobId: JOB_ID, listingId: "102", category: "ac", photoId: 55, idem: "idem-report-0011" };
  const un = await reportProblem(sb, FAIZA as any, corps, { push: spy.push });
  assertEquals(un.status, 200);
  assertEquals(sb.tables.maintenance_tickets.length, 1);
  // Le retro-lien manque, assume : le ticket porte deja photo_path.
  assertEquals(sb.tables.photos[0].ticket_id, null);
  assertEquals(sb.tables.maintenance_tickets[0].photo_path, "v3/2026-09-12/abc.jpg");
  const deux = await reportProblem(sb, FAIZA as any, corps, { push: spy.push });
  assertEquals(deux.status, 200);
  assertEquals((deux.body as any).ticketId, (un.body as any).ticketId);
  assertEquals(sb.tables.maintenance_tickets.length, 1);
  assertEquals(spy.envois.length, 2);
});

// Meme classe cote checkTicket : l'ecriture decisive est le passage en
// to_confirm, le commentaire vient apres et ne doit pas pouvoir faire rejouer.
Deno.test("checkTicket ne double pas le commentaire quand une ecriture accessoire echoue", async () => {
  const sb = baseTickets();
  sb.tables.maintenance_tickets.push({ id: 71, listing_id: "102", title: "X", status: "open" });
  sb.fail["ticket_comments.insert"] = { message: "comments down" };
  const corps = { ticketId: 71, photoId: 55, idem: "idem-check-0014" };
  const un = await checkTicket(sb, FAIZA as any, corps);
  assertEquals(un.status, 200);
  assertEquals(sb.tables.maintenance_tickets[0].status, "to_confirm");
  assertEquals(sb.tables.ticket_comments.length, 0);
  const deux = await checkTicket(sb, FAIZA as any, corps);
  assertEquals(deux.status, 200);
  assertEquals(sb.tables.ticket_comments.length, 0);
});

// ---------------------------------------------------------------------------
// Identifiant oppose (revue tache 3, constat 5)
// ---------------------------------------------------------------------------

Deno.test("uploadPhoto rend 404 sur un jobId inconnu et ne depose rien", async () => {
  const sb = base({ job_events: [], photos: [] });
  const r = await uploadPhoto(sb, FAIZA as any,
    formulaire({ idem: "idem-photo-0404", jobId: "job_ffffffffffffffffffff" }));
  assertEquals(r.status, 404);
  assertEquals((r.body as any).error, "Job not found.");
  assertEquals(sb.storage.uploads.length, 0);
  assertEquals(sb.tables.photos.length, 0);
  assertEquals(sb.tables.job_events.length, 0);
});

Deno.test("uploadPhoto sans jobId reste possible quand un ticketId est fourni", async () => {
  const sb = base({ job_events: [], photos: [] });
  const r = await uploadPhoto(sb, FAIZA as any,
    formulaire({ idem: "idem-photo-0405", ticketId: "71" }));
  assertEquals(r.status, 200);
  assertEquals(sb.tables.photos[0].job_id, null);
  assertEquals(sb.tables.photos[0].ticket_id, 71);
});

Deno.test("reportProblem rend 404 sur un jobId inconnu, sans creer de ticket", async () => {
  const sb = baseTickets();
  const spy = espionPush();
  const r = await reportProblem(sb, FAIZA as any, {
    jobId: "job_ffffffffffffffffffff", listingId: "102", category: "ac",
    photoId: 55, idem: "idem-report-0404",
  }, { push: spy.push });
  assertEquals(r.status, 404);
  assertEquals(sb.tables.maintenance_tickets.length, 0);
  assertEquals(sb.tables.job_events.length, 0);
  assertEquals(spy.envois.length, 0);
});

Deno.test("reportProblem sans jobId ouvre quand meme un ticket, sans source_ref", async () => {
  // Le signalement depuis l'ecran d'un logement, hors menage : il n'y a pas de
  // jobId a resoudre et il n'en faut pas.
  const sb = baseTickets();
  const r = await reportProblem(sb, FAIZA as any, {
    listingId: "102", category: "ac", photoId: 55, idem: "idem-report-0405",
  }, { push: espionPush().push });
  assertEquals(r.status, 200);
  assertEquals(sb.tables.maintenance_tickets[0].source_ref, null);
});

Deno.test("reportProblem ne laisse aucun nom de guest dans le journal d'idempotence", async () => {
  const sb = baseTickets();
  await reportProblem(sb, FAIZA as any, {
    jobId: JOB_ID, listingId: "102", category: "ac", photoId: 55, idem: "idem-report-0406",
  }, { push: espionPush().push });
  assertEquals(sb.tables.job_events[0].job_id, JOB_ID);
  assertEquals(JSON.stringify(sb.tables.job_events[0]).includes("Lefevre"), false);
});
