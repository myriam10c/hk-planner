import { assertEquals, assertStringIncludes, assertRejects } from "jsr:@std/assert@1";
import {
  buildActionUrl,
  buildAuthEmail,
  buildRawMessage,
  gmailAccessToken,
  parseHookSecret,
  resetGoogleTokenCache,
  sendGmail,
  toRawBase64Url,
  verifyStandardWebhook,
} from "./mailer.ts";

// GMAIL_FROM_ADDRESS volontairement different du Reply-To attendu : en prod
// l'expediteur est l'adresse Workspace portee par le jeton OAuth, le Reply-To
// est la constante admin@medini-homes.com. Un test ou les deux coincident ne
// prouverait rien.
const ENV = {
  GOOGLE_CLIENT_ID: "cid.apps.googleusercontent.com",
  GOOGLE_CLIENT_SECRET: "csecret",
  GOOGLE_REFRESH_TOKEN: "rtoken",
  GMAIL_FROM_ADDRESS: "sender@example.com",
  GMAIL_FROM_NAME: "HK Planner",
};

const SUPABASE_URL = "https://proj.supabase.co";
const APP_URL = "https://stunning-kleicha-f61101.netlify.app";

function emailData(type: string) {
  return {
    token: "123456",
    token_hash: "hash-abc",
    redirect_to: APP_URL + "/",
    email_action_type: type,
    site_url: APP_URL,
  };
}

async function signPayload(secretRaw: string, id: string, ts: string, payload: string) {
  const key = await crypto.subtle.importKey(
    "raw", parseHookSecret(secretRaw), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(id + "." + ts + "." + payload));
  return btoa(String.fromCharCode(...new Uint8Array(mac)));
}

const SECRET_RAW = "v1,whsec_" + btoa("0123456789abcdef0123456789abcdef");

Deno.test("verifyStandardWebhook accepte une signature valide", async () => {
  const payload = JSON.stringify({ hello: "world" });
  const ts = String(Math.floor(Date.now() / 1000));
  const sig = await signPayload(SECRET_RAW, "msg_1", ts, payload);
  const headers = new Headers({
    "webhook-id": "msg_1", "webhook-timestamp": ts, "webhook-signature": "v1," + sig,
  });
  assertEquals(await verifyStandardWebhook(parseHookSecret(SECRET_RAW), headers, payload, Date.now()), true);
});

Deno.test("verifyStandardWebhook accepte une signature parmi plusieurs (rotation de cle)", async () => {
  const payload = JSON.stringify({ hello: "world" });
  const ts = String(Math.floor(Date.now() / 1000));
  const sig = await signPayload(SECRET_RAW, "msg_1", ts, payload);
  const headers = new Headers({
    "webhook-id": "msg_1", "webhook-timestamp": ts,
    "webhook-signature": "v1,AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA= v1," + sig,
  });
  assertEquals(await verifyStandardWebhook(parseHookSecret(SECRET_RAW), headers, payload, Date.now()), true);
});

Deno.test("verifyStandardWebhook refuse un corps modifie", async () => {
  const payload = JSON.stringify({ hello: "world" });
  const ts = String(Math.floor(Date.now() / 1000));
  const sig = await signPayload(SECRET_RAW, "msg_1", ts, payload);
  const headers = new Headers({
    "webhook-id": "msg_1", "webhook-timestamp": ts, "webhook-signature": "v1," + sig,
  });
  assertEquals(
    await verifyStandardWebhook(parseHookSecret(SECRET_RAW), headers, JSON.stringify({ hello: "evil" }), Date.now()),
    false,
  );
});

Deno.test("verifyStandardWebhook refuse un horodatage hors tolerance (rejeu)", async () => {
  const payload = JSON.stringify({ hello: "world" });
  const oldTs = String(Math.floor(Date.now() / 1000) - 3600);
  const sig = await signPayload(SECRET_RAW, "msg_1", oldTs, payload);
  const headers = new Headers({
    "webhook-id": "msg_1", "webhook-timestamp": oldTs, "webhook-signature": "v1," + sig,
  });
  assertEquals(await verifyStandardWebhook(parseHookSecret(SECRET_RAW), headers, payload, Date.now()), false);
});

