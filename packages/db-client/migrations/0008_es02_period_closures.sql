-- ES-02: Add retry / dead-letter columns to outbox_events
ALTER TABLE outbox_events ADD COLUMN IF NOT EXISTS retry_count integer NOT NULL DEFAULT 0;
ALTER TABLE outbox_events ADD COLUMN IF NOT EXISTS failed boolean NOT NULL DEFAULT false;
ALTER TABLE outbox_events ADD COLUMN IF NOT EXISTS failed_reason text;
CREATE INDEX IF NOT EXISTS idx_outbox_retry ON outbox_events (failed, retry_count) WHERE published = false;

-- ES-02: Add date-range columns to period_closures
ALTER TABLE period_closures ADD COLUMN IF NOT EXISTS start_date date;
ALTER TABLE period_closures ADD COLUMN IF NOT EXISTS end_date date;
