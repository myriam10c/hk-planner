// Cible du hook « Send Email » de Supabase Auth.
// Deployee avec --no-verify-jwt : l'authentification de l'appelant est la
// signature Standard Webhooks, pas un JWT.
//
// Regles : ne jamais journaliser le corps de la requete ni le lien construit
// (ils portent le token_hash, qui vaut un mot de passe a usage unique).
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { buildAuthEmail, type MailerEnv, parseHookSecret, sendGmail, verifyStandardWebhook } from "./mailer.ts";

declare const Deno: any;

const JSON_HEADERS = { "Content-Type": "application/json" };

function envOrThrow(): MailerEnv {
  const keys = [
    "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_REFRESH_TOKEN",
    "GMAIL_FROM_ADDRESS", "GMAIL_FROM_NAME",
  ];
  const out: any = {};
  for (const k of keys) {
    const v = Deno.env.get(k) ?? "";
    if (!v) throw new Error("missing secret: " + k);
    out[k] = v;
  }
  return out as MailerEnv;
}

function fail(status: number, message: string) {
  return new Response(
    JSON.stringify({ error: { http_code: status, message } }),
    { status, headers: JSON_HEADERS },
  );
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return fail(405, "method not allowed");

  const payload = await req.text();
  const secret = parseHookSecret(Deno.env.get("SEND_EMAIL_HOOK_SECRET") ?? "");
  if (!(await verifyStandardWebhook(secret, req.headers, payload, Date.now()))) {
    console.log("[auth-mailer] signature refusee");
    return fail(401, "invalid signature");
  }

  let body: any;
  try {
    body = JSON.parse(payload);
  } catch (_e) {
    return fail(400, "invalid json body");
  }

  const to = typeof body?.user?.email === "string" ? body.user.email.trim() : "";
  const type = String(body?.email_data?.email_action_type ?? "");
  if (!to) return fail(400, "user.email required");

  const supabaseUrl = (Deno.env.get("SUPABASE_URL") ?? "").replace(/\/+$/, "");
  try {
    const email = buildAuthEmail(supabaseUrl, body.user, body.email_data);
    await sendGmail(envOrThrow(), to, email);
    // Trace volontairement pauvre : type d'action seulement, ni email, ni lien.
    console.log("[auth-mailer] envoye type=" + type);
  } catch (e) {
    console.error("[auth-mailer] echec d'envoi type=" + type + ": " + String(e));
    return fail(500, "email delivery failed");
  }

  // Le hook n'attend aucune sortie : 200 avec un objet vide.
  return new Response("{}", { status: 200, headers: JSON_HEADERS });
});
