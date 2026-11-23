// Donnees d'un ecran trop vieilles pour un geste d'ecriture (Planning, Today) : au-dela
// d'une minute, l'ecran relit d'abord. Relecture en echec : anciennes donnees gardees,
// geste refuse (« Reconnect to make changes. »).
export const STALE_MS = 60000;

// Donnees lues a l'instant at (ms) : trop vieilles a l'instant now ?
export function isStale(at, now) { return now - at > STALE_MS; }

// Garde d'un geste, rend une fonction async : true quand le geste peut partir.
// o.blocked() : aucune ecriture sans relire (donnees en cache, derniere lecture ratee),
// refus sans relecture ; o.stale() : relecture due avant le geste ; o.refresh() :
// relecture de l'ecran (ne rejette pas) ; o.readOnly() : aucune ecriture apres la
// relecture ; o.refuse() : le dire ; o.isCurrent() : ecran toujours affiche ;
// o.scope() (facultatif) : ce que lit la relecture (la semaine de Planning), geste
// abandonne s'il a change pendant la relecture. Une relecture a la fois : un geste
// arrive pendant celle-ci est abandonne. Une exception pendant la relecture (un repeint
// qui plante) leve le verrou quand meme : les gestes suivants relisent encore.
export function createFreshGate(o) {
  let reloading = false;
  return async function freshEnough() {
    if (o.blocked()) { o.refuse(); return false; }
    if (!o.stale()) return true;
    if (reloading) return false;
    const scope = o.scope ? o.scope() : null;
    reloading = true;
    try { await o.refresh(); } finally { reloading = false; }
    if (!o.isCurrent() || (o.scope && o.scope() !== scope)) return false;
    if (o.readOnly()) { o.refuse(); return false; }
    return true;
  };
}
