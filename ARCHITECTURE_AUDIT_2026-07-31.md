# ARCHITECTURE & CODE AUDIT

## NEXORAA Multi-Tenant Cloth Retail ERP Platform

**Audit Date:** 2026-07-31
**Auditor role:** Principal Software Architect / Enterprise Solution Architect / Senior Technical Auditor
**Scope:** Full monorepo — 15 backend services, 3 frontends, 8 shared packages, CI/CD, DB, security
**Method:** Direct code inspection (5 parallel research passes: architecture/tech-debt, API/error-handling, security, testing/DevOps, frontend) cross-referenced against ~90 prior QA-audit sessions on this codebase logged over the past month, plus the two prior root-level audits (`FUNCTIONAL_AUDIT_REPORT.md`, dated 2026-07-01; `ENTERPRISE_STABILIZATION_ROADMAP.md`, same date). Where a prior finding has since been fixed, that is stated explicitly with evidence — this report does not re-list resolved issues as open.
**No code was changed to produce this report.**

---

## 1. EXECUTIVE SUMMARY

NEXORAA is a Turborepo/pnpm monorepo running 15 Fastify microservices plus three React/Vite frontends (web-frontend, pos-frontend, customer-portal) on PostgreSQL 16 + Drizzle ORM, Kafka, BullMQ, Elasticsearch, and Redis, targeting Indian cloth-retail SaaS tenants. The system has been under continuous, aggressive QA for roughly a month: dozens of module-by-module audits have already found and fixed critical defects (₹0 journal postings, broken purchase/sale returns, a session lock-bypass bug, cross-tenant price-list leakage, a platform-wide CORS/CORP misconfiguration that blocked all browser E2E, and a platform-wide error-handler-registration-order bug). Most of the P0 bugs catalogued in the 2026-07-01 `FUNCTIONAL_AUDIT_REPORT.md` (Kafka relay not posting journals, invoice-confirm not writing inventory ledger, purchase-return not writing ledger) are now fixed per that trail of work — that report is **30 days stale** and should not be treated as current status.

This audit's fresh contribution is the cross-cutting, architecture-level view that individual feature audits don't surface. The headline finding: **the platform's biggest remaining risk is not a single bug but a pattern — domain logic that should live in one place is copy-pasted across services, and the copies have started to drift.** The clearest instance: `GSTCalculator.ts` exists independently in sales-service, purchase-service, production-service, and gst-service, and the discount-calculation formula has already diverged between two of them (sales takes `discount OR percentage`; purchase takes `MAX(discount, percentage)`) — a real, live correctness bug, not a hypothetical.

Beyond that, the platform is in noticeably better shape than a rapid month of bug-fixing might suggest it needs to be: the CI/CD pipeline (lint, 80%-coverage-gated tests, Playwright E2E, a 15-service Docker build matrix, SAST/Trivy/TruffleHog/Snyk scanning, staged K8s deploy with auto-rollback) is genuinely enterprise-grade and rare to see this complete at this project stage. Security fundamentals are solid — RS256 JWT, argon2id with timing-attack mitigation, no CORS wildcards anywhere, comprehensive rate limiting, no committed secrets, no raw SQL injection surface. The remaining gaps are architecturally significant but narrow and well-defined: Postgres Row-Level Security is designed but not yet enabled (tenant isolation is currently app-level filtering only), the DR/backup story is real on paper but not yet provisioned end-to-end (local backups only, no offsite copy yet), and three frontends have quietly built three separate small component libraries instead of one.

**Overall ERP Health Score: 74/100** — a solid, actively-improving foundation with a small number of architecturally significant open items, not a platform in crisis.

---

## 2. OVERALL ARCHITECTURE ASSESSMENT

