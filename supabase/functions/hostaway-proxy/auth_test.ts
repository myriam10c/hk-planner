import { assertEquals } from "jsr:@std/assert@1";
import { exportJWK, SignJWT } from "npm:jose@6.2.12";
import { bearerToken, resetJwksCache, verifyUserJwt } from "./auth.ts";

const PROJECT = "https://proj.supabase.co";
const ISS = PROJECT + "/auth/v1";

async function setupKeys() {
  const kp = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"],
  );
  const jwk: any = await exportJWK(kp.publicKey);
  jwk.kid = "test-kid";
  jwk.alg = "ES256";
  jwk.use = "sig";
  Deno.env.set("SUPABASE_URL", PROJECT);
  Deno.env.set("SUPABASE_JWKS", JSON.stringify({ keys: [jwk] }));
  resetJwksCache();
  return kp;
}

function signWith(kp: CryptoKeyPair, o: Record<string, any> = {}) {
  return new SignJWT({ email: o.email ?? "Walter@Example.com", role: "authenticated" })
    .setProtectedHeader({ alg: "ES256", kid: o.kid ?? "test-kid" })
    .setIssuer(o.iss ?? ISS)
    .setAudience(o.aud ?? "authenticated")
    .setSubject(o.sub ?? "11111111-1111-1111-1111-111111111111")
    .setIssuedAt()
    .setExpirationTime(o.exp ?? "1h")
    .sign(kp.privateKey);
}

Deno.test("verifyUserJwt accepte un jeton valide et normalise l'email en minuscules", async () => {
  const kp = await setupKeys();
  const user = await verifyUserJwt(await signWith(kp));
  assertEquals(user?.email, "walter@example.com");
  assertEquals(user?.sub, "11111111-1111-1111-1111-111111111111");
});

Deno.test("verifyUserJwt refuse un jeton expire", async () => {
  const kp = await setupKeys();
  const past = Math.floor(Date.now() / 1000) - 60;
  assertEquals(await verifyUserJwt(await signWith(kp, { exp: past })), null);
});

Deno.test("verifyUserJwt refuse un autre emetteur", async () => {
  const kp = await setupKeys();
  assertEquals(await verifyUserJwt(await signWith(kp, { iss: "https://evil.example/auth/v1" })), null);
});

Deno.test("verifyUserJwt refuse une autre audience", async () => {
  const kp = await setupKeys();
  assertEquals(await verifyUserJwt(await signWith(kp, { aud: "anon" })), null);
});

Deno.test("verifyUserJwt refuse un jeton signe par une autre cle", async () => {
  await setupKeys();
  const other = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"],
  );
  assertEquals(await verifyUserJwt(await signWith(other)), null);
});

Deno.test("verifyUserJwt refuse une contrefacon HS256 (confusion d'algorithme)", async () => {
  await setupKeys();
  const forged = await new SignJWT({ email: "walter@example.com" })
    .setProtectedHeader({ alg: "HS256", kid: "test-kid" })
    .setIssuer(ISS).setAudience("authenticated").setSubject("11111111-1111-1111-1111-111111111111")
    .setIssuedAt().setExpirationTime("1h")
    .sign(new TextEncoder().encode("nimporte quel secret partage"));
  assertEquals(await verifyUserJwt(forged), null);
});

Deno.test("verifyUserJwt refuse un jeton sans email", async () => {
  const kp = await setupKeys();
  const noEmail = await new SignJWT({ role: "authenticated" })
    .setProtectedHeader({ alg: "ES256", kid: "test-kid" })
    .setIssuer(ISS).setAudience("authenticated").setSubject("2222")
    .setIssuedAt().setExpirationTime("1h")
    .sign(kp.privateKey);
  assertEquals(await verifyUserJwt(noEmail), null);
});

Deno.test("verifyUserJwt refuse null et une chaine vide", async () => {
  await setupKeys();
  assertEquals(await verifyUserJwt(null), null);
  assertEquals(await verifyUserJwt(""), null);
  assertEquals(await verifyUserJwt("pas.un.jwt"), null);
});

Deno.test("bearerToken lit l'en-tete Authorization sans casse imposee", () => {
  const mk = (v: string | null) =>
    new Request("https://x.test/", { headers: v ? { authorization: v } : {} });
  assertEquals(bearerToken(mk("Bearer abc.def.ghi")), "abc.def.ghi");
  assertEquals(bearerToken(mk("bearer abc.def.ghi")), "abc.def.ghi");
  assertEquals(bearerToken(mk("Basic abc")), null);
  assertEquals(bearerToken(mk(null)), null);
});

// Cas ajoute au brief (demande de la mission) : si SUPABASE_JWKS est absent, le
// repli reseau part chercher le JWKS ; quand ce fetch echoue, verifyUserJwt doit
// rendre null sans jamais lever. L'hote est une adresse locale fermee, la suite
// ne sort donc jamais sur le reseau.
Deno.test("verifyUserJwt rend null quand le fetch du JWKS echoue", async () => {
  const kp = await setupKeys();
  const token = await signWith(kp, { iss: "http://127.0.0.1:1/auth/v1" });
  Deno.env.delete("SUPABASE_JWKS");
  Deno.env.set("SUPABASE_URL", "http://127.0.0.1:1");
  resetJwksCache();
  assertEquals(await verifyUserJwt(token), null);
  resetJwksCache();
});

// Faux client Supabase : enregistre les filtres appliques, pour verifier quelles
// colonnes la resolution filtre reellement.
function fakeSb(row: any) {
  const calls: any[] = [];
  return {
    calls,
    from(table: string) {
      calls.push({ table });
      const q: any = {
        select: () => q,
        eq: (col: string, val: any) => { calls.push({ col, val }); return q; },
        maybeSingle: async () => ({ data: row, error: null }),
      };
      return q;
    },
  };
}

// ---------------------------------------------------------------------------
// Correctifs issus de la revue de la tache 2 (findings 1 a 5).
// ---------------------------------------------------------------------------

// Finding 1 : le jeu de cles local etait memorise une fois pour toutes. Apres une
// rotation Supabase, un isolat deja chaud refusait les jetons signes par la
// nouvelle cle et continuait d'accepter l'ancienne, retiree du JWKS.
Deno.test("getJwks reconstruit le jeu local quand SUPABASE_JWKS change", async () => {
  const kpA = await setupKeys();
  // Chauffe le cache sur test-kid.
  assertEquals((await verifyUserJwt(await signWith(kpA)))?.email, "walter@example.com");

  const kpB = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"],
  );
  const jwkB: any = await exportJWK(kpB.publicKey);
  jwkB.kid = "test-kid-b";
  jwkB.alg = "ES256";
  jwkB.use = "sig";
  // Volontairement SANS resetJwksCache() : c'est exactement le cas de production.
  Deno.env.set("SUPABASE_JWKS", JSON.stringify({ keys: [jwkB] }));

  const fresh = await verifyUserJwt(await signWith(kpB, { kid: "test-kid-b" }));
  assertEquals(fresh?.email, "walter@example.com");
  // Et l'ancienne cle, retiree du document, n'est plus de confiance.
  assertEquals(await verifyUserJwt(await signWith(kpA)), null);
  resetJwksCache();
});

// Finding 2 : sans clockTolerance, jose applique 0 et la moindre derive d'horloge
// entre le serveur Auth et le runtime edge produit des 401 parasites.
Deno.test("verifyUserJwt tolere une petite derive d'horloge (5 s)", async () => {
  const kp = await setupKeys();
  const nowS = Math.floor(Date.now() / 1000);
  const justExpired = await verifyUserJwt(await signWith(kp, { exp: nowS - 3 }));
  assertEquals(justExpired?.email, "walter@example.com");
  // Au dela de la tolerance, le refus reste net.
  assertEquals(await verifyUserJwt(await signWith(kp, { exp: nowS - 30 })), null);
});

