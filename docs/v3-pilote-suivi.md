# Pilote v3 cleaner · suivi quotidien et retour arriere

Document interne, pour Hillal. Le mode d'emploi des deux cleaners est
`docs/v3-pilot.md`, en anglais, c'est le seul document a leur envoyer.

## Ce qui est en place

- `/v3/` sert la nouvelle app cleaner (Today, Job, Report a problem, Profile)
  sur `https://stunning-kleicha-f61101.netlify.app/v3/`.
- Sept actions de proxy en plus : `v3.myDay`, `v3.startJob`, `v3.tick`,
  `v3.uploadPhoto`, `v3.finishJob`, `v3.reportProblem`, `v3.checkTicket`.
  Aucune action existante n'a change de contrat.
- Quatre tables neuves : `job_events` (idempotence), `photos`, `on_duty`,
  `v3_job_keys` (identifiants de menage opposes, aucun nom de guest).
- L'app actuelle est servie sans un seul changement de comportement, a la meme
  adresse. Les deux seules lignes touchees dans son `sw.js` la font laisser
  `/v3/` tranquille et bornent son menage de cache a ses propres cles.
- Rien n'est envoye a Faiza ni a Pionah tant que tu ne le decides pas.

## A verifier une fois, avant d'ouvrir le pilote

1. **Un logement sans fiche.** Le listing `580602` n'a pas de ligne dans
   `listing_config`. Ce n'est plus bloquant depuis le correctif du 2026-09-12 :
   la v3 se replie sur le titre Hostaway de la reservation et affiche
   « 704 Golf Links », exactement comme l'app actuelle. Completer sa fiche reste
   utile (numero d'appartement, type, nombre de chambres pour la checklist et la
   duree estimee) : sans elle, le logement passe en Studio par defaut. Pour
   savoir quels logements sont concernes pendant la semaine du pilote :

```sql
SELECT DISTINCT split_part(ca.reservation_key, '_', 1) AS jour, ca.reservation_key
FROM public.cleaning_assignments ca
WHERE ca.cleaner_id IN (4, 10)
  AND ca.reservation_key >= to_char(current_date, 'YYYY-MM-DD')
ORDER BY 1;
```

Puis, pour chaque listing concerne, verifier qu'il a bien une ligne dans
`listing_config` avec `internal_name` (le « Apt - Immeuble » que la v3 affiche
en priorite), `unit_type` et `bedrooms`.

2. **Technicien de permanence.** La table `on_duty` est vide. Ce n'est pas
   bloquant : sans ligne du jour, un signalement part vers Semax. Il est
   aujourd'hui le SEUL compte actif de role `maintenance` (verifie en base le
   2026-09-12), donc le resultat est deterministe. La regle par defaut cite
   ensuite Ismael, mais son role en base est `manager` : cette branche ne peut
   jamais se declencher. Consequence a connaitre, sans correctif de code : si
   Semax est desactive, aucun technicien n'est trouve, et un signalement reste
   `open` non assigne, avec une notification a tous les managers, Ismael compris.
   Personne n'est prevenu deux fois, et rien n'est perdu. Si tu veux quelqu'un
   d'autre pendant la semaine, poser une ligne par jour dans `on_duty`
   (`duty_date`, `technician_id`, `set_by`) en pointant un compte actif de role
   `maintenance`.

3. **La premiere ouverture doit se faire avec du reseau.** La v3 n'installe sa
   coquille hors ligne qu'a une visite connectee. C'est ecrit dans le mode
   d'emploi, mais autant le leur redire de vive voix.

## A regarder chaque jour du pilote, dans cet ordre

**1. Rien de perdu, rien de double.** Les deux colonnes doivent etre egales.

```sql
SELECT event_type, count(*) AS evenements, count(DISTINCT idem_key) AS cles
FROM public.job_events
WHERE created_at > now() - interval '1 day'
GROUP BY 1 ORDER BY 1;
```

Une difference veut dire qu'une cle d'idempotence a ete rejouee sans etre
reconnue : c'est le seul chiffre qui justifie d'arreter le pilote le jour meme.

**1 bis. Aucune cle d'idempotence bloquee.** Le resultat doit etre zero.

```sql
SELECT count(*) FROM public.job_events
WHERE result IS NULL AND created_at < now() - interval '1 hour';
```

Une ligne ici veut dire qu'une cle a ete posee sans que l'ecriture qui suit
aboutisse (fonction edge morte au milieu). Le telephone concerne recoit 409 sur
ce geste, et comme la file hors ligne est strictement ordonnee, **tout ce qui
suit est bloque derriere**. Le proxy purge tout seul ces lignes au-dela de six
heures (`purgeStaleClaims`, lancee en arriere-plan par `v3.myDay`, au plus une
fois par heure), donc cette requete sert a le voir AVANT ces six heures. Pour
debloquer tout de suite, sans attendre la purge :

