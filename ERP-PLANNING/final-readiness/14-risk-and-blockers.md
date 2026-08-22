# 14 — Risk and Blocker Register

Consolidated across all 8 verification passes. This is the authoritative blocker list referenced by `00-executive-verdict.md` and `18-final-readiness-review.md`.

## BLOCKERS (3) — must fix before honestly claiming multi-industry readiness

### BLOCKER 1 — Manufacturing capabilities have zero server-side enforcement

**What**: `BOM`, `WORK_CENTERS`, `PRODUCTION_ORDER`, `ROUTING`, `MRP` are registered plan-gated capabilities, but no route in `apps/production-service/src/api/` calls `requireCapability()` — only `requirePermission()`. Every tenant's OWNER/ADMIN role holds every permission by default, so any tenant on any plan can call these endpoints today.

**Where**: `apps/production-service/src/api/{bom,mrp,routing,work-center,production-order}.routes.ts`; `apps/tenant-service/src/rbac/role-defaults.ts:18-19`.

**Affects**: entitlement, RBAC, backend enforcement, extensibility integrity.

**Fix scope**: narrow, mechanical — add `requireCapability('BOM', ...)` etc. to 5 route files, following the exact pattern already proven on `stock.routes.ts:279-280`. No architecture change.

### BLOCKER 2 — Billing plan-change silently reintroduces the vertical-default-override bug

**What**: `PATCH /admin/tenants/:id/plan` → `BillingService.assignPlanEntitlements` re-enables `pos.enabled` for a Distribution/Manufacturing tenant on a plan upgrade to GROWTH/ENTERPRISE, because the prior fix for this exact bug (`TenantProvisioner.reapplyVerticalFeatureFlagOverrides`) is only called during initial provisioning, never on plan change.

**Where**: `apps/tenant-service/src/api/billing.routes.ts:83`; `BillingService.ts:38-82`; `TenantProvisioner.ts:253-262`; `vertical-defaults.ts:37-65`; `packages/db-client/migrations/0040_pg027_billing_entitlements.sql:55-56`.

**Affects**: entitlement integrity, billing correctness, data/business-state safety, multi-industry isolation guarantees.

