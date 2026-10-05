// Photos du telephone : reduction a 1600 px de grand cote, JPEG qualite 0.8.
const MAX = 1600;

// Rend le fichier reduit ; si l'image est illisible, rend le fichier d'origine.
export async function shrink(file) {
  if (!file) return null;
  try {
    const bmp = await createImageBitmap(file);
    const k = Math.min(1, MAX / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(bmp.width * k));
    c.height = Math.max(1, Math.round(bmp.height * k));
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    if (bmp.close) bmp.close();
    const blob = await new Promise((res) => c.toBlob(res, 'image/jpeg', 0.8));
    return blob || file;
  } catch (e) {
    return file;
  }
}

// Ouvre l'appareil photo (ou la galerie) et rend la photo reduite, ou null si annule.
export function pickAndShrink() {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = 'image/*'; input.setAttribute('capture', 'environment');
    input.onchange = async () => resolve(input.files && input.files[0] ? await shrink(input.files[0]) : null);
    input.addEventListener('cancel', () => resolve(null));
    input.click();
  });
}
