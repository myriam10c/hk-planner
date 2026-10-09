// Tests de l'onglet Security (security_contacts.ts) : qui lit le document, qui
// l'ecrit, et ce qui est rendu. Faux client, aucun reseau.
import { assertEquals } from "jsr:@std/assert@1";
import { fakeDb } from "./v3_fakedb.ts";
import { getSecurityContacts, sameDoc, setSecurityContacts } from "./security_contacts.ts";

const APP_SECRET = "app-secret-du-bundle";
const SERVER_SECRET = "secret-serveur";

const DOC = {
  generated: "2026-10-09",
  source: "security_contacts.xlsx",
  buildings: [{ name: "Bahia", groups: [{ units: ["605"], emails: ["sec@bahia.test"], phoneDigits: "971500000000" }] }],
};

function req(headers: Record<string, string>) {
  return new Request("https://x.test/?action=getSecurityContacts", { headers });
}

// Faux client avec la RPC validate_cleaner_session : le vrai currentUser tourne,
// seul le jeton PIN est simule.
function sbAvecSession(seed: Record<string, any[]>, pinRows: any[] = []) {
  const db = fakeDb(seed);
  const state = { rpcCalls: 0 };
  return {
    db,
    state,
    sb: {
      from: db.from,
      rpc: async (_name: string, _args: any) => {
        state.rpcCalls++;
        return { data: pinRows, error: null };
      },
    },
  };
}

const CLEANER = { cleaner_id: 3, name: "Faiza", role: "cleaner", color: "#e94560" };

Deno.test("getSecurityContacts sans session rend 401", async () => {
  const { sb } = sbAvecSession({ security_contacts_doc: [{ id: 1, data: DOC, updated_at: "2026-10-09T10:00:00Z" }] });
  const r = await getSecurityContacts(sb, req({}));
  assertEquals(r.status, 401);
  assertEquals(typeof r.body.error, "string");
});

Deno.test("getSecurityContacts avec le seul X-App-Secret rend 401, sans lecture du document", async () => {
  const { sb, state } = sbAvecSession(
    { security_contacts_doc: [{ id: 1, data: DOC, updated_at: "2026-10-09T10:00:00Z" }] },
    [CLEANER],
  );
  const lues: string[] = [];
  const espion = { ...sb, from: (t: string) => { lues.push(t); return sb.from(t); } };
  const r = await getSecurityContacts(espion, req({ "x-app-secret": APP_SECRET }));
  assertEquals(r.status, 401);
  assertEquals(r.body.buildings, undefined);
  assertEquals(lues, []);
  assertEquals(state.rpcCalls, 0);
});

Deno.test("getSecurityContacts avec un jeton PIN revoque rend 401", async () => {
  const { sb } = sbAvecSession({ security_contacts_doc: [{ id: 1, data: DOC, updated_at: "x" }] }, []);
  const r = await getSecurityContacts(sb, req({ "x-app-secret": APP_SECRET, "x-cleaner-token": "revoque" }));
  assertEquals(r.status, 401);
});

Deno.test("getSecurityContacts avec une session valide rend le document tel quel, plus updatedAt", async () => {
  const { sb } = sbAvecSession(
    { security_contacts_doc: [{ id: 1, data: DOC, updated_at: "2026-10-09T10:00:00Z" }] },
    [CLEANER],
  );
  const r = await getSecurityContacts(sb, req({ "x-app-secret": APP_SECRET, "x-cleaner-token": "jeton-valide" }));
  assertEquals(r.status, 200);
  assertEquals(r.body, { ...DOC, updatedAt: "2026-10-09T10:00:00Z" });
});

Deno.test("getSecurityContacts : les quatre roles d'equipe lisent, un autre role prend 403", async () => {
  for (const role of ["manager", "cleaner", "maintenance", "subcontractor"]) {
    const { sb } = sbAvecSession({ security_contacts_doc: [{ id: 1, data: DOC, updated_at: "x" }] });
    const r = await getSecurityContacts(sb, req({}), async () => ({ ...CLEANER, role }));
    assertEquals(r.status, 200, role);
  }
  const { sb } = sbAvecSession({ security_contacts_doc: [{ id: 1, data: DOC, updated_at: "x" }] });
  const r = await getSecurityContacts(sb, req({}), async () => ({ ...CLEANER, role: "agent" }));
  assertEquals(r.status, 403);
});

