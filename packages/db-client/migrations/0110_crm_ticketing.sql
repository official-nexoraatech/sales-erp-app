-- CRM-ROADMAP Phase 1, Feature 4 — Support & Ticketing.
--
-- Replaces the untracked `customer_interactions` COMPLAINT type with a real ticket entity:
-- SLA, status machine, assignment, and a message thread with an internal-vs-customer-visible
-- split (the critical security/privacy boundary this feature adds).
CREATE TABLE IF NOT EXISTS "crm_tickets" (
  "id" bigserial PRIMARY KEY,
  "tenant_id" integer NOT NULL,
  "ticket_number" varchar(50) NOT NULL,
  "customer_id" integer NOT NULL,
  "subject" varchar(300) NOT NULL,
  "description" text,
  "ticket_type" varchar(30) NOT NULL DEFAULT 'OTHER',
  "priority" varchar(20) NOT NULL DEFAULT 'MEDIUM',
  "status" varchar(30) NOT NULL DEFAULT 'OPEN',
  "assigned_to" integer,
  "branch_id" integer,
  "linked_invoice_id" integer,
  "sla_due_at" timestamp with time zone,
  "sla_breached" boolean NOT NULL DEFAULT false,
  "resolved_at" timestamp with time zone,
  "closed_at" timestamp with time zone,
  "reopened_count" integer NOT NULL DEFAULT 0,
  "created_by" integer NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS "idx_crm_tickets_status_sla" ON "crm_tickets" ("tenant_id", "status", "sla_due_at");
CREATE INDEX IF NOT EXISTS "idx_crm_tickets_customer" ON "crm_tickets" ("tenant_id", "customer_id");

CREATE TABLE IF NOT EXISTS "crm_ticket_messages" (
  "id" bigserial PRIMARY KEY,
  "tenant_id" integer NOT NULL,
  "ticket_id" integer NOT NULL,
  "author_id" integer,
  "author_name" varchar(200) NOT NULL,
  "visibility" varchar(20) NOT NULL,
  "body" text NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "idx_crm_ticket_messages_ticket" ON "crm_ticket_messages" ("ticket_id", "created_at");

CREATE TABLE IF NOT EXISTS "crm_ticket_sla_rules" (
  "id" bigserial PRIMARY KEY,
  "tenant_id" integer NOT NULL,
  "ticket_type" varchar(30),
  "customer_tier" varchar(20),
  "priority" varchar(20),
  "sla_hours" integer NOT NULL,
  "is_active" boolean NOT NULL DEFAULT true,
  "created_by" integer NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS "idx_crm_ticket_sla_rules_tenant" ON "crm_ticket_sla_rules" ("tenant_id", "is_active");

CREATE TABLE IF NOT EXISTS "crm_csat_responses" (
  "id" bigserial PRIMARY KEY,
  "tenant_id" integer NOT NULL,
  "ticket_id" integer NOT NULL,
  "rating" integer NOT NULL,
  "comment" text,
  "recorded_by" integer NOT NULL,
  "responded_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "crm_csat_responses_ticket_unique" UNIQUE ("ticket_id")
);
