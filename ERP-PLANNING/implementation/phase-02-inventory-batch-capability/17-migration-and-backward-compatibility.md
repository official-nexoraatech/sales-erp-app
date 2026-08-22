# 17 — Migration & Backward Compatibility

## 1. Zero-behavior-change guarantee for every existing tenant, stated precisely

| Existing behavior          | Before this phase                               | After this phase                                                                                                                                                                                                                                                                                                                                                                                                 |
| -------------------------- | ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GRN batch/expiry capture   | Unconditional whenever GRN line provides it     | **Unchanged** — `GRNService.ts` untouched                                                                                                                                                                                                                                                                                                                                                                        |
| Near-expiry alerting       | Works, independent of `fefoEnabled`             | **Unchanged** — `nearExpiryAlert.job.ts` untouched                                                                                                                                                                                                                                                                                                                                                               |
| Stock consumption ordering | Pure FIFO by `receivedAt`, always               | **Unchanged for every existing item** — no existing item has `fefoEnabled: true` (impossible before this phase, `01-current-code-evidence.md` §3), so `consumeFifoLayers`'s new conditional branch is never taken for any pre-existing item until an admin explicitly opts one in                                                                                                                                |
| Item create/update         | `fefoEnabled` field doesn't exist in the schema | Field exists, optional, ignored (defaults `false`) if omitted — every existing integration/script calling these routes without the new field sees zero change                                                                                                                                                                                                                                                    |
| Navigation                 | No batch-related nav item                       | New item appears only for tenants with the capability enabled (global default `true`, per `06-database-impact.md` §2) **and** the user holding `BATCH_VIEW` — existing users without a role change see no new nav item even though the capability itself defaults on, since `INVENTORY_MANAGER`/`OWNER`/`ADMIN` are the only roles gaining the permission and the backfill (§2 below) is what actually grants it |

## 2. The one real "change," and why it's still safe

The permission backfill (`08-permissions-and-rbac.md` §3, `06-database-impact.md` §1 item 2) **does** change existing tenants' `INVENTORY_MANAGER`/`OWNER`/`ADMIN`/`PURCHASE_MANAGER` roles — they gain `BATCH_VIEW`/`BATCH_CONFIGURE` where they didn't have it before. This is a deliberate, necessary, and safe change: it only grants **visibility into a new, additive feature** (a nav item and an optional item-form field) — it does not remove any existing permission, does not change any existing route's authorization outcome for any existing permission, and does not expose any existing tenant's data differently. The affected users already held every other permission those roles carry; this is additive in the same sense the rest of the phase is additive.

## 3. Rollback

- Migration (`06-database-impact.md`): delete/revert — dev-phase, no real prod data (`project_dev_phase_no_data` memory); in a future prod context, `DELETE FROM feature_flags WHERE flag_key = 'inventory.batch.enabled'` + revert the permission grants.
- Code (all three services): revert the file-level changes (`21-file-level-change-plan.md`) — each change is additive/conditional, so reverting drops the new field/route/ordering-branch cleanly with no cleanup migration needed (no data was written that wouldn't already have been written by the unconditional GRN-capture path).
- Nav: remove the `capabilityKey`-tagged item — instant, no backend dependency.

## 4. Existing 4 `vertical` call sites — untouched

This phase never reads or writes `tenants.vertical`, `business_type_id`, or any Business Profile concept — confirmed no file this phase touches overlaps with `TenantProvisioner.ts`, `default-accounts.ts`, `vertical-defaults.ts`, or the scheduler-internal route (`01-current-state.md` §3's 4 known call sites). Zero interaction with that migration track.

## 5. Migration numbering

Re-verify the actual highest existing migration number **immediately before authoring** (not from this document, which may be stale by implementation time) — per `17-risk-register.md` R7's already-documented recurring risk and `concurrent_sessions_on_same_repo`'s precedent.
