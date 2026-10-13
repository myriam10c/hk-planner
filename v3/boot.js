// Demarrage de l'app v3 (revue finale, maintenance phase 3). index.html charge ce
// module, qui importe app.js. Filet du premier chargement apres un deploiement :
// un ancien service worker (cache d'abord pour les modules) peut servir les
// anciens modules a cote du nouvel app.js. L'import echoue alors au liage
// (SyntaxError : export absent) et l'app resterait blanche. On vide les caches
// « hk-v3- » et on recharge une seule fois : les modules reviennent du reseau.
// Un echec reseau (hors ligne, TypeError) ne vide rien : le cache est la seule
// copie de l'app dans un appartement sans signal. Le lien de secours de
// index.html reste le dernier recours.
const CLE = 'v3BootRetry';

function lire() {
  try { return sessionStorage.getItem(CLE); } catch (e) { return '1'; }
}

function viderCaches() {
  if (!self.caches || !caches.keys) return Promise.resolve();
  return caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k.indexOf('hk-v3-') === 0; })
      .map(function (k) { return caches.delete(k); }));
  });
}

import('/v3/app.js').then(function () {
  try { sessionStorage.removeItem(CLE); } catch (e) { /* rien a nettoyer */ }
}).catch(function (err) {
  if (!err || err.name !== 'SyntaxError' || lire()) throw err;
  try { sessionStorage.setItem(CLE, '1'); } catch (e) { throw err; }
  return viderCaches().catch(function () { /* on recharge quand meme */ })
    .then(function () { location.reload(); });
});
