// Regles pures du module Inspections (spec 2026-10-05-hk-inspections-design.md).
// Aucune base, aucun reseau : tout ce qui decide quoi proposer vit ici.
import { plusDays } from "./v3.ts";

export const INSP_ZONES = [
  { key: "entrance", label: "Entrance, door & lock" },
  { key: "living", label: "Living room" },
  { key: "kitchen", label: "Kitchen & appliances" },
  { key: "bedrooms", label: "Bedroom(s) & bedding" },
  { key: "bathrooms", label: "Bathroom(s) & plumbing" },
  { key: "ac", label: "AC" },
  { key: "wifi_tv", label: "Wi-Fi & TV" },
  { key: "balcony", label: "Balcony & windows" },
  { key: "inventory", label: "Inventory & consumables" },
  { key: "cleanliness", label: "General cleanliness" },
  { key: "det", label: "DET equipment" },
] as const;
export const INSP_ZONE_KEYS = new Set<string>(INSP_ZONES.map((z) => z.key));

// Equipements obligatoires DET (Annexe 1, Standard). who = qui fournit : owner, medini, ou both
// (le proprio achete, Medini reassort). Source unique, renvoyee au front dans le snapshot.
export type InspDetItem = { key: string; group: string; label: string; who: "owner" | "medini" | "both" };
const det = (group: string, rows: Array<[string, string, InspDetItem["who"]]>): InspDetItem[] =>
  rows.map(([key, label, who]) => ({ key, group, label, who }));
export const INSP_DET_ITEMS: InspDetItem[] = [
  ...det("Displays", [
    ["permit", "DET permit displayed", "medini"],
    ["qr", "Unit QR code under the DEWA plaque", "medini"],
    ["notice", "Emergency procedures and 24h numbers, Arabic and English", "medini"],
    ["qibla", "Qibla direction", "medini"],
    ["guide", "Visitor guide / Medini Guide QR", "medini"],
    ["rules", "House and building rules for guests", "medini"],
  ]),
  ...det("Safety", [
    ["extinguisher", "Fire extinguisher, in date", "owner"],
    ["blanket", "Fire blanket", "owner"],
    ["gloves_torch", "Gloves and working torch", "owner"],
    ["first_aid", "First aid kit, complete", "both"],
    ["peephole", "Peephole or intercom", "owner"],
    ["smart_lock", "SIRA smart lock, Keyless", "owner"],
  ]),
  ...det("Unit", [
    ["wifi", "Wi-Fi working", "owner"],
    ["blackout", "Blackout curtains", "owner"],
    ["bins", "Waste bin in kitchen and every room", "owner"],
    ["iron", "Iron and ironing board", "owner"],
    ["vacuum", "Vacuum cleaner", "owner"],
    ["cleaning_tools", "Mop, bucket, cleaning tools", "owner"],
    ["washer_dryer", "Washing machine with dryer", "owner"],
  ]),
  ...det("Living room", [
    ["sofa", "Sofa for two per bedroom", "owner"],
    ["dining", "Dining table, 2 chairs per bedroom", "owner"],
    ["tv", "TV with remote", "owner"],
    ["rug", "Rug or carpet", "owner"],
  ]),
  ...det("Bedroom", [
    ["bed", "Bed with headboard, good mattress", "owner"],
    ["bedding", "Pillows and duvet on every bed", "owner"],
    ["bedside", "Bedside table and lamp", "owner"],
    ["wardrobe", "Wardrobe with shelves and mirror", "owner"],
    ["hangers", "At least 6 hangers", "owner"],
    ["safe", "Safe box", "owner"],
    ["sheets", "2 sets of sheets per bed", "both"],
  ]),
  ...det("Bathroom", [
    ["bath_mirror", "Mirror with lighting", "owner"],
    ["toiletries", "Soap and shampoo", "medini"],
    ["towels", "2 sets of towels per room", "both"],
    ["shattaf", "Shattaf or bidet", "owner"],
    ["towel_holder", "Towel holder and hooks", "owner"],
    ["bath_mat", "Bath mat", "both"],
  ]),
  ...det("Kitchen", [
    ["sink", "Sink and draining board", "owner"],
    ["hob", "Cooking hob", "owner"],
    ["fridge", "Fridge", "owner"],
    ["microwave", "Microwave", "owner"],
    ["utensils", "Cooking utensils, 2 tableware sets per bedroom", "owner"],
    ["hood", "Extractor hood", "owner"],
  ]),
];
export const INSP_DET_KEYS = new Set<string>(INSP_DET_ITEMS.map((i) => i.key));

// Points a verifier en priorite (table inspection_focus), groupes par zone pour l'ecran d'inspection.
export type InspFocus = { zone: string; title: string; check: string; reported: string | null; stays: number | null; lastSeen: string | null };
export function focusOut(rows: any[]): InspFocus[] {
  const order = (z: string) => { const i = INSP_ZONES.findIndex((x) => x.key === z); return i === -1 ? 99 : i; };
  return (rows ?? [])
    .filter((r) => r && r.active !== false && INSP_ZONE_KEYS.has(String(r.zone)))
    .map((r) => ({
      zone: String(r.zone), title: String(r.title), check: String(r.check_text),
      reported: r.reported ?? null, stays: r.stays ?? null, lastSeen: r.last_seen ?? null,
    }))
    .sort((a, b) => order(a.zone) - order(b.zone) || (b.stays ?? 0) - (a.stays ?? 0) || a.title.localeCompare(b.title));
}

