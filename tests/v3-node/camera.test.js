import { test } from "node:test";
import assert from "node:assert/strict";
import { startCamera, startCameraIfCurrent, stampLayout, drawStamp, streamLive, pickPhoto } from "../../v3/conv/camera.js";

test("caméra refusée : null, pas d'exception", async () => {
  const md = { getUserMedia: async () => { throw new Error("NotAllowedError"); } };
  assert.equal(await startCamera({}, md), null);
});

test("pas de mediaDevices : null", async () => {
  assert.equal(await startCamera({}, undefined), null);
});

test("caméra accordée : le flux est branché sur la vidéo", async () => {
  const stream = { id: "s" };
  const video = { play: async () => {} };
  const md = { getUserMedia: async c => { assert.deepEqual(c.video.facingMode, { ideal: "environment" }); return stream; } };
  assert.equal(await startCamera(video, md), stream);
  assert.equal(video.srcObject, stream);
});

test("flux arrivé après fermeture/réouverture : arrêté et débranché", async () => {
  let stopped = 0;
  const stream = { getTracks: () => [{ stop: () => { stopped++; } }] };
  const video = { play: async () => {} };
  const md = { getUserMedia: async () => stream };
  const r = await startCameraIfCurrent(video, () => false, md);
  assert.deepEqual(r, { stream: null, stale: true });
  assert.equal(stopped, 1);
  assert.equal(video.srcObject, null);
});

test("flux orphelin : un flux plus récent branché entre-temps n'est pas débranché", async () => {
  const stale = { getTracks: () => [{ stop() {} }] };
  const newer = { id: "newer" };
  const video = { play: async () => { video.srcObject = newer; } }; // la demande récente branche son flux pendant l'attente
  const r = await startCameraIfCurrent(video, () => false, { getUserMedia: async () => stale });
  assert.equal(r.stale, true);
  assert.equal(video.srcObject, newer);
});

test("demande toujours courante : flux gardé", async () => {
  const stream = { getTracks: () => [] };
  const video = { play: async () => {} };
  const r = await startCameraIfCurrent(video, () => true, { getUserMedia: async () => stream });
  assert.deepEqual(r, { stream, stale: false });
  assert.equal(video.srcObject, stream);
});

test("bande d'horodatage proportionnée, lisible même sur image étroite", () => {
  const wide = stampLayout(1600, 1200);
  assert.equal(wide.bar, 84);
  assert.equal(wide.font, 34);
  const narrow = stampLayout(360, 1600);
  assert.ok(narrow.font >= 14, "police lisible");
  assert.ok(narrow.bar >= narrow.font + 8, "bande plus haute que le texte");
  const tiny = stampLayout(200, 150);
  assert.ok(tiny.bar >= 28 && tiny.font >= 14);
});

test("drawStamp : bande sombre en bas puis texte blanc, réduit pour tenir en largeur", () => {
  const calls = [];
  let currentSize = 34;
  const ctx = {
    set fillStyle(v) { calls.push(["fill", v]); },
    set font(v) {
      calls.push(["font", v]);
      const match = v.match(/(\d+)px/);
      if (match) currentSize = parseInt(match[1], 10);
    },
    set textBaseline(v) {},
    fillRect: (...a) => calls.push(["rect", ...a]),
    fillText: (t, x, y) => calls.push(["text", t, x, y]),
    measureText: t => ({ width: t.length * currentSize * 0.55 }),
  };
  const layout = stampLayout(200, 300);
  drawStamp(ctx, 200, 300, "122 Oxford Boulevard · Sun 5 Oct 2026 · 10:42 · Faiza");
  const rect = calls.find(c => c[0] === "rect");
  assert.ok(rect, "rectangle doit être dessiné");
  assert.equal(rect[3], 200, "largeur de la bande = largeur du canvas");
  const fonts = calls.filter(c => c[0] === "font").map(c => parseInt(c[1].match(/(\d+)px/)[1], 10));
  const initialFont = layout.font;
  const finalFont = fonts.at(-1);
  assert.ok(finalFont < initialFont, "police réduite strictement par rapport au layout");
  const texts = calls.filter(c => c[0] === "text");
  for (const text of texts) {
    const textStr = text[1], x = text[2];
    const measuredWidth = textStr.length * finalFont * 0.55;
    assert.ok(x + measuredWidth <= 200 - layout.pad, `texte doit tenir en largeur: ${textStr}`);
  }
});

