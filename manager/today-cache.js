// Dernier Today recu, garde sur l'appareil avec son heure et son proprietaire
// (spec section 7) : jamais d'ecran blanc quand le reseau ou le proxy tombe,
// jamais le Today d'un autre compte sur un appareil partage. Lecture seule.
const KEY = 'mgrTodayCache';

// Proprietaire = utilisateur de la session email stockee par supabase-js
// (hkAuthSession). Une session stale la garde aussi (refresh token). Inconnu
// (PIN seul, stockage vide) : null, et le cache n'est alors jamais montre.
export function currentOwner() {
  try {
    const s = JSON.parse(localStorage.getItem('hkAuthSession') || 'null');
    const u = s && s.user;
    const id = u && (u.id || u.email);
    return id ? String(id) : null;
  } catch (e) { return null; }
}

export function saveToday(data, savedAt) {
  const owner = currentOwner();
  if (!owner) return;
  try { localStorage.setItem(KEY, JSON.stringify({ v: 1, savedAt, owner, data })); } catch (e) { /* quota ou stockage bloque */ }
}

export function clearToday() {
  try { localStorage.removeItem(KEY); } catch (e) { /* stockage bloque */ }
}

export function loadToday() {
  try {
    const o = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (!o || o.v !== 1 || typeof o.savedAt !== 'number' || !o.data || !o.data.who || !o.data.arrivals) return null;
    const owner = currentOwner();
    return owner && o.owner === owner ? o : null;
  } catch (e) { return null; }
}
