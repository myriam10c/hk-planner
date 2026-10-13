-- Maintenance phase 3 (app cleaner) : « Still there » sur un ticket ouvert.
-- Un type d evenement en plus pour la garde d idempotence (v3.ticketStill).
-- Toutes les valeurs de 20261012120000_maintenance_proposals.sql sont gardees.
ALTER TABLE public.job_events DROP CONSTRAINT IF EXISTS job_events_event_type_check;
ALTER TABLE public.job_events ADD CONSTRAINT job_events_event_type_check CHECK (event_type IN (
  'start_job','tick','upload_photo','finish_job','report_problem','check_ticket','delete_photo','add_problem_photo','set_problem_note','upload_voice','set_problem_voice','update_problem','delete_problem','mgr_problem_act','mnt_act','mnt_ingest','ticket_still'));
