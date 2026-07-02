# PHASE FIX AUDIT (P0–P2) — COMPLETION REPORT
## Generated: 2026-06-29 | Status: COMPLETE

> **This document is the official handoff artifact for the Fix Audit session.**
> **Phase 3 MUST start by reading this document.**
> **Never modify this document after generation.**

---

## 1. PHASE SUMMARY

| Field | Value |
|---|---|
| Phase Number | Fix Audit |
| Phase Name | Architecture Review Board Remediation (P0–P2) |
| Start Date | 2026-06-29 |
| End Date | 2026-06-29 |
| Status | COMPLETE |
| Engineer(s) | Claude Sonnet 4.6 |
| Claude Session | Phase Fix Audit Session |

---

## 2. WHAT WAS FIXED

### 2.1 Security Fixes (Critical)

**FA.2 — JWT Authentication + RBAC Middleware**
All Phase 2 microservices now enforce RS256 JWT authentication at every endpoint:
- `apps/inventory-service/src/middleware/authenticate.ts` + `authorize.ts`
- `apps/sales-service/src/middleware/authenticate.ts` + `authorize.ts`
- `apps/gst-service/src/middleware/authenticate.ts` + `authorize.ts`
- `apps/accounting-service/src/middleware/authenticate.ts` + `authorize.ts`
- `apps/tenant-service/src/middleware/authenticate.ts` + `authorize.ts`

Every route now declares `preHandler: [authenticate]` or `preHandler: [authenticate, requirePermission(PERMISSIONS.XXX)]`.

**FA.3 — AES-256-GCM Field Encryption**
- Created `packages/shared-utils/src/encryption.ts` with `encryptField()` and `decryptField()` (AES-256-GCM, 12-byte IV, base64 encoding)
- customer.routes.ts encrypts GSTIN and PAN before INSERT/UPDATE
- supplier.routes.ts encrypts GSTIN, PAN, bank account number before INSERT/UPDATE
- `FIELD_ENCRYPTION_KEY` added to `.env.example`

**New permissions added to `packages/shared-types/src/permissions.ts`:**
```typescript
WAREHOUSE_MANAGE, CUSTOMER_EDIT, ITEM_EDIT, SUPPLIER_EDIT,
SUPPLIER_BANK_VIEW, OPENING_BALANCE_LOCK, ORG_SETTINGS_EDIT,
BRANCH_MANAGE, GST_COMPUTE, USER_MANAGE
```

### 2.2 Architecture Fixes

**FA.1 — Database Migrations**
- Created `packages/db-client/drizzle.config.ts` and `packages/db-client/drizzle-schema.ts` (CJS-compatible entry point avoiding .js extension issue)
- Generated migration `packages/db-client/migrations/0000_worried_blue_marvel.sql` covering all Phase 0–2 tables (49 CREATE TABLE statements)

**FA.4 — /api/v2/ Route Prefix**
All 5 microservices now register routes under `fastify.register(async (sub) => {...}, { prefix: '/api/v2' })`. Health and metrics endpoints remain at root level.

**FA.5 — PlatformContextFactory Wiring**
All Phase 2 route files changed from `(fastify, db: ErpDatabase)` to `(fastify, ctxFactory: PlatformContextFactory)`. Route handlers call `ctxFactory.create({ tenantId, userId, correlationId })` per request to get `ctx.db.raw`, `ctx.events`, `ctx.audit`, etc.

**FA.6 — Outbox Event Publishing**
All write routes in inventory, sales, gst, and accounting services publish domain events via `ctx.events.publish()` or `ctx.events.publishInTransaction()` (outbox pattern — written in the same DB transaction as business data).

**FA.7 — Audit Logging**
All write routes call `ctx.audit.log({ action, entityType, entityId, before, after })` after every CREATE, UPDATE, and DELETE operation.

**FA.8 — Workflow + Rule Engine Seeding**
`apps/tenant-service/src/domain/TenantProvisioner.ts` now calls after SEED_ROLES_PERMISSIONS:
```typescript
const workflow = new WorkflowEngine(db, tenantId, 0, randomUUID());
await workflow.seedDefinitions();
const rules = new RuleEngine(db);
await rules.seedTemplates(tenantId, 0);
```

**FA.10 — Optimistic Locking**
All PUT endpoints now include `version: z.number().int().min(0)` in their update schema and check `eq(table.version, body.data.version)` in the WHERE clause. `OptimisticLockError` thrown when no rows updated.

**FA.11 — Temporal History in Transactions**
`customer.routes.ts`, `supplier.routes.ts`, and `item.routes.ts` PUT handlers wrap the history INSERT + main UPDATE in `ctx.db.transaction()`. History tables capture `previousData` JSONB snapshot before every update.

### 2.3 Production Hardening

