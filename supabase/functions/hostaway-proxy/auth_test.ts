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

import { resolveCleanerByEmail } from "./auth.ts";

// Faux client Supabase : enregistre les filtres appliques pour verifier que la
// resolution ne rend jamais un membre desactive.
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

Deno.test("resolveCleanerByEmail rend le membre actif qui porte cet email", async () => {
  const sb = fakeSb({ id: 8, name: "Walter", role: "manager", color: "#e94560" });
  const me = await resolveCleanerByEmail(sb, "walter@example.com");
  assertEquals(me, { cleaner_id: 8, name: "Walter", role: "manager", color: "#e94560" });
  assertEquals(sb.calls.some((c: any) => c.col === "email" && c.val === "walter@example.com"), true);
  assertEquals(sb.calls.some((c: any) => c.col === "is_active" && c.val === true), true);
});

Deno.test("resolveCleanerByEmail rend null quand aucun membre actif ne porte cet email", async () => {
  const sb = fakeSb(null);
  assertEquals(await resolveCleanerByEmail(sb, "inconnu@example.com"), null);
});

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
  assertEquals(parId, { kind: "error", status: 400, error: "this account cannot be invited" });
  // Branche par email : aucun id demande, la ligne est trouvee par son adresse.
  const parEmail = planInvite(input, null, { id: 11, role: "system", email: "walter@example.com", is_active: true }, 11);
  assertEquals(parEmail, { kind: "error", status: 400, error: "this account cannot be invited" });
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
  assertEquals(systemRowError("system", "manager"), "this account cannot be modified");
  assertEquals(systemRowError("system", undefined), "this account cannot be modified");
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
  const writes = [...(script.writes ?? [])];
  const sb: any = {
    calls,
    payloads,
    from(_table: string) {
      const q: any = {};
      const finish = () => {
        calls.push("cleaners." + q.op);
        if (q.payload !== undefined) payloads.push({ op: q.op, payload: q.payload });
        const r = writes.length ? writes.shift() : { data: { id: 42 }, error: null };
        return Promise.resolve(r);
      };
      q.update = (p: any) => { q.op = "update"; q.payload = p; return q; };
      q.insert = (p: any) => { q.op = "insert"; q.payload = p; return q; };
      q.delete = () => { q.op = "delete"; return q; };
      q.select = () => q;
      q.eq = () => q;
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
  const sb = fakeInviteSb({ writes: [{ error: null }], users: [{ id: "u-1", email: "ancien@example.com" }] });
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
  assertEquals(r.body, { error: "This email is already used by another team member" });
  assertEquals(sb.calls, ["cleaners.update"]);
});

Deno.test("applyInvite defait l'ecriture et rend 409 quand l'ancien compte resiste", async () => {
  const sb = fakeInviteSb({
    writes: [{ error: null }, { error: null }],
    users: [{ id: "u-1", email: "ancien@example.com" }],
    deleteUser: { error: { message: "auth down" } },
  });
  const r = await applyInvite(sb, planPourAvant(), "walter@example.com", "https://app.test/");
  assertEquals(r.status, 409);
  assertEquals(r.body, { error: "Could not replace the previous account" });
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
  assertEquals(r.body, { error: "Could not send the invitation" });
  assertEquals(sb.calls, ["cleaners.insert", "auth.listUsers", "auth.invite", "cleaners.delete"]);
});

// Revue 8a constat 4 : la garde system s'ouvrait si sa lecture echouait.
Deno.test("systemRowGuard echoue ferme quand la lecture du role echoue", async () => {
  const w = captureWarn();
  try {
    const sb = fakeInviteSb({ writes: [{ data: null, error: { message: "timeout" } }] });
    assertEquals(await systemRowGuard(sb, 11, "manager"), {
      status: 500,
      error: "Could not verify the member",
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
    error: "this account cannot be modified",
  });
  const ok = fakeInviteSb({ writes: [{ data: { role: "cleaner" }, error: null }] });
  assertEquals(await systemRowGuard(ok, 8, "manager"), null);
});
