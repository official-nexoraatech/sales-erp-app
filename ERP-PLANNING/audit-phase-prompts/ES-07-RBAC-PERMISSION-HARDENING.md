# ES-07 — RBAC & Permission Hardening
## STATUS: 🔴 PENDING
## Sprint: 2 | Effort: 2–3 days | Risk: Medium
## Depends on: None (independent)
## Unlocks: ES-09, ES-18, ES-19, ES-20

---

## YOUR ROLE

You are the **Principal Backend Engineer** on the NEXORAA Multi-Tenant Cloth Retail ERP.
Your mission: define 7 missing RBAC permissions and wire them as route guards on the specific routes they protect.

---

## ═══════════════════════════════════════════
## PRE-FLIGHT CHECKLIST
## ═══════════════════════════════════════════

- [ ] Read `ERP-PLANNING/TECH_AUDIT.md`
- [ ] Read `ERP-PLANNING/CODING_STANDARDS.md`
- [ ] Read `packages/shared-types/src/permissions.ts` — all current permission constants
- [ ] Read `apps/sales-service/src/api/invoice.routes.ts` — find credit limit bypass and price override routes
- [ ] Read `apps/sales-service/src/api/customer.routes.ts` — find export endpoint
- [ ] Read `apps/accounting-service/src/api/journal.routes.ts` — find journal reversal route
- [ ] Read `apps/hr-service/src/api/payroll.routes.ts` — find payroll detail routes
- [ ] Read `apps/auth-service/src/` — check if impersonation endpoint exists
- [ ] Find role seeding file in `apps/tenant-service/src/` (look for where default roles are created)
- [ ] Check if role-permission associations are in DB: look for a table in `packages/db-client/src/schema/auth.ts`
- [ ] Run `pnpm build` and `pnpm test` — confirm clean baseline

---

## ═══════════════════════════════════════════
## COMPLETED PHASES
## ═══════════════════════════════════════════

| Phase | Status | Key Changes Relevant to You |
|-------|--------|----------------------------|
| ES-01 ✅ | Security | search-service JWT; rate limit 10/15min |
| ES-02–06 | Check reports | No direct dependency for ES-07 |

---

## ═══════════════════════════════════════════
## PROJECT CONTEXT
## ═══════════════════════════════════════════

### Tech Stack
Node.js 20 + TypeScript 5 strict | Fastify 4 | PostgreSQL 16 + Drizzle ORM | Vitest

### Auth Pattern (MANDATORY — every guarded route must follow exactly this)
```typescript
fastify.post('/invoices/:id/override-credit', {
  preHandler: [authenticate, requirePermission(PERMISSIONS.CREDIT_LIMIT_OVERRIDE)],
}, async (request, reply) => {
  // handler — no permission check here; trust the preHandler
});
```

**Order is critical:**
1. `authenticate` — validates JWT, sets `request.auth`
2. `requirePermission(PERMISSIONS.X)` — checks `request.auth.permissions.includes(PERMISSIONS.X)`

### Permission Constants Pattern
```typescript
// packages/shared-types/src/permissions.ts
export const PERMISSIONS = {
  // ... existing ...
  VIEW_AUDIT_LOG: 'VIEW_AUDIT_LOG',
  CREDIT_LIMIT_OVERRIDE: 'CREDIT_LIMIT_OVERRIDE',
  // etc.
} as const;

export type Permission = typeof PERMISSIONS[keyof typeof PERMISSIONS];
```

### Role-Permission Assignments (seed data)
```
CREDIT_LIMIT_OVERRIDE    → SALES_MANAGER, ADMIN
PRICE_FLOOR_OVERRIDE     → SALES_MANAGER, ADMIN
CANCEL_POSTED_JOURNAL    → ACCOUNTANT_SUPERVISOR, ADMIN
VIEW_SALARY_DETAILS      → HR_MANAGER, ADMIN
EXPORT_CUSTOMER_DATA     → ADMIN, DATA_OFFICER
VIEW_AUDIT_LOG           → ADMIN, AUDITOR
IMPERSONATE_USER         → SUPER_ADMIN only
```

### Architecture Rule
- Permission checks are at the ROUTE layer only — NEVER inside domain services
- Domain services trust that the caller is already authorized
- If a route does not currently use `requirePermission`, ADD it — do not skip
- Do not combine multiple permissions in one `requirePermission` call

