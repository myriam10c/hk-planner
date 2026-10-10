// Autopilote du jour : assigne les departs sans cleaner et prepare un message
// WhatsApp par cleaner. Extrait de l'action runAutopilot d'index.ts pour etre
// partage avec mgr.autopilot.run et teste sans Hostaway. Les liens wa.me sont
// rendus, jamais ouverts ici : c'est le manager qui tape dessus.
import { CLEANER_PUBLIC_SELECT } from "./auth.ts";

// ========== Date effective d'un ménage ==========
// Une prestation reportée garde VOLONTAIREMENT sa reservation_key figée sur la date
// d'origine (voir applyPostponements dans app.js : l'assignation, l'état "fait" et la
// checklist sont indexés sur cette clé). La date réelle vit dans cleaning_postponed.
// Toute vérification de congé doit donc raisonner sur new_date ?? date de la clé, sinon
// un ménage déplacé DANS une période de congé passe a travers le blocage strict, et un
// ménage déplacé HORS de la période est bloqué a tort.
export function dateFromKey(key: string): string | null {
  const m = String(key || "").match(/^(?:extra_)?(\d{4}-\d{2}-\d{2})_/);
  return m ? m[1] : null;
}

// Charge en UNE fois (jamais dans une boucle par ménage) les reports d'une liste de
// clés. Renvoie une map clé -> new_date. Les clés sont découpées par paquets de 100
// pour ne pas fabriquer une URL PostgREST démesurée sur un gros lot.
// Lève en cas d'erreur de lecture : c'est a l'appelant de décider s'il échoue fermé
// (assignation unitaire) ou ouvert (traitement par lot).
export async function loadPostponedDates(sb: any, keys: string[]): Promise<Record<string, string>> {
  const map: Record<string, string> = {};
  const uniq = [...new Set((keys || []).map((k) => String(k)).filter((k) => !!k))];
  for (let i = 0; i < uniq.length; i += 100) {
    const { data, error } = await sb.from("cleaning_postponed")
      .select("reservation_key, new_date").in("reservation_key", uniq.slice(i, i + 100));
    if (error) throw error;
    (data || []).forEach((p: any) => { if (p.new_date) map[p.reservation_key] = p.new_date; });
  }
  return map;
}

export type AutopilotNotified = {
  cleaner: string; phone: string | null; tasks: number; message: string; waLink: string | null; autoSendEnabled: boolean;
};
export type AutopilotResult = {
  checkouts: number; alreadyAssigned: number; newlyAssigned: number; autoSendEnabled: boolean;
  notified: AutopilotNotified[];
  // Reponse historique quand il n'y a aucun depart (lue par l'ancienne app).
  message?: string; assigned?: number;
};

