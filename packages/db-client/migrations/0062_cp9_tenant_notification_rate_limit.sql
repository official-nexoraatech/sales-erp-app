-- CP-9 follow-up: per-tenant configurable notification rate limit, closing the R14 gap
-- (CampaignService.send() sharing notification-service's fixed 200/min limit across every
-- tenant combined, since internal-key-authenticated calls have no JWT for the existing
-- tenant-aware rate limiter to key on). NULL = platform default (200/min), unchanged behavior
-- for every tenant that doesn't explicitly configure a higher (or lower) limit.
ALTER TABLE "tenant_communication_settings" ADD COLUMN "notification_rate_limit_per_minute" integer;
