// Role (lead ou aide) decide au demarrage d'un menage (v3.startJob), lot 1 des
// corrections cleaner, tache 3. Avant, le role n'etait connu qu'a la fin du menage
// (jobRole) ou au rechargement (v3.myDay) : deux cleaners qui ouvraient
// l'appartement avant qu'aucune n'ait touche « I'm here » construisaient toutes
// deux le parcours complet, et le rapport de la seconde etait jete en silence.
//
// Aucune migration : l'ordre d'arrivee est celui des lignes `job_events`
// start_job, deja posees AVANT l'ecriture metier (claimEvent), et la meme regle
// (roleFromStarts : created_at puis id) sert a la fin du menage. La premiere
// ligne gagne, donc la premiere cleaner est lead.
//
// Course entre deux appels simultanes : la ligne de la premiere (id plus petit)
// peut ne pas avoir son resultat memorise quand la seconde lit. roleFromStarts
// ignore les lignes sans resultat, la seconde se croirait lead. On attend donc
// brievement qu'une ligne plus ancienne et recente se resolve : posee avec son
// resultat, elle gagne ; liberee (ecriture ratee), elle disparait. Toujours sans
// resultat au dernier essai : on ne tranche pas (rend null), sinon les deux se
// verraient lead (correction 1 de la tache 3). L'appelant libere la cle et rend
// une erreur relancable : au rejeu, la ligne de la premiere est resolue.
//
// Tache 5 : lecture (readStarts) et decision (decideStartRole) sont separees.
// Entre les deux, v3.startJob juge si le menage est fini avec les memes lignes
// (garde « menage fini »), et si son « Clean again » ouvre un nouveau menage.
import { roleFromStarts } from "./v3_finish_context.ts";

// Une ligne plus ancienne sans resultat n'est attendue que si elle date de moins
// de ce delai : au dela, c'est une cle abandonnee (fonction morte), jamais un
// demarrage en cours.
export const START_PENDING_FRESH_MS = 30_000;
export const START_WAIT_TRIES = 6;
export const START_WAIT_MS = 300;

export interface StartRole {
  role: "lead" | "helper";
  // Qui a demarre en premier, toujours renseigne (soi-meme pour un lead).
  lead: { id: number; name: string; startedAt: string | null };
}

const avant = (a: any, b: any) =>
  String(a.created_at ?? "").localeCompare(String(b.created_at ?? "")) || Number(a.id) - Number(b.id);

// Lit les start_job du menage, ma ligne comprise. Attend brievement qu'une ligne
// plus ancienne et recente d'une collegue se resolve (voir plus haut). Rend null
// si elle reste sans resultat au dernier essai : on ne tranche pas.
export async function readStarts(
  sb: any, jobId: string, me: { cleaner_id: number }, idem: string,
  opts: { sleep?: (ms: number) => Promise<void>; nowMs?: number } = {},
): Promise<any[] | null> {
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  let rows: any[] = [];
  for (let essai = 0; essai < START_WAIT_TRIES; essai++) {
    const { data, error } = await sb.from("job_events")
      .select("id, idem_key, cleaner_id, created_at, result")
      .eq("job_id", jobId).eq("event_type", "start_job");
    if (error) throw error;
    rows = data ?? [];
    const mienne = rows.find((r: any) => r.idem_key === idem);
    const now = opts.nowMs ?? Date.now();
    const enAttente = mienne && rows.some((r: any) =>
      !r.result && r.idem_key !== idem && Number(r.cleaner_id) !== Number(me.cleaner_id) &&
      avant(r, mienne) < 0 && now - Date.parse(String(r.created_at ?? "")) < START_PENDING_FRESH_MS);
    if (!enAttente) break;
    if (essai === START_WAIT_TRIES - 1) return null;
    await sleep(START_WAIT_MS);
  }
  return rows;
}

// Role decide sur les lignes lues par readStarts. `again` : mon demarrage est un
// « Clean again » accepte (tache 5), il ouvre un nouveau menage dont je suis la
// premiere, donc la lead ; ma ligne le dira dans son resultat.
export async function decideStartRole(
  sb: any, rows: any[], me: { cleaner_id: number; name: string }, idem: string, again = false,
): Promise<StartRole> {
  // Ma propre ligne compte comme aboutie : son resultat s'ecrit juste apres.
  const mon = again ? { status: "success", again: true } : { status: "success" };
  const comptees = rows.filter((r: any) => r.result || r.idem_key === idem)
    .map((r: any) => r.idem_key === idem ? { ...r, result: r.result ?? mon } : r);
  const { role, leadId, leadStartedAt } = roleFromStarts(comptees, me.cleaner_id);
  const idLead = leadId ?? me.cleaner_id;
  let name = me.name;
  if (idLead !== Number(me.cleaner_id)) {
    name = "Teammate";
    try {
      const { data } = await sb.from("cleaners").select("id, name").eq("id", idLead).maybeSingle();
      if (data && data.name) name = String(data.name);
    } catch (e) {
      console.warn("[v3.startJob] nom de la lead illisible: " + String((e as any)?.message ?? e));
    }
  }
  return { role, lead: { id: idLead, name, startedAt: leadStartedAt } };
}
