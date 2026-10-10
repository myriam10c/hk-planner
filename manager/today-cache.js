// Dernieres donnees recues (Today, liste Problems), gardees sur l'appareil avec
// leur heure et leur proprietaire (spec section 7) : jamais d'ecran blanc quand le
// reseau ou le proxy tombe, jamais les donnees d'un autre compte sur un appareil
// partage. Lecture seule.
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

export function saveCache(key, data, savedAt) {
  const owner = currentOwner();
  if (!owner) return;
  try { localStorage.setItem(key, JSON.stringify({ v: 1, savedAt, owner, data })); } catch (e) { /* quota ou stockage bloque */ }
}
export function clearCache(key) {
  try { localStorage.removeItem(key); } catch (e) { /* stockage bloque */ }
}
export function loadCache(key, valid) {
  try {
    const o = JSON.parse(localStorage.getItem(key) || 'null');
    if (!o || o.v !== 1 || typeof o.savedAt !== 'number' || !o.data || !valid(o.data)) return null;
    const owner = currentOwner();
    return owner && o.owner === owner ? o : null;
  } catch (e) { return null; }
}

export function saveToday(data, savedAt) { saveCache(KEY, data, savedAt); }
export function clearToday() { clearCache(KEY); }
export function loadToday() { return loadCache(KEY, (d) => !!(d.who && d.arrivals)); }