export const INSP_DEFAULT_TARGET = 4;
export const INSP_MIN_GAP_DAYS = 7;
export const INSP_GOAL_DAYS = 30;
export const INSP_RED_DAYS = 45;
export const INSP_VALID_STATUSES = ["new", "modified", "confirmed", "ownerStay", "reserved"];

const TEAM = ["manager", "cleaner", "maintenance"];
export const INSP_ROLES: Record<string, string[]> = {
  "insp.today": TEAM, "insp.overview": TEAM, "insp.history": TEAM,
  "insp.claim": TEAM, "insp.unclaim": TEAM,
  "insp.start": TEAM, "insp.saveItem": TEAM, "insp.uploadPhoto": TEAM, "insp.finish": TEAM,
  "insp.assign": ["manager"], "insp.reports": ["manager"], "insp.setExcluded": ["manager"],
};
export function inspRoleAllowed(action: string, role: string): boolean {
  const l = INSP_ROLES[action];
  return !!l && l.indexOf(role) !== -1;
}

export type InspReservation = {
  listingId: string; arrival: string; departure: string; status: string;
  checkInTime: number | null; checkOutTime: number | null;
};
export type Eligibility =
  | { kind: "checkout"; checkOutTime: number | null; nextCheckIn: { date: string; time: number | null } | null }
  | { kind: "vacant"; nextArrival: string | null }
  | { kind: "unavailable" };

// Checkout le jour J (check-in le meme jour accepte), sinon vacant si aucune
// reservation n'occupe la nuit J-1→J ni la nuit J→J+1.
export function eligibilityFor(listingId: string, reservations: InspReservation[], day: string): Eligibility | null {
  const mine = reservations.filter((r) => r.listingId === listingId && INSP_VALID_STATUSES.includes(r.status));
  const nextArr = mine.filter((r) => r.arrival >= day).sort((a, b) => a.arrival.localeCompare(b.arrival))[0] ?? null;
  const out = mine.find((r) => r.departure === day);
  if (out) {
    return {
      kind: "checkout", checkOutTime: out.checkOutTime || null,
      nextCheckIn: nextArr ? { date: nextArr.arrival, time: nextArr.checkInTime || null } : null,
    };
  }
  const prev = plusDays(day, -1), next = plusDays(day, 1);
  const nightBefore = mine.some((r) => r.arrival <= prev && r.departure >= day);
  const nightAfter = mine.some((r) => r.arrival <= day && r.departure >= next);
  if (nightBefore || nightAfter) return null;
  return { kind: "vacant", nextArrival: nextArr ? nextArr.arrival : null };
}

const DUBAI_MS = 4 * 3600_000;
// Jour calendaire Asia/Dubai (UTC+4 fixe) d'un horodatage ISO, quel que soit son fuseau.
export function dubaiDay(iso: string): string {
  return new Date(new Date(iso).getTime() + DUBAI_MS).toISOString().slice(0, 10);
}
export function daysBetween(fromIso: string, toDay: string): number {
  const fromDay = dubaiDay(fromIso);
  return Math.round((Date.parse(toDay + "T00:00:00Z") - Date.parse(fromDay + "T00:00:00Z")) / 86400_000);
}

export function fleetColor(daysSince: number | null): "green" | "orange" | "red" {
  if (daysSince === null || daysSince > INSP_RED_DAYS) return "red";
  return daysSince < INSP_GOAL_DAYS ? "green" : "orange";
}

export function listingLabel(row: { internal_name?: string | null; listing_name?: string | null }): string {
  const s = String(row?.internal_name ?? "").trim();
  const m = s.match(/^([A-Za-z]*\d[A-Za-z0-9]*)(?:\s*[-|·]\s*|\s+)(.+)$/);
  if (m) return "Apt " + m[1] + " · " + m[2].trim();
  return s || String(row?.listing_name ?? "").trim() || "Apartment";
}

export type RankInput = {
  day: string; target: number;
  listings: Array<{ listing_id: string; internal_name?: string | null; listing_name?: string | null; inspection_excluded?: boolean }>;
  reservations: InspReservation[];
  lastDone: Record<string, { finishedAt: string; inspector: string }>;
  openIssueListings: Set<string>;
  missed: Record<string, number>;
};
export type InspCard = {
  listingId: string; name: string; eligibility: Eligibility; daysSince: number | null;
  lastInspector: string | null; missed: number; openIssue: boolean; focusCount?: number;
};

export function rankToday(input: RankInput): { today: InspCard[]; also: InspCard[] } {
  const cards: InspCard[] = [];
  for (const l of input.listings) {
    if (l.inspection_excluded) continue;
    const id = String(l.listing_id);
    const eligibility = eligibilityFor(id, input.reservations, input.day);
    if (!eligibility) continue;
    const last = input.lastDone[id];
    const daysSince = last ? daysBetween(last.finishedAt, input.day) : null;
    const openIssue = input.openIssueListings.has(id);
    if (daysSince !== null && daysSince < INSP_MIN_GAP_DAYS && !openIssue) continue;
    cards.push({
      listingId: id, name: listingLabel(l), eligibility, daysSince,
      lastInspector: last ? last.inspector : null, missed: input.missed[id] ?? 0, openIssue,
    });
  }
  // Jamais verifie = retard infini ; a egalite, le plus souvent rate d'abord, puis le nom.
  const key = (c: InspCard) => (c.daysSince === null ? Number.MAX_SAFE_INTEGER : c.daysSince);
  cards.sort((a, b) => key(b) - key(a) || b.missed - a.missed || a.name.localeCompare(b.name));
  const n = Math.max(0, Math.floor(input.target));
  return { today: cards.slice(0, n), also: cards.slice(n) };
}
