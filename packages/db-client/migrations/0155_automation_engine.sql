-- Workflow Automation Engine (automation-service, 16th microservice): extends the existing
-- WorkflowEngine schema (workflow_definitions) with trigger types beyond EVENT, and adds a
-- node-type-agnostic execution history table distinct from workflow_approvals (which stays
-- approval-node-shaped). See packages/db-client/src/schema/workflow.ts.
ALTER TABLE "workflow_definitions"
  ADD COLUMN IF NOT EXISTS "trigger_type" varchar(10) NOT NULL DEFAULT 'EVENT',
  ADD COLUMN IF NOT EXISTS "trigger_config" jsonb;

CREATE INDEX IF NOT EXISTS "idx_wf_def_tenant_trigger_type" ON "workflow_definitions" ("tenant_id", "trigger_type", "is_active");

CREATE TABLE IF NOT EXISTS "workflow_execution_history" (
  "id" bigserial PRIMARY KEY,
  "tenant_id" integer NOT NULL,
  "definition_id" integer NOT NULL,
  "triggered_by" varchar(10) NOT NULL,
  "status" varchar(20) NOT NULL DEFAULT 'RUNNING',
  "node_results" jsonb NOT NULL DEFAULT '[]',
  "trigger_payload" jsonb NOT NULL DEFAULT '{}',
  "error_message" text,
  "started_at" timestamp with time zone NOT NULL DEFAULT now(),
  "completed_at" timestamp with time zone
);
CREATE INDEX IF NOT EXISTS "idx_wf_exec_history_tenant_def" ON "workflow_execution_history" ("tenant_id", "definition_id");
CREATE INDEX IF NOT EXISTS "idx_wf_exec_history_tenant_started" ON "workflow_execution_history" ("tenant_id", "started_at");