**Fix scope**: narrow — call the existing reapply-overrides logic (or an equivalent) from the plan-change route; wrap `assignPlanEntitlements` in a transaction (also HIGH #4 below); add a regression test exercising the plan-change path specifically (the existing test only covers provisioning). No architecture change.

### BLOCKER 3 — Manufacturing tenants cannot be provisioned through the standard flow

**What**: no migration seeds a `business_types` row for `code='MANUFACTURING'`; `TenantProvisioner.provision()` throws unconditionally for any new Manufacturing tenant.

**Where**: `apps/tenant-service/src/domain/TenantProvisioner.ts:92-97`; absent from all migrations 0169-0183.

**Affects**: industry extensibility, data integrity, the platform's own proof case for its central multi-industry claim.

**Fix scope**: trivial — one data migration mirroring migration 0172's pattern for Distribution. No architecture change.

---

## HIGH-severity findings (11) — should fix before scaling tenant count or onboarding a 5th industry

| #   | Finding                                                                                                                                                       | Area                        | Where                                                                                                                        |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| H1  | RLS covers ~7 of ~250-260 tenant-scoped tables (≈2-3%); remaining tables have zero DB-level backstop, relying entirely on manual `WHERE tenant_id` discipline | Multi-tenancy               | `packages/db-client/migrations/0176-0178`; schema-wide                                                                       |
| H2  | `createTenantContextMiddleware` (tenant-suspension enforcement) registered in zero services — confirmed no-op                                                 | Multi-tenancy, security     | all `main.ts` files (absence)                                                                                                |
| H3  | `InvoiceAccountingConsumer.ts` raw unparameterized SQL string interpolation (sibling does it correctly)                                                       | Security (defense-in-depth) | `apps/accounting-service/src/consumers/InvoiceAccountingConsumer.ts:92-99`                                                   |
| H4  | `assignPlanEntitlements` not transaction-wrapped — partial-write risk (compounds Blocker 2)                                                                   | Entitlement                 | `BillingService.ts:38-82`                                                                                                    |
| H5  | Feature-flag cache has no push-invalidation from the billing write path — up to 5-min stale window after any entitlement change                               | Entitlement                 | `packages/platform-sdk/src/feature-flags.ts` + `BillingService.ts`/`TenantProvisioner.ts` (absence of `.invalidate()` calls) |
| H6  | No regression test exists for Blocker 2's exact code path                                                                                                     | Testing                     | `apps/tenant-service/src/__tests__/business-type-capability-consistency.test.ts`                                             |
| H7  | Consumer-side event-processing failures (`inbox_events.status='FAILED'`) have zero admin visibility/replay path outside search-service's own exception        | Events, operability         | `packages/platform-sdk/src/events.ts:205-224`                                                                                |
| H8  | Schema registry is passive — not enforced anywhere in the publish/consume hot path                                                                            | Events, data integrity      | `apps/event-service/src/api/schema-registry.routes.ts` (isolation from `OutboxRelayWorker`/`PlatformEventConsumer`)          |
| H9  | `KafkaTopics` interface still exported/unused/inconsistent; real topic-derivation logic duplicated in 4 places                                                | Events, maintainability     | `packages/shared-types/src/events.ts:69-77` + 4 independent reimplementations                                                |
| H10 | Entitlement/capability grant mutations never audit-logged — "why does Tenant X have Capability Y" is unanswerable                                             | Observability               | `apps/auth-service/src/routes/feature-flags.routes.ts:44-79`; `BillingService.ts:38-70`                                      |
| H11 | RBAC permission denials never logged/metered anywhere — "why was User Z denied" is unanswerable for ordinary RBAC                                             | Observability               | identical pattern in all 15 services' `authorize.ts`                                                                         |
| H12 | scheduler-service startup does a sequential O(N tenants × ~30 jobs) loop before the health route is reachable                                                 | Scalability, operability    | `apps/scheduler-service/src/main.ts:107-131`                                                                                 |

## MEDIUM-severity findings (11)

Direct-service-bypass structurally possible, contingent on undefined production network policy · single shared internal-API key across 9 services · RBAC/vertical mechanism closed-world (5th vertical needs code changes across 4 files) · 15-minute stale-JWT window on permission changes · `ProductionOrderService`/`JobWorkOrderService` code duplication · `PricingResolutionService` not positioned as a shared platform capability · two incompatible outbox wire-shapes (already caused one silent-data-loss bug) · BOM/WORK_CENTERS not gated in nav either (frontend symptom of Blocker 1) · no platform-wide Idempotency-Key convention · `requireCapability()`'s dead L1 cache tier · AI Copilot tool registry is hardcoded, not a true registry, with no capability-filtering.

## LOW / DOC-ONLY findings (11)

Capability cycle-protection is test-time only · `applicableBusinessTypes` metadata unused at runtime · Distribution pricing / Partner Portal outside the capability system's scope entirely (by design, not broken) · `items.isFabricItem`/`fabricWidth` bolted onto shared table · `items.hsnCode` NOT NULL (India-specific, latent multi-country constraint) · `default-accounts.ts` hardcoded vertical ternary · migration 0177's stale "unscoped Kafka consumer" comment · apiV2 versioning not fully uniform (2 of 17 upstreams, documented in-progress) · frontend `PermissionRoute` lacks capability check (backend closes it) · `enabledCapabilities` frontend staleness (no security impact) · report "registry" is metadata-only, needs hand-written SQL per report.

## Hygiene finding

`.qa-tmp-index-list.txt` and `apps/web-frontend/.qa-scratch/` (containing a live QA-tenant JWT) are untracked debug artifacts that should be gitignored and removed before any commit — MEDIUM, not a functional risk (token is scoped to the known `owner@qa-e2e.local` test tenant).

## Risk-register cross-check (from `02-plan-vs-implementation.md`)

The project's own `17-risk-register.md` correctly anticipated and tracked several risks that materialized and were closed (R1, CRM/O2C split deprioritization) or held (R3, R4, R5). One remains only **partially mitigated**: R2 (`vertical`/`business_type_id` drift) — the backfill is correct, but no DB trigger or lint rule was ever built to enforce ongoing sync, despite the register's own stated mitigation plan calling for one. This is a latent, currently low-probability risk (only one write path exists today) worth closing before the write-path count grows.

## What is explicitly NOT a blocker or risk (confirmed clean)

Tenant isolation at the JWT/application layer · transactional outbox correctness · Kafka idempotency/dedup · search-service tenant isolation · report-service tenant isolation · AI Copilot tenant isolation · CRM/O2C split completeness · Manufacturing/Distribution domain-logic genericity · backward compatibility of existing cloth/grocery flows · migration bookkeeping · error-response shape consistency · API surface reusability pattern.
