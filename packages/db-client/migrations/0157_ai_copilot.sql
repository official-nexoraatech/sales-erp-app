-- AI Copilot (ai-copilot-service, 17th microservice). See
-- packages/db-client/src/schema/copilot.ts.
CREATE TABLE IF NOT EXISTS "copilot_conversations" (
  "id" bigserial PRIMARY KEY,
  "tenant_id" integer NOT NULL,
  "user_id" integer NOT NULL,
  "title" varchar(200),
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "idx_copilot_conv_tenant_user" ON "copilot_conversations" ("tenant_id", "user_id", "updated_at");

CREATE TABLE IF NOT EXISTS "copilot_messages" (
  "id" bigserial PRIMARY KEY,
  "tenant_id" integer NOT NULL,
  "conversation_id" integer NOT NULL,
  "role" varchar(20) NOT NULL,
  "content" text NOT NULL,
  "tool_calls" jsonb,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "idx_copilot_msg_conversation" ON "copilot_messages" ("conversation_id", "created_at");
