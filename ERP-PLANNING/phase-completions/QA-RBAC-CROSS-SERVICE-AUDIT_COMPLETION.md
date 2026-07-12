# QA Session — Cross-Service RBAC Audit + Auth Flow Review

**Date:** 2026-07-12
**Status:** RBAC audit + core auth-flow review complete; Auth module still has untested surface (see bottom)

## Scope

Continuation of the ongoing full-application QA cycle. Having already found and fixed the same
"granted-but-never-checked permission constant" bug twice by spot-checking (Sales, then
Accounting via `SALES_MANAGER`/`QUOTATION_CONVERT`), this session ran a systematic, repo-wide
sweep for the same pattern before moving on to Auth/RBAC as a dedicated module — on the theory
that a bug found twice by accident is worth looking for on purpose everywhere else.

## Method

1. Extracted every `PERMISSIONS.X` constant defined in `packages/shared-types/src/permissions.ts` (280 total).
2. Extracted every constant actually granted to a specific (non-`OWNER`/`ADMIN`/`SUPER_ADMIN`) role
   in `apps/tenant-service/src/rbac/role-defaults.ts` (125 total) — this is the set where a real
   person expects the permission to do something.
3. Extracted every constant actually checked by a `requirePermission()`/`requireAnyPermission()`/
   inline `permissions.includes()` call across every service's routes (178 total).
4. Diffed (2) against (3): granted to a role, checked nowhere = a real, live gap. Got 23
   candidates; individually verified each with the actual route file (several were false
   positives — checked via a different helper my grep missed, e.g. `search-service`'s
   `hasPermission()` wrapper for `SEARCH_GLOBAL`, or genuinely unbuilt features with no route to
   fix at all, e.g. `VOUCHER_CREATE`/`VOUCHER_VIEW`, `REPORT_EXPORT`, `LEDGER_EXPORT`,
   `CREDIT_NOTE_CREATE`/`VIEW`).

This is a repo-wide sweep, not exhaustive proof of zero remaining bugs — a constant checked via a
pattern not covered by the grep (e.g. a decorator, a third differently-named helper) could still
hide a gap. Treat the 5 findings below as confirmed, not the audit as complete.

## Bugs Found and Fixed

