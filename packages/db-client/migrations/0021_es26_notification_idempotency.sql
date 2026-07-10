-- ES-26 — Reporting, Notification & Scheduler Data Consistency (M8)
--
-- Adds a dedup key to notification_log so a retry (from the caller's HTTP-level retry, not the
-- internal delivery backoff) that lands on an already-recently-sent notification is rejected
-- instead of sending twice. NULL values never collide under a standard Postgres unique
-- constraint, so notifications that don't supply/derive a key are unaffected.

ALTER TABLE "notification_log" ADD COLUMN IF NOT EXISTS "idempotency_key" varchar(200);

CREATE UNIQUE INDEX IF NOT EXISTS "notif_log_idempotency_key" ON "notification_log" ("tenant_id", "idempotency_key");
