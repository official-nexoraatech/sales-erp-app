# NEXORAA ERP — Complete Architecture & Engineering Audit

**Date:** 2026-07-03 | **Scope:** Full monorepo — 17 apps, 8 shared packages, all 20 completed ES phases
**Method:** Baseline review of `ERP_MASTER_SPEC.md`, `TECH_AUDIT.md`, `PHASE_FIX_AUDIT_P0_P2.md`, all `ES-01..ES-20` audit prompts + completion reports, chaos/DR/query-optimization reports — followed by 7 independent parallel source-code audits (financial core, operations core, identity & security, platform SDK & shared packages, reporting/jobs/search/notifications, frontend, infra/DevOps), each verifying claims against live code rather than trusting documentation.

> This report supersedes nothing — it complements `TECH_AUDIT.md` (technology inventory) and the `ES-*` completion reports (point-in-time fixes). Where this audit found a previously-claimed fix has regressed or was never fully applied, that is called out explicitly.

---

## 0. Executive Summary

The architecture **as designed** (`ERP_MASTER_SPEC.md`) is sound and unusually rigorous for this project stage — outbox/inbox, saga orchestration, event sourcing, optimistic locking, tenant isolation, and a mandatory `PlatformContext` SDK are all correctly *specified*. The team has also done real, evidenced hardening work: 8/8 chaos experiments passed, a DR drill beat its RTO/RPO targets, and 7 query-performance fixes are verified present with `EXPLAIN ANALYZE` evidence.

However, this audit found that **implementation has drifted from the spec in ways that reintroduce exactly the failure modes the architecture was built to prevent**, plus several issues that are new regressions or were never caught by prior phase audits:

