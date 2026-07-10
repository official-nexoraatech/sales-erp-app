-- Add an e-Way Bill specific status column to einvoice_data.
-- Needed by the new GST_COMPLIANCE_GENERATION saga (PG-006): NIC has no "cancel EWB" API,
-- so compensation after a failed EWB generation step flags the row for manual review here
-- instead of inventing a synthetic undo. EWB success is still tracked via ewb_number presence,
-- unchanged.

ALTER TABLE "einvoice_data" ADD COLUMN IF NOT EXISTS "ewb_status" varchar(30);
