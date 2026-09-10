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
