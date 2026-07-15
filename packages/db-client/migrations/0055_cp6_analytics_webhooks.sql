-- CP-6 (Campaign Management Platform initiative): Analytics & A/B Testing — delivery webhooks.
-- Additive only, no FK constraints (see CP-1 completion report for the repo-wide convention).

-- notification-service: source-level idempotency for delivery-status webhooks. A provider
-- redelivering the same event (network retry, at-least-once delivery) must not double-process —
-- the UNIQUE constraint below is enforced via INSERT ... ON CONFLICT DO NOTHING at the
-- application layer; a conflict means "already handled, skip" (NFR-09).
CREATE TABLE "notification_delivery_events" (
  "id" bigserial PRIMARY KEY,
  "notification_log_id" integer NOT NULL,
  "provider" varchar(20) NOT NULL,
  "provider_event_id" varchar(200) NOT NULL,
  "event_type" varchar(30) NOT NULL,
  "received_at" timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX "notification_delivery_events_dedup" ON "notification_delivery_events" ("provider", "provider_event_id");
CREATE INDEX "idx_notification_delivery_events_log" ON "notification_delivery_events" ("notification_log_id");

-- sales-service: engagement/attribution timestamps on campaign_recipients. This phase only
-- populates delivered_at (via the webhook -> outbox -> consumer path below); opened_at/
-- clicked_at/converted_at are added now (nullable) so CP-6's remaining scope (click tracking,
-- open tracking, revenue attribution — all deferred, see CP-6 completion report) can populate
-- them later without another migration.
ALTER TABLE "campaign_recipients" ADD COLUMN "delivered_at" timestamptz;
ALTER TABLE "campaign_recipients" ADD COLUMN "opened_at" timestamptz;
ALTER TABLE "campaign_recipients" ADD COLUMN "clicked_at" timestamptz;
ALTER TABLE "campaign_recipients" ADD COLUMN "converted_at" timestamptz;
