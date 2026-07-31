# NEXORAA ERP — Production Readiness Report

**Date:** 2026-07-25 | **Scope:** Full platform, 28 functional modules + database layer | **Method:** Fresh ground-up audit — every finding below was independently re-derived against the live running stack (all 14 backend services, both frontends, Postgres/Kafka/Redis/Elasticsearch/MinIO) using real test data on tenant 2 "QA E2E Test Co", not inferred from prior documentation.

Individual module reports: `ERP-PLANNING/production-readiness-audit-2026-07-25/01-*.md` through `28-*.md`.

---

## 1. Executive Summary

This system has a lot of genuinely solid engineering in it: RS256 JWT auth with real brute-force/lockout defenses, a correctly-routed API gateway, working multi-tenant isolation at the application layer, a real double-entry accounting engine with a DB-level trigger that enforces debit=credit at commit time, an 83-report catalog that actually generates correct data, and core transactional workflows (Sales, POS, HR/Payroll, GST) that mostly work end-to-end when exercised individually.

But this audit's dominant finding is not any single bug — it's a **repeating architectural pattern of silent failure** that runs through more than half of the 28 modules audited, and it means the platform's own monitoring cannot be trusted to tell you when something is broken:

1. **`PlatformEventConsumer`** (the shared Kafka-consumer base class used by accounting, sales, search, scheduler, and gst-service) runs the inbox-claim and the event handler in the _same_ database transaction. When a handler throws, the rollback erases its own failure record. The result: **zero DLQ entries, zero FAILED rows, zero alerts — ever — for any consumer-side handler failure in any of those five services.** This was proven with hard numbers: 2,218 events processed across 5 consumer services, 0 marked FAILED, despite provably-failed handlers underneath.
2. Riding on top of that blind spot, a family of **hardcoded, wrong General Ledger account codes** in `PostingMatrixService.ts` has been silently dropping journal entries for GRN receipts, Purchase Returns, Supplier Payments, and Expenses since at least this environment's operational history began. **Tenant 2's real Balance Sheet is arithmetically wrong right now** — negative total assets (-₹786,120), Cash in Hand at -₹868,735, Accounts Payable showing ₹0 despite ₹1.6M+ of real unposted purchase/payment activity.
3. Independently, **28 of ~46 scheduled system jobs** (trial balance snapshots, GSTR-1 prep, payroll prep, stock valuation, customer/loyalty sweeps) silently no-op on every run because of an empty-POST-body bug — and the Scheduler dashboard reports all of them green.
4. The admin observability consoles built to catch exactly this class of problem — **Dead Letter Queue, Saga Monitor, Schema Registry, Event Store** — each have their own bugs (a permanently-empty saga list, a 100%-non-functional filter dropdown, zero real schema enforcement) that mean an operator looking at "all healthy" dashboards today would be looking at false negatives, not confirmation.

None of this was caught by the existing test suites — largely by construction: every accounting consumer test mocks `PostingMatrixService` entirely, every scheduler test mocks `fetch` to return `ok:true`, and there is zero DB-level foreign-key constraint anywhere in the 199-table schema that could have caught a mismatched account code at write time.

**Bottom line: this platform is not production-ready today**, specifically for any tenant that uses Purchase, Supplier Payments, Expenses, or relies on scheduled financial/compliance jobs. The good news is the root causes are narrow and mechanical — one wrong string constant explains 5 of the accounting bugs, one shared base-class bug explains the platform-wide silent-failure pattern, and one missing `body:` field explains 61% of the scheduler outage. Fixing ~4 root causes would resolve a large fraction of the Critical findings below.

---

## 2. Architecture Review

