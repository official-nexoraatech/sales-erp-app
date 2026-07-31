-- CRM-ROADMAP Phase 4, Feature 1 (Field Sales / Distributor CRM).
CREATE TABLE IF NOT EXISTS "crm_visit_routes" (
  "id" bigserial PRIMARY KEY,
  "tenant_id" integer NOT NULL,
  "name" varchar(200) NOT NULL,
  "assigned_to" integer NOT NULL,
  "territory_id" integer,
  "scheduled_date" timestamptz NOT NULL,
  "status" varchar(20) NOT NULL DEFAULT 'PLANNED',
  "created_by" integer NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS "idx_crm_visit_routes_tenant"
  ON "crm_visit_routes" ("tenant_id", "assigned_to", "scheduled_date");

CREATE TABLE IF NOT EXISTS "crm_visit_route_stops" (
  "id" bigserial PRIMARY KEY,
  "tenant_id" integer NOT NULL,
  "route_id" integer NOT NULL,
  "customer_id" integer NOT NULL,
  "sequence_number" integer NOT NULL,
  "status" varchar(20) NOT NULL DEFAULT 'PENDING',
  "visit_id" integer
);
CREATE INDEX IF NOT EXISTS "idx_crm_visit_route_stops_route"
  ON "crm_visit_route_stops" ("route_id", "tenant_id");

CREATE TABLE IF NOT EXISTS "crm_field_visits" (
  "id" bigserial PRIMARY KEY,
  "tenant_id" integer NOT NULL,
  "rep_user_id" integer NOT NULL,
  "customer_id" integer NOT NULL,
  "route_stop_id" integer,
  "check_in_at" timestamptz NOT NULL DEFAULT now(),
  "check_in_lat" decimal(9,6),
  "check_in_lng" decimal(9,6),
  "check_out_at" timestamptz,
  "check_out_lat" decimal(9,6),
  "check_out_lng" decimal(9,6),
  "outcome" varchar(20),
  "notes" text,
  "client_operation_id" varchar(100),
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "crm_field_visits_tenant_client_operation_id" UNIQUE ("tenant_id", "client_operation_id")
);
CREATE INDEX IF NOT EXISTS "idx_crm_field_visits_rep"
  ON "crm_field_visits" ("tenant_id", "rep_user_id", "check_in_at");
CREATE INDEX IF NOT EXISTS "idx_crm_field_visits_customer"
  ON "crm_field_visits" ("customer_id", "tenant_id");
