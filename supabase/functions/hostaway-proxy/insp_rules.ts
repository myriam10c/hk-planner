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
] as const;
export const INSP_ZONE_KEYS = new Set<string>(INSP_ZONES.map((z) => z.key));

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
  "insp.assign": ["manager"], "insp.setExcluded": ["manager"],
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
  | { kind: "vacant"; nextArrival: string | null };

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
export function daysBetween(fromIso: string, toDay: string): number {
  const fromDay = new Date(new Date(fromIso).getTime() + DUBAI_MS).toISOString().slice(0, 10);
  return Math.round((Date.parse(toDay + "T00:00:00Z") - Date.parse(fromDay + "T00:00:00Z")) / 86400_000);
}

export function fleetColor(daysSince: number | null): "green" | "orange" | "red" {
  if (daysSince === null || daysSince > INSP_RED_DAYS) return "red";
  return daysSince < INSP_GOAL_DAYS ? "green" : "orange";
}

export function listingLabel(row: { internal_name?: string | null; listing_name?: string | null }): string {
  const s = String(row?.internal_name ?? "").trim();
  const m = s.match(/^([A-Za-z]*\d[A-Za-z0-9]*)\s*-\s*(.+)$/);
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
  lastInspector: string | null; missed: number; openIssue: boolean;
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
