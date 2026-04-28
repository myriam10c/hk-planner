# Project decommission & rename checklist

Three Supabase projects exist; two of them need attention.

## ✅ `dqjnqvbxfwtvrjwnnmns` — havn-stays-guide

**Production HK Planner.** Keep as-is.
- Frontend: https://stunning-kleicha-f61101.netlify.app/
- Edge function: `hostaway-proxy`
- Region: `eu-west-3`

## 🟡 `mtfhbxeaiqhveuernkfn` — currently named "havenstays"

**Status: ACTIVE, region ap-southeast-2.**

This was the original WhatsApp-Ops monitoring source. Monitoring tables (`monitoring_events`, `monitoring_alerts`, `monitoring_reports`, `monitoring_templates`, `monitoring_config`, `monitoring_whatsapp_debug`, `listings_map`, `email_log`) have been copied to `dqjnqvbxfwtvrjwnnmns`.

It also hosts unrelated production functions for other businesses:
- `medini-bot` (Medini)
- `passport-upload`, `scan-passports`, `extract-passport-data` (passport flow)
- `sakani-register`, `sakani-debug` (Sakani)
- `iskaan-trigger`, `portal-helper` (Iskaan)
- `daily-reconciliation`, `morning-alert`, `checkout-notification`, `weekly-report`, `health-check`

### Actions

- [ ] **Rename** in [Project Settings → General](https://supabase.com/dashboard/project/mtfhbxeaiqhveuernkfn/settings/general). Suggestion: `medini-prod` or `legacy-ops` to avoid the "havenstays" duplicate.
- [ ] **Delete redundant monitoring functions** (already migrated). Run for each:
  ```bash
  ./deploy-proxy.sh   # ensure CLI auth set up first, then:
  npx supabase functions delete monitoring-classify --project-ref mtfhbxeaiqhveuernkfn
  npx supabase functions delete monitoring-ingest-hostaway --project-ref mtfhbxeaiqhveuernkfn
  npx supabase functions delete monitoring-report --project-ref mtfhbxeaiqhveuernkfn
  npx supabase functions delete monitoring-whatsapp-inbound --project-ref mtfhbxeaiqhveuernkfn
  npx supabase functions delete monitoring-checkin-scanner --project-ref mtfhbxeaiqhveuernkfn
  npx supabase functions delete monitoring-heartbeat --project-ref mtfhbxeaiqhveuernkfn
  npx supabase functions delete monitoring-weekly-patterns --project-ref mtfhbxeaiqhveuernkfn
  npx supabase functions delete monitoring-dashboard --project-ref mtfhbxeaiqhveuernkfn
  ```
- [ ] **Drop redundant monitoring tables** — only after 2 weeks of stability (gives a rollback window):
  ```sql
  -- Run in mtfhbxeaiqhveuernkfn SQL editor, NOT in production HK Planner project
  DROP TABLE IF EXISTS public.monitoring_events     CASCADE;
  DROP TABLE IF EXISTS public.monitoring_alerts     CASCADE;
  DROP TABLE IF EXISTS public.monitoring_reports    CASCADE;
  DROP TABLE IF EXISTS public.monitoring_templates  CASCADE;
  DROP TABLE IF EXISTS public.monitoring_config     CASCADE;
  DROP TABLE IF EXISTS public.monitoring_whatsapp_debug CASCADE;
  -- listings_map and email_log: keep, may be used by other functions on this project
  ```
- [ ] **Unschedule monitoring crons** on this project (they were duplicated on HK Planner already):
  ```sql
  SELECT cron.unschedule('monitoring-checkin-scan');
  SELECT cron.unschedule('monitoring-heartbeat');
  SELECT cron.unschedule('monitoring-weekly-patterns');
  ```

## 🔴 `lqdmmnbdutdlllpebexb` — paused, "havenstays" (eu-central-1)

**Status: INACTIVE (paused).** Created as a test, never used.

### Action

- [ ] **Delete** via [Project Settings → General → Delete project](https://supabase.com/dashboard/project/lqdmmnbdutdlllpebexb/settings/general). One-click destructive op — user confirmation required, no API path. Frees the third free-tier slot.

## Why this isn't automated

Project rename and deletion live in the dashboard, not the Management API. Edge function deletion *is* scriptable (above) but only after the deploy CLI is set up. Table drops are reversible only via PITR — a manual step keeps the rollback window honest.
