-- Allow external integrations (e.g. WhatsApp auto-created tickets) to carry a
-- dedup reference. source already exists (e.g. 'cleaning_issue'); source_ref
-- stores the external message/event id used for authoritative deduplication.
ALTER TABLE maintenance_tickets ADD COLUMN IF NOT EXISTS source_ref TEXT;
CREATE INDEX IF NOT EXISTS idx_maintenance_tickets_source_ref ON maintenance_tickets(source_ref);
