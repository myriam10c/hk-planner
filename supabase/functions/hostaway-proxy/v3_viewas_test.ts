// Tests du mode « View as » de v3.myDay (v3_viewas.ts) : qui a le droit de
// regarder la journee de qui, et la forme du payload rendu au manager.
import { assertEquals } from "jsr:@std/assert@1";
import { fakeDb } from "./v3_fakedb.ts";
import { buildMyDay } from "./v3_myday.ts";
import { loadTeam, resolveViewAs, V3_VIEWAS_ROLES } from "./v3_viewas.ts";

const MANAGER = { cleaner_id: 1, name: "Hillal", role: "manager", color: "#000" };

// Equipe calquee sur la vraie table cleaners : colonnes sensibles comprises,
// pour verifier qu'elles ne sortent jamais.
function equipe() {
  return [
    { id: 1, name: "Hillal", role: "manager", is_active: true, color: "#000", email: "h@x", pin_hash: "x" },
    { id: 3, name: "Faiza", role: "cleaner", is_active: true, color: "#e94560", email: "f@x", phone: "+971", pin_hash: "y", telegram_chat_id: "9" },
    { id: 4, name: "Amina", role: "cleaner", is_active: true, color: "#111", email: "a@x" },
    { id: 6, name: "Elite", role: "subcontractor", is_active: true, color: "#222" },
    { id: 7, name: "Semax", role: "maintenance", is_active: true, color: "#333" },
    { id: 5, name: "Ismael", role: "manager", is_active: true, color: "#444" },
    { id: 8, name: "Old", role: "cleaner", is_active: false, color: "#555" },
  ];
}

// Faux client qui garde la trace des tables lues : un refus doit tomber avant
// toute lecture de la cible.
function espion(seed: Record<string, any[]>) {
  const db = fakeDb(seed);
  const lues: string[] = [];
  return { lues, sb: { from: (t: string) => { lues.push(t); return db.from(t); } } };
}

Deno.test("resolveViewAs sans `as` rend la journee de la personne connectee, sans lecture", async () => {
  for (const role of ["cleaner", "subcontractor", "maintenance", "manager"]) {
    const { sb, lues } = espion({ cleaners: equipe() });
    const me = { ...MANAGER, role };
    for (const brut of [null, ""]) {
      assertEquals(await resolveViewAs(sb, me, brut), { ok: true, subject: me, viewer: null });
    }
    assertEquals(lues, []);
  }
});

Deno.test("resolveViewAs : un manager regarde la journee d'une cleaner active", async () => {
  const { sb } = espion({ cleaners: equipe() });
  const r = await resolveViewAs(sb, MANAGER, "3");
  assertEquals(r, {
    ok: true,
    subject: { cleaner_id: 3, name: "Faiza", role: "cleaner", color: "#e94560" },
    viewer: MANAGER,
  });
});

Deno.test("resolveViewAs : un manager regarde la journee d'un sous-traitant, avec son vrai role", async () => {
  const { sb } = espion({ cleaners: equipe() });
  const r = await resolveViewAs(sb, MANAGER, "6");
  assertEquals(r.ok, true);
  if (r.ok) assertEquals(r.subject.role, "subcontractor");
});

Deno.test("resolveViewAs : `as` egal a soi-meme rend la journee normale", async () => {
  const { sb, lues } = espion({ cleaners: equipe() });
  assertEquals(await resolveViewAs(sb, MANAGER, "1"), { ok: true, subject: MANAGER, viewer: null });
  assertEquals(lues, []);
});

Deno.test("resolveViewAs : tout autre role que manager avec `as` prend 403, sans lire la cible", async () => {
  for (const role of ["cleaner", "subcontractor", "maintenance", "owner", ""]) {
    const { sb, lues } = espion({ cleaners: equipe() });
    const me = { cleaner_id: 3, name: "Faiza", role, color: "#e94560" };
    // Meme sa propre id : `as` envoye par un non-manager est refuse, point.
    for (const brut of ["4", "3", "abc"]) {
      assertEquals(await resolveViewAs(sb, me, brut), { ok: false, status: 403, error: "forbidden" });
    }
    assertEquals(lues, []);
  }
});

Deno.test("resolveViewAs : cible invalide, inexistante, inactive ou hors equipe de menage prend 400", async () => {
  const { sb } = espion({ cleaners: equipe() });
  const refus = { ok: false, status: 400, error: "unknown team member" } as const;
  for (const brut of ["abc", "3x", "-3", "3.5", " 3", "99", "8", "7", "5", "1e3", "999999999999999999999"]) {
    assertEquals(await resolveViewAs(sb, MANAGER, brut), refus, "as=" + brut);
  }
});

Deno.test("resolveViewAs : une lecture ratee de la cible leve (500), jamais une journee", async () => {
  const db = fakeDb({ cleaners: equipe() });
  db.fail["cleaners.select"] = { message: "boom" };
  let leve = false;
  try { await resolveViewAs(db, MANAGER, "3"); } catch (_e) { leve = true; }
  assertEquals(leve, true);
});

Deno.test("loadTeam ne rend que les cleaners et sous-traitants actifs, tries, sur id, name, role", async () => {
  assertEquals(V3_VIEWAS_ROLES, ["cleaner", "subcontractor"]);
  const team = await loadTeam(fakeDb({ cleaners: equipe() }));
  assertEquals(team, [
    { id: 4, name: "Amina", role: "cleaner" },
    { id: 6, name: "Elite", role: "subcontractor" },
    { id: 3, name: "Faiza", role: "cleaner" },
  ]);
});