// Finding 3 : un jeton valide sans exp n'expirait jamais.
Deno.test("verifyUserJwt refuse un jeton sans exp", async () => {
  const kp = await setupKeys();
  const noExp = await new SignJWT({ email: "walter@example.com", role: "authenticated" })
    .setProtectedHeader({ alg: "ES256", kid: "test-kid" })
    .setIssuer(ISS).setAudience("authenticated").setSubject("3333")
    .setIssuedAt()
    .sign(kp.privateKey);
  assertEquals(await verifyUserJwt(noExp), null);
});

// Finding 4 : SUPABASE_URL vide degradait l'emetteur attendu en "/auth/v1", et un
// jeton portant exactement ce iss passait le controle.
Deno.test("verifyUserJwt refuse tout quand SUPABASE_URL est vide", async () => {
  const kp = await setupKeys();
  Deno.env.set("SUPABASE_URL", "");
  const degraded = await new SignJWT({ email: "walter@example.com", role: "authenticated" })
    .setProtectedHeader({ alg: "ES256", kid: "test-kid" })
    .setIssuer("/auth/v1").setAudience("authenticated").setSubject("4444")
    .setIssuedAt().setExpirationTime("1h")
    .sign(kp.privateKey);
  assertEquals(await verifyUserJwt(degraded), null);
  Deno.env.set("SUPABASE_URL", PROJECT);
  resetJwksCache();
});

// Finding 5 : Deno.env.get etait appele hors du try, la fonction pouvait donc lever
// (hors edge, sans permission env) alors que son contrat dit « ne leve jamais ».
Deno.test("verifyUserJwt rend null au lieu de lever si l'environnement est inaccessible", async () => {
  const kp = await setupKeys();
  const token = await signWith(kp);
  const realGet = Deno.env.get.bind(Deno.env);
  (Deno.env as any).get = (name: string) => {
    throw new Error('NotCapable: Requires env access to "' + name + '"');
  };
  try {
    assertEquals(await verifyUserJwt(token), null);
  } finally {
    (Deno.env as any).get = realGet;
  }
  resetJwksCache();
});

import { inviteRoleAllowed, isValidEmail, normalizeEmail } from "./auth.ts";

Deno.test("normalizeEmail met en minuscules et enleve les espaces", () => {
  assertEquals(normalizeEmail("  Walter@Example.COM "), "walter@example.com");
  assertEquals(normalizeEmail(null), "");
  assertEquals(normalizeEmail(42), "");
});

Deno.test("isValidEmail accepte une adresse simple et refuse le reste", () => {
  assertEquals(isValidEmail("walter@example.com"), true);
  assertEquals(isValidEmail("walter+hk@example.co.uk"), true);
  assertEquals(isValidEmail("walter@example"), false);
  assertEquals(isValidEmail("walter example@x.com"), false);
  assertEquals(isValidEmail("@example.com"), false);
  assertEquals(isValidEmail(""), false);
  assertEquals(isValidEmail("a".repeat(200) + "@example.com"), false);
});

Deno.test("inviteRoleAllowed refuse le role system et les valeurs inconnues", () => {
  assertEquals(inviteRoleAllowed("cleaner"), true);
  assertEquals(inviteRoleAllowed("manager"), true);
  assertEquals(inviteRoleAllowed("maintenance"), true);
  assertEquals(inviteRoleAllowed("subcontractor"), true);
  assertEquals(inviteRoleAllowed("system"), false);
  assertEquals(inviteRoleAllowed("admin"), false);
  assertEquals(inviteRoleAllowed(undefined), false);
});

// ---------------------------------------------------------------------------
// Consolidation des revues T3 a T7 (tache 8a).
// ---------------------------------------------------------------------------

import {
  currentUser,
  isEmailUniqueViolation,
  parseInviteInput,
  planInvite,
  planInviteRollback,
  systemRowError,
} from "./auth.ts";

// Faux client complet : la resolution par email (comme fakeSb) plus le RPC de
// session PIN, avec un compteur d'appels pour prouver qu'il n'est jamais
// consulte quand un Bearer est present.
function fakeSbAuth(opts: { cleanerRow?: any; pinRows?: any[] } = {}) {
  const state = { rpcCalls: 0 };
  return {
    state,
    from(_table: string) {
      const q: any = {
        select: () => q,
        eq: () => q,
        maybeSingle: async () => ({ data: opts.cleanerRow ?? null, error: null }),
      };
      return q;
    },
    async rpc(_name: string, _args: any) {
      state.rpcCalls++;
      return { data: opts.pinRows ?? [], error: null };
    },
  };
}

function reqWith(headers: Record<string, string>) {
  return new Request("https://x.test/", { headers });
}

// T3 constat 4 : la precedence n'avait aucun test. Un Bearer valide gagne sur le
// jeton PIN, qui n'est meme pas lu.
Deno.test("currentUser : un Bearer valide gagne sur X-Cleaner-Token", async () => {
  const kp = await setupKeys();
  const sb = fakeSbAuth({
    cleanerRow: { id: 8, name: "Walter", role: "manager", color: "#e94560" },
    pinRows: [{ cleaner_id: 99, name: "PIN", role: "cleaner", color: "#000000" }],
  });
  const me = await currentUser(sb, reqWith({
    authorization: "Bearer " + (await signWith(kp)),
    "x-cleaner-token": "jeton-pin-valide",
  }));
  assertEquals(me, { cleaner_id: 8, name: "Walter", role: "manager", color: "#e94560" });
  assertEquals(sb.state.rpcCalls, 0);
});

// T3 constat 4 (suite) : un Bearer invalide ne retombe JAMAIS sur le PIN, sinon
// un compte desactive garderait un acces par un vieux jeton du meme appareil.
Deno.test("currentUser : un Bearer invalide ne retombe pas sur X-Cleaner-Token", async () => {
  await setupKeys();
  const sb = fakeSbAuth({
    cleanerRow: { id: 8, name: "Walter", role: "manager", color: "#e94560" },
    pinRows: [{ cleaner_id: 99, name: "PIN", role: "cleaner", color: "#000000" }],
  });
  const me = await currentUser(sb, reqWith({
    authorization: "Bearer pas.un.jwt",
    "x-cleaner-token": "jeton-pin-valide",
  }));
  assertEquals(me, null);
  assertEquals(sb.state.rpcCalls, 0);
});

// Non-regression : sans Bearer, le repli PIN reste le chemin nominal.
Deno.test("currentUser : sans Bearer, le jeton PIN est utilise", async () => {
  await setupKeys();
  const sb = fakeSbAuth({
    pinRows: [{ cleaner_id: 99, name: "PIN", role: "cleaner", color: "#000000" }],
  });
  const me = await currentUser(sb, reqWith({ "x-cleaner-token": "jeton-pin-valide" }));
  assertEquals(me?.cleaner_id, 99);
  assertEquals(sb.state.rpcCalls, 1);
});

const OK_INPUT = { email: "walter@example.com", name: "Walter", role: "manager" };

