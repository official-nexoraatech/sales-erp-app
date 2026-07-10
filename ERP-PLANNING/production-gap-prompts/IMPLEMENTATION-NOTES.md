# Implementation Notes — Corrections to Gap-Prompt Docs

The `production-gap-prompts/` docs are written from an audit pass and can be wrong about
implementation details even when the gap itself is real (see `000-Master-Roadmap.md`'s own
note about the roadmap being a snapshot). This file is an append-only log of places where
implementing a PG-XXX prompt turned up a mismatch between what the doc assumed and what the
codebase actually does — so the next session doesn't have to re-derive it.

One entry per gap-prompt, added when the implementing session finds a real discrepancy worth
flagging (not for routine/expected work). Newest at the top.

---

## PG-045 — Payroll Loan Deductions (2026-07-11)

**Doc's Architecture section assumed:** an existing "postingMatrix-table-driven journal-
construction pattern already used for PF/ESI/PT/TDS" that a new loan-recovery credit line
could be added to as one more row alongside those deduction types, within the existing
`PAYROLL_RUN_APPROVED` journal.

**Reality:** no such per-deduction-type breakdown exists for *any* deduction. Read
`apps/accounting-service/src/consumers/PayrollAccountingConsumer.ts` and
`PostingMatrixService.buildJournalEntry` directly: `PAYROLL_RUN_APPROVED` posts exactly one
2-line journal (DR Salaries and Wages / CR Salary Payable) sized at the run's aggregate
`totalNet` — PF, ESI, PT, and TDS are *not* broken into separate payable-account lines
anywhere; they simply reduce `totalNet` and vanish from the books as far as double-entry
tracking goes. Adding a loan-recovery line to that single-rule-per-eventType builder would
mean either inventing a new multi-line-per-event mechanism (real scope creep beyond this
package) or inflating "Salary Expense" by the loan amount to keep the entry balanced (an
accounting distortion).

**Resolution:** wired the recurring EMI recovery to behave exactly like PF/ESI/PT/TDS already
do — it reduces `payrollSlips.loanDeduction` → `totalDeductions` → `totalNet`, which flows
through to the existing `PAYROLL_RUN_APPROVED` event unchanged, with **no new posting-matrix
row**. `EmployeeLoanService.applyMonthlyDeduction` still correctly decrements each loan's
`outstandingBalance` and writes `loan_deduction_history` at approval time (the acceptance
criterion that matters for financial correctness — no double-decrement on DRAFT recalculation)
— that part just isn't *also* mirrored into a GL journal line, consistent with how this
codebase already treats every other payroll deduction. The **one-time loan disbursement**
(a genuine, previously-uncaptured cash event) does get its own proper journal via a new
`EMPLOYEE_LOAN_DISBURSED` event + `EmployeeLoanAccountingConsumer.ts` + `DEFAULT_POSTING_RULES`
row (DR Employee Loans Receivable `1340` / CR Cash `1010`) — that part of the doc was accurate.

**Also confirmed before implementing:** PG-044 (multi-state PT) had already landed —
`computePT(grossMonthly, slabs)` takes the 2-arg shape, not the doc's fallback single-arg
assumption — and `apps/hr-service/src/domain/PayrollEngine.ts:246` still read the hardcoded
`const loanDeduction = 0;` exactly as described.

See `ERP-PLANNING/phase-completions/PG-045_COMPLETION.md` for the full writeup.

---

## PG-043 — Bulk Employee/Attendance Import — Real Processing (2026-07-11)

**Doc assumed:** a fresh implementation session would write the `employee`/`attendance`
`ImportEngine.ts` branches, the hr-service proxy endpoints, and the tests from scratch.

**Reality:** all of it was already present, uncommitted, in the working tree when this session
started (part of a larger concurrent diff that also touches employee photo/document upload
(PG-042) and biometric attendance normalization (PG-041)) — see
[[concurrent_sessions_on_same_repo]]-style caveat. This session verified rather than
re-implemented: read `ImportEngine.ts` in full, confirmed the PAN/bank-account encryption call
shape matches `employee.routes.ts`'s single-create route exactly, confirmed `importJobs.entityType`
is `varchar` (no migration needed), ran `pnpm --filter scheduler-service test` (65/65) and
`pnpm --filter hr-service test` (46/48 — the 2 failures are in `holiday.test.ts`, a file untouched
by this diff, pre-existing and unrelated), and both services' `type-check` (clean).

**Real gap found and left unfixed (matches the doc's own "recommend" language, not a hard
Acceptance Criterion):** bulk-imported employees never get an `EMPLOYEE_JOINED` event published
(the single-create route does, via `ctx.events.publish(...)`), so search-service and other
consumers relying on that event won't see bulk-imported employees until a full reindex. Root
cause: `ImportEngine` is constructed with a plain `ErpDatabase`, not the
`TenantScopedDatabase`+`userId`+`correlationId` context `PlatformEventBus` needs — wiring this in
is a constructor-signature change touching every `ImportEngine` call site, not a one-line fix.
See `ERP-PLANNING/phase-completions/PG-043_COMPLETION.md` for the full writeup.

---

## PG-034 — Cash Flow Report Investing & Financing Sections (2026-07-10)

**Doc's Frontend section assumed:** the Cash Flow page renders `operatingActivities`/
`investingActivities`/`financingActivities` generically off the API response, possibly with a
"hide when empty" conditional to remove.

**Reality:** `apps/web-frontend/src/pages/accounting/CashFlowPage.tsx` already renders all three
sections unconditionally (with a per-section "No activities" fallback row) — no hiding
conditional exists, so no frontend change was needed. However, the page's `CashActivity`
interface reads `a.description` (`CashFlowPage.tsx:9,34`) while `ReportsEngine.getCashFlow()`'s
`CashFlowReport` type — and the route at `apps/accounting-service/src/api/reports.routes.ts:111`,
which returns the engine's output untouched — has always used `label`, not `description`. This
means every activity row's description cell has always rendered blank (amounts and net totals
are unaffected since those use `a.amount`/`net` directly), for the two operating lines that
existed before this change and now for the new investing/financing lines too. This is a
pre-existing frontend/backend field-name mismatch, not introduced by PG-034, and out of this
package's backend-only scope — left untouched. Fixing it means either renaming `label`→`description`
on the frontend interface or renaming the backend's `label` field, either of which is a one-line
fix but touches a file outside this gap-prompt's stated Deliverables.

