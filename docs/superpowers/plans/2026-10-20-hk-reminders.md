# HK Planner · Relances automatiques par push (plan, 20/10/2026)

Demande de Hillal (20/10/2026) : relances automatiques des tickets de maintenance et des menages,
par notifications push dans l'app uniquement. Execution Subagent-Driven, une tache = un sous-agent
neuf, revue en deux temps. Repo `~/Documents/Wix new/hk-planner-repo.nosync`, branche `main`.
Ne jamais `git stash`, jamais `git add -A` (prod servie depuis l'arbre non commite : `hr.js`,
`styles.css`, `sw.js`, `v3/sw.js`, tests hr/laundry ont des modifs locales qui SONT en prod ;
ne committer que ses propres fichiers ; pour `sw.js`/`v3/sw.js`, committer seulement ses hunks
avec `git add -p` si besoin, ou les laisser non commites et le dire).

## Regles (texte de Hillal, valeurs par defaut de la config)

1. Ticket `priority='urgent'` sans responsable (ni technicien ni vendor) depuis > 30 min : alerte managers. URGENT.
2. Ticket sans responsable ni `due_on` depuis > 24 h : alerte managers.
3. Ticket `status='assigned'` (assigne, pas demarre) : rappel au technicien 2 h apres l'assignation, puis 4 h plus tard (soit 6 h).
4. Ticket `status='in_progress'` sans mise a jour (`last_update`) depuis 24 h : rappel au technicien.
5. Guest sur place dans le logement du ticket : tous les delais des regles 1-4, 6, 9 divises par 2 (facteur configurable).
6. Ticket ouvert avec `due_on < aujourd'hui (Dubai)` : rappel au technicien ET alerte managers (une fois par jour).
7. Menage du lendemain non assigne a 09:15 (Dubai) : alerte managers (une fois par jour, liste des logements).
8. Menage non marque termine 2 h apres l'heure prevue : rappel a la personne assignee. Heure prevue = heure de
   l'extra (`cleaning_time`) sinon heure de checkout Hostaway sinon `cleaning_default_time` (11:00). Ignorer les
   assignes de role `subcontractor` (Elite, pas d'app) et les menages annules/faits.
9. Proposition `maintenance_proposals.status='pending'` depuis > 24 h : rappel managers.
10. Escalade : apres 2 rappels au technicien sur un ticket sans action depuis le premier (statut inchange et
    `last_update` <= envoi du 1er rappel), alerte managers URGENT avec nom du technicien et le ticket.

Tickets ouverts = statuts `open, assigned, in_progress, waiting_parts, to_confirm` (MGR_OPEN_TICKET_STATUSES).
Heure d'assignation = max(cleaning_log `mnt_ticket.assign` sur `ticket_<id>`, ticket_events to_status='assigned'),
a defaut `last_update` puis `created_at`. Guest sur place = une reservation valide du logement avec
arrivee <= aujourd'hui < depart (ou depart = aujourd'hui et heure < checkout) ; reutiliser les helpers de
reservations du proxy (`insp_reservations.ts` loadReservationsCached / `mgr_today_mnt.ts`), sans nouvel appel
Hostaway si un cache existe.

## Notifications urgentes

Urgentes = (a) toute relance d'un ticket avec guest sur place ET priorite urgent/high, (b) regle 1, (c) regle 10.
Payload push : `urgent: true`, titre en MAJUSCULES commencant par "URGENT", icone rouge `/icons/alert-192.png`,
badge `/icons/badge-96.png`, `requireInteraction: true`, `vibrate` long ([500,200,500,200,800]),
`renotify: true`, tag distinct, Web Push `Urgency.High` (deja le cas). Limites a dire a Hillal : le Web Push ne
permet ni son personnalise (propriete `sound` ignoree par tous les navigateurs) ni de passer le mode silencieux ;
iPhone ignore l'icone (icone de l'app). Normales : icone et son standard (inchange).

## Contraintes

