# 00 — Codebase Audit

**Purpose:** Ground truth for this roadmap. Existing `ERP-PLANNING/TECH_AUDIT.md` and
`CODING_STANDARDS.md` remain the canonical references for stack and conventions — this document
does not repeat them in full. It does three things they don't: (1) flags where they've gone stale,
(2) records what live verification (not just reading code) showed for the pieces this roadmap
touches, and (3) inventories the technical debt that's actually relevant to building CRM features
on top of this codebase.

---

## 1. Architecture overview (confirmed current)

```
Pattern:        Event-driven microservices monorepo, DDD-flavored
Communication:  REST (sync, /api/v2/) + Kafka transactional outbox (async)
Persistence:    PostgreSQL 16 (schema-per-tenant) + Elasticsearch 8.17 (search read model)
Multi-tenancy:  tenant_id column + schema-per-tenant, RLS available but not enabled (see §4)
State changes:  Saga pattern for multi-step flows; optimistic locking via `version` column
Read model:     CQRS projections (projection_dashboard_daily, projection_customer_balance,
                projection_stock_level, and others added since — grep `projection_*` in schema)
```

The pattern itself has not changed since `ERP_MASTER_SPEC.md`/`ARCHITECTURE_AUDIT_REPORT.md` were
written and is not something this roadmap proposes changing. What has changed is which services
are real.

## 2. Corrections to `TECH_AUDIT.md` (dated 2026-06-30 — now stale on these points)

`TECH_AUDIT.md` is still correct on package versions and low-level conventions (Fastify 4, Drizzle
0.38, Zod, React 19, Tailwind v4, etc.) — those don't drift fast. It is **wrong** on project status
claims, because a month of shipped phases has passed since it was written:

| `TECH_AUDIT.md` claim                                                                 | Verified current reality (2026-07-29)                                                                                                                                                                                                                                                                                                                                                                             |
| ------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| §18: `api-gateway` — STUB, "not yet fully implemented"                                | **Real.** `apps/api-gateway/src/app.ts` implements routing, circuit breaker (`upstream-circuit-breaker.ts`), rate limiting, body-limit, compression, and gateway-level auth, each with its own test file. Frontends route through it (see `gateway_cutover` history).                                                                                                                                             |
| §18: `purchase-service` — STUB, "Not started (Phase 5)"                               | **Real and extensive.** 12 domain services: `PurchaseOrderService`, `GRNService`, `RfqService`, `RequisitionService`, `LandedCostService`, `SupplierPaymentService`, `DebitNoteService`, `PurchaseReturnService`, `PurchaseInvoiceService`, `ValuationService`, `ExpenseService`, `GSTCalculator`.                                                                                                                |
| §18: `hr-service` — STUB, "Not started (future phase)"                                | **Real.** `PayrollEngine`, `Form16Service`, `PFChallanService`, `ESIChallanService`, `PTSlabService`/`PTReportService`, `EmployeeLoanService`, biometric integration.                                                                                                                                                                                                                                             |
| §10: "No Cypress / Playwright"                                                        | **Wrong — Playwright is the E2E layer.** `apps/web-frontend/playwright.config.ts` and `apps/pos-frontend/playwright.config.ts` exist; `apps/web-frontend/e2e/` has 34+ spec files including CRM-relevant ones: `live-crm.spec.ts`, `live-sales-crm-remainder.spec.ts`, `campaign-approval-workflow.spec.ts`, `campaign-permissions.spec.ts`, `campaign-preference-center.spec.ts`, `campaign-regression.spec.ts`. |
| §15: RBAC described as "route-level frontend guarding" only, 185 permission constants | **Superseded by `RBAC_ARCHITECTURE.md`** (2026-07-04, explicitly written to replace this section). Current count verified at **296** permission constants, not 185. Branch-scoping, CI route-guard backstop, and the frontend/backend permission-mirror drift bug class are all documented there — read that file, not this section of `TECH_AUDIT.md`.                                                           |
| §4: "Total: 77 tables" across 2 migration files                                       | **Stale by two orders of magnitude of migrations.** `packages/db-client/migrations/` currently has **105 migration files** (`0000` through `0099`+), covering accounting, GST, HR, purchase, campaigns (`0053`–`0062`, `0063` webhook generalization), security/2FA, SSO, billing, and dozens of permission-backfill migrations. Table count is materially higher than 77; don't cite that number.                |