```sql
DELETE FROM public.job_events
WHERE result IS NULL AND created_at < now() - interval '1 hour';
```

Le signe cote cleaner est un bandeau « Saved on device, N to sync » qui ne
redescend jamais alors que le telephone a du reseau.

**2. Menages termines depuis la v3, et duree.** Comparer a l'idee que tu as de
la duree normale du logement : la v3 promet une duree estimee, si le reel s'en
ecarte tous les jours c'est l'estimation qu'il faut corriger, pas la cleaner.

```sql
SELECT reservation_key, cleaner_id, duration_minutes, finished_at
FROM public.cleaning_timer
WHERE finished_at > now() - interval '1 day'
ORDER BY finished_at DESC;
```

**3. Signalements crees par l'app.** L'objectif du pilote en compte au moins un
sur la semaine.

```sql
SELECT id, listing_id, category, status, assigned_technician_id, created_at
FROM public.maintenance_tickets
WHERE source = 'hk_planner_v3'
ORDER BY created_at DESC;
```

**4. Actions refusees par le serveur.** Elles ne laissent aucune trace en base,
justement parce qu'elles n'ont rien ecrit : elles vivent sur le telephone de la
cleaner. Lui demander d'ouvrir `/v3/` puis l'onglet **Profile** : si un bloc
**Not sent** apparait, il donne le nombre, l'action et la raison de chaque
refus. Une cleaner qui a vu le message « Not sent: ... Tell your manager. »
doit le signaler le jour meme. Apres traitement, le bouton « Clear this list »
vide le bloc. Un bloc Not sent non vide veut dire qu'un menage ou un
signalement n'est pas arrive : le refaire depuis l'app actuelle.

**5. Comptage du linge toujours renseigne**, sinon le solde du local devient
faux.

```sql
SELECT counted_on, count(*) FROM public.laundry_counts
WHERE counted_on > current_date - 7 GROUP BY 1 ORDER BY 1;
```

**6. La question a poser de vive voix, tous les jours, aux deux.** Une seule,
toujours la meme : « est-ce qu'un menage t'a pris plus de temps ou t'a demande
plus d'efforts a cause de l'app aujourd'hui ? » C'est la seule mesure qui
n'existe dans aucune requete, et c'est celle qui decide si la v3 sert a
quelque chose. Noter la reponse, meme quand c'est non.

## A escalader tout de suite, sans attendre le point du soir

- La requete 1 est desequilibree : une action a ete rejouee et comptee deux
  fois. Arreter le pilote, garder les deux telephones tels quels pour la
  lecture du magasin hors ligne.
- Une cleaner voit un nom de guest complet ou un numero de telephone de guest
  quelque part dans la v3.
- Une cleaner voit un arret qui n'est pas a elle, ou un arret d'une collegue.
- Un menage passe « done » sans que personne ne l'ait fini, ou un menage fini
  dans la v3 qui reste « a faire » dans l'app actuelle.
- Le bloc Not sent grossit au lieu de se vider : le serveur refuse en boucle.
- Le bandeau « Saved on device, N to sync » ne redescend jamais alors que le
  telephone a du reseau : lancer la requete 1 bis, puis son DELETE.
- Une cleaner reste bloquee plus de dix minutes et rate un checkout.

Tout le reste (un libelle moche, un bouton mal place, une estimation de duree a
cote) attend le bilan de fin de semaine.

## Criteres de succes (specification, phase A)

- Les deux cleaners finissent leurs menages de la semaine dans la v3 sans
  revenir a l'ancienne app.
- Zero action perdue : la requete 1 reste equilibree tous les jours.
- Au moins un signalement de panne passe par l'app (requete 3).

## Retour arriere

**En une ligne : arreter le pilote ne coute rien, l'app actuelle, le proxy et
les donnees sont inchanges, il suffit que `/v3/` cesse de servir l'app.**

Ne pas simplement supprimer le dossier : le service worker deja installe sur
les telephones continuerait a servir la version en cache. Remplacer le
contenu par la page de repli, deja deployee et prete, puis redeployer :

```bash
cd "/Users/hillal/Documents/Wix new/hk-planner-repo"
rm -rf v3/screens v3/styles v3/app.js v3/api.js v3/offline.js v3/photo.js v3/ui.js v3/proxy-config.js
cp v3/rollback/index.html v3/index.html
cp v3/rollback/rollback.js v3/rollback.js
./deploy-front.sh
```

`v3/rollback/index.html` desinstalle le service worker de portee `/v3/`, vide
son cache `hk-v3-*` et renvoie vers l'app actuelle. Les tables et les actions
`v3.*` peuvent rester en place : personne d'autre ne les appelle.

Un retour arriere partiel est possible et souvent suffisant : dire aux deux
cleaners de rouvrir l'app actuelle et de ne plus toucher a `/v3/`. Rien a
deployer, rien a defaire, leurs menages sont les memes des deux cotes.
