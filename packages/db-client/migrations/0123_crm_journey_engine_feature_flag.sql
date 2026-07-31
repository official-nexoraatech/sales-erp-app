-- CRM-ROADMAP Phase 2, Feature 2 (Visual Customer Journey Builder). Per the roadmap's own
-- Rollback plan, this is "the roadmap's recommended flag-gated feature given its blast radius
-- if a bad journey definition runs at scale" — seeded disabled by default (a tenant must
-- explicitly opt in), matching ES-28's existing re-run-safe seeding pattern (NULL tenant_id
-- rows are never "equal" for uniqueness purposes, so ON CONFLICT can't dedupe these).
INSERT INTO "feature_flags" ("tenant_id", "flag_key", "enabled")
SELECT NULL, 'crm.journey_engine.enabled', false
WHERE NOT EXISTS (
  SELECT 1 FROM "feature_flags" f WHERE f."tenant_id" IS NULL AND f."flag_key" = 'crm.journey_engine.enabled'
);
