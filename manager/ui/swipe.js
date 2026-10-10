// Glisser une ligne sur telephone (spec section 3) : gauche = Close (Undo dans le
// toast), droite = Assign (ouvre le choix ; rien n'est ecrit sans un second geste).
// Le geste ne part qu'au-dela de SWIPE_MIN_PX, nettement horizontal, et jamais
// depuis les bords de l'ecran (geste retour d'iOS et d'Android). Le clic que le
// navigateur envoie apres un geste est absorbe : il n'ouvre pas la fiche.
export const SWIPE_MIN_PX = 80;
export const EDGE_PX = 24;
const MUTE_MS = 400;

export function swipeIntent(dx, dy, startX, width) {
  if (startX < EDGE_PX || startX > width - EDGE_PX) return null;
  if (Math.abs(dx) < SWIPE_MIN_PX || Math.abs(dx) < 2 * Math.abs(dy)) return null;
  return dx < 0 ? 'close' : 'assign';
}

export function attachSwipe(root, opts) {
  let g = null;
  let mute = false;
  let muteTimer = null;
  function stop() {
    if (g) {
      g.el.style.transform = '';
      g.el.classList.remove('swiping', 'swipe-close', 'swipe-assign');
    }
    g = null;
    document.removeEventListener('pointermove', move);
    document.removeEventListener('pointerup', up);
    document.removeEventListener('pointercancel', stop);
  }
  function down(e) {
    if (!opts.enabled() || e.isPrimary === false) return;
    const el = e.target && e.target.closest ? e.target.closest('[data-row]') : null;
    if (!el || !root.contains(el)) return;
    stop();
    g = { el, id: e.pointerId, x: e.clientX, y: e.clientY, dx: 0, dy: 0 };
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', up);
    document.addEventListener('pointercancel', stop);
  }
  function move(e) {
    if (!g || e.pointerId !== g.id) return;
    g.dx = e.clientX - g.x;
    g.dy = e.clientY - g.y;
    if (Math.abs(g.dx) > 8 && Math.abs(g.dx) > 2 * Math.abs(g.dy)) {
      g.el.classList.add('swiping');
      g.el.classList.toggle('swipe-close', g.dx < 0);
      g.el.classList.toggle('swipe-assign', g.dx > 0);
      g.el.style.transform = 'translateX(' + Math.round(g.dx) + 'px)';
    }
  }
  function up(e) {
    if (!g || e.pointerId !== g.id) return;
    const intent = swipeIntent(g.dx, g.dy, g.x, window.innerWidth);
    const ref = g.el.getAttribute('data-ref');
    stop();
    if (!intent) return;
    mute = true;
    clearTimeout(muteTimer);
    muteTimer = setTimeout(() => { mute = false; }, MUTE_MS);
    opts.onSwipe(ref, intent);
  }
  function click(e) {
    if (!mute) return;
    mute = false;
    e.preventDefault();
    e.stopPropagation();
  }
  root.addEventListener('pointerdown', down);
  root.addEventListener('click', click, true);
  return () => {
    stop();
    clearTimeout(muteTimer);
    root.removeEventListener('pointerdown', down);
    root.removeEventListener('click', click, true);
  };
}
