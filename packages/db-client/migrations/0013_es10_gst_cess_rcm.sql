-- ES-10 Migration: GST Cess columns + RCM (Reverse Charge Mechanism) support

-- Step 1: Cess on sales invoices
ALTER TABLE "invoices"
  ADD COLUMN IF NOT EXISTS "cess_amount" numeric(15, 2) NOT NULL DEFAULT '0';

ALTER TABLE "invoice_lines"
  ADD COLUMN IF NOT EXISTS "cess_rate" numeric(5, 2) NOT NULL DEFAULT '0',
  ADD COLUMN IF NOT EXISTS "cess_amount" numeric(15, 2) NOT NULL DEFAULT '0';

-- Step 2: Cess + RCM on purchase GRNs
ALTER TABLE "grns"
  ADD COLUMN IF NOT EXISTS "cess_amount" numeric(15, 2) NOT NULL DEFAULT '0',
  ADD COLUMN IF NOT EXISTS "rcm_applicable" boolean NOT NULL DEFAULT false;

ALTER TABLE "grn_lines"
  ADD COLUMN IF NOT EXISTS "cess_rate" numeric(5, 2) NOT NULL DEFAULT '0',
  ADD COLUMN IF NOT EXISTS "cess_amount" numeric(15, 2) NOT NULL DEFAULT '0';

-- Step 3: Supplier registration status — unregistered vendors trigger RCM
ALTER TABLE "suppliers"
  ADD COLUMN IF NOT EXISTS "is_registered" boolean NOT NULL DEFAULT true;

-- Note: RCM Tax Input Credit (1330) / RCM Tax Payable (2330) accounts were added to
-- DEFAULT_ACCOUNTS (apps/accounting-service/src/domain/default-accounts.ts). New tenants
-- get them automatically at provisioning. Existing tenants must re-call
-- POST /api/v2/accounts/seed-defaults (idempotent — onConflictDoNothing) to pick them up.
