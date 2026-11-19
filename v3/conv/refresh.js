// Relecture de la journee (pur, testable sous Node) : quand l'app revenue au premier
// plan doit relire v3.myDay, et le libelle « Updated 12:04 » de la liste.
import { dubaiDate, dubaiHHMM } from "./day.js";

// Une lecture plus recente que cela suffit : un va-et-vient rapide ne rappelle pas le proxy.
export const REFRESH_AFTER_MS = 60000;

// last : { at: ms de la derniere lecture reussie, date: jour de Dubai de cette lecture } ou null.
// Hors ligne : jamais. Sinon : lecture inconnue, plus de 60 s, ou jour de Dubai change.
// Une horloge qui recule (lecture « dans le futur ») compte comme perimee.
export function needsRefresh({ now, last, online }) {
  if (!online) return false;
  if (!last || !Number.isFinite(last.at)) return true;
  if (last.date !== dubaiDate(new Date(now))) return true;
  const age = now - last.at;
  return age > REFRESH_AFTER_MS || age < 0;
}

// « Updated 12:04 » (heure de Dubai), vide tant qu'aucune lecture n'a reussi.
export function updatedLabel(at) {
  if (!Number.isFinite(at)) return "";
  const t = dubaiHHMM(new Date(at).toISOString());
  return t ? "Updated " + t : "";
}