// T5 constat 1 : repointer l'email d'un membre laissait vivre l'ancien compte
// Auth. Le plan doit remonter l'ancienne adresse pour que l'appelant la revoque.
Deno.test("planInvite remonte l'ancien email a revoquer quand l'adresse change", () => {
  const input = parseInviteInput(OK_INPUT);
  assertEquals(input.kind, "ok");
  const plan = planInvite(input as any, 8, { id: 8, role: "cleaner", email: "ancien@example.com", is_active: true }, 8);
  assertEquals(plan.kind, "update");
  assertEquals((plan as any).previousEmail, "ancien@example.com");
  // Meme adresse : rien a revoquer.
  const same = planInvite(input as any, 8, { id: 8, role: "cleaner", email: "walter@example.com", is_active: true }, 8);
  assertEquals((same as any).previousEmail, null);
});

// T5 constat 2 : inviter une ligne desactivee creait un compte inutilisable.
Deno.test("planInvite reactive la ligne visee (is_active = true)", () => {
  const input = parseInviteInput(OK_INPUT) as any;
  const plan = planInvite(input, 8, { id: 8, role: "cleaner", email: null, is_active: false }, null);
  assertEquals(plan.kind, "update");
  assertEquals((plan as any).patch.is_active, true);
});

// T5 constat 3 : le refus du role system n'etait pose que sur la branche id.
Deno.test("planInvite refuse la ligne system quelle que soit la branche", () => {
  const input = parseInviteInput(OK_INPUT) as any;
  const parId = planInvite(input, 11, { id: 11, role: "system", email: null, is_active: true }, null);
  assertEquals(parId, { kind: "error", status: 400, error: "This account cannot be invited." });
  // Branche par email : aucun id demande, la ligne est trouvee par son adresse.
  const parEmail = planInvite(input, null, { id: 11, role: "system", email: "walter@example.com", is_active: true }, 11);
  assertEquals(parEmail, { kind: "error", status: 400, error: "This account cannot be invited." });
});

// T5 constat 4 : la course entre deux invitations rendait un 500 opaque.
Deno.test("isEmailUniqueViolation reconnait le code Postgres 23505", () => {
  assertEquals(isEmailUniqueViolation({ code: "23505", message: "duplicate key" }), true);
  assertEquals(isEmailUniqueViolation({ code: "23502" }), false);
  assertEquals(isEmailUniqueViolation(null), false);
  assertEquals(isEmailUniqueViolation(undefined), false);
});

// T5 constat 5 : aucun rollback quand l'appel Auth echoue apres l'ecriture.
// Revue 8a constat 1 : le restore doit porter le meme jeu de colonnes que le
// patch, sinon un changement de nom, de role, de telephone ou de couleur reste
// applique alors que le manager recoit une erreur.
Deno.test("planInviteRollback defait l'ecriture de cleaners", () => {
  const input = parseInviteInput({ ...OK_INPUT, id: undefined, phone: "+971500000000", color: "#123456" }) as any;
  const ins = planInvite(input, null, null, null);
  assertEquals(ins.kind, "insert");
  assertEquals(planInviteRollback(ins, 42), { op: "delete", id: 42 });

  const avant = {
    id: 8,
    name: "Ancien nom",
    role: "cleaner",
    email: "ancien@example.com",
    is_active: false,
    phone: null,
    color: "#e94560",
  };
  const upd = planInvite(input, 8, avant, 8) as any;
  // Le patch touche six colonnes, le restore en rend exactement six.
  assertEquals(Object.keys(upd.patch).sort(), ["color", "email", "is_active", "name", "phone", "role"]);
  assertEquals(planInviteRollback(upd, 8), {
    op: "restore",
    id: 8,
    patch: {
      email: "ancien@example.com",
      is_active: false,
      name: "Ancien nom",
      role: "cleaner",
      phone: null,
      color: "#e94560",
    },
  });
});

// Revue 8a constat 1 (suite) : une colonne que le patch ne touche pas ne doit pas
// apparaitre dans le restore.
Deno.test("planInviteRollback ne restaure que les colonnes reellement ecrites", () => {
  const input = parseInviteInput({ email: "walter@example.com" }) as any;
  const upd = planInvite(input, 8, {
    id: 8, name: "Ancien nom", role: "cleaner", email: null, is_active: true, phone: "+9715", color: "#abc",
  }, null) as any;
  assertEquals(Object.keys(upd.patch).sort(), ["email", "is_active"]);
  assertEquals(planInviteRollback(upd, 8), {
    op: "restore",
    id: 8,
    patch: { email: null, is_active: true },
  });
});

// T7 constat 5 : saveCleaner validait le role demande sans regarder le role
// actuel, deux clics suffisaient a sortir la ligne system de sa reserve.
Deno.test("systemRowError verrouille la ligne system dans les deux sens", () => {
  assertEquals(systemRowError("system", "manager"), "This account cannot be modified.");
  assertEquals(systemRowError("system", undefined), "This account cannot be modified.");
  assertEquals(systemRowError("cleaner", "system"), "invalid role");
  assertEquals(systemRowError("cleaner", "manager"), null);
  assertEquals(systemRowError("manager", undefined), null);
});

// Garde-fou du parseur : il refuse avant toute lecture en base.
Deno.test("parseInviteInput refuse une adresse invalide et un role interdit", () => {
  assertEquals(parseInviteInput({ email: "pas-une-adresse" }).kind, "error");
  assertEquals(parseInviteInput({ email: "walter@example.com", role: "system" }).kind, "error");
  const ok = parseInviteInput({ email: "  Walter@Example.COM " }) as any;
  assertEquals(ok.email, "walter@example.com");
  assertEquals(ok.role, "cleaner");
  assertEquals(ok.roleProvided, false);
});

// ---------------------------------------------------------------------------
// Correctifs de la revue de la tache 8a (constats 2, 3 et 4).
// ---------------------------------------------------------------------------

import { applyInvite, rollbackInvite, systemRowGuard } from "./auth.ts";

// Faux client d'invitation : enregistre l'ordre reel des appels et sert des
// resultats scriptes. Les ecritures cleaners consomment `writes` dans l'ordre.
function fakeInviteSb(script: {
  writes?: any[];
  users?: any[];
  deleteUser?: any;
  authResult?: any;
} = {}) {
  const calls: string[] = [];
  const payloads: any[] = [];
  // Filtres poses sur chaque ecriture : c'est la que se lit le verrou optimiste
  // du hotfix du 2026-09-12.
  const writeFilters: any[] = [];
  const writes = [...(script.writes ?? [])];
  const sb: any = {
    calls,
    payloads,
    writeFilters,
    from(_table: string) {
      const q: any = { filters: {} };
      const finish = () => {
        calls.push("cleaners." + q.op);
        if (q.payload !== undefined) payloads.push({ op: q.op, payload: q.payload });
        if (q.op === "update") writeFilters.push({ ...q.filters });
        const r = writes.length ? writes.shift() : { data: { id: 42 }, error: null };
        return Promise.resolve(r);
      };
      q.update = (p: any) => { q.op = "update"; q.payload = p; return q; };
      q.insert = (p: any) => { q.op = "insert"; q.payload = p; return q; };
      q.delete = () => { q.op = "delete"; return q; };
      q.select = () => q;
      q.eq = (col: string, val: any) => { if (col !== undefined) q.filters[col] = val; return q; };
      q.is = (col: string, val: any) => { q.filters[col] = val; return q; };
      q.single = () => finish();
      q.maybeSingle = () => finish();
      q.then = (res: any, rej: any) => finish().then(res, rej);
      return q;
    },
    auth: {
      resetPasswordForEmail: async () => {
        calls.push("auth.reset");
        return script.authResult ?? { error: null };
      },
      admin: {
        listUsers: async () => {
          calls.push("auth.listUsers");
          return { data: { users: script.users ?? [] }, error: null };
        },
        deleteUser: async () => {
          calls.push("auth.deleteUser");
          return script.deleteUser ?? { error: null };
        },
        inviteUserByEmail: async () => {
          calls.push("auth.invite");
          return script.authResult ?? { error: null };
        },
      },
    },
  };
  return sb;
}

