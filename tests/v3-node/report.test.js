import { test } from "node:test";
import assert from "node:assert/strict";
import { APARTMENTS, ME } from "./fixtures.js";
import { createConversation, reply, addPhoto, addProblem, editProblem, addProblemPhoto, setProblemNote, chooseKind, startProblem, addFlowPhoto, flowReply, currentStep } from "../../v3/conv/conversation.js";
import { reportText, reportFiles, pickFiles, formatMinutes, deliveryOf, arrivalText, arrivalFiles } from "../../v3/conv/report.js";
import { syncPlan, ackSync } from "../../v3/conv/sync.js";

const [oxford, , bloom] = APARTMENTS;
const at = (h, m) => new Date(2026, 9, 2, h, m);
const ph = n => ({ url: "u" + n, file: { name: n + ".jpg" } });
const NB = " ";
const shoot = (c, p, t) => { addPhoto(c, p, { now: t }); reply(c, "next-room", { now: t }); };
// Étape de la carte d'accès (22/10), juste après I'm here.
const card = (c, t) => shoot(c, ph("card"), t);
const leaveAll = (c, t) => ["gas", "ac", "wifi", "lights", "windows", "trash", "door"].forEach(k => reply(c, "leave:" + k, { now: t }));

test("formatage des durées, espaces insécables", () => {
  assert.equal(formatMinutes(45), "45" + NB + "min");
  assert.equal(formatMinutes(100), "1" + NB + "h" + NB + "40");
});

test("rapport exact d'un studio sans problème", () => {
  const c = createConversation(bloom, { me: ME, now: at(9, 0) });
  reply(c, "here", { now: at(10, 0) });
  card(c, at(10, 0));
  for (const r of ["Bed", "Bathroom", "Kitchen"]) shoot(c, ph("a-" + r), at(10, 1));
  reply(c, "walls-ok", { now: at(10, 2) }); reply(c, "no-damage", { now: at(10, 2) }); reply(c, "send-arrival-photos", { now: at(10, 2) }); reply(c, "send-arrival", { now: at(10, 2) });
  reply(c, "linen-yes", { now: at(10, 3) });
  for (const r of ["Bed", "Bathroom", "Kitchen"]) shoot(c, ph("e-" + r), at(11, 30));
  leaveAll(c, at(11, 35));
  reply(c, "low-done", { now: at(11, 36) });
  reply(c, "send-photos", { now: at(11, 40) }); reply(c, "send", { now: at(11, 40) });
  assert.equal(reportText(c, { now: at(11, 40) }), [
    "✅ *READY · 1011C Bloom Towers*",
    "Studio · Next guest: none booked yet",
    "👤 Faiza · 10:00 → 11:40 (1" + NB + "h" + NB + "40, usual 1" + NB + "h" + NB + "40)",
    "",
    "*Access card:* 📷 1",
    "*1 Arrival:* Bed 📷 1 · Bathroom 📷 1 · Kitchen 📷 1 (sent 10:02)",
    "*2 Damage:* none",
    "*Walls:* OK",
    "*3 Dirty linen:* 4 pillowcases, 1 bed sheet, 1 duvet cover, 3 bath towels, 1 bath mat",
    "*4 Rooms cleaned:* Bed 📷 1 · Bathroom 📷 1 · Kitchen 📷 1",
    "*5 Leave:* Gas works, now off ✓ · AC on, Auto mode ✓ · Wi-Fi works ✓ · Lights off ✓ · Windows & balcony closed ✓ · Trash taken out ✓ · Door locked, keys & card left inside ✓",
    "*Running low:* nothing",
    "*Problems:* none",
    "📷 4 arrival · 3 end · 0 of problems",
  ].join("\n"));
  // La carte et l'arrivée sont parties avec l'envoi d'arrivée : le rapport final joint la fin seulement.
  assert.deepEqual(reportFiles(c).map(f => f.name), ["e-Bed.jpg", "e-Bathroom.jpg", "e-Kitchen.jpg"]);
});

