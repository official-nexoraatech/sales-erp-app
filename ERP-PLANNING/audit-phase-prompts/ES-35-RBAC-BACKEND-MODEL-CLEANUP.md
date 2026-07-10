# ES-35 — RBAC Audit Phase C: Backend Permission Model Cleanup
## STATUS: ✅ COMPLETED
## Sprint: Enterprise RBAC Refactor (Phase C of 5) | Effort: 1.5–2 days | Risk: Medium
## Depends on: ES-33, ES-34
## Unlocks: ES-31, ES-32

---

## YOUR ROLE

You are the **Principal Backend Engineer** on the NEXORAA Multi-Tenant Cloth Retail ERP,
continuing the 5-phase enterprise RBAC audit and refactor.

---

## OBJECTIVE

1. Consolidate the 12+ near-identical per-service copies of `middleware/authenticate.ts`
   and `middleware/authorize.ts` into one shared, tested implementation, closing real
   drift (a hand-rolled RS256 verifier in report-service; inconsistent error-body shapes).
2. Add a framework-level CI backstop for the "auth is opt-in per route" root cause the
   architecture audit flagged — a test that scans every service's route files and fails on
   an unrecognized/missing guard.
3. Resolve the `CUSTOMER_DELETE` frontend/backend sync gap and the `WAREHOUSE_MANAGE` vs.
   fine-grained stock permission duplication carried over from ES-34.
4. Normalize duplicate/overlapping permission constants where safe to do so.

---

## SCOPE — WHAT WAS DONE

### 1. Shared auth middleware (`packages/platform-sdk/src/auth.ts`)
New `verifyAccessToken()` (RS256 JWT verify via `jose`) and `checkPermission()` (pure
`'ok' | 'unauthenticated' | 'forbidden'` decision function), exported from `@erp/sdk`.
Framework-agnostic by design — no Fastify import, matching this SDK's existing convention
(see `health.ts`'s `HealthRouteApp` structural interface). Each service's own
`middleware/authenticate.ts`/`authorize.ts` still exists (Fastify request/reply I/O and
the `declare module 'fastify'` augmentation must stay per-service) but is now a thin
wrapper calling the shared functions — the actual JWT-verification and permission-check
logic is unified in one tested place instead of duplicated 12+ times.

Rewrote `authenticate.ts` in: accounting, event, gst, hr, inventory, notification (+
`authenticateStream` for its SSE route), production, purchase, report, sales, scheduler,
search, tenant-service. Rewrote `authorize.ts` in the same set (except search-service and
scheduler-service, which use a different, already-consistent inline `hasPermission()`
pattern — left as-is, not part of this consolidation).

**Real drift closed by this pass:**
- `report-service`'s `authenticate.ts` had a fully hand-rolled RS256 verifier (manual
  base64url decode, `crypto.createVerify`, manual `exp` check) — replaced with the same
  `jose`-based `verifyAccessToken()` every other service uses. Removed the `@erp/config`
  `requireEnv`/public-key-caching logic that came with it.
- Standardized every error body to `{ error: { code, message } }` (the majority pattern
  already) — `hr-service`, `event-service`, `notification-service`'s `authenticateStream`,
  `search-service` previously sent plain-string `{ error: 'message' }` bodies.
- `auth-service` was deliberately **not** touched — it mints tokens (has its own
  `jwt.ts`/signing-key access), a different concern from verification; consolidating it
  would require moving signing logic too, out of scope here.

### 2. Route-guard-coverage test (`packages/shared-types/src/__tests__/route-guard-coverage.test.ts`)
Scans every `apps/*/src/api/*.routes.ts` file (text-based scan, not a full AST parse —
sufficient to catch the shape of bug ES-33 found) and fails if a route has no recognizable
guard (`requirePermission(`, `requireInternalKey(`, `PLATFORM_ADMIN`, inline
`hasPermission(request`, `.permissions.includes(` for dynamic per-report checks, or
`timingSafeEqual(`/`checkInternalKey` for inline internal-key checks not using the shared
helper). First run flagged 29 routes; investigating each found:

- **2 real gaps, fixed:**
  - `report-service/src/api/report.routes.ts` — `POST /config/number-series/:type`,
    `/config/number-series/:type/preview`, and `POST /internal/number-series/:type/next`
    had **zero** auth at all, yet read `request.auth.tenantId` directly — meaning any call
    would throw (500), not reject cleanly (401). No caller exists anywhere in the repo
    today (dead/unwired feature). Added `authenticate` to all three;
    `requirePermission(NUMBER_SERIES_CONFIG)` (an existing, previously-unused permission
    constant) to the two config routes; left `/internal/.../next` as authenticate-only
    (a counter read any tenant user in a create-flow needs, not a standalone admin action).
  - `tenant-service/src/api/organization.routes.ts` — `POST /organization/logo/upload`
    had `authenticate` only; any logged-in user (any role) could get a presigned upload
    URL to overwrite the tenant's shared logo. Added
    `requirePermission(ORG_SETTINGS_EDIT)`, matching the sibling `PUT /organization` route.
