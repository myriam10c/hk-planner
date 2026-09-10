// Génère une paire de clés VAPID (RFC 8292) et écrit un fichier .env temporaire
// prêt pour `supabase secrets set --env-file`.
// La clé privée n'est JAMAIS affichée : elle ne passe que du process au fichier
// 0600, puis du fichier à la CLI Supabase, puis le fichier est effacé.
//
// Rotation : elle invalide TOUS les abonnements existants (chaque appareil doit
// réappuyer sur Enable). À ne faire que si la clé privée a fuité. Voir le README.
//
// Usage :
//   npx -y deno@2.9.6 run --no-lock --allow-write=<fichier> scripts/gen-vapid-keys.ts <fichier>
import * as webpush from "jsr:@negrel/webpush@0.5.0";

declare const Deno: any;

const out = Deno.args[0];
if (!out) {
  console.error("usage: gen-vapid-keys.ts <chemin du fichier .env de sortie>");
  Deno.exit(1);
}

const keys = await webpush.generateVapidKeys({ extractable: true });
const exported = await webpush.exportVapidKeys(keys);
const applicationServerKey = await webpush.exportApplicationServerKey(keys);

// Les valeurs sont du JSON (guillemets doubles, virgules). On les entoure de
// guillemets simples : le parseur dotenv les lit littéralement, et un JWK ne
// contient jamais de guillemet simple.
const lines = [
  "VAPID_PUBLIC_KEY='" + JSON.stringify(exported.publicKey) + "'",
  "VAPID_PRIVATE_KEY='" + JSON.stringify(exported.privateKey) + "'",
  "VAPID_SUBJECT='mailto:admin@medini-homes.com'",
  "",
].join("\n");
await Deno.writeTextFile(out, lines, { mode: 0o600 });

// Seule la clé publique est affichée : elle n'est pas secrète, elle part dans le
// navigateur de chaque utilisateur, et elle sert à vérifier le déploiement.
console.log("applicationServerKey (public, 87 caracteres):", applicationServerKey);
console.log("secrets ecrits dans:", out);
