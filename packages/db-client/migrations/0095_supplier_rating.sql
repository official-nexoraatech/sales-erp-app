-- Purchase audit 2026-07-21 gap-fix: manual vendor rating (1.0-5.0), persisted per supplier.
ALTER TABLE "suppliers" ADD COLUMN IF NOT EXISTS "rating" decimal(2, 1);
ALTER TABLE "suppliers" ADD COLUMN IF NOT EXISTS "rating_notes" text;
