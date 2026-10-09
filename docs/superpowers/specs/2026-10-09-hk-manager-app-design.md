# HK Planner · nouvelle app manager (`/manager/`)

Date : 09/10/2026 · statut : spec à valider par Hillal
Prototype validé (« c'est ok », 09/10) : https://claude.ai/artifact/DLJCkSmkmWZH5nj5MJ1KaE
Planche de références : https://claude.ai/artifact/GUPDKwPmKgT7z8m32PHuzc
Source locale du prototype : `~/Documents/hk-redesign/today-prototype.html`

## 1. Pourquoi

L'app manager actuelle (`app.js`, ~8 000 lignes) s'est remplie d'ajouts : 10 tuiles dans « More »,
deux mini-apps séparées (`/inspections/`, `/v3/`) avec leur propre look et leur navigation,
des doublons (marge Elite ×2, santé des logements ×3, « History » ×3, « Reports » ×3, équipe ×2,
5 façons d'assigner), des écrans cassés (Stats vide pour un manager, « No PIN » partout,
écran Ratings en français) et aucune trace de QUEL manager agit (`actor:'Manager'`).

Usage mesuré du 09/09 au 09/10/2026 : le cœur est le ménage (affectations, done, chronos,
photos, linge). Hermes affecte et clôt les 148 jobs Elite. Maintenance : 70 tickets ouverts,
69 sans technicien, aucune résolution depuis juin. Tâches d'équipe : 239 ouvertes, aucun écran.
RH, litiges, réglages, maintenance avancée : quasi zéro, mais Hillal les garde.

## 2. Ce que l'app doit faire (décisions Hillal)

- Un accueil **Today** identique pour tous les managers, qui répond dans cet ordre :
  1. qui fait quoi aujourd'hui, 2. problèmes ouverts, 3. contrôle équipe, 4. logements prêts.
- Téléphone et ordinateur autant l'un que l'autre : une seule app responsive.
- Tous les modules sont gardés : planning, inspections, linge, RH et congés, litiges d'avis,
  tâches d'équipe, maintenance avancée, rapports, réglages.
- Construite à neuf, à côté de l'ancienne app, bascule quand Hillal valide.

## 3. Direction de design (tranchée le 09/10)

- **Look et accueil : Flighty** (Apple Design Award 2023, Interaction). Une ligne par arrivée,
  statut en 3 couleurs strictes (vert `#039855` prêt, ambre `#F79009` à risque, rouge `#D92D20`
  bloqué, fonds `#FEF0C7` / `#FEE4E2`), cause en clair sous le statut, heures en gros chiffres
  tabulaires, alerte avant le problème. Accent `#0099FF`. Fond gris froid.
- Typo : **Onest** (texte, chiffres tabulaires), **Fragment Mono** (références, horodatages).
  Corps ≥ 16 px, pas de longues capitales. Mode sombre conçu (tokens dédiés).
- **Problems : triage à la Linear** : un geste par élément (Assign, Schedule, Close),
  touches A / S / C et flèches sur ordinateur, glisser sur téléphone, Undo après Close.
- **Planning : grille semaine à la Notion Calendar**, une couleur par personne
  (Faiza, Pionah, Elite, extras).
- Jamais crème + terracotta, jamais de tiret cadratin dans l'interface, UI en anglais.

## 4. Organisation

Navigation (barre du bas sur téléphone, barre latérale sur ordinateur) :
**Today · Planning · Problems · Inspections · More**

| Entrée | Contenu | Remplace |
|---|---|---|
| Today | Les 4 blocs du prototype + bannière d'alerte (« 4 arrivals blocked… ») + 4 compteurs | Dashboard Ops (partiel), notifications |
| Planning | Grille semaine (jour sur téléphone), assigner / réassigner, extras, annuler / reporter, done, linge par ménage, congés affichés | Planner, Calendar, Extra cleaning, Laundry sheet |
| Problems | Boîte de tri unique : tickets maintenance, constats d'inspection, signalements cleaner (v3), tâches d'équipe Hermes ; filtres Urgent / Mine / Unassigned / Apartment ; fiche détaillée avec photos, commentaires, technicien, échéance | Maintenance (tickets), team tasks (sans écran aujourd'hui) |
| Inspections | Les écrans actuels de `/inspections/` (Today, Inspect, Fleet, History, Reports) rendus dans le nouveau shell | `/inspections/` séparé |
| More → Team | Équipe (comptes, rôles, invitations), congés et RH (fiches, documents, jours fériés), notes de propreté | Settings › Team, HR, Ratings, Stats |
| More → Reviews | Litiges d'avis | Reviews |
| More → Maintenance setup | Prestataires, équipements, préventif, coûts | Maintenance › Vendors / Equipment / Preventive |
| More → Reports | Tableau de bord (Ops, Revenue, Properties), compta Elite (une seule version, tarif serveur), exports, rapports d'inspection | Dashboard, Subs, exports, insp Reports |
| More → Apartment | Fiche logement unique : ménages, linge, tickets, inspections, contacts sécurité, historique | 3 « History », santé logement ×3, Security |
| More → Settings | Tous les réglages : autopilot, notifications push, objectif d'inspections, exclusions, templates checklist (lecture) | réglages dispersés |

Recherche globale (⌘K / bouton loupe) : logement, personne, ticket.

## 5. Règles de statut (Today, « Ready for today's arrivals »)

- **Ready** : ménage marqué fait après le départ précédent, et aucun ticket urgent ouvert sur le logement.
- **At risk** : ménage assigné mais pas fait, arrivée dans moins de 6 h (seuil dans `app_config.mgr_risk_hours`, défaut 6).
- **Blocked** : ménage non assigné, ou ticket urgent ouvert sur le logement.
- Séjour propriétaire : traité comme une arrivée.
- Elite saisit ses jobs le lendemain vers 14:00 : la ligne « Not assigned » d'un logement habituellement
  Elite affiche « Usually Elite · not logged yet » (ambre, pas rouge) tant que l'heure limite n'est pas passée.
- Heure de départ absente (00:00 dans Hostaway) : « checkout time not set ».

## 6. Architecture

- **Front** : nouvelle app `/manager/`, modules ES sans build (même approche que `/v3/`),
  réutilise `v3/session.js` (session email partagée `hkAuthSession`) et `v3/proxy-config.js`.
  Un fichier par écran sous `manager/screens/`, tokens et composants sous `manager/ui/`.
  Les écrans Inspections sont importés depuis `inspections/*.js` et rendus dans le shell
  (`/inspections/` reste servi tant qu'il a des liens).
- **Accès** : managers seulement, session email obligatoire (plus de PIN dans `/manager/`).
  Cleaner → `/v3/` ; subcontractor et maintenance → ancienne app tant qu'ils n'ont pas d'écran.
- **Proxy** (`hostaway-proxy`, nouveau module `mgr_*.ts`, rôle `manager`) :
  - `mgr.today` : un seul appel qui renvoie les 4 blocs déjà calculés (statuts de la section 5)
    à partir des tables existantes et du cache Hostaway (`loadReservationsCached` déjà utilisé par
    Inspections) ; réponse < 3 s à chaud.
  - `mgr.problems` (liste paginée, filtres) et `mgr.problem.*` (assign, schedule, close, undo, comment)
    au-dessus de `maintenance_tickets`, `inspection_items`, rapports v3 et `team_tasks`, avec un
    identifiant stable par source (`MNT-429`, `INS-467`, `TSK-13`, `RPT-…`).
  - Planning : réutiliser les actions existantes (`checkouts`, `assignCleaner`, `setDone`, extras,
    linge) ; aucune duplication de logique.
- **Traçabilité** : toutes les écritures faites depuis `/manager/` enregistrent l'auteur depuis la
  session (nom du manager), jamais « Manager » ; l'ancienne app est corrigée pareil (`actor` depuis
  la session côté proxy, la valeur envoyée par le navigateur est ignorée).
- **Compta Elite** : une seule source, le tarif serveur (`getSubcontractorPricing` / cache
  comptable) ; le tarif codé en dur `ELITE_COST_HT_BY_BR` disparaît.

## 7. Erreurs et hors ligne

- Lecture : dernier `mgr.today` gardé en cache local avec son horodatage, bandeau « Data from HH:MM »
  si le réseau tombe ; jamais d'écran blanc.
- Écriture : bouton désactivé pendant l'envoi, message d'erreur du serveur affiché tel quel,
  idempotence par clé (même convention que v3/inspections). Pas de file hors ligne côté manager.
- Proxy lent (cas du 07/10) : délai client 15 s puis message clair et bouton Retry.

## 8. Tests

- Proxy : tests deno des calculs de statut (section 5) et de la boîte Problems sur la fake DB
  existante, y compris les cas Elite-lendemain, séjour propriétaire, heure absente.
- Front : Playwright local (réseau bouchonné) à 390 et 1440 px, clair et sombre, sans défilement
  horizontal ; scénarios : assigner depuis Today, trier un problème au clavier, ouvrir une fiche logement.
- Vérification en prod après chaque phase sur les vraies données (lecture), comparée à l'ancienne app.

## 9. Phases (chacune livrée et vérifiée avant la suivante)

1. **Shell + Today** : navigation, `mgr.today`, les 4 blocs, Assign et Mark done réels. Auteur réel des écritures.
2. **Problems** : boîte unique, triage, fiche, intégration des tâches d'équipe et des rapports v3.
3. **Planning** : grille semaine, extras, annuler / reporter, linge par ménage, congés visibles.
4. **Inspections** dans le shell.
5. **More** : Team (équipe + RH + notes), Reviews, Maintenance setup, Reports (compta unique), Apartment, Settings.
6. **Bascule** : les managers arrivent sur `/manager/` ; ancienne app en secours via `/?legacy=1`
   pendant 30 jours ; puis retrait des écrans manager de `app.js` et du code mort.

## 10. Hors périmètre

- App cleaner `/v3/` (déjà livrée), sauf l'envoi de ses signalements vers Problems.
- Écrans dédiés subcontractor et maintenance.
- Corrections de sécurité restantes (anciens déploiements Netlify qui servent encore
  `security-contacts.json`, xlsx Drive partagé par lien, table `_writer_stakeout` sans RLS) :
  traitées à part.
