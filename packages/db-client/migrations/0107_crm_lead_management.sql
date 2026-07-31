-- CRM-ROADMAP Phase 1, Feature 2 — Lead Management & Capture.
--
-- Currently zero pre-purchase visibility: every customer record starts as a fully-formed
-- Customer, day one. crm_leads captures interest before that point (stage NEW -> CONTACTED ->
-- QUALIFIED -> CONVERTED/LOST), with an activity log and configurable round-robin/load-based
-- assignment rules.
CREATE TABLE IF NOT EXISTS "crm_leads" (
  "id" bigserial PRIMARY KEY,
  "tenant_id" integer NOT NULL,
  "display_name" varchar(200),
  "company_name" varchar(300),
  "phone" varchar(20) NOT NULL,
  "email" varchar(255),
  "source" varchar(20) NOT NULL DEFAULT 'OTHER',
  "stage" varchar(20) NOT NULL DEFAULT 'NEW',
  "assigned_to" integer,
  "branch_id" integer,
  "is_b2b" boolean NOT NULL DEFAULT false,
  "converted_customer_id" integer,
  "converted_account_id" integer,
  "converted_at" timestamp with time zone,
  "lost_reason" text,
  "notes" text,
  "created_by" integer,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS "idx_crm_leads_tenant_stage" ON "crm_leads" ("tenant_id", "stage", "assigned_to");
CREATE INDEX IF NOT EXISTS "idx_crm_leads_tenant_created" ON "crm_leads" ("tenant_id", "created_at");
CREATE INDEX IF NOT EXISTS "idx_crm_leads_phone" ON "crm_leads" ("phone", "tenant_id");

CREATE TABLE IF NOT EXISTS "crm_lead_activities" (
  "id" bigserial PRIMARY KEY,
  "tenant_id" integer NOT NULL,
  "lead_id" integer NOT NULL,
  "activity_type" varchar(20) NOT NULL,
  "description" text,
  "from_stage" varchar(20),
  "to_stage" varchar(20),
  "actor_id" integer,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "idx_crm_lead_activities_lead" ON "crm_lead_activities" ("lead_id", "created_at");

CREATE TABLE IF NOT EXISTS "crm_assignment_rules" (
  "id" bigserial PRIMARY KEY,
  "tenant_id" integer NOT NULL,
  "name" varchar(200) NOT NULL,
  "strategy" varchar(20) NOT NULL DEFAULT 'ROUND_ROBIN',
  "assignee_user_ids" jsonb NOT NULL DEFAULT '[]',
  "branch_id" integer,
  "is_active" boolean NOT NULL DEFAULT true,
  "last_assigned_index" integer NOT NULL DEFAULT -1,
  "created_by" integer NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS "idx_crm_assignment_rules_tenant" ON "crm_assignment_rules" ("tenant_id", "is_active", "branch_id");

-- Reverse pointer for attribution — set only when a customer was created via lead conversion.
ALTER TABLE "customers"
  ADD COLUMN IF NOT EXISTS "converted_from_lead_id" integer;
