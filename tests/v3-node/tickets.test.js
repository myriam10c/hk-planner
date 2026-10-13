// Tickets ouverts du logement (maintenance phase 3, C4 et C8), revue finale : les cartes, leurs
// regles de reponse, l'ordre d'envoi (photos avant checkTicket), le retour en arriere quand une
// photo n'entre pas en file, la reprise apres rechargement, les coches et le destinataire.
import { test } from "node:test";
import assert from "node:assert/strict";
import { ME, NOW, STOP_BLOOM, STOP_CREEK } from "./fixtures.js";
import { toApartments } from "../../v3/conv/day.js";
import {
  createConversation, reply, addPhoto, addProblem, editProblem, currentStep, isHelper, readOnlyConversation,
  ticketAnswerable, ticketCard, ticketStill, startTicketFix, addFixPhoto, fixDone, fixCancel,
} from "../../v3/conv/conversation.js";
import { syncPlan, runActions, ackSync, refreshTicks } from "../../v3/conv/sync.js";
import { serializeConversation, deserializeConversation, photoIdems } from "../../v3/conv/persist.js";
import { sentLabel, renderConversation } from "../../v3/conv/ui.js";

const T = (id, title, category, status, extra = {}) =>
  ({ id, title, category, priority: "medium", status, assigneeName: null, reportedOn: "2026-09-30", ...extra });
const TICKETS = [
  T(92, "Leak · Bathroom", "plumbing", "assigned", { assigneeName: "Semax" }),
  T(93, "AC · Bed", "ac", "to_confirm"),
  T(91, "Cockroaches · Kitchen", "pest", "open"),
  T(94, "Ants · Bed", "pest", "to_confirm"),
  T(95, "Bed bugs · Bed", "pest", "open"),
];
const aptWith = (stop) => toApartments({ stops: [stop] }, ME, { now: NOW })[0];
const BLOOM_T = aptWith({ ...STOP_BLOOM, openTickets: TICKETS });

function setup(apt = BLOOM_T) {
  let n = 0;
  const newIdem = () => "idem" + String(++n).padStart(4, "0");
  let k = 0;
  const photo = () => ({ url: "blob:" + (++k), file: { name: "t" + k + ".jpg" } });
  const c = createConversation(apt, { me: ME, now: NOW });
  return { c, newIdem, photo, sync: () => syncPlan(c, { newIdem }) };
}

// Jusqu'a l'etape 2 (premiere question apres les photos d'arrivee).
function toStep2(c) {
  reply(c, "here", { now: NOW });
  for (const room of c.apt.rooms) { addPhoto(c, "a-" + room, { now: NOW }); reply(c, "next-room", { now: NOW }); }
}
const cards = c => c.messages.filter(m => m.type === "ticket").map(m => m.ticket.id);
const brief = a => a.action.replace("v3.", "") + " " + JSON.stringify(Object.fromEntries(
  Object.entries(a.body).filter(([key]) => ["ticketId", "photoIdem", "idem", "itemName"].includes(key))));

// ---- G4 : pest ----

test("pest : seul le ticket de la question n'a pas de carte ; pest to_confirm et second pest ont la leur", () => {
  const { c } = setup();
  assert.equal(BLOOM_T.managerCheck.ticketId, 91);
  toStep2(c);
  assert.deepEqual(cards(c), [92, 93, 94, 95]);
  assert.equal(currentStep(c).id, "check");
  assert.equal(ticketCard(c, 94).status, "to_confirm");
  assert.equal(ticketAnswerable(c, 94), false);
  assert.equal(ticketAnswerable(c, 95), true);
  const html = renderConversation(c, { now: NOW });
  const carte94 = html.slice(html.indexOf('data-ticket="94"'), html.indexOf('data-ticket="95"'));
  assert.match(carte94, /Waiting for check/);
  assert.doesNotMatch(carte94, /<button/);
});

test("pest : un pest deja to_confirm seul ne pose pas la question et garde sa carte", () => {
  const { c } = setup(aptWith({ ...STOP_BLOOM, openTickets: [T(94, "Ants · Bed", "pest", "to_confirm")] }));
  assert.equal(c.apt.managerCheck, null);
  toStep2(c);
  assert.deepEqual(cards(c), [94]);
  assert.notEqual(currentStep(c).id, "check");
});

// ---- G5 : lead et aide ----

