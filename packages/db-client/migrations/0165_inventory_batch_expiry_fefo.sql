-- Multi-vertical platform audit 2026-08-16: grnLines.batchNumber/expiryDate were captured on
-- goods receipt and then silently discarded before reaching the stock ledger — no batch/expiry
-- data ever reached inventory_fifo_layers, so FEFO issuance and expiry alerting were impossible.
-- items.fefoEnabled lets a FIFO-costed item opt into expiry-ordered (rather than receipt-ordered)
-- layer consumption; both are nullable/false-defaulted so no existing (cloth-retail) tenant's
-- behavior changes.
ALTER TABLE "items" ADD COLUMN "fefo_enabled" boolean DEFAULT false NOT NULL;
ALTER TABLE "inventory_fifo_layers" ADD COLUMN "batch_number" varchar(100);
ALTER TABLE "inventory_fifo_layers" ADD COLUMN "expiry_date" timestamp with time zone;
CREATE INDEX "idx_fifo_layers_fefo_order" ON "inventory_fifo_layers" ("tenant_id","item_id","warehouse_id","expiry_date");
