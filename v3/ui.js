// Briques d'interface : icones SVG (jamais d'emoji, ruling 8), toast, feuille.
// Aucun gestionnaire en ligne : tout passe par la delegation d'app.js.
const ICONS = {
  check: '<path d="M20 6 9 17l-5-5"/>',
  camera: '<path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/>',
  back: '<path d="M19 12H5"/><path d="m12 19-7-7 7-7"/>',
  clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
  alert: '<path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
  home: '<path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M9 22V12h6v10"/>',
  user: '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
  cloud: '<path d="M20 17.58A5 5 0 0 0 18 8h-1.26A8 8 0 1 0 4 16.25"/><path d="M12 12v9"/><path d="m8 17 4 4 4-4"/>',
};

export function icon(name, size) {
  const s = size || 20;
  return '<svg width="' + s + '" height="' + s + '" viewBox="0 0 24 24" fill="none" ' +
    'stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" ' +
    'aria-hidden="true">' + (ICONS[name] || '') + '</svg>';
}

export function esc(s) {
  return String(s === null || s === undefined ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export function toast(message, kind) {
  const host = document.getElementById('toast-host');
  if (!host) return;
  const div = document.createElement('div');
  div.className = 'toast' + (kind ? ' ' + kind : '');
  div.textContent = message;
  host.appendChild(div);
  setTimeout(function () { div.remove(); }, 3500);
}

export function openSheet(html) {
  const host = document.getElementById('sheet-host');
  host.innerHTML = '<div class="sheet" data-sheet><div class="sheet-in">' + html + '</div></div>';
  return host.querySelector('.sheet-in');
}

export function closeSheet() {
  const host = document.getElementById('sheet-host');
  if (host) host.innerHTML = '';
}

export function sheetIsOpen() {
  const host = document.getElementById('sheet-host');
  return !!(host && host.querySelector('[data-sheet]'));
}

// « 4h40 » plutot que « 280 min » : c'est ce que la cleaner lit en marchant.
export function fmtDuration(minutes) {
  const m = Math.max(0, Math.round(Number(minutes) || 0));
  const h = Math.floor(m / 60);
  const r = m % 60;
  if (h === 0) return String(r) + 'min';
  if (r === 0) return String(h) + 'h';
  return String(h) + 'h' + String(r < 10 ? '0' + r : r);
}

// Minutes restantes avant une heure limite du jour (« 15:00 »), ou null.
export function minutesUntil(hhmm, now) {
  if (!/^\d{2}:\d{2}$/.test(String(hhmm || ''))) return null;
  const d = now ? new Date(now) : new Date();
  const parts = String(hhmm).split(':');
  const cible = new Date(d.getFullYear(), d.getMonth(), d.getDate(), Number(parts[0]), Number(parts[1]), 0, 0);
  return Math.round((cible.getTime() - d.getTime()) / 60000);
}
