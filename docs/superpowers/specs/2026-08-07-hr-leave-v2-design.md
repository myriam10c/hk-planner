# HR portal v2 : historique, formulaire signé, jours fériés

Date : 2026-08-07. Validé par Hillal (approche B : PDF archivé dans Storage).

## Contexte

Retour de l'admin après test réel (congé de Semax) :

1. Après approbation, le détail de la demande disparaît de la vue manager. Le solde
   est bien déduit mais impossible de retrouver qui a demandé quoi, quand, décidé par qui.
   Cause : `hrOverview` ne renvoie que `pending` + approuvés à venir (fenêtre 90 j,
   `end_date >= today`) + totaux `taken`. Les approuvés passés, rejetés et annulés
   restent en base mais ne sont jamais renvoyés au manager. L'employé, lui, voit tout
   dans « My requests » (`hrMyLeave` renvoie ses 100 dernières demandes).
2. Besoin d'un formulaire de congé signé téléchargeable, comme pièce justificative
   (protection de la société en cas de litige, droit du travail UAE).
3. Demande complémentaire : les jours fériés UAE dans le système.

## Périmètre

### 1. Historique des congés (vue manager)

- `hrOverview` renvoie un champ `history` : toutes les demandes tous statuts
  (approved, rejected, cancelled, pending), 200 dernières, tri `start_date` décroissant.
- Dossier employé : la section « Current and upcoming leave » devient « Leave history ».
  Elle liste TOUTES les demandes de la personne depuis `history` (badge statut,
  décidé par qui, quand). Congés en cours/à venir en tête, le reste en dessous.
- Le bouton « Cancel this leave » reste réservé aux demandes pending/approved
  non passées (comportement actuel inchangé).
- Vue employé : inchangée.

### 2. Signatures dessinées

- Soumission par l'employé (« Request leave ») : pad de signature obligatoire
  (canvas tactile, PNG base64). Stockée dans `leave_requests.employee_signature`.
- Approbation par le manager : au clic sur Approve, pad de signature avant envoi.
  Stockée dans `leave_requests.manager_signature`. Reject : pas de signature.
- Congé saisi par le manager (« Book leave for this person ») : pas de signature
  employé ; le formulaire PDF porte « Recorded by [manager] on behalf of employee ».
- Taille attendue par signature : 5 à 30 Ko base64. Limite serveur : 100 Ko par champ.
- Côté serveur, `hrSubmitLeave` exige `employee_signature` quand l'employé soumet
  pour lui-même, et l'accepte absente quand un manager soumet pour un tiers.

### 3. PDF archivé dans Supabase Storage (approche B)

- Bucket privé `hr-forms`. Un fichier par demande : `leave-forms/{id}.pdf`.
- Génération côté edge function avec pdf-lib (`npm:pdf-lib`, compatible Deno) :
  - à la soumission : version « employee-signed », statut pending ;
  - à la décision (approve ou reject) : version finale, écrase la précédente.
- Colonne `leave_requests.form_path` : chemin du PDF archivé, null si pas encore généré.
- Contenu du formulaire (anglais) : en-tête « Hillal Medini Vacation Homes Rental LLC »,
  « Leave Application Form », infos employé (nom, poste, date d'embauche, nationalité),
  type de congé, dates, nombre de jours, motif, solde annuel au moment de la génération,
  blocs signatures (image + nom + date), statut et décision (decided_by, decided_at).
- Bouton « Download form » sur chaque carte de demande : dossier employé (manager)
  et « My requests » (employé, ses propres demandes uniquement). Nouvelle route
  `hrLeaveForm` (GET, param `id`) : vérifie les droits (manager, ou employé
  propriétaire de la demande), renvoie une URL signée temporaire (60 s) vers le PDF.
- Demandes antérieures à la feature (sans signature ni PDF) : génération paresseuse
  au premier téléchargement. Blocs signature remplacés par « Approved in app by
  [nom] on [date] » (ou le statut correspondant), puis archivage normal.
- Si l'écriture Storage échoue à la soumission/décision : l'opération métier
  n'échoue PAS (le PDF se régénérera au premier téléchargement). Log console.

### 4. Jours fériés UAE

- Table `public_holidays` : `id`, `holiday_date` (date, unique), `name` (text).
  Seed migration avec les dates connues 2026 et les dates fixes 2027
  (New Year, Eid approximatifs à ajuster, National Day 2-3 déc, etc.).
- CRUD manager : section « Public holidays » sur l'écran HR principal
  (liste à venir + formulaire ajout + suppression). Lecture pour tous
  (employé : liste des fériés à venir sur « My leave »).
- Routes : renvoyés dans `hrOverview` et `hrMyLeave` (champ `holidays`,
  fériés de l'année en cours et suivante) ; `hrSaveHoliday` (POST, manager) ;
  `hrDeleteHoliday` (POST, manager).
- Planning ménage (vue principale app.js) : bandeau sur l'en-tête du jour férié
  (ex. « 🎉 Eid Al Adha »). Les fériés sont ajoutés au payload `getAllData`
  (léger : quelques lignes par an).
- AUCUN impact sur le décompte des jours de congé (défaut légal UAE conservé :
  un férié pendant un congé compte dans le congé).

## Sécurité

- `hrLeaveForm` : URL signée courte durée, jamais de bucket public.
- Signatures : acceptées uniquement en `data:image/png;base64,` avec limite de taille,
  refus sinon (400).
- Écritures fériés et décisions : `hrAuth(manager)` comme l'existant.
- L'employé ne peut télécharger que ses propres formulaires.

## Tests

- Helpers purs nouveaux testés dans `tests/hr.spec.ts` (périmètre historique,
  validation signature côté serveur si extraite en helper, tri/regroupement).
- Vérification manuelle du flux complet (submit avec signature, approve avec
  signature, download PDF, fériés dans planning) via Playwright ou navigateur.

## Déploiement

- Migration SQL : `employee_signature`, `manager_signature`, `form_path`
  sur `leave_requests` + table `public_holidays` + seed + bucket `hr-forms`
  créé dans la migration (`insert into storage.buckets (id, name, public)
  values ('hr-forms', 'hr-forms', false) on conflict (id) do nothing`).
- Edge function : `./deploy-proxy.sh`. Front : `./deploy-front.sh` (stamp sw VERSION).
- Prod servie depuis l'arbre de travail : ne rien stasher, ne rien « ranger ».

## Hors périmètre

- Déduction des fériés du solde de congés (choix explicite : non).
- Signature du reject par le manager.
- Notifications supplémentaires (Telegram existant inchangé).
- Versionnage multiple des PDF (un seul fichier par demande, écrasé).
