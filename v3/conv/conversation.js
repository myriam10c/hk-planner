// Machine à étapes d'un appartement, en 5 étapes. État mutable mais sans DOM : testable sous Node.
// Portée du prototype (hk-cleaner-proto 875ea4e) : les pièces viennent de apt.rooms (v3.myDay), plus de TEMPLATES.
import { LINEN_USUAL, SUPPLIES, LEAVE_CHECKS, acInstruction, aptLabel } from "./rules.js";
import { makeProblem, KINDS, WALL_KIND } from "./problems.js";

const hhmm = d => String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");

export const STEP_TITLES = { 1: "Arrival", 2: "Damage & problems", 3: "Dirty linen", 4: "Room by room", 5: "Leave & send" };

export function isHelper(conv) {
  return !!(conv.apt.lead && conv.apt.lead.name !== conv.me.name);
}

function buildSteps(apt, helper) {
  const all = apt.rooms;
  if (helper) {
    // L'aide : la première a déjà photographié l'état et fait les étapes 2, 3, 5.
    const mine = all.filter(r => !apt.lead.roomsDone.includes(r));
    return [{ id: "arrive", n: 1 }].concat(mine.map(room => ({ id: "end-photo", n: 4, room })), [{ id: "helper", n: 5 }]);
  }
  const steps = [{ id: "arrive", n: 1 }];
  all.forEach(room => steps.push({ id: "arrival-photo", n: 1, room }));
  if (apt.managerCheck) steps.push({ id: "check", n: 2 });
  steps.push({ id: "walls", n: 2 }, { id: "damage", n: 2 }, { id: "linen", n: 3 });
  all.forEach(room => steps.push({ id: "end-photo", n: 4, room }));
  steps.push({ id: "leave", n: 5 }, { id: "low", n: 5 }, { id: "report", n: 5 });
  return steps;
}

function linenSummary(linen) {
  return LINEN_USUAL.filter(l => linen[l.key] > 0).map(l => linen[l.key] + " " + (linen[l.key] === 1 ? l.one : l.many)).join(", ");
}

function leaveLabel(conv, c) { return c.key === "ac" ? conv.acLabel : c.label; }
// Libellé de la ligne telle qu'elle a été traitée (« Gas not working » si la cleaner a signalé une panne).
export function leaveDoneLabel(conv, c) { return conv.leave[c.key] === "ko" ? c.ko : leaveLabel(conv, c); }

function botMessage(conv) {
  const st = conv.steps[conv.i];
  if (!st) return null;
  const a = conv.apt;
  const prev = conv.steps[conv.i - 1];
  switch (st.id) {
    case "arrive": return { from: "app", type: "text", text: aptLabel(a) + " · " + a.guest.label.toLowerCase(), photo: a.photo };
    case "arrival-photo":
      return { from: "app", type: "text", text: (prev && prev.id === "arrival-photo" ? "" : "Step 1: photo of each room as you find it. ") + st.room + "." };
    case "check": return { from: "app", type: "text", text: a.managerCheck.text };
    case "walls": return { from: "app", type: "text", text: "Walls: any marks, holes or damage?" };
    case "damage": return { from: "app", type: "text", text: "Anything damaged or wrong?" };
    case "linen": return { from: "app", type: "text", text: "Dirty linen: " + linenSummary(conv.linen) + ". As usual?" };
    case "end-photo":
      // Pièce sans photo d'annonce : pas de « like this » qui pointerait vers une image absente.
      return a.roomPhotos[st.room]
        ? { from: "app", type: "text", text: st.room + ": make it look like this.", photo: a.roomPhotos[st.room] }
        : { from: "app", type: "text", text: st.room + ": clean it, then take a photo." };
    case "leave": return { from: "app", type: "text", text: "Before you leave, check each one." };
    case "low": return { from: "app", type: "text", text: "Running low? Tap what is missing." };
    case "helper": return { from: "app", type: "text", text: "Your part is done. " + a.lead.name + " sends the report." };
    case "linen-send": return { from: "app", type: "text", text: "Send the linen count to Housekeeping." };
    case "report": return { from: "app", type: "report" };
    default: return null;
  }
}

