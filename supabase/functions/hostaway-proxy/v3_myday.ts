// Action v3.myDay : la journee ordonnee de la personne connectee.
//
// Sorti de v3.ts pour garder chaque module du proxy sous 400 lignes, comme les
// modules d'action des taches suivantes (v3_write.ts, v3_tickets.ts) : v3.ts
// garde les regles pures et partagees, ce fichier garde l'ecran Today.
// Aucune dependance a index.ts : ce module reste testable sans Deno.serve.
//
// Regles de la specification 2026-09-11 implementees ici :
//   - jamais de nom de guest complet cote cleaner (ruling 9) ;
//   - le nom montre est « Apt + Immeuble », jamais un identifiant de listing.
import {
  estimatedMinutes, formatHour, normalizeUnitType, shortGuest,
  templateItems, V3_TEMPLATE_NAME,
} from "./v3.ts";
import type { SessionUser } from "./v3.ts";

export interface V3Ticket {
  id: number;
  title: string;
  category: string;
  priority: string;
}

export interface V3Stop {
  jobId: string;              // reservation_key, jamais affichee telle quelle
  listingId: string;
  listingName: string;        // « Apt + Immeuble », le seul nom montre
  aptNumber: string | null;
  unitType: string;           // Studio | 1 BHK | 2 BHK
  templateName: string;       // Studio | 1 Bedroom | 2 Bedrooms
  checkOutTime: string | null;
  nextArrivalDate: string | null;
  nextArrivalTime: string | null;
  sameDay: boolean;
  guest: string;              // prenom et initiale du partant
  nextGuest: string | null;   // prenom et initiale de l'arrivant
  estimatedMinutes: number;
  state: "todo" | "running" | "done";
  startedAt: string | null;
  checklist: string[];
  photoRequired: string[];
  progress: Record<string, boolean>;
  openTickets: V3Ticket[];
  label: string | null;       // libelle d'un menage hors Hostaway
}

export interface MyDayInput {
  date: string;
  me: SessionUser;
  reservations: any[];                      // sortie de buildCheckoutsPayload
  extras: any[];                            // lignes extra_cleanings du jour
  listings: Record<string, any>;            // listing_id -> ligne listing_config
  templates: any[];                         // checklist_templates
  assignedKeys: string[];                   // cleaning_assignments de cette personne
  postponed: Record<string, string>;        // reservation_key -> new_date
  cancelled: string[];
  done: string[];
  timers: Record<string, any>;
  tickets: any[];                           // maintenance_tickets non clos
  progress: Record<string, Record<string, boolean>>;
}

export interface MyDayPayload {
  status: "success";
  date: string;
  me: { id: number; name: string; role: string };
  linenRequired: boolean;
  totalMinutes: number;
  stops: V3Stop[];
}

// Ordre des arrets (specification, section 3) : same-day d'abord, puis heure
// d'arrivee du prochain guest, puis heure de checkout. Un arret sans heure passe
// apres ceux qui en ont une : une heure limite connue commande la journee. Le nom
// du logement ne sert que de depart d'egalite, pour un ordre stable.
export function orderStops(stops: V3Stop[]): V3Stop[] {
  const heure = (v: string | null) => (v && /^\d{2}:\d{2}$/.test(v) ? v : "99:99");
  return [...stops].sort((a, b) =>
    (a.sameDay ? 0 : 1) - (b.sameDay ? 0 : 1) ||
    heure(a.nextArrivalTime).localeCompare(heure(b.nextArrivalTime)) ||
    heure(a.checkOutTime).localeCompare(heure(b.checkOutTime)) ||
    String(a.listingName).localeCompare(String(b.listingName))
  );
}

// Statuts d'un ticket qui merite encore d'etre regarde pendant un menage.
// to_confirm en est exclu : il attend le technicien, pas la cleaner (ruling 3).
const TICKETS_A_VERIFIER = new Set(["open", "assigned", "in_progress", "waiting_parts"]);

