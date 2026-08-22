# 17 — Evidence Index

Consolidated file:line citation trail for the audit's key findings, organized by severity, for fast navigation without re-reading the full topic documents. All paths are relative to `e:\NEXORAA\sales-erp-app`. All citations were independently read/traced during this audit, not copied from a prior report.

## BLOCKERS

| Finding                                 | Primary evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Manufacturing capabilities unenforced   | `apps/production-service/src/api/bom.routes.ts:42,60,70,81,94,106`; `mrp.routes.ts:44,54`; `routing.routes.ts:33,50,60,73`; `work-center.routes.ts:34,51,60,71`; `production-order.routes.ts:75,90,99,128,138,152,162,173,183,194,211` (all `requirePermission` only); `apps/tenant-service/src/rbac/role-defaults.ts:18-19` (`TENANT_SCOPED_PERMISSIONS` wildcard); `packages/shared-types/src/capability-registry.ts:57-132` (registry entries defined but unconsumed here) |
| Billing plan-change entitlement clobber | `apps/tenant-service/src/api/billing.routes.ts:79-84`; `apps/tenant-service/src/domain/BillingService.ts:38-82`; `apps/tenant-service/src/domain/TenantProvisioner.ts:253-262,483`; `apps/tenant-service/src/rbac/vertical-defaults.ts:37-44,48-65`; `packages/db-client/migrations/0040_pg027_billing_entitlements.sql:55-56`; test gap: `apps/tenant-service/src/__tests__/business-type-capability-consistency.test.ts:61-73`                                              |
| Manufacturing not provisionable         | `apps/tenant-service/src/domain/TenantProvisioner.ts:92-97`; absent from `packages/db-client/migrations/0169-0183*.sql`; test (DB-gated, plausibly unrun): `apps/tenant-service/src/__tests__/business-type-capability-consistency.test.ts:58`                                                                                                                                                                                                                                |

## HIGH findings

| Finding                                    | Primary evidence                                                                                                                                                                                                                                                            |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| RLS coverage ≈2-3%                         | `packages/db-client/migrations/0176_enable_rls_invoices.sql`, `0177_enable_rls_journal_entries.sql`, `0178_enable_rls_payments.sql` (only 3 migrations enable RLS, 8 physical relations); `packages/db-client/src/schema/*.ts` (270 `pgTable` exports, 259 with `tenantId`) |
| Tenant-suspension no-op                    | grep for `createTenantContextMiddleware` across every service's `main.ts` — zero registrations; contrast `apps/tenant-service/src/domain/BillingService.ts:220-253` (`suspendForNonPayment`, correctly audit-logged but not enforced downstream)                            |
| Raw SQL injection-shaped defect            | `apps/accounting-service/src/consumers/InvoiceAccountingConsumer.ts:92-99` (untagged template) vs. `apps/accounting-service/src/consumers/PaymentAccountingConsumer.ts:110-113` (correct `sql` tag)                                                                         |
| `assignPlanEntitlements` not transactional | `apps/tenant-service/src/domain/BillingService.ts:38-82` (no `db.transaction`); contrast `apps/tenant-service/src/api/branch.routes.ts` (uses `db.transaction`)                                                                                                             |
| Feature-flag cache no push-invalidation    | `packages/platform-sdk/src/feature-flags.ts:11-12,113-117`; absence of `.invalidate(` in `BillingService.ts`/`TenantProvisioner.ts`                                                                                                                                         |
| Consumer-side DLQ invisibility             | `packages/platform-sdk/src/events.ts:205-224`; contrast the genuinely-fixed publish-side path at `apps/event-service/src/outbox/OutboxRelayWorker.ts:187-217` and `apps/event-service/src/api/dlq.routes.ts:132-200`                                                        |
| Schema registry passive                    | `apps/event-service/src/api/schema-registry.routes.ts` (real logic) vs. zero references from `OutboxRelayWorker.ts`/`packages/platform-sdk/src/events.ts`                                                                                                                   |
| `KafkaTopics` dead/duplicated              | `packages/shared-types/src/events.ts:69-77`; `apps/event-service/src/outbox/OutboxRelayWorker.ts:153`; `apps/automation-service/src/main.ts:42-49`; `apps/search-service/src/consumers/eventEntityMap.ts:127-132`; `apps/accounting-service/src/main.ts:162-181`            |
| Entitlement changes unaudited              | `apps/auth-service/src/routes/feature-flags.routes.ts:44-79`; `apps/tenant-service/src/domain/BillingService.ts:38-70` (both lack `auditLog` writes); contrast `tenant.routes.ts:44-57,238-250` (tenant lifecycle, correctly audited)                                       |
| RBAC denials unlogged                      | `apps/ai-copilot-service/src/middleware/authorize.ts:12-17` (representative of an identical pattern in all 15 services); contrast capability-denial logging at `packages/platform-sdk/src/capability-guard.ts:51-62`                                                        |
| Scheduler O(N tenant) startup loop         | `apps/scheduler-service/src/main.ts:107-131` (loop), `:158` (health route registered after), `:202` (listen)                                                                                                                                                                |

