-- Purchase module enhancement 2026-07-21: tiered PO approval. A PO whose grandTotal exceeds
-- this amount requires PO_APPROVE_HIGH_VALUE in addition to PO_APPROVE. NULL (the default)
-- means no threshold configured — approval stays single-tier, same as before this feature.
ALTER TABLE "organization_settings" ADD COLUMN IF NOT EXISTS "purchase_approval_threshold" decimal(15, 2);
