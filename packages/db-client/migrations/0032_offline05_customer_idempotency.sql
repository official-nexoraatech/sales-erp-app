-- OFFLINE-05 — POS Offline Feature Breadth: Customer Creation Idempotency
--
-- Adds a client-generated idempotency key to customers so a retried offline
-- customer-creation sync (lost ack, then re-POST of the same queued customer) is rejected
-- instead of creating a duplicate customer record. NULL values never collide under a
-- standard Postgres unique constraint, so non-POS customer creation (which never supplies
-- this key) is unaffected — same convention as invoices.client_operation_id (see
-- 0031_offline02_pos_sale_idempotency.sql).

ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "client_operation_id" varchar(100);

CREATE UNIQUE INDEX IF NOT EXISTS "customers_tenant_client_operation_id" ON "customers" ("tenant_id", "client_operation_id");