// Journee minimale : deux menages, un pour Faiza (id 3), un pour Elite (id 6).
function journee(me: any, assignedKeys: string[]) {
  return {
    sb: fakeDb({ v3_job_keys: [] }),
    date: "2026-09-12",
    me,
    reservations: [
      { listingId: "101", listing: "704 Golf Links", guest: "Sofia Marchetti", checkOut: "2026-09-12", checkOutTime: 11, nextGuest: null },
      { listingId: "102", listing: "623 Samana Park View", guest: "Marc Lefevre", checkOut: "2026-09-12", checkOutTime: 12, nextGuest: null },
    ],
    extras: [],
    listings: {},
    templates: [],
    assignedKeys,
    postponed: {},
    cancelled: [],
    done: [],
    timers: {},
    tickets: [],
    progress: { "2026-09-12_Sofia Marchetti": { "Bathroom": true } },
  };
}

Deno.test("buildMyDay d'une cleaner : aucun champ « View as » dans le payload", async () => {
  const out: any = await buildMyDay(journee({ cleaner_id: 3, name: "Faiza", role: "cleaner", color: "" },
    ["2026-09-12_Sofia Marchetti"]) as any);
  assertEquals("viewAs" in out, false);
  assertEquals("viewer" in out, false);
  assertEquals("team" in out, false);
});

Deno.test("buildMyDay d'un manager sans `as` : sa journee, plus team", async () => {
  const team = [{ id: 3, name: "Faiza", role: "cleaner" }];
  const out: any = await buildMyDay({ ...journee(MANAGER, []), team } as any);
  assertEquals(out.me, { id: 1, name: "Hillal", role: "manager" });
  assertEquals(out.stops.length, 0);
  assertEquals(out.team, team);
  assertEquals("viewAs" in out, false);
  assertEquals("viewer" in out, false);
});

Deno.test("buildMyDay en « View as » : la journee de la cible, viewAs, viewer et team", async () => {
  const team = [{ id: 3, name: "Faiza", role: "cleaner" }, { id: 6, name: "Elite", role: "subcontractor" }];
  const cible = { cleaner_id: 6, name: "Elite", role: "subcontractor", color: "" };
  const out: any = await buildMyDay({
    ...journee(cible, ["2026-09-12_Sofia Marchetti"]), viewer: MANAGER, team,
  } as any);
  assertEquals(out.me, { id: 6, name: "Elite", role: "subcontractor" });
  // Le linge suit le role de la cible, pas celui du manager.
  assertEquals(out.linenRequired, false);
  assertEquals(out.viewAs, true);
  assertEquals(out.viewer, { id: 1, name: "Hillal" });
  assertEquals(out.team, team);
  assertEquals(out.stops.length, 1);
  assertEquals(out.stops[0].listingName, "704 Golf Links");
  // L'avancement reel de la cible, tel qu'elle le voit.
  assertEquals(out.stops[0].progress, { "Bathroom": true });
  assertEquals(out.stops[0].guest, "Sofia M.");
});

// ---------------------------------------------------------------------------
// Garde sur le cablage d'index.ts (revue tache 1, constat 3). Le bloc de
// dispatch n'est pas importable (Deno.serve au chargement) : on le lit comme du
// texte, meme technique que les gardes de v3_myday_test.ts. Les regles sont
// testees plus haut ; ici on verifie qu'index.ts les applique vraiment.
// ---------------------------------------------------------------------------
async function blocMyDay(): Promise<string> {
  const src = await Deno.readTextFile(new URL("./index.ts", import.meta.url));
  const bloc = src.match(/if \(action === "v3\.myDay"\)[\s\S]*?return jsonResp\(body\);/);
  assertEquals(bloc !== null, true);
  return bloc![0];
}

Deno.test("index.ts : resolveViewAs part apres le controle de role, et un refus sort tout de suite", async () => {
  const bloc = await blocMyDay();
  const role = bloc.indexOf("roleAllowed(action, me.role)");
  const vue = bloc.indexOf('resolveViewAs(sb, me, url.searchParams.get("as"))');
  assertEquals(role >= 0 && vue > role, true);
  assertEquals(bloc.includes("if (!vue.ok) return jsonResp({ error: vue.error }, vue.status);"), true);
  // Rien de la journee n'est lu avant la decision : la premiere lecture de
  // donnees (cleaning_postponed) vient apres.
  assertEquals(vue < bloc.indexOf('sb.from("cleaning_postponed")'), true);
});

Deno.test("index.ts : les assignations sont filtrees sur la personne regardee, jamais sur la session", async () => {
  const bloc = await blocMyDay();
  assertEquals(bloc.includes("const sujet = vue.subject;"), true);
  assertEquals(bloc.includes('q.eq("cleaner_id", sujet.cleaner_id)'), true);
  assertEquals(bloc.includes('q.eq("cleaner_id", me.cleaner_id)'), false);
  assertEquals(/buildMyDay\(\{[\s\S]*?me: sujet,[\s\S]*?viewer: vue\.viewer,[\s\S]*?team,/.test(bloc), true);
});

Deno.test("index.ts : la liste team n'est lue que pour un manager", async () => {
  const bloc = await blocMyDay();
  assertEquals(bloc.includes('const team = me.role === "manager" ? await loadTeam(sb) : null;'), true);
  // Un seul appel a loadTeam dans le bloc : aucun autre chemin ne la rend.
  assertEquals(bloc.split("loadTeam(").length - 1, 1);
});