test("dégâts, vérification du manager, problèmes groupés, aucune ligne 🎙", () => {
  const c = createConversation(oxford, { me: ME, now: at(9, 0) });
  reply(c, "here", { now: at(9, 18) });
  card(c, at(9, 18));
  addProblem(c, "Broken", ph("p-broken"), { now: at(9, 19) }); // signalé dans Bed, avant la photo qui fait avancer
  shoot(c, ph("a-Bed"), at(9, 19));
  shoot(c, ph("a-Bathroom"), at(9, 20));
  shoot(c, ph("a-Kitchen"), at(9, 20));
  reply(c, "check-see", { now: at(9, 22) });
  addFlowPhoto(c, ph("p-bug")); flowReply(c, "photos-done"); flowReply(c, "no-note");
  reply(c, "walls-ok", { now: at(9, 23) }); reply(c, "some-damage", { now: at(9, 23) });
  chooseKind(c, "Stain", { now: at(9, 24) }); addFlowPhoto(c, ph("p-stain")); flowReply(c, "photos-done"); flowReply(c, "no-note");
  reply(c, "damage-done", { now: at(9, 25) }); reply(c, "send-arrival-photos", { now: at(9, 25) }); reply(c, "send-arrival", { now: at(9, 25) });
  reply(c, "linen-yes", { now: at(9, 26) });
  const t = reportText(c, { now: at(10, 0) });
  assert.match(t, /\n\*2 Damage:\* see problems\n\*Walls:\* OK\n\*Insects seen:\* Yes\n/);
  assert.match(t, /\*Problems \(3\):\*\n_Bed_\n🟠 Broken \(HK-461\)\n_Whole apartment_\n🟠 Insects \(HK-462\)\n🟠 Stain \(HK-463\)/);
  assert.equal(t.includes("🎙"), false, "plus de note vocale");
  assert.doesNotMatch(t, /voice/i);
  // urgent change a la main dans la fiche, sans envoi connu (pas de sync) : « team notified »
  editProblem(c, 1, { urgency: "urgent" });
  assert.match(reportText(c, { now: at(10, 0) }), /🔴 Insects \(HK-462, team notified 09:22\)/);
  assert.match(t, /\n\*Access card:\* 📷 1\n\*1 Arrival:\* Bed 📷 1 · Bathroom 📷 1 · Kitchen 📷 1 \(sent 09:25\)\n/);
  assert.match(t, /📷 4 arrival · 0 end · 3 of problems/);
});

test("plafond de 10 fichiers : carte d'accès, problèmes, puis fin, puis arrivée", () => {
  const c = createConversation(bloom, { me: ME, now: at(9, 0) });
  reply(c, "here", { now: at(10, 0) });
  card(c, at(10, 0));
  for (let i = 0; i < 6; i++) addPhoto(c, ph("a" + i), { now: at(10, 1) });
  reply(c, "next-room", { now: at(10, 1) });
  shoot(c, ph("aB"), at(10, 1)); shoot(c, ph("aK"), at(10, 1));
  reply(c, "walls-ok", { now: at(10, 2) }); reply(c, "no-damage", { now: at(10, 2) });
  // Envoi d'arrivée jamais fait (ménage commencé avant la mise à jour) : le rapport final joint tout.
  c.steps = c.steps.filter(s => s.id !== "arrival-send"); reply(c, "linen-yes", { now: at(10, 3) });
  addProblem(c, "Leak", ph("p1"), { now: at(10, 4) });
  for (const r of ["Bed", "Bathroom", "Kitchen"]) shoot(c, ph("e-" + r), at(11, 0));
  const pick = pickFiles(c);
  assert.equal(pick.files.length, 10);
  assert.equal(pick.files[0].name, "card.jpg", "la carte d'accès passe en premier");
  assert.deepEqual(pick.files.map(f => f.name).slice(1, 6), ["a0.jpg", "a1.jpg", "a2.jpg", "a3.jpg", "a4.jpg"], "il reste 5 places pour l'arrivée");
  assert.deepEqual(pick.files.map(f => f.name).slice(-4), ["e-Bed.jpg", "e-Bathroom.jpg", "e-Kitchen.jpg", "p1.jpg"]);
  assert.equal(pick.cutPhotos, true);
  assert.equal("cutVoices" in pick, false);
  assert.match(reportText(c, { now: at(11, 30) }), /📷 9 arrival · 3 end · 1 of problems \(10 attached\)/);
});

test("ligne de problème : détail, note, nombre de photos ; toutes les photos partent", () => {
  const c = createConversation(bloom, { me: ME, now: at(9, 0) });
  reply(c, "here", { now: at(10, 0) });
  addProblem(c, "Broken", ph("p1"), { now: at(10, 1) });
  addProblemPhoto(c, 0, ph("p2")); addProblemPhoto(c, 0, ph("p3"));
  editProblem(c, 0, { detail: "Sofa" });
  setProblemNote(c, 0, "tear on the left cushion");
  addProblem(c, "Missing", ph("m1"), { now: at(10, 2) });
  addProblem(c, "Leak", null, { now: at(10, 3) });
  setProblemNote(c, 2, "under the sink");
  editProblem(c, 2, { urgency: "urgent" });
  const t = reportText(c, { now: at(10, 30) });
  assert.match(t, /\n🟠 Broken, Sofa: tear on the left cushion \(HK-461, 3 photos\)\n🟠 Missing \(HK-462\)\n🔴 Leak: under the sink \(HK-463, team notified 10:03\)/);
  assert.deepEqual(pickFiles(c).files.map(f => f.name), ["p1.jpg", "p2.jpg", "p3.jpg", "m1.jpg"]);
  assert.match(t, /4 of problems/);
});

