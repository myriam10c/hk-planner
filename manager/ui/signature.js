// Pad de signature dans le panneau partage (feuille sur telephone, panneau lateral sur
// ordinateur). askSignature(title) rend une promesse : data URL PNG (100 Ko max, la limite
// du proxy, hrValidSignature) ou null si le panneau est ferme sans signer (Cancel, croix,
// fond, Echap, changement d'ecran, autre panneau ouvert par-dessus).
import { closeSheet, esc, I, openSheet, sheetError } from '/manager/ui/dom.js';

const MAX_LEN = 100000;
const W = 640;
const H = 280;

function paper(c) {
  const g = c.getContext('2d');
  g.fillStyle = '#fff';
  g.fillRect(0, 0, c.width, c.height);
  g.strokeStyle = '#14213d';
  g.lineWidth = 3;
  g.lineCap = 'round';
  g.lineJoin = 'round';
  return g;
}

// PNG du dessin ; si trop lourd, meme dessin reduit de moitie, sinon null.
function exportPng(c) {
  const full = c.toDataURL('image/png');
  if (full.length <= MAX_LEN) return full;
  const half = document.createElement('canvas');
  half.width = Math.round(W / 2);
  half.height = Math.round(H / 2);
  const g = half.getContext('2d');
  g.fillStyle = '#fff';
  g.fillRect(0, 0, half.width, half.height);
  g.drawImage(c, 0, 0, half.width, half.height);
  const small = half.toDataURL('image/png');
  return small.length <= MAX_LEN ? small : null;
}

export function askSignature(title) {
  return new Promise((resolve) => {
    openSheet('<div class="sheet-h"><div><h2 id="sheetTitle">' + esc(title) + '</h2>'
      + '<div class="sub">Draw your signature below with your finger.</div></div>'
      + '<button class="iconbtn x" type="button" data-close aria-label="Close">' + I.close + '</button></div>'
      + '<div class="sheet-b"><canvas class="sig-pad" data-sig width="' + W + '" height="' + H + '" aria-label="Signature area"></canvas></div>'
      + '<div class="sheet-f"><button class="btn primary" type="button" data-sig-ok>Confirm</button>'
      + '<button class="btn" type="button" data-sig-clear>Clear</button>'
      + '<button class="btn" type="button" data-sig-cancel>Cancel</button></div>');
    const sheet = document.getElementById('sheet');
    const inner = document.getElementById('sheetInner');
    const c = inner.querySelector('[data-sig]');
    const g = paper(c);
    let drawn = false;
    let drawing = false;
    let done = false;

    const pos = (e) => {
      const r = c.getBoundingClientRect();
      return { x: (e.clientX - r.left) * (c.width / r.width), y: (e.clientY - r.top) * (c.height / r.height) };
    };
    const down = (e) => {
      e.preventDefault();
      drawing = true;
      drawn = true;
      try { c.setPointerCapture(e.pointerId); } catch (err) { /* pointeur deja relache */ }
      const p = pos(e);
      g.beginPath(); g.moveTo(p.x, p.y); g.lineTo(p.x + 0.1, p.y + 0.1); g.stroke();
    };
    const move = (e) => {
      if (!drawing) return;
      e.preventDefault();
      const p = pos(e);
      g.lineTo(p.x, p.y); g.stroke();
    };
    const up = () => { drawing = false; };

    const onClick = (e) => {
      const t = e.target && e.target.closest ? e.target.closest('button') : null;
      if (!t || !inner.contains(t)) return;
      if (t.hasAttribute('data-sig-clear')) { paper(c); drawn = false; }
      else if (t.hasAttribute('data-sig-cancel')) finish(null, true);
      else if (t.hasAttribute('data-sig-ok')) {
        if (!drawn) { sheetError('Please sign first.'); return; }
        const png = exportPng(c);
        if (!png) { sheetError('This signature is too large. Clear and sign again.'); return; }
        finish(png, true);
      }
    };

    // Toute fermeture du panneau, ou un autre contenu a sa place, vaut abandon.
    const obs = new MutationObserver(() => {
      if (!sheet.classList.contains('on') || !inner.contains(c)) finish(null, false);
    });

    function finish(value, close) {
      if (done) return;
      done = true;
      obs.disconnect();
      inner.removeEventListener('click', onClick);
      c.removeEventListener('pointerdown', down);
      c.removeEventListener('pointermove', move);
      c.removeEventListener('pointerup', up);
      c.removeEventListener('pointercancel', up);
      if (close) closeSheet();
      resolve(value);
    }

    c.addEventListener('pointerdown', down);
    c.addEventListener('pointermove', move);
    c.addEventListener('pointerup', up);
    c.addEventListener('pointercancel', up);
    inner.addEventListener('click', onClick);
    obs.observe(sheet, { attributes: true, attributeFilter: ['class'] });
    obs.observe(inner, { childList: true });
  });
}