// Tickets encore ouverts sur le logement (hors vérification du manager) : rappelés en entrant à l'étape 2.
export function openProblemsText(apt) {
  const others = (apt.openTickets || []).filter(t => !(apt.managerCheck && t.id === apt.managerCheck.ticketId));
  return others.length ? "Open problems here: " + others.map(t => t.title).join(", ") + "." : null;
}

function advance(conv) {
  conv.i += 1;
  const st0 = conv.steps[conv.i], prev = conv.steps[conv.i - 1];
  if (st0 && st0.n === 2 && (!prev || prev.n !== 2)) {
    const t = openProblemsText(conv.apt);
    if (t) conv.messages.push({ from: "app", type: "text", text: t });
  }
  const m = botMessage(conv);
  if (m) conv.messages.push(m);
  const st = conv.steps[conv.i];
  if (st && st.id === "leave") presetLeave(conv);
}

// Problème déjà signalé pendant le ménage pour cette ligne (tuile AC, Gas smell, etc.), le plus récent.
function reportedFor(conv, check) {
  return (check.reported && conv.problems.slice().reverse().find(p => check.reported.includes(p.kind))) || null;
}

// Début de l'étape 5 : une ligne dont la panne est déjà signalée part sur « not working », reliée à ce problème.
function presetLeave(conv) {
  for (const c of LEAVE_CHECKS) {
    const p = reportedFor(conv, c);
    if (!p) continue;
    conv.leave[c.key] = "ko";
    conv.leaveProblems[c.key] = p;
    delete conv.leaveOwn[c.key];
  }
}

export function createConversation(apt, { me, refStart = 461, now = new Date() } = {}) {
  const conv = {
    apt, me, i: 0, steps: [], messages: [], arrivalPhotos: {}, endPhotos: {}, problems: [],
    damage: null, damageReported: false, walls: null, checkAnswer: null, cantGetIn: false, low: [],
    leave: Object.fromEntries(LEAVE_CHECKS.map(c => [c.key, false])), acLabel: acInstruction(now),
    linen: Object.fromEntries(LINEN_USUAL.map(l => [l.key, l.n])), linenEditing: false,
    startedAt: null, endedAt: null, sent: false, gestures: 0, nextRef: refStart,
    // leaveProblems : problème relié à une ligne « not working » ; leaveOwn : créé par la ligne (supprimable par elle).
    flow: null, shareTextOnly: false, leaveProblems: {}, leaveOwn: {}, lastGasAt: null,
  };
  conv.steps = buildSteps(apt, isHelper(conv));
  if (isHelper(conv)) conv.messages.push({ from: "lead", type: "text", text: apt.lead.name + " started at " + apt.lead.startedAt + ". She sends the report. Add your photos and problems." });
  conv.messages.push(botMessage(conv));
  return conv;
}

const R = (id, label, enabled = true) => ({ id, label, enabled });

// Le déclencheur ne change jamais de pièce : autant de photos que voulu, puis Next room (actif dès la première).
function photoStep(conv, st, store) {
  const has = (store[st.room] || []).length > 0;
  return { ...st, camera: true, ref: conv.apt.roomPhotos[st.room] || null, replies: [R("next-room", "Next room", has)] };
}

