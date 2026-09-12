// Retour arriere du pilote : on desinstalle le service worker de portee /v3/ et
// on vide son cache, sinon le telephone continuerait a servir la version en
// cache, puis on renvoie vers l'app actuelle.
//
// Ce fichier ne sert a rien tant que le pilote tourne. Il est deploye pret a
// l'emploi pour que le retour arriere soit une copie de deux fichiers et un
// deploiement, jamais une reecriture dans l'urgence (voir docs/v3-pilote-suivi.md).
if ('serviceWorker' in navigator) {
  const regs = await navigator.serviceWorker.getRegistrations();
  await Promise.all(regs.filter((r) => r.scope.indexOf('/v3/') !== -1).map((r) => r.unregister()));
}
if (window.caches) {
  const keys = await caches.keys();
  await Promise.all(keys.filter((k) => k.indexOf('hk-v3-') === 0).map((k) => caches.delete(k)));
}
location.replace('/#cleaner');