function captureWarn(): { lines: string[]; restore: () => void } {
  const lines: string[] = [];
  const real = console.warn;
  console.warn = (...args: any[]) => { lines.push(args.map(String).join(" ")); };
  return { lines, restore: () => { console.warn = real; } };
}

const AVANT = {
  id: 8, name: "Ancien nom", role: "cleaner",
  email: "ancien@example.com", is_active: true, phone: null, color: "#e94560",
};

function planPourAvant() {
  const input = parseInviteInput({ email: "walter@example.com", name: "Walter" }) as any;
  return planInvite(input, 8, AVANT, 8);
}

// Revue 8a constat 2 : rollbackInvite ne destructurait pas l'erreur de postgrest,
// un rollback refuse par la base ne laissait aucune trace.
Deno.test("rollbackInvite journalise quand la base refuse le rollback", async () => {
  const w = captureWarn();
  try {
    const sb = fakeInviteSb({ writes: [{ error: { message: "row level security" } }] });
    await rollbackInvite(sb, planPourAvant(), 8);
    assertEquals(sb.calls, ["cleaners.update"]);
    assertEquals(w.lines.length, 1);
    assertEquals(w.lines[0].includes("rollback refuse"), true);
    assertEquals(w.lines[0].includes("row level security"), true);
  } finally {
    w.restore();
  }
});

Deno.test("rollbackInvite ne journalise rien quand il reussit", async () => {
  const w = captureWarn();
  try {
    const sb = fakeInviteSb({ writes: [{ error: null }] });
    await rollbackInvite(sb, planPourAvant(), 8);
    assertEquals(w.lines, []);
  } finally {
    w.restore();
  }
});

// Revue 8a constat 3 : le 23505 tombait APRES la destruction de l'ancien compte
// Auth, donc « This email is already used » mentait sur l'etat de Auth.
Deno.test("applyInvite ecrit cleaners avant de toucher au compte Auth", async () => {
  // L'ancienne adresse a bien un compte Auth, la nouvelle non : la sequence
  // complete se deroule (destruction, puis invitation).
  const sb = fakeInviteSb({
    writes: [{ data: [{ id: 8 }], error: null }],
    users: [{ id: "u-1", email: "ancien@example.com" }],
  });
  const r = await applyInvite(sb, planPourAvant(), "walter@example.com", "https://app.test/");
  assertEquals(r.status, 200);
  assertEquals(r.body, { status: "success", id: 8, mode: "invite" });
  // L'ecriture cleaners passe en premier, la destruction de l'ancien compte
  // ensuite, l'invitation (qui envoie l'email) en dernier.
  assertEquals(sb.calls, [
    "cleaners.update", "auth.listUsers", "auth.deleteUser", "auth.listUsers", "auth.invite",
  ]);
});

Deno.test("applyInvite rend 409 sur un 23505 sans avoir touche au compte Auth", async () => {
  const sb = fakeInviteSb({ writes: [{ error: { code: "23505" } }] });
  const r = await applyInvite(sb, planPourAvant(), "walter@example.com", "https://app.test/");
  assertEquals(r.status, 409);
  assertEquals(r.body, { error: "This email is already used by another team member." });
  assertEquals(sb.calls, ["cleaners.update"]);
});

Deno.test("applyInvite defait l'ecriture et rend 409 quand l'ancien compte resiste", async () => {
  const sb = fakeInviteSb({
    writes: [{ data: [{ id: 8 }], error: null }, { error: null }],
    users: [{ id: "u-1", email: "ancien@example.com" }],
    deleteUser: { error: { message: "auth down" } },
  });
  const r = await applyInvite(sb, planPourAvant(), "walter@example.com", "https://app.test/");
  assertEquals(r.status, 409);
  assertEquals(r.body, { error: "Could not replace the previous account." });
  // Aucune invitation n'est partie, et la ligne a retrouve son etat d'avant.
  assertEquals(sb.calls, ["cleaners.update", "auth.listUsers", "auth.deleteUser", "cleaners.update"]);
  assertEquals(sb.payloads[1].payload, {
    email: "ancien@example.com", is_active: true, name: "Ancien nom",
  });
});

Deno.test("applyInvite defait l'insertion et rend 502 quand l'invitation echoue", async () => {
  const input = parseInviteInput({ email: "walter@example.com", name: "Walter" }) as any;
  const plan = planInvite(input, null, null, null);
  const sb = fakeInviteSb({
    writes: [{ data: { id: 77 }, error: null }, { error: null }],
    authResult: { error: { message: "rate limit exceeded" } },
  });
  const r = await applyInvite(sb, plan, "walter@example.com", "https://app.test/");
  assertEquals(r.status, 502);
  assertEquals(r.body, { error: "Could not send the invitation." });
  // Le second listUsers verifie qu'aucune requete jumelle n'a cree le compte
  // entre-temps ; sans compte, le rollback part comme avant (hotfix du 12/09).
  assertEquals(sb.calls, [
    "cleaners.insert", "auth.listUsers", "auth.invite", "auth.listUsers", "cleaners.delete",
  ]);
});

// Revue 8a constat 4 : la garde system s'ouvrait si sa lecture echouait.
Deno.test("systemRowGuard echoue ferme quand la lecture du role echoue", async () => {
  const w = captureWarn();
  try {
    const sb = fakeInviteSb({ writes: [{ data: null, error: { message: "timeout" } }] });
    assertEquals(await systemRowGuard(sb, 11, "manager"), {
      status: 500,
      error: "Could not verify the member.",
    });
    assertEquals(w.lines.length, 1);
  } finally {
    w.restore();
  }
});

Deno.test("systemRowGuard refuse la ligne system et laisse passer les autres", async () => {
  const sys = fakeInviteSb({ writes: [{ data: { role: "system" }, error: null }] });
  assertEquals(await systemRowGuard(sys, 11, "manager"), {
    status: 400,
    error: "This account cannot be modified.",
  });
  const ok = fakeInviteSb({ writes: [{ data: { role: "cleaner" }, error: null }] });
  assertEquals(await systemRowGuard(ok, 8, "manager"), null);
});

// ---------------------------------------------------------------------------
// Fix round final de la revue de branche (constats 2 et 4).
// ---------------------------------------------------------------------------

import { cleanerMeReason, currentUserDetailed, lookupCleanerByEmail } from "./auth.ts";

// Constat 4 : cleanerMe rendait {cleaner:null} pour quatre causes distinctes, et
// le front en deduisait toujours « compte non rattache ». La decision est
// desormais une fonction pure, testable sans Supabase.
Deno.test("cleanerMeReason nomme les quatre causes d'une session absente", () => {
  assertEquals(
    cleanerMeReason({ hasCredential: false, credentialValid: false, memberFound: false, memberActive: false }),
    "no_session",
  );
  assertEquals(
    cleanerMeReason({ hasCredential: true, credentialValid: false, memberFound: false, memberActive: false }),
    "invalid_token",
  );
  assertEquals(
    cleanerMeReason({ hasCredential: true, credentialValid: true, memberFound: false, memberActive: false }),
    "unlinked",
  );
  assertEquals(
    cleanerMeReason({ hasCredential: true, credentialValid: true, memberFound: true, memberActive: false }),
    "inactive",
  );
  assertEquals(
    cleanerMeReason({ hasCredential: true, credentialValid: true, memberFound: true, memberActive: true }),
    null,
  );
});