export function currentStep(conv) {
  const st = conv.steps[conv.i];
  if (!st) return { id: "done", n: 5, title: STEP_TITLES[5], camera: false, replies: [] };
  const a = conv.apt;
  const base = { title: STEP_TITLES[st.n] };
  switch (st.id) {
    case "arrive":
      return { ...st, ...base, camera: false, replies: conv.cantGetIn ? [R("in-now", "I'm in now")] : [R("here", "I'm here"), R("cant-get-in", "I can't get in")] };
    case "arrival-photo": return { ...photoStep(conv, st, conv.arrivalPhotos), ...base };
    case "end-photo": return { ...photoStep(conv, st, conv.endPhotos), ...base };
    case "check":
      return { ...st, ...base, camera: false, replies: [R("check-ok", a.managerCheck.ok), R("check-see", a.managerCheck.see)] };
    case "walls":
      return { ...st, ...base, camera: false, replies: [R("walls-ok", "Walls OK"), R("walls-ko", "Marks or damage")] };
    case "damage":
      // Après un premier problème signalé : « Anything else? » [Another problem] / [No more].
      return conv.damage === "some" && conv.damageReported
        ? { ...st, ...base, camera: false, replies: [R("another-problem", "Another problem"), R("damage-done", "No more")] }
        : { ...st, ...base, camera: false, replies: [R("no-damage", "No, all good"), R("some-damage", "Yes, report it")] };
    case "linen":
      return conv.linenEditing
        ? { ...st, ...base, camera: false, editor: "linen", replies: [R("linen-ok", "Done")] }
        : { ...st, ...base, camera: false, replies: [R("linen-yes", "Yes"), R("linen-change", "Change")] };
    case "leave":
      return { ...st, ...base, camera: false, editor: "leave", replies: LEAVE_CHECKS.flatMap(c => [R("leave:" + c.key, leaveLabel(conv, c))].concat(c.ko ? [R("leave:" + c.key + "-ko", c.ko)] : [])) };
    case "low":
      return { ...st, ...base, camera: false, replies: SUPPLIES.map(x => R("low:" + x, (conv.low.includes(x) ? "✓ " : "") + x)).concat([R("low-done", conv.low.length ? "That's it" : "Nothing")]) };
    case "helper": return { ...st, ...base, camera: false, replies: [R("add-to-lead", "Add to " + a.lead.name + "'s report")] };
    case "linen-send": return { ...st, ...base, camera: false, replies: [R("linen-send", "Send linen count")] };
    case "report": return { ...st, ...base, camera: false, replies: conv.sent ? [R("share-again", "Share again")] : [R("send", "Send to Housekeeping")] };
    default: return { ...st, ...base, camera: false, replies: [] };
  }
}

const say = (conv, text) => { const m = { from: "me", type: "text", text, status: "saved" }; conv.messages.push(m); return m; };

