-- PG-044: multi-state Professional Tax slabs. Global reference data, NOT tenant-scoped —
-- PT is a state statute identical for every tenant with employees in a given state, same
-- pattern as hsn_master (global GST/HSN reference, no tenant_id). Seeded, not tenant-editable
-- in v1. States with no PT law (Haryana, UP, Rajasthan, Delhi, ...) intentionally have zero
-- rows here; PTSlabService.getSlabsForState returns [] and computePT(...) returns 0 for them.
--
-- income_upto/monthly_amount are monthly figures. Two seeded states' source data is not
-- natively monthly and was normalized to a monthly-equivalent that reproduces the correct
-- period liability when deducted every payroll run:
--   - Tamil Nadu (Chennai Corporation) levies PT half-yearly; thresholds and amounts below
--     are the sourced half-yearly figures divided by 6 and rounded to the nearest rupee.
--   - Madhya Pradesh computes PT on annual income but deducts monthly (with a slightly
--     larger final-month deduction to hit the annual cap); amounts below are the sourced
--     annual liability divided by 12 and rounded, ignoring that last-month adjustment.
-- Both are flagged here as approximations of the true cadence; a future PTSlabService
-- enhancement (periodicity-aware slabs) should replace this normalization if exact
-- month-by-month figures become a requirement.
CREATE TABLE IF NOT EXISTS "pt_slabs" (
  "id" bigserial PRIMARY KEY,
  "state_code" varchar(2) NOT NULL,
  "slab_order" integer NOT NULL,
  "income_upto" numeric(10, 2),
  "monthly_amount" numeric(10, 2) NOT NULL,
  "effective_from" date NOT NULL,
  "effective_to" date,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "idx_pt_slabs_state_effective" ON "pt_slabs" ("state_code", "effective_from", "effective_to");

-- Maharashtra — preserved exactly from the pre-existing hardcoded PT_SLABS constant
-- (regression safety: no existing tenant's Maharashtra PT figures may shift).
INSERT INTO "pt_slabs" ("state_code", "slab_order", "income_upto", "monthly_amount", "effective_from") VALUES
  ('MH', 1, 10000, 0, '2000-01-01'),
  ('MH', 2, 15000, 150, '2000-01-01'),
  ('MH', 3, NULL, 200, '2000-01-01');

-- Karnataka
INSERT INTO "pt_slabs" ("state_code", "slab_order", "income_upto", "monthly_amount", "effective_from") VALUES
  ('KA', 1, 24999, 0, '2000-01-01'),
  ('KA', 2, NULL, 200, '2000-01-01');

-- West Bengal
INSERT INTO "pt_slabs" ("state_code", "slab_order", "income_upto", "monthly_amount", "effective_from") VALUES
  ('WB', 1, 10000, 0, '2000-01-01'),
  ('WB', 2, 15000, 110, '2000-01-01'),
  ('WB', 3, 25000, 130, '2000-01-01'),
  ('WB', 4, 40000, 150, '2000-01-01'),
  ('WB', 5, NULL, 200, '2000-01-01');

-- Tamil Nadu (Chennai Corporation slabs — see file header note on half-yearly normalization)
INSERT INTO "pt_slabs" ("state_code", "slab_order", "income_upto", "monthly_amount", "effective_from") VALUES
  ('TN', 1, 3500, 0, '2000-01-01'),
  ('TN', 2, 5000, 23, '2000-01-01'),
  ('TN', 3, 7500, 53, '2000-01-01'),
  ('TN', 4, 10000, 115, '2000-01-01'),
  ('TN', 5, 12500, 171, '2000-01-01'),
  ('TN', 6, NULL, 208, '2000-01-01');

-- Andhra Pradesh
INSERT INTO "pt_slabs" ("state_code", "slab_order", "income_upto", "monthly_amount", "effective_from") VALUES
  ('AP', 1, 15000, 0, '2000-01-01'),
  ('AP', 2, 20000, 150, '2000-01-01'),
  ('AP', 3, NULL, 200, '2000-01-01');

-- Telangana (Professional Tax Act 1987 shared with Andhra Pradesh pre-bifurcation — same slabs)
INSERT INTO "pt_slabs" ("state_code", "slab_order", "income_upto", "monthly_amount", "effective_from") VALUES
  ('TS', 1, 15000, 0, '2000-01-01'),
  ('TS', 2, 20000, 150, '2000-01-01'),
  ('TS', 3, NULL, 200, '2000-01-01');

-- Gujarat
INSERT INTO "pt_slabs" ("state_code", "slab_order", "income_upto", "monthly_amount", "effective_from") VALUES
  ('GJ', 1, 2999, 0, '2000-01-01'),
  ('GJ', 2, 5999, 20, '2000-01-01'),
  ('GJ', 3, 8999, 80, '2000-01-01'),
  ('GJ', 4, 11999, 150, '2000-01-01'),
  ('GJ', 5, NULL, 200, '2000-01-01');

-- Madhya Pradesh (see file header note on annual-to-monthly normalization)
INSERT INTO "pt_slabs" ("state_code", "slab_order", "income_upto", "monthly_amount", "effective_from") VALUES
  ('MP', 1, 18750, 0, '2000-01-01'),
  ('MP', 2, 25000, 125, '2000-01-01'),
  ('MP', 3, 33333, 167, '2000-01-01'),
  ('MP', 4, NULL, 208, '2000-01-01');

-- Assam
INSERT INTO "pt_slabs" ("state_code", "slab_order", "income_upto", "monthly_amount", "effective_from") VALUES
  ('AS', 1, 10000, 0, '2000-01-01'),
  ('AS', 2, 15000, 150, '2000-01-01'),
  ('AS', 3, 25000, 180, '2000-01-01'),
  ('AS', 4, NULL, 208, '2000-01-01');

-- No rows for Haryana (HR), Uttar Pradesh (UP), Rajasthan (RJ), Delhi (DL) — these levy no PT;
-- PTSlabService.getSlabsForState returns [] for them and computePT(...) resolves to 0.
