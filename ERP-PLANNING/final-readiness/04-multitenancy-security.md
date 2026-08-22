# 04 — Multi-Tenancy & Security Audit

Independent verification against the live working tree (not HEAD). All findings evidence-based with file:line citations unless marked NOT VERIFIED.

## Summary verdict

**Solid at the JWT/application layer, thin at the database layer, and with one confirmed live no-op in tenant-lifecycle enforcement.** Every one of 18 backend services independently re-verifies the JWT and derives `tenantId` only from the verified claim — no route was found trusting a client-supplied tenant ID outside the intentional internal-service-key convention. Row-Level Security, however, covers only a small fraction of tenant-scoped tables, and tenant suspension is not actually enforced anywhere.

## 1. tenantId extraction — VERIFIED SAFE

Every service's `middleware/authenticate.ts` calls `verifyAccessToken()` (`packages/platform-sdk/src/auth.ts:26-47`), a real RS256 signature+issuer check via `jose.jwtVerify`, and reads `tenantId` off the verified payload. Route handlers use `request.auth.tenantId`, never a header/body field. Verified in accounting-service, ai-copilot-service, api-gateway, search-service, scheduler-service, auth-service (the issuer itself resolves tenant server-side at login, never from request body).

A full case-insensitive grep for `body.tenantId`/`query.tenantId` across `apps/` found matches only inside `internal.routes.ts`/`search-sync.internal.routes.ts` files — the intentional service-to-service convention (§2) — **zero matches in any JWT-gated user-facing route**.

## 2. API Gateway & direct-service-bypass — gateway logic correct; bypass structurally possible, contingent on production network policy

`apps/api-gateway/src/middleware/gateway-auth.ts`: `gatewayAuthDecorate` (134-153) verifies the JWT; `gatewayAuthReject` (159-179) 401s any non-exempt path lacking `request.auth`. `EXEMPT_PATHS`/`EXEMPT_PREFIXES` (20-97) is a deliberately enumerated, commented allowlist — no blanket bypass found. The file's own header comment (4-9) states the design assumption outright: a client bypassing the gateway must not be able to spoof a tenant via a trusted header, and confirmed no service does trust such a header.

**Medium finding**: every backend service binds `0.0.0.0` (checked all 18), and `docker-compose.yml` only containerizes infrastructure — no app service is defined there at all. In this repository, nothing but host/network firewalling stands between an external caller and any service's port. This does **not** defeat tenant isolation (every service re-verifies the JWT independently), but it does mean the 16 `internal.routes.ts` files across 9 services — protected only by a single static `INTERNAL_API_KEY` shared across all 9 services and compared via `crypto.timingSafeEqual` — are exposed to anything network-reachable. **NOT VERIFIED**: whether a production deployment adds network policy (K8s NetworkPolicy / security groups); nothing in this repo defines one.

## 3. Row-Level Security — HIGH gap: ~2-3% coverage, correct where applied

**GUC mechanism (evidence, correct):** `packages/platform-sdk/src/tenantConnection.ts:31-40` (`withTenantConnection`) and `packages/platform-sdk/src/database.ts:20-28` (`TenantScopedDatabase.transaction()`) both issue `SELECT set_config('app.current_tenant_id', tenantId, true)` as the first statement of a real transaction (SET LOCAL semantics). `packages/platform-sdk/src/fastify-tenant-connection.ts:27-51` (`tenantScopedHandler`) wraps route handlers in this. **104 of 170 route files** use `tenantScopedHandler`; **50 more** call `withTenantConnection` directly — the GUC is broadly and correctly wired.

**DB role (evidence, correct):** `infrastructure/docker/postgres/init.sql:26-40` creates `erp_app` with `NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS`; `.env` confirms services actually connect as `erp_app`, not the superuser `erp` role (which the init.sql comment notes was empirically found to bypass RLS unconditionally even with FORCE ROW LEVEL SECURITY). Each RLS migration adds `FORCE ROW LEVEL SECURITY` to defeat owner-bypasses-RLS default.

