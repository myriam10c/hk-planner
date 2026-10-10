// More > Reviews : litiges d'avis Airbnb. Lecture : getDisputes (reserve aux managers).
// Ecriture : updateDisputeStatus { review_id, dispute_status | reply_posted } ; l'auteur est
// pris de la session cote proxy (aucun updated_by envoye). Une carte ne change qu'une fois
// le serveur confirme ; l'erreur du serveur s'affiche sur la carte.
import { get, post } from '/manager/api.js';
import { esc, I, toast } from '/manager/ui/dom.js';

const STATUS_LABEL = {
  todo: 'To do', submitted: 'Submitted', removed: 'Removed', rejected: 'Rejected', not_disputable: 'Not disputable',
};
const CHIPS = [['todo', 'To do'], ['submitted', 'Submitted'], ['removed', 'Removed'], ['rejected', 'Rejected'],
  ['not_disputable', 'Not disputable'], ['all', 'All']];
// Boutons de statut dans l'ordre demande ; « To do » ramene la carte en arriere.
const STATUS_BTNS = ['submitted', 'removed', 'rejected', 'not_disputable', 'todo'];
const GROUND_PROC = {
  'off-topic': 'Template 1: off-topic, not about the stay',
  'force-majeure': 'Template 1: force majeure, out of host control',
  'irrelevant': 'Template 2: no relevant information about the stay',
  'defamatory': 'Template 3: demonstrably false statement (attach proof)',
  'retaliatory': 'Template 4: retaliatory, tied to a Resolution Center claim',
};

const statusOf = (r) => (r.dispute && r.dispute.dispute_status) || 'todo';
const cleanName = (n) => String(n || '').replace('[ARCHIVED 2026-06-01] ', '').replace(' V2 - ok', '').replace(' (new)', '');

function header() {
  return '<header class="top"><div><a class="more-back" href="#/more">' + I.prev + '<span>More</span></a>'
    + '<h1>Reviews</h1></div></header>';
}

function stars(n) {
  const v = Math.max(0, Math.min(5, Math.round(Number(n) || 0)));
  if (n == null) return '<span class="rv-stars" aria-label="No rating">?</span>';
  return '<span class="rv-stars" role="img" aria-label="' + v + ' out of 5 stars">' + '★'.repeat(v) + '<span class="rv-off">' + '★'.repeat(5 - v) + '</span></span>';
}

