// Tests de la journee enrichie (branchement 2026-10-05, tache 3) : pieces par
// type, photo d'annonce, binome sur le meme menage, photos de reference du
// menage precedent. Fichier separe de v3_myday_test.ts, qui approche le plafond
// de 400 lignes.
import { assertEquals } from "jsr:@std/assert@1";
import { fakeDb } from "./v3_fakedb.ts";
import { jobKeyFor } from "./v3.ts";
import { buildMyDay } from "./v3_myday.ts";
import { heroPhotoFrom, heroPhotoFromHostaway, roomsFor } from "./v3_day_extras.ts";

const CLE_MARC = "2026-09-12_Marc Lefevre";
const CLE_SOFIA = "2026-09-12_Sofia Marchetti";

function jour(seed: Record<string, any[]> = {}) {
  return {
    sb: fakeDb({ v3_job_keys: [], ...seed }),
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
    ],
    extras: [],
    listings: {
      "101": { listing_id: "101", internal_name: "704 Golf Links", bedrooms: 0, unit_type: "Studio", apt_number: "704" },
      "102": { listing_id: "102", internal_name: "623 Samana Park View", bedrooms: 1, unit_type: "1 BHK", apt_number: "623" },
    },
    templates: [],
    assignedKeys: [CLE_MARC, CLE_SOFIA],
    postponed: {},
    cancelled: [],
    done: [],
    timers: {},
    tickets: [],
    progress: {},
  };
}

function stopDe(out: any, nom: string) {
  return out.stops.find((s: any) => s.listingName === nom);
}

// ---------------------------------------------------------------------------
// Pieces
// ---------------------------------------------------------------------------

Deno.test("roomsFor suit la regle unique des Global Constraints, 3 BHK compris", () => {
  assertEquals(roomsFor("Studio", 0), ["Bed", "Bathroom", "Kitchen"]);
  assertEquals(roomsFor("1 BHK", 1), ["Bedroom", "Living room", "Kitchen", "Bathroom", "Balcony"]);
  assertEquals(roomsFor("2BHK", 2), [
    "Bedroom 1", "Bedroom 2", "Living room", "Kitchen", "Bathroom 1", "Bathroom 2", "Balcony",
  ]);
  const trois = [
    "Bedroom 1", "Bedroom 2", "Bedroom 3", "Living room", "Kitchen",
    "Bathroom 1", "Bathroom 2", "Bathroom 3", "Balcony",
  ];
  assertEquals(roomsFor("3 BHK", 3), trois);
  // Tag absent : le nombre de chambres decide, et trois chambres ne retombent
  // pas sur un 2 BHK comme le fait la ponderation du temps.
  assertEquals(roomsFor(null, 3), trois);
  assertEquals(roomsFor("", 1), ["Bedroom", "Living room", "Kitchen", "Bathroom", "Balcony"]);
  assertEquals(roomsFor(undefined, undefined), ["Bed", "Bathroom", "Kitchen"]);
});

Deno.test("buildMyDay rend les pieces de chaque arret", async () => {
  const out = await buildMyDay(jour() as any);
  assertEquals(stopDe(out, "704 Golf Links").rooms, ["Bed", "Bathroom", "Kitchen"]);
  assertEquals(stopDe(out, "623 Samana Park View").rooms.length, 5);
});

// ---------------------------------------------------------------------------
// Photo d'annonce
// ---------------------------------------------------------------------------

Deno.test("heroPhotoUrl est nul quand aucune photo d'annonce n'est en cache", async () => {
  const out = await buildMyDay(jour() as any);
  for (const s of out.stops) assertEquals(s.heroPhotoUrl, null);
});

Deno.test("heroPhotoFrom ne prend qu'une URL https deja en cache", () => {
  assertEquals(heroPhotoFrom({ hero_photo_url: "https://a.hostaway.test/1.jpg" }),
    "https://a.hostaway.test/1.jpg");
  assertEquals(heroPhotoFrom({ hero_photo_url: "javascript:alert(1)" }), null);
  assertEquals(heroPhotoFrom({ hero_photo_url: "" }), null);
  assertEquals(heroPhotoFrom({}), null);
  assertEquals(heroPhotoFrom(null), null);
});

// ---------------------------------------------------------------------------
// Binome
// ---------------------------------------------------------------------------

