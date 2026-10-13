import { test } from "node:test";
import assert from "node:assert/strict";
import { APARTMENTS, ME } from "./fixtures.js";
import { createConversation, reply, addPhoto, addProblem, editProblem, addProblemPhoto, setProblemNote, chooseKind, startProblem, addFlowPhoto, flowReply, currentStep } from "../../v3/conv/conversation.js";
import { reportText, reportFiles, pickFiles, formatMinutes } from "../../v3/conv/report.js";

const [oxford, , bloom] = APARTMENTS;
const at = (h, m) => new Date(2026, 9, 2, h, m);
const ph = n => ({ url: "u" + n, file: { name: n + ".jpg" } });
const NB = " ";
const shoot = (c, p, t) => { addPhoto(c, p, { now: t }); reply(c, "next-room", { now: t }); };
const leaveAll = (c, t) => ["gas", "ac", "wifi", "lights", "windows", "trash", "door"].forEach(k => reply(c, "leave:" + k, { now: t }));

test("formatage des durées, espaces insécables", () => {
  assert.equal(formatMinutes(45), "45" + NB + "min");
  assert.equal(formatMinutes(100), "1" + NB + "h" + NB + "40");
});

test("rapport exact d'un studio sans problème", () => {
  const c = createConversation(bloom, { me: ME, now: at(9, 0) });
  reply(c, "here", { now: at(10, 0) });
  for (const r of ["Bed", "Bathroom", "Kitchen"]) shoot(c, ph("a-" + r), at(10, 1));
  reply(c, "walls-ok", { now: at(10, 2) }); reply(c, "no-damage", { now: at(10, 2) });
  reply(c, "linen-yes", { now: at(10, 3) });
  for (const r of ["Bed", "Bathroom", "Kitchen"]) shoot(c, ph("e-" + r), at(11, 30));
  leaveAll(c, at(11, 35));
  reply(c, "low-done", { now: at(11, 36) });
  reply(c, "send", { now: at(11, 40) });
  assert.equal(reportText(c, { now: at(11, 40) }), [
    "✅ *READY · 1011C Bloom Towers*",
    "Studio · Next guest: none booked yet",
    "👤 Faiza · 10:00 → 11:40 (1" + NB + "h" + NB + "40, usual 1" + NB + "h" + NB + "40)",
    "",
    "*1 Arrival:* Bed 📷 1 · Bathroom 📷 1 · Kitchen 📷 1",
    "*2 Damage:* none",
    "*Walls:* OK",
    "*3 Dirty linen:* 4 pillowcases, 1 bed sheet, 1 duvet cover, 3 bath towels, 1 bath mat",
    "*4 Rooms cleaned:* Bed 📷 1 · Bathroom 📷 1 · Kitchen 📷 1",
    "*5 Leave:* Gas works, now off ✓ · AC on, Auto mode ✓ · Wi-Fi works ✓ · Lights off ✓ · Windows & balcony closed ✓ · Trash taken out ✓ · Door locked, keys & card left inside ✓",
    "*Running low:* nothing",
    "*Problems:* none",
    "📷 3 arrival · 3 end · 0 of problems",
  ].join("\n"));
  assert.deepEqual(reportFiles(c).map(f => f.name), ["a-Bed.jpg", "a-Bathroom.jpg", "a-Kitchen.jpg", "e-Bed.jpg", "e-Bathroom.jpg", "e-Kitchen.jpg"]);
});

test("dégâts, vérification du manager, problèmes groupés, aucune ligne 🎙", () => {
  const c = createConversation(oxford, { me: ME, now: at(9, 0) });
  reply(c, "here", { now: at(9, 18) });
  addProblem(c, "Broken", ph("p-broken"), { now: at(9, 19) }); // signalé dans Bed, avant la photo qui fait avancer
  shoot(c, ph("a-Bed"), at(9, 19));
  shoot(c, ph("a-Bathroom"), at(9, 20));
  shoot(c, ph("a-Kitchen"), at(9, 20));
  reply(c, "check-see", { now: at(9, 22) });
  addFlowPhoto(c, ph("p-bug")); flowReply(c, "photos-done"); flowReply(c, "no-note");
  reply(c, "walls-ok", { now: at(9, 23) }); reply(c, "some-damage", { now: at(9, 23) });
  chooseKind(c, "Stain", { now: at(9, 24) }); addFlowPhoto(c, ph("p-stain")); flowReply(c, "photos-done"); flowReply(c, "no-note");
  reply(c, "damage-done", { now: at(9, 25) });
  reply(c, "linen-yes", { now: at(9, 26) });
  const t = reportText(c, { now: at(10, 0) });
  assert.match(t, /\n\*2 Damage:\* see problems\n\*Walls:\* OK\n\*Insects seen:\* Yes\n/);
  assert.match(t, /\*Problems \(3\):\*\n_Bed_\n🟠 Broken \(HK-461\)\n_Whole apartment_\n🟠 Insects \(HK-462\)\n🟠 Stain \(HK-463\)/);
  assert.equal(t.includes("🎙"), false, "plus de note vocale");
  assert.doesNotMatch(t, /voice/i);
  // urgent change a la main dans la fiche : « sent to the team »
  editProblem(c, 1, { urgency: "urgent" });
  assert.match(reportText(c, { now: at(10, 0) }), /🔴 Insects \(HK-462, sent to the team 09:22\)/);
  assert.match(t, /📷 3 arrival · 0 end · 3 of problems/);
});

