import { assert, assertEquals } from "jsr:@std/assert@1";
import { fakeDb } from "./v3_fakedb.ts";
import { mgrAccess } from "./mgr_rules.ts";
import { mgrTeam } from "./mgr_team.ts";

const seed = () => fakeDb({
  cleaners: [
    { id: 1, name: "Zara", role: "cleaner", color: "#111111", phone: "+971500000001", email: null, is_active: true, is_owner: false, pin_hash: "$2a$06$SECRETHASH" },
    { id: 2, name: "Walter", role: "manager", color: "#e94560", phone: "", email: "walter@example.com", is_active: true, is_owner: true, pin_hash: null },
    { id: 3, name: "Amir", role: "cleaner", color: "#222222", phone: null, email: "amir@example.com", is_active: true, is_owner: false, pin_hash: "" },
    { id: 4, name: "Elite Cleaning", role: "subcontractor", color: "#333333", phone: null, email: null, is_active: true, is_owner: false, pin_hash: null },
    { id: 5, name: "Joe", role: "maintenance", color: "#444444", phone: null, email: null, is_active: true, is_owner: false, pin_hash: "$2a$06$OTHER" },
    { id: 6, name: "Medini CEO Agent", role: "system", color: "#555555", phone: null, email: null, is_active: true, is_owner: false, pin_hash: null },
    { id: 7, name: "Old Bob", role: "cleaner", color: "#666666", phone: null, email: "bob@example.com", is_active: false, is_owner: false, pin_hash: "$2a$06$BOB" },
    { id: 8, name: "Ghost", role: "system", color: "#777777", phone: null, email: null, is_active: false, is_owner: false, pin_hash: null },
    { id: 9, name: "Abe", role: "manager", color: "#888888", phone: null, email: null, is_active: false, is_owner: false, pin_hash: null },
  ],
});

Deno.test("mgr.team: forme d'un membre, hasPin et hasAccount booleens", async () => {
  const { members } = await mgrTeam(seed());
  const zara = members.find((m: any) => m.id === 1)!;
  assertEquals(zara, {
    id: 1, name: "Zara", role: "cleaner", color: "#111111", phone: "+971500000001", email: null,
    active: true, hasPin: true, hasAccount: false, isOwner: false, system: false,
  });
  const walter = members.find((m: any) => m.id === 2)!;
  assertEquals([walter.hasPin, walter.hasAccount, walter.isOwner, walter.phone, walter.email], [false, true, true, "", "walter@example.com"]);
  // pin_hash vide = pas de PIN ; phone null devient chaine vide.
  const amir = members.find((m: any) => m.id === 3)!;
  assertEquals([amir.hasPin, amir.phone], [false, ""]);
});

Deno.test("mgr.team: aucune trace du hash, aucune cle en trop", async () => {
  const { members } = await mgrTeam(seed());
  const json = JSON.stringify(members);
  assert(!json.includes("SECRETHASH") && !json.includes("$2a$") && !json.includes("pin_hash"));
  for (const m of members) {
    assertEquals(Object.keys(m).sort(),
      ["active", "color", "email", "hasAccount", "hasPin", "id", "isOwner", "name", "phone", "role", "system"]);
    assertEquals(m.system, false);
  }
});

Deno.test("mgr.team: lignes system absentes, actifs puis inactifs, tri role puis nom", async () => {
  const { members } = await mgrTeam(seed());
  assertEquals(members.map((m: any) => m.id), [2, 3, 1, 4, 5, 9, 7]);
  assert(!members.some((m: any) => m.role === "system"));
  assertEquals(members.map((m: any) => m.active), [true, true, true, true, true, false, false]);
});

Deno.test("mgr.team: tri des roles manager, cleaner, subcontractor, maintenance", async () => {
  const { members } = await mgrTeam(seed());
  assertEquals(members.filter((m: any) => m.active).map((m: any) => m.role),
    ["manager", "cleaner", "cleaner", "subcontractor", "maintenance"]);
  // Inactifs : manager avant cleaner.
  assertEquals(members.filter((m: any) => !m.active).map((m: any) => m.name), ["Abe", "Old Bob"]);
});

Deno.test("mgr.team: erreur de lecture remontee", async () => {
  const db = seed();
  db.fail["cleaners.select"] = { message: "boom" };
  let err: unknown = null;
  try { await mgrTeam(db); } catch (e) { err = e; }
  assert(err);
});

Deno.test("mgr.team: acces refuse hors manager (meme garde que le handler)", () => {
  assertEquals(mgrAccess(false, null), { ok: false, status: 401, error: "auth required" });
  assertEquals(mgrAccess(false, { role: "manager" }), { ok: false, status: 403, error: "email sign-in required" });
  assertEquals(mgrAccess(true, { role: "cleaner" }), { ok: false, status: 403, error: "forbidden" });
  assertEquals(mgrAccess(true, { role: "manager" }), { ok: true });
});