### Coding Standards
- TypeScript strict — no `any`
- No `console.log` — use `packages/logger`
- Permission constant naming: `UPPER_SNAKE_CASE`
- `/* global process */` at top of files using `process.env`

---

## ═══════════════════════════════════════════
## OBJECTIVE
## ═══════════════════════════════════════════

Define 7 missing RBAC permission constants and add them as `requirePermission()` preHandlers on the specific routes they protect.

**Why critical:** Without these permissions, ANY authenticated user can:
- Override a customer's credit limit (financial risk)
- Sell products below cost price (margin destruction)
- Reverse posted accounting journals (accounting integrity violation)
- View all employee salaries (privacy violation)
- Export all customer personal data (GDPR violation)
- Impersonate other users (security breach)

---

## ═══════════════════════════════════════════
## SCOPE
## ═══════════════════════════════════════════

### IN SCOPE

**Step 1 — Add 7 constants to `packages/shared-types/src/permissions.ts`**

```typescript
// Add these 7 — with a comment explaining which routes each protects
VIEW_AUDIT_LOG: 'VIEW_AUDIT_LOG',          // GET /admin/audit-logs
CREDIT_LIMIT_OVERRIDE: 'CREDIT_LIMIT_OVERRIDE',  // invoice credit limit bypass
PRICE_FLOOR_OVERRIDE: 'PRICE_FLOOR_OVERRIDE',    // invoice price below cost
CANCEL_POSTED_JOURNAL: 'CANCEL_POSTED_JOURNAL',  // POST /journals/:id/reverse
VIEW_SALARY_DETAILS: 'VIEW_SALARY_DETAILS',      // GET /payroll-slips/:id
IMPERSONATE_USER: 'IMPERSONATE_USER',            // auth impersonation endpoint
EXPORT_CUSTOMER_DATA: 'EXPORT_CUSTOMER_DATA',    // GET /customers/export
```

**Step 2 — Wire guards to routes**

For each route: add `requirePermission(PERMISSIONS.X)` as the SECOND preHandler (after `authenticate`).

| Service | Route | Permission to Add |
|---------|-------|------------------|
| sales-service | credit limit bypass (find the route that allows invoice creation past limit) | `CREDIT_LIMIT_OVERRIDE` |
| sales-service | price below cost override (find the route/flag) | `PRICE_FLOOR_OVERRIDE` |
| sales-service | `GET /customers/export` (or equivalent export) | `EXPORT_CUSTOMER_DATA` |
| accounting-service | `POST /journals/:id/reverse` (or `/cancel`) | `CANCEL_POSTED_JOURNAL` |
| hr-service | `GET /payroll-slips/:id` and any payroll detail routes | `VIEW_SALARY_DETAILS` |
| auth-service | impersonation endpoint (if exists — check `auth-service/src/api/`) | `IMPERSONATE_USER` |
| Any audit log route | `GET /admin/audit-logs` (if exists) | `VIEW_AUDIT_LOG` |

**If a route doesn't exist yet** (e.g., impersonation, audit log, customer export):
- Add the permission constant and leave a comment: `// Route not yet implemented — permission ready for when the route is built (ES-20 for audit log)`
- Do NOT create the route itself — that's out of scope

**Step 3 — Update role seed data**

Find the role seeding location (likely in `apps/tenant-service/src/domain/` or a seed script in `tools/scripts/`).

If roles are seeded via code: add the new permission constants to the appropriate role arrays.
If roles are stored in a DB table: add a migration that INSERTs the new role-permission associations.

---

## ═══════════════════════════════════════════
## TESTING REQUIREMENTS
## ═══════════════════════════════════════════

Minimum 14 integration tests (7 permissions × 2 scenarios each):

For each of the 7 permissions:
1. Call the protected route as a user WITHOUT the permission → assert 403
2. Call the protected route as a user WITH the permission → assert 200 or expected response

Create test files per service:
- `apps/sales-service/src/__tests__/permission-guards.test.ts`
- `apps/accounting-service/src/__tests__/permission-guards.test.ts`
- `apps/hr-service/src/__tests__/permission-guards.test.ts`

Also test:
- Admin role has ALL new permissions → can access all newly guarded routes
- Existing non-guarded routes still work for all roles (no regression)

---

