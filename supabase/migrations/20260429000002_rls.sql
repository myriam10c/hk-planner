-- HK Planner — Row Level Security
-- Pattern: every row carries org_id; you can read/write only if you're a member of that org.
-- Roles inside an org: manager (full), maintenance (own tickets), cleaner (own turnovers + dmg reports), owner (own properties read-only).

alter table orgs                       enable row level security;
alter table profiles                   enable row level security;
alter table memberships                enable row level security;
alter table buildings                  enable row level security;
alter table properties                 enable row level security;
alter table checklist_templates        enable row level security;
alter table checklist_items            enable row level security;
alter table turnovers                  enable row level security;
alter table turnover_checklist_items   enable row level security;
alter table wa_messages                enable row level security;
alter table tickets                    enable row level security;
alter table ticket_events              enable row level security;
alter table damage_reports             enable row level security;
alter table owner_statements           enable row level security;
alter table org_settings               enable row level security;

-- Helper: returns the role the current user has in the given org (or null).
create or replace function current_role_in(p_org uuid)
returns member_role
language sql security definer stable as $$
  select role from memberships
   where user_id = auth.uid() and org_id = p_org
   limit 1
$$;

-- Helper: is the current user a member of the org with one of the listed roles?
create or replace function has_role_in(p_org uuid, p_roles member_role[])
returns boolean
language sql security definer stable as $$
  select exists (
    select 1 from memberships
     where user_id = auth.uid() and org_id = p_org and role = any(p_roles)
  )
$$;

-- ─── orgs ──────────────────────────────────────────────────────────
create policy orgs_member_read on orgs for select using (
  exists (select 1 from memberships m where m.org_id = orgs.id and m.user_id = auth.uid())
);
create policy orgs_manager_update on orgs for update using (
  has_role_in(orgs.id, array['manager']::member_role[])
);

-- ─── profiles ──────────────────────────────────────────────────────
create policy profiles_self_read on profiles for select using (
  -- you can read your own profile or any profile that shares an org with you
  id = auth.uid()
  or exists (
    select 1 from memberships m1, memberships m2
     where m1.user_id = auth.uid()
       and m2.user_id = profiles.id
       and m1.org_id = m2.org_id
  )
);
create policy profiles_self_upsert on profiles for insert with check (id = auth.uid());
create policy profiles_self_update on profiles for update using (id = auth.uid());

-- ─── memberships ───────────────────────────────────────────────────
create policy memberships_read on memberships for select using (
  user_id = auth.uid()
  or has_role_in(org_id, array['manager']::member_role[])
);
create policy memberships_manager_write on memberships for all using (
  has_role_in(org_id, array['manager']::member_role[])
) with check (
  has_role_in(org_id, array['manager']::member_role[])
);

-- ─── buildings / properties ────────────────────────────────────────
create policy buildings_member_read on buildings for select using (
  exists (select 1 from memberships m where m.org_id = buildings.org_id and m.user_id = auth.uid())
);
create policy buildings_manager_write on buildings for all using (
  has_role_in(org_id, array['manager']::member_role[])
) with check (
  has_role_in(org_id, array['manager']::member_role[])
);

create policy properties_read on properties for select using (
  -- managers + maintenance + cleaners see all org properties
  has_role_in(properties.org_id, array['manager','maintenance','cleaner']::member_role[])
  -- owners only see properties they own
  or properties.owner_user_id = auth.uid()
);
create policy properties_manager_write on properties for all using (
  has_role_in(org_id, array['manager']::member_role[])
) with check (
  has_role_in(org_id, array['manager']::member_role[])
);

-- ─── checklists ────────────────────────────────────────────────────
create policy checklist_tpl_read on checklist_templates for select using (
  exists (select 1 from memberships m where m.org_id = checklist_templates.org_id and m.user_id = auth.uid())
);
create policy checklist_tpl_write on checklist_templates for all using (
  has_role_in(org_id, array['manager']::member_role[])
) with check (
  has_role_in(org_id, array['manager']::member_role[])
);
create policy checklist_items_read on checklist_items for select using (
  exists (
    select 1 from checklist_templates t
     where t.id = checklist_items.template_id
       and exists (select 1 from memberships m where m.org_id = t.org_id and m.user_id = auth.uid())
  )
);
create policy checklist_items_write on checklist_items for all using (
  exists (
    select 1 from checklist_templates t
     where t.id = checklist_items.template_id
       and has_role_in(t.org_id, array['manager']::member_role[])
  )
);