export function reply(conv, id, { now = new Date() } = {}) {
  if (conv.flow) return conv; // signalement en cours : ses écrans ont leurs propres réponses (flowReply)
  const st = currentStep(conv);
  const linenAdjust = /^linen-(inc|dec):/.test(id) && st.editor === "linen";
  const r = st.replies.find(x => x.id === id);
  if (!linenAdjust && (!r || !r.enabled)) return conv;
  if (id === "share-again") return conv; // partage répété : ni geste, ni bulle
  conv.gestures += 1;
  if (linenAdjust) {
    const [, dir, key] = id.match(/^linen-(inc|dec):(.+)$/);
    conv.linen[key] = Math.max(0, conv.linen[key] + (dir === "inc" ? 1 : -1));
    return conv;
  }
  if (id.startsWith("low:")) {
    const item = id.slice(4);
    conv.low = conv.low.includes(item) ? conv.low.filter(x => x !== item) : conv.low.concat([item]);
    return conv;
  }
  if (id.startsWith("leave:")) {
    // Ligne : false (pas traitée), true (« works » / fait) ou "ko" (« not working » : problème Soon créé).
    const ko = id.endsWith("-ko");
    const key = ko ? id.slice(6, -3) : id.slice(6);
    const check = LEAVE_CHECKS.find(c => c.key === key);
    const was = conv.leave[key];
    // Retour sur « works » ou second appui : le problème créé par la ligne disparaît ; un problème signalé
    // par la cleaner elle-même (ligne pré-réglée) est seulement délié, jamais supprimé.
    if (was === "ko") unlinkLeave(conv, key);
    if (ko) {
      conv.leave[key] = was === "ko" ? false : "ko";
      if (conv.leave[key] === "ko") {
        const reported = reportedFor(conv, check);
        if (reported) conv.leaveProblems[key] = reported;
        else { conv.leaveProblems[key] = pushProblem(conv, check.ko, "Whole apartment", [], now); conv.leaveOwn[key] = true; }
      }
    } else conv.leave[key] = was !== true;
    if (LEAVE_CHECKS.every(c => conv.leave[c.key] === true || conv.leave[c.key] === "ko")) {
      say(conv, "All checked: " + LEAVE_CHECKS.map(c => leaveDoneLabel(conv, c)).join(" · "));
      advance(conv);
    }
    return conv;
  }
  switch (id) {
    case "here": case "in-now": conv.startedAt = now; say(conv, r.label); advance(conv); break;
    case "cant-get-in":
      conv.cantGetIn = true; say(conv, r.label);
      pushProblem(conv, "Can't get in", "Entrance & building", [], now); break;
    case "next-room": say(conv, st.room + " done"); advance(conv); break;
    case "check-ok": conv.checkAnswer = "no"; say(conv, r.label); advance(conv); break;
    // Types imposés (vérification du manager, murs) : l'écran des tuiles est sauté, le problème existe dès l'écran des photos.
    case "check-see":
      conv.checkAnswer = "yes";
      openFlow(conv, { stage: "photos", from: "check", imposed: true, said: say(conv, r.label), problem: pushProblem(conv, conv.apt.managerCheck.kind, "Whole apartment", [], now) });
      break;
    case "walls-ok": conv.walls = "ok"; say(conv, r.label); advance(conv); break;
    case "walls-ko":
      openFlow(conv, { stage: "photos", from: "walls", imposed: true, said: say(conv, r.label), problem: pushProblem(conv, WALL_KIND, "Whole apartment", [], now) });
      break;
    case "no-damage": conv.damage = "none"; say(conv, r.label); advance(conv); break;
    case "some-damage": case "another-problem":
      conv.damage = "some"; say(conv, r.label);
      openFlow(conv, { stage: "kind", from: "damage" });
      break;
    case "damage-done": say(conv, "Damage reported"); advance(conv); break;
    case "linen-yes": say(conv, "Linen as usual"); advance(conv); break;
    case "linen-change": conv.linenEditing = true; break;
    case "linen-ok": conv.linenEditing = false; say(conv, "Linen: " + linenSummary(conv.linen)); advance(conv); break;
    case "low-done": say(conv, conv.low.length ? "Running low: " + conv.low.join(", ") : "Nothing is low"); advance(conv); break;
    case "add-to-lead": conv.endedAt = now; conv.sent = true; say(conv, r.label); advance(conv); break;
    case "linen-send": conv.endedAt = now; conv.sent = true; say(conv, "Linen: " + linenSummary(conv.linen)); advance(conv); break;
    case "send": conv.endedAt = now; conv.sent = true; say(conv, "Report sent to the group"); break;
  }
  return conv;
}

// Le serveur juge que cette personne est le lead (elle croyait aider) et refuse la fin sans
// linge : la conversation demande le comptage, puis l'envoie (tâche 5 du branchement).
// conv.sync.finish est oublié pour qu'une nouvelle fin, avec le linge, parte à l'envoi.
export function requireLinen(conv) {
  if (conv.linenNeeded) return conv;
  conv.linenNeeded = true;
  conv.sent = false;
  conv.endedAt = null;
  if (conv.sync) conv.sync.finish = null;
  conv.messages.push({ from: "app", type: "text", text: "Housekeeping needs your linen count.", alert: true });
  conv.steps.push({ id: "linen", n: 3 }, { id: "linen-send", n: 5 });
  conv.i = conv.steps.length - 3;
  advance(conv);
  return conv;
}