test("gaz not working : ✗ dans la ligne 5, problème Soon dans la liste", () => {
  const c = createConversation(bloom, { me: ME, now: at(9, 0) });
  reply(c, "here", { now: at(10, 0) });
  card(c, at(10, 0));
  for (const r of ["Bed", "Bathroom", "Kitchen"]) shoot(c, ph("a-" + r), at(10, 1));
  reply(c, "walls-ok", { now: at(10, 2) }); reply(c, "no-damage", { now: at(10, 2) }); reply(c, "send-arrival-photos", { now: at(10, 2) }); reply(c, "send-arrival", { now: at(10, 2) }); reply(c, "linen-yes", { now: at(10, 3) });
  for (const r of ["Bed", "Bathroom", "Kitchen"]) shoot(c, ph("e-" + r), at(11, 0));
  reply(c, "leave:gas-ko", { now: at(11, 1) });
  ["ac", "wifi", "lights", "windows", "trash", "door"].forEach(k => reply(c, "leave:" + k, { now: at(11, 2) }));
  const t = reportText(c, { now: at(11, 30) });
  assert.match(t, /\n\*5 Leave:\* Gas not working ✗ · AC on, Auto mode ✓ · Wi-Fi works ✓ · Lights off ✓/);
  assert.match(t, /\*Problems \(1\):\*\n_Whole apartment_\n🟠 Gas not working \(HK-461\)/);
});

test("murs abîmés : « Walls: see problems » et la ligne du problème", () => {
  const c = createConversation(bloom, { me: ME, now: at(9, 0) });
  reply(c, "here", { now: at(10, 0) });
  card(c, at(10, 0));
  for (const r of ["Bed", "Bathroom", "Kitchen"]) shoot(c, ph("a-" + r), at(10, 1));
  reply(c, "walls-ko", { now: at(10, 2) });
  addFlowPhoto(c, ph("w1")); addFlowPhoto(c, ph("w2"));
  flowReply(c, "photos-done");
  flowReply(c, "save-text", { text: "hole behind the door" });
  reply(c, "no-damage", { now: at(10, 5) }); reply(c, "send-arrival-photos", { now: at(10, 5) }); reply(c, "send-arrival", { now: at(10, 5) });
  const t = reportText(c, { now: at(10, 30) });
  assert.match(t, /\n\*2 Damage:\* none\n\*Walls:\* see problems\n\*3 Dirty linen/);
  assert.match(t, /_Whole apartment_\n🟠 Wall damage: hole behind the door \(HK-461, 2 photos\)/);
});

test("AC not working : « AC not working ✗ » dans la ligne 5, problème Soon dans la liste", () => {
  const c = createConversation(bloom, { me: ME, now: at(9, 0) });
  reply(c, "here", { now: at(10, 0) });
  card(c, at(10, 0));
  for (const r of ["Bed", "Bathroom", "Kitchen"]) shoot(c, ph("a-" + r), at(10, 1));
  reply(c, "walls-ok", { now: at(10, 2) }); reply(c, "no-damage", { now: at(10, 2) }); reply(c, "send-arrival-photos", { now: at(10, 2) }); reply(c, "send-arrival", { now: at(10, 2) }); reply(c, "linen-yes", { now: at(10, 3) });
  for (const r of ["Bed", "Bathroom", "Kitchen"]) shoot(c, ph("e-" + r), at(11, 0));
  reply(c, "leave:ac-ko", { now: at(11, 1) });
  ["gas", "wifi", "lights", "windows", "trash", "door"].forEach(k => reply(c, "leave:" + k, { now: at(11, 2) }));
  const t = reportText(c, { now: at(11, 30) });
  assert.match(t, /\n\*5 Leave:\* Gas works, now off ✓ · AC not working ✗ · Wi-Fi works ✓/);
  assert.match(t, /\*Problems \(1\):\*\n_Whole apartment_\n🟠 AC not working \(HK-461\)/);
});