All five follow the same shape and the same fix pattern as `QUOTATION_CONVERT` (see the Sales
completion report, finding #5): a role's `role-defaults.ts` grant assumed a permission would work;
the route it should gate checked a different, broader constant instead. Fixed with
`requireAnyPermission([granular, existing fallback])` in each case — zero regression risk, no
role loses access, the granular constant stops being dead.

### 1. `INVENTORY_MANAGER` could not create or update a warehouse

Granted `WAREHOUSE_CREATE`/`WAREHOUSE_UPDATE`; `POST /warehouses` and `PUT /warehouses/:id`
(`apps/inventory-service/src/api/warehouse.routes.ts`) only ever checked `WAREHOUSE_MANAGE`, which
`INVENTORY_MANAGER` was never granted. (`DELETE /warehouses/:id` left untouched — no role has an
explicit warehouse-delete grant, so `WAREHOUSE_MANAGE`-only there looks intentional.)

### 2. `INVENTORY_MANAGER` could not use stock adjustments at all — not even list/view its own

Granted `STOCK_ADJUST`; all six routes in `adjustment.routes.ts` (list, create, view, submit,
approve, cancel) checked `WAREHOUSE_MANAGE` uniformly. The role built specifically to run
inventory operations was locked out of this entire feature.

### 3. `INVENTORY_MANAGER` could not use stock transfers at all — same shape as #2

Granted `STOCK_TRANSFER`; all nine routes in `transfer.routes.ts` (list, create, update, view,
submit, approve, dispatch, receive, cancel) checked `WAREHOUSE_MANAGE` uniformly.

### 4. `ACCOUNTANT` could not view customer payments received

Granted `PAYMENT_IN_VIEW` (not `PAYMENT_VIEW`); `GET /payments` and `GET /payments/:id`
(`apps/sales-service/src/api/payment.routes.ts`) only checked `PAYMENT_VIEW`.

### 5. `ACCOUNTANT` and `ACCOUNTANT_SUPERVISOR` could not view the audit log

Granted `AUDIT_LOG_VIEW`; `GET /admin/audit-logs` and `GET /admin/security-audit-log`
(`apps/auth-service/src/routes/audit-log.routes.ts`, `security-audit-log.routes.ts`) only checked
`VIEW_AUDIT_LOG` — a near-duplicate-named constant. `AUDITOR` already has both and was unaffected;
this is a genuine naming trap for anyone adding a new role or reading the grant list at face
value.

## Fixes Applied

- `apps/inventory-service/src/middleware/authorize.ts` — added `requireAnyPermission()` (new
  per-service copy, matching the pattern from the Sales session; each service has its own copy of
  this middleware, not a shared package).
- `apps/auth-service/src/middleware/authorize.ts` — added `requireAnyPermission()` (this
  service's `requirePermission` has a different error-shape convention than the others; matched
  it rather than importing the sales-service version).
- `apps/inventory-service/src/api/warehouse.routes.ts`, `adjustment.routes.ts`,
  `transfer.routes.ts` — repointed the routes described above.
- `apps/sales-service/src/api/payment.routes.ts` — repointed `GET /payments`, `GET /payments/:id`.
- `apps/auth-service/src/routes/audit-log.routes.ts`, `security-audit-log.routes.ts` —
  repointed both routes.

## Tests

- New `apps/inventory-service/src/__tests__/warehouse-adjustment-transfer-permission-guards.test.ts` — 6 tests.
- New `apps/sales-service/src/__tests__/payment-view-permission-guard.test.ts` — 3 tests.
- New `apps/auth-service/src/__tests__/audit-log-permission-guard.test.ts` — 3 tests (this one
  needed `initializeJwt()` called explicitly with a matching issuer/keypair — `auth-service`'s
  `authenticate` middleware validates the JWT issuer against service config, unlike the other
  three services' simpler `checkPermission()`-only middleware, which don't).
- All new tests prove both directions: a caller with only the new granular constant succeeds, and
  a caller with only the pre-existing fallback constant still succeeds (no regression).

## Verification

- `pnpm --filter @erp/inventory-service test` — 39 passed (was 33), 0 failed.
- `pnpm --filter @erp/sales-service test` — 84 passed (was 81), 0 failed.
- `pnpm --filter @erp/auth-service test` — 51 passed (was 48), 0 failed; one pre-existing,
  unrelated suite-level load failure (`es20-admin-routes.test.ts`, a `packages/platform-sdk/src/idempotency.ts`
  transform error) reproduced identically via `git stash` with all this session's changes removed
  — confirmed pre-existing, not a regression.
- `pnpm --filter <service> type-check` / `build` — clean for all four touched services
  (`inventory-service`, `sales-service`, `auth-service`, and `tenant-service` from the earlier
  `QUOTATION_CONVERT` fix).
- Rebuilt and restarted the live local `sales-service`, `inventory-service`, and `auth-service`
  processes; confirmed `/health` 200 on all three with the fixes live.
- No migration/backfill needed for any of these five — unlike `QUOTATION_CONVERT`
  (role-defaults.ts change needing a DB backfill for existing tenants), all five roles here
  already had the granular constant granted in `role-defaults.ts`; only the route-side check was
  wrong, so no existing tenant's `role_permissions` rows needed touching.

## Known Gaps / Not Fixed (confirmed dead, but no route to redirect to — feature gaps, not RBAC-wiring bugs)

- `VOUCHER_CREATE`/`VOUCHER_VIEW` (granted to `ACCOUNTANT`/`ACCOUNTANT_SUPERVISOR`) — no route
  anywhere is named or behaves like a "voucher" (journal entries use their own permission family).
- `REPORT_EXPORT`, `LEDGER_EXPORT` — broadly granted (most roles with `REPORT_VIEW` also have
  `REPORT_EXPORT`) but no export endpoint exists anywhere in `accounting-service` or
  `report-service`.
- `CREDIT_NOTE_CREATE`/`CREDIT_NOTE_VIEW` — no standalone credit-note list/create route exists;
  credit notes are only created indirectly via sale-return, whose `apply`/`refund` actions
  already check `CREDIT_NOTE_ADJUST` (fixed in the Sales session).
- `INVOICE_APPROVE`, `SALE_RETURN_APPROVE`, `SALE_RETURN_CANCEL`, `CREDIT_NOTE_CANCEL` — already
  documented in the Sales completion report; no approve/cancel workflow exists for these entities.
- `GRN_UPDATE` — only used by the GRN attachment routes; no route to edit a GRN's own fields
  exists (only create, approve, attach).
- `SALARY_VIEW` — dead, but harmless: `HR_MANAGER` (its only grantee) also has
  `VIEW_SALARY_DETAILS`, which is what the payroll routes actually check.
- `CUSTOMER_CREDIT_LIMIT_UPDATE` — dead, but harmless: credit limit is just a field on the
  regular customer update payload, gated by `CUSTOMER_EDIT`, which `SALES_MANAGER` (its only
  grantee) already has.
- 65 further constants are defined but granted to **no role at all** (not even via the
  `OWNER`/`ADMIN` wildcard's underlying intent — they're just unused, mostly for unbuilt features
  like `FABRIC_ROLL_*`, `POS_CASH_DRAWER`/`OPEN_SHIFT`/`CLOSE_SHIFT`, `PRICE_LIST_*`,
  `PHYSICAL_VERIFICATION_*`). Zero functional impact today; not investigated further.

## Auth Flow Review (login / logout / password reset / session / route guards)

Read through the core auth flows end to end after the RBAC audit above.

**Reviewed, no bugs found — solid implementations:**

- `POST /auth/login` (`apps/auth-service/src/routes/login.ts`) — dedicated rate limit
  (`LOGIN_RATE_LIMIT_MAX`/`WINDOW_MS`), IP-block tracking, constant-time hashing on the
  user-not-found path (prevents enumeration), account lockout after N failed attempts, TOTP/MFA
  challenge before any token issuance, tenant-active check before credential checking.
- `POST /auth/logout` — revokes the refresh token and deletes the active session row.
- `POST /auth/reset-password` — validates token hash + expiry + not-already-used, updates the
  password, and (correctly) revokes **all** refresh tokens for that user, forcing re-login on
  every device — not just the one that requested the reset.
- Frontend `ProtectedRoute`/`PermissionRoute` (`App.tsx`) — purely client-side UX gating (shows
  "Access Denied" / redirects to `/login`), which is the correct pattern here since the real
  security boundary is the backend `requirePermission` checks verified above; a client-side
  bypass of this component would still hit a 403 from the API. `useAuthStore`'s `persist`
  middleware correctly survives a page refresh without re-prompting login (session persistence
  working as intended); "Remember Me" only persists `tenantId`+`email` to prefill the form, never
  credentials or tokens.

**Bug found and fixed:**

`POST /auth/forgot-password` had no dedicated rate limit — only the generic service-wide 200/min
default (`apps/auth-service/src/main.ts`'s global `@fastify/rate-limit` registration) applied,
unlike `/auth/login`'s dedicated 10-per-15-minutes override. An endpoint that triggers an email
send and is a standard target for enumeration/inbox-spam abuse had materially weaker throttling
than login despite being at least as sensitive. Added `FORGOT_PASSWORD_RATE_LIMIT_MAX`/
`FORGOT_PASSWORD_RATE_LIMIT_WINDOW_MS` (default 5/15min, same shape as login's) and wired it into
the route via the same `config: { rateLimit: {...} }` pattern login already uses.

**Tests:** New `apps/auth-service/src/__tests__/forgot-password-rate-limit.test.ts` — registers
the real `@fastify/rate-limit` plugin with a low limit and confirms the 3rd request in a 2-request
window gets a 429. 1/1 pass.

**Not yet covered:** live session-expiry behavior (token TTL countdown, silent refresh timing),
multiple-concurrent-browser-sessions semantics, MFA enrollment/backup-codes UI flow,
impersonation (`impersonate.routes.ts`), and the admin user-management routes
(`admin-users.routes.ts`, `users.ts`) weren't read this session.

## Next

Now that this audit method has proven itself across three services, apply the same
permission-constant sweep to the remaining untouched services (`hr-service`,
`purchase-service`, `production-service`, `gst-service`, `event-service`). Also still open: the
Auth-module gaps listed just above, and the rest of the originally-requested full-application
sweep (every other module, forms/validation, security payloads, accessibility, performance).

## Files Changed

| File                                                                                           | Change                                                  |
| ---------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| `apps/inventory-service/src/middleware/authorize.ts`                                           | Added `requireAnyPermission()`                          |
| `apps/auth-service/src/middleware/authorize.ts`                                                | Added `requireAnyPermission()`                          |
| `apps/inventory-service/src/api/warehouse.routes.ts`                                           | Repointed POST/PUT                                      |
| `apps/inventory-service/src/api/adjustment.routes.ts`                                          | Repointed all 6 routes                                  |
| `apps/inventory-service/src/api/transfer.routes.ts`                                            | Repointed all 9 routes                                  |
| `apps/sales-service/src/api/payment.routes.ts`                                                 | Repointed GET routes                                    |
| `apps/auth-service/src/routes/audit-log.routes.ts`                                             | Repointed GET route                                     |
| `apps/auth-service/src/routes/security-audit-log.routes.ts`                                    | Repointed GET route                                     |
| `apps/inventory-service/src/__tests__/warehouse-adjustment-transfer-permission-guards.test.ts` | **New** — 6 tests                                       |
| `apps/sales-service/src/__tests__/payment-view-permission-guard.test.ts`                       | **New** — 3 tests                                       |
| `apps/auth-service/src/__tests__/audit-log-permission-guard.test.ts`                           | **New** — 3 tests                                       |
| `apps/auth-service/src/config.ts`                                                              | Added `forgotPasswordRateLimitMax`/`WindowMs`           |
| `apps/auth-service/src/routes/forgot-password.ts`                                              | Wired dedicated rate limit into the route               |
| `.env.example`                                                                                 | Documented `FORGOT_PASSWORD_RATE_LIMIT_MAX`/`WINDOW_MS` |
| `apps/auth-service/src/__tests__/forgot-password-rate-limit.test.ts`                           | **New** — 1 test                                        |
