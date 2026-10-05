import { post, upload, newIdem } from '/inspections/api.js';
import { shrink } from '/inspections/photo.js';

// Jumeau volontaire de INSP_ZONES dans supabase/functions/hostaway-proxy/insp_rules.ts :
// memes cles, memes libelles, meme ordre. A modifier des deux cotes.
const ZONES = [
  { key: 'entrance', label: 'Entrance, door & lock' },
  { key: 'living', label: 'Living room' },
  { key: 'kitchen', label: 'Kitchen & appliances' },
  { key: 'bedrooms', label: 'Bedroom(s) & bedding' },
  { key: 'bathrooms', label: 'Bathroom(s) & plumbing' },
  { key: 'ac', label: 'AC' },
  { key: 'wifi_tv', label: 'Wi-Fi & TV' },
  { key: 'balcony', label: 'Balcony & windows' },
  { key: 'inventory', label: 'Inventory & consumables' },
  { key: 'cleanliness', label: 'General cleanliness' },
];
const clock = (iso) => new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'Asia/Dubai' });

export async function renderInspect(ctx) {
  const { go, toast, render, esc } = ctx;
  const isCurrent = ctx.isCurrent || (() => true);
  const eligibility = ['checkout', 'vacant', 'adhoc'].includes(ctx.entry) ? ctx.entry : 'adhoc';
  const startIdem = newIdem('istart'); // gardee jusqu'au succes : un nouvel essai la reutilise
  let busy = false;
  const st = { done: false, insp: null, z: {}, open: null, general: '', finishError: '', loadError: '' };
  const view = document.getElementById('view');
  // Un seul element aria-live, cree une fois : repeint a chaque rendu sans etre recree.
  const countEl = document.createElement('p');
  countEl.className = 'count'; countEl.setAttribute('aria-live', 'polite');
  const revoke = (p) => { if (p && p.url) { try { URL.revokeObjectURL(p.url); } catch (e) { /* ignore */ } p.url = null; } };
  const releaseAll = () => { for (const k of Object.keys(st.z)) for (const p of st.z[k].photos) { revoke(p); p.blob = null; } };
  if (ctx.onLeave) ctx.onLeave(releaseAll);

  const zoneOf = (k) => st.z[k] || (st.z[k] = { saved: null, editing: false, photos: [], draft: null });
  const issuePhotos = (z) => z.photos.filter((p) => p.kind === 'issue');
  const doneCount = () => ZONES.filter((zn) => st.z[zn.key] && st.z[zn.key].saved).length;

  function load(snap) {
    st.insp = snap.inspection;
    for (const it of snap.items || []) zoneOf(it.zone).saved = it;
    for (const p of snap.photos || []) zoneOf(p.zone).photos.push({ id: p.id, kind: p.kind, url: null, state: 'done' });
  }
  const canSave = (z) => {
    const d = z.draft;
    return !!(d && d.note.trim() && issuePhotos(z).some((p) => p.state === 'done') && d.outcome
      && (d.outcome !== 'fixed' || d.fixNote.trim()));
  };

  function thumbs(z, kind, key) {
    const list = z.photos.filter((p) => p.kind === kind);
    return '<div class="thumbs" data-kind="' + kind + '">' + list.map((p, i) => {
      const img = p.url ? '<img src="' + esc(p.url) + '" alt="' + esc(kind) + ' photo ' + (i + 1) + '">' : '<span class="nourl">Photo ' + (i + 1) + '</span>';
      const extra = p.state === 'up' ? '<span class="tstate">Uploading…</span>'
        : p.state === 'fail' ? '<button class="btn ghost small" data-act="retry-photo" data-z="' + esc(key) + '" data-i="' + z.photos.indexOf(p) + '">Retry upload</button>'
          + '<button class="btn ghost small" data-act="remove-photo" data-z="' + esc(key) + '" data-i="' + z.photos.indexOf(p) + '">Remove</button>' : '';
      return '<div class="thumb">' + img + extra + '</div>';
    }).join('') + '</div>';
  }
  const addBtn = (key, kind, label) => '<label class="btn ghost addphoto">' + esc(label)
    + '<input type="file" accept="image/*" capture="environment" class="filein" data-z="' + esc(key) + '" data-kind="' + kind + '"></label>';

  function form(zn) {
    const z = zoneOf(zn.key), d = z.draft, k = zn.key;
    const pressed = (o) => (d.outcome === o ? 'true' : 'false');
    let h = '<div class="zform">'
      + '<label class="lbl" for="note-' + k + '">What is wrong?</label>'
      + '<textarea id="note-' + k + '" class="ta" rows="3" data-f="note" data-z="' + k + '">' + esc(d.note) + '</textarea>'
      + '<p class="lbl">Photos</p>' + thumbs(z, 'issue', k) + addBtn(k, 'issue', 'Add photo')
      + '<p class="lbl">What happened?</p><div class="choices">'
      + '<button class="btn choice" data-act="outcome" data-z="' + k + '" data-o="fixed" aria-pressed="' + pressed('fixed') + '">Fixed on the spot</button>'
      + '<button class="btn choice" data-act="outcome" data-z="' + k + '" data-o="maintenance" aria-pressed="' + pressed('maintenance') + '">Needs maintenance</button></div>';
    if (d.outcome === 'fixed') {
      h += '<label class="lbl" for="fix-' + k + '">What did you do?</label>'
        + '<textarea id="fix-' + k + '" class="ta" rows="2" data-f="fixNote" data-z="' + k + '">' + esc(d.fixNote) + '</textarea>'
        + thumbs(z, 'after', k) + addBtn(k, 'after', 'Add after photo');
    } else if (d.outcome === 'maintenance') {
      h += '<p class="mute">A maintenance ticket will be created.</p>';
    }
    h += '<div class="actions"><button class="btn primary" data-act="save" data-z="' + k + '"' + (canSave(z) && !busy ? '' : ' disabled') + '>Save</button>'
      + '<button class="btn ghost" data-act="cancel" data-z="' + k + '">Cancel</button></div></div>';
    return h;
  }

  function summary(z) {
    const it = z.saved;
    if (it.status === 'ok') return '<p class="mute">OK</p>' + (it.ticketId ? '<p class="badge">Ticket #' + esc(it.ticketId) + ' stays open</p>' : '');
    let h = '<p class="sum">' + esc(it.note) + '</p>';
    if (it.outcome === 'fixed') h += '<p class="mute">Fixed on the spot: ' + esc(it.fixNote) + '</p>';
    else if (it.outcome === 'maintenance') h += '<p class="mute">Needs maintenance</p>';
    if (it.ticketId) h += '<p class="badge bad">Ticket #' + esc(it.ticketId) + (it.outcome === 'fixed' ? ' stays open' : ' created') + '</p>';
    return h;
  }

  function zoneHtml(zn) {
    const z = zoneOf(zn.key), k = zn.key;
    const open = st.open === k;
    const cls = z.saved && !open && !z.editing ? (z.saved.status === 'ok' ? ' ok' : ' bad') : '';
    let h = '<section class="card zone' + cls + '" data-testid="zone-' + k + '" aria-labelledby="zt-' + k + '"><div class="card-top"><h3 id="zt-' + k + '">' + esc(zn.label) + '</h3></div>';
    if (open) h += form(zn);
    else if (z.saved && !z.editing) {
      h += summary(z) + '<button class="btn ghost" data-act="edit" data-z="' + k + '"' + (busy ? ' disabled' : '') + '>Change</button>';
    } else {
      h += '<div class="choices"><button class="btn okbtn" data-act="ok" data-z="' + k + '" aria-label="OK: ' + esc(zn.label) + '"' + (busy ? ' disabled' : '') + '>OK</button>'
        + '<button class="btn notok" data-act="notok" data-z="' + k + '" aria-label="Not OK: ' + esc(zn.label) + '"' + (busy ? ' disabled' : '') + '>Not OK</button></div>';
    }
    return h + '</section>';
  }

  function paint() {
    const a = document.activeElement;
    const keep = a && a.dataset && a.dataset.f ? { f: a.dataset.f, z: a.dataset.z, s: a.selectionStart, e: a.selectionEnd }
      : a && a.id === 'general' ? { g: true, s: a.selectionStart, e: a.selectionEnd } : null;
    if (st.loadError) {
      render('<main class="wrap"><button class="btn ghost" data-act="home">Back</button><h1>Inspection</h1><p class="notice bad" role="alert">' + esc(st.loadError) + '</p>'
        + '<button class="btn primary" data-act="retry-start">Retry</button></main>');
      return;
    }
    if (!st.insp) { render('<main class="wrap"><h1>Inspection</h1><p class="mute">Loading…</p></main>'); return; }
    const n = doneCount();
    render('<main class="wrap"><header class="top"><div><h1>' + esc(st.insp.name || 'Apartment') + '</h1><p class="mute">Started '
      + esc(clock(st.insp.startedAt)) + '</p></div><button class="btn ghost" data-act="home">Back</button></header>'
      + '<span data-slot="count"></span>'
      + ZONES.map(zoneHtml).join('')
      + '<label class="lbl" for="general">General note (optional)</label>'
      + '<textarea id="general" class="ta" rows="3">' + esc(st.general) + '</textarea>'
      + (st.finishError ? '<p class="notice bad" role="alert">' + esc(st.finishError) + '</p>' : '')
      + '<button class="btn primary block" data-act="finish"' + (n === ZONES.length && !busy ? '' : ' disabled') + '>Finish inspection</button></main>');
    const slot = view.querySelector('[data-slot="count"]');
    const txt = n + ' / ' + ZONES.length + ' zones';
    if (slot) { slot.replaceWith(countEl); if (countEl.textContent !== txt) countEl.textContent = txt; } // connecte d'abord, puis texte : annonce par les lecteurs d'ecran
    if (keep) {
      const el = keep.g ? document.getElementById('general') : view.querySelector('[data-f="' + keep.f + '"][data-z="' + keep.z + '"]');
      if (el) { el.focus(); try { el.setSelectionRange(keep.s, keep.e); } catch (e) { /* ignore */ } }
    }
  }
  const alive = () => isCurrent() && !st.done;
  const repaint = () => { if (alive()) paint(); };
  // Progres d'un envoi : on ne touche qu'aux miniatures de la zone et aux boutons,
  // jamais au reste de l'ecran (le clavier et le focus restent en place).
  function refreshZone(k) {
    if (!alive()) return;
    const z = zoneOf(k);
    const card = view.querySelector('[data-testid="zone-' + k + '"]');
    if (card) {
      for (const kind of ['issue', 'after']) {
        const el = card.querySelector('.thumbs[data-kind="' + kind + '"]');
        if (el) el.outerHTML = thumbs(z, kind, k);
      }
      const sv = card.querySelector('[data-act="save"]');
      if (sv) sv.disabled = busy || !canSave(z);
    }
    const fin = view.querySelector('[data-act="finish"]');
    if (fin) fin.disabled = busy || doneCount() !== ZONES.length;
  }

  // Un seul geste d'ecriture a la fois ; apres un echec le message du serveur est affiche tel quel.
  async function run(fn, onError) {
    if (busy) return;
    busy = true; paint();
    try { await fn(); } catch (e) { (onError || toast)(e.message || 'Something went wrong.'); }
    finally { busy = false; }
    repaint(); // sans effet une fois l'inspection terminee
  }

  async function sendPhoto(zoneKey, entry) {
    entry.state = 'up';
    const f = new FormData();
    f.set('inspectionId', String(st.insp.id)); f.set('zone', zoneKey); f.set('kind', entry.kind);
    f.set('idem', entry.idem); f.set('file', entry.blob, 'photo.jpg');
    try {
      const r = await upload('insp.uploadPhoto', f);
      entry.id = r.photo && r.photo.id; entry.state = 'done'; entry.blob = null; // envoyee : on libere le blob
    } catch (e) { entry.state = 'fail'; throw e; }
  }

  // Envoi d'une photo : independant du verrou des ecritures (plusieurs photos peuvent partir),
  // chaque photo garde sa cle idem tant qu'elle n'est pas envoyee.
  async function upOne(k, entry) {
    if (entry.state === 'up' && entry.sending) return;
    entry.sending = true; refreshZone(k);
    try { await sendPhoto(k, entry); } catch (e) { if (alive()) toast(e.message || 'Photo upload failed.'); }
    entry.sending = false; refreshZone(k);
  }

  async function start() {
    st.loadError = '';
    try { load(await post('insp.start', { listingId: ctx.listingId, eligibility, idem: startIdem })); }
    catch (e) { st.loadError = e.message || 'Could not start the inspection.'; }
    repaint();
  }

  view.onclick = (ev) => {
    const b = ev.target.closest('[data-act]');
    if (!b || b.disabled) return;
    const a = b.dataset.act, k = b.dataset.z;
    if (a === 'home') return go('#/');
    if (a === 'retry-start') { st.insp = null; paint(); return start(); }
    if (a === 'notok') {
      const z = zoneOf(k), s = z.saved;
      if (!z.draft) z.draft = { note: s && s.note || '', outcome: s && s.outcome || null, fixNote: s && s.fixNote || '' };
      st.open = k; return paint();
    }
    if (a === 'edit') { const z = zoneOf(k); z.editing = true; return paint(); }
    if (a === 'cancel') { st.open = null; zoneOf(k).editing = false; return paint(); }
    if (a === 'remove-photo') {
      const z = zoneOf(k), p = z.photos[Number(b.dataset.i)];
      if (p && p.state === 'fail') { revoke(p); p.blob = null; z.photos.splice(z.photos.indexOf(p), 1); refreshZone(k); }
      return;
    }
    if (a === 'outcome') { zoneOf(k).draft.outcome = b.dataset.o; return paint(); }
    if (a === 'ok') return run(async () => {
      const r = await post('insp.saveItem', { inspectionId: st.insp.id, zone: k, status: 'ok' });
      const z = zoneOf(k), tk = z.saved && z.saved.ticketId; z.saved = r.item || { zone: k, status: 'ok' }; if (tk && !z.saved.ticketId) z.saved.ticketId = tk; z.editing = false; st.open = null; z.draft = null;
    });
    if (a === 'save') return run(async () => {
      const z = zoneOf(k), d = z.draft, hadTicket = !!(z.saved && z.saved.ticketId);
      const body = { inspectionId: st.insp.id, zone: k, status: 'not_ok', note: d.note.trim(), outcome: d.outcome || null };
      if (d.outcome === 'fixed') body.fixNote = d.fixNote.trim();
      const r = await post('insp.saveItem', body);
      z.saved = r.item || { zone: k, status: 'not_ok', ...body };
      z.editing = false; st.open = null; z.draft = null;
      if (z.saved.ticketId && !hadTicket) toast('Ticket #' + z.saved.ticketId + ' created');
    });
    if (a === 'retry-photo') return upOne(k, zoneOf(k).photos[Number(b.dataset.i)]);
    if (a === 'finish') return run(async () => {
      st.finishError = '';
      await post('insp.finish', { inspectionId: st.insp.id, generalNote: st.general.trim() || undefined });
      st.done = true; releaseAll(); toast('Inspection saved'); go('#/');
    }, (m) => { st.finishError = m; });
  };
  // Saisie : on garde le brouillon en memoire sans repeindre (le focus reste en place).
  view.oninput = async (ev) => {
    const t = ev.target;
    if (t.id === 'general') { st.general = t.value; return; }
    if (t.dataset && t.dataset.f) {
      const z = zoneOf(t.dataset.z);
      if (z.draft) z.draft[t.dataset.f] = t.value;
      const save = t.closest('.zone') && t.closest('.zone').querySelector('[data-act="save"]');
      if (save) save.disabled = busy || !canSave(z);
      return;
    }
    if (t.type === 'file') {
      const file = t.files && t.files[0], k = t.dataset.z;
      if (!file) return;
      const blob = await shrink(file);
      t.value = '';
      if (!blob || !alive()) return;
      if (!/^image\//.test(blob.type || file.type || '') || blob.size > 6 * 1024 * 1024) { toast('Photo too large or unsupported. Take it again.'); return; }
      const entry = { id: null, kind: t.dataset.kind, url: URL.createObjectURL(blob), blob, idem: newIdem('iph'), state: 'up' };
      zoneOf(k).photos.push(entry);
      upOne(k, entry);
    }
  };

  paint();
  await start();
}
