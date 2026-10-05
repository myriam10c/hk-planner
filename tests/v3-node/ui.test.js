import { test } from "node:test";
import assert from "node:assert/strict";
import { APARTMENTS, ME, REF } from "./fixtures.js";
import { createConversation, reply, addPhoto, addProblem, addProblemPhoto, setProblemNote, editProblem, currentStep,
  startProblem, chooseKind, addFlowPhoto, flowReply, reopenProblem } from "../../v3/conv/conversation.js";
import * as UI from "../../v3/conv/ui.js";
const { renderList, renderConversation, renderViewfinder, renderToast, escapeHtml, renderPhotoView, renderKindScreen, renderProblemPhotos, renderNoteScreen, renderGasScreen, renderProblemPage, renderFlow } = UI;

const [oxford, creek, bloom] = APARTMENTS;
const now = new Date(2026, 9, 2, 10, 0);
// Une photo puis Next room, n fois.
const rooms = (c, n, p = "a") => { for (let i = 0; i < n; i++) { addPhoto(c, p, { now }); reply(c, "next-room", { now }); } };
const toLeave = c => { reply(c, "here", { now }); rooms(c, 3); reply(c, "walls-ok", { now }); reply(c, "no-damage", { now }); reply(c, "linen-yes", { now }); rooms(c, 3, "e"); };

test("liste : trois appartements de la journée réelle, Profile en haut", () => {
  const html = renderList({ me: ME, apartments: APARTMENTS, convs: {}, activeId: null, now });
  for (const a of APARTMENTS) assert.match(html, new RegExp('data-id="' + a.id + '"'));
  assert.match(html, /<a class="restart" href="#\/profile">Profile<\/a>/);
  assert.doesNotMatch(html, /Restart test|data-act="restart"/);
  assert.match(html, /<span class="row-name">122 Oxford Boulevard<\/span><span class="row-sub warn">Guest at 3 PM<\/span>/);
  assert.match(html, /<span class="row-name">1506 Emaar Creekside 18A<\/span><span class="row-sub">Started · No guest yet<\/span>/);
  assert.match(html, /<img class="avatar" alt="" src="https:\/\/hostaway-platform[^"]*bloom\.jpg">/);
});

test("liste : journée vide, bandeaux avant et après l'en-tête, ménage fini sur le serveur", () => {
  const vide = renderList({ me: ME, apartments: [], convs: {}, activeId: null, now, empty: "Nothing assigned to Faiza today." });
  assert.match(vide, /<p class="hint">Nothing assigned to Faiza today\.<\/p>/);
  assert.doesNotMatch(vide, /Tap the apartment/);
  const html = renderList({ me: ME, apartments: [{ ...bloom, state: "done", photo: null }], convs: {}, activeId: null, now, before: '<div class="viewas">V</div>', after: '<div class="offstrip">Q</div>' });
  assert.match(html, /^<div class="viewas">V<\/div><header class="top list-top">/);
  assert.match(html, /<\/header><div class="offstrip">Q<\/div><main class="list">/);
  assert.match(html, /<button class="row done"[^>]*><span class="avatar ph" aria-hidden="true">1011<\/span>/);
  assert.match(html, /Cleaning done/);
});

test("en-tête : étape et titre, puis chrono", () => {
  const c = createConversation(bloom, { me: ME, now });
  assert.match(renderConversation(c, { now }), /Step 1 of 5 · Arrival/);
  reply(c, "here", { now });
  rooms(c, 3);
  const html = renderConversation(c, { now: new Date(2026, 9, 2, 10, 12) });
  assert.match(html, /Step 2 of 5 · Damage &amp; problems · ⏱ 12 min/);
  assert.match(html, /data-reply="walls-ok">Walls OK</);
  assert.match(html, /data-reply="walls-ko">Marks or damage</);
  reply(c, "walls-ok", { now });
  const html2 = renderConversation(c, { now });
  assert.match(html2, /data-reply="no-damage"/);
  assert.match(html2, /data-reply="some-damage"/);
});