test("horodatage : texte sur une ligne pour image large", () => {
  const calls = [];
  let currentSize = 34;
  const ctx = {
    set fillStyle(v) { calls.push(["fill", v]); },
    set font(v) {
      calls.push(["font", v]);
      const match = v.match(/(\d+)px/);
      if (match) currentSize = parseInt(match[1], 10);
    },
    set textBaseline(v) {},
    fillRect: (...a) => calls.push(["rect", ...a]),
    fillText: (t, x, y) => calls.push(["text", t, x, y]),
    measureText: t => ({ width: t.length * currentSize * 0.55 }),
  };
  const layout = stampLayout(1600, 1200);
  drawStamp(ctx, 1600, 1200, "122 Oxford Boulevard · Sun 5 Oct 2026 · 10:42 · Faiza");
  const texts = calls.filter(c => c[0] === "text");
  assert.equal(texts.length, 1, "une seule ligne pour image large");
  const font = calls.filter(c => c[0] === "font").map(c => parseInt(c[1].match(/(\d+)px/)[1], 10)).at(-1);
  assert.ok(font >= 14, "police au minimum 14px");
  const rect = calls.find(c => c[0] === "rect");
  assert.equal(rect[2], 1200 - layout.bar, "bande positionnée en bas");
  // Vérifier que le texte rendu tient en largeur
  for (const text of texts) {
    const textStr = text[1], x = text[2];
    const measuredWidth = textStr.length * font * 0.55;
    assert.ok(x + measuredWidth <= 1600 - layout.pad, `texte doit tenir en largeur: ${textStr}`);
  }
});

test("horodatage : texte sur deux lignes pour image étroite", () => {
  const calls = [];
  let currentSize = 34;
  const ctx = {
    set fillStyle(v) { calls.push(["fill", v]); },
    set font(v) {
      calls.push(["font", v]);
      const match = v.match(/(\d+)px/);
      if (match) currentSize = parseInt(match[1], 10);
    },
    set textBaseline(v) {},
    fillRect: (...a) => calls.push(["rect", ...a]),
    fillText: (t, x, y) => calls.push(["text", t, x, y]),
    measureText: t => ({ width: t.length * currentSize * 0.55 }),
  };
  drawStamp(ctx, 360, 1600, "122 Oxford Boulevard · Mon 5 Oct 2026 · 10:42 · Faiza");
  const texts = calls.filter(c => c[0] === "text");
  assert.equal(texts.length, 2, "deux lignes pour image étroite");
  assert.equal(texts[0][1], "122 Oxford Boulevard", "première ligne = bâtiment");
  assert.equal(texts[1][1], "Mon 5 Oct 2026 · 10:42 · Faiza", "deuxième ligne = date/heure/prénom");
  const font = calls.filter(c => c[0] === "font").map(c => parseInt(c[1].match(/(\d+)px/)[1], 10)).at(-1);
  assert.ok(font >= 10, "police au minimum 10px");
  const rect = calls.find(c => c[0] === "rect");
  const layout = stampLayout(360, 1600);
  // Vérifier que chaque ligne rendue tient en largeur
  for (const text of texts) {
    const textStr = text[1], x = text[2];
    const measuredWidth = textStr.length * font * 0.55;
    assert.ok(x + measuredWidth <= 360 - layout.pad, `texte doit tenir en largeur: ${textStr}`);
  }
  // Vérifier les propriétés du rectangle
  const bandHeight = Math.min(1600, Math.max(layout.bar, Math.round(2 * font * 1.3 + layout.pad)));
  assert.equal(rect[1], 0, "rect x === 0");
  assert.equal(rect[2], 1600 - bandHeight, "rect y === height - bandHeight");
  assert.equal(rect[3], 360, "rect width === 360");
});

test("horodatage : texte sur une ligne pour image 600x800", () => {
  const calls = [];
  let currentSize = 34;
  const ctx = {
    set fillStyle(v) { calls.push(["fill", v]); },
    set font(v) {
      calls.push(["font", v]);
      const match = v.match(/(\d+)px/);
      if (match) currentSize = parseInt(match[1], 10);
    },
    set textBaseline(v) {},
    fillRect: (...a) => calls.push(["rect", ...a]),
    fillText: (t, x, y) => calls.push(["text", t, x, y]),
    measureText: t => ({ width: t.length * currentSize * 0.55 }),
  };
  const layout = stampLayout(600, 800);
  drawStamp(ctx, 600, 800, "122 Oxford Boulevard · Sun 5 Oct 2026 · 10:42 · Faiza");
  const texts = calls.filter(c => c[0] === "text");
  assert.equal(texts.length, 1, "une seule ligne pour 600x800");
  const font = calls.filter(c => c[0] === "font").map(c => parseInt(c[1].match(/(\d+)px/)[1], 10)).at(-1);
  assert.ok(font >= 14 && font <= layout.font, "police entre 14 et layout.font");
  // Vérifier que le texte rendu tient en largeur
  for (const text of texts) {
    const textStr = text[1], x = text[2];
    const measuredWidth = textStr.length * font * 0.55;
    assert.ok(x + measuredWidth <= 600 - layout.pad, `texte doit tenir en largeur`);
  }
});

