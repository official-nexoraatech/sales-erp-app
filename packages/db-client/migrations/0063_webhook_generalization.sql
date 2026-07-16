-- Generalizes the CP-8 campaign-only outbound webhook subsystem to any aggregate type
-- (invoice, payment, campaign, ...) so tenants can subscribe to non-campaign business events
-- too. Dev-phase, no production tenant data yet — a clean rename is safe (see project
-- convention); no data-preserving backfill needed beyond the aggregate_type default below.
ALTER TABLE "campaign_webhook_subscriptions" RENAME TO "webhook_subscriptions";
ALTER TABLE "campaign_webhook_deliveries" RENAME TO "webhook_deliveries";

ALTER TABLE "webhook_deliveries" RENAME COLUMN "campaign_id" TO "aggregate_id";
ALTER TABLE "webhook_deliveries" ADD COLUMN "aggregate_type" varchar(50);
UPDATE "webhook_deliveries" SET "aggregate_type" = 'CAMPAIGN' WHERE "aggregate_type" IS NULL;
ALTER TABLE "webhook_deliveries" ALTER COLUMN "aggregate_type" SET NOT NULL;

ALTER INDEX "idx_campaign_webhook_subscriptions_tenant" RENAME TO "idx_webhook_subscriptions_tenant";
ALTER INDEX "idx_campaign_webhook_deliveries_status" RENAME TO "idx_webhook_deliveries_status";

-- CRM_WEBHOOK_MANAGE is renamed to INTEGRATION_WEBHOOK_MANAGE (see @erp/types/permissions.ts) —
-- rename existing grants in place rather than backfilling a second permission.
UPDATE "role_permissions" SET "permission" = 'INTEGRATION_WEBHOOK_MANAGE' WHERE "permission" = 'CRM_WEBHOOK_MANAGE';
