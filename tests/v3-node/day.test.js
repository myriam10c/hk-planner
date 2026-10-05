import { test } from "node:test";
import assert from "node:assert/strict";
import { toApartments, splitName, guestOf, dubaiDate, dubaiHHMM } from "../../v3/conv/day.js";
import { aptLabel } from "../../v3/conv/rules.js";
import { createConversation, reply, addPhoto, currentStep, isHelper } from "../../v3/conv/conversation.js";
import { DAY, ME, NOW, REF, STOP_OXFORD, STOP_CREEK, STOP_BLOOM } from "./fixtures.js";

test("un appartement par stop, dans l'ordre du serveur, champs du prototype", () => {
  const [ox, cr, bl] = toApartments(DAY, ME, { now: NOW });
  assert.equal(toApartments(DAY, ME, { now: NOW }).length, 3);
  assert.deepEqual(
    { id: bl.id, listingId: bl.listingId, num: bl.num, building: bl.building, area: bl.area, type: bl.type, usualMinutes: bl.usualMinutes, state: bl.state, startedAt: bl.startedAt },
    { id: "job_0000000000000blm1011", listingId: "203", num: "1011C", building: "Bloom Towers", area: "", type: "Studio", usualMinutes: 100, state: "todo", startedAt: null });
  assert.deepEqual(bl.rooms, ["Bed", "Bathroom", "Kitchen"]);
  assert.equal(bl.photo, STOP_BLOOM.heroPhotoUrl);
  assert.deepEqual(bl.roomPhotos, { Bed: REF("bl-Bed"), Kitchen: REF("bl-Kitchen") }, "références = dernière photo de fin du ménage précédent");
  assert.equal(bl.managerCheck, null);
  assert.equal(bl.lead, null);
  assert.deepEqual(cr.rooms, STOP_CREEK.rooms);
  assert.equal(cr.type, "2 BHK");
  assert.equal(cr.state, "running");
  assert.equal(ox.openTickets.length, 2);
  assert.equal("template" in bl, false, "plus de TEMPLATES : les pièces viennent du serveur");
});

test("rooms et références : copies, jamais l'objet du payload", () => {
  const [, , bl] = toApartments(DAY, ME, { now: NOW });
  bl.rooms.push("X"); bl.roomPhotos.Bathroom = "x";
  assert.deepEqual(STOP_BLOOM.rooms, ["Bed", "Bathroom", "Kitchen"]);
  assert.equal(STOP_BLOOM.references.Bathroom, undefined);
});

test("numéro et immeuble depuis listingName ; à défaut numéro vide et immeuble = nom", () => {
  assert.deepEqual(splitName("3207 - Sobha Waves"), { num: "3207", building: "Sobha Waves" });
  assert.deepEqual(splitName("1011C - Bloom Towers"), { num: "1011C", building: "Bloom Towers" });
  assert.deepEqual(splitName("704 Golf Links"), { num: "704", building: "Golf Links" });
  // Noms réels de listing_config.internal_name (revue, correctif 1).
  assert.deepEqual(splitName("414 | Azizi Riviera 11"), { num: "414", building: "Azizi Riviera 11" });
  assert.deepEqual(splitName("506 | Act 2"), { num: "506", building: "Act 2" });
  assert.deepEqual(splitName("506 | Azizi Riviera 28"), { num: "506", building: "Azizi Riviera 28" });
  assert.deepEqual(splitName("510-B Cloud by Tiger"), { num: "510-B", building: "Cloud by Tiger" });
  assert.deepEqual(splitName("903-B | Cloud by Tiger"), { num: "903-B", building: "Cloud by Tiger" });
  assert.deepEqual(splitName("G34 - elysee 3"), { num: "G34", building: "elysee 3" });
  assert.deepEqual(splitName("1913a - Bloom Height"), { num: "1913a", building: "Bloom Height" });
  assert.deepEqual(splitName("1205 - Binghatti Gems V2 - ok"), { num: "1205", building: "Binghatti Gems" });
  assert.deepEqual(splitName("1205 - Binghatti Gems V2"), { num: "1205", building: "Binghatti Gems" });
  assert.deepEqual(splitName("308 - Samana Golf Avenue (NEW)"), { num: "308", building: "Samana Golf Avenue" });
  assert.deepEqual(splitName("308 - Samana Golf Avenue (new)"), { num: "308", building: "Samana Golf Avenue" });
  assert.deepEqual(splitName("1702 -  Sobha   Waves /"), { num: "1702", building: "Sobha Waves" });
  assert.deepEqual(splitName("Perfect 2br for families in JVC"), { num: "", building: "Perfect 2br for families in JVC" });
  assert.deepEqual(splitName("Apartment"), { num: "", building: "Apartment" });
  assert.deepEqual(splitName(""), { num: "", building: "Apartment" });
  assert.equal(aptLabel({ num: "", building: "Golf Links" }), "Golf Links", "pas d'espace orphelin");
  assert.equal(aptLabel({ num: "704", building: "Golf Links" }), "704 Golf Links");
});

