-- ES-28 — Global feature flag defaults (moved from infrastructure/docker/postgres/init.sql,
-- which raced with this migration's own table-creation step in 0000_worried_blue_marvel)

-- NULL tenant_id rows are never "equal" for uniqueness purposes, so ON CONFLICT
-- can't dedupe these — use an explicit existence check instead for re-run safety.
INSERT INTO "feature_flags" ("tenant_id", "flag_key", "enabled")
SELECT NULL, v.flag_key, v.enabled
FROM (VALUES
  ('pos.enabled', true),
  ('gst.e-invoice.enabled', false),
  ('gst.e-way-bill.enabled', false),
  ('multi-branch.enabled', false),
  ('inventory.fabric-rolls.enabled', false),
  ('inventory.variants.enabled', true),
  ('inventory.reservations.enabled', true),
  ('sales.quotations.enabled', true),
  ('sales.loyalty.enabled', false),
  ('hr.alterations.enabled', true),
  ('hr.tailoring.enabled', false),
  ('finance.double-entry.enabled', true),
  ('finance.tds.enabled', false),
  ('integrations.whatsapp.enabled', false),
  ('integrations.sms.enabled', true),
  ('integrations.payment-gateway.enabled', false),
  ('platform.ai.enabled', false),
  ('platform.offline.enabled', false)
) AS v(flag_key, enabled)
WHERE NOT EXISTS (
  SELECT 1 FROM "feature_flags" f WHERE f."tenant_id" IS NULL AND f."flag_key" = v.flag_key
);