Deno.test("othersOnJob liste les autres personnes du menage, par ordre de demarrage", async () => {
  const jobMarc = await jobKeyFor(CLE_MARC);
  const base = jour({
    cleaning_assignments: [
      { reservation_key: CLE_MARC, cleaner_id: 3 },
      { reservation_key: CLE_MARC, cleaner_id: 8 },
      { reservation_key: CLE_MARC, cleaner_id: 4 },
      { reservation_key: CLE_MARC, cleaner_id: 6 },
      { reservation_key: CLE_SOFIA, cleaner_id: 3 },
    ],
    cleaners: [
      { id: 3, name: "Faiza" }, { id: 4, name: "Pionah" },
      { id: 6, name: "Grace" }, { id: 8, name: "Joy" },
    ],
    job_events: [
      { id: 20, idem_key: "k-start-joy-0001", event_type: "start_job", job_id: jobMarc,
        cleaner_id: 8, result: { status: "success" }, created_at: "2026-09-12T09:30:00Z" },
      { id: 10, idem_key: "k-start-pio-0001", event_type: "start_job", job_id: jobMarc,
        cleaner_id: 4, result: { status: "success" }, created_at: "2026-09-12T08:00:00Z" },
      // Cle posee sans resultat : pas un demarrage reel.
      { id: 30, idem_key: "k-start-gra-0001", event_type: "start_job", job_id: jobMarc,
        cleaner_id: 6, result: null, created_at: "2026-09-12T07:00:00Z" },
    ],
  });
  const out = await buildMyDay(base as any);
  const marc = stopDe(out, "623 Samana Park View");
  assertEquals(marc.othersOnJob, [
    { id: 4, name: "Pionah", startedAt: "2026-09-12T08:00:00Z" },
    { id: 8, name: "Joy", startedAt: "2026-09-12T09:30:00Z" },
    { id: 6, name: "Grace", startedAt: null },
  ]);
  assertEquals(stopDe(out, "704 Golf Links").othersOnJob, []);
});

// ---------------------------------------------------------------------------
// References
// ---------------------------------------------------------------------------

async function avecHistorique() {
  const jobMarc = await jobKeyFor(CLE_MARC);
  return jour({
    cleaning_reports: [
      { job_id: "job_ancien000000000001", reservation_key: "2026-09-05_X", cleaner_id: 4,
        payload: { listingId: "102" }, text: "", created_at: "2026-09-05T12:00:00Z" },
      { job_id: "job_ancien000000000002", reservation_key: "2026-09-09_Y", cleaner_id: 6,
        payload: { listingId: "102" }, text: "", created_at: "2026-09-09T12:00:00Z" },
      // Autre logement : jamais une reference du 623.
      { job_id: "job_ailleurs0000000001", reservation_key: "2026-09-10_Z", cleaner_id: 4,
        payload: { listingId: "999" }, text: "", created_at: "2026-09-10T12:00:00Z" },
      // Le menage du jour lui-meme : pas un menage precedent.
      { job_id: jobMarc, reservation_key: CLE_MARC, cleaner_id: 3,
        payload: { listingId: "102" }, text: "", created_at: "2026-09-12T13:00:00Z" },
    ],
    photos: [
      { id: 1, storage_path: "v3/2026-09-05/a.jpg", job_id: "job_ancien000000000001",
        item_name: "end:Kitchen", cleaner_id: 4, kind: "photo", created_at: "2026-09-05T11:00:00Z" },
      { id: 2, storage_path: "v3/2026-09-09/b.jpg", job_id: "job_ancien000000000002",
        item_name: "end:Kitchen", cleaner_id: 6, kind: "photo", created_at: "2026-09-09T11:00:00Z" },
      { id: 3, storage_path: "v3/2026-09-09/c.jpg", job_id: "job_ancien000000000002",
        item_name: "end:Bedroom", cleaner_id: 6, kind: "photo", created_at: "2026-09-09T11:05:00Z" },
      // Photo d'arrivee : jamais une reference.
      { id: 4, storage_path: "v3/2026-09-09/d.jpg", job_id: "job_ancien000000000002",
        item_name: "arrival:Bathroom", cleaner_id: 6, kind: "photo", created_at: "2026-09-09T09:00:00Z" },
      { id: 5, storage_path: "v3/2026-09-10/e.jpg", job_id: "job_ailleurs0000000001",
        item_name: "end:Bathroom", cleaner_id: 4, kind: "photo", created_at: "2026-09-10T11:00:00Z" },
      { id: 6, storage_path: "v3/2026-09-12/f.jpg", job_id: jobMarc,
        item_name: "end:Balcony", cleaner_id: 3, kind: "photo", created_at: "2026-09-12T12:00:00Z" },
    ],
  });
}

