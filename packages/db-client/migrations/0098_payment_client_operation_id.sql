-- M-8 fix: standalone payment creation (POST /payments) had no idempotency key at all, unlike
-- invoices (client_operation_id, migration 0031) and POS sales — a network-timeout retry of a
-- "Record Payment" submission could create a duplicate Payment row. Same convention: NULL
-- values never collide under a standard Postgres unique index, so every existing caller that
-- never supplies this key is unaffected.

ALTER TABLE "payments" ADD COLUMN IF NOT EXISTS "client_operation_id" varchar(100);

CREATE UNIQUE INDEX IF NOT EXISTS "payments_tenant_client_operation_id" ON "payments" ("tenant_id", "client_operation_id");
