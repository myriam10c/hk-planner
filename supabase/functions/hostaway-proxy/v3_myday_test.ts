// Tests de l'action v3.myDay (v3_myday.ts). Fichier separe de v3_test.ts, comme
// v3_myday.ts l'est de v3.ts : la suite partagee avait depasse le plafond de 400
// lignes une fois les correctifs de la revue de la tache 3 ajoutes.
import { assertEquals } from "jsr:@std/assert@1";
import { fakeDb } from "./v3_fakedb.ts";
import { jobKeyFor } from "./v3.ts";
import { buildMyDay, orderStops } from "./v3_myday.ts";

// Jeu d'essai calque sur la vraie semaine du 11 au 17 septembre 2026 (notes UX,
// section 2) : un same-day a 15:00, un arret a arrivee plus tardive, un arret
// sans guest a venir.
function jeuDEssai() {
  return {
    // Le faux client porte la table de correspondance des ids opposes : myDay
    // l'alimente en une ecriture par journee construite.
    sb: fakeDb({ v3_job_keys: [] }),
    date: "2026-09-12",
    me: { cleaner_id: 3, name: "Faiza", role: "cleaner", color: "#e94560" },
    reservations: [
      {
        listingId: "101", listing: "704 Golf Links", guest: "Sofia Marchetti",
        checkOut: "2026-09-12", checkOutTime: 11, nextGuest: null,
      },
      {
        listingId: "102", listing: "623 Samana Park View", guest: "Marc Lefevre",
        checkOut: "2026-09-12", checkOutTime: 12,
        nextGuest: { guest: "Anna Weber", date: "2026-09-12", checkInTime: 15, sameDay: true },
      },
      {
        listingId: "103", listing: "122 Oxford Boulevard", guest: "Yuki Tanaka",
        checkOut: "2026-09-12", checkOutTime: 10,
        nextGuest: { guest: "Omar Said", date: "2026-09-13", checkInTime: 14, sameDay: false },
      },
      {
        listingId: "104", listing: "506 Act One", guest: "Pas A Moi",
        checkOut: "2026-09-12", checkOutTime: 12, nextGuest: null,
      },
    ],
    extras: [],
    listings: {
      "101": { listing_id: "101", listing_name: "704 Golf Links", bedrooms: 0, unit_type: "Studio", apt_number: "704" },
      "102": { listing_id: "102", listing_name: "623 Samana Park View", bedrooms: 1, unit_type: "1 BHK", apt_number: "623" },
      "103": { listing_id: "103", listing_name: "122 Oxford Boulevard", bedrooms: 0, unit_type: "Studio", apt_number: "122" },
      "104": { listing_id: "104", listing_name: "506 Act One", bedrooms: 2, unit_type: "2 BHK", apt_number: "506" },
    },
    templates: [
      { name: "Studio", items: ["Living Room", "Bathroom"], photo_required_items: [] },
      { name: "1 Bedroom", items: ["Master Bed & Linens", "Bathroom", "Final Check"], photo_required_items: [] },
      { name: "2 Bedrooms", items: ["Master Bed & Linens", "Second Bedroom"], photo_required_items: [] },
    ],
    assignedKeys: [
      "2026-09-12_Sofia Marchetti",
      "2026-09-12_Marc Lefevre",
      "2026-09-12_Yuki Tanaka",
    ],
    postponed: {},
    cancelled: [],
    done: [],
    timers: {},
    tickets: [
      { id: 71, listing_id: "102", title: "Photo of the DEWA bill", category: "general", priority: "urgent", status: "open" },
      { id: 72, listing_id: "102", title: "AC turning off", category: "ac", priority: "high", status: "to_confirm" },
      { id: 73, listing_id: "999", title: "Ailleurs", category: "ac", priority: "high", status: "open" },
    ],
    progress: {},
  };
}

Deno.test("buildMyDay ne rend que les menages assignes a la personne connectee", async () => {
  const out = await buildMyDay(jeuDEssai() as any);
  assertEquals(out.stops.length, 3);
  assertEquals(out.stops.some((s) => s.listingName === "506 Act One"), false);
});

