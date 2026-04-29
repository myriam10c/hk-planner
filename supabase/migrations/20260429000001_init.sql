-- HK Planner — Initial schema
-- Multi-tenant via `org_id` on every row + RLS policies that gate by membership.

create extension if not exists "uuid-ossp";

-- ─── Core tenancy ──────────────────────────────────────────────────
create table orgs (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  slug text unique not null,
  plan text not null default 'free',
  created_at timestamptz not null default now()
);

-- App users live in `auth.users`; we extend with profile + org membership.
create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  phone text,
  avatar_url text,
  created_at timestamptz not null default now()
);

create type member_role as enum ('manager', 'cleaner', 'maintenance', 'owner');

create table memberships (
  org_id uuid not null references orgs(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  role member_role not null,
  created_at timestamptz not null default now(),
  primary key (org_id, user_id)
);

create index memberships_user_idx on memberships(user_id);

-- ─── Properties ────────────────────────────────────────────────────
create table buildings (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references orgs(id) on delete cascade,
  name text not null,
  address text not null,
  zone text,
  created_at timestamptz not null default now()
);

create table properties (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references orgs(id) on delete cascade,
  building_id uuid references buildings(id) on delete set null,
  owner_user_id uuid references profiles(id) on delete set null,
  name text not null,
  unit text,
  full_name text not null,
  address text not null,
  zone text,
  door_code text,
  wifi_name text,
  wifi_password text,
  notes text,
  hostaway_id text,
  default_cleaner_id uuid references profiles(id) on delete set null,
  checklist_template_id uuid,
  created_at timestamptz not null default now()
);

create index properties_org_idx on properties(org_id);
create index properties_building_idx on properties(building_id);
create index properties_owner_idx on properties(owner_user_id);

-- ─── Checklist templates ───────────────────────────────────────────
create table checklist_templates (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references orgs(id) on delete cascade,
  name text not null,
  is_default boolean not null default false,
  created_at timestamptz not null default now()
);

create table checklist_items (
  id uuid primary key default uuid_generate_v4(),
  template_id uuid not null references checklist_templates(id) on delete cascade,
  group_name text not null,
  position int not null,
  text text not null,
  requires_photo boolean not null default false
);

create index checklist_items_tpl_idx on checklist_items(template_id, position);

-- ─── Turnovers (the daily work units) ──────────────────────────────
create type turnover_status as enum ('pending', 'in-progress', 'done', 'blocked');

create table turnovers (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references orgs(id) on delete cascade,
  property_id uuid not null references properties(id) on delete cascade,
  checkout_at timestamptz,
  checkin_at timestamptz,
  guests int,
  nights int,
  cleaner_id uuid references profiles(id) on delete set null,
  status turnover_status not null default 'pending',
  notes text,
  hostaway_reservation_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index turnovers_org_date_idx on turnovers(org_id, checkout_at);
create index turnovers_cleaner_idx on turnovers(cleaner_id);
create index turnovers_property_idx on turnovers(property_id);

-- A snapshot of the checklist for a given turnover (so per-instance tick state).
create table turnover_checklist_items (
  id uuid primary key default uuid_generate_v4(),
  turnover_id uuid not null references turnovers(id) on delete cascade,
  group_name text not null,
  position int not null,
  text text not null,
  requires_photo boolean not null default false,
  done boolean not null default false,
  done_at timestamptz,
  done_by uuid references profiles(id) on delete set null,
  photo_url text
);

create index tci_turnover_idx on turnover_checklist_items(turnover_id, position);

-- ─── WhatsApp messages (raw + parsed) ──────────────────────────────
create type wa_status as enum ('pending', 'ticketed', 'rejected', 'replied');

create table wa_messages (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references orgs(id) on delete cascade,
  external_id text,                 -- Green API message id
  who text not null,                -- sender display name
  who_phone text,
  subtitle text,                    -- e.g. "Marais 2BR · guest" or "Cleaner"
  body text not null,
  photo_url text,
  received_at timestamptz not null default now(),
  parsed_type text,                 -- 'plumbing' | 'electrical' | ...
  parsed_property_id uuid references properties(id) on delete set null,
  parsed_priority text,             -- 'urgent' | 'high' | 'med' | 'low'
  parsed_confidence numeric(3,2),
  parsed_splits int,
  status wa_status not null default 'pending',
  ticket_id uuid,                   -- FK added below after tickets table exists
  raw_payload jsonb
);

create index wa_org_status_idx on wa_messages(org_id, status, received_at desc);

-- ─── Tickets ───────────────────────────────────────────────────────
create type ticket_status as enum ('open', 'in-progress', 'waiting', 'closed');
create type ticket_stage  as enum ('open', 'accepted', 'en-route', 'on-site', 'fixed', 'closed');
create type ticket_priority as enum ('urgent', 'high', 'med', 'low');

create table tickets (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references orgs(id) on delete cascade,
  property_id uuid not null references properties(id) on delete cascade,
  number serial,                    -- human-readable #ID
  title text not null,
  type text not null,
  priority ticket_priority not null default 'med',
  status ticket_status not null default 'open',
  stage ticket_stage not null default 'open',
  tech_id uuid references profiles(id) on delete set null,
  due_at timestamptz,
  cost_cents int,
  parts_cents int,
  source_message_id uuid references wa_messages(id) on delete set null,
  blocks_turnover boolean not null default false,
  turnover_id uuid references turnovers(id) on delete set null,
  photos jsonb not null default '{}'::jsonb,    -- { before, during, after } URLs
  bill_to text default 'owner',     -- 'owner' | 'guest' | 'ops'
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index tickets_org_status_idx on tickets(org_id, status, created_at desc);
create index tickets_property_idx on tickets(property_id);
create index tickets_tech_idx on tickets(tech_id);

alter table wa_messages add constraint wa_msg_ticket_fk
  foreign key (ticket_id) references tickets(id) on delete set null;

-- ─── Ticket activity (audit log + lifecycle events) ────────────────
create table ticket_events (
  id uuid primary key default uuid_generate_v4(),
  ticket_id uuid not null references tickets(id) on delete cascade,
  actor_id uuid references profiles(id) on delete set null,
  kind text not null,               -- 'created' | 'assigned' | 'stage' | 'note' | 'photo' | 'cost' | 'closed'
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index ticket_events_idx on ticket_events(ticket_id, created_at);

-- ─── Damage reports (filed from cleaner mobile) ────────────────────
create table damage_reports (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references orgs(id) on delete cascade,
  turnover_id uuid not null references turnovers(id) on delete cascade,
  property_id uuid not null references properties(id) on delete cascade,
  reporter_id uuid not null references profiles(id) on delete set null,
  preset text,
  description text,
  cost_cents int,
  bill_to text default 'guest',
  photo_url text,
  ticket_id uuid references tickets(id) on delete set null,
  created_at timestamptz not null default now()
);

-- ─── Owner statements ──────────────────────────────────────────────
create table owner_statements (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references orgs(id) on delete cascade,
  property_id uuid not null references properties(id) on delete cascade,
  owner_user_id uuid not null references profiles(id) on delete cascade,
  period_month int not null,        -- 1..12
  period_year int not null,
  revenue_cents int not null,
  cleaning_cents int not null,
  maintenance_cents int not null,
  channel_fees_cents int not null,
  mgmt_fee_cents int not null,
  payout_cents int not null,
  status text not null default 'pending',  -- 'pending' | 'paid'
  paid_at timestamptz,
  pdf_url text,
  created_at timestamptz not null default now(),
  unique (property_id, period_year, period_month)
);

-- ─── Org settings (AI thresholds, integrations, etc.) ──────────────
create table org_settings (
  org_id uuid primary key references orgs(id) on delete cascade,
  ai_confidence_threshold numeric(3,2) not null default 0.78,
  auto_reply boolean not null default true,
  auto_create boolean not null default false,
  quiet_hours_start time default '22:00',
  quiet_hours_end time default '08:00',
  hostaway_account_id text,
  hostaway_api_key_encrypted text,
  green_api_instance_id text,
  green_api_token_encrypted text,
  whatsapp_phone text,
  updated_at timestamptz not null default now()
);

-- ─── Auto-update timestamps ────────────────────────────────────────
create or replace function tg_set_updated_at() returns trigger as $$
begin new.updated_at = now(); return new; end $$ language plpgsql;

create trigger trg_turnovers_updated  before update on turnovers  for each row execute function tg_set_updated_at();
create trigger trg_tickets_updated    before update on tickets    for each row execute function tg_set_updated_at();
create trigger trg_org_settings_updated before update on org_settings for each row execute function tg_set_updated_at();
