# HK Planner — Setup

## Phase 1 (current): Backend foundation

What's done:
- Postgres schema (`supabase/migrations/20260429000001_init.sql`) — orgs, profiles, memberships, properties, turnovers, tickets, WhatsApp messages, owner statements, etc.
- Row Level Security (`...000002_rls.sql`) — multi-tenant + role-based (manager / cleaner / maintenance / owner).
- Demo seed (`...000003_seed.sql`) — Paris HK org with the 5 buildings, 7 properties, default checklist template.
- Auth trigger + `join_org` RPC (`...000004_auth_trigger.sql`).
- TypeScript types (`src/lib/database.types.ts`) and Supabase client (`src/lib/supabase.ts`).
- Auth helpers (`src/lib/auth.ts`) and data layer (`src/lib/queries.ts`).

## One-time setup (you do this once)

### 1. Create a Supabase project

1. Go to https://supabase.com/dashboard → **New Project**
2. Name: `hk-planner`, region: `Frankfurt (eu-central-1)` (closest to Paris), generate a strong DB password
3. Wait ~2 min for provisioning

### 2. Run the migrations

In the Supabase dashboard:

1. Open **SQL Editor** → **New query**
2. Copy-paste each file from `supabase/migrations/` in numerical order, run each
3. Verify in **Table Editor** that the tables exist and the seed data is visible (orgs → "Paris HK", properties → 7 rows)

Alternative if you prefer the Supabase CLI:
```bash
brew install supabase/tap/supabase
cd hk-planner
supabase link --project-ref <your-ref>
supabase db push
```

### 3. Wire env vars

In Supabase dashboard → **Project Settings** → **API**, copy:

- Project URL
- `anon` public key

Add them to a `.env` file at repo root (and to your Vercel/GitHub Pages env):

```
VITE_SUPABASE_URL=https://xxxxxxxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIs...
```

For server-side stuff later (Edge Functions, Hostaway sync), also keep:
- `SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIs...` (NEVER ship to the client)
- `ANTHROPIC_API_KEY=sk-ant-...`

### 4. Create your first manager user

After running the migrations, you can sign up via the app's `/login` page (coming in Phase 2).

For now, in the SQL editor:
```sql
-- Replace with your actual auth.users id after signing up via Supabase auth UI
insert into memberships (org_id, user_id, role)
select id, '<your-auth-user-id>', 'manager' from orgs where slug = 'paris-hk';
```

## Roadmap

- ✅ **Phase 1** — Schema, RLS, types, client, queries
- 🔄 **Phase 2** — Wire frontend store to Supabase, login page, signup, role-based routing
- 📋 **Phase 3** — Edge Functions: Hostaway sync (cron), Green API webhook receiver, Claude API parser
- 📋 **Phase 4** — Realtime subscriptions (live ops auto-refresh), photo upload to Supabase Storage
- 📋 **Phase 5** — PWA / mobile install, push notifications, polish

## Architecture decisions

- **Why Supabase?** Single dashboard for DB + auth + RLS + Realtime + Storage + Edge Functions. No separate auth provider, no separate DB host. Free up to 50k MAU which is way past MVP needs.
- **Multi-tenancy via `org_id` on every row** — simple, performant, easy to reason about. RLS policies gate by org membership.
- **Roles inside an org** — manager / maintenance / cleaner / owner. Defined in `member_role` enum. RLS policies check role per table.
- **No separate user table** — `auth.users` is canonical, `profiles` extends it. Auth trigger keeps them in sync.
- **Owner portal is a different role, not a different app** — same database, RLS just restricts owners to their own properties.