Deno.test("verifyStandardWebhook refuse des en-tetes manquants", async () => {
  assertEquals(
    await verifyStandardWebhook(parseHookSecret(SECRET_RAW), new Headers({}), "{}", Date.now()),
    false,
  );
});

Deno.test("buildActionUrl pointe sur /auth/v1/verify avec le token_hash et le redirect", () => {
  const u = new URL(buildActionUrl(SUPABASE_URL, emailData("invite")));
  assertEquals(u.origin + u.pathname, SUPABASE_URL + "/auth/v1/verify");
  assertEquals(u.searchParams.get("token"), "hash-abc");
  assertEquals(u.searchParams.get("type"), "invite");
  assertEquals(u.searchParams.get("redirect_to"), APP_URL + "/");
});

Deno.test("buildAuthEmail rend l'invitation en anglais avec le lien d'action", () => {
  const e = buildAuthEmail(SUPABASE_URL, { email: "walter@example.com" }, emailData("invite"));
  assertEquals(e.subject, "Your HK Planner account is ready");
  assertStringIncludes(e.html, "/auth/v1/verify?token=hash-abc");
  assertStringIncludes(e.text, "/auth/v1/verify?token=hash-abc");
  assertStringIncludes(e.text, "Set your password");
});

Deno.test("buildAuthEmail rend la reinitialisation avec un sujet distinct", () => {
  const e = buildAuthEmail(SUPABASE_URL, { email: "walter@example.com" }, emailData("recovery"));
  assertEquals(e.subject, "Reset your HK Planner password");
  assertStringIncludes(e.text, "did not ask for this");
});

Deno.test("buildAuthEmail a un repli pour un type inconnu", () => {
  const e = buildAuthEmail(SUPABASE_URL, { email: "x@y.z" }, emailData("something_new"));
  assertEquals(e.subject, "HK Planner");
  assertStringIncludes(e.text, "/auth/v1/verify");
});

Deno.test("buildRawMessage produit un multipart texte et HTML avec le bon expediteur", () => {
  const e = buildAuthEmail(SUPABASE_URL, { email: "walter@example.com" }, emailData("invite"));
  const raw = buildRawMessage(ENV, "walter@example.com", e);
  assertStringIncludes(raw, 'From: "HK Planner" <sender@example.com>');
  // Ruling Q2 : une reponse a un email d'authentification doit arriver sur
  // l'adresse publique de Medini, pas sur la boite personnelle de l'expediteur.
  assertStringIncludes(raw, "Reply-To: admin@medini-homes.com");
  assertStringIncludes(raw, "To: walter@example.com");
  assertStringIncludes(raw, "Subject: Your HK Planner account is ready");
  assertStringIncludes(raw, "Content-Type: multipart/alternative");
  assertStringIncludes(raw, "Content-Type: text/plain; charset=UTF-8");
  assertStringIncludes(raw, "Content-Type: text/html; charset=UTF-8");
});

Deno.test("toRawBase64Url est url-safe et sans remplissage", () => {
  const s = toRawBase64Url("ete a Dubai ~ ???");
  assertEquals(/^[A-Za-z0-9_-]+$/.test(s), true);
});

Deno.test("gmailAccessToken echange le refresh token et met le resultat en cache", async () => {
  resetGoogleTokenCache();
  const calls: string[] = [];
  const fake = async (url: string | URL, init?: any) => {
    calls.push(String(url));
    const body = String(init?.body ?? "");
    assertStringIncludes(body, "grant_type=refresh_token");
    assertStringIncludes(body, "refresh_token=rtoken");
    return new Response(JSON.stringify({ access_token: "at-1", expires_in: 3600 }), { status: 200 });
  };
  const now = Date.now();
  assertEquals(await gmailAccessToken(ENV, fake as any, now), "at-1");
  assertEquals(await gmailAccessToken(ENV, fake as any, now + 1000), "at-1");
  assertEquals(calls.length, 1);
  assertEquals(await gmailAccessToken(ENV, fake as any, now + 3_600_000), "at-1");
  assertEquals(calls.length, 2);
});

Deno.test("gmailAccessToken leve quand Google refuse", async () => {
  resetGoogleTokenCache();
  const fake = async () => new Response('{"error":"invalid_grant"}', { status: 400 });
  await assertRejects(() => gmailAccessToken(ENV, fake as any, Date.now()), Error, "HTTP 400");
});