test("viseur épuré étape 1 : libellé, miniatures et nombre, déclencheur, Next room, un seul bouton Problem, aucune tuile", () => {
  const c = createConversation(bloom, { me: ME, now });
  reply(c, "here", { now });
  let html = renderViewfinder(c, { live: true });
  assert.doesNotMatch(html, /vf-guide|guide-btn|data-act="guide"|guide/i);
  assert.match(html, /Step 1 · Bed · as you find it/);
  assert.match(html, /data-reply="next-room" disabled>Next room</);
  assert.doesNotMatch(html, /class="count"/);
  assert.doesNotMatch(html, /data-kind=|class="kinds"/, "plus de grille de tuiles dans le viseur");
  assert.equal((html.match(/data-act="problem"/g) || []).length, 1);
  assert.match(html, /<button class="vf-problem" data-act="problem">⚠ Problem<\/button>/);
  assert.match(html, /data-act="shutter"/);
  addPhoto(c, { url: "blob:a" }, { now });
  html = renderViewfinder(c, { live: true });
  assert.match(html, /data-reply="next-room">Next room</);
  assert.match(html, /<span class="count">1 photo<\/span>/);
  assert.match(html, /<button class="vthumb" data-act="thumb" data-i="0" aria-label="Photo 1"><img alt="" src="blob:a"><\/button>/);
  addPhoto(c, { url: "blob:b" }, { now });
  html = renderViewfinder(c, { live: true });
  assert.match(html, /<span class="count">2 photos<\/span>/);
  assert.match(html, /data-act="thumb" data-i="1"/);
});

test("miniature agrandie : écran plein, Delete photo et Back", () => {
  const c = createConversation(bloom, { me: ME, now });
  reply(c, "here", { now });
  addPhoto(c, { url: "blob:a" }, { now }); addPhoto(c, { url: "blob:b" }, { now });
  const html = renderPhotoView(c, 1);
  assert.match(html, /^<section class="page photo-view">/);
  assert.match(html, /<img class="big" alt="" src="blob:b">/);
  assert.match(html, /data-act="photo-delete" data-i="1">Delete photo</);
  assert.match(html, /data-act="photo-back">Back</);
  assert.equal(renderPhotoView(c, 5), "");
});

test("viseur étape 4 : « when clean »", () => {
  const c = createConversation(bloom, { me: ME, now });
  reply(c, "here", { now }); rooms(c, 3);
  reply(c, "walls-ok", { now }); reply(c, "no-damage", { now }); reply(c, "linen-yes", { now });
  assert.match(renderViewfinder(c, { live: true }), /Step 4 · Bed · when clean/);
});

test("pièce sans photo de référence : pas d'image cassée", () => {
  const c = createConversation(bloom, { me: ME, now });
  reply(c, "here", { now }); rooms(c, 1); // Bathroom : pas de photo d'annonce
  assert.equal(currentStep(c).room, "Bathroom");
  const html = renderViewfinder(c, { live: true }) + renderConversation(c, { now });
  assert.doesNotMatch(html, /src=""|src="null"|src="undefined"/);
  assert.doesNotMatch(html, /vf-guide/);
});

