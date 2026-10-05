// Rendu HTML pur, façon WhatsApp. Aucune lecture du DOM ici : testable sous Node.
// Porté du prototype : la liste reçoit les appartements de la journée réelle (day.js).
import { LINEN_USUAL, GROUP_NAME, aptLabel } from "./rules.js";
import { KINDS, URGENCY } from "./problems.js";
import { currentStep, currentFlow, elapsedMinutes, isHelper } from "./conversation.js";
import { reportText, formatMinutes } from "./report.js";
import { finishAcked } from "./sync.js";

export const escapeHtml = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const waFormat = t => escapeHtml(t).replace(/\*([^*\n]+)\*/g, "<b>$1</b>").replace(/_([^_\n]+)_/g, "<i>$1</i>").replace(/\n/g, "<br>");
const src = p => (p && typeof p === "object" ? p.url : p);
const imgTag = (p, cls = "") => (src(p) ? "<img" + (cls ? ' class="' + cls + '"' : "") + ' alt="" src="' + escapeHtml(src(p)) + '">' : "");

const I = {
  back: '<svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M15 5l-7 7 7 7"/></svg>',
  cam: '<svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg>',
  close: '<svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  box: '<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="3" stroke-linejoin="round"><path d="M6 15l18-8 18 8v18l-18 8-18-8z"/><path d="M6 15l18 8 18-8M24 23v18"/></svg>',
  broken: '<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="3" stroke-linejoin="round"><path d="M8 10h32v28H8z"/><path d="M22 10l-4 10 8 4-4 14"/></svg>',
  water: '<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="3" stroke-linejoin="round"><path d="M24 6s13 15 13 24a13 13 0 0 1-26 0c0-9 13-24 13-24z"/></svg>',
  ac: '<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><path d="M24 6v36M8.4 15l31.2 18M8.4 33l31.2-18"/></svg>',
  light: '<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="3" stroke-linejoin="round"><path d="M17 30a12 12 0 1 1 14 0v5H17z"/><path d="M19 41h10"/></svg>',
  bug: '<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><ellipse cx="24" cy="28" rx="9" ry="12"/><path d="M24 16v24M15 22l-7-4M33 22l7-4M15 30H7M33 30h8M16 37l-6 5M32 37l6 5"/></svg>',
  spray: '<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="3" stroke-linejoin="round"><path d="M14 20h14v22H14z"/><path d="M17 20v-6h8v6M25 14h6l3-4M38 16h3"/></svg>',
  trash: '<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="3" stroke-linejoin="round"><path d="M8 12h32M18 12V7h12v5M12 12l2 29h20l2-29"/></svg>',
  gas: '<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="3" stroke-linejoin="round"><path d="M24 6c2 8 12 12 12 24a12 12 0 0 1-24 0c0-6 4-9 6-14 2 4 4 5 6 5-2-5-1-10 0-15z"/></svg>',
  bag: '<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="3" stroke-linejoin="round"><path d="M10 16h28l-2 26H12z"/><path d="M18 16v-3a6 6 0 0 1 12 0v3"/></svg>',
};

// Avatar : photo de l'annonce, ou pastille au numéro quand l'annonce n'a pas d'image.
function avatar(a, cls) {
  if (a.photo) return imgTag(a.photo, cls);
  return '<span class="' + cls + ' ph" aria-hidden="true">' + escapeHtml((a.num || a.building || "?").slice(0, 4)) + "</span>";
}

function rowStatus(apt, conv, now) {
  // ✓✓ quand le proxy a reçu la fin du ménage (finishJob), ✓ tant qu'elle attend dans la file.
  if (conv && conv.sent) return isHelper(conv) && !conv.linenNeeded ? "Added to " + apt.lead.name + "'s report" : "Report sent " + (finishAcked(conv) ? "✓✓" : "✓");
  // Étape visible (1 à 5), jamais le nombre d'étapes internes.
  if (conv && conv.startedAt) return "Step " + currentStep(conv).n + " of 5 · " + formatMinutes(elapsedMinutes(conv, now));
  // État enregistré sur le serveur (journée réelle), sans conversation sur ce téléphone.
  if (!conv && apt.state === "done") return "Cleaning done";
  if (!conv && apt.state === "running") return "Started · " + apt.guest.label;
  return apt.guest.label;
}