Deno.test("buildMyDay ordonne same-day, puis arrivee, puis checkout", async () => {
  const out = await buildMyDay(jeuDEssai() as any);
  assertEquals(out.stops.map((s) => s.listingName), [
    "623 Samana Park View", // same-day 15:00
    "122 Oxford Boulevard", // prochaine arrivee le 13 a 14:00
    "704 Golf Links",       // aucune arrivee connue, checkout 11:00
  ]);
});

Deno.test("buildMyDay calcule le volume sur la mediane par type", async () => {
  const out = await buildMyDay(jeuDEssai() as any);
  // 1 BHK 118 + Studio 94 + Studio 94
  assertEquals(out.totalMinutes, 306);
  assertEquals(out.stops[0].estimatedMinutes, 118);
  assertEquals(out.stops[0].unitType, "1 BHK");
  assertEquals(out.stops[0].templateName, "1 Bedroom");
  assertEquals(out.stops[0].checklist.length, 3);
});

Deno.test("buildMyDay n'expose jamais un nom de guest complet", async () => {
  const base = jeuDEssai() as any;
  const out = await buildMyDay(base);
  // La reponse ENTIERE, jobId compris : c'est le point du constat 5 de la revue,
  // l'identifiant de menage portait le nom complet du guest et le front l'ecrit
  // dans le hash de l'URL.
  const rendu = JSON.stringify(out);
  for (const nom of base.reservations.map((r: any) => r.guest)) {
    assertEquals(rendu.includes(nom), false);
  }
  for (const nom of ["Anna Weber", "Omar Said", "Lefevre", "Marchetti", "Tanaka"]) {
    assertEquals(rendu.includes(nom), false);
  }
  assertEquals(out.stops[0].guest, "Marc L.");
  assertEquals(out.stops[0].nextGuest, "Anna W.");
});

Deno.test("buildMyDay rend un identifiant oppose et memorise sa correspondance", async () => {
  const base = jeuDEssai() as any;
  const out = await buildMyDay(base);
  for (const s of out.stops) assertEquals(/^job_[0-9a-f]{20}$/.test(s.jobId), true);
  assertEquals(out.stops[0].jobId, await jobKeyFor("2026-09-12_Marc Lefevre"));
  // Une ligne par arret rendu, et une seule ecriture pour toute la journee.
  assertEquals(base.sb.tables.v3_job_keys.length, 3);
  assertEquals(base.sb.writes.filter((w: any) => w.table === "v3_job_keys").length, 1);
  // Deterministe : rouvrir l'ecran rend les memes ids, donc un geste pose avant
  // un rechargement reste rejouable.
  const encore = await buildMyDay(jeuDEssai() as any);
  assertEquals(encore.stops.map((s) => s.jobId), out.stops.map((s) => s.jobId));
});

Deno.test("buildMyDay attache les tickets ouverts du logement, sans les to_confirm", async () => {
  const out = await buildMyDay(jeuDEssai() as any);
  assertEquals(out.stops[0].openTickets.map((t) => t.id), [71]);
  assertEquals(out.stops[1].openTickets.length, 0);
});

Deno.test("buildMyDay respecte les reports, les annulations et l'etat du chrono", async () => {
  const base = jeuDEssai() as any;
  base.postponed = { "2026-09-12_Yuki Tanaka": "2026-09-14" };
  base.cancelled = ["2026-09-12_Sofia Marchetti"];
  base.timers = { "2026-09-12_Marc Lefevre": { started_at: "2026-09-12T08:00:00Z", finished_at: null } };
  const out = await buildMyDay(base);
  assertEquals(out.stops.length, 1);
  assertEquals(out.stops[0].listingName, "623 Samana Park View");
  assertEquals(out.stops[0].state, "running");
  assertEquals(out.stops[0].startedAt, "2026-09-12T08:00:00Z");
});

Deno.test("buildMyDay prend les menages hors Hostaway du jour", async () => {
  const base = jeuDEssai() as any;
  base.assignedKeys = ["extra_2026-09-12_ab12cd34"];
  base.extras = [{
    reservation_key: "extra_2026-09-12_ab12cd34", listing_id: "104",
    cleaning_date: "2026-09-12", label: "Deep clean", guest_name: null,
  }];
  const out = await buildMyDay(base);
  assertEquals(out.stops.length, 1);
  assertEquals(out.stops[0].listingName, "506 Act One");
  assertEquals(out.stops[0].unitType, "2 BHK");
  assertEquals(out.stops[0].estimatedMinutes, 165);
  assertEquals(out.stops[0].sameDay, false);
});

