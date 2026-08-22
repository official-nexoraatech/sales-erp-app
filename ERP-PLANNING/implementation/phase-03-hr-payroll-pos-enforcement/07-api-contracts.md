# 07 — API Contracts

## Contract change, applied identically to all 18 in-scope routes (6 HR_PAYROLL + 12 POS across three files)

**Before**: `authenticate` → `requirePermission`/`requireAnyPermission` → handler.
**After**: `authenticate` → `requireCapability(key, db, redis)` → `requirePermission`/`requireAnyPermission` → handler.

### New possible responses (both already fully specified and tested by Phase 1 — reused, not redesigned)

| Status | Code                                 | When                                                  | Body shape                                                                                                                                                                                   |
| ------ | ------------------------------------ | ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 403    | `CAPABILITY_NOT_ENABLED`             | Capability resolves cleanly to `false` for the tenant | `{ error: { code, message, details: { capabilityKey } } }`                                                                                                                                   |
| 503    | `CAPABILITY_RESOLUTION_UNAVAILABLE`  | Resolution itself throws (DB/Redis failure)           | `{ error: { code, message, details: { capabilityKey } } }`                                                                                                                                   |
| 403    | `FORBIDDEN` (existing, unchanged)    | Capability enabled, permission denied                 | unchanged shape                                                                                                                                                                              |
| 401    | `UNAUTHORIZED` (existing, unchanged) | No/invalid JWT                                        | unchanged — `requireCapability` itself also 401s if `request.auth` is missing, but `authenticate` already runs first in every route in scope, so this path is defensive, not newly reachable |

No existing 200/201 response shape changes for any route. No existing error code is removed, renamed, or reshaped.

## Idempotency

None of the 18 routes' idempotency behavior changes — the capability check is a pure read-then-branch preHandler with no side effect beyond the existing `erp_capability_check_denied_total` metric increment on denial (`18-observability.md`). A retried request against a capability-disabled tenant returns the same `403` every time, same as any other `403`.

## Audit

Consistent with Phase 1/2B precedent: **no `audit_log`/`security_audit_log` write added** for a capability denial, matching `requirePermission`'s existing precedent (no audit on a plain permission denial either). Confirm this stays true at implementation time — do not add audit logging as an unplanned addition (`21-post-implementation-review.md` §14 explicitly called this out as a deliberate non-goal for the same reason).

## Internal routes (`/internal/payroll/prepare`, `/internal/payroll/send-slips`)

**No contract change** — D2 (deferred). These remain `requireInternalKey`-only, 401 on missing/wrong key, no capability check.

## Existing endpoints that must remain fully compatible

Every route **not** in `01-current-code-evidence.md` §3/§4's tables — i.e., every other `hr-service` and `sales-service` route — is unaffected. In particular: `employee.routes.ts`'s employee CRUD, `attendance.routes.ts`, `leave.routes.ts`, and every non-POS `sales-service` route (invoices, quotations, CRM, customers) keep their exact current contract, zero change.

## No new endpoints, no deprecated endpoints

This phase adds no route and removes no route.
