// Auteur d'une ecriture (spec 2026-10-09-hk-manager-app-design.md, section 6,
// « Tracabilite ») : toujours le membre de la session, jamais la valeur envoyee
// par le navigateur (l'ancienne app envoyait « Manager » pour tous les managers).
// Seule exception : les jobs serveur Hermes (auto_assign_elite_cleanings.py,
// executors/ops.py) appellent avec le seul X-App-Secret, sans session ; leur
// nom tient dans un motif ferme, un nom libre ne passe jamais.
import type { SessionUser } from "./auth.ts";

export const NO_SESSION_ACTOR = "unknown (no session)";
const SERVER_ACTOR_RE = /^Hermes_[A-Za-z]{1,40}$/;

export function sessionActor(me: SessionUser | null, bodyActor: unknown): string {
  const name = me && typeof me.name === "string" ? me.name.trim() : "";
  if (name) return name;
  if (typeof bodyActor === "string" && SERVER_ACTOR_RE.test(bodyActor)) return bodyActor;
  return NO_SESSION_ACTOR;
}