---

## PG-039 — GSTR-3B RCM/Import/ITC-Reversal Bucket Computation (2026-07-10)

**Doc's Frontend section assumed:** if a GSTR-3B review/export page exists, it should be
extended to surface the newly-computed RCM/reversal figures and the manual-import inputs.

**Reality:** `apps/web-frontend/src/pages/gst/Gstr3bPage.tsx` already exists but reads a
completely different response shape than `Gstr3bService.compute()` actually returns — it
expects flat fields like `table31.a_igst`/`table31.d_igst`/`table4.a_igst` and
`itcSetoff.setoffBreakdown`, none of which exist on the real API response (`table31.outwardTaxable.igst`,
`table31.inwardRcm.igst`, `itcSetoff.setoff.igstFromIgst`, etc., confirmed against
`apps/gst-service/src/domain/Gstr3bService.ts` and `apps/gst-service/src/api/endpoints.ts`'s
`apiClient.get()` which returns the response body untouched — no transform layer exists
anywhere). Every value on the page already renders `—` regardless of this package's changes;
this is a pre-existing, unrelated frontend bug (the page appears to have been built against a
different/earlier API shape and never reconciled), not something introduced or fixable as a
surgical part of PG-039's backend scope. Left untouched — wiring the page to the real response
shape is a separate frontend task, not attempted here since it would mean rewriting the whole
page's data-binding, not adding two RCM rows and two manual-adjustment inputs as the doc assumed.

---

## PG-010 — Service Discovery & API Versioning Strategy (2026-07-10)

**Doc assumed:** there is no `/api/v1` anywhere in the codebase (confirmed by the doc's own
grep of `main.ts` `{ prefix: ... }` registrations), and each of the 9 already-`/api/v2`
services' versioning lives entirely in a `main.ts`-level prefix wrapper.

**Reality the doc's grep missed:** `report-service`'s `analytics-reports.routes.ts` and
`dashboard.routes.ts` hardcode the version directly into each route's *literal path string*
(`fastify.get('/api/v2/reports', ...)`, `fastify.get('/api/v2/dashboard/kpis', ...)`, etc.)
rather than via a `{ prefix }` wrapper — so a `main.ts`-grep for `prefix:` never found it. Two
of those routes are literally `/api/v1/reports/ar-aging` and `/api/v1/reports/ap-aging` — a
real `/api/v1` that does exist, contradicting the doc's "no v1 anywhere" claim. Only
`report.routes.ts` (`/reports/pdf`, `/internal/reports/outstanding-summary`,
`/internal/number-series/:type/next`, etc.) was genuinely unprefixed and safe to dual-register
under an outer `/api/v2` the way the doc describes. Dual-registering `analyticsReportsRoutes`/
`dashboardRoutes` too would have doubled their prefix to `/api/v2/api/v2/reports`. Fixed by
only wrapping `reportRoutes` in the dual unprefixed+`/api/v2` registration and leaving
`analyticsReportsRoutes`/`dashboardRoutes` registered once, untouched. Documented in
`ERP-PLANNING/API_VERSIONING.md`'s own "exceptions" section so this doesn't need re-discovery.

**Frontend consequence:** `web-frontend/src/api/client.ts`'s `BASE_URLS.report` could not get
the `+ '/api/v2'` suffix the other 4 normalized services got — `endpoints.ts`'s report calls
already embed `/api/v2`/`/api/v1` per-call, so suffixing the base URL too would have doubled it
there as well. `report` was left out of the BASE_URLS/gateway-primary-path normalization for
this reason (the gateway's `apiV2` flag for `report` was still flipped to `true`, since that
only affects the truly-unprefixed `reportRoutes` half, which is what the gateway should treat
as primary going forward).

**Verification:** all 5 services' `main.ts` type-check cleanly (`FastifyInstance` explicit
annotation needed on the shared dual-register closures — `typeof fastify` doesn't work as a
parameter type for a plugin passed to `fastify.register`). New
`pg010-api-v2-dual-registration.test.ts` per service (5 total) plus the existing
`gateway-routing.test.ts` (data-driven off `config.ts`, needed no edit) all pass. Full existing
test suites for all 6 touched backend packages + `web-frontend`/`pos-frontend` pass unchanged.
`pnpm install` was needed once for `api-gateway` — `jose` was declared in its `package.json`
but never actually installed, unrelated to this change but blocking `gateway-routing.test.ts`.

**Files touched:** `apps/{auth,notification,report,scheduler,search}-service/src/main.ts`,
`apps/api-gateway/src/config.ts`, `apps/web-frontend/src/api/client.ts`,
`apps/pos-frontend/src/{auth.ts,LoginScreen.tsx,swSync.ts}`, `ERP-PLANNING/API_VERSIONING.md`
(new), `ERP-PLANNING/ERP_MASTER_SPEC.md` (one-line pointer in 6.1), 5 new
`pg010-api-v2-dual-registration.test.ts` files.

---

## PG-002 — Shared Cache Package / MFA-token cache migration (2026-07-10)

