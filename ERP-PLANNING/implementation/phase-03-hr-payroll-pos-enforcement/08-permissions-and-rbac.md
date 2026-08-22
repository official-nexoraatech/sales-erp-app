# 08 — Permissions and RBAC

## Zero new permissions

Every permission constant this phase's routes check already exists: `PAYROLL_VIEW`, `PAYROLL_PROCESS` (`permissions.ts:259-260`), `POS_ACCESS`, `POS_OPEN_SHIFT`, `POS_CLOSE_SHIFT`, `POS_APPLY_DISCOUNT`, `POS_VOID_BILL`, `POS_CASH_DRAWER`, `POS_ZREPORT_VIEW`, `POS_ZREPORT_GENERATE`, `POS_MANAGE` (`permissions.ts:125-134, 569`). No `role-defaults.ts` change — every role that already holds these permissions keeps holding them; the capability gate is additive-and-independent, not a replacement for or narrowing of the permission check.

## Composition, unchanged from Phase 1/2B's established pattern

```
1. authenticate            — existing, unchanged
2. requireCapability(key)  — NEW for these 18 routes, existing mechanism
3. requirePermission(...)  — existing, unchanged
```

Two independent, composed checks, not merged into one (per `07-rbac-model.md` §4 and `21-capability-resolution-architecture.md`): a user can hold `PAYROLL_VIEW` while `HR_PAYROLL` is disabled for their tenant (denied with `CAPABILITY_NOT_ENABLED`, a clearer message than a generic `FORBIDDEN`), and a user can belong to a tenant with `POS` enabled while lacking `POS_ACCESS` themselves (denied with the existing, unchanged `FORBIDDEN`). This exact matrix (capability×permission, all four quadrants) is what Phase 1's `capability-guard-route.test.ts` already proves at the mechanism level — this phase's own route-level tests (`16-testing-strategy.md`) re-prove it specifically for these routes, not just trust the mechanism-level proof by extension.

## No change to `TENANT_SCOPED_PERMISSIONS` / wildcard roles

`OWNER`/`ADMIN`/`SUPER_ADMIN` derive their permission set from `Object.values(PERMISSIONS)` and are unaffected by this phase in the permission dimension — but **are** affected in the capability dimension exactly like every other role: even a `SUPER_ADMIN` user is denied `CAPABILITY_NOT_ENABLED` if the tenant's flag is off, since capability state is tenant-level, not role-level. This is a deliberate, existing Phase 1 property (confirmed by `capability-guard-route.test.ts`'s tenant-isolation test), not something this phase introduces or needs to re-verify from scratch — but worth restating since it's a common point of confusion ("why can't the admin see Payroll") that will surface in support the first time a tenant's flag is genuinely off.

## Registry `permissions` metadata gap (carried from `03-capability-definition.md`)

Not fixed by this phase (documentation-only field, unread by any runtime code) — noted here for completeness of the RBAC picture, not as an action item.