Deno.test("buildMyDay dit si le linge est demande (jamais pour un sous-traitant)", async () => {
  const interne = await buildMyDay(jeuDEssai() as any);
  assertEquals(interne.linenRequired, true);
  const elite = jeuDEssai() as any;
  elite.me = { cleaner_id: 9, name: "Elite Cleaning", role: "subcontractor", color: "#000000" };
  assertEquals((await buildMyDay(elite)).linenRequired, false);
});

Deno.test("orderStops range un arret sans heure apres ceux qui en ont une", () => {
  const s = (o: any) => ({ sameDay: false, nextArrivalDate: null, nextArrivalTime: null, checkOutTime: null, listingName: "z", ...o });
  const out = orderStops([
    s({ listingName: "sans heure" }),
    s({ listingName: "arrivee 14", nextArrivalTime: "14:00" }),
    s({ listingName: "same-day", sameDay: true, nextArrivalTime: "17:00" }),
    s({ listingName: "checkout 10", checkOutTime: "10:00" }),
  ] as any);
  assertEquals(out.map((x: any) => x.listingName),
    ["same-day", "arrivee 14", "checkout 10", "sans heure"]);
});

// ---------------------------------------------------------------------------
// Correctifs de la revue de la tache 3
// ---------------------------------------------------------------------------

Deno.test("orderStops compare l'arrivee avec sa date, pas seulement son heure", () => {
  // Constat 7 : une arrivee le 20 a 09:00 est une semaine moins urgente qu'une
  // arrivee le 13 a 15:00, et sortait pourtant en premier.
  const s = (o: any) => ({ sameDay: false, nextArrivalDate: null, nextArrivalTime: null, checkOutTime: null, listingName: "z", ...o });
  const out = orderStops([
    s({ listingName: "le 20 a 09:00", nextArrivalDate: "2026-09-20", nextArrivalTime: "09:00" }),
    s({ listingName: "le 13 a 15:00", nextArrivalDate: "2026-09-13", nextArrivalTime: "15:00" }),
  ] as any);
  assertEquals(out.map((x: any) => x.listingName), ["le 13 a 15:00", "le 20 a 09:00"]);
  // Une date absente passe toujours apres une date connue, quelle que soit l'heure.
  const sansDate = orderStops([
    s({ listingName: "sans date, 06:00", nextArrivalTime: "06:00" }),
    s({ listingName: "le 13 a 23:00", nextArrivalDate: "2026-09-13", nextArrivalTime: "23:00" }),
  ] as any);
  assertEquals(sansDate.map((x: any) => x.listingName), ["le 13 a 23:00", "sans date, 06:00"]);
});

Deno.test("buildMyDay sort un extra reporte du jour d'origine et le rend au nouveau", async () => {
  // Constat 4 : l'app actuelle fenetre les extras sur leur date EFFECTIVE
  // (app.js, __applyPlannerData puis applyPostponements). La v3 comparait
  // cleaning_date sans jamais consulter les reports.
  const extra = {
    reservation_key: "extra_2026-09-12_ab12cd34", listing_id: "104",
    cleaning_date: "2026-09-12", label: "Deep clean", guest_name: null, status: "active",
  };
  const origine = jeuDEssai() as any;
  origine.assignedKeys = ["extra_2026-09-12_ab12cd34"];
  origine.extras = [extra];
  origine.postponed = { "extra_2026-09-12_ab12cd34": "2026-09-14" };
  assertEquals((await buildMyDay(origine)).stops.length, 0);

  const destination = jeuDEssai() as any;
  destination.date = "2026-09-14";
  destination.reservations = [];
  destination.assignedKeys = ["extra_2026-09-12_ab12cd34"];
  destination.extras = [extra];
  destination.postponed = { "extra_2026-09-12_ab12cd34": "2026-09-14" };
  const out = await buildMyDay(destination);
  assertEquals(out.stops.length, 1);
  assertEquals(out.stops[0].label, "Deep clean");
});

