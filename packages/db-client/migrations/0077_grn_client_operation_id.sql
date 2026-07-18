-- Idempotency key for GRN creation, same mechanism as invoices.clientOperationId
-- (nullable + unique per tenant, so NULL never collides — mirrors notification_log's
-- idempotency_key convention). Root cause this closes: POST /grns had no protection
-- against a double-submit, which could create two separate DRAFT GRNs referencing the
-- same PO; both are independently approvable, each applying its own stock-in + ledger +
-- supplier-balance update, double-crediting stock/supplier-balance for one physical
-- delivery. A client-supplied operationId lets a network-timeout retry return the
-- original GRN instead of creating a second one.

ALTER TABLE grns
  ADD COLUMN IF NOT EXISTS client_operation_id varchar(100);

ALTER TABLE grns
  ADD CONSTRAINT grns_tenant_client_operation_id UNIQUE (tenant_id, client_operation_id);