test("plafond de 10 fichiers : problèmes, puis fin, puis arrivée", () => {
  const c = createConversation(bloom, { me: ME, now: at(9, 0) });
  reply(c, "here", { now: at(10, 0) });
  for (let i = 0; i < 6; i++) addPhoto(c, ph("a" + i), { now: at(10, 1) });
  reply(c, "next-room", { now: at(10, 1) });
  shoot(c, ph("aB"), at(10, 1)); shoot(c, ph("aK"), at(10, 1));
  reply(c, "walls-ok", { now: at(10, 2) }); reply(c, "no-damage", { now: at(10, 2) }); reply(c, "linen-yes", { now: at(10, 3) });
  addProblem(c, "Leak", ph("p1"), { now: at(10, 4) });
  for (const r of ["Bed", "Bathroom", "Kitchen"]) shoot(c, ph("e-" + r), at(11, 0));
  const pick = pickFiles(c);
  assert.equal(pick.files.length, 10);
  assert.deepEqual(pick.files.map(f => f.name).slice(-4), ["e-Bed.jpg", "e-Bathroom.jpg", "e-Kitchen.jpg", "p1.jpg"]);
  assert.equal(pick.cutPhotos, true);
  assert.equal("cutVoices" in pick, false);
  assert.match(reportText(c, { now: at(11, 30) }), /📷 8 arrival · 3 end · 1 of problems \(10 attached\)/);
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
  assert.match(t, /\n🟠 Broken, Sofa: tear on the left cushion \(HK-461, 3 photos\)\n🟠 Missing \(HK-462\)\n🔴 Leak: under the sink \(HK-463, sent to the team 10:03\)/);
  assert.deepEqual(pickFiles(c).files.map(f => f.name), ["p1.jpg", "p2.jpg", "p3.jpg", "m1.jpg"]);
  assert.match(t, /4 of problems/);
});

test("gaz not working : ✗ dans la ligne 5, problème Soon dans la liste", () => {
  const c = createConversation(bloom, { me: ME, now: at(9, 0) });
  reply(c, "here", { now: at(10, 0) });
  for (const r of ["Bed", "Bathroom", "Kitchen"]) shoot(c, ph("a-" + r), at(10, 1));
  reply(c, "walls-ok", { now: at(10, 2) }); reply(c, "no-damage", { now: at(10, 2) }); reply(c, "linen-yes", { now: at(10, 3) });
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
  for (const r of ["Bed", "Bathroom", "Kitchen"]) shoot(c, ph("a-" + r), at(10, 1));
  reply(c, "walls-ko", { now: at(10, 2) });
  addFlowPhoto(c, ph("w1")); addFlowPhoto(c, ph("w2"));
  flowReply(c, "photos-done");
  flowReply(c, "save-text", { text: "hole behind the door" });
  reply(c, "no-damage", { now: at(10, 5) });
  const t = reportText(c, { now: at(10, 30) });
  assert.match(t, /\n\*2 Damage:\* none\n\*Walls:\* see problems\n\*3 Dirty linen/);
  assert.match(t, /_Whole apartment_\n🟠 Wall damage: hole behind the door \(HK-461, 2 photos\)/);
});

test("AC not working : « AC not working ✗ » dans la ligne 5, problème Soon dans la liste", () => {
  const c = createConversation(bloom, { me: ME, now: at(9, 0) });
  reply(c, "here", { now: at(10, 0) });
  for (const r of ["Bed", "Bathroom", "Kitchen"]) shoot(c, ph("a-" + r), at(10, 1));
  reply(c, "walls-ok", { now: at(10, 2) }); reply(c, "no-damage", { now: at(10, 2) }); reply(c, "linen-yes", { now: at(10, 3) });
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
  startProblem(c); chooseKind(c, "AC", { now: at(10, 1) }); flowReply(c, "no-photo"); flowReply(c, "save-text", { text: "not cooling" });
  for (const r of ["Bed", "Bathroom", "Kitchen"]) shoot(c, ph("a-" + r), at(10, 1));
  reply(c, "walls-ok", { now: at(10, 2) }); reply(c, "no-damage", { now: at(10, 2) }); reply(c, "linen-yes", { now: at(10, 3) });
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