- **27 legitimate exceptions**, documented in the test's `KNOWN_EXCEPTIONS` map with
  reasoning: self-service account actions where `authenticate` is applied via a
  plugin-scoped hook the text scan can't see (auth-service's MFA/sessions/impersonate-end,
  tenant-service's approval actions — record-level scoped to the caller's own userId),
  self-service notification inbox routes (ES-33), a public token-based unsubscribe link,
  and reference-data GETs (branches/organization) that are intentionally open to any
  tenant member while mutations require the stricter permission.

### 3. `CUSTOMER_DELETE` — was a frontend/backend sync bug, not a backend gap
Investigation found `CUSTOMER_DELETE` **already existed** in the backend's
`packages/shared-types/src/permissions.ts` and was **already correctly wired** to
`DELETE /customers/:id` in `sales-service`. It was simply **missing from the frontend's**
`constants/permissions.ts`, so `CustomersPage.tsx`'s Delete button could never check it —
exactly the "frontend permissions guessed independently of backend" problem the original
request called out. Fixed: added the constant to the frontend, and gated
`CustomersPage.tsx`'s Edit/Delete/+New Customer actions with `hasPermission()` (same
pattern as `CustomerViewPage.tsx`, its sibling detail page).

### 4. Permission constant normalization
- **`CUSTOMER_UPDATE` vs `CUSTOMER_EDIT`** — found a real, concrete bug from this exact
  duplication: `role-defaults.ts`'s `SALES_MANAGER` was assigned `CUSTOMER_UPDATE`, a
  constant **no backend route checks at all** — meaning Sales Managers cannot edit
  customer records today, because the actual route (`PUT /customers/:id`) requires
  `CUSTOMER_EDIT`. Fixed: `SALES_MANAGER` now gets `CUSTOMER_EDIT`. `CUSTOMER_UPDATE`
  itself was left defined (not deleted) since removing a constant needs a wider check this
  phase didn't have time for — but it's confirmed dead on the authorization path.
- **`AUDIT_LOG_VIEW` vs `VIEW_AUDIT_LOG`** — investigated, **not** duplicates despite the
  similar name: `AUDIT_LOG_VIEW` gates the Phase-12 distributed-systems admin views (event
  store, DLQ, saga monitor, schema registry, projections, performance — 15 usages across
  5 files in `event-service`), while `VIEW_AUDIT_LOG` gates the actual security/compliance
  audit-trail viewer (ES-19/ES-20, `auth-service`). Left both as-is; documented here so a
  future pass doesn't mistakenly merge them.
- **`WAREHOUSE_MANAGE` vs. fine-grained stock permissions** (`STOCK_TRANSFER_VIEW` /
  `STOCK_ADJUSTMENT_VIEW` / `STOCK_ADJUSTMENT_MANAGE` / `PHYSICAL_VERIFICATION_VIEW`, and a
  second older generation `STOCK_TRANSFER` / `STOCK_ADJUST` / `STOCK_ADJUST_APPROVE`) —
  carried over from ES-34. **Not resolved in this phase either** — properly fixing it
  requires rewriting the guard on every route in `transfer.routes.ts`,
  `adjustment.routes.ts`, and `physical-verification.routes.ts` (currently 100%
  `WAREHOUSE_MANAGE`-gated) plus updating `role-defaults.ts` for `INVENTORY_MANAGER` (which
  today has neither the old nor new generation wired to anything that matters), which is a
  larger, higher-risk change than this phase's remaining budget allowed. Left as an
  explicitly flagged, well-understood follow-up (see Deployment Checklist).
- **Third internal-key check variant found**: `inventory-service`'s
  `reservation.routes.ts`/`stock.routes.ts` inline a `timingSafeEqual`-based internal-key
  check with local variable names, distinct from both the shared `requireInternalKey()`
  pattern used elsewhere and `report-service`'s locally-named `checkInternalKey`. Not
  consolidated in this phase (functionally correct, just a 4th copy of the same 15 lines)
  — flagged for a future backend-hygiene pass.

---

## FILES CHANGED (representative — full list in completion report)

- `packages/platform-sdk/src/auth.ts` (new), `index.ts`, `package.json` (`+jose`)
- `apps/{accounting,event,gst,hr,inventory,notification,production,purchase,report,sales,scheduler,search,tenant}-service/src/middleware/{authenticate,authorize}.ts`
- `apps/report-service/src/api/report.routes.ts`, `apps/tenant-service/src/api/organization.routes.ts`
- `apps/tenant-service/src/rbac/role-defaults.ts`
- `apps/web-frontend/src/constants/permissions.ts`, `apps/web-frontend/src/pages/customers/CustomersPage.tsx`
- `packages/shared-types/src/__tests__/route-guard-coverage.test.ts` (new)
- 3 pre-existing test files fixed to match the now-standardized object error shape (see completion report)

---

## VERIFICATION CHECKLIST

- [x] All 13 touched services + `@erp/sdk` + `@erp/types` + `web-frontend`: `type-check` clean
- [x] Route-guard-coverage test passes with a real, reasoned exception list (not blanket-suppressed)
- [x] New `@erp/sdk/auth.test.ts`: 6/6 (JWT verify happy/forged/misconfigured paths, permission-check 3-state)
- [x] `CustomersPage.test.tsx`: 4/4 (2 new — buttons hidden/shown by permission)
- [x] No new lint error classes; remaining errors are pre-existing (confirmed via unmodified sibling files)
- [x] Completion report saved at `ERP-PLANNING/phase-completions/ES-35_COMPLETION.md`