**Implication for this roadmap:** treat `TECH_AUDIT.md` as authoritative for _how things are built_
(patterns, libraries, conventions) and _not_ authoritative for _what's been built_ — verify service
completeness against the actual `apps/*/src/domain/` contents, the way this audit did, rather than
trusting the status table.

## 3. CRM-relevant architecture (net-new findings, not covered by any existing doc)

- **The CRM module has no dedicated service.** Every CRM capability today — customer interactions,
  segments, campaigns, loyalty, health scoring, activity timeline, business seasons — lives inside
  `apps/sales-service`. There is no `crm-service`. Full inventory in `01-CRM-GAP-ANALYSIS.md`.
- **Schema file:** `packages/db-client/src/schema/crm.ts` (410 lines) holds all CRM-specific
  tables. Loyalty transactions are the one exception — they live in `schema/sales.ts` alongside
  the rest of the sales domain.
- **Campaign engine is the most mature CRM subsystem.** It has been built across at least 9
  numbered "CP-" (Campaign Platform) phases visible in schema comments (CP-4 through CP-9) and
  migrations `0053`–`0062`, `0063`. It already has: templates, approval workflow, recurrence rules,
  branch scoping, per-channel/category consent, automation triggers, webhook delivery, and
  engagement-tracking _columns_ that are schema-complete but write-path-incomplete (see gap
  analysis §"Campaign Studio").
- **Scheduler-driven automation exists and is the right integration point for journeys.**
  `campaignAutomationRules` fires via a scheduler-service cron today (`BIRTHDAY` / `INACTIVITY` /
  `ANNIVERSARY` triggers). The Journey Builder in Phase 2 should extend this mechanism, not build a
  parallel one.
- **`ActivityTimelineService` and `HealthScoringService` exist server-side in `sales-service`** with
  no dedicated frontend surface. This is the single highest-leverage, lowest-risk item in the whole
  roadmap (see Phase 1, Customer 360).

## 4. Multi-tenancy, auth, and data model conventions this roadmap must follow

- **Tenant isolation:** every query filters `tenant_id`; RLS exists in `TenantScopedDatabase` but
  per `RBAC_ARCHITECTURE.md` §5 is "deliberately not enabled" outside explicit paths — new CRM
  tables follow the same manual-filter convention as everything else, not RLS.
- **Branch scoping is partial.** Only `sales-service`'s `GET /invoices` list route has real
  `getBranchScope()` enforcement; `campaigns` table already has `branchId` (CP-8) and enforces it.
  New CRM tables with a natural branch dimension (tickets, leads, opportunities) should follow the
  `campaigns` precedent, not leave it for later — retrofitting branch scoping has been a recurring,
  expensive audit finding across this codebase (`RBAC_ARCHITECTURE.md` §5, multiple QA memory
  entries).
- **Auth:** RS256 JWT via `jose`, permissions embedded in the token, re-decoded on refresh. Any new
  customer-facing surface (the Self-Service Portal in Phase 3) is a **new trust boundary** — it
  needs its own token scope (a `CUSTOMER` role that must not inherit staff permissions by default),
  not a relaxed version of the existing internal-user auth.
- **IDs:** `bigserial` PKs, `ulid()` for `outbox_events`/`inbox_events` — never `crypto.randomUUID()`
  (36 chars overflows the `varchar(26)` column; this has bitten the codebase before per
  `TECH_AUDIT.md` §22).

## 5. Testing & CI (current, verified)

