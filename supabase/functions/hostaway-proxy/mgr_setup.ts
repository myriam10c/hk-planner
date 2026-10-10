// Configuration maintenance de l'app manager (More > Maintenance setup, phase 5b).
//   - setupAccess : la garde des ecritures historiques saveVendor, deleteVendor,
//     saveEquipment, savePreventiveMaintenance, completePreventive et addMaintenanceCost.
//     Session manager exigee (PIN ou email, l'ancienne app envoie l'un ou l'autre),
//     verifiee AVANT toute ecriture.
//   - mgrSetup : lecture unique de l'ecran (action mgr.setup). Colonnes telles que les
//     anciens getters les rendent, plus le libelle du logement (apt · immeuble) et le nom
//     du prestataire resolus ici, pour que l'ecran n'affiche jamais « Unknown ».
// Toutes les tables sont lues en entier (readAllRows), une table illisible fait echouer
// la lecture : index.ts rend alors 503, jamais une liste partielle presentee comme complete.
import { mgrApartments } from "./mgr_apartment.ts";
import { readAllRows } from "./mgr_today.ts";

export function setupAccess(me: { role: string } | null): { status: number; error: string } | null {
  if (!me) return { status: 401, error: "auth required" };
  if (me.role !== "manager") return { status: 403, error: "Only managers can do this." };
  return null;
}

type AptMap = Record<string, { apt: string; bld: string }>;

// « 1203 · Marina Gate », l'immeuble seul sans numero, « Listing <id> » si le logement
// n'est plus dans listing_config, null sans logement (tache preventive generale).
export function setupLabel(map: AptMap, listingId: unknown): string | null {
  if (listingId === null || listingId === undefined || String(listingId) === "") return null;
  const l = map[String(listingId)];
  if (!l) return "Listing " + String(listingId);
  return l.apt ? l.apt + " · " + l.bld : l.bld;
}

// 1er jour du mois suivant (borne haute exclusive), comme getMaintenanceCosts.
function nextMonthFirst(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10);
}

const byStr = (a: unknown, b: unknown) => String(a ?? "").localeCompare(String(b ?? ""));

export async function mgrSetup(sb: any, month: string) {
  const all = (table: string, build: (q: any) => any = (q) => q) =>
    readAllRows((a: number, b: number) => build(sb.from(table).select("*")).order("id").range(a, b), table);
  const [apts, vendorsAll, equipment, schedules, costs] = await Promise.all([
    mgrApartments(sb),
    all("vendors"),
    all("equipment"),
    all("preventive_maintenance", (q) => q.eq("is_active", true)),
    all("maintenance_costs", (q) => q.gte("date", month + "-01").lt("date", nextMonthFirst(month))),
  ]);
  const listings = apts.body.listings.map((l) => ({ id: l.id, apt: l.apt, bld: l.bld }));
  const map: AptMap = Object.fromEntries(listings.map((l) => [l.id, { apt: l.apt, bld: l.bld }]));
  // Les prestataires desactives restent nommes sur l'historique (couts, taches).
  const vendorName = (id: unknown) => {
    if (id === null || id === undefined) return null;
    const v = vendorsAll.find((x: any) => String(x.id) === String(id));
    return v ? String(v.name ?? "") : null;
  };
  const vendors = vendorsAll.filter((v: any) => v.is_active === true).sort((a: any, b: any) => byStr(a.name, b.name));
  // Equipements dans l'ordre de la liste des logements (immeuble, numero), inconnus en dernier.
  const rank = (id: unknown) => { const i = listings.findIndex((l) => l.id === String(id)); return i < 0 ? listings.length : i; };
  const eq = equipment.map((e: any) => ({ ...e, listingLabel: setupLabel(map, e.listing_id) }))
    .sort((a: any, b: any) => rank(a.listing_id) - rank(b.listing_id) || byStr(a.listingLabel, b.listingLabel) || byStr(a.name, b.name));
  const sch = schedules.map((s: any) => ({
    ...s, listingLabel: setupLabel(map, s.listing_id), vendorName: vendorName(s.assigned_vendor_id),
  })).sort((a: any, b: any) => byStr(a.next_due_at, b.next_due_at) || Number(a.id) - Number(b.id));
  const cs = costs.map((c: any) => ({ ...c, listingLabel: setupLabel(map, c.listing_id), vendorName: vendorName(c.vendor_id) }))
    .sort((a: any, b: any) => byStr(b.date, a.date) || Number(b.id) - Number(a.id));
  return { vendors, equipment: eq, schedules: sch, costs: cs, listings, month };
}