// Liste du jour. `apartments` : la journée réelle (day.js) ; `before` : bandeau de mode (View as /
// Practice) au-dessus de l'en-tête ; `after` : bandeau des gestes en attente, sous l'en-tête ;
// `empty` : texte d'une journée vide.
export function renderList({ me, apartments, convs, activeId, now, before = "", after = "", empty = "Nothing assigned to you today." }) {
  const busy = activeId && convs[activeId] && !convs[activeId].readOnly && convs[activeId].startedAt && !convs[activeId].sent;
  const rows = apartments.map(a => {
    // Conversation en lecture seule (View as) : la ligne garde l'état du serveur.
    const c = convs[a.id] && !convs[a.id].readOnly ? convs[a.id] : null;
    const locked = busy && a.id !== activeId;
    const done = (c && c.sent) || (!c && a.state === "done");
    const warn = !c && !done && a.guest.hoursAway !== null && a.guest.hoursAway <= 24;
    return '<button class="row' + (done ? " done" : "") + '" data-act="open" data-id="' + escapeHtml(a.id) + '"' + (locked ? " disabled" : "") + ">" +
      avatar(a, "avatar") +
      '<span class="row-main"><span class="row-name">' + escapeHtml(aptLabel(a)) + "</span>" +
      '<span class="row-sub' + (warn ? " warn" : "") + '">' + escapeHtml(rowStatus(a, c, now)) + "</span></span>" +
      "</button>";
  }).join("");
  const date = now.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "Asia/Dubai" });
  // Profile en haut à droite, hors de la zone du pouce : compte, envois en échec, déconnexion, View as / Practice.
  return before + '<header class="top list-top"><div><b>Hi ' + escapeHtml(me.name) + "</b><span>" + escapeHtml(date) + '</span></div><a class="restart" href="#/profile">Profile</a></header>' +
    after +
    '<main class="list">' + (apartments.length ? '<p class="hint">Tap the apartment you start with.</p>' + rows : '<p class="hint">' + escapeHtml(empty) + "</p>") + "</main>";
}

function bubble(conv, m) {
  const ticks = m.from === "me" ? '<span class="ticks">' + (m.status === "synced" ? "✓✓" : "✓") + "</span>" : "";
  if (m.type === "report") {
    return '<div class="msg app report"><div class="report-h">Your report for ' + escapeHtml(GROUP_NAME) + "</div>" + waFormat(reportText(conv)) + "</div>";
  }
  if (m.type === "photo") return '<div class="msg me photo">' + imgTag(m.photo, "shot") + ticks + "</div>";
  if (m.type === "problem") {
    const p = conv.problems[m.problemIndex];
    if (!p) return "";
    const n = p.photos.length;
    return '<button class="msg me problem u-' + p.urgency + '" data-act="edit" data-index="' + m.problemIndex + '">' +
      (p.photos[0] ? imgTag(p.photos[0], "shot") : "") +
      "<b>" + URGENCY[p.urgency].dot + " " + escapeHtml(p.kind + (p.detail ? " · " + p.detail : "")) + "</b>" +
      (p.note ? '<span class="pnote">' + escapeHtml(p.note) + "</span>" : "") +
      "<span>" + escapeHtml(p.where) + (p.notified ? " · team notified" : "") + (n > 1 ? " · " + n + " photos" : "") + "</span>" + ticks + "</button>";
  }
  const who = m.from === "lead" ? '<span class="who">' + escapeHtml(conv.apt.lead.name) + "</span>" : "";
  return '<div class="msg ' + m.from + (m.alert ? " alert" : "") + '">' + who + (m.photo ? imgTag(m.photo, "ref") : "") + "<p>" + escapeHtml(m.text) + "</p>" + ticks + "</div>";
}

function linenEditor(conv) {
  return '<div class="linen">' + LINEN_USUAL.map(l =>
    '<div class="lrow"><span>' + escapeHtml(l.many[0].toUpperCase() + l.many.slice(1)) + "</span>" +
    '<button class="step" data-reply="linen-dec:' + l.key + '" aria-label="Less">−</button><output>' + conv.linen[l.key] + "</output>" +
    '<button class="step" data-reply="linen-inc:' + l.key + '" aria-label="More">+</button></div>').join("") + "</div>";
}

// Gaz, AC et Wi-Fi : une rangée à deux boutons, « not working » à droite (plus petit, contour rouge).
function leaveList(conv, step) {
  return '<div class="checks">' + step.replies.filter(r => !r.id.endsWith("-ko")).map(r => {
    const key = r.id.slice(6), v = conv.leave[key];
    const main = '<button class="check' + (key === "gas" ? " danger" : "") + (v === true ? " on" : "") + '" data-reply="' + r.id + '"><span class="box">' + (v === true ? "✓" : "") + "</span>" + escapeHtml(r.label) + "</button>";
    const ko = step.replies.find(x => x.id === r.id + "-ko");
    if (!ko) return main;
    return '<div class="lrow2">' + main + '<button class="ko' + (v === "ko" ? " on" : "") + '" data-reply="' + ko.id + '">' + (v === "ko" ? "✗ " : "") + escapeHtml(ko.label) + "</button></div>";
  }).join("") + "</div>";
}