Deno.test("references : la photo de fin la plus recente par piece, URL signee 1 h", async () => {
  const out = await buildMyDay(await avecHistorique() as any);
  const marc = stopDe(out, "623 Samana Park View");
  assertEquals(marc.references, {
    "Kitchen": "https://signed.test/v3/2026-09-09/b.jpg?exp=3600",
    "Bedroom": "https://signed.test/v3/2026-09-09/c.jpg?exp=3600",
  });
});

Deno.test("references : jamais le menage en cours, jamais un autre logement", async () => {
  const out = await buildMyDay(await avecHistorique() as any);
  const marc = stopDe(out, "623 Samana Park View");
  assertEquals("Balcony" in marc.references, false);
  assertEquals("Bathroom" in marc.references, false);
  assertEquals(stopDe(out, "704 Golf Links").references, {});
});

Deno.test("references : rien pour une cleaner qui n'a pas ce menage", async () => {
  const base = await avecHistorique();
  (base as any).me = { cleaner_id: 9, name: "Autre", role: "cleaner", color: "#000" };
  (base as any).assignedKeys = [CLE_SOFIA];
  const out = await buildMyDay(base as any);
  assertEquals(out.stops.length, 1);
  assertEquals(JSON.stringify(out).includes("signed.test"), false);
});

Deno.test("references : une signature ratee retire la piece sans casser la journee", async () => {
  const base = await avecHistorique();
  (base.sb as any).fail["storage.sign"] = { message: "boom" };
  const out = await buildMyDay(base as any);
  assertEquals(stopDe(out, "623 Samana Park View").references, {});
});

Deno.test("references : un manager en View as voit celles de la cleaner regardee", async () => {
  const base = await avecHistorique();
  (base as any).viewer = { cleaner_id: 1, name: "Walter", role: "manager", color: "#111" };
  const out = await buildMyDay(base as any);
  assertEquals(out.viewAs, true);
  assertEquals(Object.keys(stopDe(out, "623 Samana Park View").references).sort(),
    ["Bedroom", "Kitchen"]);
});

// ---------------------------------------------------------------------------
// References par v3_job_keys.listing_id (revue tache 3, correctif 1)
// ---------------------------------------------------------------------------

function avecCles(extra: Record<string, any[]> = {}) {
  return jour({
    v3_job_keys: [
      // Menage precedent du 623, sans rapport : compte quand meme.
      { job_id: "job_prec0000000000000a", reservation_key: "2026-09-10_A", listing_id: "102" },
      // Plus ancien : jamais lu, meme s'il a une piece que le precedent n'a pas.
      { job_id: "job_vieux000000000000b", reservation_key: "2026-09-01_B", listing_id: "102" },
      // Apres la date demandee : jamais une reference.
      { job_id: "job_futur000000000000c", reservation_key: "2026-09-20_C", listing_id: "102" },
      // Menage precedent du 704.
      { job_id: "job_prec0000000000000d", reservation_key: "2026-09-08_D", listing_id: "101" },
    ],
    photos: [
      { id: 1, storage_path: "v3/a-kitchen.jpg", job_id: "job_prec0000000000000a",
        item_name: "end:Kitchen", cleaner_id: 4, kind: "photo", created_at: "2026-09-10T11:00:00Z" },
      { id: 2, storage_path: "v3/b-bathroom.jpg", job_id: "job_vieux000000000000b",
        item_name: "end:Bathroom", cleaner_id: 4, kind: "photo", created_at: "2026-09-01T11:00:00Z" },
      { id: 3, storage_path: "v3/c-kitchen.jpg", job_id: "job_futur000000000000c",
        item_name: "end:Kitchen", cleaner_id: 4, kind: "photo", created_at: "2026-09-20T11:00:00Z" },
      { id: 4, storage_path: "v3/d-bed.jpg", job_id: "job_prec0000000000000d",
        item_name: "end:Bed", cleaner_id: 6, kind: "photo", created_at: "2026-09-08T11:00:00Z" },
      // Deux photos de la meme piece : la plus recente gagne.
      { id: 5, storage_path: "v3/a-kitchen-2.jpg", job_id: "job_prec0000000000000a",
        item_name: "end:Kitchen", cleaner_id: 4, kind: "photo", created_at: "2026-09-10T11:30:00Z" },
    ],
    ...extra,
  });
}

Deno.test("references : le menage precedent par listing_id, sans rapport", async () => {
  const out = await buildMyDay(avecCles() as any);
  assertEquals(stopDe(out, "623 Samana Park View").references, {
    "Kitchen": "https://signed.test/v3/a-kitchen-2.jpg?exp=3600",
  });
  assertEquals(stopDe(out, "704 Golf Links").references, {
    "Bed": "https://signed.test/v3/d-bed.jpg?exp=3600",
  });
});