**Doc assumed:** the only open question was whether `login.ts` has a `PlatformContext`
(`ctx.cache`) available or only a raw `redis` handle, and that the API contract is unchanged.
Confirmed the former (raw `redis: Redis` param only, no `ctx` — `TenantScopedCache` is
constructed locally, matching `ReportEngine`'s pattern as the doc anticipated).

**Reality the doc didn't anticipate:** `POST /auth/mfa/verify` never receives `tenantId` in its
request body — only `{ mfaToken, code }` — so the read side has no way to construct a
tenant-scoped `TenantScopedCache` unless the tenant travels with the token itself. Fix: the
opaque `mfaToken` returned by login is now `${tenantId}.${randomHex}`; the verify route parses
the `tenantId` prefix before building the cache client, then double-checks it against the
`tenantId` stored in the cached payload. This keeps the API contract truly unchanged (`mfaToken`
is still just an opaque string to the client) while making the Redis key itself tenant-scoped
(`tenant:{tenantId}:mfa:{randomHex}`), which was the actual point of the gap.

**Also found:** `login.ts` importing `TenantScopedCache` from `@erp/sdk` pulls in the *entire*
`@erp/sdk` barrel (package has only one `"."` export, no subpath exports) — `database.ts`,
`events.ts`, `tenantStatus.ts`, `health.ts` all get evaluated too, and reference drizzle-orm's
`sql`. Three existing auth-service test files (`mfa.test.ts`, `security.test.ts`, and the new
`mfa-token-cache.test.ts`) mock `drizzle-orm` without a `sql` export, which crashes any test
that reaches the login handler's account-lockout/IP-block path with "No `sql` export is defined
on the ... mock." Fixed by adding `sql: vi.fn(...)` to each mock (report-service's test suite
already does this for the same reason). Also found `mfa.test.ts`'s `TEST_CONFIG` was missing
`ipLoginFailThreshold`/`ipLoginFailWindowSeconds`/`ipBlockDurationMs` entirely — with those
`undefined`, `recordFailedLoginAndMaybeBlock`'s `count < threshold` check is always `false`,
so it blocked the IP on the very first failed attempt. This was previously masked by the `sql`
crash; added the three fields (matching `config.ts`'s real defaults) so test 9 exercises the
5-attempts-then-block behavior it's actually named for.

**What was actually shipped:** `packages/cache-client` (`@erp/cache`, zero real importers,
confirmed by repo-wide grep) deleted entirely, plus its now-dangling alias in
`apps/auth-service/vitest.config.ts`. `login.ts`'s MFA-token write and `mfa.routes.ts`'s read
(including the per-token attempt-cap counter) now go through `TenantScopedCache` instead of a
raw, unscoped `ioredis` key. `report-service/ReportEngine.ts`'s local
`new TenantScopedCache(this.redis, tid)` construction was left untouched — confirmed intentional
per the doc's own fallback, since `ReportEngine` is instantiated once per service (not
per-request) and reused across tenants.

---

## PG-005 — Postgres Read-Replica Utilization (2026-07-10)

**Doc assumed:** "search-service's reindex/incremental-catch-up queries" are a bulk-read
workload living inside `apps/search-service` (its `main.ts` and "its reindex job caller"),
and should route through `ReplicaRouter` as priority-3 alongside report-service.

**Reality, confirmed by tracing the full reindex path:** search-service does not run bulk
reindex reads at all. The actual jobs (`search.full-reindex` weekly, `search.incremental-sync`
every 10 min) live in **scheduler-service**
(`apps/scheduler-service/src/jobs/searchSyncJobs.ts` /
`searchSyncSources.ts`), which pages through each *owning* service's own
`GET /api/v2/internal/search-sync/:entity` endpoint over HTTP — sales-service, inventory-
service, purchase-service, accounting-service, hr-service, auth-service, and tenant-service
each query **their own local Postgres** (their own `createDatabaseClient()`) and hand back
documents; scheduler-service then POSTs the combined set to search-service's
`/internal/search/reindex/:entity`, which only writes to Elasticsearch. search-service's own
`consumerDb` (constructed in its `main.ts`) is used solely for `dlq_items` writes (Kafka
consumer failure bookkeeping) plus small admin-facing reads (`dlqItems`, `savedSearches`,
`searchAnalytics`) that need read-your-write consistency for the same request — none of it is
the "bulk reindex read" workload the doc described.

**Scope decision:** did not touch search-service, or the 7 owning services' internal
search-sync routes. Routing those owning-service reads through `ReplicaRouter` would be a
real, defensible follow-up (they *are* bulk/latency-tolerant reads, just not where the doc
said they live) — but per this doc's own Integration section, "No other service is in scope
for this pass," and touching 7 services' `search-sync.internal.routes.ts` files is a
materially bigger change than this M-complexity prompt sized. `packages/db-client`'s
`ReplicaRouter`/`isReplicaHealthy` are generic and ready for that follow-up without any
change to this package.