## ═══════════════════════════════════════════
## BUILD VERIFICATION
## ═══════════════════════════════════════════

```bash
pnpm --filter @erp/shared-types build
pnpm --filter @erp/sales-service build
pnpm --filter @erp/sales-service type-check
pnpm --filter @erp/accounting-service build
pnpm --filter @erp/accounting-service type-check
pnpm --filter @erp/hr-service build
pnpm --filter @erp/hr-service type-check
pnpm lint
pnpm test --filter @erp/sales-service
pnpm test --filter @erp/accounting-service
pnpm test --filter @erp/hr-service
```

---

## ═══════════════════════════════════════════
## VERIFICATION CHECKLIST
## ═══════════════════════════════════════════

- [ ] `packages/shared-types/src/permissions.ts` contains all 7 new constants with comments
- [ ] `GET /api/v1/hr/payroll-slips/{id}` → 403 for user without `VIEW_SALARY_DETAILS`
- [ ] Same route → 200 for user with `VIEW_SALARY_DETAILS`
- [ ] `POST /api/v1/accounting/journals/{id}/reverse` → 403 for user without `CANCEL_POSTED_JOURNAL`
- [ ] Same route → 200 (or 422 for business reason) for user with `CANCEL_POSTED_JOURNAL`
- [ ] Credit limit bypass route → 403 for user without `CREDIT_LIMIT_OVERRIDE`
- [ ] All 14 permission tests pass
- [ ] Admin role can access all new protected routes
- [ ] Non-protected routes (invoice create, customer list, etc.) still work for all roles
- [ ] `pnpm lint` passes

---

## ═══════════════════════════════════════════
## REGRESSION CHECKLIST
## ═══════════════════════════════════════════

- [ ] Admin users can access ALL routes they previously accessed
- [ ] Accountants can still CREATE and VIEW journals (only REVERSAL of posted journals is now guarded)
- [ ] Salespeople can still CREATE invoices without `CREDIT_LIMIT_OVERRIDE` (guard is only for bypass)
- [ ] HR managers can still VIEW payroll runs (only salary DETAIL requires the new permission)
- [ ] Cashier role is unaffected — no new restrictions on POS or basic sales flows

---

## ═══════════════════════════════════════════
## DEFINITION OF DONE
## ═══════════════════════════════════════════

- [ ] All 7 permissions defined with comments in `permissions.ts`
- [ ] Permission guards wired to all applicable existing routes
- [ ] Role seed data updated with new assignments
- [ ] 14 integration tests pass (7 permissions × 2 scenarios)
- [ ] No existing authorized workflows broken
- [ ] Completion report saved at `ERP-PLANNING/phase-completions/ES-07_COMPLETION.md`

---

## ═══════════════════════════════════════════
## COMPLETION REPORT TEMPLATE
## ═══════════════════════════════════════════

**Save as:** `ERP-PLANNING/phase-completions/ES-07_COMPLETION.md`

```markdown
# ES-07 Completion Report — RBAC & Permission Hardening
**Date:** [YYYY-MM-DD]
**Status:** COMPLETE

## Permissions Added
| Permission | Routes Protected | Roles Assigned |
|------------|-----------------|----------------|
| CREDIT_LIMIT_OVERRIDE | [route] | SALES_MANAGER, ADMIN |
| PRICE_FLOOR_OVERRIDE | [route] | SALES_MANAGER, ADMIN |
| CANCEL_POSTED_JOURNAL | [route] | ACCOUNTANT_SUPERVISOR, ADMIN |
| VIEW_SALARY_DETAILS | [routes] | HR_MANAGER, ADMIN |
| EXPORT_CUSTOMER_DATA | [route or N/A] | ADMIN, DATA_OFFICER |
| VIEW_AUDIT_LOG | [route or N/A] | ADMIN, AUDITOR |
| IMPERSONATE_USER | [route or N/A] | SUPER_ADMIN |

## Files Changed
[List files with route additions]

## Test Results
14 integration tests: [PASS] | pnpm lint: [PASS] | pnpm build: [PASS]

## Phases Unblocked
ES-09 (CREDIT_LIMIT_OVERRIDE used for vendor credit bypass)
ES-18 (CUSTOMER_UPDATE permission for CRM opt-out)
ES-19 (admin security routes)
ES-20 (VIEW_AUDIT_LOG for audit log viewer)
```