test("tuile AC signalée pendant le ménage : ligne 5 « AC not working ✗ », un seul problème", () => {
  const c = createConversation(bloom, { me: ME, now: at(9, 0) });
  reply(c, "here", { now: at(10, 0) });
  card(c, at(10, 0));
  startProblem(c); chooseKind(c, "AC", { now: at(10, 1) }); flowReply(c, "no-photo"); flowReply(c, "save-text", { text: "not cooling" });
  for (const r of ["Bed", "Bathroom", "Kitchen"]) shoot(c, ph("a-" + r), at(10, 1));
  reply(c, "walls-ok", { now: at(10, 2) }); reply(c, "no-damage", { now: at(10, 2) }); reply(c, "send-arrival-photos", { now: at(10, 2) }); reply(c, "send-arrival", { now: at(10, 2) }); reply(c, "linen-yes", { now: at(10, 3) });
  for (const r of ["Bed", "Bathroom", "Kitchen"]) shoot(c, ph("e-" + r), at(11, 0));
  ["gas", "wifi", "lights", "windows", "trash", "door"].forEach(k => reply(c, "leave:" + k, { now: at(11, 2) }));
  assert.equal(currentStep(c).id, "low");
  const t = reportText(c, { now: at(11, 30) });
  assert.match(t, /AC not working ✗/);
  assert.match(t, /\*Problems \(1\):\*\n_Bed_\n🟠 AC: not cooling \(HK-461\)/);
});

test("ligne de problème sans 🎙 ; aucun fichier audio dans le partage", () => {
  const c = createConversation(bloom, { me: ME, now: at(9, 0) });
  reply(c, "here", { now: at(10, 0) });
  addProblem(c, "Broken", ph("p1"), { now: at(10, 1) });
  addProblemPhoto(c, 0, ph("p2"));
  c.problems[0].voice = { url: "pv", file: { name: "pv.webm" }, seconds: 5 }; // ancien format : ignoré
  const t = reportText(c, { now: at(10, 30) });
  assert.match(t, /\n🟠 Broken \(HK-461, 2 photos\)\n/);
  assert.equal(t.includes("🎙"), false);
  assert.deepEqual(pickFiles(c).files.map(f => f.name), ["p1.jpg", "p2.jpg"]);
});

// Revue finale (G7) : un probleme urgent dit ou en est son envoi. En file : « sending… » ;
// reponse avec sentTo : « sent to <nom>|the team HH:MM » ; reponse d'avant le champ sentTo :
// « team notified HH:MM ».
test("rapport : un urgent en file dit sending…, puis le destinataire de la reponse", () => {
  const ligne = () => reportText(c, { now: at(10, 30) }).split("\n").find(l => l.startsWith("🔴"));
  let n = 0;
  const newIdem = () => "idem" + String(++n).padStart(4, "0");
  const c = createConversation(bloom, { me: ME, now: at(9, 0) });
  reply(c, "here", { now: at(10, 0) });
  addProblem(c, "Leak", ph("p1"), { now: at(10, 3) });
  editProblem(c, 0, { urgency: "urgent" });
  const actions = syncPlan(c, { newIdem });
  const p = c.problems[0];
  assert.ok(actions.some(a => a.action === "v3.reportProblem" && a.body.idem === p.idem));
  assert.deepEqual(deliveryOf(c, p), { state: "sending" });
  assert.equal(ligne(), "🔴 Leak (HK-461, sending…)");
  assert.doesNotMatch(reportText(c, { now: at(10, 30) }), /sent to|team notified/);
  ackSync(c, p.idem, { ticketId: 77, sentTo: "Semax" });
  assert.equal(ligne(), "🔴 Leak (HK-461, sent to Semax 10:03)");
  ackSync(c, p.idem, { ticketId: 77, sentTo: null });
  assert.equal(ligne(), "🔴 Leak (HK-461, sent to the team 10:03)");
  // Reponse gardee avant le deploiement : pas de champ sentTo, le libelle d'avant reste.
  ackSync(c, p.idem, { ticketId: 77 });
  assert.deepEqual(deliveryOf(c, p), { state: "unknown" });
  assert.equal(ligne(), "🔴 Leak (HK-461, team notified 10:03)");
});

// ---- Carte d'accès (22/10) ----

