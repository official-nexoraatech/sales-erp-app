# 15 — Migration Strategy

Incremental only. The current ERP continues functioning throughout — no phase requires downtime or a big-bang cutover. Every phase below is additive-first; nothing existing is removed until its replacement has been live and verified.

## Phase-independent principles

- New tables/columns are additive and nullable/defaulted — no existing query breaks mid-migration.
- `tenants.vertical` is never dropped in this plan — it becomes a synced, derived-compatible column (see step 2 below). Removing it is a future decision, out of scope, to be revisited only after every one of the 4 known call sites has migrated to `business_type_id` and a deprecation window has passed.
- Each phase ships with its own type-check/lint/test verification and, where financial/CRM-transactional code is touched (only Phase 5's CRM/O2C-split-adjacent work), git-stash isolation to confirm pre-existing failures aren't misattributed — matching the rigor already established in `reportsengine_dedup_and_crm_split_2026_08_16`.

## Migration steps for the Business Profile model specifically

1. **Add reference tables** — `industries`, `business_types` (new migration, next sequential number after the current highest, `0168_pos_day_end_settlements.sql` at time of writing — re-verify before authoring per the repo's own established convention, see `concurrent_sessions_on_same_repo` precedent). Seed `COMMERCE` industry with `CLOTH_RETAIL`/`GROCERY` business types — this is a data migration of what already exists in the `vertical` union, not new business modeling.
2. **Add `tenants.business_type_id`** (nullable FK). Backfill: `UPDATE tenants SET business_type_id = (SELECT id FROM business_types WHERE code = tenants.vertical)`. Add a thin write-path helper (`setTenantBusinessType()`) that writes both `business_type_id` and keeps `vertical` in sync (`vertical = business_types.code` for the given id) — so the 4 existing call sites (`TenantProvisioner`, `default-accounts.ts`, `vertical-defaults.ts`, `scheduler-internal.routes.ts`) keep reading `vertical` unmodified through the entire migration.
3. **Introduce `MODULE_REGISTRY`** (code-only, additive) and `business_types.default_module_keys` seed data mirroring today's `VERTICAL_DEFAULTS` content exactly — zero behavior change yet, since nothing reads the registry at request time until step 5.
4. **Add `requireModule()` preHandler and nav `moduleCode` filtering** — deployed disabled-by-default (no routes/nav items reference `moduleCode` yet), so this ships with zero behavior change, verified in isolation before any route adopts it.
5. **Adopt module gating on genuinely-optional modules first** (HR, Production — modules where "tenant doesn't have this" is already a real, observed state) — not on Commerce Core (Sales/Inventory/Accounting), which stays always-on and ungated. Roll out module-by-module, each independently verifiable and revertible (remove the `moduleCode` from that nav group / route tree).
6. **New business types** (Phase 10's chosen industry) are added purely via steps 1–5's now-established pattern — no further schema migration pattern needed.

## Rollback strategy per step

- Steps 1–3: pure additive schema/code — rollback is deleting the new migration file and re-running (dev-phase, no real data, per `project_dev_phase_no_data` memory — in a future prod context, rollback would be `DROP TABLE`/`DROP COLUMN`, safe since nothing depends on them yet).
- Step 4: feature-inert until step 5 — rollback is a no-op revert, nothing observes it.
- Step 5: per-module rollback — remove that module's `moduleCode` tag from nav/routes; the underlying feature-flag state is untouched, so re-adding it later is instant.

## Explicitly out of scope for this migration

- Dropping `tenants.vertical` (future decision, not this initiative).
- Multi-business-per-tenant (`04-domain-model.md` §6 — no evidence justifies it now).
- Enabling RLS (separate track, `13-security-architecture.md`).
- Finishing the CRM/O2C split (already fully scoped elsewhere — `reportsengine_dedup_and_crm_split_2026_08_16` — referenced as a dependency for Phase 10, not re-planned here).
- PG-027 Sessions 2–3 (billing/payment gateway).