- Silence 21:00-07:00 Dubai (config) : rien ne part, sauf urgence avec guest sur place. Rien n'est mis en file :
  le moteur reevalue toutes les 5 min, la relance part a 07:00 si la condition tient toujours.
  `sendPush` a sa propre fenetre 22:00-08:30 : ajouter une option `quietHandled: true` qui la court-circuite pour
  le moteur (le reste de l'app garde son comportement).
- Max 3 relances par ticket (ou proposition, ou menage) et par jour Dubai, tous destinataires confondus (une regle
  qui part vers plusieurs managers compte pour 1). Jamais deux relances identiques (meme regle + meme sujet +
  meme destinataire) a moins d'1 h.
- Messages courts en anglais (equipe) : logement (« 305 Neva Residence »), probleme (titre), ce qu'on attend,
  lien direct : managers/technicien -> `/manager/#/maintenance?ref=MNT-<id>` (verifier le format de lien que
  l'ecran Maintenance ouvre vraiment), proposition -> `?ref=PRP-<id>`, menages -> `/manager/#/planning` pour les
  managers, `/v3/` pour les cleaners.
- Config : defauts dans `reminders_rules.ts`, surcharges JSON dans `app_config` cle `reminders` (fusion profonde,
  validation stricte). Tout est modifiable : enabled (interrupteur global), delais, facteur guest, heures de
  silence, heure regle 7, max par jour, ecart min, destinataires managers (defaut : managers actifs sauf
  le compte `ai-assistant@medini-homes.com`), textes (gabarits avec {apt} {title} {who} {ref}...).
- Journal : table `reminder_log` (id, rule, subject_kind ticket|proposal|cleaning, subject_id, subject_ref,
  cleaner_id destinataire, title, body, urgent, status sent|no_subscription|quiet|capped|duplicate|error,
  sent_at, read_at, read_token). Lue = clic sur la notification (le SW appelle `rem.read` avec id + jeton).
- Lecture seule sur les donnees existantes : le moteur ne modifie aucun ticket, menage ou proposition.

## Taches

### T1 · Base (migration)
`supabase/migrations/20261020150000_reminders.sql` : table `reminder_log` (+ index (subject_kind, subject_id,
sent_at), (cleaner_id, sent_at)), RLS activee sans policy. Rien d'autre (le cron vient en T7). Appliquer via MCP
Supabase `apply_migration` (projet dqjnqvbxfwtvrjwnnmns).

### T2 · Moteur pur `supabase/functions/hostaway-proxy/reminders_rules.ts` + `_test.ts`
Aucune base, aucun reseau. Exporte : `REM_DEFAULTS`, `mergeConfig(stored)`, `validateConfigPatch(body)`,
`isQuiet(nowMs, cfg)`, `evaluate(snapshot, cfg, nowMs)` -> liste de `Due` {rule, subjectKind, subjectId, ref,
recipients: number[], urgent, title, body, url, key} ; `applyLimits(dues, history, nowMs, cfg)` (cap 3/jour,
ecart 1 h, silence) -> {send, skipped[{due, reason}]}. Le snapshot contient tickets ouverts, evenements
(assignations, mises a jour), rappels deja envoyes (reminder_log du jour + 2 jours), propositions en attente,
menages du jour et du lendemain (forme PlanJob reduite), guests sur place par logement, managers, noms.
Tests Deno couvrant chaque regle 1-10, la division par 2, le silence, le cap, l'ecart 1 h, l'urgence.

### T3 · IO et actions proxy `reminders.ts` + routes dans `index.ts` + `push.ts`
- `push.ts` : `PushPayload` gagne des champs optionnels `urgent`, `icon`, `requireInteraction`, `vibrate`,
  `ack` ; `sendPush` accepte `opts.quietHandled` (court-circuite isQuietHoursDubai). Tests existants verts.
- `reminders.ts` : charge le snapshot (lectures seules), appelle evaluate/applyLimits, envoie via `sendPush`,
  ecrit `reminder_log` (une ligne par destinataire), ne leve jamais pour une relance isolee.
- Actions : `rem.run` (SERVER_ONLY_ACTIONS, X-Server-Secret, POST) ; `rem.read` (POST {id, token}, X-App-Secret
  seul, pose read_at si jeton egal) ; `rem.config` (GET, managers) ; `rem.config.set` (POST, managers,
  validateConfigPatch, journal cleaning_log `reminders_config` avec auteur de session) ; `rem.log` (GET,
  managers, 200 dernieres lignes, filtres) ; `rem.test` (POST, managers et maintenance : urgent de test a
  soi-meme, hors silence). Ajouter les routes au registre ROUTES. Planning des menages : reutiliser
  `mgrPlanning` avec `loadCheckoutsCached` (comme mgr.planning) et un utilisateur systeme.
- Tests Deno (fakeDb v3_fakedb.ts) pour rem.run de bout en bout sur une base factice.

### T4 · Service worker racine `sw.js` + icone
Handler push : si `data.urgent`, options urgentes (icone rouge, requireInteraction, vibrate, titre tel quel
puisque le serveur met deja "URGENT ..."), sinon inchange. notificationclick : si `data.ack`, `fetch` POST
de l'ack (corps {id, token}, en-tete X-App-Secret porte par `data.ack.secret`) avant la navigation, sans
bloquer. Creer `icons/alert-192.png` (rouge #D92D20, triangle ou « ! » blanc, 192x192) avec Python/PIL.
Ne pas toucher la ligne VERSION (deploy-front.sh la tamponne).

### T5 · App manager `/manager/`
- More > Reminders (`manager/screens/more-reminders.js` + entree dans more.js) : interrupteur global, delais,
  heures, facteur guest, max/jour, ecart, destinataires, textes, bouton « Send me a test URGENT notification »,
  journal (200 dernieres : quand, qui, quoi, ticket, lue ou non). Ecriture par `rem.config.set`.
- Ecran plein « Turn on notifications » a l'ouverture tant que ce telephone n'est pas abonne (remplace ou
  precede le bandeau push-bar existant ; « Not now » le cache jusqu'au lendemain), iPhone hors ecran d'accueil :
  explication Add to Home Screen.
- Tests Playwright existants verts (`npx playwright test tests/manager*` ou equivalent).

### T6 · App cleaner `/v3/`
Abonnement push depuis /v3/ sur l'enregistrement du service worker racine (`/sw.js`, scope `/`, l'enregistrer
s'il manque) avec `getVapidPublicKey` + `savePushSubscription` (memes actions que l'app manager). Ecran plein
« Turn on notifications » (gros bouton, un ecran = un bouton, anglais simple) tant que non abonne, « Not now »
jusqu'au lendemain. Ne pas toucher a `v3/sw.js` sauf necessite.

### T7 · Deploiement et verification
Migration appliquee, proxy (`./deploy-proxy.sh`, verify_jwt false), front (`./deploy-front.sh`, NETLIFY_AUTH_TOKEN
de `~/.netlify/token.env`), secrets en Vault (`hk_proxy_app_secret`, `hk_proxy_server_secret` lus dans
`~/business/.env` HK_PLANNER_APP_SECRET / HK_PLANNER_SERVER_SECRET), job pg_cron `hk-reminders` `*/5 * * * *`
qui fait `net.http_post` vers `hostaway-proxy?action=rem.run` avec les deux en-tetes lus dans vault.
Verifier : rem.run renvoie un resume, reminder_log se remplit, rem.test arrive sur le telephone de Hillal.
