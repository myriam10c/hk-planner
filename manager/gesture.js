// Cle d'idempotence par geste (meme convention que problem-panel.js) : une cle
// neuve par geste de l'utilisateur, reprise telle quelle quand le meme geste est
// rejoue apres un echec a l'issue inconnue (delai depasse, reseau coupe, erreur 5xx
// apres une ecriture peut-etre faite, ou cle encore en cours cote serveur). Le
// serveur ne voit alors qu'un seul geste.
import { newIdem } from '/manager/api.js';

const STILL = 'Still processing. Retry.';

export function uncertain(e) {
  return !!e && (e.kind === 'timeout' || e.kind === 'offline' || (e.status === 409 && e.message === STILL)
    || (e.kind === 'server' && e.status >= 500));
}

export function createGestures() {
  let pending = null;
  return {
    // sig : signature du geste (action et corps). fn recoit la cle a envoyer.
    async run(sig, fn) {
      const idem = pending && pending.sig === sig ? pending.idem : newIdem();
      try {
        const r = await fn(idem);
        pending = null;
        return r;
      } catch (e) {
        pending = uncertain(e) ? { sig, idem } : null;
        throw e;
      }
    },
  };
}
