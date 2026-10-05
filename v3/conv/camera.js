// Horodatage incrusté : bande sombre en bas de l'image, texte blanc.
// Taille proportionnelle à la hauteur, avec un minimum lisible ; police réduite si le texte dépasse la largeur.
export function stampLayout(width, height) {
  const bar = Math.max(28, Math.round(height * 0.07));
  const font = Math.max(14, Math.round(bar * 0.4));
  const pad = Math.max(8, Math.round(font * 0.6));
  return { bar, font, pad };
}

export function drawStamp(ctx, width, height, text) {
  const { bar, font, pad } = stampLayout(width, height);

  // Essayer d'abord une seule ligne, réduire du layout.font au minimum 14px
  let size = font;
  const setFont = () => { ctx.font = "700 " + size + "px system-ui, -apple-system, Segoe UI, sans-serif"; };

  // Boucle pour réduire la police jusqu'à ce qu'une ligne rentre, ou atteindre 14px
  while (size >= 14) {
    setFont();
    if (ctx.measureText(text).width <= width - 2 * pad) {
      // Une ligne suffit
      ctx.fillStyle = "rgba(0,0,0,0.62)";
      ctx.fillRect(0, height - bar, width, bar);
      ctx.fillStyle = "#FFFFFF";
      ctx.textBaseline = "middle";
      ctx.fillText(text, pad, height - bar / 2);
      return;
    }
    size -= 1;
  }

  // Une ligne ne rentre pas, essayer deux lignes en coupant au premier " · "
  const parts = text.split(" · ");
  let line1 = parts[0];
  let line2 = parts.slice(1).join(" · ");

  size = font;
  setFont();

  // Réduire la police jusqu'à ce que les deux lignes rentrent, floor = 10px
  while (size > 10 && (ctx.measureText(line1).width > width - 2 * pad || ctx.measureText(line2).width > width - 2 * pad)) {
    size -= 1;
    setFont();
  }

  // Si même à 10px une ligne ne rentre pas, continuer à réduire jusqu'à 6px (le texte peut être illisible, mais c'est mieux que clippé)
  while (size > 6 && (ctx.measureText(line1).width > width - 2 * pad || ctx.measureText(line2).width > width - 2 * pad)) {
    size -= 1;
    setFont();
  }

  // Calculer la hauteur de la bande en fonction du nombre de lignes et de la taille de police, capped à la hauteur de l'image
  const lineHeight = size * 1.3;
  const bandHeight = Math.min(height, Math.max(bar, Math.round(2 * lineHeight + pad)));

  ctx.fillStyle = "rgba(0,0,0,0.62)";
  ctx.fillRect(0, height - bandHeight, width, bandHeight);
  ctx.fillStyle = "#FFFFFF";
  ctx.textBaseline = "middle";

  const lineSpacing = bandHeight / 3;
  ctx.fillText(line1, pad, height - bandHeight + lineSpacing);
  ctx.fillText(line2, pad, height - bandHeight + 2 * lineSpacing);
}

// Caméra arrière dans la page ; repli sur l'appareil photo du téléphone si refus ou absence.
export async function startCamera(video, md = globalThis.navigator && globalThis.navigator.mediaDevices) {
  if (!md || typeof md.getUserMedia !== "function") return null;
  try {
    const stream = await md.getUserMedia({ video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 } }, audio: false });
    video.srcObject = stream;
    if (video.play) await video.play().catch(() => {});
    return stream;
  } catch (e) {
    return null;
  }
}

// Flux encore vivant : au moins une piste vidéo en « live ». Écran verrouillé longtemps,
// la piste peut finir « ended » et la vidéo garde une image noire ou figée.
export function streamLive(stream) {
  if (!stream || typeof stream.getVideoTracks !== "function") return false;
  return stream.getVideoTracks().some(t => t.readyState === "live");
}

export function stopCamera(stream) {
  if (stream && stream.getTracks) stream.getTracks().forEach(t => t.stop());
}

// Demande de flux gardée : si la demande n'est plus la plus récente quand le flux arrive
// (viseur fermé puis rouvert vite), le flux orphelin est arrêté et débranché de la vidéo
// (sur iPhone, un flux orphelin peut rendre le nouveau viseur noir).
export async function startCameraIfCurrent(video, isCurrent, md) {
  const stream = await startCamera(video, md);
  if (isCurrent()) return { stream, stale: false };
  stopCamera(stream);
  if (stream && video.srcObject === stream) video.srcObject = null;
  return { stream: null, stale: true };
}

function toPhoto(canvas, quality) {
  return new Promise(resolve => canvas.toBlob(blob => {
    const file = new File([blob], "hk-" + Date.now() + "-" + Math.floor(Math.random() * 1e4) + ".jpg", { type: "image/jpeg" });
    resolve({ url: URL.createObjectURL(file), file });
  }, "image/jpeg", quality));
}

export async function captureFrame(video, { max = 1600, quality = 0.82, doc = document, stamp } = {}) {
  const w = video.videoWidth, h = video.videoHeight;
  const k = Math.min(1, max / Math.max(w, h));
  const c = doc.createElement("canvas");
  c.width = Math.round(w * k); c.height = Math.round(h * k);
  const ctx = c.getContext("2d");
  ctx.drawImage(video, 0, 0, c.width, c.height);
  if (stamp) drawStamp(ctx, c.width, c.height, stamp);
  return toPhoto(c, quality);
}

// `stamp` : chaîne, ou fonction appelée au retour de la photo (l'heure incrustée est celle de la prise,
// pas celle de l'ouverture du sélecteur).
export function pickPhoto(input, { max = 1600, quality = 0.82, doc = document, stamp } = {}) {
  return new Promise(resolve => {
    input.value = "";
    input.onchange = async () => {
      const f = input.files && input.files[0];
      if (!f) return resolve(null);
      try {
        const text = typeof stamp === "function" ? stamp() : stamp;
        const bmp = await createImageBitmap(f);
        const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
        const c = doc.createElement("canvas");
        c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
        const ctx = c.getContext("2d");
        ctx.drawImage(bmp, 0, 0, c.width, c.height);
        if (text) drawStamp(ctx, c.width, c.height, text);
        resolve(await toPhoto(c, quality));
      } catch (e) {
        // image non décodable : la photo part sans horodatage
        resolve({ url: URL.createObjectURL(f), file: f });
      }
    };
    input.click();
  });
}
