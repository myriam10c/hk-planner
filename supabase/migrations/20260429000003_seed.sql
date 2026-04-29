-- Demo seed — only runs if no orgs exist (idempotent).
-- Creates a "Paris HK" demo org with the same data as the prototype, but no fake users.
-- Real users get bound to this org via the post-signup trigger or via an invite flow.

do $$
declare
  v_org uuid;
begin
  if exists (select 1 from orgs limit 1) then
    raise notice 'Seed skipped — orgs table not empty';
    return;
  end if;

  insert into orgs (name, slug) values ('Paris HK', 'paris-hk') returning id into v_org;

  insert into org_settings (org_id) values (v_org);

  -- Buildings
  insert into buildings (org_id, name, address, zone) values
    (v_org, 'Marais — rue de Bretagne',     '38 rue de Bretagne, 75003',     'Paris 03'),
    (v_org, 'Belleville — Denoyez',         '12 rue Denoyez, 75020',          'Paris 20'),
    (v_org, 'Montmartre — Trois Frères',    '5 rue des Trois Frères, 75018',  'Paris 18'),
    (v_org, 'Canal — Jemmapes',             '102 Quai de Jemmapes, 75010',   'Paris 10'),
    (v_org, 'Latin — Mouffetard',           '24 rue Mouffetard, 75005',      'Paris 05');

  -- Properties (linked to buildings via name)
  insert into properties (org_id, building_id, name, unit, full_name, address, zone, door_code, wifi_name, notes)
  select v_org, b.id, p.name, p.unit, p.full_name, p.address, p.zone, p.door_code, p.wifi_name, p.notes
  from (values
    ('Marais 2BR',        'Apt 3A', 'Marais — rue de Bretagne · Apt 3A',     '38 rue de Bretagne, 75003 — Apt 3A',     'Paris 03', '4421', 'ENJ-marais',   'Boiler in cupboard left of fridge.', 'Marais — rue de Bretagne'),
    ('Marais 3BR Family', 'Apt 5B', 'Marais — rue de Bretagne · Apt 5B',     '38 rue de Bretagne, 75003 — Apt 5B',     'Paris 03', '8801', 'bastille-fam', 'Two bathrooms. Top floor (5th, no lift).', 'Marais — rue de Bretagne'),
    ('Belleville Studio', 'Studio', 'Belleville Loft · Studio',              '12 rue Denoyez, 75020',                   'Paris 20', '7782', 'belleville-2g','Lockbox under stairs.', 'Belleville — Denoyez'),
    ('Montmartre 1BR',    '1BR',    'Montmartre 1BR · vue Sacré-Cœur',       '5 rue des Trois Frères, 75018',           'Paris 18', '1290', 'mont-1br',     'Tight stairs.', 'Montmartre — Trois Frères'),
    ('Canal Studio',      'Apt 1',  'Canal St-Martin · Apt 1 (rez)',          '102 Quai de Jemmapes, 75010 — Apt 1',     'Paris 10', '5566', 'canal-flat',   '', 'Canal — Jemmapes'),
    ('Canal 1BR',         'Apt 4',  'Canal St-Martin · Apt 4',                '102 Quai de Jemmapes, 75010 — Apt 4',     'Paris 10', '6677', 'canal-1br',    '4th floor.', 'Canal — Jemmapes'),
    ('Latin Studio',      'Studio', 'Latin Quarter Studio',                   '24 rue Mouffetard, 75005',                'Paris 05', '3344', 'latin-q',      '', 'Latin — Mouffetard')
  ) as p(name, unit, full_name, address, zone, door_code, wifi_name, notes, bldg_name)
  join buildings b on b.name = p.bldg_name and b.org_id = v_org;

  -- Default checklist template
  with t as (
    insert into checklist_templates (org_id, name, is_default) values (v_org, 'Standard turnover', true)
    returning id
  )
  insert into checklist_items (template_id, group_name, position, text, requires_photo)
  select t.id, gi.g, gi.pos, gi.txt, gi.photo from t,
  (values
    ('Entrance', 1, 'Empty bins / replace liners', false),
    ('Entrance', 2, 'Sweep & mop floor',            false),
    ('Entrance', 3, 'Wipe door handles',            false),
    ('Kitchen',  4, 'Dishwasher empty + run if needed',     false),
    ('Kitchen',  5, 'Wipe surfaces, hob, microwave',        false),
    ('Kitchen',  6, 'Restock coffee, sugar, tea',           false),
    ('Kitchen',  7, 'Check fridge — discard guest leftovers', false),
    ('Kitchen',  8, 'Photo: kitchen wide',          true),
    ('Bathroom', 9, 'Disinfect WC, sink, shower',   false),
    ('Bathroom',10, 'Replace towels (4×)',          false),
    ('Bathroom',11, 'Restock toilet paper, soap, shampoo', false),
    ('Bathroom',12, 'Photo: shower glass',          true),
    ('Bedroom', 13, 'Strip + remake beds',          false),
    ('Bedroom', 14, 'Vacuum carpet & under bed',    false),
    ('Bedroom', 15, 'Reset cushions / blackout curtains', false),
    ('Final',   16, 'AC at 21°C, lights off',       false),
    ('Final',   17, 'Welcome card on table',        false),
    ('Final',   18, 'Photo: lockbox',               true)
  ) as gi(g, pos, txt, photo);
end $$;