test("binome : l'aide lit une ligne sans bouton, jamais de carte ; le lead a les cartes", () => {
  const stop = { ...STOP_CREEK, openTickets: TICKETS, role: "helper", leadId: 7 };
  const aide = createConversation(aptWith(stop), { me: ME, now: NOW });
  assert.equal(isHelper(aide), true);
  // Ni to_confirm ni le pest de la question : seulement ce qui attend encore.
  assert.ok(aide.messages.some(m => m.text === "Open problems here: Leak · Bathroom, Bed bugs · Bed."));
  reply(aide, "here", { now: NOW });
  for (let i = 0; i < 10 && currentStep(aide).id === "end-photo"; i++) { addPhoto(aide, "e", { now: NOW }); reply(aide, "next-room", { now: NOW }); }
  assert.deepEqual(cards(aide), []);
  assert.equal(ticketAnswerable(aide, 92), false);
  assert.doesNotMatch(renderConversation(aide, { now: NOW }), /data-act="ticket-/);

  const lead = createConversation(aptWith({ ...stop, role: "lead", leadId: 4 }), { me: ME, now: NOW });
  assert.equal(isHelper(lead), false);
  toStep2(lead);
  assert.deepEqual(cards(lead), [92, 93, 94, 95]);
});

// ---- Regles de reponse d'une carte ----

test("carte : une seule reponse, rien pendant un viseur, apres l'envoi du rapport ni en lecture seule", () => {
  const { c, photo } = setup();
  toStep2(c);
  assert.equal(ticketAnswerable(c, 999), false, "ticket inconnu");
  assert.equal(ticketAnswerable(c, 93), false, "to_confirm");
  const g = c.gestures;
  ticketStill(c, 92);
  ticketStill(c, 92);
  assert.deepEqual(c.tickets[92], { answer: "still", photos: [] });
  assert.equal(c.gestures, g + 1);
  assert.equal(ticketAnswerable(c, 92), false);
  // Fixed now : Done sans photo ne fait rien ; Back laisse la carte repondable.
  startTicketFix(c, 95);
  assert.deepEqual(c.fix, { ticketId: 95, photos: [] });
  assert.equal(ticketAnswerable(c, 94), false, "viseur ouvert");
  fixDone(c);
  assert.equal(c.tickets[95], undefined);
  fixCancel(c);
  assert.equal(c.fix, null);
  assert.equal(ticketAnswerable(c, 95), true);
  startTicketFix(c, 95); addFixPhoto(c, photo()); fixDone(c);
  assert.equal(c.tickets[95].answer, "fixed");
  assert.equal(c.tickets[95].photos.length, 1);
  assert.equal(c.fix, null);
  // Rapport parti : plus aucune reponse.
  const { c: d } = setup();
  toStep2(d);
  d.sent = true;
  assert.equal(ticketAnswerable(d, 92), false);
  // View as : aucune carte repondable.
  const ro = readOnlyConversation(BLOOM_T, { me: ME, now: NOW });
  assert.equal(ticketAnswerable(ro, 92), false);
});

// ---- Envoi : ordre, cle unique ----

test("envoi : Still there part seul ; Fixed now envoie ses photos puis checkTicket, une seule fois", () => {
  const { c, photo, sync } = setup();
  toStep2(c);
  sync();
  ticketStill(c, 92);
  assert.deepEqual(sync().map(brief), ['ticketStill {"ticketId":92,"idem":"' + c.tickets[92].idem + '"}']);
  startTicketFix(c, 95); addFixPhoto(c, photo()); addFixPhoto(c, photo());
  assert.deepEqual(sync(), [], "rien tant que Done n'est pas touche");
  fixDone(c);
  const out = sync();
  const [p1, p2] = c.tickets[95].photos;
  assert.deepEqual(out.map(brief), [
    'uploadPhoto {"ticketId":95,"itemName":"ticket","idem":"' + p1.idem + '"}',
    'uploadPhoto {"ticketId":95,"itemName":"ticket","idem":"' + p2.idem + '"}',
    'checkTicket {"ticketId":95,"photoIdem":"' + p1.idem + '","idem":"' + c.tickets[95].idem + '"}',
  ]);
  assert.equal(out[0].body.jobId, BLOOM_T.id);
  assert.deepEqual(sync(), [], "jamais reemis");
});

// ---- Retour en arriere ----

test("photo Fixed now refusee par la file : checkTicket defait, puis reemis avec la meme cle", async () => {
  const { c, photo, sync } = setup();
  toStep2(c);
  sync();
  startTicketFix(c, 95); addFixPhoto(c, photo()); fixDone(c);
  const first = sync();
  const key = c.tickets[95].idem;
  const sent = [];
  const undone = await runActions(c, first, async a => {
    if (a.action === "v3.uploadPhoto") throw new Error("quota");
    sent.push(a);
  });
  assert.equal(undone, 2);
  assert.deepEqual(sent, [], "checkTicket ne part pas sans sa photo");
  assert.equal(c.sync.tickets[95].sent, false);
  const again = sync();
  assert.deepEqual(again.map(a => a.action), ["v3.uploadPhoto", "v3.checkTicket"]);
  assert.equal(again[1].body.idem, key, "meme cle : aucun doublon cote proxy");
  assert.equal(again[1].body.photoIdem, again[0].body.idem);
});

test("G6 : une seconde photo Fixed now refusee par la file repart seule au prochain passage", async () => {
  const { c, photo, sync } = setup();
  toStep2(c);
  sync();
  startTicketFix(c, 95); addFixPhoto(c, photo()); addFixPhoto(c, photo()); fixDone(c);
  const first = sync();
  let uploads = 0;
  await runActions(c, first, async a => {
    if (a.action === "v3.uploadPhoto" && ++uploads === 2) throw new Error("quota");
  });
  assert.equal(c.sync.tickets[95].sent, true, "checkTicket est parti avec la premiere photo");
  const again = sync();
  assert.deepEqual(again.map(brief), [
    'uploadPhoto {"ticketId":95,"itemName":"ticket","idem":"' + c.tickets[95].photos[1].idem + '"}',
  ]);
  assert.deepEqual(sync(), []);
});

// ---- Reprise apres rechargement ----

test("reprise : les photos Fixed now reviennent par leur cle, rien n'est reemis, le viseur ouvert se perd", () => {
  const { c, photo, sync, newIdem } = setup();
  toStep2(c);
  sync();
  startTicketFix(c, 95); addFixPhoto(c, photo()); fixDone(c);
  ticketStill(c, 92);
  sync();
  startTicketFix(c, 95); // deja repondu : sans effet
  assert.equal(c.fix, null);
  const idem = c.tickets[95].photos[0].idem;
  // Un viseur « Fixed now » ouvert au moment du rechargement.
  const { c: d } = setup();
  toStep2(d);
  startTicketFix(d, 95); addFixPhoto(d, photo());

  const json = JSON.parse(JSON.stringify(serializeConversation(c)));
  assert.ok(photoIdems(json).includes(idem));
  const files = { [idem]: { name: "t1.jpg" } };
  const back = deserializeConversation(json, k => (files[k] ? { url: "blob:new-" + k, file: files[k], idem: k } : null));
  assert.deepEqual(back.tickets[95].photos, [{ url: "blob:new-" + idem, file: { name: "t1.jpg" }, idem }]);
  assert.equal(back.tickets[92].answer, "still");
  assert.deepEqual(syncPlan(back, { newIdem }), []);

  const dBack = deserializeConversation(JSON.parse(JSON.stringify(serializeConversation(d))), () => null);
  assert.equal(dBack.fix, null);
  assert.equal(ticketAnswerable(dBack, 95), true);
});

// ---- Coches de la carte ----

test("coches : rien avant la reponse, ✓ en file, ✓✓ a la reponse du proxy", () => {
  const { c, sync } = setup();
  toStep2(c);
  sync();
  refreshTicks(c);
  const m = c.messages.find(x => x.type === "ticket" && x.ticket.id === 92);
  assert.equal(m.status, undefined);
  ticketStill(c, 92);
  sync();
  assert.equal(refreshTicks(c), true);
  assert.equal(m.status, "saved");
  ackSync(c, c.tickets[92].idem, { ok: true });
  refreshTicks(c);
  assert.equal(m.status, "synced");
  assert.match(renderConversation(c, { now: NOW }), /data-ticket="92">[\s\S]*?✓ Still there[\s\S]*?<span class="ticks">✓✓<\/span>/);
});

// ---- Destinataire d'un probleme signale (C8) ----

test("sentLabel : rien sans envoi, saved sending… en file, puis le nom ou the team", () => {
  const { c, sync, photo } = setup();
  toStep2(c);
  addProblem(c, "Leak", null, { now: NOW });
  sync();
  assert.equal(sentLabel(c, c.problems[0]), "", "photo obligatoire absente : rien ne part");
  addProblem(c, "Broken", photo(), { now: NOW });
  editProblem(c, 1, { urgency: "urgent" });
  sync();
  const p = c.problems[1];
  assert.equal(sentLabel(c, p), "saved, sending…");
  ackSync(c, p.idem, { ticketId: 900, sentTo: "Semax" });
  assert.equal(sentLabel(c, p), "sent to Semax");
  ackSync(c, p.idem, { ticketId: 900, sentTo: null });
  assert.equal(sentLabel(c, p), "sent to the team");
  ackSync(c, p.idem, { ticketId: 900 });
  assert.equal(sentLabel(c, p), "sent to the team");
});