**Is the architecture clean?** Largely yes, at the layer level. All 15 backend services consistently separate `src/api` (routes), `src/domain` (business logic), `src/middleware`, and `src/__tests__`, with Kafka consumers in `src/consumers` (inventory-service instead uses `src/jobs` for its BullMQ work — a minor naming inconsistency, not a structural problem). Route handlers stay thin and delegate to domain services in every service sampled; no evidence of business logic leaking into route files. Fastify bootstrapping (`main.ts`) is now standardized across all 15 services via a shared `registerErrorHandler` helper in `packages/platform-sdk` — this was flagged in an earlier audit as broken (error handler registered after routes in all 15 services) and **is now fixed**, confirmed by direct inspection of all 15 `main.ts` files.

**Where it breaks down: horizontal duplication, not vertical layering.** The monorepo has the right shared-package skeleton (`@erp/db`, `@erp/logger`, `@erp/types` (shared-types), `@erp/sdk` (platform-sdk), `@erp/utils` (shared-utils), `@erp/ui`, `@erp/config`), and the infrastructure-level packages are well adopted — `@erp/logger`/`@erp/db`/`@erp/types`/`@erp/sdk` show consistent, heavy import counts across every service sampled. But **domain-level** shared logic is barely used: `@erp/utils` is imported 3 times by sales-service and **zero times** by accounting-service or inventory-service. The most visible symptom is that a basic money-rounding helper doesn't exist anywhere in `shared-utils`, so `round2`-style logic has been reimplemented independently at 15+ call sites across sales-service, gst-service, purchase-service, production-service, hr-service, and both frontends. This is exactly the kind of "reusable domain rule copy-pasted until it drifts" pattern that produced the GSTCalculator divergence — it is a pattern, not an isolated incident (see also: [[architecture_no_cross_service_valuation]] in prior audits, which found the same class of issue in accounting's consumers before those were partially fixed by passing GST splits through the event payload instead of recomputing them).

**Multi-tenancy**: tenant isolation is currently enforced at the application layer (every table carries `tenant_id`, every query filters on it, JWTs carry `tenantId`) rather than at the database layer. Postgres RLS was designed and partially rolled out (per `ES-36_COMPLETION.md`) but full enablement is explicitly blocked on a "GUC-per-request" gap, and role-default assignment for the bypass permission is incomplete. For a multi-tenant SaaS, this means a single missed `WHERE tenant_id = ?` in any of ~15 services is currently a full cross-tenant data leak with no DB-level backstop — this is the single most architecturally consequential open item in the platform.

**Migrations**: `packages/db-client/migrations/` currently holds 149 sequential SQL files (`0000`–`0148`) and the Drizzle `_journal.json` metadata matches exactly (149 entries, indices 0–148, no gaps or duplicates) — migration bookkeeping is **currently healthy**, contradicting an earlier finding that it was broken. However, per project memory this exact category of problem (journal drift, out-of-order timestamps) has recurred at least three times in the last month (2026-07-11, 07-29, 07-30) even after being "fixed" each time. The process is fragile even though the current state is clean — there is no CI check asserting `_journal.json` entry count matches the file count, which would catch this class of drift automatically before merge.

**Turborepo config**: `turbo.json` pipeline (`build`→`^build`, `test`/`test:coverage`→`^build`, cached on `NODE_ENV`/`DATABASE_URL`/`REDIS_URL` only) is sensibly ordered but under-specified for integration tests: services with real Postgres/Redis integration tests can produce a stale cached "pass" if the underlying seed data or schema changes without any of those three env vars changing, and there's no `globalDependencies` entry for `tsconfig.base.json`, so a shared compiler-option change may not invalidate cached builds repo-wide.

**Technical debt volume is genuinely low.** A repo-wide scan found only 2 real `TODO`/`FIXME` markers in the entire codebase (`gst-service/Gstr1Service.ts:291`, `sales-service/customer.routes.ts:859`), and no meaningful blocks of commented-out dead code. This is unusually clean for a codebase this size and is a real engineering-discipline strength, not a gap this report needs to chase.

---

## 3. MODULE-BY-MODULE FINDINGS

This section summarizes current status per module, drawing on the extensive prior QA trail plus this audit's fresh cross-cutting checks. Where a module was previously found broken and has since been fixed, that is stated — this is not a re-audit of already-closed items.

