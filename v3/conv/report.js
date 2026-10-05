// Texte du rapport partagé au groupe (mise en forme WhatsApp : *gras*, _italique_) et fichiers joints.
import { LINEN_USUAL, LEAVE_CHECKS, aptLabel } from "./rules.js";
import { URGENCY } from "./problems.js";
import { elapsedMinutes, leaveDoneLabel } from "./conversation.js";

const hhmm = d => String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");

// Espaces insécables : « 1 h 40 » ne se coupe jamais en fin de ligne (rendu HTML comme texte WhatsApp).
const NB = "\u00a0";
export function formatMinutes(n) {
  if (n < 60) return n + NB + "min";
  return Math.floor(n / 60) + NB + "h" + NB + String(n % 60).padStart(2, "0");
}

// Plafond de fichiers d'un partage (WhatsApp refuse au-delà sur certains téléphones).
export const MAX_FILES = 10;
export const hasFile = x => !!(x && typeof x === "object" && x.file);

const roomsOf = (conv, store) => conv.apt.rooms.flatMap(r => store[r] || []);

// Sélection des fichiers (photos seulement) : priorité problèmes, puis fin, puis arrivée ; rendus dans l'ordre naturel (arrivée, fin, problèmes).
export function pickFiles(conv, max = MAX_FILES) {
  const groups = {
    arrival: roomsOf(conv, conv.arrivalPhotos).filter(hasFile),
    end: roomsOf(conv, conv.endPhotos).filter(hasFile),
    problems: conv.problems.flatMap(p => p.photos.filter(hasFile)),
  };
  let left = max;
  const kept = {};
  for (const k of ["problems", "end", "arrival"]) { kept[k] = groups[k].slice(0, Math.max(0, left)); left -= kept[k].length; }
  const order = ["arrival", "end", "problems"];
  const files = order.flatMap(k => kept[k].map(x => x.file));
  const total = order.reduce((n, k) => n + groups[k].length, 0);
  return { files, photos: files.length, cutPhotos: files.length < total };
}

const WHERE_EXTRA = ["Entrance & building", "Whole apartment"];
const roomLine = (conv, store) => {
  const rooms = conv.apt.rooms.filter(r => (store[r] || []).length);
  return rooms.length ? rooms.map(r => r + " 📷 " + store[r].length).join(" · ") : "none";
};

// « 🟠 Broken, Sofa: tear on the left cushion (HK-461, 3 photos) » : « 1 photo » est omis.
export function problemLine(p) {
  const extra = (p.notified ? ", team notified " + p.at : "") + (p.photos.length > 1 ? ", " + p.photos.length + " photos" : "");
  return URGENCY[p.urgency].dot + " " + p.kind + (p.detail ? ", " + p.detail : "") + (p.note ? ": " + p.note : "") + " (HK-" + p.ref + extra + ")";
}

export function reportText(conv, { now = new Date() } = {}) {
  const a = conv.apt;
  const linen = LINEN_USUAL.filter(l => conv.linen[l.key] > 0).map(l => conv.linen[l.key] + " " + (conv.linen[l.key] === 1 ? l.one : l.many)).join(", ");
  const order = a.rooms.concat(WHERE_EXTRA);
  const groups = order.filter(w => conv.problems.some(p => p.where === w));
  const probLines = groups.flatMap(w => ["_" + w + "_"].concat(conv.problems.filter(p => p.where === w).map(problemLine)));
  const count = store => Object.values(store).reduce((n, list) => n + list.length, 0);
  const probPhotos = conv.problems.reduce((n, p) => n + p.photos.length, 0);
  const leave = LEAVE_CHECKS.map(c => leaveDoneLabel(conv, c) + (conv.leave[c.key] === true ? " ✓" : " ✗")).join(" · ");
  const end = conv.endedAt || now;
  const lines = [
    "✅ *READY · " + aptLabel(a) + "*" + (a.area ? ", " + a.area : ""),
    a.type + " · Next guest: " + a.guest.next,
    "👤 " + conv.me.name + " · " + (conv.startedAt ? hhmm(conv.startedAt) : "--:--") + " → " + hhmm(end) + " (" + formatMinutes(elapsedMinutes(conv, end)) + ", usual " + formatMinutes(a.usualMinutes) + ")",
    "",
    "*1 Arrival:* " + roomLine(conv, conv.arrivalPhotos),
    "*2 Damage:* " + (conv.damage === "none" ? "none" : conv.damage === "some" ? "see problems" : "not answered"),
  ];
  if (conv.steps.some(s => s.id === "walls")) lines.push("*Walls:* " + (conv.walls === "ok" ? "OK" : conv.walls === "some" ? "see problems" : "not answered"));
  // « Yes » seulement s'il reste un problème du type de la vérification.
  if (a.managerCheck) lines.push("*" + a.managerCheck.reportLabel + ":* " + (conv.checkAnswer === null ? "not answered" : conv.problems.some(p => p.kind === a.managerCheck.kind) ? "Yes" : "No"));
  lines.push("*3 Dirty linen:* " + (linen || "none"));
  lines.push("*4 Rooms cleaned:* " + roomLine(conv, conv.endPhotos));
  lines.push("*5 Leave:* " + leave);
  lines.push("*Running low:* " + (conv.low.length ? conv.low.join(", ") : "nothing"));
  if (conv.problems.length) lines.push("*Problems (" + conv.problems.length + "):*", ...probLines);
  else lines.push("*Problems:* none");
  const pick = pickFiles(conv);
  lines.push("📷 " + count(conv.arrivalPhotos) + " arrival · " + count(conv.endPhotos) + " end · " + probPhotos + " of problems" + (pick.cutPhotos ? " (" + pick.photos + " attached)" : ""));
  return lines.join("\n");
}

export function reportFiles(conv) {
  return pickFiles(conv).files;
}
