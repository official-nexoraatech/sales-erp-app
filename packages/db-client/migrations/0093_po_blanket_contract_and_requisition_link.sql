-- Purchase audit 2026-07-21 gap-fix: Blanket PO / Rate Contract support. Existing multi-GRN-
-- per-PO mechanism is reused for call-offs; contractValidTill gates new GRNs once expired.
-- requisition_id links a PO back to the requisition it was converted from (nullable — most
-- POs are still created directly, as before this feature).
ALTER TABLE "purchase_orders" ADD COLUMN IF NOT EXISTS "po_type" varchar(20) NOT NULL DEFAULT 'STANDARD';
ALTER TABLE "purchase_orders" ADD COLUMN IF NOT EXISTS "contract_valid_from" timestamptz;
ALTER TABLE "purchase_orders" ADD COLUMN IF NOT EXISTS "contract_valid_till" timestamptz;
ALTER TABLE "purchase_orders" ADD COLUMN IF NOT EXISTS "requisition_id" integer;