| Module                    | Current status                                                                                                                                      | Notable open item                                                                                                                                                                                                                                                                                                                                                                                                   |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Auth & RBAC               | Session lock-bypass bug fixed; JWT/RS256/argon2id solid                                                                                             | `auth-service/authenticate.ts` reimplements verification locally (bypasses shared `@erp/sdk`) and returns a flat `{error:string}` shape instead of the platform's `{error:{code,message}}` — the one confirmed inconsistency in an otherwise-uniform auth layer. No refresh-token reuse/theft detection.                                                                                                            |
| Accounting/GL             | 3 critical bugs fixed (₹0 journals, BS/CashFlow divergence); sale-return ₹0 posting bug fixed 2026-07-31 (commit `d9d657e`)                         | 11 separate Consumer classes now trust event-payload GST splits rather than recomputing (fixed), but the underlying `GSTCalculator` logic is still duplicated (not shared) with sibling services and has diverged (see §2).                                                                                                                                                                                         |
| Inventory                 | Cross-tenant price-list vuln + skipped valuation fixed; stock-transfer-cancel-never-reversed-deduction fixed 2026-07-31 (`c68c2ab`)                 | Thinnest test-file-to-source ratio of the sampled services (~0.36) alongside purchase-service.                                                                                                                                                                                                                                                                                                                      |
| Sales/CRM                 | Quotation-acceptance dead end fixed; hardcoded Maharashtra GST state fixed (`dc9651d`); all 4 CRM roadmap phases (32 features) shipped and verified | `InvoiceFormPage` uses raw `useState` instead of the platform's react-hook-form+Zod convention — notable because this is one of the highest-value transactional forms in the app.                                                                                                                                                                                                                                   |
| Purchase                  | GRN creation (was broken for every user) and purchase-return (was 100% broken) both fixed; 7 critical + 8 gaps fixed, scored 93/100                 | Same thin test coverage as inventory-service; `PurchaseInvoiceFormPage` has the same raw-`useState` form pattern as sales.                                                                                                                                                                                                                                                                                          |
| GST                       | GSTR-9 100%-misclassified-as-nil-rated fixed; G1–G7 fixed                                                                                           | e-Invoice/e-Way Bill remain stubbed pending a real `NIC_API_KEY` (external dependency, not a code defect).                                                                                                                                                                                                                                                                                                          |
| HR/Payroll                | Payroll-calc-aborts-company-wide-on-one-bad-record fixed; Employee Loans frontend built (backend pre-existed)                                       | Not independently re-verified this pass.                                                                                                                                                                                                                                                                                                                                                                            |
| Search                    | Zero indexing path for 'stock' entity fixed; index-creation-always-400s fixed                                                                       | Not independently re-verified this pass; prior audit flagged the module was "never tested against a live ES cluster" as of 2026-07-19.                                                                                                                                                                                                                                                                              |
| Event/Distributed Systems | Outbox dead-letters (previously invisible/unreplayable) fixed                                                                                       | Prior audit flagged the Event Store admin page as "permanently empty" — not confirmed fixed or re-checked this pass.                                                                                                                                                                                                                                                                                                |
| Reports                   | 25 broken + 4 mismatched report cases fixed                                                                                                         | A prior audit found **two separate P&L/BS/Trial-Balance implementations exist** (report-service's own `ReportEngine` vs. accounting-service's) — this is unreconciled duplication of a core financial calculation, in the same family of risk as the GSTCalculator finding. Separately, the Digital Adoption Platform module found 43 of 77 backend reports broken (2026-07-20) — status not re-verified this pass. |
| Settings/Platform Admin   | Org Settings 422 and Warehouse-edit-100%-broken both fixed; tenant provisioning/lifecycle verified working                                          | —                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Customer Portal (P3F2)    | Shipped; new `CUSTOMER` JWT role hardened across all 14 services' `authenticate.ts`                                                                 | Prior audit explicitly flagged this needs a **security review before production** — not confirmed done. Also has zero test/UI-library reuse from `@erp/ui` (see §8) and zero E2E coverage (see §9).                                                                                                                                                                                                                 |

