-- M-6 fix: delivery_challans.status already had a CANCELLED enum value, but no code path ever
-- set it — DeliveryChallanService had no cancel() method at all. Adds the same
-- cancelled_at/cancellation_reason columns the invoices table already uses for its own cancel
-- flow, for consistency.

ALTER TABLE "delivery_challans" ADD COLUMN IF NOT EXISTS "cancelled_at" timestamp with time zone;
ALTER TABLE "delivery_challans" ADD COLUMN IF NOT EXISTS "cancellation_reason" text;
ALTER TABLE "delivery_challans" ADD COLUMN IF NOT EXISTS "cancelled_by" integer;