- **Backend:** Vitest, ≥80% coverage gate in CI, `describe.skipIf(!process.env['DATABASE_URL'])`
  pattern for integration tests against real Postgres. 10 confirmed `.integration.test.ts` files
  exist today (accounting, inventory ×2, production, sales ×3, tenant) — none yet for CRM-specific
  flows beyond `customer.integration.test.ts`.
- **Frontend E2E:** Playwright, both frontends. The `live-*.spec.ts` naming convention
  (`live-crm.spec.ts`, `live-hr-payroll.spec.ts`, etc.) marks specs that run against a fully live
  local stack (Docker infra + real services), not mocked — this roadmap's Playwright scenarios
  should follow that same naming and intent split: `campaign-*` = scoped feature regression,
  `live-*` = full-stack smoke.
- **CI pipeline** (`.github/workflows/ci.yml`): lint → type-check → test (Postgres+Redis service
  containers) → build (13-service Docker matrix) → Trivy security scan → staged K8s deploy (stub).
  A second workflow, `gitlab-sync.yml`, exists — not relevant to this roadmap.
- **Coverage/quality gate this roadmap must clear, same as every other phase:** `pnpm lint`,
  `pnpm tsc --noEmit`, `pnpm test` (80% line, 100% on critical paths), and the route-guard-coverage
  backstop test.

## 6. Technical debt inventory relevant to CRM work

Carried forward from memory of prior audits in this codebase (verify currency before relying on
any single line — these are pointers to re-check, not guaranteed-still-true facts):

| Debt item                                                                                                                                            | Why it matters to this roadmap                                                                                                                                                                                                                                                              |
| ---------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Campaign `campaign_recipients.opened_at` / `clicked_at` columns exist but are never written                                                          | Phase 2's "Campaign Studio upgrade" feature closes this — don't design a new tracking table, wire the existing one.                                                                                                                                                                         |
| No cross-service read pattern for inventory/AR data — prior audits found the same valuation/balance logic duplicated per-consumer rather than shared | Directly relevant to Phase 1's "ERP-Native Integration Layer" — that feature must NOT duplicate `ValuationService`/`PaymentService` logic; see `02-ARCHITECTURE-RECOMMENDATIONS.md` for the shared-read-layer decision.                                                                     |
| `apiClient.get()` (frontend) returns only `.data`, silently drops pagination/meta siblings                                                           | Any new list endpoint (leads, opportunities, tickets) must be aware of this when wiring its frontend hook — check the response envelope shape against how `invoiceApi`/`customerApi` already handle it.                                                                                     |
| RBAC frontend/backend permission-name drift (`RBAC_ARCHITECTURE.md` §4) — happened 4+ times already                                                  | Every new CRM permission constant added in this roadmap must be added to **both** `packages/shared-types/src/permissions.ts` and `apps/web-frontend/src/constants/permissions.ts` in the same commit, and the actual `requirePermission()` call on the route must be grepped, not inferred. |
| Branch scoping implemented on exactly one route (`GET /invoices`) despite 8 schema files having `branch_id`                                          | New CRM tables with a branch dimension should implement `getBranchScope()` from day one (see §4 above) rather than adding to this backlog.                                                                                                                                                  |
| Role defaults (`role-defaults.ts`) require a one-time backfill migration to reach already-provisioned tenants when changed                           | Every phase that grants a new permission to a default role needs its own `NNNN_<feature>_permission_backfill.sql` migration — this is the established pattern (see the many `*_permission_backfill.sql` files in `packages/db-client/migrations/`), not optional cleanup.                   |

## 7. What this audit deliberately does not re-litigate

Per this codebase's own "golden rules" (`ERP-PLANNING/README.md`): this roadmap does not redesign
the event-driven microservices pattern, does not introduce a new ORM/framework/state library, and
does not challenge the schema-per-tenant multi-tenancy model. Every recommendation in
`02-ARCHITECTURE-RECOMMENDATIONS.md` is a decision _within_ that architecture (which service owns a
new table, how a new read surface composes existing services), not a proposal to change it.