---

## 4. RISK MATRIX

| #   | Issue                                                                                                                                                                                                                | Severity                    | Impact                                                                                                                           | Recommendation                                                                                                         |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| 1   | `GSTCalculator` duplicated & diverged across sales/purchase/production/gst-service (different discount formulas)                                                                                                     | **High**                    | Incorrect tax/discount totals on live transactions depending on which service computes them                                      | Extract one canonical GST-calculation module into `shared-utils`; delete the 4 copies                                  |
| 2   | Postgres RLS designed but not enabled; tenant isolation is app-level-filter-only                                                                                                                                     | **High**                    | A single missed `tenant_id` filter anywhere in 15 services = cross-tenant data leak with no DB backstop                          | Unblock the GUC-per-request gap (`ES-36`); enable RLS platform-wide                                                    |
| 3   | Backups are local-only; offsite bucket, `age` keypair, Pushgateway not yet provisioned                                                                                                                               | **High** (for DR readiness) | No real disaster-recovery path exists yet despite drilled RTO/RPO metrics on paper                                               | Provision the 4 outstanding `PG-024` checklist items before treating DR as real                                        |
| 4   | Postgres read replica connection not gated to a read-only DB role                                                                                                                                                    | **Medium-High**             | Replica traffic currently has full write privileges — a routing bug could write through the "read" path                          | Provision `DATABASE_REPLICA_URL` with a genuinely read-only role (`PG-005` open item)                                  |
| 5   | `packages/config`'s `loadConfig` silently falls back to dev-grade secrets, gated only by a `NODE_ENV==='production'` string match                                                                                    | **Medium**                  | A misconfigured prod deploy boots silently with dev secrets instead of failing                                                   | Fail fast whenever any Vault-sourced field is absent, regardless of `NODE_ENV` spelling                                |
| 6   | No refresh-token reuse/theft detection in auth-service                                                                                                                                                               | **Medium**                  | Stolen-token replay only locks out the legitimate user, not the attacker                                                         | Revoke the whole token family on reuse-of-revoked-token detection                                                      |
| 7   | Money rounding reimplemented independently 15+ times, no shared helper exists                                                                                                                                        | **Medium**                  | Latent rounding-drift risk across financial modules                                                                              | Add `round2`/currency helpers to `shared-utils`; migrate call sites                                                    |
| 8   | `packages/ui` has no Modal/Table/Badge/loading primitives                                                                                                                                                            | **Medium**                  | Forces 3 independent reimplementations (web-frontend's local Modal/Badge, pos-frontend's `POS*` set, customer-portal's raw HTML) | Fill out the shared component library; migrate consumers                                                               |
| 9   | `customer-portal` does not depend on `@erp/ui` at all                                                                                                                                                                | **Medium**                  | A11y/consistency fixes made in `packages/ui` never reach the portal                                                              | Adopt `@erp/ui` in customer-portal                                                                                     |
| 10  | `InvoiceFormPage`/`PurchaseInvoiceFormPage` bypass react-hook-form+Zod                                                                                                                                               | **Medium**                  | The two highest-value transactional forms have the weakest validation discipline in the app                                      | Migrate to the platform's standard form pattern                                                                        |
| 11  | API v2 rollout incomplete (report/production/event still unprefixed); gateway `apiV2` prefix mismatch already caused a real 404/401 bug (sales lead-capture)                                                         | **Medium**                  | Recurring footgun for anyone adding new gateway-proxied routes                                                                   | Finish the v2 rollout or explicitly document the 3 exceptions; add a gateway route test that catches prefix mismatches |
| 12  | Test coverage uneven: inventory/purchase-service ~0.36 ratio, auth-service ~0.38                                                                                                                                     | **Medium-High**             | Auth is the thinnest-tested security-critical service                                                                            | Prioritize auth-service test coverage first, then inventory/purchase                                                   |
| 13  | E2E suite mocks the HTTP boundary (not full-stack); customer-portal has zero E2E specs                                                                                                                               | **Medium**                  | Reduced confidence that E2E green = real integration correctness                                                                 | Add a genuine full-stack smoke tier; add customer-portal specs                                                         |
| 14  | `api-gateway` has no detected `/health`/`/metrics` endpoint                                                                                                                                                          | **Low-Medium**              | Reduced ops visibility on the single most externally-facing service                                                              | Add explicit health/metrics routes                                                                                     |
| 15  | `turbo.json` test-cache keys only 3 env vars for integration tests against real Postgres/Redis                                                                                                                       | **Medium**                  | Risk of stale cached "pass" in CI                                                                                                | Broaden cache-key inputs or disable caching for DB-integration test tasks                                              |
| 16  | Migration bookkeeping has broken/drifted 3+ times historically despite currently being clean                                                                                                                         | **Medium**                  | Recurring process fragility                                                                                                      | Add a CI check asserting `_journal.json` entry count == migration file count                                           |
| 17  | Two separate P&L/BS/TB report engines exist (report-service vs accounting-service)                                                                                                                                   | **Medium**                  | Same duplication-drift risk class as #1                                                                                          | Reconcile to one canonical implementation                                                                              |
| 18  | Customer-portal (new CUSTOMER JWT role, hardened across 14 services) flagged as needing security review before prod, not confirmed done                                                                              | **Medium**                  | Newest, most externally-exposed auth surface untouched by a dedicated review                                                     | Schedule the review before enabling in any real environment                                                            |
| 19  | `FUNCTIONAL_AUDIT_REPORT.md`'s remaining P1/P2 feature gaps (AP aging report, multi-currency, GRNI accrual, real NIC e-Invoice/EWB, BOM/manufacturing) — status unverified this pass, report itself is 30 days stale | **Low-Medium**              | Completeness gaps vs. SAP/NetSuite-equivalent features, not defects                                                              | Re-verify current status before prioritizing; don't act on the stale doc directly                                      |
| 20  | DAP module: 43/77 backend reports broken (as of 2026-07-20, not re-verified)                                                                                                                                         | **Low-Medium**              | Feature completeness gap in the reporting layer                                                                                  | Re-verify and triage                                                                                                   |

---

## 5. TOP 20 HIGHEST-PRIORITY ISSUES

See Risk Matrix above (§4) — ordered by severity, this list _is_ the top-20. Items 1–3 are the ones that would most concern a principal architect signing off on a production launch: a live financial-calculation correctness bug, an incomplete database-level tenant-isolation backstop, and a DR story that's real on paper but not yet provisioned end-to-end.

---

## 6. REFACTORING ROADMAP

### Phase 1 — Critical (immediate, this sprint)

- Unify `GSTCalculator` into one shared module; delete the 4 duplicated copies (~2–3 days, high impact — live financial correctness)
- Provision replica read-only DB role + offsite backup bucket + `age` keypair + Pushgateway deployment (infra/ops work, ~1–2 days)
- Add refresh-token reuse detection → revoke session family on replay of a revoked token (~1 day)
- Harden `packages/config`'s production-secret fail-fast so it can't silently boot with dev defaults (~0.5 day)

### Phase 2 — High priority

- Unblock the GUC-per-request gap and enable Postgres RLS platform-wide (~1–2 weeks; architecturally significant, needs careful staged rollout)
- Extract a shared money-rounding/currency helper into `shared-utils`; migrate the 15+ inline implementations (~2–3 days)
- Fill out `packages/ui` with Modal/Table/Badge/EmptyState/Spinner primitives; migrate web-frontend's local Modal/Badge and pos-frontend's `POS*` wrappers onto them (~1 week)
- Migrate `InvoiceFormPage`/`PurchaseInvoiceFormPage` to react-hook-form+Zod (~3–4 days)
- Complete API v2 rollout for report/production/event services, or explicitly document why they're excluded (~2–3 days)

### Phase 3 — Medium priority (cleanup)

- Raise test coverage on inventory-service, purchase-service, and especially auth-service toward parity with sales-service's ~0.8 ratio (ongoing, 1–2 weeks)
- Add E2E coverage for customer-portal; add an explicit standalone login spec and a GRN-receipt spec (~3–4 days)
- Add `/health` and `/metrics` routes to `api-gateway` (~0.5 day)
- Add a CI check asserting `_journal.json` idx count matches migration file count (~0.5 day)
- Reconcile report-service's duplicate `ReportEngine` with accounting-service's canonical one (~investigation + 3–5 days)
- Unify `auth-service`'s `authenticate.ts` error shape with the platform's `{error:{code,message}}` convention (~0.5 day)

### Phase 4 — Long-term / strategic

- Migrate customer-portal onto `@erp/ui` instead of hand-rolled controls (~1 week)
- Broaden `turbo.json` cache-key env vars / add `globalDependencies` for `tsconfig.base.json` (~1–2 days)
- Re-verify and re-scope `FUNCTIONAL_AUDIT_REPORT.md`'s remaining feature gaps (AP aging, multi-currency, GRNI accrual, real NIC e-Invoice/EWB, BOM/manufacturing) before committing effort — that doc is stale
- Triage and fix DAP's 43/77 broken backend reports
- Commission a dedicated query-level performance audit (see §8 — not in scope of this pass)

---

## 7. SECURITY FINDINGS

No Critical or High findings. This is a genuinely strong security baseline:

- **RS256 JWT** throughout, algorithm pinned on both sign and verify (no alg-confusion risk); gateway does full signature verification, not a cheap decode, before trusting tenant claims
- **argon2id** password hashing everywhere, with a dummy hash run on nonexistent-user login to prevent timing-based user enumeration
- **No CORS wildcards** anywhere in the codebase (verified by direct grep across all 15 services) — `credentials:true` is always paired with an explicit origin allow-list
- **No committed secrets**; `.env.example` contains only labeled dev placeholders; production secrets are Vault-sourced with fail-fast behavior when the `NODE_ENV==='production'` gate is correctly set (see Medium finding below for the gate itself)
- **No raw string-concatenated SQL** anywhere; report-service's heavy raw-`sql\`` usage is all parameterized, with the one dynamic-fragment case whitelisted via a ternary rather than interpolated from user input
- **Comprehensive rate limiting** on all 15 services, with auth-service applying stricter per-route overrides (login, forgot-password, MFA-verify) and the gateway keying by verified tenant ID rather than IP alone
- **No sensitive-data logging** found — no log calls embed request bodies, passwords, tokens, or auth headers

Medium findings:

- Insecure dev-default secret fallback gated only by a `NODE_ENV` string comparison (§4 #5)
- No refresh-token reuse/theft detection (§4 #6)

Low findings: argon2 cost parameters use library defaults rather than explicitly tuned values; a `sql.raw()` pattern exists in scheduler-service for a system-generated (not user-controlled) partition name — currently safe but sets a risky precedent if ever reused with user input; S3 object-key filenames aren't sanitized before embedding (low impact, no real traversal risk on an object store, but could produce collision-prone keys).

---

## 8. PERFORMANCE FINDINGS

A dedicated query-level performance audit (slow-query analysis, N+1 detection, EXPLAIN plans) was **not performed in this pass** and should be scoped separately — this section reports what the architecture-level evidence supports, not a full performance audit.

Positive signals: Elasticsearch for search (avoids full-table scans for text queries), BullMQ + Redis for background/async work (keeps request-response paths short), PgBouncer in transaction-pooling mode (connection-exhaustion protection), a Postgres read replica exists for offloading read traffic (though not yet role-gated, see §4 #4), and pagination envelopes are applied consistently across every sampled list endpoint (no evidence of unbounded full-table dumps).

Identified risk: `turbo.json`'s test-result caching for DB-integration-test tasks keys on only 3 env vars, which can mask a stale "pass" result — this is a CI-trust issue more than a runtime-performance issue, but it means performance regressions caught only by integration tests could go unnoticed if the cache doesn't invalidate correctly.

---

## 9. DATABASE FINDINGS

- **Migrations are currently healthy**: 149 sequential files, `_journal.json` matches exactly, no gaps — but this exact area has broken and been repaired at least 3 times in the last month per project history, indicating process fragility even though current state is clean (§4 #16)
- **Drizzle ORM with strict typing** is the standard query path everywhere except report-service, which uses parameterized raw SQL for reporting queries — a deliberate, documented exception, not an anti-pattern
- **Row-Level Security is designed but not enabled** — the single most consequential open database item for a multi-tenant SaaS (§4 #2)
- **Read replica exists but isn't role-gated to read-only** (§4 #4)
- **Backups exist and have been drilled** (24m17s RTO / 2m16s RPO recorded 2026-07-01) but remain **local-only** — the offsite encrypted copy, its `age` keypair, and the Pushgateway metrics deployment are all still-unprovisioned checklist items (§4 #3)

---

## 10. MAINTAINABILITY SCORES (1–10)

| Dimension       | Score | Rationale                                                                                                                                                                                             |
| --------------- | ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Architecture    | 7     | Consistent service layering, low tech-debt markers; deducted for cross-service business-logic duplication and incomplete RLS                                                                          |
| Code quality    | 7     | Uniform Zod validation, clean naming, near-zero TODO/dead-code debt; deducted for the underused `shared-utils` package and the GSTCalculator drift it enabled                                         |
| Security        | 8     | Strong fundamentals across the board (RS256, argon2id, CORS, rate limiting, secrets management); no Critical/High findings, only two Medium gaps                                                      |
| Performance     | 6     | Good architectural building blocks (ES, Redis, BullMQ, PgBouncer); no dedicated query-level audit performed, so this score reflects design signal, not measurement                                    |
| Database        | 7     | Migrations currently clean and Drizzle-typed throughout; deducted for incomplete RLS and the non-role-gated replica                                                                                   |
| APIs            | 8     | Uniform Zod validation, uniform error envelope via a shared handler, consistent kebab-case naming, consistent pagination shape; deducted for incomplete v2 rollout and one auth-service inconsistency |
| UI              | 7     | web-frontend is well-organized and reuses `@erp/ui` genuinely (thin re-export wrappers, not copies); deducted for the incomplete shared component library forcing 3 parallel implementations          |
| Testing         | 6     | CI pipeline itself is enterprise-grade (80% gate, SAST, container scanning, secrets scanning); deducted for uneven per-service coverage (auth/inventory/purchase thinnest) and boundary-mocked E2E    |
| Scalability     | 6     | Solid building blocks (ES, Kafka, BullMQ, PgBouncer, read replica, K8s deploy path) undercut by the RLS gap and an unaudited query-performance layer                                                  |
| Maintainability | 7     | Consistent conventions and shared middleware reduce onboarding friction; the duplicated-logic pattern and three parallel frontend component sets are the main long-term cost centers                  |

---

## 11. FINAL OVERALL ERP HEALTH SCORE: 74/100

This reflects a platform that has been through a genuinely rigorous month of QA — most of the P0-severity bugs a fresh audit would normally lead with have already been found and fixed by prior sessions — combined with a small number of remaining items (GSTCalculator drift, incomplete RLS, unprovisioned DR) that are architecturally significant enough to keep the score out of the 80s until addressed. None of the open items require a rewrite; all are scoped, well-understood, and addressed in the Phase 1–2 roadmap above.

---

_This report is a point-in-time snapshot (2026-07-31). Several modules noted as "not re-verified this pass" should be re-checked before being treated as current, per the project's own practice of treating memory/prior-audit findings as frozen-in-time rather than authoritative for today._