function replyButtons(step) {
  return step.replies.map(r => '<button class="reply' + (r.label.startsWith("✓ ") ? " on" : "") + '" data-reply="' + escapeHtml(r.id) + '"' + (r.enabled ? "" : " disabled") + ">" + escapeHtml(r.label) + "</button>").join("");
}

// View as : en-tête « Read only · <état> », fil reconstruit, aucune réponse ni outil.
function renderReadOnly(conv, before) {
  const a = conv.apt;
  const head = '<header class="top"><button class="icon" data-act="back" aria-label="Back">' + I.back + "</button>" +
    avatar(a, "avatar small") + '<div class="title"><b>' + escapeHtml(aptLabel(a)) + "</b><span>" + escapeHtml("Read only · " + (conv.viewStatus || "")) + "</span></div></header>";
  const thread = '<main class="thread" id="thread">' + conv.messages.map(m => bubble(conv, m)).join("") + "</main>";
  const bar = '<footer class="bar"><p class="help">Read only. Only ' + escapeHtml(conv.me.name) + " can answer here.</p></footer>";
  return before + head + thread + bar;
}

export function renderConversation(conv, { now = new Date(), before = "" } = {}) {
  if (conv.readOnly) return renderReadOnly(conv, before);
  const a = conv.apt;
  const step = currentStep(conv);
  const stepTxt = "Step " + step.n + " of 5 · " + step.title;
  const sub = conv.startedAt ? stepTxt + " · ⏱ " + formatMinutes(elapsedMinutes(conv, now)).replace(/\u00a0/g, " ") : stepTxt; // espace normale dans l'en-tête (formatMinutes insère des insécables pour le rapport)
  const head = '<header class="top"><button class="icon" data-act="back" aria-label="Back">' + I.back + "</button>" +
    avatar(a, "avatar small") + '<div class="title"><b>' + escapeHtml(aptLabel(a)) + "</b><span>" + escapeHtml(sub) + "</span></div></header>";
  // Édition du linge : fil sans marges pour que l'éditeur tienne sur un iPhone SE (~520 px).
  const thread = '<main class="thread' + (step.editor === "linen" ? " slim" : "") + '" id="thread">' + conv.messages.map(m => bubble(conv, m)).join("") + "</main>";
  // Pendant l'édition du linge, pas de bouton Problem : tout tient sur un petit écran.
  // Pendant la sortie, la rangée reste sous la liste : une odeur de gaz au moment de « Gas off » se signale.
  const showTools = conv.startedAt && step.id !== "done" && !conv.sent && step.editor !== "linen";
  // Étape photo, viseur fermé (croix du viseur) : un bouton pour le rouvrir.
  const camBtn = step.camera ? '<button class="reply" data-act="camera">📷 Camera</button>' : "";
  const endHelper = step.id === "done" && isHelper(conv) ? '<button class="reply" data-act="back">Back to my apartments</button>' : "";
  const help = step.id === "report" ? '<p class="help">Choose WhatsApp, then ' + escapeHtml(GROUP_NAME) + "</p>" : "";
  const bar = '<footer class="bar">' + (step.editor === "linen" ? linenEditor(conv) : "") +
    (step.editor === "leave" ? leaveList(conv, step) : '<div class="replies' + (step.id === "low" ? " grid" : "") + '">' + camBtn + replyButtons(step) + endHelper + "</div>") + help +
    // ⚠ Problem (rouge) remplace l'ancien bouton caméra. Plus de micro : un vocal ne part pas avec le message WhatsApp (05/10).
    (showTools ? '<div class="tools"><button class="tool problem" data-act="problem">⚠ Problem</button></div>' : "") +
    "</footer>";
  return before + head + thread + bar;
}

// Le <video id="vf"> est permanent (index.html) : il n'est jamais recréé par un rendu.
// Ici, seulement la surcouche (fond transparent en direct, image fixe assombrie sans caméra).
const still = (live, p) => (live ? "" : imgTag(p, "vf-still"));
const countTag = n => (n ? '<span class="count">' + n + " photo" + (n > 1 ? "s" : "") + "</span>" : "");
const shutterBtn = (live, act) => '<button class="shutter' + (live ? "" : " cam") + '" data-act="' + act + '" aria-label="Take photo">' + (live ? "" : I.cam) + "</button>";
const noCamMsg = live => (live ? "" : '<p class="vf-msg">Tap the circle to open your camera</p>');

