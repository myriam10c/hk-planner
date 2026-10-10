-- App manager /manager/, phase 2 (Problems). Les gestes de tri (assign, schedule,
-- close, reopen, comment) passent par la meme garde d idempotence que v3 et
-- inspections : job_events.idem_key unique. Un seul type d evenement en plus.
-- Applique par le MCP Supabase (apply_migration) avant le deploiement du proxy.
ALTER TABLE public.job_events DROP CONSTRAINT IF EXISTS job_events_event_type_check;
ALTER TABLE public.job_events ADD CONSTRAINT job_events_event_type_check CHECK (event_type IN (
  'start_job','tick','upload_photo','finish_job','report_problem','check_ticket',
  'delete_photo','add_problem_photo','set_problem_note','upload_voice',
  'set_problem_voice','update_problem','delete_problem','mgr_problem_act'));