Deno.test("currentUserDetailed : aucun identifiant rend no_session", async () => {
  await setupKeys();
  const sb = fakeSbAuth({});
  const r = await currentUserDetailed(sb, reqWith({}));
  assertEquals(r.user, null);
  assertEquals(r.reason, "no_session");
  assertEquals(sb.state.rpcCalls, 0);
});

Deno.test("currentUserDetailed : un Bearer refuse rend invalid_token", async () => {
  await setupKeys();
  const sb = fakeSbAuth({ cleanerRow: { id: 8, name: "Walter", role: "manager", color: "#e94560" } });
  const r = await currentUserDetailed(sb, reqWith({ authorization: "Bearer pas.un.jwt" }));
  assertEquals(r.user, null);
  assertEquals(r.reason, "invalid_token");
});

Deno.test("currentUserDetailed : un JWT valide sans ligne cleaners rend unlinked", async () => {
  const kp = await setupKeys();
  const sb = fakeSbAuth({ cleanerRow: null });
  const r = await currentUserDetailed(sb, reqWith({ authorization: "Bearer " + (await signWith(kp)) }));
  assertEquals(r.user, null);
  assertEquals(r.reason, "unlinked");
});

Deno.test("currentUserDetailed : un membre desactive rend inactive", async () => {
  const kp = await setupKeys();
  const sb = fakeSbAuth({
    cleanerRow: { id: 8, name: "Walter", role: "manager", color: "#e94560", is_active: false },
  });
  const r = await currentUserDetailed(sb, reqWith({ authorization: "Bearer " + (await signWith(kp)) }));
  assertEquals(r.user, null);
  assertEquals(r.reason, "inactive");
});

Deno.test("currentUserDetailed : un jeton PIN revoque rend invalid_token", async () => {
  await setupKeys();
  const sb = fakeSbAuth({ pinRows: [] });
  const r = await currentUserDetailed(sb, reqWith({ "x-cleaner-token": "jeton-revoque" }));
  assertEquals(r.user, null);
  assertEquals(r.reason, "invalid_token");
  assertEquals(sb.state.rpcCalls, 1);
});

Deno.test("currentUserDetailed : une session valide n'a pas de raison", async () => {
  const kp = await setupKeys();
  const sb = fakeSbAuth({
    cleanerRow: { id: 8, name: "Walter", role: "manager", color: "#e94560", is_active: true },
  });
  const r = await currentUserDetailed(sb, reqWith({ authorization: "Bearer " + (await signWith(kp)) }));
  assertEquals(r.user, { cleaner_id: 8, name: "Walter", role: "manager", color: "#e94560" });
  assertEquals(r.reason, null);
});

// lookupCleanerByEmail remplace resolveCleanerByEmail : il ne filtre plus sur
// is_active, c'est cleanerMeReason qui tranche, sinon « desactive » et
// « inconnu » resteraient indistinguables.
Deno.test("lookupCleanerByEmail rend la ligne meme desactivee, sans filtrer", async () => {
  const sb = fakeSb({ id: 8, name: "Walter", role: "manager", color: "#e94560", is_active: false });
  const row = await lookupCleanerByEmail(sb, "walter@example.com");
  assertEquals(row?.id, 8);
  assertEquals(row?.is_active, false);
  assertEquals(sb.calls.some((c: any) => c.col === "email" && c.val === "walter@example.com"), true);
  assertEquals(sb.calls.some((c: any) => c.col === "is_active"), false);
});

Deno.test("lookupCleanerByEmail rend null quand personne ne porte cet email", async () => {
  const sb = fakeSb(null);
  assertEquals(await lookupCleanerByEmail(sb, "inconnu@example.com"), null);
});

// Constat 2 : les libelles d'erreur du serveur sont affiches tels quels par le
// front. Une seule chaine par cas, en casse de phrase.
Deno.test("les libelles d'erreur d'invitation sont en anglais de produit", () => {
  assertEquals(
    (parseInviteInput({ email: "pas-une-adresse" }) as any).error,
    "A valid email address is required.",
  );
  assertEquals(
    (parseInviteInput({ email: "walter@example.com", role: "admin" }) as any).error,
    "Role must be cleaner, manager, maintenance or subcontractor.",
  );
  const input = parseInviteInput({ email: "walter@example.com", name: "Walter" }) as any;
  assertEquals(
    (planInvite(input, 42, null, null) as any).error,
    "Team member not found.",
  );
  assertEquals(
    (planInvite(input, 11, { id: 11, role: "system" }, null) as any).error,
    "This account cannot be invited.",
  );
  // Les deux chemins du 409 rendent desormais la meme phrase.
  assertEquals(
    (planInvite(input, null, null, 9) as any).error,
    "This email is already used by another team member.",
  );
  assertEquals(systemRowError("system", "manager"), "This account cannot be modified.");
});

// ---------------------------------------------------------------------------
// Hotfix du 12/09 : comptes en libre-service (linkEmail) et cause du deliage.
// ---------------------------------------------------------------------------

import {
  applyLinkEmail,
  parseLinkEmailInput,
  saveCleanerUpdatePatch,
} from "./auth.ts";

// --- Cause du deliage : saveCleaner ne doit JAMAIS porter la colonne email ---

Deno.test("saveCleanerUpdatePatch ne touche jamais a l'email", () => {
  const patch = saveCleanerUpdatePatch({
    name: "Semax", phone: "+256 775 939075", color: "#7c3aed",
    role: "maintenance", telegramChatId: "5079913932",
  });
  assertEquals(Object.hasOwn(patch, "email"), false);
  assertEquals(patch, {
    name: "Semax", phone: "+256 775 939075", color: "#7c3aed",
    role: "maintenance", telegram_chat_id: "5079913932",
  });
  // Meme sans role ni telegram : toujours aucune colonne email, et les valeurs
  // vides retombent sur les defauts historiques.
  const mini = saveCleanerUpdatePatch({ name: "Faiza" });
  assertEquals(Object.hasOwn(mini, "email"), false);
  assertEquals(mini, { name: "Faiza", phone: null, color: "#e94560" });
  // Un email glisse dans le corps de la requete n'atteint pas le patch.
  const pirate = saveCleanerUpdatePatch({ name: "Faiza", ...({ email: "x@y.com" } as any) } as any);
  assertEquals(Object.hasOwn(pirate, "email"), false);
});

// --- Cause reelle du deliage : le rollback d'une invitation jumelle ---

// Faux client qui joue la course du 11/09 : la premiere requete a deja cree le
// compte Auth quand la seconde appelle inviteUserByEmail. GoTrue rend alors
// « Database error saving new user ».
function fakeRaceSb() {
  const calls: string[] = [];
  const payloads: any[] = [];
  let users: any[] = [];
  const sb: any = {
    calls,
    payloads,
    from(_t: string) {
      const q: any = {};
      const finish = () => {
        calls.push("cleaners." + q.op);
        if (q.payload !== undefined) payloads.push({ op: q.op, payload: q.payload });
        return Promise.resolve({ data: { id: 7 }, error: null });
      };
      q.update = (p: any) => { q.op = "update"; q.payload = p; return q; };
      q.insert = (p: any) => { q.op = "insert"; q.payload = p; return q; };
      q.delete = () => { q.op = "delete"; return q; };
      q.select = () => q;
      q.eq = () => q;
      q.is = () => q;
      q.single = () => finish();
      q.maybeSingle = () => finish();
      q.then = (res: any, rej: any) => finish().then(res, rej);
      return q;
    },
    auth: {
      resetPasswordForEmail: async () => { calls.push("auth.reset"); return { error: null }; },
      admin: {
        listUsers: async () => {
          calls.push("auth.listUsers");
          return { data: { users: [...users] }, error: null };
        },
        deleteUser: async () => { calls.push("auth.deleteUser"); return { error: null }; },
        inviteUserByEmail: async () => {
          calls.push("auth.invite");
          // La requete jumelle a gagne la course entre notre listUsers et ici.
          users = [{ id: "u-race", email: "sserunkumavan@example.com" }];
          return { error: { message: "Database error saving new user" } };
        },
      },
    },
  };
  return sb;
}