// Viseur épuré d'une pièce (étapes 1 et 4) : libellé, flux, miniatures et nombre, déclencheur, Next room, un seul ⚠ Problem.
export function renderViewfinder(conv, { live }) {
  const step = currentStep(conv);
  if (step.id !== "arrival-photo" && step.id !== "end-photo") return "";
  const room = step.room;
  const list = (step.id === "arrival-photo" ? conv.arrivalPhotos : conv.endPhotos)[room] || [];
  const label = step.id === "arrival-photo" ? "Step 1 · " + room + " · as you find it" : "Step 4 · " + room + " · when clean";
  const thumbs = list.map((p, i) => '<button class="vthumb" data-act="thumb" data-i="' + i + '" aria-label="Photo ' + (i + 1) + '">' + imgTag(p) + "</button>").join("");
  return '<div class="vf' + (live ? " live" : "") + '">' + still(live, step.ref || conv.apt.photo) + '<div class="flash"></div>' +
    '<div class="vf-top"><button class="icon light" data-act="close-camera" aria-label="Close">' + I.close + "</button><b>" + escapeHtml(label) + "</b></div>" +
    noCamMsg(live) +
    '<div class="vf-bottom">' +
    (list.length ? '<div class="vthumbs">' + thumbs + countTag(list.length) + "</div>" : "") +
    '<div class="vf-row"><button class="vf-problem" data-act="problem">⚠ Problem</button>' + shutterBtn(live, "shutter") +
    '<span class="vf-row-end">' + replyButtons({ replies: step.replies }) + "</span></div>" +
    "</div></div>";
}

// Miniature touchée : la photo en grand, [Delete photo] / [Back] (écran plein, pas de fenêtre).
export function renderPhotoView(conv, i) {
  const step = currentStep(conv);
  const list = step.id === "arrival-photo" ? conv.arrivalPhotos[step.room] : step.id === "end-photo" ? conv.endPhotos[step.room] : null;
  const p = list && list[i];
  if (!p) return "";
  return '<section class="page photo-view">' + imgTag(p, "big") +
    '<div class="page-foot"><button class="reply danger" data-act="photo-delete" data-i="' + i + '">Delete photo</button><button class="reply" data-act="photo-back">Back</button></div></section>';
}

// Écran a. « What is the problem? » : les 10 tuiles en grand, 2 colonnes.
export function renderKindScreen() {
  return '<section class="page kinds-page"><h1>What is the problem?</h1><div class="kinds">' +
    KINDS.map(k => '<button class="kind" data-kind="' + escapeHtml(k.key) + '">' + I[k.icon] + "<span>" + escapeHtml(k.key) + "</span></button>").join("") +
    '</div><div class="page-foot"><button class="reply" data-flow="cancel">Cancel</button></div></section>';
}

// Écran c. « Take photos of it » : viseur, miniatures et nombre, [Done] dès une photo, petit lien « No photo ».
export function renderProblemPhotos(conv, { live }) {
  const f = currentFlow(conv);
  if (!f || f.stage !== "photos") return "";
  const p = f.problem;
  const thumbs = p.photos.map(ph => '<span class="vthumb">' + imgTag(ph) + "</span>").join("");
  const done = f.replies.find(r => r.id === "photos-done");
  const noPhoto = f.replies.some(r => r.id === "no-photo") ? '<button class="lnk light" data-flow="no-photo">No photo</button>' : "";
  return '<div class="vf flow-vf' + (live ? " live" : "") + '">' + still(live, conv.apt.photo) + '<div class="flash"></div>' +
    '<div class="vf-top">' + (f.back ? '<button class="icon light" data-flow="back" aria-label="Back">' + I.back + "</button>" : "") +
    '<div class="vf-title"><b>' + escapeHtml(f.title) + "</b><span>Take photos of it</span></div></div>" +
    noCamMsg(live) +
    '<div class="vf-bottom">' +
    (p.photos.length ? '<div class="vthumbs">' + thumbs + countTag(p.photos.length) + "</div>" : "") +
    '<div class="vf-row"><span class="vf-row-start">' + noPhoto + "</span>" + shutterBtn(live, "flow-shutter") +
    '<span class="vf-row-end"><button class="reply" data-flow="photos-done"' + (done.enabled ? "" : " disabled") + ">Done</button></span></div>" +
    "</div></div>";
}

const flowBtn = (r, cls = "reply") => '<button class="' + cls + '" data-flow="' + r.id + '"' + (r.enabled ? "" : " disabled") + ">" + escapeHtml(r.label) + "</button>";

