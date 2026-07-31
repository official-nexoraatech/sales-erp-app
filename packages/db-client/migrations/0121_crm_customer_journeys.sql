-- CRM-ROADMAP Phase 2, Feature 2 — Visual Customer Journey Builder.
--
-- Journeys compile to the same scheduler-cron mechanism already driving
-- campaign_automation_rules (AR-3); every ACTION step sends via the existing
-- CampaignService.send(), never a second send mechanism. crm_journey_enrollments'
-- UNIQUE(journey_id, customer_id) is a deliberate, DB-enforced "no accidental re-entry" rule,
-- not just an application-logic check.
CREATE TABLE IF NOT EXISTS "crm_journeys" (
  "id" bigserial PRIMARY KEY,
  "tenant_id" integer NOT NULL,
  "name" varchar(200) NOT NULL,
  "status" varchar(20) NOT NULL DEFAULT 'DRAFT',
  "segment_id" integer,
  "published_at" timestamp with time zone,
  "created_by" integer NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS "idx_crm_journeys_tenant_status" ON "crm_journeys" ("tenant_id", "status");

CREATE TABLE IF NOT EXISTS "crm_journey_steps" (
  "id" bigserial PRIMARY KEY,
  "tenant_id" integer NOT NULL,
  "journey_id" integer NOT NULL,
  "parent_step_id" integer,
  "branch_path" varchar(5),
  "sequence" integer NOT NULL,
  "step_type" varchar(20) NOT NULL,
  "delay_days" integer,
  "channel" varchar(20),
  "message_template" text,
  "branch_condition_type" varchar(30),
  "branch_within_days" integer,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "idx_crm_journey_steps_journey" ON "crm_journey_steps" ("journey_id", "parent_step_id", "branch_path", "sequence");

CREATE TABLE IF NOT EXISTS "crm_journey_enrollments" (
  "id" bigserial PRIMARY KEY,
  "tenant_id" integer NOT NULL,
  "journey_id" integer NOT NULL,
  "customer_id" integer NOT NULL,
  "status" varchar(20) NOT NULL DEFAULT 'ACTIVE',
  "current_step_id" integer,
  "next_evaluation_at" timestamp with time zone,
  "current_step_entered_at" timestamp with time zone,
  "exit_reason" varchar(30),
  "enrolled_at" timestamp with time zone NOT NULL DEFAULT now(),
  "completed_at" timestamp with time zone,
  "exited_at" timestamp with time zone,
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 0
);

CREATE UNIQUE INDEX IF NOT EXISTS "crm_journey_enrollments_journey_customer_unique" ON "crm_journey_enrollments" ("journey_id", "customer_id");
CREATE INDEX IF NOT EXISTS "idx_crm_journey_enrollments_due" ON "crm_journey_enrollments" ("tenant_id", "status", "next_evaluation_at");

CREATE TABLE IF NOT EXISTS "crm_journey_step_events" (
  "id" bigserial PRIMARY KEY,
  "tenant_id" integer NOT NULL,
  "journey_id" integer NOT NULL,
  "enrollment_id" integer NOT NULL,
  "step_id" integer,
  "event_type" varchar(20) NOT NULL,
  "metadata" jsonb,
  "occurred_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "idx_crm_journey_step_events_enrollment" ON "crm_journey_step_events" ("enrollment_id", "occurred_at");
