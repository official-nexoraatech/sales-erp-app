-- Purchase module audit 2026-07-21: GRN receiving had no way to record batch number, serial
-- numbers, expiry date, or a quality-check split of accepted/rejected/damaged quantity — only
-- a single receivedQty existed. A modern GRN needs these at the point of receipt (they can't be
-- reconstructed later), even though full batch-wise stock consumption/FEFO across Sales/POS is
-- a separate, larger epic not part of this pass — this captures the receipt-time record.
ALTER TABLE "grn_lines" ADD COLUMN IF NOT EXISTS "batch_number" varchar(100);
ALTER TABLE "grn_lines" ADD COLUMN IF NOT EXISTS "serial_numbers" jsonb;
ALTER TABLE "grn_lines" ADD COLUMN IF NOT EXISTS "expiry_date" timestamp with time zone;
ALTER TABLE "grn_lines" ADD COLUMN IF NOT EXISTS "accepted_qty" decimal(15, 3);
ALTER TABLE "grn_lines" ADD COLUMN IF NOT EXISTS "rejected_qty" decimal(15, 3) NOT NULL DEFAULT 0;
ALTER TABLE "grn_lines" ADD COLUMN IF NOT EXISTS "damaged_qty" decimal(15, 3) NOT NULL DEFAULT 0;
ALTER TABLE "grn_lines" ADD COLUMN IF NOT EXISTS "qc_status" varchar(20) NOT NULL DEFAULT 'NA';

CREATE INDEX IF NOT EXISTS "idx_grn_lines_batch" ON "grn_lines" ("batch_number", "tenant_id");
CREATE INDEX IF NOT EXISTS "idx_grn_lines_expiry" ON "grn_lines" ("expiry_date") WHERE "expiry_date" IS NOT NULL;