function unlinkLeave(conv, key) {
  const p = conv.leaveProblems[key], own = conv.leaveOwn[key];
  delete conv.leaveProblems[key]; delete conv.leaveOwn[key];
  const i = conv.problems.indexOf(p);
  if (own && i >= 0) removeProblem(conv, i);
}

export function guessWhere(conv) {
  const st = conv.steps[conv.i];
  if (!st || st.id === "arrive") return "Entrance & building";
  if (st.id === "arrival-photo" || st.id === "end-photo") return st.room;
  return "Whole apartment";
}

function pushProblem(conv, kind, where, photos, now) {
  const p = makeProblem({ kind, where, photos, hoursAway: conv.apt.guest.hoursAway, at: hhmm(now), ref: conv.nextRef++ });
  conv.problems.push(p);
  conv.messages.push({ from: "me", type: "problem", problemIndex: conv.problems.length - 1, status: "saved" });
  const k = KINDS.find(x => x.key === kind);
  if (k && k.safety) conv.messages.push({ from: "app", type: "text", text: k.safety, alert: true });
  return p;
}

export function addPhoto(conv, photo) {
  const st = conv.steps[conv.i];
  if (!st) return conv;
  const store = st.id === "arrival-photo" ? conv.arrivalPhotos : st.id === "end-photo" ? conv.endPhotos : null;
  if (!store) return conv;
  conv.gestures += 1;
  (store[st.room] = store[st.room] || []).push(photo);
  conv.messages.push({ from: "me", type: "photo", photo, status: "saved" });
  return conv; // la pièce reste : Next room la termine
}

// Second Gas smell à moins de 2 s du premier : double appui sur la tuile, ignoré (pas de doublon).
export const GAS_DEBOUNCE_MS = 2000;

export function addProblem(conv, kind, photo, { now = new Date() } = {}) {
  if (kind === "Gas smell") {
    if (conv.lastGasAt !== null && now - conv.lastGasAt < GAS_DEBOUNCE_MS) return conv;
    conv.lastGasAt = now.getTime();
  }
  conv.gestures += 1;
  pushProblem(conv, kind, guessWhere(conv), photo ? [photo] : [], now);
  return conv;
}

// Photo arrivée après coup sur un problème déjà enregistré (Gas smell : la consigne part avant la photo).
// Problème supprimé entre-temps : la photo est ignorée.
export function attachProblemPhoto(conv, problem, photo) {
  if (!photo || !conv.problems.includes(problem)) return conv;
  problem.photos.push(photo);
  return conv;
}

// Photo de plus sur un problème déjà enregistré (écran des photos du signalement) : un geste.
export function addProblemPhoto(conv, index, photo) {
  const p = conv.problems[index];
  if (!p || !photo) return conv;
  conv.gestures += 1;
  p.photos.push(photo);
  return conv;
}

// Note libre (dictée possible au micro du clavier du téléphone) : une ligne, 300 caractères au plus, vide = pas de note.
export const NOTE_MAX = 300;
export function setProblemNote(conv, index, text) {
  const p = conv.problems[index];
  if (!p) return conv;
  const clean = String(text || "").replace(/\s+/g, " ").trim().slice(0, NOTE_MAX).trim();
  p.note = clean || null;
  return conv;
}

// Photo de pièce supprimée depuis sa miniature (étape 1 « arrival » ou 4 « end ») : pas un geste.
// La bulle de la photo quitte le fil ; une pièce sans photo retrouve Next room inactif.
export function removeArrivalOrEndPhoto(conv, step, room, i) {
  const store = step === "arrival" || step === "arrival-photo" || step === 1 ? conv.arrivalPhotos
    : step === "end" || step === "end-photo" || step === 4 ? conv.endPhotos : null;
  const list = store && store[room];
  if (!list || i < 0 || i >= list.length) return conv;
  const [photo] = list.splice(i, 1);
  if (!list.length) delete store[room];
  const at = conv.messages.findIndex(m => m.type === "photo" && m.photo === photo);
  if (at >= 0) conv.messages.splice(at, 1);
  return conv;
}