**What was actually shipped:** `packages/db-client/src/replica-router.ts` +
`replica-health.ts` (new, unit-tested), wired into report-service only — `ReportEngine`'s 60
report definitions (`runQuery`'s 78 `db.execute` call sites, default 5s lag threshold) and all
4 `dashboard.routes.ts` handlers (kpis/charts/alerts/pos-analytics, 120s threshold matching
`projection_dashboard_daily`'s existing `STALE_TOLERANCE_MS`). `erp_replica_fallback_total`
counter added to `packages/logger/src/erp-metrics.ts` (this codebase's established
single-source-of-truth for custom Prometheus metrics — `packages/db-client` itself stays
prom-client-free; `ReplicaRouter` takes an `onFallback` callback instead).

---

## PG-026 — Scheduler Log-Only Stub Jobs (2026-07-10)

**Doc assumed:** 44 total jobs, 23 stubs, tenant-iteration bug in `main.ts` — all confirmed
still accurate on re-verification (job count is actually 45 now, since PG-025's session
added `platform.dr-drill-reminder` after this doc's own count was taken — not a discrepancy,
just a later addition).

**Reality that went beyond the doc's own scope:** fixing `main.ts`'s tenant-iteration bug
surfaced a **second** bug the doc didn't anticipate — `JobRegistry.schedule()` never set a
BullMQ `jobId`, so scheduling one job for N tenants would have silently collapsed into a
single repeatable entry instead of N separate ones (BullMQ dedupes repeatable jobs on
`(name, repeat options, jobId)`). Fixed alongside the tenant-iteration loop.

**Two "already real" jobs (per the doc's own inventory) were actually broken:**
`production.reorder-report` and `production.job-work-overdue-alert` called JWT-only routes
with only an `x-internal-key` header (no Bearer token) — every call 401'd, and neither job
checked `res.ok` before `res.json()`, so the failure silently resolved to a count of 0 every
day. Fixed by adding internal-key-guarded route equivalents in
`apps/production-service/src/api/internal.routes.ts` (new file) and repointing both jobs
(now also `tenantScoped: true`, since they had no tenant context before).

**A much bigger, separate bug found and deliberately NOT fixed:**
`WorkflowEngine.resolveApprover()` (`packages/platform-sdk/src/workflow.ts`) stores a
**role ID** in `workflowApprovals.approverId` for `ROLE`-type approvers (its own comment says
"simplified for Phase 1"), but `getPendingForApprover(userId)` then queries that same column
by a real **user ID**. This means "pending approvals for me" has likely never matched real
rows for the ~18 of 19 `SYSTEM_WORKFLOW_DEFINITIONS` entries using role-based approval.
Fixing this properly needs role→user(s) resolution and multi-approver semantics — a
dedicated gap-prompt's worth of work, not a PG-026 fix. `workflow.approval-expiry`/
`workflow.approval-reminder` were implemented to do real, honest bookkeeping against the
schema as it actually behaves (reassignment on escalation, reminder-count increments)
without pretending to resolve/notify a specific person, since that would be silently wrong
today.

**Separately, mid-session discovery (user explicitly approved fixing, not just flagging):**
9 places across the codebase call notification-service at `/api/v2/notifications/...`, but
notification-service registers every route with **no prefix at all** — real paths are
`/notifications/...`. All 9 were silently 404ing (each wrapped in try/catch as best-effort).
This broke password-reset emails, invoice-confirmation emails, POS receipts, CRM campaign
dispatch, and tenant welcome emails. Fixed all 9; the tenant welcome-email path was broken in
three separate ways (wrong URL, wrong body shape, missing `x-internal-key`, and no
`WELCOME_EMAIL` template ever seeded anywhere) — see PG-026_COMPLETION.md for the full list
and the new `POST /notifications/templates/seed-tenant` route added to close the template gap.

**Migration:** `0039_pg026_scheduled_report_snapshots.sql` adds `trial_balance_snapshots` and
`stock_valuation_snapshots` — the only two of the 23 stubs whose own description said
"compute **+ persist**"; every other stub either reminds or triggers an existing service's
compute/reconcile logic without needing new persisted state.

**Not verified:** no live Docker/Postgres/Redis this session — all 23 conversions are
unit-tested (mocked `fetch`/DB), not triggered end-to-end via `JobRegistry.triggerManual`.

## PG-025 — Centralized Log Aggregation / Loki (2026-07-10)

**Doc assumed:** the correlation-ID-to-logger wiring "might" already be threaded from
`createCorrelationIdHook()` into per-request logs, needing only verification.

**Reality, confirmed by grep across every `apps/*/src`:** `createCorrelationIdHook` and
`CORRELATION_ID_HEADER` were **never imported or called anywhere** — not registered as a Fastify
hook in any of the 14 services. It wasn't a partial gap, it was fully unused dead code. Since every
service uses one shared, non-request-scoped `logger` instance (not Fastify's own per-request
`request.log`), correlationId isn't threaded into every individual route handler's log call — doing
that would mean touching every `logger.info/error(...)` call site across ~90 route files, which is
well beyond this prompt's stated "M" complexity. Scoped this down to: register the hook as
`onRequest` in all 14 services (captures/generates the ID, echoes it on the response header) and
attach it to the one framework-wide log call that already exists in every service — the
`setErrorHandler` catch-all. Per-route correlationId enrichment for the ~90 individual route files
is a real, separate follow-up, not solved here.

**Also confirmed, relevant to the LOKI_URL wiring:** backend services run on the **host** via
`turbo`/`tsx` in local dev — `docker-compose.yml` only runs infra containers (confirmed in
`infrastructure/docker/prometheus/prometheus.yml`'s `host.docker.internal:<port>` scrape targets).
So the local `LOKI_URL` is `http://localhost:3100` (Loki's host-exposed port), not
`http://loki:3100` (that's only correct for Grafana's own datasource config, since Grafana itself
*is* a docker-compose container). Don't copy the container-name form into `.env`/`.env.example`.

**Namespace note for the k8s manifest:** the 14 existing service manifests all set
`LOKI_URL=http://loki.erp-infra.svc.cluster.local:3100`, but those same manifests deploy into
`erp-system` (per `namespace.yaml`, which already declares both `erp-system` and `erp-infra` even
though nothing was deployed into `erp-infra` before this). `infrastructure/k8s/loki.yaml` deploys
into `erp-infra` to match that existing hostname — do not put it in `erp-system` alongside the app
services, or the hostname the manifests already reference won't resolve.

**Files touched:** `docker-compose.yml` (+`loki` service, `loki_data` volume, Grafana `depends_on`),
`infrastructure/docker/loki/loki-config.yaml` (new), `infrastructure/docker/grafana/provisioning/datasources/loki.yaml`
(new), `infrastructure/k8s/loki.yaml` (new), `infrastructure/k8s/kustomization.yaml` (+resource),
`.env` / `.env.example` (+`LOKI_URL`), all 14 `apps/*/src/main.ts` (`lokiUrl` into `createLogger`,
`createCorrelationIdHook` registered as `onRequest`, correlationId added to the error-handler log),
`packages/logger/package.json`+`vitest.config.ts` (test infra added — package had none),
`packages/logger/src/__tests__/loki-transport.test.ts` (new, batching/requeue/network-error coverage).

**Not done — flagged, not silently skipped:** live end-to-end verification (Docker Desktop daemon
not running in this session — `docker compose config`/`kubectl kustomize` both validated statically
clean, but no container was actually started); per-route correlationId propagation beyond the
error-handler boundary (see above).

## PG-017 — Password Reset Email Delivery (2026-07-09)

**Doc assumed:** notification-service is triggered via a transactional-outbox event
(`outbox_events` row → relay → Kafka → notification-service consumer), matching the pattern
accounting-service/gst-service use for domain events, and templates are per-tenant Handlebars
files on disk.

**Reality, confirmed by direct code read:**
- `notification-service` has **no Kafka consumer at all** — `main.ts` only registers HTTP
  routes. Every existing caller (hr-service's `alteration.routes.ts`, sales-service's
  `InvoiceNotificationService.ts`, `CampaignService.ts`) triggers it via a direct, best-effort
  `fetch()` to `POST /api/v2/notifications/send-internal` (or `send-raw-internal`), authenticated
  with an `x-internal-key` header, wrapped in try/catch so a notification-service outage never
  blocks the caller's own workflow.
- Templates are **rows in the `notification_templates` table** (`packages/db-client/src/schema/notification.ts`),
  keyed `(tenantId, eventType, channel)` with a unique constraint — not files on disk. "Adding a
  template" means seeding a DB row, mirroring the existing `POST /notifications/templates/seed-hr`
  / `seed-crm` routes (added `seed-auth` following the same shape).
- There is no per-tenant fallback/default template row — `NotificationEngine.send()` looks up the
  exact `(tenantId, eventType, channel)` tuple and silently `SKIPS` (not fails) if nothing matches.
  Every existing seeded event type (`ALTERATION_READY`, `BIRTHDAY_GREETING`, ...) has the same
  gap: a documented **manual one-time POST per tenant** in each phase's completion report. PG-017
  adds `PASSWORD_RESET_REQUESTED`/`EMAIL` to that same list — see the deployment step below.
- `packages/shared-types/src/events.ts`'s `EventTypes` const only feeds the outbox/Kafka domain-event
  system; nothing in the notification-trigger path reads it (existing callers use raw string
  literals, e.g. `'INVOICE_CONFIRMED'`, `'ALTERATION_READY'`). Did not add `PASSWORD_RESET_REQUESTED`
  there — it would be a dead export.
- The reset-confirmation frontend page the doc was unsure about (`ResetPasswordPage.tsx`) already
  exists and is fully wired — not a gap.

**New deployment step introduced (not yet in any completion-report checklist):** after deploy,
`POST /api/v2/notifications/templates/seed-auth` with `{ "tenantId": <id> }` must be run once per
tenant, or password-reset emails will be silently skipped (no error, `notification_log` never gets
a row). Same caveat as the existing `seed-hr`/`seed-crm` steps.

**Files touched:** `apps/auth-service/src/config.ts` (added `frontendUrl`),
`apps/auth-service/src/routes/forgot-password.ts` (fire-and-forget notify call, not awaited before
the response — awaiting would leak a timing side-channel that defeats the email-enumeration
protection), `apps/notification-service/src/api/notification.routes.ts` (`seed-auth` route),
`apps/auth-service/src/__tests__/forgot-password.test.ts` (new).

## PG-009 — Export Job Real File Generation (2026-07-09)

**Doc assumed:** the admin Import/Export tooling console frontend already exists and either
polls `GET /exports/:jobId/status` correctly or needs a small polling-UX fix.

**Reality, confirmed by grep across `apps/web-frontend/src`:** there is no Import/Export console
page at all — nothing in the frontend calls `/imports/upload`, `/exports/generate`, or any
sibling route. The backend CSV-import wizard and this export pipeline are both fully real now,
but unreachable from the UI. Building that console page was out of scope for this pass (it's a
new page, not a "polling fix" as the doc assumed) — flagged to the user as a follow-up, not
silently built or silently skipped.

**Also confirmed, unrelated but relevant to this export:** `customers.gstin`/`customers.pan` and
suppliers' equivalent fields are commented "Encrypted fields — store ciphertext" in
`packages/db-client/src/schema/master.ts`, but `apps/sales-service/src/api/customer.routes.ts`
writes `body.data.gstin || null` directly — no `encryptField()` call anywhere in that path. They
are plaintext today despite the schema comment, which is why the new customer/supplier export
columns can read them directly without a decrypt step. `employees.panEncrypted` /
`.bankAccountNoEncrypted` were **not** included in the employee export regardless (payroll PII is
out of this export's authorization scope) — this finding is about a different, pre-existing gap
that's out of scope here, not something this package fixes.

**Necessary deviation from the doc's file list:** `JobRegistry.triggerManual(name, tenantId)`
had no way to pass job-specific payload (`jobId`/`entityType`/`format`/`filters`) to the BullMQ
worker — it only ever stored `{ tenantId, manual: true }`. Added an optional third `data` param
(merged into the job payload, backward compatible with the one existing caller in
`scheduler.routes.ts`) rather than inventing a parallel enqueue path. The doc's file list didn't
anticipate this because it assumed the manual-trigger primitive already supported arbitrary
payloads.

**Files touched:** `apps/scheduler-service/src/domain/ExportEngine.ts` (new),
`apps/scheduler-service/src/domain/ExportFormatter.ts` (new),
`apps/scheduler-service/src/jobs/exportGenerateJob.ts` (new), `apps/scheduler-service/src/JobRegistry.ts`
(`triggerManual` data param), `apps/scheduler-service/src/main.ts` (StorageClient construction,
job registration), `apps/scheduler-service/src/api/export.routes.ts` (real async pipeline, PDF
rejection, placeholder fallback removed), `apps/scheduler-service/package.json` (`xlsx` dep, same
pin as report-service), plus `ExportEngine.test.ts`/`export-generate-job.test.ts`/`export-routes.test.ts`
(new).

## PG-004 — Vault Secrets Integration, Session A (2026-07-10)

**Scope:** per the doc's own "Next Session Plan," this pass only built the `@erp/config` side
(`vault.ts` client + `loadConfigWithSecrets()` + tests) — no service's `main.ts` was touched.
Re-verified the doc's claim first: still zero `vault`/`Vault`/`VAULT` matches in any service's
`src/`, confirming no application code called Vault before this session.

**Deviation — dependency choice:** used Node 20's native `fetch` instead of the doc's recommended
`node-vault` package. `@erp/config` has zero runtime dependencies today and is imported at boot by
every one of the 14 services; a hand-rolled client against Vault's KV-v2 HTTP API is small enough
(~60 lines) that it didn't justify adding a dependency with that blast radius. The doc itself
flagged this as an acceptable fallback ("...or a minimal raw fetch-based client if a new
dependency is undesirable").

**Deviation — no `@erp/logger` warn log:** the doc asks for a `@erp/logger`-based warn log when a
service falls back to an env var in non-development `NODE_ENV`. Not implemented: `@erp/logger`
already depends on `@erp/config` (for `loadConfig()`), so the reverse import would be circular.
It's also moot under the implemented design — production has no env-var fallback path at all, it
fails fast instead — so there was nothing to log a warning about.

**Real gap found — `FIELD_ENCRYPTION_KEY` doesn't flow through `AppConfig`:** the doc lists this as
the priority-3 secret, but it isn't a field on `AppConfig`/`loadConfig()` at all. It's read ad hoc
via `requireEnv('FIELD_ENCRYPTION_KEY')` at 6 call sites in `hr-service`
(`employee.routes.ts` x2, `payroll.routes.ts` x3, `Form16Service.ts`, `PayrollEngine.ts` x2) plus
separately in `auth-service/src/config.ts`. Migrating it isn't the mechanical one-line swap the
doc assumes for `DATABASE_URL`/`JWT_PRIVATE_KEY` — it needs a design decision (add an `AppConfig`
field vs. a standalone helper) before Session B touches hr-service/auth-service. Documented in
`docs/vault-rollout.md` so Session B doesn't assume it's already wired.

**Fail-fast implementation detail:** `loadConfigWithSecrets()` checks `process.env['VAULT_ADDR']`/
`['VAULT_TOKEN']` directly rather than `AppConfig`'s `vaultAddr`/`vaultToken` fields — `loadConfig()`
defaults those to the Vault dev-mode address and root token (`dev-root-token`) even when unset, so
checking the config fields would never actually detect "not configured" in production.

**Files touched:** `packages/config/src/vault.ts` (new), `packages/config/src/index.ts`
(`loadConfigWithSecrets`, re-exports), `packages/config/src/__tests__/vault.test.ts` (new),
`packages/config/vitest.config.ts` (new), `packages/config/package.json` (vitest scripts/deps),
`.env.example` (Vault path convention documented), `docs/vault-rollout.md` (new runbook).

## PG-004 — Vault Secrets Integration, Session B (2026-07-10)

**Scope:** migrated `auth-service` and `hr-service` to `loadConfigWithSecrets()`, per Session A's
own Next Session Plan. Resolved the `FIELD_ENCRYPTION_KEY` gap flagged in Session A's notes by
extending `loadConfigWithSecrets(serviceName, options)` with `options.extraSecrets: string[]` —
each name is fetched from the same `erp/<serviceName>` Vault path and written back into
`process.env[envKey]` (not returned as an `AppConfig` field). This means the 6 existing
`requireEnv('FIELD_ENCRYPTION_KEY')` call sites in `hr-service` needed **zero** changes — they
keep reading `process.env` as before, now transparently Vault-sourced in production.

**Real bug caught by this migration, not pre-existing:** `auth-service/src/config.ts`'s
`loadAuthConfig()` re-read `process.env['JWT_PRIVATE_KEY']`/`['JWT_PUBLIC_KEY']` itself, after
already spreading `...base` (which has the same fields from `loadConfig()`). That was a harmless
no-op today, but if left in place while switching `base` to `loadConfigWithSecrets()`, it would
have silently clobbered the Vault-sourced key back to an empty string in production — the exact
"silent fallback" failure mode PG-004's Security section calls out as the wrong behavior. Removed
both overrides; `base` is now the sole source for those two fields.

**`hr-service` had no `loadConfig()`/`AppConfig` usage at all before this session** — contrary to
what the doc's "each service's main.ts changes its first line from `loadConfig()` to
`loadConfigWithSecrets()`" description assumes for every service. It read `DATABASE_URL` via a bare
`requireEnv('DATABASE_URL')` and built `redisUrl`/`kafkaBrokers` from raw `process.env` directly.
Only swapped the `databaseUrl` sourcing (the actual secret) to go through
`loadConfigWithSecrets('hr-service', ...)`; left `redisUrl`/`kafkaBrokers`/`port` as direct env
reads unchanged since they aren't secrets and weren't part of this migration's scope.

**Verification status:** `packages/config` unit tests extended to 10 (added `extraSecrets`
fetch-and-write-back + fail-fast-on-missing-extra-secret cases) — all pass. `tsc --noEmit` clean
for `@erp/config`, `auth-service`, `hr-service`. **Not done:** live boot against a real Vault
container — Docker Desktop isn't reachable in this environment (`docker ps` fails), same blocker
noted in other recent sessions. Ran each service's existing test suite as a regression check:
`hr-service` has 2 pre-existing failures in `holiday.test.ts` (untouched by this change, unrelated
route/DB-mock issue) and `auth-service` has 10 pre-existing failures in `mfa.test.ts`/
`security.test.ts` — confirmed unrelated by reading `security.test.ts`, which builds its own mocked
config object directly and never calls `loadAuthConfig()` at all, so the Vault change can't be
their cause. Both look like in-flight, not-yet-working code from concurrent session work on the
2FA/brute-force-lockout feature (untracked files: `mfa.routes.ts`, `suspicious-login.ts`,
`db-helpers.ts`, `domain/`) — flagged here, not fixed, since it's unrelated to PG-004.

**Files touched:** `packages/config/src/index.ts` (`extraSecrets` option),
`packages/config/src/__tests__/vault.test.ts` (2 new tests), `apps/auth-service/src/config.ts`
(`loadConfigWithSecrets` + `extraSecrets`, dropped redundant key overrides, now async),
`apps/auth-service/src/main.ts` (`await loadAuthConfig()`), `apps/hr-service/src/main.ts`
(`loadConfigWithSecrets` replaces `requireEnv('DATABASE_URL')`), `docs/vault-rollout.md` (updated).

## PG-004 — Vault Secrets Integration, Session C (2026-07-10)

**Scope:** migrated the remaining 12 real services (`accounting-service`, `gst-service`,
`inventory-service`, `production-service`, `purchase-service`, `sales-service`, `report-service`,
`scheduler-service`, `search-service`, `event-service`, `notification-service`, `tenant-service`) to
`loadConfigWithSecrets()`. `api-gateway` is a one-line `export {}` stub with zero implementation —
nothing to migrate.

**The doc's premise is wrong for the whole codebase, not just `hr-service`:** confirmed by reading
all 12 remaining `main.ts` files before editing — **none** called `loadConfig()`/`AppConfig`. Every
one used its own `requireEnv('DATABASE_URL')` (or a local `config.ts` wrapper, in
`notification-service`/`tenant-service`, mirroring `auth-service`'s `loadAuthConfig()` shape) built
from ad hoc `process.env` reads. So "each service's main.ts changes its first line from
`loadConfig()` to `loadConfigWithSecrets()`" — the doc's stated Session-C mechanism — doesn't apply
anywhere; the actual edit in every file was "swap the `DATABASE_URL` (and, for `search-service`,
`ELASTICSEARCH_URL`) source, leave the rest of that service's bespoke config untouched."

**`event-service` had a divergent DB-URL default** (`postgresql://erp:erp_password@localhost:5435/erp`,
port 5435, vs. `.env.example`'s `5432`) baked into a raw `process.env['DATABASE_URL'] ?? '...'`
fallback, unlike every other service. Didn't try to preserve that specific fallback —
`loadConfigWithSecrets()` uses `loadConfig()`'s standard default, which only matters if
`DATABASE_URL` is literally unset, and `.env.example` always sets it. Flagging in case the 5435
default was intentional (e.g. a separate event-store DB) rather than copy-paste drift.

**Deliberately not touched — third-party API keys:** `gst-service`'s NIC e-invoice/e-way-bill
credentials and `notification-service`'s MSG91/SendGrid/WhatsApp keys are both read via plain
`process.env[...]` (not `requireEnv()`), tolerant of being unset until the specific feature that
needs them actually runs. Wiring them through Vault's `extraSecrets` (as done for
`FIELD_ENCRYPTION_KEY` in Session B) would make them hard boot requirements in production — a real
product-behavior change the original doc itself deprioritizes ("migrate after the first three are
proven"). Left as an explicit, documented follow-up rather than silently building it or silently
skipping the doc's ask.

**Verification:** `tsc --noEmit` clean for all 12 services. Re-ran each service's full existing test
suite as a regression check — all pass, zero failures introduced (accounting-service 17/17,
gst-service 23/23, inventory-service 22/22, production-service 5/5, purchase-service 25/25,
sales-service 63/63, report-service 118/118, scheduler-service 45/45, search-service 67/67,
event-service 28/28, notification-service 7/7, tenant-service 14/14; skips in several of these are
pre-existing, unrelated to this change). Docker unavailable in this environment (as in Sessions A
and B), so live boot-against-a-real-Vault verification is still outstanding.

**Files touched:** `apps/{accounting,gst,inventory,production,purchase,sales,report,scheduler,
search,event}-service/src/main.ts` (config bootstrap swap), `apps/notification-service/src/config.ts`
+ `src/main.ts`, `apps/tenant-service/src/config.ts` + `src/main.ts`, `docs/vault-rollout.md`
(updated).

## PG-023 — Alerting on Existing Prometheus Metrics (2026-07-10)

**Scope:** deployed Alertmanager (docker-compose), wired the existing 13 alert rules' `severity`/
`channel` labels to real Slack/PagerDuty receivers, added the two missing alert rules the brief's
own scope named (`OutboxLagHigh`, `AuthBruteForceSpike`), plus an optional third
(`StockNegativeEventDetected`, the counter-based companion to `StockWentNegative` the brief floated
as "consider adding").

**The brief's own re-verification held up** — confirmed `alert-rules.yml` already has 13 rules,
`prometheus.yml` already loads them and had `alertmanagers.targets: []`, and no Alertmanager existed
in `docker-compose.yml` or `infrastructure/k8s/`. No further correction needed there.

**One correction found on top of the brief's own correction:** the brief's suggested PromQL for
`OutboxLagHigh` was `sum(erp_outbox_pending_count) by (tenant_id) > <threshold>`. Checked
`packages/logger/src/erp-metrics.ts:93-96` — `erp_outbox_pending_count` is a gauge with **no
`labelNames` at all** (unlike `erp_stock_available_qty` or `erp_auth_brute_force_total`, which do
carry `tenant_id`). A `by (tenant_id)` grouping on a label that doesn't exist would still be valid
PromQL (it'd just produce one series with an empty `tenant_id`), but it's misleading — there's no
per-tenant outbox-lag visibility today. Wrote the rule as a bare `erp_outbox_pending_count > 100`
threshold and documented the missing label in the alert's own `description` field rather than
silently matching the brief's (incorrect) suggestion.

**Alertmanager secret wiring:** the brief's own convention ("env-var-injected, never-committed
secrets") doesn't translate directly to Alertmanager — its config file has no native `${VAR}`
shell-style substitution (unlike docker-compose's own interpolation), and the `prom/alertmanager`
image has no `envsubst`/shell utilities to template one in via a wrapper entrypoint. Used
Alertmanager's native `service_key_file`/`api_url_file` fields instead, backed by Docker Compose's
`secrets: { environment: VAR_NAME }` driver (Compose Spec, not legacy Compose V1) — the secret
content is sourced from the env var but delivered to the container as a mounted file at
`/run/secrets/...`, never as a plaintext env var inside the container. `.env.example` placeholders
are empty strings, which Compose treats as "set" (not "unset"), so `docker compose up` doesn't fail
before real credentials exist — alerts just silently fail to send until they're filled in.

**Verification:** all 4 touched/created YAML files (`alert-rules.yml`, `prometheus.yml`,
`alertmanager.yml`, `docker-compose.yml`) parse cleanly via `js-yaml` (Docker Desktop was down in
this session — consistent with prior sessions — so `promtool check rules` / `amtool check-config`
could not be run locally; both are now wired into CI's `lint` job via a throwaway `docker run
--entrypoint promtool/amtool prom/prometheus:v3.1.0` / `prom/alertmanager:v0.27.0`, so the next CI
run on this branch is the first real syntax check). **Live delivery to a real Slack channel /
PagerDuty incident has not been verified** — no real webhook URL or integration key was available
in this session; this is the documented, expected gap per the brief's own "Known Constraints"
section, not an oversight.

**Files touched:** `infrastructure/docker/alertmanager/alertmanager.yml` (new),
`docker-compose.yml` (`alertmanager` service, `alertmanager_data` volume, top-level `secrets:`
block), `infrastructure/docker/prometheus/prometheus.yml` (alertmanager target, self-scrape job),
`infrastructure/docker/prometheus/alert-rules.yml` (`erp.outbox` group with `OutboxLagHigh`,
`erp.security` group with `AuthBruteForceSpike`, `StockNegativeEventDetected` added to
`erp.business`), `.env.example` (3 new secret placeholders), `.github/workflows/ci.yml`
(`promtool`/`amtool` validation steps in the `lint` job).

## PG-044 — Multi-State Professional Tax Slabs (2026-07-11)

**Scope held up as designed:** employee's branch state (falling back to
`organizationSettings.address.state`) resolves which state's `pt_slabs` rows apply;
`PTSlabService.computePT` is the same loop shape as the old hardcoded `PT_SLABS` constant, just
parameterized. Maharashtra's 3 slabs preserved byte-for-byte from the old constant.

**One correction found the brief didn't anticipate:** the brief's Existing Code Analysis assumed
`branches.address.state` / `organizationSettings.address.state` are clean state values ready to key
a `state_code` lookup on. They're not — `BranchesPage.tsx` (`apps/web-frontend/src/pages/settings/BranchesPage.tsx:136`)
uses a plain `<Input label="State" {...register('state')} />`, not the `INDIAN_STATES` dropdown
`InvoiceFormPage`/`CustomerFormPage`/`GstConfigPage` use elsewhere — so a real branch's `state` could
be `"Maharashtra"`, `"maharashtra"`, `"MH"`, or a typo, not reliably a 2-letter code. Added
`normalizeStateToCode()` in `PTSlabService.ts` (a hardcoded full-name→code map mirroring
`apps/web-frontend/src/lib/indianStates.ts`, which isn't importable from a backend service) so both
forms resolve to the same `pt_slabs.state_code`. An unrecognized value falls through to no match,
which already resolves cleanly to `professionalTax: 0` rather than throwing — no new error handling
needed. Not fixing `BranchesPage.tsx`'s free-text state field itself; that's a separate, unscoped
frontend gap (worth a future PG-XXX: make it a state dropdown for GST/PT/branch-report consistency).

**Cadence normalization (user-confirmed, not silently assumed):** the brief's own Database Changes
section only specced a `monthly_amount` column, no periodicity field, but two of the eight sourced
states aren't natively monthly — Tamil Nadu (Chennai Corporation) levies PT half-yearly, Madhya
Pradesh computes on annual income with an uneven final-month deduction. Asked the user rather than
guessing (statutory monetary figures are exactly what the brief said not to approximate silently);
user chose "monthly-equivalent" — sourced half-yearly/annual figures divided by 6 or 12 and rounded
to the nearest rupee, which reproduces the correct period liability when deducted every payroll run.
Documented as an explicit approximation in `migrations/0045_pg044_pt_slabs.sql`'s header comment, not
hidden in the numbers themselves.

**Sourced slab data (not guessed):** all 7 new states' current PT slabs were pulled from live web
search (BankBazaar/ClearTax/greytHR/FactoHR cross-referenced) at implementation time — see the
migration file's per-state comments for what was sourced vs. normalized.

**Verification:** `pnpm --filter hr-service test` — 54/56 passing, all 16 new PG-044 tests green.
The 2 failures (`holiday.test.ts` → 500 on create/seed) are pre-existing and already documented in
`PG-043_COMPLETION.md` — unrelated file, no uncommitted changes to it, same root cause (the test's
own mock `.where()` never resolves as a bare Promise unless `.orderBy()` is chained after it, which
the POST/seed handlers don't do). `pnpm --filter @erp/db type-check` and
`pnpm --filter @erp/hr-service type-check` both clean — `@erp/db` needed a `pnpm --filter @erp/db
build` first since apps import its compiled `dist/`, not `src/`, and the new `ptSlabs` export
wasn't in `dist` yet (same "stale compiled dist" gotcha noted in prior sessions' `@erp/db` work).

**Files touched:** `packages/db-client/src/schema/hr.ts` (`ptSlabs` table + type exports),
`packages/db-client/migrations/0045_pg044_pt_slabs.sql` (new), `apps/hr-service/src/domain/PTSlabService.ts`
(new), `apps/hr-service/src/domain/PayrollEngine.ts` (`resolveEmployeeState`, wired into
`computeSlip`, removed hardcoded `PT_SLABS`/`computePT`), `apps/hr-service/src/api/payroll.routes.ts`
(both `computeSlip` call sites now pass a per-run `ptStateCache` Map),
`apps/hr-service/src/__tests__/statutory-payroll.test.ts` (16 new tests).
