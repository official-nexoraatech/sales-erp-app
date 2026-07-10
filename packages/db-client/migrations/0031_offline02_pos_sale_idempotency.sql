-- OFFLINE-02 — Offline Sync Idempotency & Retry Hardening
--
-- Adds a client-generated idempotency key to invoices so a retried offline POS-sale sync
-- (lost ack, then re-POST of the same queued sale) is rejected instead of creating a second
-- invoice, a second stock deduction, and a second payment. NULL values never collide under a
-- standard Postgres unique constraint, so non-POS invoice creation (which never supplies this
-- key) is unaffected — same convention as notification_log.idempotency_key (see
-- 0021_es26_notification_idempotency.sql).

ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "client_operation_id" varchar(100);

CREATE UNIQUE INDEX IF NOT EXISTS "invoices_tenant_client_operation_id" ON "invoices" ("tenant_id", "client_operation_id");
