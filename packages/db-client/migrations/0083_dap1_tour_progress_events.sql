-- Digital Adoption Platform (DAP-1): per-user tour progress + append-only interaction
-- events. Owned by event-service (ADR-3 in ERP-PLANNING/DAP-Planning/01_ARCHITECTURE.md —
-- platform capability, not a business domain; direct-write like search_analytics, not
-- outbox/Kafka — wrong weight class for per-step UI telemetry).
CREATE TABLE IF NOT EXISTS "tour_progress" (
  "id" bigserial PRIMARY KEY,
  "tenant_id" integer NOT NULL,
  "user_id" integer NOT NULL,
  "tour_id" varchar(100) NOT NULL,
  "tour_version" integer NOT NULL,
  "status" varchar(20) NOT NULL DEFAULT 'in_progress',
  "current_step_id" varchar(100),
  "completed_at" timestamp with time zone,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "tour_progress_tenant_user_tour" UNIQUE ("tenant_id", "user_id", "tour_id")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_tour_progress_tenant_user" ON "tour_progress"("tenant_id", "user_id");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "tour_events" (
  "id" bigserial PRIMARY KEY,
  "tenant_id" integer NOT NULL,
  "user_id" integer NOT NULL,
  "tour_id" varchar(100) NOT NULL,
  "tour_version" integer NOT NULL,
  "step_id" varchar(100),
  "event_type" varchar(30) NOT NULL,
  "occurred_at" timestamp with time zone NOT NULL DEFAULT now(),
  "metadata" jsonb DEFAULT '{}'::jsonb
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_tour_events_tenant_tour" ON "tour_events"("tenant_id", "tour_id", "occurred_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_tour_events_tenant_user" ON "tour_events"("tenant_id", "user_id", "occurred_at");
