// Photos d'un menage dans la fiche (Today et Planning), 28/10/2026. Meme source
// que l'ancien planning : getPhotos (cleaning_photos + photos de l'app cleaner v3),
// URL signees 1 h. La fiche s'ouvre tout de suite ; le bloc se remplit ensuite,
// seulement s'il est encore affiche pour ce menage.
import { get } from '/manager/api.js';
import { esc } from '/manager/ui/dom.js';

const TTL_MS = 50 * 60000; // les URL expirent a 1 h
const cache = new Map();   // key -> { at, photos }

export function photosBlk(key) {
  return '<div class="blk jp" data-jp="' + esc(key) + '"><h3>Photos</h3><p class="empty" role="status">Loading photos...</p></div>';
}

function grid(title, list) {
  if (!list.length) return '';
  return '<h4>' + esc(title) + ' <span class="meta">' + list.length + '</span></h4><div class="jp-grid">'
    + list.map((p) => {
      const cap = [p.label, p.author].filter(Boolean).join(' · ');
      return p.url
        ? '<a href="' + esc(p.url) + '" target="_blank" rel="noopener noreferrer" title="' + esc(cap) + '">'
          + '<img src="' + esc(p.url) + '" alt="' + esc(cap || title) + '" loading="lazy"></a>'
        : '';
    }).join('') + '</div>';
}

export function photosHtml(photos) {
  const ok = (photos || []).filter((p) => p && p.url);
  if (!ok.length) return '<h3>Photos</h3><p class="empty">No photos for this cleaning yet.</p>';
  // Ordre de prise de vue dans chaque groupe.
  const asc = ok.slice().sort((a, b) => String(a.created_at || '').localeCompare(String(b.created_at || '')));
  return '<h3>Photos</h3>'
    + grid('Before cleaning', asc.filter((p) => p.photo_type !== 'after'))
    + grid('After cleaning', asc.filter((p) => p.photo_type === 'after'));
}

function slot(key) {
  return Array.from(document.querySelectorAll('#sheet [data-jp]')).find((el) => el.getAttribute('data-jp') === key) || null;
}

export async function fillPhotos(key) {
  if (!key) return;
  let hit = cache.get(key);
  if (!hit || Date.now() - hit.at > TTL_MS) {
    try {
      const d = await get('getPhotos', { key });
      hit = { at: Date.now(), photos: Array.isArray(d.photos) ? d.photos : [] };
      cache.set(key, hit);
    } catch (e) {
      const el = slot(key);
      if (el) el.innerHTML = '<h3>Photos</h3><p class="empty" role="alert">Could not load the photos. Close and open again.</p>';
      return;
    }
  }
  const el = slot(key);
  if (el) el.innerHTML = photosHtml(hit.photos);
}
