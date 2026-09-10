// Envoi des emails d'authentification HK Planner.
// Le SMTP integre de Supabase plafonne a 2 emails par heure : on branche le hook
// « Send Email » de Supabase Auth sur cette fonction, qui envoie par l'API Gmail
// avec le refresh token OAuth deja utilise par le harness (integrations/email_gmail.py).
// Isole de index.ts pour etre testable : index.ts appelle Deno.serve au chargement.

export interface MailerEnv {
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  GOOGLE_REFRESH_TOKEN: string;
  GMAIL_FROM_ADDRESS: string;
  GMAIL_FROM_NAME: string;
}

export interface AuthEmail {
  subject: string;
  text: string;
  html: string;
}

const APP_URL = "https://stunning-kleicha-f61101.netlify.app";
// Ruling Q2 du controleur : l'expediteur est l'adresse Workspace portee par le
// jeton OAuth (GMAIL_FROM_ADDRESS), mais une reponse doit arriver sur l'adresse
// publique de Medini. Valeur fixe et deja publique, donc une constante, pas un
// secret ni une variable d'environnement.
const REPLY_TO = "admin@medini-homes.com";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GMAIL_SEND_URL = "https://gmail.googleapis.com/gmail/v1/users/me/messages/send";
// Tolerance de rejeu du hook. Standard Webhooks impose une fenetre, sans en
// fixer la valeur : 5 minutes est la valeur usuelle et couvre largement un
// appel Supabase vers une fonction edge.
const WEBHOOK_TOLERANCE_MS = 5 * 60_000;

// ========== Signature Standard Webhooks ==========