Deno.test("applyInvite ne defait plus l'ecriture quand une requete jumelle a cree le compte", async () => {
  const input = parseInviteInput({
    email: "sserunkumavan@example.com", name: "Semax", role: "maintenance",
  }) as any;
  const cible = {
    id: 7, name: "Semax", role: "maintenance",
    email: null, is_active: true, phone: null, color: "#7c3aed",
  };
  const plan = planInvite(input, 7, cible, null);
  const sb = fakeRaceSb();
  const r = await applyInvite(sb, plan, "sserunkumavan@example.com", "https://app.test/");
  assertEquals(r.status, 200);
  assertEquals(r.body, { status: "success", id: 7, mode: "invite" });
  // Une seule ecriture cleaners : celle qui pose l'adresse. Aucun rollback.
  assertEquals(sb.calls.filter((c: string) => c.startsWith("cleaners.")), ["cleaners.update"]);
  assertEquals(sb.payloads.length, 1);
  assertEquals((sb.payloads[0].payload as any).email, "sserunkumavan@example.com");
});

// --- linkEmail : validation du corps ---

Deno.test("parseLinkEmailInput refuse une adresse invalide et un mot de passe court", () => {
  assertEquals((parseLinkEmailInput(null) as any).status, 400);
  assertEquals(
    (parseLinkEmailInput({ email: "pas-une-adresse", password: "motdepasse" }) as any).error,
    "A valid email address is required.",
  );
  assertEquals(
    (parseLinkEmailInput({ email: "semax@example.com", password: "court" }) as any).error,
    "Password too short. Use at least 8 characters.",
  );
  assertEquals(
    (parseLinkEmailInput({ email: "semax@example.com" }) as any).error,
    "Password too short. Use at least 8 characters.",
  );
  const ok = parseLinkEmailInput({ email: "  Semax@Example.COM ", password: "12345678" }) as any;
  assertEquals(ok.kind, "ok");
  assertEquals(ok.email, "semax@example.com");
  assertEquals(ok.password, "12345678");
});

// --- linkEmail : la sequence ---

// Faux client dedie : lignes cleaners scriptees par filtre, comptes Auth
// scriptes, et journal de l'ordre reel des appels.
function fakeLinkSb(script: {
  mine?: any;
  holder?: any;
  users?: any[];
  updateUser?: any;
  createUser?: any;
  linkWrite?: any;
} = {}) {
  const calls: string[] = [];
  const payloads: any[] = [];
  // Filtres reellement poses sur l'ecriture finale : c'est la que se lit le
  // verrou optimiste du hotfix du 2026-09-12.
  const writeFilters: any[] = [];
  const sb: any = {
    calls,
    payloads,
    writeFilters,
    from(_t: string) {
      const q: any = { filters: {} };
      q.select = (cols: string) => {
        // .select() apres .update() demande la representation, il ne change pas
        // la nature de la requete.
        if (q.op !== "update") { q.op = "select"; q.cols = cols; }
        return q;
      };
      q.update = (p: any) => { q.op = "update"; q.payload = p; return q; };
      q.eq = (col: string, val: any) => { q.filters[col] = val; return q; };
      q.is = (col: string, val: any) => { q.filters[col] = val; return q; };
      // Lecture de « ma ligne », filtree sur id.
      q.maybeSingle = () => {
        calls.push("cleaners.select.id");
        return Promise.resolve({ data: script.mine ?? null, error: null });
      };
      q.then = (res: any, rej: any) => {
        if (q.op === "update") {
          calls.push("cleaners.update");
          payloads.push(q.payload);
          writeFilters.push({ ...q.filters });
          // PostgREST rend les lignes touchees quand .select() suit l'update.
          return Promise.resolve(script.linkWrite ?? { data: [{ id: 7 }], error: null })
            .then(res, rej);
        }
        // Recherche du porteur de l'adresse : une lecture de la table entiere,
        // la comparaison de casse se fait en TypeScript (constat 3).
        const rows = script.holder ? [script.holder] : [];
        calls.push("cleaners.select.email");
        return Promise.resolve({ data: rows, error: null }).then(res, rej);
      };
      return q;
    },
    auth: {
      admin: {
        listUsers: async () => {
          calls.push("auth.listUsers");
          return { data: { users: script.users ?? [] }, error: null };
        },
        updateUserById: async (_id: string, attrs: any) => {
          calls.push("auth.updateUserById");
          payloads.push({ emailConfirm: attrs.email_confirm, hasPassword: !!attrs.password });
          return script.updateUser ?? { error: null };
        },
        createUser: async (attrs: any) => {
          calls.push("auth.createUser");
          payloads.push({ email: attrs.email, emailConfirm: attrs.email_confirm, hasPassword: !!attrs.password });
          return script.createUser ?? { error: null, data: { user: { id: "u-new" } } };
        },
      },
    },
  };
  return sb;
}

const SESSION_SEMAX = { cleaner_id: 7, name: "Semax", role: "maintenance", color: "#7c3aed" };
const INPUT_SEMAX = parseLinkEmailInput({
  email: "sserunkumavan@example.com", password: "motdepasse1",
}) as any;

Deno.test("linkEmail cree le compte et relie la ligne quand rien n'existe", async () => {
  const sb = fakeLinkSb({ mine: { id: 7, email: null }, holder: null, users: [] });
  const r = await applyLinkEmail(sb, SESSION_SEMAX, INPUT_SEMAX);
  assertEquals(r.status, 200);
  assertEquals(r.body, { status: "success" });
  // Le compte Auth est cree AVANT l'ecriture cleaners : un echec en aval ne
  // peut donc plus effacer une adresse deja posee (incident du 11/09).
  assertEquals(sb.calls, [
    "cleaners.select.id", "cleaners.select.email",
    "auth.listUsers", "auth.createUser", "cleaners.update",
  ]);
  assertEquals(sb.payloads[0], {
    email: "sserunkumavan@example.com", emailConfirm: true, hasPassword: true,
  });
  assertEquals(sb.payloads[1], { email: "sserunkumavan@example.com" });
});

Deno.test("linkEmail reprend un compte Auth existant que personne ne porte", async () => {
  // Le cas reel : l'invitation du 11/09 a cree le compte, le rollback jumeau a
  // efface l'adresse de la ligne. La personne repart de son PIN et reprend la
  // main sur ce compte avec un nouveau mot de passe.
  const sb = fakeLinkSb({
    mine: { id: 7, email: null },
    holder: null,
    users: [{ id: "u-existant", email: "sserunkumavan@example.com" }],
  });
  const r = await applyLinkEmail(sb, SESSION_SEMAX, INPUT_SEMAX);
  assertEquals(r.status, 200);
  assertEquals(r.body, { status: "success" });
  assertEquals(sb.calls, [
    "cleaners.select.id", "cleaners.select.email",
    "auth.listUsers", "auth.updateUserById", "cleaners.update",
  ]);
  assertEquals(sb.payloads[0], { emailConfirm: true, hasPassword: true });
});