// loadDepartures(day) rend les reservations Hostaway brutes qui partent ce jour-la
// (l'appel reseau et le jeton restent dans index.ts ; il leve en cas d'erreur API).
export async function runAutopilot(
  sb: any, day: string, loadDepartures: (day: string) => Promise<any[]>,
): Promise<AutopilotResult> {
  // 1. Check if auto-send is enabled
  const { data: configData } = await sb.from("app_config").select("value").eq("key", "auto_send_cleaners").single();
  const autoSendEnabled = configData ? configData.value === 'true' : true;

  // 2-3. Departs du jour Dubai passe par l'appelant
  const validStatuses = ['new','modified','confirmed','ownerStay','reserved'];
  const reservations = (await loadDepartures(day)).filter((r: any) => validStatuses.includes(r.status)).map((r: any) => ({
    key: r.departureDate + '_' + (r.guestName || ((r.guestFirstName || '') + ' ' + (r.guestLastName || '')).trim()),
    listing: r.listingName || '',
    listingId: String(r.listingMapId || r.listingId || ''),
    guest: r.guestName || ((r.guestFirstName || '') + ' ' + (r.guestLastName || '')).trim(),
  }));

  if (reservations.length === 0) {
    return {
      message: "No checkouts today", checkouts: 0, assigned: 0,
      alreadyAssigned: 0, newlyAssigned: 0, autoSendEnabled, notified: [],
    };
  }

  // 4. Get current assignments + cleaners (multi-assign aware)
  const { data: assignData } = await sb.from("cleaning_assignments").select("reservation_key, cleaner_id");
  const existingMap: Record<string, number[]> = {};
  (assignData || []).forEach((r: any) => {
    if (!existingMap[r.reservation_key]) existingMap[r.reservation_key] = [];
    existingMap[r.reservation_key].push(r.cleaner_id);
  });

  // Projection explicite : cette route renvoie des noms et des telephones
  // dans `notified`, jamais de colonne secrete (hotfix du 2026-09-12).
  const { data: cleanerData } = await sb.from("cleaners")
    .select(CLEANER_PUBLIC_SELECT).eq("is_active", true).eq("role", "cleaner").order("name");
  const cls = cleanerData || [];

  // 5. Auto-assign cleanings that have NO cleaner attached yet
  const unassigned = reservations.filter((r: any) => !(existingMap[r.key] && existingMap[r.key].length > 0));
  let newlyAssigned = 0;
  if (unassigned.length > 0 && cls.length > 0) {
    const load: Record<number, number> = {};
    cls.forEach((c: any) => { load[c.id] = 0; });
    Object.values(existingMap).forEach((arr) => arr.forEach((cid) => { if (load[cid] !== undefined) load[cid]++; }));
    // Chargement unique des conges approuves avant la boucle (meme approche qu'autoAssign).
    // En cas d'erreur lecture, on echoue en mode ouvert (le batch ne doit pas mourir
    // pour un conge non verifie) : isOnLeaveAuto retourne false pour tous.
    const { data: apLeaveRows } = await sb.from("leave_requests")
      .select("cleaner_id, start_date, end_date").eq("status", "approved");
    const isOnLeaveAuto = (cid: number, d: string | null) =>
      !!d && (apLeaveRows || []).some((l: any) =>
        l.cleaner_id === cid && l.start_date <= d && l.end_date >= d);
    // Dates effectives (reports) chargees une seule fois avant la boucle.
    // Meme regle d'echec ouvert que le reste de l'autopilote.
    let apPostMap: Record<string, string> = {};
    try {
      apPostMap = await loadPostponedDates(sb, unassigned.map((r: any) => String(r.key)));
    } catch (e) {
      console.warn("[runAutopilot] postponed lookup failed, falling back to key dates:", (e as any)?.message);
    }
    for (const r of unassigned) {
      // Date effective du menage : report eventuel, sinon date de la cle.
      const day2 = apPostMap[String(r.key)] || dateFromKey(String(r.key));
      const pool = cls.filter((c: any) => !isOnLeaveAuto(c.id, day2));
      if (!pool.length) continue; // aucun cleaner disponible ce jour-la, on saute
      let minLoad = Infinity, minId = pool[0].id;
      for (const c of pool) { if (load[c.id] < minLoad) { minLoad = load[c.id]; minId = c.id; } }
      // cleaning_assignments n'a pas de colonne d'auteur : rien a tracer ici.
      const { error } = await sb.from("cleaning_assignments")
        .upsert({ reservation_key: r.key, cleaner_id: minId, assigned_at: new Date().toISOString() },
                { onConflict: "reservation_key,cleaner_id" });
      if (!error) { load[minId]++; existingMap[r.key] = [minId]; newlyAssigned++; }
    }
  }

  // 6. Build WhatsApp messages per cleaner: every assigned cleaner gets the task in their list
  const notified: AutopilotNotified[] = [];
  const cleanerTasks: Record<number, any[]> = {};
  reservations.forEach((r: any) => {
    const cids = existingMap[r.key] || [];
    cids.forEach((cid: number) => {
      if (!cleanerTasks[cid]) cleanerTasks[cid] = [];
      cleanerTasks[cid].push(r);
    });
  });

  for (const c of cls) {
    const tasks = cleanerTasks[c.id];
    if (!tasks || tasks.length === 0) continue;
    let msg = '🏠 Hey ' + c.name + '! Your cleanings for today:\n\n';
    tasks.forEach((r: any, i: number) => { msg += (i + 1) + '. ' + r.listing + ' (' + r.guest + ')\n'; });
    msg += '\nTotal: ' + tasks.length + ' cleanings. Good luck! 💪';
    const phone = c.phone ? c.phone.replace(/[^0-9+]/g, '') : null;
    const waLink = phone ? 'https://wa.me/' + phone + '?text=' + encodeURIComponent(msg) : null;
    notified.push({ cleaner: c.name, phone: c.phone, tasks: tasks.length, message: msg, waLink, autoSendEnabled });
  }

  return {
    checkouts: reservations.length,
    alreadyAssigned: reservations.length - unassigned.length,
    newlyAssigned,
    autoSendEnabled,
    notified,
  };
}