**FA.9 — ImportEngine Execute**
`apps/scheduler-service/src/domain/ImportEngine.ts` execute() now performs actual DB inserts:
- CUSTOMER: inserts into `customers` table (branchId resolved from head-office branch)
- SUPPLIER: inserts into `suppliers` table
- ITEM: inserts into `items` table (unitId resolved from unit name)
- All inserts use `.onConflictDoNothing()`, batch size 100

**FA.12 — Welcome Email**
`TenantProvisioner.sendWelcomeEmail()` now calls `NOTIFICATION_SERVICE_URL/api/v2/notifications/send` with `templateKey: 'WELCOME_EMAIL'`. Gracefully degrades if env var not set. `NOTIFICATION_SERVICE_URL` added to `.env.example`.

**FA.13 — Real UserId Attribution**
`apps/tenant-service/src/api/tenant.routes.ts` suspend/activate/close routes now:
1. Have `preHandler: [authenticate]`
2. Pass `request.auth.userId` (not hardcoded `0`) to `provisioner.suspend()` / `provisioner.close()`

**FA.14 — Frontend PermissionGate**
Three new frontend files:
- `apps/web-frontend/src/constants/permissions.ts` — Permission constants
- `apps/web-frontend/src/hooks/usePermission.ts` — `usePermission(p)` hook
- `apps/web-frontend/src/components/PermissionGate.tsx` — Gate component

`apps/web-frontend/src/App.tsx` updated with `PermissionRoute` wrapper applied to all 21 pages (excluding LoginPage). Each route now checks the appropriate RBAC permission before rendering. Unauthorized users see an "Access Denied" inline message.

**FA.15 — Integration Tests**
Four integration test files created, all using Vitest + real PostgreSQL (`describe.skipIf(!DB_URL)` pattern for CI safety):
- `apps/inventory-service/src/__tests__/item.integration.test.ts` — item CRUD, optimistic lock, tenant isolation
- `apps/sales-service/src/__tests__/customer.integration.test.ts` — customer CRUD, GSTIN encryption, optimistic lock
- `apps/accounting-service/src/__tests__/accounts.integration.test.ts` — account CRUD, duplicate code rejection, cross-tenant isolation
- `apps/tenant-service/src/__tests__/tenant.integration.test.ts` — full provisioning saga, role seeding, suspend/activate lifecycle

---

## 3. FOLDER STRUCTURE CHANGES

```
packages/
├── db-client/
│   ├── drizzle.config.ts              (NEW — drizzle-kit config)
│   ├── drizzle-schema.ts              (NEW — CJS-compatible schema entry)
│   └── migrations/
│       └── 0000_worried_blue_marvel.sql  (NEW — Phase 0-2 full migration)
│
└── shared-utils/src/
    └── encryption.ts                  (NEW — AES-256-GCM field encryption)

apps/
├── inventory-service/src/
│   ├── middleware/authenticate.ts     (NEW)
│   ├── middleware/authorize.ts        (NEW)
│   ├── api/*.routes.ts                (REWRITTEN — ctxFactory, auth, events, audit, OL, history)
│   ├── main.ts                        (UPDATED — /api/v2/ prefix + ctxFactory)
│   └── __tests__/item.integration.test.ts  (NEW)
│
├── sales-service/src/
│   ├── middleware/authenticate.ts     (NEW)
│   ├── middleware/authorize.ts        (NEW)
│   ├── api/*.routes.ts                (REWRITTEN)
│   ├── main.ts                        (UPDATED)
│   └── __tests__/customer.integration.test.ts  (NEW)
│
├── gst-service/src/
│   ├── middleware/authenticate.ts     (NEW)
│   ├── middleware/authorize.ts        (NEW)
│   ├── api/gst.routes.ts              (REWRITTEN)
│   └── main.ts                        (UPDATED)
│
├── accounting-service/src/
│   ├── middleware/authenticate.ts     (NEW)
│   ├── middleware/authorize.ts        (NEW)
│   ├── api/*.routes.ts                (REWRITTEN)
│   ├── main.ts                        (UPDATED)
│   └── __tests__/accounts.integration.test.ts  (NEW)
│
├── tenant-service/src/
│   ├── middleware/authenticate.ts     (NEW)
│   ├── middleware/authorize.ts        (NEW)
│   ├── api/tenant.routes.ts           (UPDATED — authenticate preHandler + real userId)
│   ├── api/organization.routes.ts     (UPDATED — authenticate + ORG_SETTINGS_EDIT)
│   ├── api/branch.routes.ts           (UPDATED — authenticate + BRANCH_MANAGE)
│   ├── api/approval.routes.ts         (UPDATED — authenticate preHandler)
│   ├── domain/TenantProvisioner.ts    (UPDATED — workflow seed, email HTTP call)
│   ├── main.ts                        (UPDATED — /api/v2/ prefix)
│   └── __tests__/tenant.integration.test.ts  (NEW)
│
├── scheduler-service/src/
│   └── domain/ImportEngine.ts         (UPDATED — real entity inserts in execute())
│
└── web-frontend/src/
    ├── App.tsx                        (UPDATED — PermissionRoute on all 21 pages)
    ├── constants/permissions.ts       (NEW)
    ├── hooks/usePermission.ts         (NEW)
    └── components/PermissionGate.tsx  (NEW)
```