export async function renderReviews(ctx) {
  const main = ctx.main;
  const st = { rows: null, filter: 'todo', busy: new Set(), errs: new Map() };
  const rowById = (id) => (st.rows || []).find((r) => String(r.id) === String(id));

  function handleAccess(e) {
    if (e && e.kind === 'auth') { location.replace('/'); return true; }
    if (e && e.kind === 'forbidden' && e.message === 'email sign-in required') { ctx.emailRequired(); return true; }
    return false;
  }

  function copyBlock(label, text) {
    return '<div class="rv-copyrow"><div class="rv-lbl">' + label + '</div><div class="rv-text">' + esc(text) + '</div>'
      + '<button class="btn rv-copy" type="button" data-copy="' + esc(text) + '" aria-label="Copy ' + label.toLowerCase() + '">Copy</button></div>';
  }

  function card(r) {
    const d = r.dispute;
    const status = statusOf(r);
    const busy = st.busy.has(String(r.id));
    const err = st.errs.get(String(r.id));
    const en = d && d.public_review_en && String(d.public_review_en).trim() !== String(r.public_review || '').trim() ? d.public_review_en : '';
    let h = '<article class="card rv-card" data-review="' + esc(r.id) + '">'
      + '<div class="rv-head">' + stars(r.rating) + '<span class="pill idle rv-status">' + esc(STATUS_LABEL[status] || status) + '</span></div>'
      + '<h2 class="rv-listing">' + esc(cleanName(r.listing_name)) + '</h2>'
      + '<div class="rv-sub">' + esc([r.reviewer_name, String(r.submitted_at || '').slice(0, 10)].filter(Boolean).join(' · ')) + '</div>';
    if (en) {
      h += '<p class="rv-review" data-en>' + esc(en) + '</p>'
        + '<details class="rv-orig"><summary>Original</summary><p class="rv-review">' + esc(r.public_review || '(no text)') + '</p></details>';
    } else {
      h += '<p class="rv-review">' + esc(r.public_review || '(no text)') + '</p>';
    }
    if (!d) {
      h += '<p class="rv-note">Not analyzed yet. The daily job will classify it.</p>';
    } else {
      h += '<div class="rv-block"><div class="rv-lbl">Dispute: ' + esc(String(d.confidence || '').toLowerCase()) + (d.ground ? ', ' + esc(d.ground) : '') + '</div>'
        + (d.angle ? '<p class="rv-angle">' + esc(d.angle) + '</p>' : '')
        + '<p class="rv-proc">' + esc(GROUND_PROC[d.ground] || (d.template ? 'Template ' + d.template : 'No template')) + '</p>';
      const ev = Array.isArray(d.evidence) ? d.evidence : [];
      if (ev.length) h += '<div class="rv-lbl">Evidence to attach</div><ul class="rv-ev">' + ev.map((x) => '<li>' + esc(x) + '</li>').join('') + '</ul>';
      h += '</div>';
      if (d.quote) h += copyBlock('Quote to cite', d.quote);
      h += '<p class="rv-note">Airbnb allows two removal requests per review.</p>';
      h += '<div class="rv-actions" role="group" aria-label="Dispute status">'
        + STATUS_BTNS.map((s) => '<button class="btn rv-sbtn" type="button" data-status="' + s + '" aria-pressed="' + (status === s) + '"'
          + (busy ? ' disabled' : '') + '>' + (s === 'todo' ? 'Back to To do' : STATUS_LABEL[s]) + '</button>').join('') + '</div>';
      if (d.public_reply) {
        h += copyBlock('Public reply', d.public_reply)
          + '<button class="rv-switch" type="button" role="switch" aria-checked="' + (!!d.reply_posted) + '" data-reply' + (busy ? ' disabled' : '') + '>'
          + '<span class="rv-knob" aria-hidden="true"></span><span>Reply posted</span></button>';
      }
    }
    if (err) h += '<p class="rv-err" role="alert">' + esc(err) + '</p>';
    return h + '</article>';
  }

  function counts() {
    const c = { all: (st.rows || []).length };
    for (const [k] of CHIPS) if (k !== 'all') c[k] = 0;
    for (const r of st.rows || []) { const s = statusOf(r); if (s in c) c[s]++; }
    return c;
  }

  function paint() {
    if (!ctx.isCurrent()) return;
    const c = counts();
    const chips = '<div class="rv-chips" role="group" aria-label="Filter by status">' + CHIPS.map(([k, l]) =>
      '<button class="rv-chip" type="button" data-filter="' + k + '" aria-pressed="' + (st.filter === k) + '">' + l + ' <span class="rv-n">' + c[k] + '</span></button>').join('') + '</div>';
    const list = (st.rows || []).filter((r) => st.filter === 'all' || statusOf(r) === st.filter);
    main.innerHTML = header() + '<div class="rv">' + chips
      + (list.length ? list.map(card).join('') : '<p class="empty pad">No reviews here.</p>') + '</div>';
  }

  function paintCard(id) {
    const r = rowById(id);
    const el = main.querySelector('[data-review="' + String(id).replace(/"/g, '') + '"]');
    if (!r || !el) return paint();
    const open = el.querySelector('.rv-orig') && el.querySelector('.rv-orig').open;
    el.outerHTML = card(r);
    if (open) { const n = main.querySelector('[data-review="' + String(id).replace(/"/g, '') + '"] .rv-orig'); if (n) n.open = true; }
  }

  async function load() {
    main.innerHTML = header() + '<div class="ph"><p role="status">Loading reviews...</p></div>';
    try {
      const d = await get('getDisputes');
      if (!ctx.isCurrent()) return;
      st.rows = Array.isArray(d.reviews) ? d.reviews : [];
      paint();
    } catch (e) {
      if (!ctx.isCurrent() || handleAccess(e)) return;
      main.innerHTML = header() + '<div class="err-card"><p role="alert">' + esc(e.message || 'Could not load the reviews.') + '</p>'
        + '<button class="btn primary" type="button" data-retry>Retry</button></div>';
    }
  }

  async function write(id, fields, apply) {
    const key = String(id);
    if (st.busy.has(key)) return;
    st.busy.add(key); st.errs.delete(key); paintCard(id);
    try {
      const res = await post('updateDisputeStatus', { review_id: Number(id), ...fields });
      if (!ctx.isCurrent()) return;
      const r = rowById(id);
      if (r) r.dispute = (res && res.dispute) ? res.dispute : { ...(r.dispute || {}), ...apply };
    } catch (e) {
      if (!ctx.isCurrent() || handleAccess(e)) return;
      st.errs.set(key, e.message || 'Update failed.');
    }
    st.busy.delete(key);
    if (st.errs.has(key)) paintCard(id); else paint();
  }

  async function copy(text) {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) await navigator.clipboard.writeText(text);
      else throw new Error('no clipboard');
      toast('Copied');
    } catch (e) { toast('Could not copy. Select the text instead.'); }
  }

  main.addEventListener('click', (ev) => {
    const t = ev.target.closest('button');
    if (!t || !main.contains(t)) return;
    if (t.hasAttribute('data-retry')) { load(); return; }
    if (t.dataset.filter) { st.filter = t.dataset.filter; paint(); return; }
    if (t.hasAttribute('data-copy')) { copy(t.getAttribute('data-copy')); return; }
    const cardEl = t.closest('[data-review]');
    if (!cardEl) return;
    const id = cardEl.getAttribute('data-review');
    if (t.dataset.status) write(id, { dispute_status: t.dataset.status }, { dispute_status: t.dataset.status });
    else if (t.hasAttribute('data-reply')) {
      const r = rowById(id);
      const next = !(r && r.dispute && r.dispute.reply_posted);
      write(id, { reply_posted: next }, { reply_posted: next });
    }
  });

  await load();
}