test("voyageur : libellé, texte du rapport et heures restantes à l'heure de Dubai", () => {
  const s = (d, t) => ({ nextArrivalDate: d, nextArrivalTime: t });
  assert.deepEqual(guestOf(s(null, null), NOW), { label: "No guest yet", next: "none booked yet", hoursAway: null });
  assert.deepEqual(guestOf(s("2026-10-02", "15:00"), NOW), { label: "Guest at 3 PM", next: "today 3 PM", hoursAway: 3 });
  assert.deepEqual(guestOf(s("2026-10-02", "15:30"), NOW), { label: "Guest at 3:30 PM", next: "today 3:30 PM", hoursAway: 3.5 });
  assert.deepEqual(guestOf(s("2026-10-03", "12:00"), NOW), { label: "Guest tomorrow 12 PM", next: "tomorrow 12 PM", hoursAway: 24 });
  assert.deepEqual(guestOf(s("2026-10-06", "16:00"), NOW), { label: "Guest on Tue 6 Oct", next: "Tue 6 Oct 4 PM", hoursAway: 100 });
  assert.deepEqual(guestOf(s("2026-10-02", null), NOW), { label: "Guest today", next: "today", hoursAway: -12 });
  assert.deepEqual(guestOf(s("garbage", "15:00"), NOW).label, "No guest yet");
  // 23:30 à Dubai le 1er = déjà le 2 à Dubai, même si l'UTC dit encore le 1er.
  assert.equal(dubaiDate(new Date("2026-10-01T20:30:00Z")), "2026-10-02");
  assert.equal(dubaiHHMM("2026-10-02T06:05:00Z"), "10:05");
  assert.equal(dubaiHHMM(null), null);
});

test("vérification du manager : présente seulement si un ticket « pest » est ouvert", () => {
  const [ox] = toApartments(DAY, ME, { now: NOW });
  assert.deepEqual(ox.managerCheck, {
    text: "Pest control was asked. Do you see insects?", ok: "No insects", see: "I see insects",
    kind: "Insects", reportLabel: "Insects seen", ticketId: 91,
  });
  const sans = toApartments({ stops: [{ ...STOP_OXFORD, openTickets: [STOP_OXFORD.openTickets[1]] }] }, ME, { now: NOW })[0];
  assert.equal(sans.managerCheck, null);
});

test("binôme : lead = la première des autres si elle a démarré avant moi, sinon null", () => {
  const [, cr] = toApartments(DAY, ME, { now: NOW });
  assert.deepEqual(cr.lead, { id: 7, name: "Pionah", startedAt: "10:05", roomsDone: [] });
  const c = createConversation(cr, { me: ME, now: NOW });
  assert.equal(isHelper(c), true);
  assert.equal(c.messages[0].text, "Pionah started at 10:05. She sends the report. Add your photos and problems.");
  // pas encore démarrée : pas de lead
  const pas = { ...STOP_CREEK, othersOnJob: [{ id: 7, name: "Pionah", startedAt: null }] };
  assert.equal(toApartments({ stops: [pas] }, ME, { now: NOW })[0].lead, null);
  // j'ai démarré avant elle : je suis la première
  const avant = toApartments({ stops: [STOP_CREEK] }, ME, { now: NOW, myStarts: { [STOP_CREEK.jobId]: "2026-10-02T06:00:00Z" } })[0];
  assert.equal(avant.lead, null);
  const apres = toApartments({ stops: [STOP_CREEK] }, ME, { now: NOW, myStarts: { [STOP_CREEK.jobId]: "2026-10-02T06:30:00Z" } })[0];
  assert.equal(apres.lead.name, "Pionah");
  // moi-même dans othersOnJob (jamais rendu par le serveur) : ignorée
  const moi = { ...STOP_CREEK, othersOnJob: [{ id: 4, name: "Faiza", startedAt: "2026-10-02T05:00:00Z" }] };
  assert.equal(toApartments({ stops: [moi] }, ME, { now: NOW })[0].lead, null);
});

test("payload sans stops, champs absents : aucune exception, valeurs prudentes", () => {
  assert.deepEqual(toApartments(null, ME, { now: NOW }), []);
  assert.deepEqual(toApartments({ stops: [] }, ME, { now: NOW }), []);
  const [a] = toApartments({ stops: [{ jobId: "job_x", listingName: "Apartment" }] }, ME, { now: NOW });
  assert.deepEqual(a.rooms, ["Bed", "Bathroom", "Kitchen"]);
  assert.equal(a.photo, null);
  assert.deepEqual(a.roomPhotos, {});
  assert.deepEqual(a.openTickets, []);
  assert.equal(a.type, "Studio");
  assert.equal(a.guest.hoursAway, null);
});

test("étape 2 : bulle « Open problems here » avec les autres tickets ouverts, avant la vérification", () => {
  const [ox, , bl] = toApartments(DAY, ME, { now: NOW });
  const c = createConversation(ox, { me: ME, now: NOW });
  reply(c, "here", { now: NOW });
  for (let i = 0; i < 3; i++) { addPhoto(c, "a", { now: NOW }); reply(c, "next-room", { now: NOW }); }
  assert.equal(currentStep(c).id, "check");
  const app = c.messages.filter(m => m.from === "app").map(m => m.text);
  assert.deepEqual(app.slice(-2), ["Open problems here: Leak · Bathroom.", "Pest control was asked. Do you see insects?"]);
  reply(c, "check-ok", { now: NOW });
  assert.equal(c.messages.filter(m => /^Open problems here/.test(m.text || "")).length, 1, "une seule fois");
  // aucun autre ticket : pas de bulle
  const d = createConversation(bl, { me: ME, now: NOW });
  reply(d, "here", { now: NOW });
  for (let i = 0; i < 3; i++) { addPhoto(d, "a", { now: NOW }); reply(d, "next-room", { now: NOW }); }
  assert.equal(d.messages.some(m => /Open problems/.test(m.text || "")), false);
});

test("aucun nom complet de voyageur ni tiret cadratin dans les appartements", () => {
  const all = JSON.stringify(toApartments(DAY, ME, { now: NOW }));
  assert.equal(all.includes("Marc"), false);
  assert.equal(all.includes("Anna"), false);
  assert.equal(all.includes("—"), false);
});