test("rapport : ligne « Access card » avant l'arrivée ; MISSING, no photo ; la photo de la carte jointe en premier", () => {
  const c = createConversation(bloom, { me: ME, now: at(9, 0) });
  reply(c, "here", { now: at(10, 0) });
  assert.match(reportText(c, { now: at(10, 0) }), /\n\*Access card:\* no photo\n\*1 Arrival:\* none\n/);
  reply(c, "card-missing", { now: at(10, 1) });
  const t = reportText(c, { now: at(10, 5) });
  assert.match(t, /\n\n\*Access card:\* MISSING\n\*1 Arrival:\* none\n/);
  assert.match(t, /\*Problems \(1\):\*\n_Entrance & building_\n🟠 Access card missing \(HK-461\)/);
  // Carte photographiée : nombre de photos, et elle passe devant tout dans les fichiers joints.
  const d = createConversation(bloom, { me: ME, now: at(9, 0) });
  reply(d, "here", { now: at(10, 0) });
  addPhoto(d, ph("card1"), { now: at(10, 0) }); addPhoto(d, ph("card2"), { now: at(10, 0) }); reply(d, "next-room", { now: at(10, 0) });
  shoot(d, ph("a-Bed"), at(10, 1));
  addProblem(d, "Leak", ph("p1"), { now: at(10, 2) });
  assert.match(reportText(d, { now: at(10, 5) }), /\n\*Access card:\* 📷 2\n\*1 Arrival:\* Bed 📷 1\n/);
  assert.deepEqual(pickFiles(d).files.map(f => f.name), ["card1.jpg", "card2.jpg", "a-Bed.jpg", "p1.jpg"]);
  const cut = pickFiles(d, 2);
  assert.deepEqual(cut.files.map(f => f.name), ["card1.jpg", "card2.jpg"], "priorité à la carte, même devant les problèmes");
  assert.equal(cut.cutPhotos, true);
});

test("envoi d'arrivée : texte, photos de la carte, des pièces et des problèmes, puis rapport final sans doublon", () => {
  const c = createConversation(oxford, { me: ME, now: at(9, 0) });
  reply(c, "here", { now: at(9, 18) });
  card(c, at(9, 18));
  addProblem(c, "Broken", ph("p-broken"), { now: at(9, 19) });
  shoot(c, ph("a-Bed"), at(9, 19));
  shoot(c, ph("a-Bathroom"), at(9, 20));
  shoot(c, ph("a-Kitchen"), at(9, 20));
  reply(c, "check-ok", { now: at(9, 21) });
  reply(c, "walls-ok", { now: at(9, 21) }); reply(c, "no-damage", { now: at(9, 21) });
  assert.equal(currentStep(c).id, "arrival-send");
  assert.equal(currentStep(c).n, 2);
  assert.deepEqual(currentStep(c).replies.map(r => [r.id, r.label]), [["send-arrival-photos", "Send photos (1/2)"]]);
  const t = arrivalText(c, { now: at(9, 22) });
  assert.match(t, /^🔎 \*ARRIVAL CHECK · /);
  assert.match(t, /👤 Faiza · arrived 09:18 · sent 09:22\n/);
  assert.match(t, /\*Access card:\* 📷 1\n\*Rooms as found:\* Bed 📷 1 · Bathroom 📷 1 · Kitchen 📷 1\n\*Walls:\* OK\n/);
  assert.match(t, /\*Damage:\* none\n\*Problems \(1\):\*\n_Bed_\n🟠 Broken \(HK-461\)/);
  assert.match(t, /Cleaning starts now\. Final report after cleaning\.$/);
  assert.deepEqual(arrivalFiles(c).map(f => f.name), ["card.jpg", "a-Bed.jpg", "a-Bathroom.jpg", "a-Kitchen.jpg", "p-broken.jpg"]);
  reply(c, "send-arrival-photos", { now: at(9, 22) }); reply(c, "send-arrival", { now: at(9, 22) });
  assert.equal(currentStep(c).id, "linen");
  assert.equal(c.messages.filter(m => m.from === "me").pop().text, "Arrival check sent to the group");
  // Après l'envoi : une photo de plus sur le problème parti et un nouveau problème vont au rapport final.
  addProblemPhoto(c, 0, ph("p-broken-2"));
  reply(c, "linen-yes", { now: at(9, 30) });
  addProblem(c, "Leak", ph("p-leak"), { now: at(9, 40) });
  for (const r of ["Bed", "Bathroom", "Kitchen"]) shoot(c, ph("e-" + r), at(11, 0));
  assert.deepEqual(reportFiles(c).map(f => f.name), ["e-Bed.jpg", "e-Bathroom.jpg", "e-Kitchen.jpg", "p-broken-2.jpg", "p-leak.jpg"]);
  assert.match(reportText(c, { now: at(11, 30) }), /\*1 Arrival:\* Bed 📷 1 · Bathroom 📷 1 · Kitchen 📷 1 \(sent 09:22\)/);
});