Deno.test("sendGmail poste le message sur l'API Gmail avec le jeton d'acces", async () => {
  resetGoogleTokenCache();
  const seen: any[] = [];
  const fake = async (url: string | URL, init?: any) => {
    const u = String(url);
    seen.push({ u, init });
    if (u.includes("oauth2.googleapis.com")) {
      return new Response(JSON.stringify({ access_token: "at-9", expires_in: 3600 }), { status: 200 });
    }
    return new Response(JSON.stringify({ id: "m1", threadId: "t1" }), { status: 200 });
  };
  const e = buildAuthEmail(SUPABASE_URL, { email: "walter@example.com" }, emailData("recovery"));
  const r = await sendGmail(ENV, "walter@example.com", e, fake as any, Date.now());
  assertEquals(r.id, "m1");
  const send = seen[1];
  assertEquals(send.u, "https://gmail.googleapis.com/gmail/v1/users/me/messages/send");
  assertEquals(send.init.headers.Authorization, "Bearer at-9");
  assertEquals(/^[A-Za-z0-9_-]+$/.test(JSON.parse(send.init.body).raw), true);
});

Deno.test("sendGmail leve quand Gmail refuse", async () => {
  resetGoogleTokenCache();
  const fake = async (url: string | URL) =>
    String(url).includes("oauth2")
      ? new Response(JSON.stringify({ access_token: "at", expires_in: 3600 }), { status: 200 })
      : new Response('{"error":{"code":403}}', { status: 403 });
  const e = buildAuthEmail(SUPABASE_URL, { email: "a@b.c" }, emailData("invite"));
  await assertRejects(() => sendGmail(ENV, "a@b.c", e, fake as any, Date.now()), Error, "HTTP 403");
});

// ---------------------------------------------------------------------------
// Consolidation de la revue T4 (tache 8a).
// ---------------------------------------------------------------------------

import { headerInjectionError, safeRedirectTo } from "./mailer.ts";

// T4 remarque 1 : buildActionUrl recopiait redirect_to sans le comparer a
// l'origine de l'app. GoTrue le valide deja, c'est une defense en profondeur.
Deno.test("safeRedirectTo n'accepte que les cibles de l'app", () => {
  assertEquals(safeRedirectTo(APP_URL + "/"), APP_URL + "/");
  assertEquals(safeRedirectTo(APP_URL + "/#/team?x=1"), APP_URL + "/#/team?x=1");
  assertEquals(safeRedirectTo(APP_URL), APP_URL);
  assertEquals(safeRedirectTo("https://evil.example/steal"), APP_URL);
  // Prefixe trompeur : le meme debut de chaine, un autre hote.
  assertEquals(safeRedirectTo(APP_URL + ".evil.example/steal"), APP_URL);
  assertEquals(safeRedirectTo(""), APP_URL);
  assertEquals(safeRedirectTo(null), APP_URL);
});

Deno.test("buildActionUrl remplace un redirect_to d'une autre origine", () => {
  const u = new URL(buildActionUrl(SUPABASE_URL, {
    token_hash: "hash-abc",
    email_action_type: "invite",
    redirect_to: "https://evil.example/steal",
    site_url: APP_URL,
  }));
  assertEquals(u.searchParams.get("redirect_to"), APP_URL);
});

// T4 remarque 2 : un CR/LF dans le destinataire fabriquerait un en-tete RFC 822
// supplementaire (Bcc, par exemple). Le sujet est traite de la meme facon.
Deno.test("headerInjectionError refuse un CR ou un LF dans le destinataire ou le sujet", () => {
  assertEquals(headerInjectionError("walter@example.com", "Your HK Planner account is ready"), null);
  assertEquals(headerInjectionError("a@b.c\r\nBcc: x@y.z", "Sujet"), "invalid recipient");
  assertEquals(headerInjectionError("a@b.c\nBcc: x@y.z", "Sujet"), "invalid recipient");
  assertEquals(headerInjectionError("a@b.c", "Sujet\r\nBcc: x@y.z"), "invalid subject");
});

// ---------------------------------------------------------------------------
// Projet Supabase partage avec Interiors Studio (2026-10-10).
// ---------------------------------------------------------------------------

