-- CRM-ROADMAP Phase 2, Feature 7 — Advanced Segmentation Engine.
--
-- customer_segments.filter_definition (existing jsonb) already accepts new operator names with
-- no schema change of its own. This is the ONE new table this feature adds — a nightly-refreshed
-- membership snapshot for segments using an expensive behavioral/RFM operator (07-PERFORMANCE-PLAN.md
-- §6). A plain static-field segment never gets a row here; live preview/ad-hoc queries always
-- recompute fresh via SegmentService regardless of this cache's contents.
CREATE TABLE IF NOT EXISTS "crm_segment_membership_cache" (
  "id" bigserial PRIMARY KEY,
  "tenant_id" integer NOT NULL,
  "segment_id" integer NOT NULL,
  "customer_id" integer NOT NULL,
  "refreshed_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "crm_segment_membership_cache_unique" ON "crm_segment_membership_cache" ("segment_id", "customer_id");
CREATE INDEX IF NOT EXISTS "idx_crm_segment_membership_cache_segment" ON "crm_segment_membership_cache" ("tenant_id", "segment_id");