// Le secret arrive sous la forme "v1,whsec_<base64>" (format Supabase) ou
// "whsec_<base64>". Seule la partie base64 est la cle HMAC.
// Type de retour `Uint8Array<ArrayBuffer>` et non `Uint8Array` : depuis TS 5.7
// (embarque par Deno 2.9.6) `Uint8Array` seul vaut `Uint8Array<ArrayBufferLike>`,
// que `crypto.subtle.importKey` refuse (un SharedArrayBuffer n'est pas un
// BufferSource). Le type reste un Uint8Array pour tous les appelants.
export function parseHookSecret(raw: string): Uint8Array<ArrayBuffer> {
  const b64 = String(raw || "").replace(/^v1,/, "").replace(/^whsec_/, "");
  let bin = "";
  try {
    bin = atob(b64);
  } catch (_e) {
    return new Uint8Array(0);
  }
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// Contenu signe : "<webhook-id>.<webhook-timestamp>.<corps brut>", HMAC-SHA256,
// base64. L'en-tete peut porter plusieurs signatures separees par des espaces
// (rotation de cle sans coupure), chacune prefixee de "v1,".
export async function verifyStandardWebhook(
  secret: Uint8Array<ArrayBuffer>,
  headers: Headers,
  payload: string,
  nowMs: number,
): Promise<boolean> {
  const id = headers.get("webhook-id") ?? "";
  const ts = headers.get("webhook-timestamp") ?? "";
  const sigHeader = headers.get("webhook-signature") ?? "";
  if (!id || !ts || !sigHeader || secret.length === 0) return false;
  const tsMs = Number(ts) * 1000;
  if (!Number.isFinite(tsMs) || Math.abs(nowMs - tsMs) > WEBHOOK_TOLERANCE_MS) return false;
  const key = await crypto.subtle.importKey(
    "raw", secret, { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const mac = await crypto.subtle.sign(
    "HMAC", key, new TextEncoder().encode(id + "." + ts + "." + payload),
  );
  const expected = btoa(String.fromCharCode(...new Uint8Array(mac)));
  for (const part of sigHeader.split(" ")) {
    const idx = part.indexOf(",");
    if (idx < 0) continue;
    if (part.slice(0, idx) === "v1" && timingSafeEqual(part.slice(idx + 1), expected)) return true;
  }
  return false;
}

// ========== Rendu des emails (anglais : toute l'equipe les lit) ==========

function esc(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

export function buildActionUrl(supabaseUrl: string, emailData: any): string {
  const base = String(supabaseUrl || "").replace(/\/+$/, "");
  const u = new URL(base + "/auth/v1/verify");
  u.searchParams.set("token", String(emailData?.token_hash ?? ""));
  u.searchParams.set("type", String(emailData?.email_action_type ?? ""));
  u.searchParams.set("redirect_to", String(emailData?.redirect_to || emailData?.site_url || APP_URL));
  return u.toString();
}

function shell(title: string, intro: string, cta: string, link: string, outro: string): string {
  return [
    '<div style="margin:0;padding:24px 12px;background:#f0f0f3;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1c1c1e">',
    '<div style="max-width:480px;margin:0 auto;background:#ffffff;border-radius:16px;padding:28px 24px">',
    '<div style="font-size:13px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#7c3aed">HK Planner</div>',
    '<h1 style="margin:12px 0 8px;font-size:21px;line-height:1.3">' + esc(title) + "</h1>",
    '<p style="margin:0 0 20px;font-size:15px;line-height:1.55;color:#3a3a3c">' + esc(intro) + "</p>",
    '<a href="' + esc(link) + '" style="display:block;text-align:center;background:#7c3aed;color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;padding:14px 18px;border-radius:12px">' + esc(cta) + "</a>",
    '<p style="margin:20px 0 0;font-size:13px;line-height:1.5;color:#6b6b70">' + esc(outro) + "</p>",
    '<p style="margin:12px 0 0;font-size:12px;line-height:1.5;color:#8e8e93;word-break:break-all">' + esc(link) + "</p>",
    "</div></div>",
  ].join("");
}

const LINK_LIFETIME = "This link works once and expires in 1 hour.";

export function buildAuthEmail(supabaseUrl: string, user: any, emailData: any): AuthEmail {
  const link = buildActionUrl(supabaseUrl, emailData);
  const type = String(emailData?.email_action_type ?? "");
  const who = String(user?.email ?? "");

  if (type === "invite" || type === "signup") {
    const intro = "A manager created your HK Planner account for " + who +
      ". Choose a password and you are in. From now on you sign in with this email address.";
    return {
      subject: "Your HK Planner account is ready",
      text: [
        "HK Planner",
        "",
        intro,
        "",
        "Set your password: " + link,
        "",
        LINK_LIFETIME,
        "If the link has expired, open HK Planner and tap Forgot password.",
      ].join("\n"),
      html: shell("Your account is ready", intro, "Set your password", link, LINK_LIFETIME),
    };
  }

  if (type === "recovery") {
    const intro = "We got a request to reset the HK Planner password for " + who + ".";
    return {
      subject: "Reset your HK Planner password",
      text: [
        "HK Planner",
        "",
        intro,
        "",
        "Choose a new password: " + link,
        "",
        LINK_LIFETIME,
        "If you did not ask for this, ignore this email. Your password stays as it is.",
      ].join("\n"),
      html: shell(
        "Reset your password", intro, "Choose a new password", link,
        LINK_LIFETIME + " If you did not ask for this, ignore this email.",
      ),
    };
  }

  if (type === "magiclink") {
    const intro = "Here is your one-time sign-in link for HK Planner.";
    return {
      subject: "Sign in to HK Planner",
      text: ["HK Planner", "", intro, "", "Sign in: " + link, "", LINK_LIFETIME].join("\n"),
      html: shell("Sign in", intro, "Sign in", link, LINK_LIFETIME),
    };
  }

  if (type === "email_change" || type === "email_change_current" || type === "email_change_new") {
    const intro = "Confirm this email address so it can be used to sign in to HK Planner.";
    return {
      subject: "Confirm your new HK Planner email",
      text: ["HK Planner", "", intro, "", "Confirm: " + link, "", LINK_LIFETIME].join("\n"),
      html: shell("Confirm your email", intro, "Confirm this address", link, LINK_LIFETIME),
    };
  }

  // Repli : un nouveau type d'email cote Supabase ne doit jamais faire echouer
  // le hook, sinon l'action utilisateur echoue elle aussi.
  const intro = "Open this link to finish the action you started in HK Planner.";
  return {
    subject: "HK Planner",
    text: ["HK Planner", "", intro, "", link, "", LINK_LIFETIME].join("\n"),
    html: shell("HK Planner", intro, "Open HK Planner", link, LINK_LIFETIME),
  };
}

// ========== Message RFC 822 et envoi Gmail ==========

function b64Utf8(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

// RFC 2045 : les lignes base64 ne depassent pas 76 caracteres.
function wrap76(s: string): string {
  return (s.match(/.{1,76}/g) ?? []).join("\r\n");
}

export function toRawBase64Url(message: string): string {
  return b64Utf8(message).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function buildRawMessage(env: MailerEnv, to: string, email: AuthEmail): string {
  const boundary = "hkp-" + crypto.randomUUID();
  return [
    'From: "' + env.GMAIL_FROM_NAME + '" <' + env.GMAIL_FROM_ADDRESS + ">",
    "Reply-To: " + REPLY_TO,
    "To: " + to,
    "Subject: " + email.subject,
    "MIME-Version: 1.0",
    'Content-Type: multipart/alternative; boundary="' + boundary + '"',
    "",
    "--" + boundary,
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    wrap76(b64Utf8(email.text)),
    "--" + boundary,
    "Content-Type: text/html; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    wrap76(b64Utf8(email.html)),
    "--" + boundary + "--",
    "",
  ].join("\r\n");
}

// Cache du jeton d'acces : sans lui, chaque email declencherait un grant OAuth
// (meme piege que le cache de service de integrations/email_gmail.py).
let _token = { value: "", expiresAt: 0 };

export function resetGoogleTokenCache(): void {
  _token = { value: "", expiresAt: 0 };
}

export async function gmailAccessToken(
  env: MailerEnv,
  fetchImpl: typeof fetch = fetch,
  nowMs: number = Date.now(),
): Promise<string> {
  if (_token.value && nowMs < _token.expiresAt) return _token.value;
  const body = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    client_secret: env.GOOGLE_CLIENT_SECRET,
    refresh_token: env.GOOGLE_REFRESH_TOKEN,
    grant_type: "refresh_token",
  });
  const r = await fetchImpl(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  if (!r.ok) throw new Error("google token refresh failed: HTTP " + r.status);
  const j = await r.json();
  if (!j?.access_token) throw new Error("google token refresh returned no access_token");
  const ttl = Number(j.expires_in ?? 3600);
  _token = { value: String(j.access_token), expiresAt: nowMs + Math.max(60, ttl - 60) * 1000 };
  return _token.value;
}

export async function sendGmail(
  env: MailerEnv,
  to: string,
  email: AuthEmail,
  fetchImpl: typeof fetch = fetch,
  nowMs: number = Date.now(),
): Promise<any> {
  const token = await gmailAccessToken(env, fetchImpl, nowMs);
  const raw = toRawBase64Url(buildRawMessage(env, to, email));
  const r = await fetchImpl(GMAIL_SEND_URL, {
    method: "POST",
    headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
    body: JSON.stringify({ raw }),
  });
  if (!r.ok) throw new Error("gmail send failed: HTTP " + r.status);
  return await r.json();
}