Deno.test("references : un seul appel de signature pour toute la journee", async () => {
  const base = avecCles();
  await buildMyDay(base as any);
  const lots = (base.sb as any).storage.signBatches;
  assertEquals(lots.length, 1);
  assertEquals(lots[0].seconds, 3600);
  assertEquals(lots[0].paths.sort(), ["v3/a-kitchen-2.jpg", "v3/d-bed.jpg"]);
});

Deno.test("references : photos lues pour le seul menage precedent de chaque logement", async () => {
  const base = avecCles();
  const lus: string[][] = [];
  const sb: any = base.sb;
  const from = sb.from;
  sb.from = (t: string) => {
    const q = from(t);
    if (t !== "photos") return q;
    const inOrig = q.in;
    q.in = (col: string, val: any[]) => { if (col === "job_id") lus.push([...val]); return inOrig(col, val); };
    return q;
  };
  await buildMyDay(base as any);
  assertEquals(lus.flat().sort(), ["job_prec0000000000000a", "job_prec0000000000000d"]);
});

Deno.test("myDay pose listing_id sur les correspondances, et rattrape une ligne sans logement", async () => {
  const jobMarc = await jobKeyFor(CLE_MARC);
  const base = jour({
    v3_job_keys: [{ job_id: jobMarc, reservation_key: CLE_MARC, listing_id: null, created_at: "2026-09-01T00:00:00Z" }],
  });
  await buildMyDay(base as any);
  const lignes = (base.sb as any).tables.v3_job_keys;
  const marc = lignes.find((l: any) => l.job_id === jobMarc);
  assertEquals(marc.listing_id, "102");
  assertEquals(marc.created_at, "2026-09-01T00:00:00Z");
  const sofia = lignes.find((l: any) => l.reservation_key === CLE_SOFIA);
  assertEquals(sofia.listing_id, "101");
});

// ---------------------------------------------------------------------------
// Photo d'annonce : syncListings -> listing_config.hero_photo_url -> myDay
// ---------------------------------------------------------------------------

Deno.test("heroPhotoFromHostaway prend listingImages[0].url, https seulement", () => {
  assertEquals(heroPhotoFromHostaway({ listingImages: [{ url: "https://img.hostaway.test/1.jpg" },
    { url: "https://img.hostaway.test/2.jpg" }] }), "https://img.hostaway.test/1.jpg");
  assertEquals(heroPhotoFromHostaway({ listingImages: [{ url: "http://img.test/1.jpg" }] }), null);
  assertEquals(heroPhotoFromHostaway({ listingImages: [] }), null);
  assertEquals(heroPhotoFromHostaway({}), null);
  assertEquals(heroPhotoFromHostaway(null), null);
});

Deno.test("buildMyDay rend heroPhotoUrl depuis listing_config", async () => {
  const base = jour();
  (base.listings as any)["102"].hero_photo_url = "https://img.hostaway.test/623.jpg";
  const out = await buildMyDay(base as any);
  assertEquals(stopDe(out, "623 Samana Park View").heroPhotoUrl, "https://img.hostaway.test/623.jpg");
  assertEquals(stopDe(out, "704 Golf Links").heroPhotoUrl, null);
});

Deno.test("index.ts : syncListings n'ajoute que hero_photo_url, myDay lit la colonne", async () => {
  const src = await Deno.readTextFile(new URL("./index.ts", import.meta.url));
  // Ecritures d'avant le correctif, mot pour mot, suivies du seul champ ajoute.
  const verrouille = "{ listing_id: lid, internal_name: internalName, apt_number: aptNumber, " +
    "updated_at: new Date().toISOString(), hero_photo_url: heroPhotoUrl }";
  const libre = "{ listing_id: lid, listing_name: l.name || \"\", bedrooms, price, unit_type: unitType, " +
    "internal_name: internalName, apt_number: aptNumber, updated_at: new Date().toISOString(), " +
    "hero_photo_url: heroPhotoUrl }";
  assertEquals(src.includes("? " + verrouille), true);
  assertEquals(src.includes(": " + libre), true);
  assertEquals(src.includes("const heroPhotoUrl = heroPhotoFromHostaway(l);"), true);
  // Toujours une seule lecture Hostaway dans syncListings.
  const bloc = src.slice(src.indexOf('if (action === "syncListings")'),
    src.indexOf("// ==================== DONE STATES"));
  assertEquals(bloc.split("fetchAllPages(").length - 1, 1);
  assertEquals(bloc.split("fetch(").length - 1, 0);
  assertEquals(src.includes(
    'select("listing_id, listing_name, bedrooms, unit_type, apt_number, internal_name, hero_photo_url")'), true);
});
