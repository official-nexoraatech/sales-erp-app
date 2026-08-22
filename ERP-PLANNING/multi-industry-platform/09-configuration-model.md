# 09 — Configuration Model

## 1. Layers, from most-static to most-dynamic

1. **Industry/Business Type defaults** (new, code+seed-data: `business_types.default_module_keys`, `MODULE_REGISTRY`) — set once at provisioning, rarely changes after.
2. **Plan entitlement** (existing: `plan_entitlements` → copied to tenant) — changes on plan upgrade/downgrade.
3. **Feature flags** (existing: `feature_flags`, tenant-override or global) — changes via admin/ops action, hot-reloadable, no deploy needed.
4. **Tenant settings** (existing: `tenants.settings` jsonb, `organization_settings`) — free-form tenant-level config (branding, numeric limits) not modeled as flags because it's not boolean.
5. **User/role** (existing: RBAC) — per-user, changes on role assignment.

This is not a new layering scheme invented for this plan — it's the existing set of mechanisms (`01-current-state.md` §15–16), described explicitly so future work doesn't accidentally collapse two of them together (the brief's §6 warning against merging entitlement/permission/feature-flag/config).

## 2. No new "business configuration" subsystem

The brief's §6/§9 language ("Business Configuration") does not require a new table or service — it's satisfied by the existing `tenants.settings`/`organization_settings` jsonb columns plus the new `business_types` reference data. Introducing a generic metadata-driven config engine was explicitly ruled out by the brief (§24: "Do NOT build a universal metadata-driven low-code ERP") and is not justified by any gap found in `01-current-state.md` or `02-gap-analysis.md`.

## 3. Where new industry-specific config lives

Each module owns its own configuration shape inside its own service/schema (e.g. a future Hotel module's room-rate-plan config lives in that module's own tables, not in a shared generic config blob) — matching how, today, `organization_settings` holds cross-cutting org config while e.g. GST-specific config lives in `gst-service`'s own tables. This is a continuity decision (ADR-04 in `18-decisions.md`), not a new pattern.
