-- CP-8 (Campaign Management Platform initiative): Enterprise Scale-out.
-- Additive only, no FK constraints (see CP-1 completion report for the repo-wide convention).

-- Store/branch-scoped campaigns — nullable: NULL means tenant-wide (today's behavior for every
-- existing campaign), a specific branch_id scopes both who can create/view it (getBranchScope,
-- mirroring invoices.branch_id) and which customers it can target (resolveRecipients filters by
-- the customer's own branch when set).
ALTER TABLE "campaigns" ADD COLUMN "branch_id" integer;
CREATE INDEX "idx_campaigns_branch" ON "campaigns" ("branch_id", "tenant_id");

-- Configurable sender identity per tenant/channel — falls back to the existing env-configured
-- global default (MSG91/SendGrid/Meta credentials) when a tenant has not configured one for a
-- given channel.
CREATE TABLE "tenant_sender_identity" (
  "id" bigserial PRIMARY KEY,
  "tenant_id" integer NOT NULL,
  "channel" varchar(20) NOT NULL,
  "sender_name" varchar(200) NOT NULL,
  "sender_address_or_number" varchar(200) NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX "tenant_sender_identity_unique" ON "tenant_sender_identity" ("tenant_id", "channel");

-- Outbound webhook subscriptions — third-party CRM/marketing tools register a target_url and
-- the campaign lifecycle event types they want (e.g. ["CAMPAIGN_SENT", "CAMPAIGN_CANCELLED"]).
CREATE TABLE "campaign_webhook_subscriptions" (
  "id" bigserial PRIMARY KEY,
  "tenant_id" integer NOT NULL,
  "target_url" text NOT NULL,
  "events" jsonb NOT NULL,
  "secret" varchar(200) NOT NULL,
  "is_active" boolean NOT NULL DEFAULT true,
  "created_by" integer NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX "idx_campaign_webhook_subscriptions_tenant" ON "campaign_webhook_subscriptions" ("tenant_id", "is_active");

-- Per-subscriber delivery queue/log — enqueued synchronously (cheap INSERT, no outbound I/O) at
-- the same point CampaignService already fires lifecycle events, dispatched asynchronously by
-- WebhookDispatchWorker (poll loop modeled on event-service's OutboxRelayWorker: SELECT ... FOR
-- UPDATE SKIP LOCKED, HTTP POST happens outside the transaction, retry_count/status track
-- outcome). Keeping outbound HTTP off the campaign-send critical path mirrors the CP-6 decision
-- to use the outbox/Kafka pattern instead of a synchronous cross-service HTTP callback.
CREATE TABLE "campaign_webhook_deliveries" (
  "id" bigserial PRIMARY KEY,
  "tenant_id" integer NOT NULL,
  "subscription_id" integer NOT NULL,
  "event_type" varchar(50) NOT NULL,
  "campaign_id" integer NOT NULL,
  "payload" jsonb NOT NULL,
  "status" varchar(20) NOT NULL DEFAULT 'PENDING',
  "attempt_count" integer NOT NULL DEFAULT 0,
  "last_error" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "sent_at" timestamptz
);
CREATE INDEX "idx_campaign_webhook_deliveries_status" ON "campaign_webhook_deliveries" ("status", "created_at");
