# Inspections · zone « DET equipment » (checklist équipements obligatoires)

Demande Hillal 06/10/2026 : ajouter aux Inspections la liste des équipements DET (Annexe 1, appartement Standard)
pour que l'équipe vérifie que rien ne manque et comble le manque. Source de la liste et de la répartition
proprio/Medini : `~/Documents/Medini_Docs/fiche-conformite-det/equipment-det-en.html`.

## Comportement

- Nouvelle zone `det`, libellé `DET equipment`, ajoutée EN DERNIER (11 zones). Mêmes règles que les autres :
  OK ou Not OK, obligatoire pour finir.
- Not OK sur `det` : l'inspecteur coche les éléments manquants (au moins un) dans une liste groupée.
  Note libre facultative. Photo FACULTATIVE pour cette zone (on ne photographie pas un absent).
  Issue : `fixed` (« Added on the spot », fixNote obligatoire comme aujourd'hui) ou `maintenance`
  (« Needs to be supplied » → ticket).
- Ticket (`ensureTicket`) pour `det` : titre `DET equipment missing: <labels…>` (tronqué 80 car. comme aujourd'hui),
  description = une ligne par élément : `- <label> · <Owner supplies (owner pays, tell Hillal before buying) | Medini supplies | Owner buys, Medini restocks>`,
  puis la note libre et « Found during inspection by … ».
- La liste vit UNE fois côté serveur (`INSP_DET_ITEMS` dans `insp_rules.ts`) et est renvoyée au front dans
  le snapshot de `insp.start` (`detItems`). Le front ne la duplique pas.

## Données

Migration `supabase/migrations/20261006120000_inspection_det_items.sql` :
`ALTER TABLE public.inspection_items ADD COLUMN IF NOT EXISTS missing_items text[] NOT NULL DEFAULT '{}';`
`itemOut` renvoie `missingItems` (tableau de clés). Pour `status=ok` ou zone ≠ det : `{}`.

## Liste `INSP_DET_ITEMS` (key, group, label, who: owner | medini | both)

Displays: permit (DET permit displayed, medini) · qr (Unit QR code under the DEWA plaque, medini) · notice (Emergency procedures and 24h numbers, Arabic and English, medini) · qibla (Qibla direction, medini) · guide (Visitor guide / Medini Guide QR, medini) · rules (House and building rules for guests, medini)
Safety: extinguisher (Fire extinguisher, in date, owner) · blanket (Fire blanket, owner) · gloves_torch (Gloves and working torch, owner) · first_aid (First aid kit, complete, both) · peephole (Peephole or intercom, owner) · smart_lock (SIRA smart lock, Keyless, owner)
Unit: wifi (Wi-Fi working, owner) · blackout (Blackout curtains, owner) · bins (Waste bin in kitchen and every room, owner) · iron (Iron and ironing board, owner) · vacuum (Vacuum cleaner, owner) · cleaning_tools (Mop, bucket, cleaning tools, owner) · washer_dryer (Washing machine with dryer, owner)
Living room: sofa (Sofa for two per bedroom, owner) · dining (Dining table, 2 chairs per bedroom, owner) · tv (TV with remote, owner) · rug (Rug or carpet, owner)
Bedroom: bed (Bed with headboard, good mattress, owner) · bedding (Pillows and duvet on every bed, owner) · bedside (Bedside table and lamp, owner) · wardrobe (Wardrobe with shelves and mirror, owner) · hangers (At least 6 hangers, owner) · safe (Safe box, owner) · sheets (2 sets of sheets per bed, both)
Bathroom: bath_mirror (Mirror with lighting, owner) · toiletries (Soap and shampoo, medini) · towels (2 sets of towels per room, both) · shattaf (Shattaf or bidet, owner) · towel_holder (Towel holder and hooks, owner) · bath_mat (Bath mat, both)
Kitchen: sink (Sink and draining board, owner) · hob (Cooking hob, owner) · fridge (Fridge, owner) · microwave (Microwave, owner) · utensils (Cooking utensils, 2 tableware sets per bedroom, owner) · hood (Extractor hood, owner)

## Tâches

1. Serveur (proxy) : `insp_rules.ts` (zone + liste + export des clés), `insp_write.ts` (saveItem : validation
   `missing` pour det, note auto si vide = « Missing: … », ticket det ; finish : pas de photo exigée pour det ;
   snapshot : `detItems`), `insp_read.ts` si `itemOut`/zones y sont relus, migration, tests deno
   (`insp_write_test.ts`, `insp_rules_test.ts`) verts.
2. Front (`inspections/inspect.js`, `insp.css`) : zone det ajoutée au jumeau `ZONES`, formulaire Not OK spécial
   (cases groupées avec badge Owner / Medini / Owner+Medini, note facultative, photo facultative, libellés
   « Added on the spot » / « Needs to be supplied »), résumé = liste des manquants avec qui fournit.
   UI en anglais. Bouton OK libellé « All present » pour det.
3. Revue en deux temps (conformité spec, puis qualité), puis déploiement : migration, proxy (`deploy-proxy.sh`),
   front (`deploy-front.sh`), vérification en prod.