// ---- Signalement d'un problème : une question par écran (pas de fenêtre par-dessus). ----
// conv.flow = { stage, from, imposed, problem } ; stage : kind (tuiles), photos, note (texte, « What happened? »), gas (consigne).
// from : "conv" (étape en cours ou viseur), "damage" (étape 2), "walls", "check" (types imposés), "edit" (page du problème).

function openFlow(conv, f) {
  // said : bulle de la cleaner qui a ouvert un type imposé (« Marks or damage »), retirée si elle se ravise.
  conv.flow = { stage: f.stage, from: f.from || "conv", imposed: !!f.imposed, problem: f.problem || null, where: f.where || null, said: f.said || null };
  return conv;
}

// Bouton ⚠ Problem (viseur ou barre) : un geste, l'écran des tuiles s'ouvre.
export function startProblem(conv, { from = "conv" } = {}) {
  if (conv.flow) return conv;
  conv.gestures += 1;
  return openFlow(conv, { stage: "kind", from, where: guessWhere(conv) });
}

// Tuile touchée : le problème est enregistré tout de suite. Gas smell : consigne rouge plein écran.
export function chooseKind(conv, kind, { now = new Date() } = {}) {
  const f = conv.flow;
  if (!f || f.stage !== "kind" || !KINDS.some(k => k.key === kind)) return conv;
  const k = KINDS.find(x => x.key === kind);
  if (k.safety) {
    if (conv.lastGasAt !== null && now - conv.lastGasAt < GAS_DEBOUNCE_MS) return conv;
    conv.lastGasAt = now.getTime();
  }
  conv.gestures += 1;
  f.problem = pushProblem(conv, kind, f.where || guessWhere(conv), [], now);
  f.stage = k.safety ? "gas" : "photos";
  return conv;
}

export function addFlowPhoto(conv, photo) {
  const f = currentFlow(conv);
  if (!f || f.stage !== "photos" || !photo) return conv;
  return addProblemPhoto(conv, f.index, photo);
}

// État de l'écran en cours (null : pas de signalement, ou problème supprimé entre-temps).
export function currentFlow(conv) {
  const f = conv.flow;
  if (!f) return null;
  const index = f.problem ? conv.problems.indexOf(f.problem) : -1;
  if (f.stage !== "kind" && index < 0) return null;
  const p = f.problem;
  const n = p ? p.photos.length : 0;
  const edit = f.from === "edit";
  const base = { stage: f.stage, from: f.from, imposed: f.imposed, problem: p, index, photos: n, title: p ? p.kind + " · " + p.where : "", back: false, replies: [] };
  switch (f.stage) {
    case "kind": return { ...base, replies: [R("cancel", "Cancel")] };
    // Retour arrière tant qu'aucune photo (type touché par erreur) ; depuis la page du problème, toujours.
    case "photos": return { ...base, back: edit || n === 0, replies: edit ? [R("photos-done", "Done", n > 0)] : [R("photos-done", "Done", n > 0), R("no-photo", "No photo")] };
    // Texte seulement : Save (vide = pas de note) ; No note, ou Back depuis la page du problème (la note reste).
    case "note": return { ...base, replies: [R("save-text", "Save"), R("no-note", edit ? "Back" : "No note")] };
    case "gas": return { ...base, replies: [R("gas-ok", "OK")] };
    default: return base;
  }
}

