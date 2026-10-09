// Dernier Today recu, garde sur l'appareil avec son heure (spec section 7) :
// jamais d'ecran blanc quand le reseau ou le proxy tombe. Lecture seule.
const KEY = 'mgrTodayCache';

export function saveToday(data, savedAt) {
  try { localStorage.setItem(KEY, JSON.stringify({ savedAt, data })); } catch (e) { /* quota ou stockage bloque */ }
}

export function loadToday() {
  try {
    const o = JSON.parse(localStorage.getItem(KEY) || 'null');
    return o && typeof o.savedAt === 'number' && o.data && o.data.who && o.data.arrivals ? o : null;
  } catch (e) { return null; }
}