const INTERIORS_URL = "https://interiors-studio.netlify.app";

// Verrou : les emails HK Planner restent identiques octet pour octet. Les
// instantanes ont ete generes avec le code d'avant l'ajout d'Interiors Studio.
Deno.test("buildAuthEmail HK Planner identique aux instantanes d'avant Interiors", async () => {
  const snap = JSON.parse(await Deno.readTextFile(new URL("./hk_email_snapshots.json", import.meta.url)));
  let count = 0;
  for (const t of snap.types as string[]) {
    for (const [k, r] of Object.entries(snap.redirects as Record<string, unknown>)) {
      const got = buildAuthEmail("https://proj.supabase.co", { email: "walter@example.com" },
        { token_hash: "hash-abc", email_action_type: t, redirect_to: r, site_url: snap.app });
      assertEquals(got, snap.emails[t + "|" + k], t + "|" + k);
      count++;
    }
  }
  assertEquals(count, 48);
});

Deno.test("safeRedirectTo accepte l'origine Interiors Studio avec la meme garde de frontiere", () => {
  assertEquals(safeRedirectTo(INTERIORS_URL), INTERIORS_URL);
  assertEquals(safeRedirectTo(INTERIORS_URL + "/"), INTERIORS_URL + "/");
  assertEquals(safeRedirectTo(INTERIORS_URL + "/#/catalogue?x=1"), INTERIORS_URL + "/#/catalogue?x=1");
  assertEquals(safeRedirectTo(INTERIORS_URL + "?a=1"), INTERIORS_URL + "?a=1");
  assertEquals(safeRedirectTo(INTERIORS_URL + ".evil.example/x"), APP_URL);
  assertEquals(safeRedirectTo(INTERIORS_URL + "-evil.netlify.app"), APP_URL);
  assertEquals(safeRedirectTo("http://interiors-studio.netlify.app"), APP_URL);
});

function interiorsEmail(type: string) {
  return buildAuthEmail(SUPABASE_URL, { email: "hillal@medini-homes.com" }, {
    token_hash: "hash-abc", email_action_type: type, redirect_to: INTERIORS_URL, site_url: APP_URL,
  });
}

for (const type of ["magiclink", "recovery"]) {
  Deno.test("Interiors Studio : " + type + " devient un lien de connexion a la marque Interiors", () => {
    const e = interiorsEmail(type);
    assertEquals(e.subject, "Sign in to Interiors Studio");
    assertStringIncludes(e.text, "Sign in: ");
    assertStringIncludes(e.html, ">Sign in</a>");
    assertStringIncludes(e.html, "MEDINI INTERIORS STUDIO");
    assertStringIncludes(e.html, "#8C7A5E");
    assertStringIncludes(e.text, "This link works once and expires in 1 hour.");
    assertEquals(e.html.includes("#7c3aed"), false);
    assertEquals(/HK Planner|password/i.test(e.subject + e.text + e.html), false);
    const link = e.text.split("Sign in: ")[1].split("\n")[0];
    assertEquals(new URL(link).searchParams.get("redirect_to"), INTERIORS_URL);
    assertEquals(new URL(link).searchParams.get("type"), type);
  });
}

Deno.test("Interiors Studio : tous les types portent la marque Interiors, jamais HK Planner", () => {
  for (const type of ["invite", "signup", "recovery", "magiclink", "email_change", "email_change_new", "other"]) {
    const e = interiorsEmail(type);
    const all = e.subject + e.text + e.html;
    assertStringIncludes(all, "Interiors Studio");
    assertEquals(all.includes("HK Planner"), false, type);
    assertEquals(all.includes("—"), false, type);
  }
});

Deno.test("Une origine inconnue retombe sur HK Planner (lien et marque)", () => {
  const e = buildAuthEmail(SUPABASE_URL, { email: "a@b.c" }, {
    token_hash: "h", email_action_type: "magiclink", redirect_to: INTERIORS_URL + ".evil.example", site_url: APP_URL,
  });
  assertEquals(e.subject, "Sign in to HK Planner");
  const link = e.text.split("Sign in: ")[1].split("\n")[0];
  assertEquals(new URL(link).searchParams.get("redirect_to"), APP_URL);
});