test("horodatage : texte sur deux lignes pour image extrêmement étroite", () => {
  const calls = [];
  let currentSize = 34;
  const ctx = {
    set fillStyle(v) { calls.push(["fill", v]); },
    set font(v) {
      calls.push(["font", v]);
      const match = v.match(/(\d+)px/);
      if (match) currentSize = parseInt(match[1], 10);
    },
    set textBaseline(v) {},
    fillRect: (...a) => calls.push(["rect", ...a]),
    fillText: (t, x, y) => calls.push(["text", t, x, y]),
    measureText: t => ({ width: t.length * currentSize * 0.55 }),
  };
  drawStamp(ctx, 120, 400, "122 Oxford Boulevard · Mon 5 Oct 2026 · 10:42 · Faiza");
  const texts = calls.filter(c => c[0] === "text");
  assert.ok(texts.length > 0, "du texte doit être affiché");
  const font = calls.filter(c => c[0] === "font").map(c => parseInt(c[1].match(/(\d+)px/)[1], 10)).at(-1);
  assert.ok(font >= 6, "police peut descendre à 6px en extrême");
  const rect = calls.find(c => c[0] === "rect");
  assert.ok(rect, "rectangle doit être dessiné");
  for (const text of texts) {
    const measuredWidth = text[1].length * font * 0.55;
    const x = text[2];
    assert.ok(x + measuredWidth <= 120 - 8, `texte ${text[1]} doit tenir dans la largeur`);
  }
});

test("flux vivant : une piste vidéo « live » ; arrêtée, absente ou sans flux : non", () => {
  const st = (...states) => ({ getVideoTracks: () => states.map(readyState => ({ readyState })) });
  assert.equal(streamLive(st("live")), true);
  assert.equal(streamLive(st("ended", "live")), true);
  assert.equal(streamLive(st("ended")), false);
  assert.equal(streamLive(st()), false);
  assert.equal(streamLive(null), false);
  assert.equal(streamLive({}), false);
});

// Faux champ fichier et faux canvas : on vérifie seulement quand et avec quoi l'horodatage est calculé.
function fakePicker() {
  const drawn = [];
  const ctx = { font: "", fillStyle: "", textBaseline: "", drawImage() {}, fillRect() {}, measureText: t => ({ width: t.length }), fillText: t => drawn.push(t) };
  const doc = { createElement: () => ({ width: 0, height: 0, getContext: () => ctx, toBlob: cb => cb(new Blob(["x"], { type: "image/jpeg" })) }) };
  const input = { value: "x", files: null, onchange: null, clicked: 0, click() { this.clicked++; } };
  return { drawn, doc, input };
}

test("repli sans caméra : l'horodatage est calculé au retour de la photo (fonction), ou repris tel quel (chaîne)", async () => {
  const prev = globalThis.createImageBitmap;
  globalThis.createImageBitmap = async () => ({ width: 2000, height: 1500 });
  try {
    const { drawn, doc, input } = fakePicker();
    let calls = 0;
    const pending = pickPhoto(input, { doc, stamp: () => { calls++; return "1011C Bloom Towers · Sun 5 Oct 2026 · 10:47 · Faiza"; } });
    assert.equal(input.clicked, 1);
    assert.equal(calls, 0, "rien n'est calculé à l'ouverture du sélecteur");
    input.files = [new File(["x"], "p.jpg", { type: "image/jpeg" })];
    await input.onchange();
    const photo = await pending;
    assert.equal(calls, 1);
    assert.deepEqual(drawn, ["1011C Bloom Towers · Sun 5 Oct 2026 · 10:47 · Faiza"]);
    assert.equal(photo.file.type, "image/jpeg");
    // compatibilité : une chaîne est incrustée telle quelle
    const b = fakePicker();
    const p2 = pickPhoto(b.input, { doc: b.doc, stamp: "fixe" });
    b.input.files = [new File(["x"], "p.jpg", { type: "image/jpeg" })];
    await b.input.onchange();
    await p2;
    assert.deepEqual(b.drawn, ["fixe"]);
    // sélecteur rendu vide : null, et la fonction n'est pas appelée
    const e = fakePicker();
    let n = 0;
    const p3 = pickPhoto(e.input, { doc: e.doc, stamp: () => { n++; return "x"; } });
    e.input.files = [];
    await e.input.onchange();
    assert.equal(await p3, null);
    assert.equal(n, 0);
  } finally { globalThis.createImageBitmap = prev; }
});
