// Texte incrusté en bas de chaque photo : la preuve qui survit à WhatsApp (qui efface les métadonnées).
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const two = n => String(n).padStart(2, "0");

import { aptLabel } from "./rules.js";

export function stampText(apt, me, date) {
  const d = DAYS[date.getDay()] + " " + date.getDate() + " " + MONTHS[date.getMonth()] + " " + date.getFullYear();
  return aptLabel(apt) + " · " + d + " · " + two(date.getHours()) + ":" + two(date.getMinutes()) + " · " + me.name;
}