- **Topology:** 14 independently-deployable Fastify backend services + 2 Vite/React frontends (web-frontend, pos-frontend), fronted by a Fastify API gateway (`@fastify/http-proxy`), all sharing a single Postgres 16 instance (199 tables, one `public` schema — services own their own tables by convention, not by database boundary). Kafka (KRaft-free, with Zookeeper) is the event backbone; Elasticsearch backs global search; Redis backs BullMQ job queues and rate limiting; MinIO is S3-compatible object storage.
- **Auth:** RS256 JWT, correctly validated both at the gateway and (now, after an in-progress uncommitted hardening change) with issuer verification at the shared SDK level. Refresh-token rotation, brute-force IP blocking, and audit logging are all real and live-verified.
- **Multi-tenancy:** 100% application-level (`WHERE tenant_id = ...` discipline). **Zero Postgres Row-Level Security policies exist anywhere** — confirmed via `pg_policies`. This was found live-verified to work correctly in every module tested, but it is a single-layer defense with no DB-level backstop, in a codebase that has repeatedly shipped missing-WHERE-clause bugs historically.
- **Event architecture:** Outbox pattern on the publish side (real, working, monitored via a genuine Prometheus `erp_dlq_depth` gauge) paired with a broken inbox/consumer failure-recording path (see Executive Summary point 1). Saga orchestration exists as a registry but only one saga type (`INVOICE_CREATION`) is actually wired, and it turns out to just be instrumentation around an already-atomic single-service transaction — no genuine multi-step cross-service compensation runs anywhere in production today.
- **Schema governance:** A real, working BACKWARD/FORWARD/FULL schema-compatibility engine exists but is called from nowhere in the actual publish/consume path — it's a passive, 3%-populated catalog, not an enforced gate.
- **Database integrity model:** Zero foreign keys across all 199 tables (a deliberate architectural choice for cross-service references, but also applied to same-service relationships that have no such excuse). Zero real CHECK constraints. The one standout exception is a well-built deferred trigger enforcing `debit=credit` on `financial_entries` at commit time, plus an append-only trigger blocking mutation of posted entries — genuinely good design, but narrowly scoped.
- **Two report engines** (accounting-service's own P&L/BS/TB/CashFlow vs report-service's independent implementation) — a historical divergence risk — were confirmed **reconciled** this session: both now produce identical numbers for the same period (including, notably, both correctly reproducing the same wrong numbers from finding #2 above, rather than diverging further).

---

## 3. Module-by-Module Audit — Summary Table

| #   | Module                         | Score /100 | Headline Finding                                                                                                                    |
| --- | ------------------------------ | ---------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Authentication & Authorization | 85         | Mature; impersonation actually works (memory was stale); minor password-reset link + error-shape gaps                               |
| 2   | API Gateway                    | 85         | Historical CORS PUT/DELETE block confirmed fixed; correlation-ID gap on exempt routes                                               |
| 3   | Tenant Management              | 84         | Suspension/isolation/provisioning all genuinely solid; no rollback on failed provisioning                                           |
| 4   | GST                            | 82         | Purchase-side ITC posting independently correct; historical backfill only half-done (`is_interstate`)                               |
| 5   | Reports                        | 82         | Two-engine divergence risk resolved; PDF export never wired to the 83-report catalog                                                |
| 6   | POS                            | 72         | Core till loop solid; GST-state fix silently defeated for CASHIER via a permission-stripping side effect                            |
| 7   | HR & Payroll                   | 72         | Payroll↔Accounting integration genuinely solid; loan force-close writes off balance with no reversal; leave balances never enforced |
| 8   | Search                         | 70         | Real-time ES indexing collides 7 entity types on doc id "0"; sale returns/delivery challans never indexed at all                    |
| 9   | Sales (Order-to-Cash)          | 68         | "Convert to Invoice" is a dead end that bricks quotations; same aggregateId ES collision bug                                        |
| 10  | CRM                            | 62         | Segments/Campaigns/Webhooks genuinely real; "Leads" never built; SALES_MANAGER has almost no CRM permissions                        |
| 11  | Customers                      | 62         | Credit-limit enforcement works server-side with zero UI to enable it; GSTIN search doesn't work despite the UI claiming it does     |
| 12  | Database (cross-cutting)       | 62         | Zero FKs/CHECK constraints platform-wide; "replica" isn't a replica and has been down 4 days                                        |
| 13  | Security                       | 58         | RLS absent, encryption inconsistent (supplier bank accounts plaintext), Vault real but never live-exercised                         |
| 14  | Audit Logs                     | 58         | Solid architecture; entire Purchase module writes zero audit entries                                                                |
| 15  | Event Service (backend)        | 58         | Definitively confirmed DLQ never sees consumer-side failures — the root of the platform-wide blind spot                             |
| 16  | Dead Letter Queue (admin)      | 58         | Mechanism works for its narrow scope; UI copy overstates coverage, false operator confidence                                        |
| 17  | Event Store (admin)            | 58         | Write path genuinely shipped; entity-type filter dropdown 100% non-functional                                                       |
| 18  | Inventory                      | 52         | Multi-warehouse stock check uses tenant-wide total (WACC default); LOSS adjustments never post to ledger                            |
| 19  | Purchase                       | 48         | GRN + Purchase Return post **zero** GL journal entries, silently, every time                                                        |
| 20  | Notification                   | 48         | Every tenant provisioned since 2026-07-17 got zero notification templates (Zod schema bug); preferences UI inert                    |
| 21  | Organization                   | 48         | Invoice-number-prefix reconfiguration always 500s; logo/branding pipeline solid                                                     |
| 22  | Job Work + Consignment         | 48         | Job Work has zero accounting integration at all; Consignment sale-recognition never wired to any route                              |
| 23  | Performance Dashboard (admin)  | 45         | Functional but misleading — "baselines" are single raw samples, not percentiles; P50/P99 literally render "nullms"                  |
| 24  | Accounting                     | 35         | **Headline finding** — real tenant Balance Sheet is currently wrong; 7/19 posting rules reference nonexistent accounts              |
| 25  | Suppliers                      | 35         | Supplier Payment confirmed to hit the same silent-posting bug; RBAC fixes don't backfill to provisioned tenants                     |
| 26  | Scheduler                      | 35         | 28/46 system jobs silently no-op (empty POST body); dashboard shows them all green                                                  |
| 27  | Schema Registry (admin)        | 30         | Zero enforcement anywhere in the real publish path; the one registered schema has already drifted from reality                      |
| 28  | Saga Monitor (admin)           | 22         | List is permanently empty for every tenant; only 1 saga type is real, and it wraps an already-atomic transaction                    |

**Simple average across all 28 areas: 57.9/100.** This number is misleading on its own — it weights "the Saga Monitor's list is empty" the same as "the real Balance Sheet is wrong" — see §14 for a business-criticality-weighted view.

---

## 4. End-to-End Workflow Validation

| Workflow                                                                             | Result                                                                                                                                                                                                                                      |
| ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Customer → Quotation → Sales Order → Invoice → Payment                               | **Broken at one step**: quotation "Convert to Invoice" flips status without creating an invoice, permanently bricking the quotation. The remaining chain (once an invoice exists) works correctly, including GST split and stock deduction. |
| Invoice → Sale Return → Accounting → GST                                             | **Works.** Confirmed non-zero, correctly-signed journal + GST ledger entry (recent fix `d9d657e` holds up live).                                                                                                                            |
| Purchase Order → GRN → Accounting → GST                                              | **Half broken.** GST-side ITC posting works independently; accounting-side posts **zero** journal entries, silently, every time.                                                                                                            |
| GRN → Purchase Return → Accounting                                                   | **Half broken**, same pattern as above.                                                                                                                                                                                                     |
| Supplier Payment → Accounts Payable                                                  | **Broken.** Same silent-posting bug family; AP subledger updates correctly on the purchase-service side but never reaches the general ledger.                                                                                               |
| Sales Order → Delivery → Invoice → Search Index                                      | **Partially broken.** The business data is correct, but real-time search indexing collides on Elasticsearch doc id "0" for invoices/quotations/POs/GRNs/purchase-returns/payments/employees; self-heals within a ~10-minute reindex window. |
| Payroll: Employee → Salary Structure → Payroll Run → Disbursement → Accounting       | **Works**, including the historical "one bad employee aborts the whole batch" bug confirmed fixed.                                                                                                                                          |
| Employee Loan → Repayment                                                            | **Works** for the disburse/repay happy path; force-close can write off an outstanding balance with zero accounting reversal.                                                                                                                |
| Leave Apply → Approve → Balance Deduction                                            | **Broken.** Leave balances were never seeded/enforced for this tenant; both apply and approve silently skip the check.                                                                                                                      |
| POS Sale → Shift Close → Invoice → GST                                               | **Works** end-to-end for the till operator flow, but the GST state used depends on a permission side-effect that's broken specifically for CASHIER (see module #6).                                                                         |
| Job Work Order: Issue Materials → QC → Complete                                      | **Works** for inventory/status mechanics; **zero accounting posting** occurs anywhere in the flow.                                                                                                                                          |
| Consignment: Receive → Settle → Recognize Sale                                       | **Broken at the last step.** Recognizing a sale from consigned stock has no route/caller anywhere in the codebase; 17 real historical consignment rows all show `soldQty=0`.                                                                |
| Tenant Provisioning → Suspension → Reactivation                                      | **Works correctly**, including enforcement (not just a DB flag) and audit logging.                                                                                                                                                          |
| Scheduled job: Trial Balance Snapshot / GSTR-1 Prep / Stock Valuation / Payroll Prep | **Broken for 28 of ~46 jobs** — silently no-op due to an empty-POST-body bug; dashboard reports them all `COMPLETED`.                                                                                                                       |

---

## 5. Integration Matrix

Rows = module; columns = whether the integration is confirmed working (✅), confirmed broken (❌), or not applicable/not tested (—).

| Module                            | Accounting                     | GST                             | Search Index      | Audit Log               | Events Published             | RBAC Enforced                  |
| --------------------------------- | ------------------------------ | ------------------------------- | ----------------- | ----------------------- | ---------------------------- | ------------------------------ |
| Sales (Invoice)                   | ✅                             | ✅                              | ❌ (id collision) | ✅                      | ✅                           | ✅                             |
| Sale Return                       | ✅                             | ✅                              | —                 | ✅                      | ✅                           | ✅                             |
| Purchase (GRN)                    | ❌                             | ✅                              | ❌ (id collision) | ❌ (never logged)       | ✅ (published, not consumed) | ✅                             |
| Purchase Return                   | ❌                             | ✅                              | ❌ (id collision) | ❌                      | ✅ (published, not consumed) | ✅                             |
| Supplier Payment                  | ❌                             | —                               | —                 | ❌                      | ✅ (published, not consumed) | ✅                             |
| Inventory (Stock Adjustment LOSS) | ❌                             | —                               | ✅                | partial (creation only) | ✅ (published, not consumed) | ✅                             |
| Inventory (Stock Adjustment GAIN) | ✅ (mislabeled account)        | —                               | ✅                | partial                 | ✅                           | ✅                             |
| HR / Payroll                      | ✅                             | —                               | —                 | ✅ (full lifecycle)     | ✅                           | ✅                             |
| Employee Loan                     | ✅                             | —                               | ❌ (id collision) | ✅                      | ✅                           | ✅                             |
| Job Work                          | ❌ (none exists)               | —                               | —                 | —                       | ✅ (published, no consumer)  | partial (only OWNER/ADMIN)     |
| Consignment                       | — (never recognized as a sale) | —                               | —                 | —                       | —                            | partial                        |
| CRM (Campaigns)                   | —                              | —                               | —                 | ✅                      | ✅                           | ❌ (SALES_MANAGER lacks perms) |
| POS Sale                          | ✅                             | ⚠️ (state hardcode for CASHIER) | ❌ (via invoice)  | ✅                      | ✅                           | ✅                             |

---

## 6. Missing Functionality

- **CRM Leads** — assumed to exist per module scope, doesn't exist anywhere in the codebase (backend or frontend); the marketing site's own code has a comment admitting no lead-capture endpoint exists.
- **PDF export for the general report catalog** — Puppeteer PDF generation itself works, but is wired to only 8 fixed internal document types, not any of the 83 reports in the catalog.
- **Consignment sale recognition** — the method exists (`ConsignmentService.recordSale()`) but has no route and no caller anywhere.
- **Job Work accounting integration** — no posting path, no consumer, nothing in `PostingMatrixService` for any `JOB_WORK_*` event.
- **SSO login** — tenant-service has full SSO config CRUD; auth-service has no SSO login route at all, so a configured IdP does nothing.
- **True Postgres streaming replication** — the configured "replica" is a second, independent, non-streaming Postgres instance that has been stopped for 4 days.
- **Notification Preferences enforcement** — the UI/API exist and store opt-outs, but nothing in the send path ever reads them.
- **DLQ coverage for consumer-side failures** — only ever catches Kafka publish failures; the much larger class of consumer handler failures has no equivalent safety net anywhere.

## 7. Incomplete Features

- **MFA** — backend logic exists and unit-tests pass, but no live end-to-end verification was possible (no seeded TOTP test user).
- **Saga orchestration** — the registry supports arbitrary saga types; only one (`INVOICE_CREATION`) is wired, and it's a thin wrapper around an already-atomic transaction, not genuine multi-step compensation.
- **Schema Registry enforcement** — a real compatibility engine exists but is invoked from nowhere; catalog covers ~3% of real event traffic.
- **Vault secrets integration** — real client code, real tests, wired into 11+ services' config loaders, but short-circuits to plain env vars outside `NODE_ENV=production` and has never made a live call in this project's history.
- **Fiscal-year-start organization setting** — saved and displayed, but has zero downstream consumers; accounting-service's own Financial Year feature is fully disconnected from it.
- **Performance Dashboard "baselines"** — the plumbing is real, but it reports the single latest raw sample per endpoint as if it were a P95/P99 percentile; only ever populated by manual k6 load-test runs, not live traffic.

---

## 8. Bugs Found — Grouped by Root Cause

Rather than list 60+ individual findings flatly, most of them collapse into a handful of root causes. Fixing these ~8 things resolves a large fraction of everything below.

### Root Cause A — `PlatformEventConsumer` same-transaction rollback (CRITICAL, platform-wide)

`packages/platform-sdk/src/events.ts`: the Kafka inbox-claim insert and the event handler execute inside the same DB transaction. A handler throw rolls back the claim row too, so the subsequent "mark FAILED" update matches 0 rows — a completely silent, untraceable failure. Confirmed live in accounting-service (0/138 FAILED despite provable failures) and by code-grep to be shared by sales-service, search-service, scheduler-service, and gst-service. **This is the single highest-leverage fix in the entire audit** — every other "silent failure" finding below rides on top of this one bug.

### Root Cause B — Wrong/missing GL account codes in `PostingMatrixService.ts` (CRITICAL, financial-integrity)

7 of 19 posting-rule event types reference account codes that don't exist in the real seeded chart of accounts (`'2010'` for Accounts Payable — real code is `'2100'`; GST input-credit codes `1410/1420/1430` never seeded at all; `'6110'` missing from provisioned tenants). A further 4 "working" event types post to mislabeled sub-ledger accounts. Structurally enabled by **zero DB-level foreign key** from `posting_matrix`/`financial_entries` account codes to the real `accounts` table (confirmed in the DB review) — a code-resolution miss is silently `continue`d instead of raising an error. Affects: GRN_APPROVED, PURCHASE_RETURN_APPROVED, SUPPLIER_PAYMENT_MADE, EXPENSE_APPROVED, EXPENSE_PAID, STOCK_ADJUSTMENT_LOSS. **Live consequence: tenant 2's real Balance Sheet reports negative total assets and ₹0 Accounts Payable today.**

### Root Cause C — `aggregateId` defaults to `0` in real-time search indexing (HIGH, platform-wide)

`packages/platform-sdk/src/events.ts` builds the Elasticsearch document ID from `businessPayload['id']`, but most producers use semantic field names (`invoiceId`, `quotationId`, etc.) instead of a literal `id`. Confirmed live ES collisions on doc `_id="0"` for invoice, quotation, purchase order, GRN, purchase return, payment, and employee. Bounded by scheduled reindex jobs (10-min/weekly) but causes real staleness/pollution windows and permanent zombie documents.

### Root Cause D — Empty-body scheduled HTTP jobs (CRITICAL, scoped to scheduler-service)

28 of ~46 system jobs send `Content-Type: application/json` with no `body:` field on their `fetch()` POST calls; every downstream service's parser rejects with 400, but the handlers never check `res.ok`, so `job_history` records `COMPLETED` regardless. Affects trial balance snapshots, GSTR-1 prep, payroll prep, stock valuation, and most customer/loyalty/reminder sweeps platform-wide.

### Root Cause E — Recurring dead-permission-constant pattern (HIGH, recurring across many modules)

A role is granted one permission constant in `role-defaults.ts` while the route checks a different, similarly-named one (or the constant was simply never added for that role). Recurred independently in: CRM (SALES_MANAGER has almost no CRM permissions), Customers (`CUSTOMER_UPDATE` vs `CUSTOMER_EDIT` mismatch), GST (AUDITOR can see GSTR-9 but not GSTR-1/2A/3B), Job Work/Consignment (PURCHASE_MANAGER/INVENTORY_MANAGER have zero permissions for either feature). This pattern has recurred across many independent sessions per project history — it is a process gap in how `role-defaults.ts` changes get reviewed, not a one-off bug.

### Root Cause F — RBAC fixes don't backfill to already-provisioned tenants (HIGH)

Permission grants added to `role-defaults.ts` only apply to newly-provisioned tenants; already-live tenants' `role_permissions` rows are never updated. Confirmed live: a supplier-statement-view permission "fixed" in a prior session's `role-defaults.ts` change never actually reached tenant 2's live database.

### Root Cause G — Admin observability consoles overstate their real scope (HIGH, trust/UX)

- DLQ page copy ("the safety net for that failure class") implies full-platform consumer-failure coverage; it only ever catches Kafka _publish_ failures (Root Cause A's failures never reach it).
- Saga Monitor list is **permanently empty for every tenant** (response-wrapper mismatch — expects a nonexistent `.content` field), and 3 of 5 summary tiles show wrong values from a field-name mismatch.
- Schema Registry shows a working compatibility engine with zero real enforcement anywhere.
- Event Store's entity-type filter returns zero results for every option, including populated ones.

Each of these means an operator looking at a green/empty dashboard is not confirming health — they're looking at a blind spot.

### Root Cause H — Zero DB-level integrity backstops (HIGH, structural)

Zero foreign keys and zero real CHECK constraints across all 199 tables (one well-built exception: a deferred trigger enforcing `debit=credit` on `financial_entries`). Tenant isolation and referential integrity rely 100% on application-code discipline — exactly the layer where every bug above occurred.

### Standalone Critical/High findings (not part of a shared root cause)

- **Quotation "Convert to Invoice" dead end** — flips status to CONVERTED without creating an invoice; the record becomes permanently unusable (Sales, #9).
- **Inventory stock check uses tenant-wide total instead of per-warehouse** for WACC-costed items (the default) — permanent, non-self-healing desync between warehouses; reconfirmed independently in Purchase Return (Inventory #18, Purchase #19).
- **Notification template seeding is broken for all tenants provisioned since 2026-07-17** — a self-contradictory Zod schema (`.positive().default(0)`) 400s silently on every seed call; 16 of 28 tenants affected (Notification #20).
- **Entire Purchase module writes zero audit log entries** — no POs, GRNs, Purchase Returns, Supplier Payments, Requisitions, RFQs, or Expenses are logged at all (Audit Logs #14).
- **Invoice-number-prefix reconfiguration always 500s** — an `ON CONFLICT` target missing `branch_id` (the table's real unique constraint) makes the feature permanently unusable (Organization #21).
- **Employee loans can be force-closed with the balance still outstanding** — no status guard, no accounting reversal, no audit trail (HR #7).
- **Leave balance enforcement has never actually applied** — zero seeded balance rows; both apply and approve silently skip the check (HR #7).
- **CASHIER's GST-state fix is silently defeated** by an unrelated permission-stripping side effect on the organization endpoint — invisible on this test tenant only because its GSTIN happens to start with the same state code as the hardcoded fallback (POS #6).
- **Tenant-level OWNER can trigger platform-wide, cross-tenant maintenance jobs** with no additional guard (Scheduler #26).

---

## 9. Security Findings

| Area                  | Finding                                                                                                                                                                                            | Severity  |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| Row-Level Security    | **Completely absent** — zero Postgres RLS policies anywhere; tenant isolation is 100% application-level with no DB-level backstop                                                                  | High      |
| Encryption at rest    | Real AES-256-GCM used correctly for TOTP secrets and employee bank accounts (byte-level verified), but **supplier bank account numbers are plaintext** despite a schema comment claiming otherwise | High      |
| Vault secrets         | Real, tested integration, but short-circuits to plain env vars outside `production` and has never made a live call                                                                                 | Medium    |
| File upload           | Object-key construction concatenates raw, unsanitized client filenames with no path-traversal stripping                                                                                            | Medium    |
| Blocked-IP management | `blocked_ips` table has zero exposed admin routes to view/manually unblock                                                                                                                         | Medium    |
| Security Audit Log UI | Action-type filter covers only 5 of 12 real backend-emitted action types                                                                                                                           | Medium    |
| Privilege escalation  | Tenant-level OWNER can trigger platform-wide maintenance jobs affecting all tenants (Scheduler)                                                                                                    | High      |
| XSS                   | Verified clean — the recent HTML-injection-in-emails fix is correct and properly scoped; no other stored-XSS found (Handlebars auto-escapes)                                                       | — (clean) |
| SQL Injection         | Verified clean — Drizzle ORM throughout; the one raw SQL usage is fed a system-generated value, not user input                                                                                     | — (clean) |
| CSRF / token handling | Verified clean — httpOnly + SameSite=strict cookies, tokens never in localStorage                                                                                                                  | — (clean) |
| Secrets in repo       | Verified clean — `.env` properly gitignored, no hardcoded secrets found                                                                                                                            | — (clean) |

---

## 10. Performance Findings

- No current full-table-scan risk: indexing on hot financial/operational tables (invoices, journals, inventory_ledger, audit_log, gst_ledger) is comprehensive and correctly tenant-scoped — but this is **unverified at realistic production volume**; the largest table today has ~31k rows and everything transactional is in the tens-to-hundreds.
- The Performance Dashboard itself is not measuring real production performance — it only ever reflects manual k6 load-test runs, and its "P95 baseline" is actually just the single latest raw sample.
- Rate limiting is confirmed live and working at the gateway (in-memory/per-pod, not distributed — a horizontal-scaling caveat, not a current bug).
- Report generation (sync, async, CSV/Excel export) performs acceptably against current data volumes; not stress-tested.
- No N+1 query patterns were specifically hunted for in this pass; out of scope given the volume of higher-severity correctness findings.

---

## 11. Technical Debt

- Zero foreign keys / zero CHECK constraints across 199 tables — an explicit architectural choice for cross-service references, but incorrectly also applied to same-service relationships with no such excuse.
- `PostingMatrixService`'s account-code resolution silently `continue`s on a miss instead of raising — the single design decision that turned 7 typos into 7 silent financial-integrity bugs.
- Migration tracking table (`drizzle.__drizzle_migrations`) has drifted 16 entries behind the real migration files on disk — cosmetic today, but makes `drizzle-kit migrate` unsafe to run blind against this database (one migration does a non-idempotent column rename).
- Test suites structurally cannot catch the account-code bug class: every accounting consumer test mocks `PostingMatrixService`; the one test that exercises it directly hand-builds a synthetic account list containing only the codes it needs.
- Scheduler's test suite mocks `fetch` to always return `ok:true`, structurally unable to catch the empty-body bug.
- An uncommitted, in-progress JWT-issuer validation hardening change (`packages/platform-sdk/src/auth.ts`) is currently breaking test suites across sales, CRM, customers, inventory, purchase, accounting, HR, GST, event-service, and DLQ modules — production behavior is unaffected (auth-service already sets the matching issuer), but this means the RBAC-boundary regression suites across most of the platform currently provide **zero effective CI coverage** until either the tests are updated or the change is reverted.
- Two independent, unlinked scheduling systems exist side by side (scheduler-service's BullMQ-based `JobRegistry` and report-service's own `croner`-based `ScheduledReportJob`) with no shared observability.

---

## 12. Code Quality Assessment

- Consistently structured Fastify services with Zod validation, Drizzle ORM, and a shared platform-sdk — the architecture itself is coherent and the pattern is followed consistently across services.
- The recurring bug shapes (dead permission constants, hardcoded state/branch literals, account-code typos) suggest a review-process gap rather than a skill gap — the same class of mistake (a string constant that must match another string constant defined elsewhere, with no compiler or DB check tying them together) recurs across at least 4 unrelated subsystems (RBAC, GL account codes, GST state codes, ES aggregate IDs).
- Where DB-level enforcement was actually used (the `financial_entries` balance/append-only triggers), it worked and caught what it was designed to catch — a good argument for extending that pattern (FKs, CHECK constraints) rather than relying purely on app-code discipline going forward.
- Silent-failure code style (`catch` blocks that log to raw `process.stderr` instead of the structured logger, or that swallow non-2xx HTTP responses without checking `res.ok`) is the second most common defect shape in this audit after the constant-matching problem above.

---

## 13. Test Coverage Analysis

- Per-service unit test suites are extensive and mostly passing (e.g., 135/135 for report-service, 71/71 for scheduler-service, 60/60 for tenant-service) — but passing tests were repeatedly shown this session to provide a false sense of coverage, because they mock away exactly the integration points where the real bugs live (`PostingMatrixService`, `fetch`, response wrappers).
- The uncommitted JWT-issuer hardening change (Root Cause noted in §11) is currently causing test failures across roughly 10 modules; these are confirmed test-infrastructure breakage, not real regressions, but they mean genuine RBAC-boundary coverage is effectively zero right now across a large share of the codebase.
- No integration test anywhere loads the real, full chart of accounts and asserts every `PostingMatrixService` rule resolves against it — this is the single test that would have caught the audit's biggest finding, and it doesn't exist.
- No test exercises a scheduled job's HTTP call against a real (non-mocked) Fastify body parser — this is the single test that would have caught the second-biggest finding.
- UI/browser-level (Playwright) coverage was largely out of scope for this API/DB-level audit pass; several modules (Accounting, HR loans/leave, some POS flows) were verified via API calls that mirror frontend behavior rather than a driven browser.

---

## 14. Production Risks — Ranked by Business Criticality

A simple average of module scores (§3) understates the real risk because it weights an empty admin list the same as a wrong Balance Sheet. Weighted by what actually touches money, compliance, or customer trust:

**Tier 1 — Do not launch with these unresolved:**

- Accounting (35), Suppliers (35), Purchase (48) — real financial statements are wrong today for any tenant using Purchase.
- Scheduler (35) — compliance-critical jobs (GSTR-1 prep, trial balance) silently don't run.
- Inventory (52) — multi-warehouse stock can silently desync under the default costing method.

**Tier 2 — Fix before scaling beyond the pilot tenant:**

- Notification (48) — new tenants get no notification templates at all.
- Security (58) — no RLS, inconsistent encryption, a live privilege-escalation path.
- Database (62) — zero integrity backstop, and the "replica" doesn't exist for DR purposes.
- Job Work / Consignment (48), Organization (48) — real feature gaps in Production/branding config.

**Tier 3 — Real, but lower blast radius / already has workarounds:**

- The distributed-systems admin consoles (DLQ, Saga Monitor, Schema Registry, Event Store, Performance Dashboard, all 22-58) — these are operator-facing tools whose failure mode is "you don't find out something is wrong," which is serious but doesn't corrupt data on its own.
- CRM, Customers, Sales, Search — real bugs, but each has partial workarounds or bounded blast radius (e.g., search self-heals within ~10 minutes).

**Tier 4 — Mature, keep as-is:**

- Auth, API Gateway, Tenant Management, GST, Reports, POS, HR (all 68-85).

---

## 15. Recommended Fixes — Prioritized

### Critical (fix before any production launch)

1. Decouple the Kafka inbox-claim transaction from the handler transaction in `PlatformEventConsumer` (`packages/platform-sdk/src/events.ts`) so a handler failure is actually recorded as FAILED and reaches the DLQ. **This single fix makes every other silent failure in this report visible going forward.**
2. Correct the account codes in `PostingMatrixService.ts`'s `DEFAULT_POSTING_RULES` (swap `'2010'`→`'2100'`, seed the missing GST input-credit accounts, fix the `1120`/`1310` mislabeling) and add the composite FK from `posting_matrix`/`financial_entries` account codes to `accounts` so a future mismatch raises an error instead of silently dropping the journal line.
3. Add `body: JSON.stringify({})` (or drop the `Content-Type` header) to the 28 affected scheduler system jobs, and make the shared job-execution wrapper check `res.ok` before recording `COMPLETED`.
4. Fix the quotation "Convert to Invoice" dead end in sales-service.
5. Run a data-correction pass on tenant 2's real historical GRNs/Purchase Returns/Supplier Payments/Expenses to post the missing journal entries once #2 is fixed, so the Balance Sheet reflects reality.
6. Fix notification-service's seed-endpoint Zod schema bug and backfill templates for the 16 affected tenants.

### High

7. Fix the `aggregateId` extraction in `events.ts` to use the event envelope's real `aggregateId` field instead of guessing from the business payload.
8. Add search indexing for sale returns and delivery challans.
9. Reconcile `role-defaults.ts` permission gaps (CRM/SALES_MANAGER, GST/AUDITOR, Customers CUSTOMER_UPDATE-vs-EDIT, Job Work & Consignment/PURCHASE_MANAGER+INVENTORY_MANAGER) and build a backfill mechanism so future permission fixes reach already-provisioned tenants.
10. Fix the Inventory/Purchase-Return per-warehouse stock-check bug (use `projection_stock_level`, not `items.availableQty`).
11. Add audit logging to the entire Purchase module.
12. Fix the Organization number-series `ON CONFLICT` target to include `branch_id`.
13. Fix the CASHIER GST-state-hardcoding regression (grant a narrow read scope for seller state, independent of `ORGANIZATION_VIEW`).
14. Fix the Saga Monitor list's response-wrapper mismatch and the 3 mismatched dashboard tiles.
15. Correct the DLQ/Schema Registry/Event Store admin UI copy to accurately state their real scope, or expand their actual coverage to match the copy.
16. Add a status guard to `EmployeeLoanService.updateStatus` preventing force-close with an outstanding balance; seed/backfill leave balances and enforce them on apply/approve.
17. Restrict `POST /jobs/:name/trigger` for `platform.*` jobs to platform-operator-tier roles only.
18. Encrypt supplier bank account numbers consistently with the employee-bank-account pattern already in place.

### Medium

19. Wire Job Work Order completion to a real accounting posting path; wire `ConsignmentService.recordSale()` to a real route.
20. Backfill the `is_interstate` field for the 33 affected 2026-07-12 sales-invoice rows (GST).
21. Fix Customers' GSTIN search (add `gstin` to the ILIKE clause) and stop silently nulling GSTIN/PAN on partial edits.
22. Wire report-service's PDF export to the general 83-report catalog, or clearly scope the UI to the 8 document types it actually supports.
23. Add pagination to the Saga Monitor and DLQ admin lists.
24. Backfill the 16-migration drizzle tracking-table gap before authoring the next migration (`0104`).
25. Either build real Postgres streaming replication or rename the "replica" service to stop implying it exists.
26. Fix Notification Preferences so opt-outs are actually checked before sending.
27. Fix the Performance Dashboard's null P50/P99 rendering and either compute real percentiles or relabel the feature as "last sample," not "baseline."

### Low

28. Add `updated_by` columns more broadly (currently 7% vs. 53% for `created_by`).
29. Add duplicate-GSTIN detection for suppliers and customers.
30. Add a stale-RUNNING-job reconciliation sweep to scheduler-service's job_history.
31. Remove the 7 junk `QA_E2E_TEST_EVENT_*` rows polluting the Schema Registry admin table.
32. Un-mock `PostingMatrixService` and `fetch` in at least one integration test per affected service so this bug class can be caught by CI going forward.

---

## 16. Fixes Implemented This Session

**None.** Per this audit's explicit scope ("DO NOT immediately modify any code... audit only"), every finding above was verified live and documented, but no code, configuration, or production data was changed. All test data created during live verification was either cleaned up (test tenants closed, test SSO configs/branches/webhooks deleted) or left in place as harmless, clearly-documented evidence (e.g., new invoices, POs, employees) — each module's individual report lists exactly what was created.

## 17. Remaining Work

Everything in §15. Recommended sequencing: do the 6 Critical fixes first (they unblock the most value per line of code changed — Fix #1 in particular makes dozens of currently-invisible problems visible), then work the High list roughly in the order listed, module by module, verifying each with a live test before moving to the next fix — per this project's standing engineering guidelines (CLAUDE.md: small phases, verify before proceeding, no unrelated cleanup).

## 18. Production Readiness Score

**Unweighted average across 28 audited areas: 57.9/100.**

**Business-criticality-weighted assessment: ~40-45/100 for "safe to run real financial transactions on today."** The modules a real business would touch on day one — Purchase, Suppliers, Accounting, Inventory, Scheduler — score 35-52 and share a common, now well-understood root cause. The modules that are further from money (Auth, Gateway, Tenant admin, Reports, GST, POS, HR) are genuinely strong, in the 68-85 range, and the admin/observability layer (58 modules average, dragged down by two very weak consoles at 22 and 30) is a real gap but not one that corrupts data on its own.

**This is not a "rewrite" verdict.** The core architecture, the double-entry ledger's DB-level integrity trigger, the RBAC model, and the individual transactional workflows are sound engineering. The problem is narrow and mechanical: a handful of string-matching bugs (account codes, permission constants, aggregate IDs) with no compiler or database check tying the two sides together, compounded by one shared bug that made every one of them invisible until this audit went looking with live data instead of trusting green dashboards and passing (mocked) tests.
