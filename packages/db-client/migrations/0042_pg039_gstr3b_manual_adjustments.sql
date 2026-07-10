-- PG-039 — GSTR-3B manual adjustments for import-of-goods/import-of-services IGST.
-- These two buckets can't be computed from existing ledger data (no country/isImport field
-- anywhere in the schema), so this stores an optional per-filing manual override instead.
-- Nullable, no default, no backfill needed — existing rows simply have no override.

ALTER TABLE "gst_return_filings" ADD COLUMN IF NOT EXISTS "manual_adjustments" jsonb;