---

## 4. PUBLIC INTERFACES

### 4.1 Authentication Contract
All Phase 2 services verify RS256 JWT signed by the auth-service private key.
JWT payload must include: `{ sub, tenantId, email, roles, permissions }`.
`JWT_PUBLIC_KEY` env var must be set to the RSA public key (PEM format).

### 4.2 Field Encryption Contract
```typescript
// packages/shared-utils/src/encryption.ts
encryptField(plaintext: string, keyHex: string): string  // returns "ivB64:tagB64:ctB64"
decryptField(encoded: string, keyHex: string): string    // reverses the above
```
Key: 32 bytes, hex-encoded. Set via `FIELD_ENCRYPTION_KEY` env var.

### 4.3 API Prefix Contract
All business endpoints are now under `/api/v2/`. Health is at `/health`, metrics at `/metrics`.

### 4.4 Route Signatures (Phase 2 services)
```typescript
// All Phase 2 route functions now accept PlatformContextFactory
async function xyzRoutes(fastify: FastifyInstance, ctxFactory: PlatformContextFactory): Promise<void>
```

---

## 5. INTEGRATION POINTS FOR PHASE 3

### 5.1 What Fix Audit provides to Phase 3
- All Phase 2 APIs are authenticated and permission-guarded — Phase 3 routes must follow the same middleware pattern
- `PlatformContextFactory` is now the standard dependency injection mechanism — use it for all new Phase 3 routes
- Field encryption utilities available in `@erp/utils` — use for any sensitive Phase 3 fields
- Integration test pattern established — copy the `describe.skipIf(!DB_URL)` approach

### 5.2 What Phase 3 must do on start
- Import `PlatformContextFactory` from `@erp/sdk`
- Follow signature `(fastify: FastifyInstance, ctxFactory: PlatformContextFactory)`
- Register routes under `/api/v2/` in main.ts
- Add `middleware/authenticate.ts` and `middleware/authorize.ts` (copy from any Phase 2 service)
- Use `ctx.events.publishInTransaction()` for all state-changing operations
- Write temporal history for all entity updates

### 5.3 Notification Service
`NOTIFICATION_SERVICE_URL` is referenced by TenantProvisioner. Phase 3 or a future notification phase must implement `POST /api/v2/notifications/send` with body `{ templateKey, recipient: { email }, variables }`.

---

## 6. TESTS

### 6.1 Test Coverage
| Suite | Coverage | Status |
|---|---|---|
| Integration — Item (inventory-service) | 3 tests: create, OL, tenant isolation | ✅ Ready (requires DB) |
| Integration — Customer (sales-service) | 3 tests: create, encryption, OL | ✅ Ready (requires DB) |
| Integration — Accounts (accounting-service) | 3 tests: create, duplicate rejection, cross-tenant | ✅ Ready (requires DB) |
| Integration — Tenant provisioning | 2 tests: provision saga, suspend/activate | ✅ Ready (requires DB) |

### 6.2 Running Tests
```bash
DATABASE_URL=postgresql://erp:erp_password@localhost:5432/erp pnpm test
# Or per-service:
cd apps/inventory-service && DATABASE_URL=... pnpm test
```

---

## 7. KNOWN ISSUES AND TECHNICAL DEBT

| Issue | Severity | Resolution Plan |
|---|---|---|
| jose dependency not listed in Phase 2 service package.json | Medium | Add `jose` to devDependencies of inventory/sales/gst/accounting services; pnpm hoisting works in dev but explicit dep is cleaner |
| employee/opening-stock import entities not fully implemented | Low | ImportEngine.execute() logs them as success but does not insert; Phase 3 HR module will implement proper employee import |
| Notification service not yet implemented | Medium | TenantProvisioner falls back gracefully when NOTIFICATION_SERVICE_URL not set |
| TenantProvisioner uses raw SQL for user_roles/user_branches | Low | Drizzle schema for these join tables should be added and used in Phase 3 auth work |
| Auth service RBAC hooks not installed in tenant-service approval routes | Low | Approval routes use `authenticate` but not specific permission checks; add APPROVAL_APPROVE in Phase 3 |

---

## 8. FEATURE FLAGS USED

No new feature flags were added in this session. The existing flags seeded during tenant provisioning remain unchanged.

---

## 9. PERMISSIONS ADDED

