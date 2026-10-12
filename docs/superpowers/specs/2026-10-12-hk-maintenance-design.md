# HK Planner · Maintenance repensée (propositions Hostaway, validation, suivi)

Date : 12/10/2026. Demande de Hillal : « faciliter un maximum l'utilisation de la section maintenance. Les tickets doivent d'abord entrer en propositions tirées des conversations Hostaway, ensuite Semax ou l'équipe corrige et valide le ticket, ensuite le suivi est fait par Semax ou Ismaël (ou l'équipe). On part d'une feuille blanche, on efface tous les anciens tickets, on ne touche pas aux inspections récentes. »

Maquettes validées en conversation : https://claude.ai/artifact/KRkqYiBfxQnws17eNc8KQE (5 écrans Semax, 12 écrans cleaner).

## 1. Décisions prises avec Hillal

| Sujet | Décision |
|---|---|
| Ce qui passe par les propositions | Seulement les conversations Hostaway (option B). Les signalements des cleaners (app `/v3/`) et des inspections restent des tickets directs. |
| Remise à zéro | Archive en base puis effacement de l'app : tous les anciens tickets sauf les 11 tickets d'inspection d'octobre, les 124 vieilles tâches d'équipe d'avant fin juin, les 104 tâches miroir. |
| Accès de Semax | App manager `/manager/`, deux écrans seulement : Maintenance (écran d'accueil) et Planning. Ni Today, ni HR, ni Reports, ni Settings, ni Team. |
| Tâches d'équipe | Sorties de la maintenance, dans « More › Tasks ». Le mécanisme des tâches miroir (`dispatchMaintenance`) est arrêté. |
| Détection | Job serveur toutes les 30 min (8h30-22h Dubaï), Claude Haiku par l'abonnement, jamais d'API payante. |

Côté cleaner, trois changements proposés dans les maquettes (C4, C8, C12) ; Hillal les valide avec cette spécification ou les retire.

## 2. Parcours

1. Un guest écrit dans Hostaway (« the AC is blowing warm air »).
2. Le job de détection lit les nouveaux messages des guests, Claude décide s'il y a un problème de maintenance et rédige une **proposition**.
3. Semax (ou un manager) ouvre Maintenance › Proposals : **Create ticket** (formulaire pré-rempli, corrigeable), **Reject** (raison en un toucher) ou **Add to MNT-n** (si un ticket ouvert existe sur le même logement et la même catégorie).
4. Le ticket est suivi dans Maintenance › Open : Start, Waiting parts, Done (note, photo, coût facultatifs), Reassign, Due date, Comment.
5. Les cleaners continuent à signaler depuis leur app : ticket direct, assigné au technicien de garde (Semax), comme aujourd'hui.

## 3. Détection des propositions (VPS, `~/business`)

- **Handler** `hermes/handlers/maintenance_proposals.py`, planifié dans `hermes/policies.yaml` toutes les 30 min, juste après `poll_comms_hostaway`. Fenêtre 08:30-22:00 Dubaï (respect de `NIGHT_BATCH_CAP` ; le passage de 08:30 rattrape la nuit).
- **Entrée** : messages entrants (guest) de la base Neon comms (`conversations`, `messages`) plus récents que le curseur du handler (stocké dans `hermes.db`, table d'état existante ou `sync_state`). Une conversation avec au moins un nouveau message entrant est analysée en entier (les 20 derniers messages gardés).
- **Classement** : `hermes.llm` (SDK, abonnement Max, modèle Haiku). Sortie JSON stricte : `{"issues":[{"title","category","urgency","quote"}]}`, liste vide si rien. Catégories : `ac`, `plumbing`, `electrical`, `appliance`, `lock_door`, `wifi_tv`, `hot_water`, `pest`, `furniture`, `other`. Urgence `urgent` seulement si le séjour est empêché (pas d'eau, pas de clim, fuite active, porte bloquée, panne d'électricité). Ménage, check-in, parking, bruit ne sont pas de la maintenance.
- **Contexte** : `reservation_id` et `listing_map_id` de la conversation donnent le logement et les dates du séjour (Hostaway live via le proxy si absent).
- **Envoi** : appel proxy serveur à serveur `mnt.proposals.ingest` (en-tête `X-Server-Secret`), une ligne par problème. Idempotence par `(conversation_id, message_id, category)`.
- **Coût** : environ 50 à 100 appels Haiku par jour, même ordre que le tri existant `notify_team_guest_messages`. Aucun coût à l'usage.
- **Échec** : une erreur LLM ou proxy laisse le curseur en place (le message sera relu au passage suivant) ; trois échecs de suite envoient une alerte Telegram.

## 4. Données (Supabase)

Table `maintenance_proposals` :

| Colonne | Rôle |
|---|---|
| `id` bigint | référence affichée `PRP-<id>` |
| `listing_id` text | logement (listing_config) |
| `reservation_id` text, `conversation_id` text | lien Hostaway |
| `guest_name` text, `stay_from` date, `stay_to` date | contexte affiché, « Guest in now » si aujourd'hui est dans le séjour |
| `title`, `category`, `urgency` | suggestions de Claude |
| `quotes` jsonb | `[{message_id, at, text}]`, la phrase du guest, enrichie si le guest reparle du même problème |
| `status` | `pending`, `accepted`, `rejected`, `merged` |
| `ticket_id` int | ticket créé ou ticket fusionné |
| `decided_by` text, `decided_at` timestamptz, `reject_reason` text | trace de la décision (auteur pris de la session, jamais du corps) |
| `dedup_key` text unique | `conversation_id|category` tant que la proposition est `pending` |

Règles :
- Même conversation et même catégorie avec une proposition `pending` : la citation s'ajoute à `quotes`, pas de nouvelle ligne.
- Ticket ouvert sur le même logement et la même catégorie : la proposition porte `open_ticket_id`, l'écran propose « Add to MNT-n ».
- `maintenance_tickets` gagne `proposal_id` (origine) et la valeur de source `guest_message`. La citation devient le premier élément de l'historique du ticket.
- Rejetées et fusionnées gardées 30 jours visibles (« See rejected »), jamais effacées.

## 5. Actions du proxy

Toutes avec session email et rôle `manager` ou `maintenance` (nouvelle règle `mntAccess`), auteur pris de la session, clé d'idempotence par geste.

- `mnt.list?tab=proposals|open|done&filter=mine|urgent|unassigned&q=` : listes des trois onglets, comptes pour les badges.
- `mnt.proposal.accept` : crée le ticket depuis la proposition (titre, logement, catégorie, urgence, assigné, note corrigés par le valideur).
- `mnt.proposal.reject` : raison `not_maintenance`, `already_fixed`, `duplicate`, `other` (+ texte).
- `mnt.proposal.merge` : ajoute les citations en commentaire du ticket choisi.
- `mnt.ticket.create` : « + New ticket » à la main.
- `mnt.ticket.act` : `start`, `waiting_parts`, `done` (note, photo, coût), `reopen`, `assign` (personne ou prestataire), `due`, `comment`.
- `mnt.proposals.ingest` : serveur à serveur seulement.
- Les actions existantes `mgr.problem.*` restent pour les tâches d'équipe (More › Tasks).

## 6. Écrans de l'app manager

Maquettes 1 à 5. Écran **Maintenance** à trois onglets :
- **Proposals** (badge rouge du nombre en attente) : carte = urgence, « Guest in now », titre, logement, catégorie, citation, heure, lien Hostaway ; boutons Create ticket / Reject, ou Add to MNT-n.
- **Open** : filtres Mine, Urgent, Unassigned, recherche logement ; groupes To do, In progress, Waiting parts ; badges d'origine Guest message, Cleaner report, Inspection, Manual.
- **Done** : 30 derniers jours, qui, quand, coût (jamais de chiffre inventé : vide si non saisi), Reopen.
- **Fiche ticket** : barre d'étapes Created, Assigned, In progress, Done ; historique ; boutons d'étape ; Comment, Reassign, Due date.

**Today** : le bloc « Open problems » devient « Maintenance » (propositions en attente, urgents, 5 tickets les plus pressés, lien vers l'écran).
**Navigation** : l'onglet Problems devient Maintenance ; « Tasks » rejoint More.
**Semax** : session email rôle `maintenance` acceptée par `/manager/` ; barre du bas Maintenance et Planning ; atterrissage sur Maintenance ; refus serveur (403) des autres actions `mgr.*` sauf `mgr.planning` et les écritures de planning qu'il utilise déjà. L'ancienne app le redirige vers `/manager/` comme les managers ; son app terrain `/v3/` reste joignable par un lien.

## 7. App cleaner (`/v3/`), changements proposés

- **C4 · tickets ouverts à vérifier** : à l'étape 2, chaque ticket ouvert du logement devient une carte avec « Still there » (commentaire sur le ticket, statut inchangé) et « Fixed now » (photo obligatoire, appelle `v3.checkTicket` existant : statut `to_confirm`, commentaire « Checked during the cleaning, photo attached. »). Semax confirme ou rouvre depuis la fiche.
- **C8 · à qui c'est parti** : la carte du problème indique « sent to <nom du technicien de garde> » (« sent to the team » sans technicien), pour tous les problèmes, pas seulement les urgents.
- **C12 · mes signalements** : dans Profil, « My reports, last 7 days » avec le statut lisible : With Semax, In progress, Waiting parts, Fixed.
- Le reste du parcours cleaner ne change pas.

## 8. Notifications

- Proposition urgente : push à Semax et aux managers (« Urgent from a guest: AC not cooling · Apt 1509 · Westwood »), hors heures calmes.
- Ticket assigné : push à la personne assignée (existant).
- « Fixed now » d'un cleaner : push au technicien du ticket.
- Récap Telegram de 8h (`maintenance_digest.py`) : propositions en attente, tickets ouverts, urgents.

## 9. Remise à zéro (une fois, au déploiement)

1. Tables d'archive `archive_maintenance_tickets`, `archive_ticket_comments`, `archive_maintenance_costs`, `archive_photos_tickets`, `archive_team_tasks` (copie intégrale, avec la date d'archive).
2. Effacement : tickets sauf les 11 tickets `source = 'inspection'` d'octobre 2026, leurs commentaires, coûts et photos ; tâches d'équipe sans `source_ref` créées avant le 01/07/2026 ; tâches `source_ref like 'maint:%'`. Les `inspection_items` liés aux tickets gardés restent intacts ; aucun `inspection_items.ticket_id` ne doit pointer vers un ticket effacé (vérifié avant, contrainte FK).
3. Arrêt de `dispatchMaintenance` dans `scheduled/task_dispatcher.py` (VPS).
4. Comptes avant et après consignés dans le rapport à Hillal.

## 10. Phases

1. **Base et proxy** : migration (table, colonnes, archive non encore exécutée), actions `mnt.*`, règle d'accès `maintenance`, tests Deno.
2. **Écran Maintenance** dans `/manager/`, accès Semax, Today et navigation, Tasks dans More, tests Playwright.
3. **App cleaner** : C4, C8, C12 (si validés), tests Playwright `/v3/`.
4. **Détection sur le VPS** : handler, prompt, idempotence, tests pytest sur messages réels anonymisés, déploiement `scripts/deploy_vps.sh`.
5. **Remise à zéro et mise en route** : archive, effacement, arrêt des tâches miroir, déploiements front et proxy, contrôle en prod.

## 11. Points de vigilance

- Faux positifs de Claude : la validation humaine les absorbe ; le taux de rejet est affiché dans Done (« See rejected ») pour ajuster le prompt.
- Base comms Neon en offre gratuite : aucun poll supplémentaire, le handler lit ce que `poll_comms_hostaway` a déjà écrit.
- Contexte guest : aucun contact direct avec le guest depuis HK Planner ; le lien ouvre la conversation dans Hostaway.
- Jamais d'annulation automatique de ticket ni de proposition (règle du 08/10/2026).
- UI en anglais, aucun tiret cadratin.
