-- Distribution vertical, Phase A (Business Profile & Provisioning) — adds the DISTRIBUTION
-- business_types row under the existing COMMERCE industry (same industry CLOTH_RETAIL/GROCERY
-- use). Data-only, idempotent (business_types.code has a unique constraint). Confirmed decisions
-- 2026-08-20 (see ERP-PLANNING/DISTRIBUTION-ROADMAP/03-capability-rbac-model.md): INVENTORY_BATCH
-- defaults on for this vertical, matching Grocery's own default_capability_keys pattern.

INSERT INTO business_types (code, industry_id, name, default_capability_keys, default_regulatory_pack)
SELECT 'DISTRIBUTION', id, 'Distribution / Wholesale', '["INVENTORY_BATCH"]'::jsonb, 'INDIA_GST'
FROM industries WHERE code = 'COMMERCE'
ON CONFLICT (code) DO NOTHING;