test("étape 5 : sept lignes, gaz, AC et Wi-Fi à deux boutons, le gaz en rouge et en premier, Problem sous la liste, plus de micro", () => {
  const c = createConversation(bloom, { me: ME, now });
  toLeave(c);
  let html = renderConversation(c, { now });
  const keys = [...html.matchAll(/data-reply="leave:(\w+)"/g)].map(m => m[1]);
  assert.deepEqual(keys, ["gas", "ac", "wifi", "lights", "windows", "trash", "door"]);
  assert.match(html, /class="check danger[^"]*" data-reply="leave:gas"/);
  assert.match(html, /AC on, Auto mode/);
  // odeur de gaz au moment de « Gas off » : le signalement reste possible, outils sous la liste
  assert.match(html, /<button class="tool problem" data-act="problem">⚠ Problem<\/button>/);
  assert.doesNotMatch(html, /data-act="camera"/, "le bouton caméra devient Problem");
  // plus de note vocale : aucun micro dans la barre
  assert.doesNotMatch(html, /data-act="mic"|data-act="hold"|class="tool mic"/);
  assert.match(html, /<div class="lrow2"><button class="check" data-reply="leave:ac"><span class="box"><\/span>AC on, Auto mode<\/button><button class="ko" data-reply="leave:ac-ko">AC not working<\/button><\/div>/);
  assert.ok(html.indexOf('class="checks"') < html.indexOf('class="tools"'), "outils sous la liste de sortie");
  reply(c, "leave:gas", { now });
  html = renderConversation(c, { now });
  assert.match(html, /class="check danger on" data-reply="leave:gas"/);
  reply(c, "leave:wifi-ko", { now });
  html = renderConversation(c, { now });
  assert.match(html, /<button class="check" data-reply="leave:wifi"><span class="box"><\/span>Wi-Fi works<\/button><button class="ko on" data-reply="leave:wifi-ko">✗ Wi-Fi not working<\/button>/);
  reply(c, "leave:ac-ko", { now });
  html = renderConversation(c, { now });
  assert.match(html, /<button class="ko on" data-reply="leave:ac-ko">✗ AC not working<\/button>/);
});

test("étape 5 pré-réglée : AC signalée pendant le ménage, la ligne s'affiche déjà sur AC not working", () => {
  const c = createConversation(bloom, { me: ME, now });
  reply(c, "here", { now });
  addProblem(c, "AC", null, { now });
  rooms(c, 3); reply(c, "walls-ok", { now }); reply(c, "no-damage", { now }); reply(c, "linen-yes", { now }); rooms(c, 3, "e");
  const html = renderConversation(c, { now });
  assert.match(html, /<button class="check" data-reply="leave:ac"><span class="box"><\/span>AC on, Auto mode<\/button><button class="ko on" data-reply="leave:ac-ko">✗ AC not working<\/button>/);
});

test("odeur de gaz : bulle d'alerte dans le fil ; bandeau « Saved » sans bouton", () => {
  const c = createConversation(bloom, { me: ME, now });
  reply(c, "here", { now });
  addProblem(c, "Gas smell", null, { now });
  assert.match(renderConversation(c, { now }), /class="msg app alert"[\s\S]*Open the windows\. Do not touch switches\. Leave and call Walter\./);
  addProblem(c, "Leak", null, { now });
  const t = renderToast(c.problems[1]);
  assert.equal(t, '<div class="toast saved" role="status">Saved: Leak · Bed</div>');
  assert.doesNotMatch(t, /<button/);
});