function finishFlow(conv) {
  const f = conv.flow;
  conv.flow = null;
  if (f.from === "walls") { conv.walls = "some"; say(conv, "Walls reported"); advance(conv); }
  else if (f.from === "check") advance(conv);
  else if (f.from === "damage") { conv.damageReported = true; conv.messages.push({ from: "app", type: "text", text: "Anything else?" }); }
  return conv;
}

export function flowReply(conv, id, { text = "" } = {}) {
  const f = currentFlow(conv);
  if (!f) { conv.flow = null; return conv; }
  if (id === "back") {
    if (!f.back) return conv;
    if (f.from === "edit") { conv.flow = null; return conv; }
    // Type touché par erreur (aucune photo) : le problème est retiré.
    removeProblem(conv, f.index);
    if (f.imposed) {
      const said = conv.flow.said;
      if (said) conv.messages = conv.messages.filter(m => m !== said);
      conv.flow = null;
      if (f.from === "walls") conv.walls = null;
      if (f.from === "check") conv.checkAnswer = null;
    } else { conv.flow.stage = "kind"; conv.flow.problem = null; }
    return conv;
  }
  const r = f.replies.find(x => x.id === id);
  if (!r || !r.enabled) return conv;
  switch (id) {
    case "cancel": conv.flow = null; break;
    case "photos-done": conv.gestures += 1; if (f.from === "edit") conv.flow = null; else conv.flow.stage = "note"; break;
    case "no-photo": conv.gestures += 1; conv.flow.stage = "note"; break;
    case "save-text": conv.gestures += 1; setProblemNote(conv, f.index, text); finishFlow(conv); break;
    case "no-note": case "gas-ok": conv.gestures += 1; finishFlow(conv); break;
  }
  return conv;
}

// Retour système (Android, geste iPhone) : le retour de l'écran en cours, sans geste compté.
// Photos déjà prises : comme Done (photos gardées, écran de note, ou retour à la page du problème), sans geste.
export function flowBack(conv) {
  const f = currentFlow(conv);
  if (!f) { conv.flow = null; return conv; }
  switch (f.stage) {
    case "kind": return flowReply(conv, "cancel");
    case "photos":
      if (f.back) return flowReply(conv, "back");
      conv.flow.stage = "note";
      return conv;
    case "note":
      if (f.from === "edit") conv.flow = null;
      else conv.flow.stage = "photos";
      return conv;
    case "gas": return flowReply(conv, "gas-ok");
    default: return conv;
  }
}

// Depuis la page du problème : Add photo (photos) ou Edit note (note).
export function reopenProblem(conv, index, stage) {
  const p = conv.problems[index];
  if (!p || conv.flow || (stage !== "photos" && stage !== "note")) return conv;
  return openFlow(conv, { stage, from: "edit", problem: p });
}

export function editProblem(conv, index, patch) {
  const p = conv.problems[index];
  if (!p) return conv;
  Object.assign(p, patch);
  if (patch.urgency === "urgent") p.notified = true;
  return conv;
}

export function removeProblem(conv, index) {
  if (index < 0 || index >= conv.problems.length) return conv;
  const [p] = conv.problems.splice(index, 1);
  // Problème relié à une ligne de l'étape 5 supprimé (page du problème) : la ligne revient à « non traitée ».
  for (const key of Object.keys(conv.leaveProblems)) {
    if (conv.leaveProblems[key] !== p) continue;
    delete conv.leaveProblems[key]; delete conv.leaveOwn[key];
    if (conv.leave[key] === "ko") conv.leave[key] = false;
  }
  conv.messages = conv.messages
    .filter(m => !(m.type === "problem" && m.problemIndex === index))
    .map(m => (m.type === "problem" && m.problemIndex > index ? { ...m, problemIndex: m.problemIndex - 1 } : m));
  return conv;
}

export function elapsedMinutes(conv, now = new Date()) {
  if (!conv.startedAt) return 0;
  return Math.max(0, Math.round(((conv.endedAt || now) - conv.startedAt) / 60000));
}