Deno.test("buildMyDay n'affiche jamais un extra annule", async () => {
  const base = jeuDEssai() as any;
  base.assignedKeys = ["extra_2026-09-12_ab12cd34"];
  base.extras = [{
    reservation_key: "extra_2026-09-12_ab12cd34", listing_id: "104",
    cleaning_date: "2026-09-12", label: "Deep clean", guest_name: null, status: "cancelled",
  }];
  assertEquals((await buildMyDay(base)).stops.length, 0);
  // Un extra sans statut, ou actif, reste affiche : seul « cancelled » sort.
  base.extras[0].status = "active";
  assertEquals((await buildMyDay(base)).stops.length, 1);
  delete base.extras[0].status;
  assertEquals((await buildMyDay(base)).stops.length, 1);
});

// ---------------------------------------------------------------------------
// Gardes sur le bloc de dispatch d'index.ts. Ce bloc n'est pas importable
// (index.ts appelle Deno.serve au chargement) : c'est precisement pourquoi les
// constats 1, 2 et 4 de la revue avaient echappe aux tests. On le lit donc comme
// du texte, exactement comme le fait deja le test LAUNDRY_FIELDS de v3_test.ts,
// pour qu'une regression casse la suite au lieu de passer inapercue.
// ---------------------------------------------------------------------------

async function sourceIndex(): Promise<string> {
  return await Deno.readTextFile(new URL("./index.ts", import.meta.url));
}

Deno.test("la lecture du cache de myDay est bornee sur updated_at", async () => {
  const src = await sourceIndex();
  // Constat 1 : sans cette borne, 129 lignes et 3 483 ko de JSON etaient
  // rapatries a chaque ouverture de l'ecran Today pour en garder au plus une.
  const bloc = src.match(
    /const v3CheckoutsForDay[\s\S]*?const snap = pickSnapshot/,
  );
  assertEquals(bloc !== null, true);
  assertEquals(bloc![0].includes('.like("key", "checkouts:%")'), true);
  assertEquals(bloc![0].includes('.gte("updated_at"'), true);
  assertEquals(bloc![0].includes("V3_CACHE_STALE_MS"), true);
});

Deno.test("le chemin froid de myDay est chronometre dans les logs", async () => {
  // Constat 10 : le « 5 a 10 s » du rapport de la tache 3 n'etait une mesure
  // nulle part. La tache 14 doit pouvoir lire un vrai chiffre.
  const src = await sourceIndex();
  assertEquals(src.includes("[v3.myDay] cache froid "), true);
  assertEquals(src.includes("pagination Hostaway en "), true);
});

Deno.test("aucune lecture du bloc myDay n'avale plus son erreur", async () => {
  const src = await sourceIndex();
  const bloc = src.match(/if \(action === "v3\.myDay"\)[\s\S]*?return jsonResp\(body\);/);
  assertEquals(bloc !== null, true);
  // Constat 2 : ces quatre lectures etaient consommees en « X.data || [] », donc
  // une panne rendait une journee fausse mais credible.
  for (const lecture of ["extraRes", "listingRes", "templateRes", "ticketRes"]) {
    assertEquals(bloc![0].includes(lecture + ".data ||"), false);
    assertEquals(bloc![0].includes("donneesOuLeve<any>(" + lecture), true);
  }
  // Constat 4, moitie lecture : les extras reportes vers le jour sont lus.
  assertEquals(bloc![0].includes('.eq("new_date", date)'), true);
  // Constat 3 : la date est validee en validite et en plage, pas en forme seule.
  assertEquals(bloc![0].includes("validMyDayDate(date"), true);
  // Constat 5 : buildMyDay recoit le client, pour poser les ids opposes.
  assertEquals(bloc![0].includes("await buildMyDay({"), true);
  assertEquals(/buildMyDay\(\{\s*sb,/.test(bloc![0]), true);
});

Deno.test("le commentaire des paquets de 100 ne cite plus un chiffre invente", async () => {
  // Constat 9 : « une semaine porte environ deux cents cles » etait faux, les
  // instantanes reels en portent une quarantaine.
  const src = await sourceIndex();
  assertEquals(src.includes("environ deux cents cles"), false);
  assertEquals(src.includes("qu'une quarantaine de cles"), true);
});