Deno.test("getSecurityContacts sans ligne rend 404 {error}", async () => {
  const { sb } = sbAvecSession({}, [CLEANER]);
  const r = await getSecurityContacts(sb, req({ "x-cleaner-token": "jeton-valide" }));
  assertEquals(r.status, 404);
  assertEquals(typeof r.body.error, "string");
});

function postReq(headers: Record<string, string>) {
  return new Request("https://x.test/?action=setSecurityContacts", { method: "POST", headers });
}

Deno.test("setSecurityContacts sans X-Server-Secret rend 403 et n'ecrit rien", async () => {
  const db = fakeDb({});
  const entetes: Record<string, string>[] = [{}, { "x-app-secret": APP_SECRET }, { "x-server-secret": "faux" }];
  for (const h of entetes) {
    const r = await setSecurityContacts(db, postReq(h), { data: DOC }, SERVER_SECRET);
    assertEquals(r.status, 403);
  }
  // Secret serveur non configure cote fonction : refus aussi, meme avec un en-tete vide.
  const r = await setSecurityContacts(db, postReq({ "x-server-secret": "" }), { data: DOC }, "");
  assertEquals(r.status, 403);
  assertEquals(db.writes, []);
});

Deno.test("setSecurityContacts refuse un corps sans tableau buildings", async () => {
  const db = fakeDb({});
  const h = { "x-server-secret": SERVER_SECRET };
  for (const body of [null, {}, { data: null }, { data: [] }, { data: { buildings: "x" } }]) {
    const r = await setSecurityContacts(db, postReq(h), body, SERVER_SECRET);
    assertEquals(r.status, 400);
  }
  assertEquals(db.writes, []);
});

Deno.test("setSecurityContacts avec le secret serveur : upsert id=1, puis changed=false a l'identique", async () => {
  const db = fakeDb({});
  const h = { "x-server-secret": SERVER_SECRET };
  const r1 = await setSecurityContacts(db, postReq(h), { data: DOC }, SERVER_SECRET);
  assertEquals(r1, { status: 200, body: { status: "success", changed: true } });
  assertEquals(db.tables.security_contacts_doc.length, 1);
  assertEquals(db.tables.security_contacts_doc[0].id, 1);
  assertEquals(db.tables.security_contacts_doc[0].data, DOC);

  // Meme contenu, cles dans un autre ordre (jsonb ne garde pas l'ordre) : rien ne change.
  const melange = { buildings: DOC.buildings, source: DOC.source, generated: DOC.generated };
  const r2 = await setSecurityContacts(db, postReq(h), { data: melange }, SERVER_SECRET);
  assertEquals(r2.body.changed, false);
  assertEquals(db.writes.length, 1);

  const autre = { ...DOC, buildings: [...DOC.buildings, { name: "Marina Gate", groups: [] }] };
  const r3 = await setSecurityContacts(db, postReq(h), { data: autre }, SERVER_SECRET);
  assertEquals(r3.body.changed, true);
  assertEquals(db.tables.security_contacts_doc.length, 1);
  assertEquals(db.tables.security_contacts_doc[0].data, autre);
});

Deno.test("sameDoc ignore l'ordre des cles mais pas l'ordre des tableaux", () => {
  assertEquals(sameDoc({ a: 1, b: { c: 2, d: 3 } }, { b: { d: 3, c: 2 }, a: 1 }), true);
  assertEquals(sameDoc({ a: [1, 2] }, { a: [2, 1] }), false);
});

// Cablage d'index.ts (non importable : Deno.serve au chargement).
Deno.test("index.ts : setSecurityContacts est server-only, les deux actions sont routees", async () => {
  const src = await Deno.readTextFile(new URL("./index.ts", import.meta.url));
  const serverOnly = src.slice(src.indexOf("const SERVER_ONLY_ACTIONS"), src.indexOf("]);", src.indexOf("const SERVER_ONLY_ACTIONS")));
  assertEquals(serverOnly.includes('"setSecurityContacts"'), true);
  assertEquals(serverOnly.includes('"getSecurityContacts"'), false);
  assertEquals(src.includes('["getSecurityContacts", "GET"]'), true);
  assertEquals(src.includes('["setSecurityContacts", "POST"]'), true);
  assertEquals(src.includes("setSecurityContacts(sb, req, body, SERVER_SHARED_SECRET)"), true);
});
