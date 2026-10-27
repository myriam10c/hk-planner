// Le texte du rapport en image (27/10, demande Hillal) : un seul partage, photos et texte ensemble,
// sans légende. Partagé avec des photos, le texte serait recopié par WhatsApp sous chaque photo ;
// rendu en première image, il apparaît une seule fois. Le texte reste aussi copié (presse-papiers).

// Lignes de la carte depuis la mise en forme WhatsApp : *gras* et _italique_ retirés, une ligne
// entièrement en gras (titre, rubriques) est rendue en gras.
export function cardLines(text) {
  return String(text || "").split("\n").map(raw => {
    const plain = raw.replace(/\*([^*\n]+)\*/g, "$1").replace(/_([^_\n]+)_/g, "$1");
    const label = /^\*[^*]+:\*/.test(raw) ? raw.match(/^\*([^*]+:)\*/)[1] : null;
    return { text: plain, label };
  });
}

function wrap(ctx, text, width) {
  const words = text.split(" ");
  const out = [];
  let line = "";
  for (const w of words) {
    const next = line ? line + " " + w : w;
    if (line && ctx.measureText(next).width > width) { out.push(line); line = w; } else line = next;
  }
  out.push(line);
  return out;
}

const FONT = "system-ui, -apple-system, Segoe UI, Roboto, sans-serif";

// Rendu synchrone (toDataURL, pas toBlob) : le partage qui suit garde l'activation du geste.
export function reportCard(text, { name = "HK_report.jpg", doc = globalThis.document, W = 1080 } = {}) {
  const lines = cardLines(text);
  const [title, ...rest] = lines;
  const pad = 56, size = 36, lh = 54, titleSize = 44;
  const c = doc.createElement("canvas");
  const ctx = c.getContext("2d");
  // Mesure d'abord (hauteur selon le retour à la ligne), puis dessin.
  ctx.font = "400 " + size + "px " + FONT;
  const rows = [];
  for (const l of rest) {
    if (!l.text.trim()) { rows.push({ gap: true }); continue; }
    wrap(ctx, l.text, W - 2 * pad).forEach((t, i) => rows.push({ t, label: i === 0 ? l.label : null }));
  }
  ctx.font = "700 " + titleSize + "px " + FONT;
  const titleRows = wrap(ctx, title ? title.text : "", W - 2 * pad);
  const band = pad + titleRows.length * (titleSize + 14) + 24;
  c.width = W;
  c.height = band + pad / 2 + rows.reduce((h, r) => h + (r.gap ? lh / 2 : lh), 0) + pad;
  ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, c.width, c.height);
  ctx.fillStyle = "#0d5c4f"; ctx.fillRect(0, 0, c.width, band);
  ctx.textBaseline = "top";
  ctx.fillStyle = "#ffffff"; ctx.font = "700 " + titleSize + "px " + FONT;
  titleRows.forEach((t, i) => ctx.fillText(t, pad, pad - 8 + i * (titleSize + 14)));
  let y = band + pad / 2;
  for (const r of rows) {
    if (r.gap) { y += lh / 2; continue; }
    ctx.fillStyle = "#16201d";
    if (r.label && r.t.startsWith(r.label)) {
      ctx.font = "700 " + size + "px " + FONT;
      ctx.fillText(r.label, pad, y);
      const w = ctx.measureText(r.label + " ").width;
      ctx.font = "400 " + size + "px " + FONT;
      ctx.fillText(r.t.slice(r.label.length).trimStart(), pad + w, y);
    } else {
      ctx.font = "400 " + size + "px " + FONT;
      ctx.fillText(r.t, pad, y);
    }
    y += lh;
  }
  const data = c.toDataURL("image/jpeg", 0.9);
  const bin = atob(data.split(",")[1]);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new File([bytes], name, { type: "image/jpeg" });
}
