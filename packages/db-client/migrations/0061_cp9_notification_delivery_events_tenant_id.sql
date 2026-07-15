-- CP-9 (Campaign Management Platform initiative) cross-phase consistency finding: every other
-- CRM/campaign/notification table has a direct tenant_id column; notification_delivery_events
-- (added CP-6) only had tenant isolation implicit via a join to notification_log. Zero rows
-- exist in this dev environment, so this is a direct NOT NULL add, not a nullable+backfill.
ALTER TABLE "notification_delivery_events" ADD COLUMN "tenant_id" integer NOT NULL;
CREATE INDEX "idx_notification_delivery_events_tenant" ON "notification_delivery_events" ("tenant_id");
