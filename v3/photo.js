// Appareil photo : une seule entree de fichier pour toute l'application
// (`#v3-cam` dans index.html), et un seul redimensionnement avant envoi. Le code
// vivait dans l'ecran Job ; il est sorti ici mot pour mot quand l'ecran de
// signalement a eu le meme besoin, plutot que d'en garder deux copies qui
// divergeraient au premier correctif.

// Redimensionne un Blob photo cote client avant envoi : une photo de camera
// recente pese 4 a 10 Mo, au-dela du plafond 6 Mo du proxy (revue tache 5,
// constat 3), et en data mobile chaque envoi rate coute une photo perdue.
// Cote large a 1600 px, JPEG 0.8. Si le canvas echoue (image corrompue, type
// non decode), on renvoie le fichier original : mieux vaut tenter l'envoi
// (et laisser le proxy refuser en 400) que perdre la photo silencieusement.
export function redimensionnerPhoto(fichier) {
  return new Promise(function (resolve) {
    const img = new Image();
    const url = URL.createObjectURL(fichier);
    img.onload = function () {
      URL.revokeObjectURL(url);
      const cote = 1600;
      const ratio = Math.min(1, cote / Math.max(img.width, img.height));
      const w = Math.round(img.width * ratio);
      const h = Math.round(img.height * ratio);
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      const ctx = c.getContext('2d');
      ctx.drawImage(img, 0, 0, w, h);
      c.toBlob(function (blob) {
        resolve(blob ? new File([blob], 'photo.jpg', { type: 'image/jpeg' }) : fichier);
      }, 'image/jpeg', 0.8);
    };
    img.onerror = function () {
      URL.revokeObjectURL(url);
      resolve(fichier);
    };
    img.src = url;
  });
}

// Ouvre l'appareil photo et rend le Blob choisi, redimensionne. Une seule
// entree de fichier pour toute l'application : on la reserve le temps d'une
// prise. Rend null si la cleaner annule.
export function prendrePhoto() {
  return new Promise(function (resolve) {
    const input = document.getElementById('v3-cam');
    if (!input) { resolve(null); return; }
    input.value = '';
    input.onchange = function () {
      const f = input.files && input.files[0] ? input.files[0] : null;
      input.onchange = null;
      if (!f) { resolve(null); return; }
      redimensionnerPhoto(f).then(resolve);
    };
    input.click();
  });
}
