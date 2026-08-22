# 08 — Permissions & RBAC

## 1. New permission constants

`packages/shared-types/src/permissions.ts` — add, adjacent to the existing `INVENTORY_*`/`ITEM_*` section (matching the repo's existing "group by resource, commented sections" convention, `01-current-state.md` §4):

```ts
BATCH_VIEW: 'BATCH_VIEW',
BATCH_CONFIGURE: 'BATCH_CONFIGURE',
```

`BATCH_VIEW` gates `GET /inventory/near-expiry-stock`. `BATCH_CONFIGURE` gates setting `fefoEnabled: true` on an item — this needs its own permission check **in addition to** the existing `ITEM_CREATE`/`ITEM_EDIT` checks already on those routes (a user might legitimately edit items but not be trusted to turn on batch tracking, e.g. a junior inventory clerk vs. the inventory manager) — added as a second `requirePermission`-style check only exercised when the field is present in the request, mirroring the same "conditional, in-handler" pattern as the capability check itself (`05-service-impact.md` §1).

## 2. Role defaults (code, for new tenants)

`apps/tenant-service/src/rbac/role-defaults.ts`, `ROLE_DEFAULTS`:

- `INVENTORY_MANAGER`: add both `BATCH_VIEW`, `BATCH_CONFIGURE`.
- `OWNER`, `ADMIN`: add both (existing convention — these roles hold the full permission superset already, confirmed by reading the file's existing entries for other recently-added permissions).
- `PURCHASE_MANAGER`: add `BATCH_VIEW` only (needs visibility into near-expiry stock for reorder decisions; configuring which items are batch-tracked is an inventory-management decision, not a purchasing one).
- No other role.

## 3. The critical, evidence-based risk: `ROLE_DEFAULTS` does not reach existing tenants

This is a previously-documented, recurring repo pattern (session memory: `rbac_dead_permission_constant_pattern`, "role-defaults.ts grants unchecked constant; recurs often") — re-confirmed by direct code reading this session: `ROLE_DEFAULTS` is imported only by `TenantProvisioner.ts`/`BillingService.ts` (`01-current-code-evidence.md`-adjacent grep, `apps/tenant-service/src/domain/`), both **provisioning-time-only** call sites. Existing tenants' actual role→permission assignments live in `auth-service`'s own role storage (`apps/auth-service/src/domain/roles.ts`, `routes/roles.ts`), populated once at that tenant's provisioning and modified only by explicit role-management actions afterward. Adding `BATCH_VIEW`/`BATCH_CONFIGURE` to `ROLE_DEFAULTS` alone would grant the permission to **future** tenants' `INVENTORY_MANAGER`/`OWNER`/`ADMIN` roles only — every existing tenant's `INVENTORY_MANAGER` would have a role that _should_ grant `BATCH_CONFIGURE` per the updated code, but doesn't, until an explicit backfill runs.

**This phase's migration (`06-database-impact.md` §1 item 2) must perform that backfill** — the exact class of gap the memory file describes recurring. This is called out explicitly here (not left implicit) so the implementation session doesn't repeat the omission.

## 4. Frontend permission gating

`apps/web-frontend`'s existing `hasPermission(PERMISSIONS.BATCH_VIEW)`/`hasPermission(PERMISSIONS.BATCH_CONFIGURE)` checks (same mechanism every other permission-gated UI element already uses, JWT-decoded client-side per `00-roadmap-analysis.md` §H.5) — no new frontend permission mechanism needed.

## 5. What does NOT change

- No existing permission constant renamed.
- No existing role's existing permission set reduced.
- `RESOURCE_ACTION` naming convention followed exactly (`BATCH_<ACTION>`, matching `ITEM_<ACTION>`/`GRN_<ACTION>` precedent) — no deviation from `07-rbac-model.md`'s ADR-04.