export function buildMyDay(input: MyDayInput): MyDayPayload {
  const mine = new Set((input.assignedKeys ?? []).map(String));
  const cancelled = new Set((input.cancelled ?? []).map(String));
  const done = new Set((input.done ?? []).map(String));
  const templatesByName: Record<string, any> = {};
  for (const t of input.templates ?? []) templatesByName[String(t?.name ?? "")] = t;

  const construire = (base: {
    jobId: string; listingId: string; guest: unknown; nextGuestName: unknown;
    checkOutTime: string | null; nextArrivalDate: string | null;
    nextArrivalTime: string | null; sameDay: boolean; label: string | null;
  }): V3Stop => {
    const listing = input.listings[base.listingId] ?? {};
    const unitType = normalizeUnitType(listing.unit_type, listing.bedrooms);
    const templateName = V3_TEMPLATE_NAME[unitType] ?? "Studio";
    const { items, photoRequired } = templateItems(templatesByName[templateName]);
    const timer = input.timers[base.jobId] ?? null;
    const state: "todo" | "running" | "done" = done.has(base.jobId) || (timer && timer.finished_at)
      ? "done"
      : (timer && timer.started_at ? "running" : "todo");
    return {
      jobId: base.jobId,
      listingId: base.listingId,
      listingName: String(listing.listing_name ?? listing.internal_name ?? "Apartment"),
      aptNumber: listing.apt_number ? String(listing.apt_number) : null,
      unitType,
      templateName,
      checkOutTime: base.checkOutTime,
      nextArrivalDate: base.nextArrivalDate,
      nextArrivalTime: base.nextArrivalTime,
      sameDay: base.sameDay,
      guest: shortGuest(base.guest),
      nextGuest: base.nextGuestName ? shortGuest(base.nextGuestName) : null,
      estimatedMinutes: estimatedMinutes(unitType),
      state,
      startedAt: timer && timer.started_at ? String(timer.started_at) : null,
      checklist: items,
      photoRequired,
      progress: input.progress[base.jobId] ?? {},
      openTickets: (input.tickets ?? [])
        .filter((t) => String(t?.listing_id ?? "") === base.listingId &&
          TICKETS_A_VERIFIER.has(String(t?.status ?? "")))
        .map((t) => ({
          id: Number(t.id),
          title: String(t.title ?? "Ticket"),
          category: String(t.category ?? "general"),
          priority: String(t.priority ?? "medium"),
        })),
      label: base.label,
    };
  };

  const stops: V3Stop[] = [];
  for (const r of input.reservations ?? []) {
    const jobId = String(r?.checkOut ?? "") + "_" + (r?.guest || "Guest");
    if (!mine.has(jobId) || cancelled.has(jobId)) continue;
    // Un menage reporte garde sa cle figee sur la date d'origine : sa vraie date
    // vit dans cleaning_postponed (voir applyPostponements cote app.js).
    const effective = input.postponed[jobId] ?? String(r?.checkOut ?? "");
    if (effective !== input.date) continue;
    stops.push(construire({
      jobId,
      listingId: String(r?.listingId ?? ""),
      guest: r?.guest,
      nextGuestName: r?.nextGuest ? r.nextGuest.guest : null,
      checkOutTime: formatHour(r?.checkOutTime),
      nextArrivalDate: r?.nextGuest ? String(r.nextGuest.date) : null,
      nextArrivalTime: r?.nextGuest ? formatHour(r.nextGuest.checkInTime) : null,
      sameDay: !!(r?.nextGuest && r.nextGuest.sameDay),
      label: null,
    }));
  }
  for (const e of input.extras ?? []) {
    const jobId = String(e?.reservation_key ?? "");
    if (!jobId || !mine.has(jobId) || cancelled.has(jobId)) continue;
    if (String(e?.cleaning_date ?? "") !== input.date) continue;
    stops.push(construire({
      jobId,
      listingId: String(e?.listing_id ?? ""),
      guest: e?.guest_name,
      nextGuestName: null,
      checkOutTime: null,
      nextArrivalDate: null,
      nextArrivalTime: null,
      sameDay: false,
      label: e?.label ? String(e.label) : null,
    }));
  }

  const ordered = orderStops(stops);
  return {
    status: "success",
    date: input.date,
    me: { id: input.me.cleaner_id, name: input.me.name, role: input.me.role },
    // Elite ne compte pas le linge : meme ecran Today, sans le linge
    // (specification, section 3).
    linenRequired: input.me.role !== "subcontractor",
    totalMinutes: ordered.reduce((sum, s) => sum + s.estimatedMinutes, 0),
    stops: ordered,
  };
}
