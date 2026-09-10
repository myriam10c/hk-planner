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
