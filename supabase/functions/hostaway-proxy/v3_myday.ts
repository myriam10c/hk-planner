// Action v3.myDay : la journee ordonnee de la personne connectee.
//
// Sorti de v3.ts pour garder chaque module du proxy sous 400 lignes, comme les
// modules d'action des taches suivantes (v3_write.ts, v3_tickets.ts) : v3.ts
// garde les regles pures et partagees, ce fichier garde l'ecran Today.
// Aucune dependance a index.ts : ce module reste testable sans Deno.serve.
//
// Regles de la specification 2026-09-11 implementees ici :
//   - jamais de nom de guest complet cote cleaner (ruling 9), y compris dans
//     l'identifiant de menage : le jobId rendu est l'id oppose de v3_job_keys,
//     jamais la reservation_key qui porte le nom du guest (revue tache 3,
//     constat 5) ;
//   - le nom montre est « Apt + Immeuble », jamais un identifiant de listing et
//     jamais le titre marketing OTA (voir nomDuLogement plus bas).
import {
  ensureJobKeys, estimatedMinutes, formatHour, normalizeUnitType, shortGuest,
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
  jobId: string;              // id oppose « job_<20 hex> », aucune donnee guest
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
  sb: any;                                  // client Supabase, pour v3_job_keys
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

// Ordre des arrets (specification, section 3) : same-day d'abord, puis arrivee du
// prochain guest, puis heure de checkout. Un arret sans heure passe apres ceux qui
// en ont une : une heure limite connue commande la journee. Le nom du logement ne
// sert que de depart d'egalite, pour un ordre stable.
//
// L'arrivee est comparee AVEC sa date : sur la seule heure, une arrivee le 20 a
// 09:00 sortait avant une arrivee le 13 a 15:00, alors qu'elle est une semaine
// moins urgente (revue tache 3, constat 7).
export function orderStops(stops: V3Stop[]): V3Stop[] {
  const heure = (v: string | null) => (v && /^\d{2}:\d{2}$/.test(v) ? v : "99:99");
  const arrivee = (s: V3Stop) =>
    (s.nextArrivalDate && /^\d{4}-\d{2}-\d{2}$/.test(s.nextArrivalDate)
      ? s.nextArrivalDate
      : "9999-99-99") + " " + heure(s.nextArrivalTime);
  return [...stops].sort((a, b) =>
    (a.sameDay ? 0 : 1) - (b.sameDay ? 0 : 1) ||
    arrivee(a).localeCompare(arrivee(b)) ||
    heure(a.checkOutTime).localeCompare(heure(b.checkOutTime)) ||
    String(a.listingName).localeCompare(String(b.listingName))
  );
}

// Le seul nom montre a une cleaner, dans l'ordre de ce qui l'aide vraiment a
// savoir devant quelle porte elle est (revue de branche, findings 1 et 2) :
//
//   1. `listing_config.internal_name` : « 3207 - Sobha Waves ». Les 108 lignes du
//      portefeuille en ont un, 106 commencent par le numero d'appartement.
//   2. le titre Hostaway du payload checkouts : meme forme, et c'est la SEULE
//      source de l'app actuelle (app.js, formatPropLabel(listingId, r.listing)).
//      Il couvre les logements qui n'ont pas encore de fiche listing_config,
//      comme 580602 « 704 Golf Links » le 2026-09-12.
//   3. `listing_config.listing_name` : le titre marketing OTA (« Perfect 2br for
//      families in JVC »). 95 lignes sur 108 ne contiennent meme pas le numero
//      d'appartement : il ne dit pas ou aller, il est le dernier repli.
//
// L'inverse de cet ordre etait une regression franche contre l'app en service.
// Le numero d'appartement n'est pas prefixe ici, contrairement a formatPropLabel :
// les deux premieres sources le portent deja, et `apt_number` est parfois faux en
// base (deux lignes ou il a ete tire du titre marketing, « 15 min from Downtown »
// donne apt_number « 15 »).
function nomDuLogement(listing: any, hostawayTitle: unknown): string {
  const propre = (v: unknown) => (v === null || v === undefined ? "" : String(v).trim());
  return propre(listing?.internal_name) || propre(hostawayTitle) ||
    propre(listing?.listing_name) || "Apartment";
}

// Statuts d'un ticket qui merite encore d'etre regarde pendant un menage.
// to_confirm en est exclu : il attend le technicien, pas la cleaner (ruling 3).
const TICKETS_A_VERIFIER = new Set(["open", "assigned", "in_progress", "waiting_parts"]);

export async function buildMyDay(input: MyDayInput): Promise<MyDayPayload> {
  const mine = new Set((input.assignedKeys ?? []).map(String));
  const cancelled = new Set((input.cancelled ?? []).map(String));
  const done = new Set((input.done ?? []).map(String));
  const templatesByName: Record<string, any> = {};
  for (const t of input.templates ?? []) templatesByName[String(t?.name ?? "")] = t;

  // `reservationKey` est la cle interne, celle qui porte le nom du guest : elle
  // sert aux recoupements en memoire (assignations, chrono, avancement) et ne
  // quitte jamais cette fonction. Le `jobId` du V3Stop est pose a la fin, en une
  // seule ecriture pour toute la journee.
  const construire = (base: {
    reservationKey: string; listingId: string; guest: unknown; nextGuestName: unknown;
    checkOutTime: string | null; nextArrivalDate: string | null;
    nextArrivalTime: string | null; sameDay: boolean; label: string | null;
    // Titre Hostaway porte par la reservation, repli quand le logement n'a pas
    // encore de fiche listing_config. Nul pour un menage hors Hostaway.
    hostawayTitle: unknown;
  }): V3Stop => {
    const listing = input.listings[base.listingId] ?? {};
    const unitType = normalizeUnitType(listing.unit_type, listing.bedrooms);
    const templateName = V3_TEMPLATE_NAME[unitType] ?? "Studio";
    const { items, photoRequired } = templateItems(templatesByName[templateName]);
    const timer = input.timers[base.reservationKey] ?? null;
    const state: "todo" | "running" | "done" =
      done.has(base.reservationKey) || (timer && timer.finished_at)
        ? "done"
        : (timer && timer.started_at ? "running" : "todo");
    return {
      jobId: "",
      listingId: base.listingId,
      listingName: nomDuLogement(listing, base.hostawayTitle),
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
      progress: input.progress[base.reservationKey] ?? {},
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

  // Chaque entree garde sa cle interne a cote de l'arret, le temps de la
  // construction. Les deux se separent juste avant le retour.
  const brut: Array<{ cle: string; stop: V3Stop }> = [];
  for (const r of input.reservations ?? []) {
    const cle = String(r?.checkOut ?? "") + "_" + (r?.guest || "Guest");
    if (!mine.has(cle) || cancelled.has(cle)) continue;
    // Un menage reporte garde sa cle figee sur la date d'origine : sa vraie date
    // vit dans cleaning_postponed (voir applyPostponements cote app.js).
    const effective = input.postponed[cle] ?? String(r?.checkOut ?? "");
    if (effective !== input.date) continue;
    brut.push({ cle, stop: construire({
      reservationKey: cle,
      listingId: String(r?.listingId ?? ""),
      guest: r?.guest,
      nextGuestName: r?.nextGuest ? r.nextGuest.guest : null,
      checkOutTime: formatHour(r?.checkOutTime),
      nextArrivalDate: r?.nextGuest ? String(r.nextGuest.date) : null,
      nextArrivalTime: r?.nextGuest ? formatHour(r.nextGuest.checkInTime) : null,
      sameDay: !!(r?.nextGuest && r.nextGuest.sameDay),
      label: null,
      hostawayTitle: r?.listing,
    }) });
  }
  for (const e of input.extras ?? []) {
    const cle = String(e?.reservation_key ?? "");
    if (!cle || !mine.has(cle) || cancelled.has(cle)) continue;
    // Memes deux regles que l'app actuelle sur un extra (app.js,
    // __applyPlannerData) : un extra annule par un manager sort de la journee, et
    // la fenetre porte sur la date EFFECTIVE, celle du report quand il y en a un.
    // Sans cela, une cleaner allait nettoyer un appartement annule ou ratait un
    // menage deplace vers son jour (revue tache 3, constat 4).
    if (String(e?.status ?? "") === "cancelled") continue;
    const effective = input.postponed[cle] ?? String(e?.cleaning_date ?? "");
    if (effective !== input.date) continue;
    brut.push({ cle, stop: construire({
      reservationKey: cle,
      listingId: String(e?.listing_id ?? ""),
      guest: e?.guest_name,
      nextGuestName: null,
      checkOutTime: null,
      nextArrivalDate: null,
      nextArrivalTime: null,
      sameDay: false,
      label: e?.label ? String(e.label) : null,
      // Un menage hors Hostaway n'a pas de reservation, donc pas de titre
      // Hostaway : seule la fiche listing_config peut le nommer.
      hostawayTitle: null,
    }) });
  }

  // Pose des identifiants opposes : une seule ecriture pour toute la journee. Elle
  // leve si elle echoue, et c'est voulu : un id sans sa correspondance serait un
  // arret sur lequel aucune action d'ecriture ne fonctionnerait ensuite.
  const ids = await ensureJobKeys(input.sb, brut.map((b) => b.cle));
  for (const b of brut) b.stop.jobId = ids[b.cle];

  const ordered = orderStops(brut.map((b) => b.stop));
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