```typescript
// packages/shared-types/src/permissions.ts — Phase 2 additions (FA.2)
WAREHOUSE_MANAGE: 'WAREHOUSE_MANAGE',
CUSTOMER_EDIT: 'CUSTOMER_EDIT',
ITEM_EDIT: 'ITEM_EDIT',
SUPPLIER_EDIT: 'SUPPLIER_EDIT',
SUPPLIER_BANK_VIEW: 'SUPPLIER_BANK_VIEW',
OPENING_BALANCE_LOCK: 'OPENING_BALANCE_LOCK',
ORG_SETTINGS_EDIT: 'ORG_SETTINGS_EDIT',
BRANCH_MANAGE: 'BRANCH_MANAGE',
GST_COMPUTE: 'GST_COMPUTE',
USER_MANAGE: 'USER_MANAGE',
```

---

## 10. ENVIRONMENT VARIABLES ADDED

```
# Field Encryption (AES-256-GCM)
FIELD_ENCRYPTION_KEY=<32 bytes hex>  # generate: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# Notification Service
NOTIFICATION_SERVICE_URL=http://localhost:3020

# Required for all Phase 2 services (if not already set)
JWT_PUBLIC_KEY=<RS256 public key PEM>
REDIS_URL=redis://localhost:6379
KAFKA_BROKERS=localhost:29092
```

---

## 11. DEPLOYMENT NOTES

```
No new DB migrations generated in this session (FA.1 was the migration run).
Migration 0000_worried_blue_marvel.sql must be applied before Phase 2 services start.
FIELD_ENCRYPTION_KEY must be set and MUST NOT change after first data is encrypted.
JWT_PUBLIC_KEY must match auth-service JWT_PRIVATE_KEY.
Zero-downtime deploy: YES (all changes are additive except route prefix change)
Route prefix change (/api/v2/): frontend proxy/nginx rules must be updated to match.
```

---

## 12. WHAT IS NOT DONE

| Item | Why Deferred | Target Phase |
|---|---|---|
| Notification service implementation | Out of scope for fix audit | Phase 3 or dedicated notification phase |
| employee/opening-stock ImportEngine inserts | HR entities belong to Phase 3+ | Phase 3 HR module |
| jose added to individual service package.json | pnpm hoisting covers it for now | Before production build |
| Redis cluster config for PlatformContextFactory | Dev uses single-node Redis | Infrastructure phase |
| E2E tests via Fastify inject | Unit/integration sufficient for now | Phase 3 testing sprint |

---

## 13. ARCHITECTURE DECISIONS MADE

| Decision | Why | Alternatives Considered |
|---|---|---|
| Route-level PermissionGate in App.tsx (not per-component) | One change point, covers all 21 pages | Per-page wrapping (21 files changed) |
| CJS-compatible drizzle-schema.ts entry file | drizzle-kit CJS bundler cannot resolve .js extensions | Glob pattern (also failed) |
| PlatformContextFactory as route dependency | Enables per-request ctx with tenant scope | Passing db directly (loses audit/events wiring) |
| Single background agent for 10 route file rewrites | 6 fixes × 10 files = 60 ops; batch saves 50 operations | Sequential per-fix approach |
| encryptField/decryptField in @erp/utils (not @erp/sdk) | Utils is lighter, no Redis/Kafka dependency | Adding to SDK |

---

## 14. RISKS FOR PHASE 3

| Risk | Impact | Mitigation |
|---|---|---|
| Field encryption key rotation | All ciphertext becomes unreadable if key changes | Document key as immutable; add key rotation plan before go-live |
| Outbox events not consumed | Events pile up in outbox_events table | Ensure Kafka relay worker is running before Phase 3 load testing |
| Optimistic lock concurrency under load | High-concurrency updates will retry-loop | Add retry logic in Phase 3 service clients |

---

## 15. FINAL ARCHITECTURE SUMMARY

The Fix Audit session patched 15 critical gaps across Phases 0–2 of the NEXORAA ERP. All Phase 2 microservices (inventory, sales, gst, accounting) now use RS256 JWT authentication with RBAC permission guards on every route, PlatformContextFactory for per-request tenant-scoped context, the outbox pattern for event publishing, and audit logging on all write operations. Sensitive fields (GSTIN, PAN, bank accounts) are encrypted at rest using AES-256-GCM. Route paths are uniformly prefixed with `/api/v2/`. The frontend enforces permission-based access for all 21 pages via a `PermissionRoute` wrapper in the router. The tenant provisioner now seeds workflow definitions and rule templates during tenant creation and calls the notification service for welcome emails. All integration tests use real PostgreSQL with `describe.skipIf(!DB_URL)` for CI safety.

---

*Generated by: Claude Sonnet 4.6 | Date: 2026-06-29 | Next Phase: Phase 3 — Sales Transactions*