-- ─── turnovers ─────────────────────────────────────────────────────
create policy turnovers_read on turnovers for select using (
  has_role_in(turnovers.org_id, array['manager','maintenance']::member_role[])
  or turnovers.cleaner_id = auth.uid()
  or exists (
    select 1 from properties p
     where p.id = turnovers.property_id
       and p.owner_user_id = auth.uid()
  )
);
create policy turnovers_manager_write on turnovers for all using (
  has_role_in(org_id, array['manager']::member_role[])
) with check (
  has_role_in(org_id, array['manager']::member_role[])
);
create policy turnovers_cleaner_update on turnovers for update using (
  cleaner_id = auth.uid()
) with check (
  cleaner_id = auth.uid()
);

-- ─── turnover checklist instance items ─────────────────────────────
create policy tci_read on turnover_checklist_items for select using (
  exists (
    select 1 from turnovers t
     where t.id = turnover_checklist_items.turnover_id
       and (
         has_role_in(t.org_id, array['manager','maintenance']::member_role[])
         or t.cleaner_id = auth.uid()
       )
  )
);
create policy tci_write on turnover_checklist_items for all using (
  exists (
    select 1 from turnovers t
     where t.id = turnover_checklist_items.turnover_id
       and (
         has_role_in(t.org_id, array['manager']::member_role[])
         or t.cleaner_id = auth.uid()
       )
  )
);

-- ─── wa_messages ───────────────────────────────────────────────────
create policy wa_read on wa_messages for select using (
  has_role_in(wa_messages.org_id, array['manager','maintenance']::member_role[])
);
create policy wa_write on wa_messages for all using (
  has_role_in(org_id, array['manager']::member_role[])
) with check (
  has_role_in(org_id, array['manager']::member_role[])
);

-- ─── tickets ───────────────────────────────────────────────────────
create policy tickets_read on tickets for select using (
  has_role_in(tickets.org_id, array['manager','maintenance']::member_role[])
  or tickets.tech_id = auth.uid()
  or exists (
    select 1 from properties p
     where p.id = tickets.property_id
       and p.owner_user_id = auth.uid()
  )
);
create policy tickets_manager_write on tickets for all using (
  has_role_in(org_id, array['manager','maintenance']::member_role[])
) with check (
  has_role_in(org_id, array['manager','maintenance']::member_role[])
);

create policy ticket_events_read on ticket_events for select using (
  exists (
    select 1 from tickets tk
     where tk.id = ticket_events.ticket_id
       and (
         has_role_in(tk.org_id, array['manager','maintenance']::member_role[])
         or tk.tech_id = auth.uid()
       )
  )
);
create policy ticket_events_write on ticket_events for insert with check (
  exists (
    select 1 from tickets tk
     where tk.id = ticket_events.ticket_id
       and has_role_in(tk.org_id, array['manager','maintenance']::member_role[])
  )
);

-- ─── damage reports ────────────────────────────────────────────────
create policy damage_read on damage_reports for select using (
  has_role_in(damage_reports.org_id, array['manager','maintenance']::member_role[])
  or damage_reports.reporter_id = auth.uid()
);
create policy damage_insert_cleaner on damage_reports for insert with check (
  damage_reports.reporter_id = auth.uid()
  and exists (select 1 from memberships m where m.user_id = auth.uid() and m.org_id = damage_reports.org_id)
);
create policy damage_manager_update on damage_reports for update using (
  has_role_in(org_id, array['manager']::member_role[])
);

-- ─── owner statements ──────────────────────────────────────────────
create policy stmts_read on owner_statements for select using (
  has_role_in(owner_statements.org_id, array['manager']::member_role[])
  or owner_statements.owner_user_id = auth.uid()
);
create policy stmts_write on owner_statements for all using (
  has_role_in(org_id, array['manager']::member_role[])
) with check (
  has_role_in(org_id, array['manager']::member_role[])
);

-- ─── org_settings ──────────────────────────────────────────────────
create policy settings_read on org_settings for select using (
  exists (select 1 from memberships m where m.org_id = org_settings.org_id and m.user_id = auth.uid())
);
create policy settings_manager_write on org_settings for all using (
  has_role_in(org_id, array['manager']::member_role[])
) with check (
  has_role_in(org_id, array['manager']::member_role[])
);