## Confirmed-correct evidence (no gap — cited to support the "not invented" findings)

| Claim                                              | Primary evidence                                                                                                                                                                           |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| tenantId always JWT-derived                        | `packages/platform-sdk/src/auth.ts:26-47`; verified in `apps/accounting-service`, `apps/ai-copilot-service`, `apps/search-service`, `apps/scheduler-service` `authenticate.ts`/route files |
| Transactional outbox real                          | `apps/sales-service/src/domain/InvoiceService.ts:369,770-780,824,979`; `apps/accounting-service/src/domain/JournalEngine.ts:140-146`                                                       |
| Kafka idempotency atomic                           | `packages/platform-sdk/src/events.ts:166-204` (UPSERT-as-claim, keyed `(eventId, consumerService)`)                                                                                        |
| Search tenant isolation structural                 | `apps/search-service/src/domain/SearchEngine.ts:540-541,614,636,774`                                                                                                                       |
| Report tenant safety                               | `apps/report-service/src/domain/ReportEngine.ts:95-151` (explicit `WHERE tenant_id` + `withTenantConnection`)                                                                              |
| AI Copilot no direct DB access                     | `apps/ai-copilot-service/src/domain/ToolRegistry.ts:32-56` (gateway-proxy pattern with user's own JWT)                                                                                     |
| POS/HR_PAYROLL/INVENTORY_BATCH fully wired         | `apps/sales-service/src/api/pos.routes.ts` (16 call sites); `apps/hr-service/src/api/payroll.routes.ts` (13 call sites); `apps/inventory-service/src/api/stock.routes.ts:279-282`          |
| CRM/O2C split complete                             | zero orphan-import grep hits in `apps/sales-service/src`; `apps/crm-service/src/main.ts:156-197` (22 route registrations); `tsc --noEmit` clean on both services                           |
| Manufacturing domain logic generic                 | `apps/production-service/src/domain/BOMService.ts` (full read, 331 lines, zero industry strings); `RoutingService.ts`/`WorkCenterService.ts` (zero grep hits for vertical/industry terms)  |
| Business Profile Foundation schema/migration match | `packages/db-client/migrations/0170_business_profile_foundation.sql` vs. `packages/db-client/src/schema/tenant.ts:290-316`                                                                 |

## Executed commands (not just static reading)

- `git status --short`, `git diff --stat` — run directly against the working tree.
- `pnpm --filter @erp/crm-service type-check` — PASS.
- `pnpm --filter @erp/crm-service test` — 130 passed / 0 failed / 301 skipped.
- `pnpm --filter @erp/sales-service type-check` — PASS.
- `pnpm --filter @erp/production-service type-check` — PASS.
- `pnpm --filter @erp/production-service test` — 128 passed / 0 failed / 56 skipped.
- `pnpm --filter @erp/tenant-service type-check` — PASS.

## What was explicitly NOT verified (stated, not silently assumed)

- Live-database behavior of RLS policies under a real concurrent query (no reachable Postgres this session).
- Whether a production deployment's network policy actually restricts direct access to service ports / internal routes (nothing in-repo defines one).
- Full execution of DB-gated integration tests across the whole new-work surface (only `crm-service` and `production-service` non-DB suites were run).
- Per-endpoint RBAC re-verification of every downstream route the AI Copilot's tools call.
- `14-api-strategy.md`'s exact historical service-routing count claim.
- Line-by-line re-verification of every sentence in ~12 lightly-touched planning docs (00, 01, 02, 03, 05, 08, 09, 10, 11, 12, 15, 20 of the `multi-industry-platform` set) — these were read at header/framing level and cross-referenced indirectly through deeper checks of docs 06, 07, 16-19, and the phase implementation docs.