test("appartement à deux : jamais de Send, puis Add to Pionah's report", () => {
  const c = createConversation(creek, { me: ME, now });
  reply(c, "here", { now });
  while (currentStep(c).id === "end-photo") { assert.doesNotMatch(renderConversation(c, { now }), /data-reply="send"/); rooms(c, 1, "r"); }
  const html = renderConversation(c, { now });
  assert.doesNotMatch(html, /data-reply="send"/);
  assert.match(html, /Add to Pionah's report/);
});

test("contraste : le studio arrive au bouton Send", () => {
  const c = createConversation(bloom, { me: ME, now });
  toLeave(c);
  ["gas", "ac", "wifi", "lights", "windows", "trash", "door"].forEach(k => reply(c, "leave:" + k, { now }));
  reply(c, "low-done", { now });
  assert.match(renderConversation(c, { now }), /data-reply="send"/);
});

test("échappement et aucun tiret cadratin", () => {
  assert.equal(escapeHtml('<a href="x">&</a>'), "&lt;a href=&quot;x&quot;&gt;&amp;&lt;/a&gt;");
  const c = createConversation(oxford, { me: ME, now });
  const all = renderList({ me: ME, apartments: APARTMENTS, convs: {}, activeId: null, now }) + renderConversation(c, { now }) + renderViewfinder(c, { live: false });
  assert.equal(all.includes("—"), false);
});

test("sans caméra : image fixe de l'annonce assombrie, jamais de bouton guide", () => {
  const c = createConversation(bloom, { me: ME, now });
  reply(c, "here", { now }); // Bed : photo de l'annonce
  const html = renderViewfinder(c, { live: false });
  assert.equal(html.includes('<img class="vf-still" alt="" src="' + REF("bl-Bed") + '">'), true);
  assert.doesNotMatch(html, /data-act="guide"/);
});

test("liste : ni pastille du nombre d'étapes internes, « Step N of 5 » quand le ménage est en cours", () => {
  const c = createConversation(bloom, { me: ME, now });
  let html = renderList({ me: ME, apartments: APARTMENTS, convs: { [bloom.id]: c }, activeId: bloom.id, now });
  assert.doesNotMatch(html, /class="badge"/);
  assert.doesNotMatch(html, /Step \d of 5/, "rien avant « I'm here »");
  reply(c, "here", { now });
  rooms(c, 3);
  html = renderList({ me: ME, apartments: APARTMENTS, convs: { [bloom.id]: c }, activeId: bloom.id, now: new Date(2026, 9, 2, 10, 12) });
  assert.match(html, /Step 2 of 5 · 12\u00a0min/);
  assert.doesNotMatch(html, /class="badge"/);
  // l'aide de 1506 : étape 4 dès son arrivée
  const h = createConversation(creek, { me: ME, now });
  reply(h, "here", { now });
  assert.match(renderList({ me: ME, apartments: APARTMENTS, convs: { [creek.id]: h }, activeId: creek.id, now }), /Step 4 of 5/);
});

test("linge : pas de rangée caméra/micro pendant l'édition (inchangé)", () => {
  const c = createConversation(bloom, { me: ME, now });
  reply(c, "here", { now }); rooms(c, 3);
  reply(c, "walls-ok", { now }); reply(c, "no-damage", { now }); reply(c, "linen-change", { now });
  assert.doesNotMatch(renderConversation(c, { now }), /data-act="problem"|data-act="camera"/);
});

test("étape photo, viseur fermé : bouton pour rouvrir la caméra dans la barre", () => {
  const c = createConversation(bloom, { me: ME, now });
  reply(c, "here", { now });
  assert.match(renderConversation(c, { now }), /<button class="reply" data-act="camera">📷 Camera<\/button>/);
  rooms(c, 3);
  assert.doesNotMatch(renderConversation(c, { now }), /data-act="camera"/);
});

test("écran « What is the problem? » : 10 grandes tuiles sur 2 colonnes et Cancel", () => {
  const c = createConversation(bloom, { me: ME, now });
  reply(c, "here", { now });
  startProblem(c);
  const html = renderKindScreen(c);
  assert.match(html, /^<section class="page kinds-page">/);
  assert.match(html, /<h1>What is the problem\?<\/h1>/);
  assert.equal((html.match(/data-kind="/g) || []).length, 10);
  assert.match(html, /<button class="kind" data-kind="Gas smell"><svg/);
  assert.ok(html.indexOf('data-kind="Gas smell"') < html.indexOf('data-kind="Leak"'));
  assert.match(html, /data-flow="cancel">Cancel</);
  assert.equal(renderFlow(c, { live: true }), html, "renderFlow choisit l'écran de l'étape du signalement");
});

test("écran « Take photos of it » : titre Type · endroit, déclencheur, miniatures, Done actif dès une photo, lien No photo", () => {
  const c = createConversation(bloom, { me: ME, now });
  reply(c, "here", { now });
  startProblem(c);
  chooseKind(c, "Leak", { now });
  let html = renderProblemPhotos(c, { live: true });
  assert.match(html, /<b>Leak · Bed<\/b>/);
  assert.match(html, /Take photos of it/);
  assert.match(html, /data-act="flow-shutter"/);
  assert.match(html, /data-flow="photos-done" disabled>Done</);
  assert.match(html, /<button class="lnk light" data-flow="no-photo">No photo<\/button>/);
  assert.match(html, /data-flow="back"/, "pas encore de photo : retour aux tuiles possible");
  assert.doesNotMatch(html, /data-kind=/);
  addFlowPhoto(c, { url: "blob:l1" });
  html = renderProblemPhotos(c, { live: true });
  assert.match(html, /data-flow="photos-done">Done</);
  assert.match(html, /<span class="count">1 photo<\/span>/);
  assert.match(html, /<img alt="" src="blob:l1">/);
  assert.doesNotMatch(html, /data-flow="back"/);
  assert.match(renderProblemPhotos(c, { live: false }), /Tap the circle to open your camera/);
  assert.equal(renderFlow(c, { live: true }), html);
});

test("écran « What happened? » : texte seulement, conseil du micro du clavier, Save sous la zone, No note dessous", () => {
  const c = createConversation(bloom, { me: ME, now });
  reply(c, "here", { now });
  startProblem(c); chooseKind(c, "Broken", { now }); flowReply(c, "no-photo");
  const html = renderNoteScreen(c);
  assert.match(html, /^<section class="page note-page">/);
  assert.match(html, /<b>Broken · Bed<\/b>/);
  assert.match(html, /<h1>What happened\?<\/h1>/);
  assert.match(html, /<p class="note-tip">Tip: tap the microphone on your keyboard and talk, the phone writes for you\.<\/p>/);
  assert.match(html, /<textarea id="problem-note" maxlength="300" data-index="0" rows="4" placeholder="Type or tap 🎤 on your keyboard to speak"><\/textarea><div class="type-acts"><button class="reply main" data-flow="save-text">Save<\/button><\/div>/, "Save juste sous la zone de texte (visible au-dessus du clavier)");
  assert.match(html, /data-flow="save-text">Save<\/button><\/div><p class="note-tip">[^<]*<\/p><div class="page-foot"><button class="reply" data-flow="no-note">No note<\/button><\/div><\/section>$/, "conseil sous Save (Save reste haut, au-dessus du clavier), No note en dessous");
  assert.doesNotMatch(html, /data-act="hold"|data-act="play"|Hold to talk|Record|Type instead|voice/i);
  assert.equal(renderFlow(c, { live: true }), html);
  for (const gone of ["renderTypeScreen", "holdRecordingHtml"]) assert.equal(gone in UI, false, gone + " retiré");
});

test("écran de note depuis la page du problème : note existante échappée, Back au lieu de No note", () => {
  const c = createConversation(bloom, { me: ME, now });
  reply(c, "here", { now });
  addProblem(c, "Broken", null, { now });
  setProblemNote(c, 0, 'big <b>crack</b> & "hole"');
  reopenProblem(c, 0, "note");
  const html = renderNoteScreen(c);
  assert.match(html, /<textarea id="problem-note" maxlength="300" data-index="0"[^>]*>big &lt;b&gt;crack&lt;\/b&gt; &amp; &quot;hole&quot;<\/textarea>/);
  assert.match(html, /data-flow="no-note">Back</);
});

test("écran rouge du gaz : consigne en très grand et OK", () => {
  const c = createConversation(bloom, { me: ME, now });
  reply(c, "here", { now });
  startProblem(c); chooseKind(c, "Gas smell", { now });
  const html = renderGasScreen(c);
  assert.match(html, /^<section class="page gas-page" role="alert">/);
  assert.match(html, /<p class="gas-text">Open the windows\. Do not touch switches\. Leave and call Walter\.<\/p>/);
  assert.match(html, /<button class="gas-ok" data-flow="gas-ok">OK<\/button>/);
  assert.equal(renderFlow(c, { live: true }), html);
});

test("page d'un problème : photos et Add photo, note et Edit note, Place, Urgency, Delete confirmé sur la page", () => {
  const c = createConversation(bloom, { me: ME, now });
  reply(c, "here", { now });
  addProblem(c, "Broken", { url: "img/b1.jpg" }, { now });
  addProblemPhoto(c, 0, { url: "img/b2.jpg" });
  setProblemNote(c, 0, "tear <here>");
  let html = renderProblemPage(c, 0, {});
  assert.match(html, /^<section class="page edit-page">/);
  assert.match(html, /<button class="back-btn" data-act="edit-back"><svg[^>]*>.*?<\/svg>Back<\/button>/, "Back écrit en toutes lettres en haut");
  assert.match(html, /<div class="page-foot"><button class="reply main" data-act="edit-back">Done<\/button><\/div><\/section>$/, "Done en bas");
  assert.match(html, /<h1>Broken · Bed<\/h1>/);
  assert.equal((html.match(/<img class="pthumb"/g) || []).length, 2);
  assert.match(html, /data-act="edit-photos">Add photo</);
  assert.match(html, /<div class="eline"><h2>Note<\/h2><p class="pnote">tear &lt;here&gt;<\/p><button class="reply" data-act="edit-note">Edit note<\/button><\/div>/);
  assert.doesNotMatch(html, /data-act="play"|edit-record|edit-type|Record|Type instead/);
  assert.equal((html.match(/data-where="/g) || []).length, 5);
  assert.match(html, /class="chip on" data-where="Bed"/);
  assert.deepEqual([...html.matchAll(/data-urgency="(\w+)"/g)].map(m => m[1]), ["urgent", "soon", "later"]);
  assert.match(html, /data-act="delete-ask">Delete problem</);
  assert.doesNotMatch(html, /Yes, delete/);
  html = renderProblemPage(c, 0, { confirmDelete: true });
  assert.match(html, /Delete\?/);
  assert.match(html, /data-act="delete" data-index="0">Yes, delete</);
  assert.match(html, /data-act="delete-no">No</);
  // sans note : « No note », toujours Edit note
  setProblemNote(c, 0, "");
  assert.match(renderProblemPage(c, 0, {}), /<p class="muted">No note<\/p><button class="reply" data-act="edit-note">Edit note<\/button>/);
  assert.equal(renderProblemPage(c, 4, {}), "");
});

test("aucune fiche (sheet) ni tiret cadratin dans tous les écrans", () => {
  const c = createConversation(oxford, { me: ME, now });
  reply(c, "here", { now });
  addPhoto(c, { url: "a" }, { now });
  startProblem(c);
  const all = [renderConversation(c, { now }), renderViewfinder(c, { live: true }), renderPhotoView(c, 0), renderKindScreen(c)];
  chooseKind(c, "Leak", { now });
  all.push(renderProblemPhotos(c, { live: false }));
  flowReply(c, "no-photo");
  all.push(renderNoteScreen(c));
  flowReply(c, "save-text", { text: "x" });
  all.push(renderProblemPage(c, 0, { confirmDelete: true }), renderToast(c.problems[0]));
  startProblem(c); chooseKind(c, "Gas smell", { now });
  all.push(renderGasScreen(c));
  const html = all.join("");
  assert.doesNotMatch(html, /sheet/i);
  assert.equal(html.includes("\u2014"), false);
  assert.equal("renderProblemSheet" in UI, false);
});

test("bulle d'un problème : jamais de « 🎙 », la note tapée s'affiche", () => {
  const c = createConversation(bloom, { me: ME, now });
  reply(c, "here", { now });
  addProblem(c, "AC", null, { now });
  setProblemNote(c, 0, "not cooling");
  const html = renderConversation(c, { now });
  assert.match(html, /<span class="pnote">not cooling<\/span><span>Bed<\/span>/);
  assert.equal(html.includes("🎙"), false);
});