Deno.test("linkEmail rend 409 quand l'adresse appartient a un autre membre", async () => {
  const sb = fakeLinkSb({
    mine: { id: 7, email: null },
    holder: { id: 9, email: "sserunkumavan@example.com" },
  });
  const r = await applyLinkEmail(sb, SESSION_SEMAX, INPUT_SEMAX);
  assertEquals(r.status, 409);
  assertEquals(r.body, { error: "This email is already used by another team member." });
  // Rien n'a ete tente cote Auth : le mot de passe d'un compte tiers n'est
  // jamais repose.
  assertEquals(sb.calls, ["cleaners.select.id", "cleaners.select.email"]);
});

Deno.test("linkEmail rend 409 sur un 23505 (course entre deux membres)", async () => {
  const sb = fakeLinkSb({
    mine: { id: 7, email: null },
    holder: null,
    users: [],
    linkWrite: { error: { code: "23505" } },
  });
  const r = await applyLinkEmail(sb, SESSION_SEMAX, INPUT_SEMAX);
  assertEquals(r.status, 409);
  assertEquals(r.body, { error: "This email is already used by another team member." });
  // Le compte Auth cree reste en place : aucun rollback, le rejeu le reliera.
  assertEquals(sb.calls.includes("cleaners.delete"), false);
});

Deno.test("linkEmail est idempotent : rejouer la meme adresse rend success", async () => {
  const sb = fakeLinkSb({
    mine: { id: 7, email: "sserunkumavan@example.com" },
    holder: { id: 7, email: "sserunkumavan@example.com" },
    users: [{ id: "u-existant", email: "sserunkumavan@example.com" }],
  });
  const r = await applyLinkEmail(sb, SESSION_SEMAX, INPUT_SEMAX);
  assertEquals(r.status, 200);
  assertEquals(r.body, { status: "success" });
  assertEquals(sb.calls, [
    "cleaners.select.id", "cleaners.select.email",
    "auth.listUsers", "auth.updateUserById", "cleaners.update",
  ]);
});

Deno.test("linkEmail refuse une seconde adresse sur une ligne deja reliee", async () => {
  const sb = fakeLinkSb({ mine: { id: 7, email: "ancien@example.com" } });
  const r = await applyLinkEmail(sb, SESSION_SEMAX, INPUT_SEMAX);
  assertEquals(r.status, 409);
  assertEquals(r.body, {
    error: "Your profile already uses another email address. Ask a manager to change it.",
  });
  assertEquals(sb.calls, ["cleaners.select.id"]);
});

Deno.test("linkEmail refuse la ligne system", async () => {
  const sb = fakeLinkSb({ mine: { id: 11, email: null } });
  const r = await applyLinkEmail(
    sb,
    { cleaner_id: 11, name: "Medini CEO Agent", role: "system", color: "#7c3aed" },
    INPUT_SEMAX,
  );
  assertEquals(r.status, 403);
  assertEquals(r.body, { error: "This account cannot have a password." });
  assertEquals(sb.calls, []);
});

Deno.test("linkEmail n'ecrit rien dans cleaners quand la creation du compte echoue", async () => {
  const w = captureWarn();
  try {
    const sb = fakeLinkSb({
      mine: { id: 7, email: null },
      holder: null,
      users: [],
      createUser: { error: { message: "Database error saving new user" } },
    });
    const r = await applyLinkEmail(sb, SESSION_SEMAX, INPUT_SEMAX);
    assertEquals(r.status, 502);
    assertEquals(r.body, { error: "Could not create your account." });
    assertEquals(sb.calls.includes("cleaners.update"), false);
    // Le libelle amont part dans les journaux, jamais le mot de passe.
    assertEquals(w.lines.length, 1);
    assertEquals(w.lines[0].includes("motdepasse1"), false);
  } finally {
    w.restore();
  }
});

// ===========================================================================
// Hotfix securite du 2026-09-12 (revue review-hotfix.md, constats 1, 2 et 3)
// ===========================================================================

import {
  CLEANER_PUBLIC_COLUMNS, CLEANER_PUBLIC_SELECT, CLEANER_SENSITIVE_COLUMNS,
  findCleanerByEmail, publicCleanerRows, rowsTouched,
} from "./auth.ts";

// Ligne cleaners complete, telle que select("*") la ramenait. Aucune valeur
// n'est un vrai secret ici : le hash est un marqueur, pas un bcrypt.
const LIGNE_COMPLETE = {
  id: 8, name: "Walter", phone: "+971500000000", color: "#e94560",
  is_active: true, created_at: "2026-01-01T00:00:00Z", role: "manager",
  pin_hash: "MARQUEUR-NE-DOIT-PAS-SORTIR", telegram_chat_id: "123456",
  is_owner: false, email: null,
};

// Constat 1 : getCleaners rendait pin_hash a tout porteur du X-App-Secret, qui
// voyage dans le bundle JS public. Un bcrypt de PIN a 4 chiffres se casse hors
// ligne en quelques secondes, et linkEmail transformait ce PIN en compte
// permanent. La projection explicite est la garde de base.
Deno.test("la projection cleaners ne porte jamais pin_hash ni telegram_chat_id", () => {
  for (const col of CLEANER_SENSITIVE_COLUMNS) {
    assertEquals(CLEANER_PUBLIC_COLUMNS.includes(col as any), false);
    assertEquals(CLEANER_PUBLIC_SELECT.includes(col), false);
  }
  assertEquals(CLEANER_SENSITIVE_COLUMNS.includes("pin_hash" as any), true);
  assertEquals(CLEANER_SENSITIVE_COLUMNS.includes("telegram_chat_id" as any), true);
});

// Contrepartie du constat 1 : la projection doit rester complete pour le front.
// Chaque colonne listee ici est reellement lue par app.js ou par les jobs du
// VPS (integrations/team_tasks.py et scheduled/maintenance_digest.py).
Deno.test("la projection cleaners porte toutes les colonnes que les clients lisent", () => {
  for (const col of ["id", "name", "phone", "color", "is_active", "role", "email"]) {
    assertEquals(CLEANER_PUBLIC_COLUMNS.includes(col as any), true);
    assertEquals(CLEANER_PUBLIC_SELECT.includes(col), true);
  }
});

// Defense en profondeur : meme si un select("*") revenait un jour, la reponse
// est filtree avant de partir. C'est l'invariant au niveau de la route, celui
// que la revue reprochait de ne tenir que par lecture (constat 4).
Deno.test("publicCleanerRows retire les colonnes secretes d'une ligne complete", () => {
  const [row] = publicCleanerRows([LIGNE_COMPLETE]);
  assertEquals(Object.hasOwn(row, "pin_hash"), false);
  assertEquals(Object.hasOwn(row, "telegram_chat_id"), false);
  assertEquals(JSON.stringify(row).includes("MARQUEUR-NE-DOIT-PAS-SORTIR"), false);
  assertEquals(row.id, 8);
  assertEquals(row.name, "Walter");
  assertEquals(row.phone, "+971500000000");
  assertEquals(row.color, "#e94560");
  assertEquals(row.role, "manager");
  assertEquals(row.is_active, true);
  assertEquals(row.email, null);
});

Deno.test("publicCleanerRows garde chaque ligne et tolere une entree vide", () => {
  assertEquals(publicCleanerRows([LIGNE_COMPLETE, LIGNE_COMPLETE]).length, 2);
  assertEquals(publicCleanerRows([]), []);
  assertEquals(publicCleanerRows(null), []);
  assertEquals(publicCleanerRows(undefined), []);
});

// Faux client minimal pour findCleanerByEmail : une seule lecture, sans filtre.
function fakeListeSb(rows: any[]) {
  const calls: string[] = [];
  return {
    calls,
    from(table: string) {
      const q: any = {};
      q.select = (cols: string) => { calls.push(table + ".select:" + cols); return q; };
      q.then = (res: any, rej: any) => Promise.resolve({ data: rows, error: null }).then(res, rej);
      return q;
    },
  } as any;
}

