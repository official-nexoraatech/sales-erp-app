# 15 — Security Impact

## No new trust boundary

`industries`/`business_types` are global, admin-seeded reference data — no tenant-supplied input writes to them, ever, in this phase. `tenants.business_type_id` is written exactly once per tenant (at provisioning, via `setTenantBusinessType()`), from a value (`vertical`) that is already validated at the API boundary (`tenant.schemas.ts`'s existing Zod enum, unchanged). No new client-supplied field is trusted anywhere.

## Tenant isolation

Both new tables are intentionally **not** tenant-scoped (`04-domain-model.md` §6) — same governance model as `plan_entitlements`, which already has no `tenant_id` column and is already correctly excluded from `TenantScopedDatabase`'s auto-filtering. No new isolation mechanism needed; the existing pattern already covers this shape of data correctly.

## No new attack surface

Zero new routes (`07-api-contracts.md`), zero new permission, zero new header, zero new AI-reachable surface (`14-ai-copilot-impact.md`). The only new write path (`setTenantBusinessType()`) is internal, called only from the existing, already-permission-gated tenant-provisioning flow — not independently callable from any route.

## Bypass-vector check (abbreviated — most vectors from Phase 1/2B/3's checklists don't apply, since this phase adds no enforcement mechanism to bypass)

| Vector                     | Finding                                                                                                                                                                                    |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Direct service access      | N/A — no new route exists to access directly                                                                                                                                               |
| Frontend manipulation      | N/A — no new client-facing field                                                                                                                                                           |
| Modified request data      | `businessTypeCode` passed into `setTenantBusinessType()` comes from the already-validated `vertical` enum value, never raw client input beyond what `CreateTenantSchema` already validates |
| Tenant/cross-tenant access | N/A — global reference tables, no tenant-scoped read/write introduced                                                                                                                      |

**No bypass found — there is structurally very little to bypass in this phase**, consistent with its low-risk classification (`00-overview.md` §4).
