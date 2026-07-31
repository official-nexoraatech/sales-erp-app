-- CRM-ROADMAP Phase 2, Feature 5 — Omnichannel Communication Hub.
--
-- A two-way inbox. Inbound provider webhooks write here, keyed by (tenant, channel,
-- external_address) so every reply from the same customer on the same channel threads into one
-- conversation. providerMessageId is the idempotency key a retried inbound webhook collides
-- against — Postgres treats multiple NULLs as distinct under a plain UNIQUE constraint, so
-- OUTBOUND/INTERNAL messages (which have none) need no partial index.
CREATE TABLE IF NOT EXISTS "crm_conversations" (
  "id" bigserial PRIMARY KEY,
  "tenant_id" integer NOT NULL,
  "customer_id" integer,
  "channel" varchar(20) NOT NULL,
  "external_address" varchar(200) NOT NULL,
  "status" varchar(20) NOT NULL DEFAULT 'OPEN',
  "assigned_to" integer,
  "last_message_at" timestamp with time zone NOT NULL DEFAULT now(),
  "last_message_preview" varchar(300),
  "unread_count" integer NOT NULL DEFAULT 0,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "crm_conversations_tenant_channel_address_unique" ON "crm_conversations" ("tenant_id", "channel", "external_address");
CREATE INDEX IF NOT EXISTS "idx_crm_conversations_customer" ON "crm_conversations" ("tenant_id", "customer_id", "last_message_at");

CREATE TABLE IF NOT EXISTS "crm_conversation_messages" (
  "id" bigserial PRIMARY KEY,
  "tenant_id" integer NOT NULL,
  "conversation_id" integer NOT NULL,
  "direction" varchar(10) NOT NULL,
  "body" text NOT NULL,
  "media_url" text,
  "provider" varchar(20),
  "provider_message_id" varchar(200),
  "sent_by" integer,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "crm_conversation_messages_provider_message_unique" ON "crm_conversation_messages" ("provider", "provider_message_id");
CREATE INDEX IF NOT EXISTS "idx_crm_conversation_messages_conversation" ON "crm_conversation_messages" ("conversation_id", "created_at");

CREATE TABLE IF NOT EXISTS "crm_canned_responses" (
  "id" bigserial PRIMARY KEY,
  "tenant_id" integer NOT NULL,
  "title" varchar(200) NOT NULL,
  "body" text NOT NULL,
  "channel" varchar(20),
  "created_by" integer NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "idx_crm_canned_responses_tenant" ON "crm_canned_responses" ("tenant_id", "channel");