// Constat 3 : le controle « porteur » comparait avec .eq("email", ...), donc
// sensible a la casse, alors que findAuthUserByEmail et l'index unique
// cleaners_email_unique_idx travaillent sur lower(email). Une ligne en
// Foo@Bar.com aurait laisse passer foo@bar.com, le temps de poser le mot de
// passe de l'attaquant sur le compte Auth de l'autre personne.
Deno.test("findCleanerByEmail trouve la ligne quelle que soit la casse", async () => {
  const sb = fakeListeSb([
    { id: 4, email: null },
    { id: 8, email: "Foo@Bar.com" },
  ]);
  const r = await findCleanerByEmail(sb, "foo@bar.com");
  assertEquals(r?.id, 8);
});

Deno.test("findCleanerByEmail ne rend rien quand personne ne porte l'adresse", async () => {
  const sb = fakeListeSb([{ id: 4, email: null }, { id: 8, email: "autre@example.com" }]);
  assertEquals(await findCleanerByEmail(sb, "foo@bar.com"), null);
});

// Pourquoi pas .ilike : PostgREST traduit `*` en `%` et Postgres lit `_` et `%`
// comme des jokers. Une adresse qui en porte aurait resolu la MAUVAISE ligne.
// La comparaison se fait donc en TypeScript, comme findAuthUserByEmail le fait
// deja cote Auth.
Deno.test("findCleanerByEmail ne traite ni _ ni % ni * comme un joker", async () => {
  const sb = fakeListeSb([{ id: 8, email: "aXb@example.com" }, { id: 9, email: "zz@example.com" }]);
  assertEquals(await findCleanerByEmail(sb, "a_b@example.com"), null);
  assertEquals(await findCleanerByEmail(sb, "%@example.com"), null);
  assertEquals(await findCleanerByEmail(sb, "*@example.com"), null);
});

// Les colonnes demandees sont respectees, et email est toujours ramene puisque
// c'est sur elle que porte la comparaison.
Deno.test("findCleanerByEmail ramene toujours la colonne email", async () => {
  const sb = fakeListeSb([{ id: 8, name: "Walter", email: "w@example.com" }]);
  const r = await findCleanerByEmail(sb, "w@example.com", "id, name, role");
  assertEquals(r?.name, "Walter");
  assertEquals(sb.calls[0], "cleaners.select:id, name, role, email");
  const sb2 = fakeListeSb([{ id: 8, email: "w@example.com" }]);
  await findCleanerByEmail(sb2, "w@example.com", "id, email");
  assertEquals(sb2.calls[0], "cleaners.select:id, email");
});

// rowsTouched lit ce que PostgREST rend apres un update().select() : un
// tableau. Les faux clients historiques rendent un objet, on l'accepte aussi.
Deno.test("rowsTouched compte les lignes reellement touchees", () => {
  assertEquals(rowsTouched([]), 0);
  assertEquals(rowsTouched([{ id: 7 }]), 1);
  assertEquals(rowsTouched([{ id: 7 }, { id: 8 }]), 2);
  assertEquals(rowsTouched({ id: 7 }), 1);
  assertEquals(rowsTouched(null), 0);
  assertEquals(rowsTouched(undefined), 0);
});

// --- Constat 2 : la course n'etait fermee que par une relecture applicative ---
//
// Un pg_advisory_xact_lock n'est pas jouable ici : chaque appel du client
// Supabase part en HTTP vers PostgREST, qui ouvre SA transaction et la commite
// avant de repondre. Un verrou de transaction serait donc relache avant
// l'ecriture suivante, et un verrou de session fuirait sur une connexion du
// pool. Le verrou pose est donc optimiste, et il vit dans la meme requete que
// l'ecriture : la mise a jour ne s'applique que si la colonne email est encore
// dans l'etat lu au moment de la decision. Postgres evalue ce filtre sous le
// verrou de ligne, c'est donc bien la base qui tranche la course, pas le code.

Deno.test("linkEmail verrouille son ecriture sur l'etat lu de la colonne email", async () => {
  const sb = fakeLinkSb({ mine: { id: 7, email: null }, holder: null, users: [] });
  const r = await applyLinkEmail(sb, SESSION_SEMAX, INPUT_SEMAX);
  assertEquals(r.status, 200);
  // Premiere pose : la ligne doit encore etre sans adresse.
  assertEquals(sb.writeFilters, [{ id: 7, email: null }]);
});

Deno.test("linkEmail verrouille le rejeu sur l'adresse deja posee", async () => {
  const sb = fakeLinkSb({
    mine: { id: 7, email: "sserunkumavan@example.com" },
    holder: { id: 7, email: "sserunkumavan@example.com" },
    users: [{ id: "u-existant", email: "sserunkumavan@example.com" }],
  });
  const r = await applyLinkEmail(sb, SESSION_SEMAX, INPUT_SEMAX);
  assertEquals(r.status, 200);
  assertEquals(sb.writeFilters, [{ id: 7, email: "sserunkumavan@example.com" }]);
});

Deno.test("linkEmail rend 409 quand une requete jumelle a pose une autre adresse", async () => {
  // La ligne etait libre a la lecture, une jumelle l'a reliee entre-temps : le
  // filtre ne trouve plus rien, zero ligne touchee, et rien n'est ecrase.
  const sb = fakeLinkSb({
    mine: { id: 7, email: null },
    holder: null,
    users: [],
    linkWrite: { data: [], error: null },
  });
  const r = await applyLinkEmail(sb, SESSION_SEMAX, INPUT_SEMAX);
  assertEquals(r.status, 409);
  assertEquals(r.body, {
    error: "Your profile already uses another email address. Ask a manager to change it.",
  });
});

Deno.test("applyInvite verrouille son ecriture sur l'adresse lue de la ligne", async () => {
  const sb = fakeInviteSb({ users: [] });
  const r = await applyInvite(sb, planPourAvant(), "walter@example.com", "https://app.test/");
  assertEquals(r.status, 200);
  // AVANT porte ancien@example.com : l'ecriture ne s'applique que si la ligne
  // porte toujours cette adresse.
  assertEquals(sb.writeFilters[0], { id: 8, email: "ancien@example.com" });
});

Deno.test("applyInvite verrouille sur email null quand la ligne n'a pas d'adresse", async () => {
  const vierge = { id: 5, name: "Ismael", role: "manager", email: null, is_active: true, phone: null, color: "#e94560" };
  const input = parseInviteInput({ email: "ismael@example.com", name: "Ismael" }) as any;
  const plan = planInvite(input, 5, vierge, null);
  const sb = fakeInviteSb({ users: [] });
  const r = await applyInvite(sb, plan, "ismael@example.com", "https://app.test/");
  assertEquals(r.status, 200);
  assertEquals(sb.writeFilters[0], { id: 5, email: null });
});

Deno.test("applyInvite rend 409 quand la ligne a change sous la requete", async () => {
  const sb = fakeInviteSb({
    // L'ecriture ne touche aucune ligne : la course est perdue.
    writes: [{ data: [], error: null }],
    users: [],
  });
  const r = await applyInvite(sb, planPourAvant(), "walter@example.com", "https://app.test/");
  assertEquals(r.status, 409);
  assertEquals(r.body, { error: "This email is already used by another team member." });
  // Rien n'est tente cote Auth et rien n'est defait : la gagnante garde la main.
  assertEquals(sb.calls, ["cleaners.update"]);
});