- **Two live, unauthenticated/unauthorized paths to full platform compromise**: the tenant-admin API has routes with no auth at all, and no service in the codebase implements API-gateway-level protection (it's a 4-line stub).
- **Financial-data corruption under ordinary concurrency**: lost-update races in FIFO/WACC valuation, payment allocation, and stock adjustment mean two simultaneous requests can silently corrupt stock quantities and ledger balances — no error, no retry, just wrong numbers.
- **The Outbox pattern — the architecture's core correctness guarantee — is violated in accounting-service**, and the **Inbox pattern has a TOCTOU race** that lets a redelivered Kafka event double-post a journal entry.
- **The Saga Orchestrator does not exist.** The admin "retry"/"compensate" buttons only flip a status label; nothing re-executes.
- **CI cannot build 12 of 13 backend service images** (Dockerfiles missing), and **Kubernetes manifests exist for exactly 1 of 15 services** — "production readiness" claims for the platform as a whole are not supported by what's actually deployable.
- **Two frontend pages are dead on arrival**: Customers/Suppliers/Items lists always render empty due to a double-unwrapped API envelope, and there is no JWT refresh flow, so every session breaks ~15 minutes after login.

None of this negates the genuine engineering quality visible elsewhere (the outbox relay worker, the circuit breaker, the encryption utility, and the account-lockout/2FA/audit-log security work are all correctly built, not stubs). The problem is **consistency**: strong patterns exist right next to violations of those same patterns, often in the same file.

**Bottom line: NOT production-ready.** See §10.

---

## 1. Scores

| Dimension | Score /100 | Basis |
|---|---|---|
| **Architecture Fidelity** (spec vs. reality) | **58** | Outbox/Inbox/Optimistic-Locking patterns exist and are *mostly* followed, but are violated in specific high-traffic paths (accounting outbox, FIFO/WACC locking); Saga Orchestrator is entirely absent; Service Mesh is 2 scaffold files. |
| **Code Quality** | **60** | Verified correct patterns (atomic stock deduction, append-only ledger, circuit breaker, encryption) coexist with copy-paste regressions (double-unwrap envelope bug) and unguarded read-then-write races. |
| **Maintainability** | **55** | Duplicate report engines have drifted again post-ES-17 fix; dead packages (`event-bus-client`) still present; stale **compiled artifacts committed to git** inside `db-client/src` risk silently wrong test behavior; docs (chaos/DR reports) describe mechanisms (notification retry architecture, report-service Redis cache) that don't match the code. |
| **Scalability** | **50** | DB indexing is genuinely strong (7 verified fixes); but distributed locking is fully built and has **zero callers anywhere**, and K8s resource/HPA config exists for only 1/15 services — there is no scaling story for the other 14 yet. |
| **Security** | **32** | Multiple critical, unauthenticated or unauthorized paths to tenant takeover and account takeover (§2, §7). This is the dimension with the most severe, most exploitable findings. |
| **Performance** | **68** | Best-scoring dimension: verified index fixes with before/after evidence, no N+1 found in reporting/search, Puppeteer resource handling is correct, chaos-tested DB latency tolerance. |
| **Enterprise Readiness** | **42** | 2FA, RBAC primitives, audit logging, feature flags, and DR/chaos discipline are real and enterprise-grade. But Saga, Service Mesh, tracing, and the API gateway — all explicitly promised as enterprise differentiators — do not function. |
| **Technical Debt** | **46** | Dead/stub packages, stale compiled artifacts in git, doc-vs-code drift across 4 separate reports, and unimplemented TODOs (`// TODO Phase 6: check financial_entries...`) left in security-relevant paths. |
| **Production Readiness** | **28** — **NOT READY** | Blocked by: unauthenticated admin API, CI can't build most images, no K8s manifests for 14/15 services, financial race conditions, two dead frontend pages, no session refresh. See §10 for the gating list. |

**Overall Weighted Score: ~48/100** (Security and Production Readiness are weighted heaviest given the domain — financial/multi-tenant SaaS — and both are the lowest scores.)

---

## 2. Critical Findings (fix before any further feature work)

| # | Finding | Domain | Files |
|---|---|---|---|
| C1 | ✅ FIXED — Tenant-admin API (`/admin/tenants`, list/provision) has **zero auth middleware** on some routes | Security | `apps/tenant-service/src/api/tenant.routes.ts:23,50,61` — see [ES-21_COMPLETION.md](phase-completions/ES-21_COMPLETION.md) |
| C2 | ✅ FIXED — Tenant suspend/activate/close has `authenticate` but **no permission check and no ownership check** — any authenticated user from any tenant can suspend/close any other tenant | Security | `apps/tenant-service/src/api/tenant.routes.ts:69,91,105` — see [ES-21_COMPLETION.md](phase-completions/ES-21_COMPLETION.md) |
| C3 | ✅ FIXED — auth-service user-management routes (list/create/update/delete/**reset-password**/lock) have **no permission checks** — any authenticated user can reset another user's password (account takeover) or self-promote via arbitrary `roleIds` | Security | `apps/auth-service/src/routes/users.ts` (all routes; `checkOwnerPermission()` defined at :55, never called) — see [ES-21_COMPLETION.md](phase-completions/ES-21_COMPLETION.md) |
| C4 | ✅ FIXED — FIFO layer consumption and WACC cost updates are read-then-write with **no atomic guard and no lock** — concurrent invoices/GRNs silently corrupt stock/valuation | Data Integrity | `apps/sales-service/src/domain/ValuationService.ts:53-82`, `apps/purchase-service/.../ValuationService.ts:25-58`, `apps/inventory-service/.../ValuationService.ts:29-101` — see [ES-23_COMPLETION.md](phase-completions/ES-23_COMPLETION.md) |
| C5 | ✅ FIXED — Payment allocation allows silent over-allocation (excess money vanishes from the books) and is a non-atomic balance-update race | Data Integrity | `apps/sales-service/src/domain/PaymentService.ts:80-115` — see [ES-23_COMPLETION.md](phase-completions/ES-23_COMPLETION.md) |
| C6 | ✅ FIXED — Outbox event writes in accounting-service happen in a **separate transaction** from the business write — violates the Golden Rule of §4.4; a crash between the two loses the event permanently with no compensating mechanism | Architecture | `apps/accounting-service/src/api/accounts.routes.ts:114-125,151-171`, `opening-balances.routes.ts:399-406` — see [ES-24_COMPLETION.md](phase-completions/ES-24_COMPLETION.md) |
| C7 | ✅ FIXED — Inbox idempotency check has a TOCTOU race: a redelivered Kafka event can be processed twice (e.g., a journal posted twice, overstating revenue) because the consumer doesn't verify its own insert actually won the conflict before running the handler | Architecture | `packages/platform-sdk/src/events.ts:229-264` — see [ES-24_COMPLETION.md](phase-completions/ES-24_COMPLETION.md) |
| C8 | ✅ FIXED — `@erp/db` has **stale compiled `.js`/`.d.ts` files committed to git** inside `src/`, out of sync with current `.ts` (confirmed missing 3 real exports); explicit-extension barrel re-exports risk resolving to the stale files under Vite/Vitest outside test mocks | Maintainability | `packages/db-client/src/schema/index.ts:136`, `src/index.ts:4`, plus committed `auth.js`, `auth.d.ts`, `index.js`, `index.d.ts` — same pattern also found and fixed in `shared-types`, `config`, `logger` — see [ES-25_COMPLETION.md](phase-completions/ES-25_COMPLETION.md) |
| C9 | ✅ FIXED — Customer/Supplier/Item list pages (and Fixed Asset account picker) **double-unwrap** the API response envelope — these pages always render empty regardless of actual data. Audit under-scoped this: the same bug was present in ~100 occurrences across ~55 files, essentially every list/detail page in the app | Frontend | `apps/web-frontend/src/pages/customers/CustomersPage.tsx:37`, `suppliers/SuppliersPage.tsx:23`, `items/ItemsPage.tsx:32`, `accounting/FixedAssetDetailPage.tsx:82` (+ ~96 more) — see [ES-22_COMPLETION.md](phase-completions/ES-22_COMPLETION.md) |
| C10 | ✅ FIXED — No JWT refresh flow exists in web-frontend — every user's session breaks with 401s ~15 minutes after login; `refreshToken` is stored but never used | Frontend | `apps/web-frontend/src/api/client.ts`, `store/auth.store.ts`, `api/endpoints.ts:1-14` — see [ES-22_COMPLETION.md](phase-completions/ES-22_COMPLETION.md) |
| C11 | ✅ FIXED — CI build matrix references per-service Dockerfiles that **don't exist for 12 of 13 services** — the build stage (and downstream Trivy scan) fails for nearly the whole platform | CI/CD | `.github/workflows/ci.yml:125-182,236-274` — 13 Dockerfiles authored (all backend services except api-gateway, descoped — see H2); CI matrices updated to match; also fixed 3 latent bugs in `auth-service/Dockerfile` itself (stale cache-client references, missing app-level `node_modules`/`package.json` copies) that meant it had never actually been build-tested — see [ES-27_COMPLETION.md](phase-completions/ES-27_COMPLETION.md) |

---

## 3. High-Severity Findings

| # | Finding | Domain | Files |
|---|---|---|---|
| H1 | ✅ FIXED — search-service admin endpoints (`reindex`, `delete index`, `stats`) trust `tenantId` from the **URL param**, not the JWT — any user with `SEARCH_REINDEX` permission can wipe or read another tenant's search index | Security | `apps/search-service/src/api/search.routes.ts:52-125` — see [ES-21_COMPLETION.md](phase-completions/ES-21_COMPLETION.md) |
| H2 | ✅ FIXED (via honest descope) — `api-gateway` is a literal 4-line stub (`export {}`) yet is referenced as if live in Kubernetes NetworkPolicy and Prometheus scrape config — no reverse proxy, JWT validation, rate limiting, or circuit breaking exists at the edge | Architecture/Security | `apps/api-gateway/src/main.ts`; `infrastructure/k8s/network-policy.yaml:30-54`; `infrastructure/docker/prometheus/prometheus.yml:88-92` — dead references removed from both files and the CI matrix; services are reached directly, each independently enforcing its own auth (ES-21); building the real gateway proposed as follow-up "ES-28" — see [ES-27_COMPLETION.md](phase-completions/ES-27_COMPLETION.md) |
| H3 | ⚠️ PARTIALLY FIXED — `SagaOrchestrator` does not exist anywhere in the repo; admin "retry"/"compensate" endpoints only change a status label and never re-execute or compensate any step | Architecture | `apps/event-service/src/api/saga.routes.ts:154-184` — orchestrator built + wired into `INVOICE_CREATION`; admin endpoints now call it for real (though cross-service retry for sales-service-owned sagas isn't wired end-to-end); 8 of 9 spec'd sagas remain unbuilt — see [ES-24_COMPLETION.md](phase-completions/ES-24_COMPLETION.md) |
| H4 | ✅ FIXED — OpenTelemetry SDK (`initializeTelemetry`) is fully implemented but **never called by any service** — distributed tracing is completely dark despite Jaeger/OTLP being wired at every other layer | Observability | `packages/platform-sdk/src/telemetry.ts`; zero call sites in any `apps/*/src/main.ts` — now called in all 14 active services (`api-gateway` remains a stub, out of scope) — see [ES-25_COMPLETION.md](phase-completions/ES-25_COMPLETION.md) |
| H5 | ✅ FIXED — Kubernetes manifests exist for exactly 1 of 15 backend services (`auth-service.yaml`); Helm/Terraform directories are empty scaffolding | Scalability/Infra | `infrastructure/k8s/`, `infrastructure/helm/`, `infrastructure/terraform/` — 13 more manifests authored (all backend services except api-gateway, descoped); raw manifests chosen over a Helm chart for this phase (14 near-duplicate files judged acceptable given the volume already in scope); Helm/Terraform remain empty, unchanged — see [ES-27_COMPLETION.md](phase-completions/ES-27_COMPLETION.md) |
| H6 | ✅ FIXED — `statement_timeout = 3000`, the chaos-engineering report's own documented fix, was **never actually applied** to any init SQL or migration — the failure mode it fixes is still reproducible | Reliability | Claimed in `dr-drill-report.md:189`; absent from `infrastructure/docker/postgres/init.sql` and all migrations — now added to `init.sql` and verified live via `SHOW statement_timeout` (`3s`) — see [ES-27_COMPLETION.md](phase-completions/ES-27_COMPLETION.md) |
| H7 | ✅ FIXED — Sale returns can exceed the original invoice quantity across **multiple** return transactions — the guard only checks against the original line quantity, never sums prior returns | Data Integrity | `apps/sales-service/src/domain/SaleReturnService.ts:74-76` — see [ES-23_COMPLETION.md](phase-completions/ES-23_COMPLETION.md) |
| H8 | ✅ FIXED — Purchase returns have **no quantity validation** against the GRN at all (sales side has a — incomplete — guard; purchase side has none) | Data Integrity | `apps/purchase-service/src/domain/PurchaseReturnService.ts:42-110` — see [ES-23_COMPLETION.md](phase-completions/ES-23_COMPLETION.md) |
| H9 | ✅ FIXED — `PlatformContext` is missing 4 of the 14 sub-clients the spec mandates as the single required entry point (`files`, `metrics`, `notifications`, `search` are absent or not attached) | Architecture | `packages/platform-sdk/src/context.ts:34-46` — `files` now attached (optional, set when `storage` is configured); `metrics`/`notifications`/`search` were never implemented and have working equivalents elsewhere, so this was closed via a spec correction (`ERP_MASTER_SPEC.md` §9) rather than new implementation — see [ES-25_COMPLETION.md](phase-completions/ES-25_COMPLETION.md) |
| H10 | ⚠️ PARTIALLY ADDRESSED — Distributed locking (`DistributedLockManager`) is fully implemented but has **zero callers anywhere in application code**; separately, `acquire()`'s fencing-token path has no try/finally and can leak a lock for its full TTL on a transient Redis error | Architecture | `packages/platform-sdk/src/locks.ts:48-64` — the try/catch claim didn't match current code (verified already correct, see [ES-23_COMPLETION.md](phase-completions/ES-23_COMPLETION.md)); `ctx.locks.withLock` still has 0 callers by deliberate choice — every C4/M1 critical section was closed with native `SELECT...FOR UPDATE` instead, which needs no new locking strategy for a single-transaction critical section |
| H11 | ✅ FIXED — `DELETE /accounts/:id` never implements its own stated TODO (check for existing `financial_entries`) — soft-deleting an account with posted entries silently drops one side of a balanced journal from Trial Balance/P&L/Balance Sheet | Financial Correctness | `apps/accounting-service/src/api/accounts.routes.ts:177-198` (TODO at :194) — see [ES-24_COMPLETION.md](phase-completions/ES-24_COMPLETION.md) |
| H12 | ✅ FIXED — `MFA /backup-codes` accepts the confirming TOTP code as a **query parameter** (lands in logs/history/Referer) — self-flagged in ES-19's own completion report but never fixed | Security | `apps/auth-service/src/routes/mfa.routes.ts:144-153` — see [ES-21_COMPLETION.md](phase-completions/ES-21_COMPLETION.md) |
| H13 | ✅ PARTIALLY FIXED — ~105 of 107 frontend pages don't branch on query error state — a failed fetch (401, 500, network error) renders as an indistinguishable "no data" empty state, inviting the user to "add your first record". Global `QueryCache({onError})` toast now covers all pages repo-wide; explicit `isError` → `ERPEmptyState` branching was added to the 3 representative pages named in the phase scope (Customers/Suppliers/Items) — the remaining ~102 pages still show the generic empty state on error, just with a toast alongside it | Frontend | Repo-wide `useQuery` grep; `apps/web-frontend/src/main.tsx` — see [ES-22_COMPLETION.md](phase-completions/ES-22_COMPLETION.md) |

---

## 4. Medium-Severity Findings

| # | Finding | Files |
|---|---|---|
| M1 | ✅ FIXED — GRN over-receipt guard has a TOCTOU gap — two concurrent GRNs against the same PO line can jointly over-receive past the ordered qty | `apps/purchase-service/src/domain/GRNService.ts:73-102` — see [ES-23_COMPLETION.md](phase-completions/ES-23_COMPLETION.md) |
| M2 | ✅ FIXED — `InventoryLedgerService.addStock()`/`adjustStock()` are non-atomic (unlike the correctly-guarded `deductStock()`/`transferStock()` two functions away) | `apps/inventory-service/src/domain/InventoryLedgerService.ts:30-65,104-135` — see [ES-23_COMPLETION.md](phase-completions/ES-23_COMPLETION.md) |
| M3 | ✅ FIXED — Invoice number is client-supplied with only a plain-SELECT duplicate check, no lock/atomic insert — concurrent submissions with the same number produce an opaque 500 instead of the intended 422 | `apps/sales-service/src/api/invoice.routes.ts:52-54`, `InvoiceService.ts:240-246` — see [ES-23_COMPLETION.md](phase-completions/ES-23_COMPLETION.md) |
| M4 | ✅ FIXED — production-service bypasses `PlatformContext` and instantiates a raw `ioredis` client directly — the only service in scope doing this | `apps/production-service/src/main.ts:5,28-34`, `BarcodeService.ts:5,43-46` — migrated to `ctx.cache` (`TenantScopedCache`) — see [ES-25_COMPLETION.md](phase-completions/ES-25_COMPLETION.md) |
| M5 | ✅ FIXED — report-service's P&L mis-categorizes `CONTRA` accounts (falls into `OTHER`), reintroducing the exact drift ES-17 claimed to have fixed vs. accounting-service's own P&L | `apps/report-service/src/domain/ReportEngine.ts:1236-1242` vs `apps/accounting-service/src/domain/ReportsEngine.ts:243,247` — see [ES-26_COMPLETION.md](phase-completions/ES-26_COMPLETION.md) |
| M6 | ✅ FIXED — Day Book, Account Ledger, Bank Book, GST-payable, and one fund-flow report still reference nonexistent columns (`entry_date`, `debit_credit`, `amount`) — 500s at runtime; ES-17 explicitly left these out of scope but they remain live, schedulable report slugs | `apps/report-service/src/domain/ReportEngine.ts:1133-1477` — see [ES-26_COMPLETION.md](phase-completions/ES-26_COMPLETION.md) (the actually-broken 5th case was `expense-analysis`, not `gst-payable-report` — see that report's scope note) |
| M7 | ✅ FIXED — `query-optimization-report.md` claims a 3-minute Redis cache exists in report-service for GST reports — report-service has **no Redis dependency at all** | `ERP-PLANNING/phase-completions/query-optimization-report.md:171` vs `apps/report-service` — cache now built (`ioredis` + `TenantScopedCache` on `gst-payable-report`), the doc's claim is now true — see [ES-26_COMPLETION.md](phase-completions/ES-26_COMPLETION.md) |
| M8 | ✅ FIXED — Notification retry is synchronous in-process (not the BullMQ job the chaos report describes), and no send endpoint accepts an idempotency key — a client-side retry on a slow synchronous retry can double-send SMS/WhatsApp | `apps/notification-service/src/domain/NotificationEngine.ts:208-248`, `api/notification.routes.ts:62-110` — idempotency key added, chaos report corrected — see [ES-26_COMPLETION.md](phase-completions/ES-26_COMPLETION.md) |
| M9 | ✅ FIXED — `ImportEngine.execute()` uses a SELECT-then-UPDATE status check instead of an atomic conditional update — concurrent double-click/retry can cause duplicate batch inserts | `apps/scheduler-service/src/domain/ImportEngine.ts:200-216` — see [ES-26_COMPLETION.md](phase-completions/ES-26_COMPLETION.md) |
| M10 | ✅ FIXED — Feature-flag L1 in-memory cache is defeated because `PlatformContext` (and its flag cache) is reconstructed fresh on every HTTP request; hot-reload pub/sub subscriber has zero callers | `packages/platform-sdk/src/context.ts:114-116`, `feature-flags.ts:102,109` — L1 `Map` hoisted to `PlatformContextFactory`, shared across requests; `subscribeToInvalidations` rewired (also fixed a latent bug where the invalidation message's field name never matched what the subscriber read) and called at bootstrap in all 8 services using `PlatformContextFactory` — see [ES-25_COMPLETION.md](phase-completions/ES-25_COMPLETION.md) |
| M11 | ✅ FIXED — `event-bus-client` package is a non-functional stub (`throw new Error('not implemented')`) — dead/confusing legacy package alongside the real, working `platform-sdk` event bus | `packages/event-bus-client/src/index.ts:30-39` — package deleted, dead vitest alias removed from `apps/auth-service` — see [ES-25_COMPLETION.md](phase-completions/ES-25_COMPLETION.md) |
| M12 | ✅ FIXED — Prometheus has no scrape job for `hr-service`, `purchase-service`, or `production-service`, even though those services do expose `/metrics` | `infrastructure/docker/prometheus/prometheus.yml` — 3 scrape jobs added; dead `api-gateway` target removed (see H2); verified all 13 backend targets appear via Prometheus's `/api/v1/targets` — see [ES-27_COMPLETION.md](phase-completions/ES-27_COMPLETION.md) |
| M13 | ✅ FIXED — No automated backup job exists anywhere in the repo — the DR drill's excellent RTO/RPO numbers were achieved by a human running `pg_dump` by hand; there's no scheduled equivalent | Repo-wide grep for `pg_dump`/`CronJob`; none in `infrastructure/` or `docker-compose.yml` — `docker-compose` `backup` service + `infrastructure/k8s/backup-cronjob.yaml` added, automating the exact DR-drill-proven steps (pg_dump -Fc, Redis SAVE, MinIO mirror) on a daily schedule; restore verified into a scratch DB with matching row counts — see [ES-27_COMPLETION.md](phase-completions/ES-27_COMPLETION.md) |
| M14 | ✅ FIXED (via doc correction) — `TenantScopedDatabase.raw` queries (the majority of route handlers) never set the RLS session GUC (`app.current_tenant_id`) — only `.transaction()` does. Tenant isolation for non-transactional reads rests entirely on hand-written `WHERE tenant_id=...` predicates, not defense-in-depth RLS as the spec claims | `packages/platform-sdk/src/database.ts:16-28` — confirmed zero `CREATE POLICY`/`ENABLE ROW LEVEL SECURITY` statements exist anywhere in `packages/db-client/migrations/`, so there is no RLS to set the GUC for; `ERP_MASTER_SPEC.md` §4.2 corrected to state this rather than the false claim. Building real RLS policies is deferred to a dedicated security-hardening phase — see [ES-25_COMPLETION.md](phase-completions/ES-25_COMPLETION.md) |
| M15 | ✅ FIXED — Manual journal posting/reversal (`JournalEngine.post`/`reverse`) never emits a domain event — other services have no way to react to manually posted journals | `apps/accounting-service/src/domain/JournalEngine.ts`, `api/journal.routes.ts:128,161` — see [ES-24_COMPLETION.md](phase-completions/ES-24_COMPLETION.md) |
| M16 | ✅ FIXED — gst-service never publishes any domain events (zero outbox writes in the entire service) — e-invoice/e-way-bill generation only writes an audit-log entry, inconsistent with the outbox-only architecture | `apps/gst-service/src/**` (repo-wide grep, 0 hits for `ctx.events`) — see [ES-24_COMPLETION.md](phase-completions/ES-24_COMPLETION.md) |
| M17 | ✅ FIXED — No rate limiting on `/auth/mfa/verify` — only login has the strict limiter; a 6-digit TOTP is brute-forceable within its 5-minute token TTL at the 200/min global default | `apps/auth-service/src/routes/mfa.routes.ts:58` (self-flagged in ES-19_COMPLETION.md, unfixed) — see [ES-21_COMPLETION.md](phase-completions/ES-21_COMPLETION.md) |
| M18 | ✅ PARTIALLY FIXED — Backend inconsistently returns bare-string errors instead of the spec'd `{code,message}` object — frontend then shows a generic "Request failed" instead of the real message. Fixed in sales-service (invoice/pos/payment/sale-return routes, the files this phase touched); the same pattern remains in auth-service, purchase-service, and internal.routes.ts across several services — flagged as a follow-up, not in this phase's scope | `apps/sales-service/src/api/invoice.routes.ts:335`, `pos.routes.ts:90,121,142` vs `apps/web-frontend/src/api/client.ts:49-50` — see [ES-22_COMPLETION.md](phase-completions/ES-22_COMPLETION.md) |
| M19 | ✅ FIXED — pos-frontend has **no login flow** — it reads `pos_token` from `localStorage`, which nothing in the app ever sets; as shipped it cannot authenticate standalone | `apps/pos-frontend/src/main.tsx`, `POSScreen.tsx:62` — see [ES-22_COMPLETION.md](phase-completions/ES-22_COMPLETION.md) |
| M20 | ✅ FIXED — pos-frontend raw `fetch` calls have no `res.ok` check on 2 of 3 endpoints — a 401/500 silently renders as an empty item/customer grid | `apps/pos-frontend/src/POSScreen.tsx:124-131,134-141` — see [ES-22_COMPLETION.md](phase-completions/ES-22_COMPLETION.md) |
| M21 | ✅ FIXED — GSTIN validation regex is duplicated in 3 places and has drifted — `OrganizationPage.tsx`'s local copy accepts a `0` in the entity-code position that the shared/correct regex rejects | `apps/web-frontend/src/pages/settings/OrganizationPage.tsx:11` vs `packages/shared-types/src/validators.ts:8` — see [ES-22_COMPLETION.md](phase-completions/ES-22_COMPLETION.md) |
| M22 | ✅ FIXED — `FixedAssetService.postMonthlyDepreciation` updates `currentValue` without checking the `version` column that exists on the table — protected only indirectly by a unique constraint on a different table | `apps/accounting-service/src/domain/FixedAssetService.ts:170-211` — see [ES-23_COMPLETION.md](phase-completions/ES-23_COMPLETION.md) |
| M23 | ✅ FIXED — `DELETE /accounts/:id` omits `tenantId` from its WHERE clause (inconsistent with every other mutation in the file — not currently exploitable since `id` is globally unique, but a landmine) | `apps/accounting-service/src/api/accounts.routes.ts:195-198` — see [ES-24_COMPLETION.md](phase-completions/ES-24_COMPLETION.md) |

---

## 5. Low-Severity / Housekeeping Findings

| # | Finding | Files |
|---|---|---|
| L1 | ✅ FIXED — `ConsignmentService.recordSale()` has no caller yet but repeats the Finding-C4 lost-update pattern for consignment lot deduction — latent until wired up | `apps/production-service/src/domain/ConsignmentService.ts:104-122` — `recordSale()` and the sibling `returnToSupplier()` both fixed, see [ES-23_COMPLETION.md](phase-completions/ES-23_COMPLETION.md) |
| L2 | ✅ FIXED — Item/warehouse deletion has a stale TODO — doesn't check `inventory_ledger` before allowing delete | `apps/inventory-service/src/api/item.routes.ts:358`, `warehouse.routes.ts:185` — see [ES-23_COMPLETION.md](phase-completions/ES-23_COMPLETION.md) |
| L3 | ✅ FIXED — Internal-service API key comparison (`hr-service`) is a plain `!==`, not constant-time | `apps/hr-service/src/api/internal.routes.ts:14` — see [ES-21_COMPLETION.md](phase-completions/ES-21_COMPLETION.md) |
| L4 | ✅ FIXED — `requirePermission` sends a 403 without an explicit `return` after — traced as not currently exploitable in Fastify 4.29.1's hook chain, but fragile | `apps/auth-service/src/middleware/authorize.ts:12-14` — see [ES-21_COMPLETION.md](phase-completions/ES-21_COMPLETION.md) |
| L5 | ✅ FIXED — CI has two parallel, redundant pipeline definitions (GitHub Actions + `.gitlab-ci.yml`) with unclear authority | `.github/workflows/ci.yml`, `.gitlab-ci.yml` — `.gitlab-ci.yml` deleted: confirmed dead, written for the project's pre-migration Spring Boot layout, never updated for the current pnpm monorepo; GitHub Actions is the sole authoritative CI — see [ES-27_COMPLETION.md](phase-completions/ES-27_COMPLETION.md) |
| L6 | ✅ CONFIRMED AS-IS — Istio config is 2 policy files only — no VirtualService/Gateway/DestinationRule; consistent with "not running," just flagging as scaffolding-only | `infrastructure/istio/` — confirmed intentional; documented in `TECH_AUDIT.md` §23b so a future session doesn't mistake it for a working mesh — see [ES-27_COMPLETION.md](phase-completions/ES-27_COMPLETION.md) |
| L7 | ✅ FIXED — Search-as-you-type with no debounce on 7 list pages | `CustomersPage.tsx`, `EmployeesPage.tsx`, `ItemsPage.tsx`, `InvoicesPage.tsx`, `QuotationsPage.tsx`, `SuppliersPage.tsx`, `ReportsPage.tsx` — see [ES-22_COMPLETION.md](phase-completions/ES-22_COMPLETION.md) |
| L8 | ✅ FIXED — Stale compiled artifact duplication (same root cause as C8) also at `db-client/src/index.js` | `packages/db-client/src/index.js` — deleted along with all C8 artifacts — see [ES-25_COMPLETION.md](phase-completions/ES-25_COMPLETION.md) |

---

## 6. Coverage Matrix — Requested Dimensions

| Dimension | Status | Evidence |
|---|---|---|
| DDD | Partial | Domain services exist (JournalEngine, GSTCalculator, ValuationService) but routes frequently call `db` directly rather than through a domain boundary |
| CQRS | Unverified/Partial | Spec claims projection tables for Dashboard/StockLevel/etc.; no agent found live projection-consumer code confirming this is built vs. aspirational — **flag for a follow-up targeted audit** |
| Event Sourcing | ✅ Implemented | `inventory_ledger`/`financial_entries` confirmed append-only repo-wide (zero UPDATE/DELETE found) |
| Saga | ❌ Missing | No `SagaOrchestrator` exists; admin retry/compensate endpoints are no-ops (H3) |
| Outbox | ⚠️ Partial/Violated | Correct in most sales/purchase/GRN paths; violated in accounting-service accounts & opening-balances (C6); gst-service never uses it at all (M16) |
| Inbox | ⚠️ Broken | TOCTOU race allows double-processing (C7) |
| Service Mesh | ❌ Scaffolding only | Istio: 2 policy files, not running (L6) |
| Redis / Caching | ⚠️ Partial | Tenant-namespaced where present; feature-flag L1 cache defeated (M10); report-service cache claimed in docs but doesn't exist (M7) |
| Database | ✅ Strong | 19 sequential migrations, 7 verified index fixes with EXPLAIN ANALYZE evidence |
| Transactions | ⚠️ Partial | Correct in JournalEngine/InvoiceService; violated in accounting-service outbox writes (C6) |
| Optimistic Locking | ⚠️ Partial | Correct on `accounts`; **missing** on FIFO layers, WACC cost, payment allocation, inventory stock-in/adjust (C4, C5, M2), fixed-asset depreciation (M22) |
| Distributed Locks | ❌ Built, unused | Zero callers anywhere in app code; `acquire()` has a lock-leak bug (H10) |
| Feature Flags | ⚠️ Partial | L2/DB layer works; L1 cache and hot-reload subscriber are dead weight (M10) |
| Audit | ✅ Implemented | PlatformAuditLogger used consistently; PII correctly stripped from HR audit trails |
| Logging | ✅ Good | Winston structured logging; zero `console.log` found in packages; ESLint enforces it |
| OpenTelemetry | ❌ Dark | SDK fully built, never initialized by any service (H4) |
| Security | ❌ Critical gaps | C1, C2, C3, H1, H12, M17 — see §2/§3/§7 |
| Performance | ✅ Good | 7 verified index fixes, no N+1 found in reporting/search, chaos-tested DB latency tolerance |
| Scalability | ⚠️ Partial | Strong indexing; K8s HPA/resources exist for 1/15 services (H5) |
| Code Reuse | ⚠️ Mixed | GSTIN regex drift (M21), duplicate P&L logic drift (M5), dead `event-bus-client` package (M11) |
| Naming | ✅ Consistent | `/api/v2/{resource}`, `{ENTITY}_{ACTION}` event naming followed in all sampled files |
| SOLID / DRY / KISS | ⚠️ Mixed | See M5, M11, M21 for DRY violations with real drift, not just duplication |
| Clean/Hexagonal Architecture | ⚠️ Partial | `PlatformContext` acts as a ports/adapters boundary in principle; many routes bypass domain layer directly into `db` |
| Repository Pattern / Unit of Work | ⚠️ Partial | `ctx.db`/`ctx.db.transaction` serve this role; inconsistently used (`raw` bypasses UoW-like session scoping — M14) |
| Validation | ✅ Mostly good | Zod applied at route boundaries broadly; a few string-vs-object error envelope inconsistencies (M18) |
| Error Handling | ⚠️ Partial | Backend inconsistent envelope (M18); frontend doesn't surface query errors on ~105/107 pages (H13) |
| Retry | ✅ Implemented | Outbox relay retry+DLQ verified solid; notification retry works but doesn't match its own docs (M8) |
| Circuit Breaker | ✅ Real | `opossum`-based, sane defaults, not a stub |
| Dependency Injection | ✅ Consistent (in SDK) | Constructor injection pattern in `platform-sdk`; not deeply audited elsewhere |
| API Versioning | ✅ Consistent | `/api/v2/` prefix confirmed in all sampled services |
| Schema Registry | ❌ Not found | No agent found evidence of a Kafka schema registry despite the "schema validated" claim in the master spec — **flag for follow-up** |
| Migration Strategy | ✅ Good | 19 sequential, idempotent (`IF NOT EXISTS`) migrations; FA.1 from the P0 audit is resolved |
| Tenant Isolation | ⚠️ Mostly strong, 1 critical breach | H1 (search-service URL-trust breach); M14 (RLS session-var gap on non-transactional reads) |
| Rate Limiting | ⚠️ Partial | Login has a strict limiter; MFA verify doesn't (M17); no gateway-level limiting exists (H2) |
| Background Jobs | ✅ Good | BullMQ + Redis `SET NX EX` per-job-name lock genuinely prevents duplicate concurrent runs |
| Cron Jobs | ✅ Implemented | scheduler-service system jobs registered and running |
| CI/CD | ❌ Broken | Dockerfiles missing for 12/13 services (C11); deploy stage fully commented out; 2 parallel CI systems (L5) |
| Docker | ⚠️ 1/13 services | Only auth-service has a real Dockerfile (correctly multi-stage, non-root, healthcheck) |
| Kubernetes | ⚠️ 1/15 services | Only auth-service has a manifest; NetworkPolicy references a pod selector that will never match (H2) |
| Helm | ❌ Empty | `.gitkeep` only |
| Monitoring | ⚠️ Partial | Prometheus scrapes 12/15 correctly, missing 3 (M12), and scrapes a nonexistent api-gateway target |
| Metrics | ✅ Better than documented | `/metrics` wired into 14/15 backend services (TECH_AUDIT.md's "5 services" claim is stale) |
| Tracing | ❌ Dark | See OpenTelemetry above (H4) |
| Secrets | ✅ Clean | No committed secrets found; `.env` correctly gitignored; TruffleHog/Snyk/Semgrep/Trivy in CI (Trivy coverage limited by C11) |
| Disaster Recovery | ✅ Tested, well | Drill passed: RTO 24m17s (<30m target), RPO 2m16s (<15m target) |
| Backup | ⚠️ Manual only | No automated backup job in the repo (M13) |
| Restore | ✅ Validated | Confirmed in DR drill (customer count, trial balance, login all verified post-restore) |
| Chaos Engineering | ✅ Tested, well | 8/8 experiments passed; but one of its own documented follow-up fixes never landed (H6) |
| Cost Optimization | ⚠️ Unassessable | Only 1/15 services has any resource config to evaluate |

---

## 7. Security Deep-Dive (highest-priority reading)

The three Critical security findings (C1–C3) combine into a single practical attack chain for any authenticated low-privilege user on any tenant:

1. **Log in normally** as any role (e.g., a cashier account) in Tenant A.
2. **`POST /api/v2/users/{ownerId}/reset-password`** (C3) → take over the tenant Owner/Admin account with no current-password confirmation required.
3. Separately, **`PATCH /api/v2/admin/tenants/{anyTenantId}/suspend`** (C2) → suspend or close *any other tenant on the platform*, since the route only checks `authenticate`, not tenant ownership or platform-admin permission.
4. **`GET /api/v2/admin/tenants`** (C1) → enumerate every tenant on the platform with no authentication at all, to pick targets for #3.

None of these three require any special privilege — a brand-new, lowest-role user account can execute all four steps. This is a full-platform-compromise chain, not an isolated bug, and should be treated as the single highest priority in this report.

H1 (search-service cross-tenant index deletion via URL-trusted `tenantId`) is a second, independent instance of the same root cause: **trusting caller-supplied identifiers instead of the JWT claim**. Given it appears in 2 unrelated services, this audit recommends a repo-wide grep for `request.params.tenantId` / `request.body.tenantId` used as the authorization boundary (rather than `request.auth.tenantId`) before considering this class of bug closed.

---

## 8. Cross-Cutting Root Cause

Nearly every Critical/High finding in this report traces back to one of three repeatable root causes, not 40 unrelated bugs:

1. **"Correct pattern exists nearby, wasn't applied here."** `items.availableQty` deduction is correctly atomic; `FIFO layers`/`WACC cost`/`inventory addStock` two functions away are not (C4, M2). `accounts.routes.ts` PUT correctly checks optimistic-lock version; DELETE on the same file skips the tenant filter (M23) and the financial-entries check (H11). `authenticate` is applied to tenant-service routes; `requirePermission` is not (C2). This suggests the fix isn't "write more code," it's **enforcing the existing correct pattern via a lint rule, code-review checklist, or a shared helper that makes the wrong way harder to write** than the right way.
2. **Documentation describes an aspiration, not the shipped state.** `PlatformContext` (§9 of the spec) claims 14 sub-clients; 4 don't exist (H9). The chaos report describes a `notification_retry` BullMQ job architecture that isn't what's running (M8). The query-optimization report describes a report-service Redis cache that was never built (M7). The DR report's own documented Postgres fix never landed in any SQL file (H6). **Recommendation: any report claiming "fix applied" should link the commit/PR, not just narrate the fix — several of these were clearly written as intended next steps that got recorded as done.**
3. **Auth/permission checks are opt-in per route, not enforced by the framework.** Every unauthenticated/unauthorized route found (C1, C2, C3, H1) is a route that simply forgot to add a `preHandler`. There is no test, lint rule, or route-registration convention in this codebase that fails a route missing `requirePermission`. **Recommendation: add a CI check that fails if any route file exports a handler without an explicit `preHandler` array (or an explicit `// PUBLIC:` comment), and add integration tests that assert 401/403 for every non-public route without the right token/permission.**

---

## 9. Priority-Ordered Fix Plan

| Priority | Items | Est. Effort |
|---|---|---|
| **P0 — this week, blocks everything** | C1, C2, C3 (auth chain), C4, C5 (financial races), C6, C7 (outbox/inbox), C9, C10 (frontend dead pages) | ~6–9 engineer-days |
| **P1 — before next external demo/pilot** | C8, C11, H1–H13 | ~10–15 engineer-days |
| **P2 — before production go-live** | All Medium findings (M1–M23), the ES-20 pending deployment checklist (see below), Helm/K8s manifests for remaining 14 services | ~3–4 engineer-weeks |
| **P3 — housekeeping, non-blocking** | L1–L8 | ~2–3 engineer-days |

### Per-item detail (Critical + High only — Medium/Low root cause & fix are in §4/§5 tables above)

| ID | Root Cause | Fix | Est. Time |
|---|---|---|---|
| C1 | Route never wrapped in an auth scope in `main.ts` | Add `authenticate` + new `PLATFORM_ADMIN` permission to all 6 admin routes | 0.5 day |
| C2 | `requirePermission` omitted; no ownership check against target tenant | Add platform-admin permission check; reject if caller isn't platform staff | 0.5 day |
| C3 | `checkOwnerPermission()` helper written but never wired in | Add `requirePermission(USER_*)` per route; extra re-auth gate on password-reset | 1 day |
| C4 | Read-then-write with no atomic guard/lock on FIFO/WACC | Convert to atomic `UPDATE...WHERE remaining_qty >= :x RETURNING`, or wrap in `ctx.locks.withLock` | 2 days |
| C5 | No per-invoice allocation cap; balance update not atomic | Reject over-allocation (or route excess to advance/credit); atomic guarded UPDATE | 1 day |
| C6 | Insert + `events.publish()` are two separate commits | Wrap both in one `ctx.db.transaction()`, use the existing `publishInTransaction` variant | 1 day |
| C7 | Consumer doesn't check its own insert's conflict result | Use `.returning()` on the inbox insert; skip handler if zero rows | 0.5 day |
| C8 | Compiled artifacts committed to git, out of sync with source | Delete `src/**/*.js,*.d.ts,*.map`; gitignore them; add a CI "clean checkout has no compiled files in src" guard | 0.5 day |
| C9 | Copy-paste `.data.data` double unwrap | Remove extra `.data` in 4 files | 0.5 hour |
| C10 | No refresh call, no 401 interceptor | Add `authApi.refresh()`, single-flight 401→refresh→retry interceptor in `apiClient.request()` | 1 day |
| C11 | Dockerfiles never written for 12 services | Author per-service Dockerfiles using `auth-service/Dockerfile` as template, or shrink CI matrix to match reality | 2–3 days |
| H1 | `tenantId` read from URL param, not JWT | Derive from `request.auth.tenantId` for all 4 admin search routes | 0.5 day |
| H2 | api-gateway never implemented | Implement proxy/auth/rate-limit/circuit-breaker, or remove misleading infra references until built | 3–5 days |
| H3 | No orchestrator engine exists | Build `SagaOrchestrator` per spec, or scope down the promise and stop exposing fake retry/compensate endpoints | 5–8 days |
| H4 | `initializeTelemetry()` never called | Call it at the top of every service's `main.ts`, gated on `OTEL_EXPORTER_OTLP_ENDPOINT` | 1 day |
| H5 | Only auth-service has a manifest | Templatize into a Helm chart, generate per-service values | 3–5 days |
| H6 | Fix documented, never committed | Add `ALTER SYSTEM SET statement_timeout` to `init.sql` or a ConfigMap | 0.5 hour |
| H7 | Return guard checks only original qty, not cumulative | Sum prior approved returns before validating | 0.5 day |
| H8 | No quantity guard at all on purchase side | Mirror the (fixed) sales-side guard against GRN received qty | 0.5 day |
| H9 | 4 sub-clients never attached to context | Attach `StorageClient` as `ctx.files`; implement or descope `metrics`/`notifications`/`search` | 2 days |
| H10 | Built, never adopted; `acquire()` missing try/finally | Wrap `acquire()` in try/catch releasing on failure; adopt in the C4/M1/M2 critical sections | 1 day |
| H11 | TODO never implemented | Reject delete if `financial_entries` reference the account | 0.5 day |
| H12 | Confirming code passed as query string | Move to POST body | 0.5 hour |
| H13 | No global query-error handling | Add `QueryCache({onError})` in `main.tsx`; branch list pages on `isError` | 1–2 days |

---

## 10. Production Readiness Gate

**Verdict: NOT PRODUCTION READY.**

Hard blockers (must all be closed before any production or paid-pilot deployment):

- [ ] C1, C2, C3 — unauthenticated/unauthorized tenant and user admin endpoints
- [ ] C4, C5 — financial/stock data-corruption races
- [ ] C6, C7 — outbox/inbox correctness violations
- [ ] C9, C10 — dead frontend pages / broken session handling
- [x] C11, H5 — no deployable CI images or K8s manifests for the great majority of services — CLOSED 2026-07-04, see [ES-27_COMPLETION.md](phase-completions/ES-27_COMPLETION.md): 13 more Dockerfiles + K8s manifests authored and individually build/run/health-checked (14 of 15 backend services now deployable; `api-gateway` honestly descoped, see H2)
- [x] **ES-20 deployment checklist** — CLOSED 2026-07-04 (session start of ES-27): DB migration `0018_es20_audit_attachments_flags.sql` applied and verified, MinIO bucket created, `pnpm install` confirmed for new S3/multipart/qrcode deps, `REPORT_SERVICE_URL` added to `.env`, `INTERNAL_API_KEY` confirmed consistent (single shared root `.env` in this dev environment). DB backup step still skipped — dev phase, no real data; re-verify before go-live.
- [ ] **New from ES-27**: `sales-service` was found to crash on startup in every environment (not just Docker) — `GET /invoices/:id/pdf` is registered twice in `apps/sales-service/src/api/invoice.routes.ts` (lines ~197 and ~327), and Fastify throws on duplicate route registration. Out of scope for ES-27 (application bug, not CI/CD/Docker/K8s) but blocks sales-service from running anywhere until fixed.

Once P0 is closed, this codebase's underlying architecture and testing discipline (chaos engineering, DR drills, verified query optimization) are genuinely strong enough to support a real production push — the gap is execution consistency, not a flawed design.

---

## 11. Remediation Phase Plan

All 55 findings (C1–C11, H1–H13, M1–M23, L1–L8) have been grouped into 7 executable phases, each
written as a full `ERP-PLANNING/audit-phase-prompts/ES-2X-*.md` prompt in this repo's existing
phase-prompt format — paste the relevant file as the first message in a new Claude Code session to
execute that phase. Each phase prompt cites the exact file:line for every finding it closes.

| Phase | Title | Findings Closed | Priority | Est. Effort | Can Run In Parallel With |
|---|---|---|---|---|---|
| [ES-21](audit-phase-prompts/ES-21-SECURITY-TENANT-USER-AUTHZ-LOCKDOWN.md) | Security: Tenant-Admin & User-Management Authorization Lockdown | C1, C2, C3, H1, H12, M17, L3, L4 | **P0 — do first** | 2–3 days | ES-22 |
| [ES-22](audit-phase-prompts/ES-22-FRONTEND-CRITICAL-FIXES.md) | Frontend Critical Fixes: Dead Pages, Session Refresh, Error Surfacing | C9, C10, H13, M18, M19, M20, M21, L7 | **P0 — do first** | 3–4 days | ES-21 |
| [ES-23](audit-phase-prompts/ES-23-INVENTORY-FINANCIAL-CONCURRENCY-HARDENING.md) | Inventory & Financial Concurrency Hardening | C4, C5, H7, H8, H10, M1, M2, M3, M22, L1, L2 | **P0 — do second** | 4–5 days | — (touches shared services; run after ES-21/22) |
| [ES-24](audit-phase-prompts/ES-24-EVENT-ARCHITECTURE-OUTBOX-INBOX-SAGA.md) | Event Architecture Integrity: Outbox, Inbox & Saga Orchestrator | C6, C7, H3, H11, M15, M16, M23 | P1 | 5–8 days | — (run after ES-23, both touch accounting-service) |
| [ES-25](audit-phase-prompts/ES-25-PLATFORM-SDK-COMPLETENESS-OBSERVABILITY.md) | Platform SDK Completeness, Build Hygiene & Observability | C8, H4, H9, M4, M10, M11, M14, L8 | P1 | 3–4 days | ES-26 (run after ES-23) |
| [ES-26](audit-phase-prompts/ES-26-REPORTING-DATA-CONSISTENCY.md) | Reporting, Notification & Scheduler Data Consistency | M5, M6, M7, M8, M9 | P2 | 3–4 days | ES-25 |
| [ES-27](audit-phase-prompts/ES-27-CICD-DOCKER-KUBERNETES-DEPLOYABILITY.md) | CI/CD, Docker & Kubernetes Deployability | C11, H2, H5, H6, M12, M13, L5, L6 | P1/P2 | 5–7 days | run **last** — packages/deploys the code the other phases fix |

**Recommended execution order:** ES-21 and ES-22 in parallel first (independent codebases: backend
auth vs. frontend) → ES-23 → ES-24 and ES-25 in parallel (both depend on ES-23 being done first to
avoid stacking conflicting in-flight changes to shared services) → ES-26 → ES-27 last, since it
packages and deploys the fixes from every prior phase.

Each phase prompt's own **Definition of Done** includes updating this report's §2–§5 finding tables
with a ✅ FIXED marker and a pointer to that phase's completion report — treat those tables as living
status, not a frozen snapshot, as phases complete.

---

## Appendix A — Audit Methodology & Coverage

Seven independent read-only source audits were run in parallel, each instructed to verify prior completion-report claims against live code rather than trust them, and to search for new regressions:

1. Financial core & event backbone — accounting-service, gst-service, event-service, event-bus-client, platform-sdk events/outbox/inbox
2. Operations core — inventory-service, sales-service, purchase-service, production-service
3. Identity, access & security — auth-service, tenant-service, api-gateway, hr-service
4. Platform SDK & shared packages — platform-sdk, db-client, cache-client, event-bus-client, config, logger, shared-types, shared-utils
5. Reporting, jobs, search, notifications — report-service, scheduler-service, search-service, notification-service
6. Frontend — web-frontend, pos-frontend
7. Infrastructure, DevOps & observability — k8s/helm/istio, docker-compose, CI workflows, OpenTelemetry/Prometheus wiring

Each audit independently read the relevant `ES-*` audit prompts and completion reports before reading source, cross-checked claims, and reported findings with file:line references, concrete failure scenarios, and a severity rating. Findings above were de-duplicated and cross-referenced across agents where the same root cause appeared in multiple domains (e.g., the URL-trusted-tenantId pattern in both H1 and C1/C2).

**Not yet covered by this audit (recommended as explicit follow-ups):**
- CQRS projection consumers (existence/correctness unverified — flagged in §6)
- Kafka schema registry (no evidence found either way — flagged in §6)
- Load/soak testing beyond the chaos experiments already on file
- A live penetration test exercising the C1→C2→C3 chain end-to-end in a running environment