**Coverage (evidence, gap):** exactly 3 migrations enable RLS — `0176_enable_rls_invoices.sql` (invoices), `0177_enable_rls_journal_entries.sql` (journals, financial_entries + its 3 yearly partitions, each needing explicit ENABLE/FORCE since Postgres doesn't inherit RLS flags to partitions), `0178_enable_rls_payments.sql` (payments, payment_allocations). **8 physical relations / 7 logical tables.** `packages/db-client/src/schema/*.ts` defines 270 `pgTable` exports, 259 with a `tenantId` column. **RLS covers roughly 7 of ~250-260 tenant-scoped tables — approximately 2-3%.**

For the other ~250 tables, `app.current_tenant_id` is correctly _set_ on most requests (via the GUC wiring above), but since no RLS `POLICY` exists on them, **Postgres never checks it**. Isolation for those tables rests entirely on manual `WHERE tenant_id = ...` discipline in application code — confirmed present and correct everywhere sampled (inventory, sales-service export/import, report-service raw SQL), but with **zero database-level backstop**: a single forgotten filter, or a query bypassing `TenantScopedDatabase`, would be a silent cross-tenant read/write with nothing at the Postgres layer to catch it. Rated **HIGH** as a structural coverage gap, not a specific broken line.

One migration comment (0177) claims accounting-service's 12 Kafka consumers are "genuinely unscoped" — independently traced and found **stale/incorrect**: `packages/platform-sdk/src/events.ts:166-193` runs every consumer handler inside the same transaction where the GUC was already set. Rated **doc-only** (the comment needs updating, the code is correct).

## 4. Background jobs / scheduler tenant loop — VERIFIED SAFE

`apps/scheduler-service/src/JobRegistry.ts`: tenant-scoped jobs create **one BullMQ job per tenant** (`jobId = "${name}:${tenantId}"`), not an in-process loop over tenants sharing mutable state. Distributed locks are also per-tenant. No shared-state or loop-variable-capture bug found. (Separately, the _scheduling_ of these jobs at process startup has a real scalability problem — see `10-scalability-operability.md` §6d.)

## 5. Kafka consumers — tenant scoping correct; one confirmed SQL-injection-shaped code defect

Tenant ID resolution (`packages/platform-sdk/src/events.ts:119-162`) reads from producer-controlled Kafka headers/payload, never externally client-controlled; unresolvable tenant IDs are dropped, never processed as 0. Idempotency (inbox-claim UPSERT) and GUC-scoping are both correct (see also `08-api-event-reporting-search.md`).

**HIGH finding — confirmed defect:** `apps/accounting-service/src/consumers/InvoiceAccountingConsumer.ts:92-99` builds raw SQL via an **untagged** JS template literal (`` `SELECT ... WHERE tenant_id = ${event.tenantId} ...` ``) passed directly to `.execute()` — unparameterized string interpolation. Its sibling, `apps/accounting-service/src/consumers/PaymentAccountingConsumer.ts:110-113`, does the identical query correctly using Drizzle's `sql\`...\`` tag (auto-parameterized) — proving the safe pattern was known and used elsewhere in the same file family. Values (`event.tenantId`, `p.invoiceId`) originate from internal Kafka event payloads, both typed as `number`, and were not found to be reachable from an HTTP request body in the traced call graph — so this is rated **high** (a genuine defensive-coding defect and inconsistency, worth a one-line fix: prefix with `sql`), not a confirmed exploitable path today.

## 6. Search service — VERIFIED STRONG

Per-tenant physical Elasticsearch indices (`erp_${tenantId}_${entity}`, `apps/search-service/src/domain/SearchEngine.ts:540-541`) plus a redundant query-time `term` filter on `tenantId`. Every JWT-gated route derives `tenantId` from `request.auth`, never a query/body param. Internal routes are key-gated and Zod-validate `tenantId` (a comment there documents and closes a prior bug where a missing tenantId silently built an `erp_undefined_item` index).

## 7. Report service — VERIFIED SAFE

`apps/report-service/src/domain/ReportEngine.ts` uses Drizzle's `sql` tag (auto-parameterized) throughout, plus explicit `WHERE tenant_id = ${tid}` predicates on every case sampled, with inline `// ✓ tenant_id filtered` audit comments. Two `sql.raw()` usages found elsewhere (`apps/scheduler-service/src/jobs/system-jobs.ts:1140,1999`) interpolate DB-sourced/server-computed integers, not request input — rated **low**.

## 8. AI Copilot — VERIFIED SOUND (see also `09-ai-copilot-readiness.md`)

No direct DB/vector-store access from any tool. Every tool call proxies through the gateway using the **calling user's own JWT** (`apps/ai-copilot-service/src/domain/ToolRegistry.ts:32-56`), so it inherits the exact same tenant/RBAC scoping as that user's own UI session. No LLM tool-call argument path exists for supplying a tenant ID.

## 9. Scheduler exports/imports — VERIFIED SAFE

`apps/scheduler-service/src/api/{import,export}.routes.ts` — consistent JWT-derived `tenantId`, threaded explicitly (not ambient) into engine calls, with belt-and-suspenders `eq(exportJobs.tenantId, tenantId)` predicates even on job-ID lookups.

## 10. Tenant-suspension enforcement — CONFIRMED NO-OP (new finding, sourced from the plan-vs-implementation cross-check)

`06-entitlement-model.md` names `createTenantContextMiddleware` registration (i.e., actually enforcing that a suspended tenant's requests get rejected) as "not built." Grepping every service's `main.ts` for this middleware today: **zero registrations found anywhere.** `16-phase-roadmap.md` itself flags this as a "hard dependency, currently a no-op." This means a tenant marked `SUSPENDED` for non-payment (the `BillingService.suspendForNonPayment` flow, which does correctly write the suspension state and an audit-log row) has that state recorded but **not actually enforced at the request layer** anywhere in the codebase today. Rated **HIGH** — a real, live security/business gap distinct from tenant-_isolation_ (which is sound); this is tenant-_lifecycle_ enforcement.

## Ranked findings

| #   | Finding                                                                                                                                                                                          | Severity                                   |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------ |
| 1   | RLS covers ~7 of ~250-260 tenant tables (≈2-3%); remaining tables have zero DB-level backstop                                                                                                    | HIGH                                       |
| 2   | `createTenantContextMiddleware` (tenant-suspension enforcement) registered in zero services — confirmed no-op                                                                                    | HIGH                                       |
| 3   | `InvoiceAccountingConsumer.ts:92-99` raw unparameterized SQL string interpolation (sibling file does it correctly)                                                                               | HIGH (code defect, not proven exploitable) |
| 4   | Direct-service-bypass structurally possible (0.0.0.0 binding, no docker network isolation for app services); does not defeat tenant isolation but depends on undefined production network policy | MEDIUM                                     |
| 5   | Internal routes: single static shared key across 9 services — correct by internal-auth convention, but a large blast radius if ever leaked                                                       | MEDIUM                                     |
| 6   | Migration 0177's "unscoped Kafka consumers" comment is stale — code is actually correctly scoped                                                                                                 | DOC-ONLY                                   |

## Confirmed correct, no gap

tenantId-from-JWT everywhere · gateway auth logic · erp_app non-superuser + FORCE RLS mechanics · per-tenant scheduler job isolation · Kafka consumer tenant extraction & GUC scoping · search-service isolation · report-service raw SQL · AI Copilot tool execution · scheduler export/import scoping.