// Écran d. « What happened? » : texte seulement (05/10). Grande zone de texte, [Save] juste dessous (visible au-dessus
// du clavier), puis le conseil du micro du clavier (lu avant de toucher la zone) et [No note] en bas.
export function renderNoteScreen(conv) {
  const f = currentFlow(conv);
  if (!f || f.stage !== "note") return "";
  const p = f.problem;
  const by = id => f.replies.find(r => r.id === id);
  return '<section class="page note-page"><header class="page-top"><b>' + escapeHtml(f.title) + "</b></header><h1>What happened?</h1>" +
    '<textarea id="problem-note" maxlength="300" data-index="' + f.index + '" rows="4" placeholder="Type or tap 🎤 on your keyboard to speak">' + escapeHtml(p.note || "") + "</textarea>" +
    '<div class="type-acts">' + flowBtn(by("save-text"), "reply main") + "</div>" +
    '<p class="note-tip">Tip: tap the microphone on your keyboard and talk, the phone writes for you.</p>' +
    '<div class="page-foot">' + flowBtn(by("no-note")) + "</div></section>";
}

// Gas smell : déjà enregistré (urgent) ; consigne en très grand sur fond rouge, [OK].
export function renderGasScreen(conv) {
  const f = currentFlow(conv);
  if (!f || f.stage !== "gas") return "";
  const k = KINDS.find(x => x.key === f.problem.kind);
  return '<section class="page gas-page" role="alert"><div class="gas-icon">' + I.gas + "</div><h1>" + escapeHtml(f.problem.kind) + '</h1><p class="gas-text">' + escapeHtml(k.safety) + "</p>" +
    '<button class="gas-ok" data-flow="gas-ok">OK</button></section>';
}

// Écran du signalement en cours, selon son étape (null si aucun).
export function renderFlow(conv, { live } = {}) {
  const f = currentFlow(conv);
  if (!f) return "";
  switch (f.stage) {
    case "kind": return renderKindScreen(conv);
    case "photos": return renderProblemPhotos(conv, { live });
    case "note": return renderNoteScreen(conv);
    case "gas": return renderGasScreen(conv);
    default: return "";
  }
}

// Bandeau court après un signalement : « Saved: <Type> · <endroit> », sans bouton.
export function renderToast(p) {
  return '<div class="toast saved" role="status">Saved: ' + escapeHtml(p.kind + " · " + p.where) + "</div>";
}

// Page d'un problème (bulle touchée dans le fil) : grandes lignes Photos, Note, Place, Urgency, Delete (confirmé ici même).
export function renderProblemPage(conv, index, { confirmDelete = false } = {}) {
  const p = conv.problems[index];
  if (!p) return "";
  const chips = (attr, values, current) => values.map(v => '<button class="chip' + (v === current ? " on" : "") + '" data-' + attr + '="' + escapeHtml(v) + '">' + escapeHtml(attr === "urgency" ? URGENCY[v].dot + " " + URGENCY[v].label : v) + "</button>").join("");
  const places = conv.apt.rooms.concat(["Entrance & building", "Whole apartment"]);
  const photos = '<div class="pstrip">' + p.photos.map(ph => imgTag(ph, "pthumb")).join("") + "</div>" +
    '<button class="reply" data-act="edit-photos">Add photo</button>';
  const note = (p.note ? '<p class="pnote">' + escapeHtml(p.note) + "</p>" : '<p class="muted">No note</p>') +
    '<button class="reply" data-act="edit-note">Edit note</button>';
  const del = confirmDelete
    ? '<div class="confirm"><b>Delete?</b><button class="reply danger" data-act="delete" data-index="' + index + '">Yes, delete</button><button class="reply" data-act="delete-no">No</button></div>'
    : '<button class="reply danger" data-act="delete-ask">Delete problem</button>';
  return '<section class="page edit-page"><header class="page-top"><button class="back-btn" data-act="edit-back">' + I.back + "Back</button></header><h1>" + escapeHtml(p.kind + " · " + p.where) + "</h1>" +
    '<div class="eline"><h2>Photos</h2>' + photos + "</div>" +
    '<div class="eline"><h2>Note</h2>' + note + "</div>" +
    '<div class="eline"><h2>Place</h2><div class="chips">' + chips("where", places, p.where) + "</div></div>" +
    '<div class="eline"><h2>Urgency</h2><div class="chips">' + chips("urgency", ["urgent", "soon", "later"], p.urgency) + "</div></div>" +
    '<div class="eline">' + del + '</div><div class="page-foot"><button class="reply main" data-act="edit-back">Done</button></div></section>';
}
