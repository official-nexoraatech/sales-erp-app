# NEXORAA ERP — Full Product, Automation & AI Blueprint

**Prepared for:** NEXORAA leadership
**Prepared by:** Product/Solution Architecture review (Claude Code)
**Date:** 2026-07-31
**Classification:** Internal strategy document
**Companion reads:** `ARCHITECTURE_AUDIT_2026-07-31.md` (technical health, score 74/100), `CRM-ROADMAP/` (CRM-specific execution blueprint, 15 docs, in flight), `TEST_CREDENTIALS.md`

> **A note on evidence.** Everything under "Grounded Findings" in each module below is drawn from real internal QA audits, live end-to-end test runs, and code-level investigation already performed on this codebase between 2026-07-03 and 2026-07-31 — not guesswork. Bugs cited were found and, unless marked otherwise, already fixed and live-verified. This is what makes this audit different from a generic ERP maturity assessment: it is written by someone who has actually driven every module against a real running stack. Everything under "Automation Opportunities," "AI Opportunities," and "Strategic Recommendations" is forward-looking design proposal, clearly separated from the evidence.

---

## Table of Contents

1. Executive Summary
2. Current ERP Maturity Assessment
3. Module-by-Module Audit (13 modules)
4. Automation Opportunity Catalog (90+ automations)
5. AI Feature Catalog (100+ ideas, by module)
6. The Automation Module — Workflow Engine Design
7. Automation Marketplace — 120 Reusable Templates
8. Integration Roadmap
9. Auto-Generated Reports Catalog
10. Automation / AI / Maturity Scorecard
11. Implementation Roadmap (5 Phases)
12. Final Product Vision

---

## 1. Executive Summary

NEXORAA ERP is a genuinely large, real, working system — 15 backend microservices, ~296 granular permissions, 149 database migrations, a Kafka-based event backbone, three frontends (web, POS, customer portal), and a CRM suite that has already shipped through Phase 3 of a 4-phase roadmap (pipeline, journeys, loyalty, referrals, omnichannel inbox, segmentation, self-service portal, mobile, AI-lite predictive scoring). An independent architecture audit on 2026-07-31 scored overall technical health at **74/100** — solid foundations (enterprise-grade CI/CD with SAST/Trivy/TruffleHog/Snyk gating, staged K8s deploy with auto-rollback, no critical/high security findings), with the core weakness being **duplicated, independently-drifting domain logic** rather than any single catastrophic bug.

That duplication is the central finding of this entire report, and it recurs in almost every module audited: GST tax calculators exist in four separate services and have already produced different answers for the same input; two independent P&L/Balance Sheet/Cash Flow engines exist (accounting-service and report-service) and have shown genuinely different numbers for the same tenant/period; event payloads are written by one team's mental model and read by another's, producing a confirmed **four separate instances** of "producer never sends what the consumer needs" inside the GST module alone (invoice tax lines, sale-return GST ledger, RCM tax amount, CDNR classification). This is not a code-quality nitpick — it is the single highest-leverage automation opportunity in the entire platform: a **shared Rule/Calculation Engine** and an **event-contract test harness** would prevent this entire bug class from recurring, and every future AI feature proposed in this report (AI GST error detection, AI journal suggestions, AI profit-leakage detection) becomes categorically more trustworthy once it runs on top of one source of truth instead of four.

The second most consistent pattern is **"backend fully built, zero frontend, or zero automation trigger wired."** This shows up over and over: Employee Loans, TDS auto-posting, RCM Register, PO/payment-voucher PDFs, the CSV import engine for suppliers, the Event Store's entire write path, campaign engagement tracking (`opened_at`/`clicked_at` columns exist and are never written), the Docs site (11 real modules, was never linked from navigation until found). This means NEXORAA's real problem is rarely "we need to build the capability" — it's "we built the capability and never closed the loop to a human or a trigger." That is exactly the shape of problem an **Automation/Workflow Engine** (Section 6) is designed to solve permanently, instead of one-off wiring each time a gap like this is found.

The third pattern, cutting across Sales, Purchase, HR, and Settings, is **manual data entry and manual approval steps that already have all the data on-screen to be automated**: quotation→invoice conversion, low-stock reordering, GST filing reminders, payroll for-one-bad-record blocking the whole company, price-list corruption from missing tenant checks, RBAC "dead permission constant" bugs that have now recurred at least 6 separate times across 6 different modules. Every one of these is a candidate for the automation catalog in Section 4.

**Bottom line:** NEXORAA does not need a rebuild. It needs (1) one shared calculation/rule layer to stop the drift, (2) a general-purpose workflow/automation engine to stop re-discovering "wired backend, no trigger" gaps one QA pass at a time, (3) a systematic sweep of the ~90 report-service cases and RBAC role-defaults for the same two bug classes that have already recurred 4+ times each, and (4) a prioritized AI layer built on top of a now-trustworthy data spine. Phase 1 of the roadmap in Section 11 is scoped to be achievable in weeks, not quarters, and pays for the rest of the roadmap in reduced manual reconciliation time alone.

---

## 2. Current ERP Maturity Assessment

| Dimension                                                | Score /100 | Basis                                                                                                                                                                                                                                                                                                                                                                                                 |
| -------------------------------------------------------- | ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Functional completeness                                  | 82         | Every core O2C/P2P/R2R cycle works end-to-end; several enterprise features (Requisition/RFQ/Blanket-PO, Vendor Rating, Purchase Dashboard) were found missing and built during the Purchase audit alone — pattern likely repeats in unaudited modules (Job Work, Consignment).                                                                                                                        |
| Data integrity / financial correctness                   | 68         | Real, confirmed bugs found and fixed: ₹0 journals (expense, sale return), GST misclassification (GSTR-9 100% of revenue mis-bucketed), Balance Sheet structurally guaranteed not to balance mid-year, two divergent report engines still unreconciled as of 07-31.                                                                                                                                    |
| Automation level                                         | 41         | 44 real scheduled jobs exist (BullMQ+Redis-locked, genuinely mature engine) but zero general-purpose workflow/trigger builder; most cross-entity actions (quotation→invoice, low-stock→PO, GST due→reminder) are manual clicks, not automatic.                                                                                                                                                        |
| AI readiness                                             | 33         | One real AI suite already exists (CRM Phase 3 — statistical/heuristic, not ML-vendor-backed: predictive lead scoring, festival season suggestions) proving the data model can support it; almost everything else in this report is greenfield.                                                                                                                                                        |
| Observability                                            | 58         | CI/CD and security scanning are genuinely enterprise-grade; but Prometheus metrics for DLQ/outbox/job execution were _defined_ and referenced in alert rules for months while never actually being `.set()` anywhere — alerts could never fire. Fixed 2026-07-22/23, but the pattern ("dashboard exists, wired to nothing") recurs 3+ times across event-service, auth-service, and DAP tour content. |
| RBAC hygiene                                             | 55         | Core RBAC model (296 permissions, branch-scoping, tenant isolation) is sound in _design_; the "dead permission constant" bug class (role-defaults.ts grants the wrong near-duplicate constant) has recurred independently in Sales, Inventory, Purchase, POS, and CRM — each fixed individually, never swept exhaustively.                                                                            |
| UX / frontend consistency                                | 61         | ERP-wide UX standardization already delivered (14 modal→page conversions, breadcrumb fixes, keyboard shortcuts, tenant/POS branding); but 3 frontends independently reimplement Modal/Table/Badge instead of sharing `packages/ui`, and POS-frontend's own deep audit found ~27 unresolved High/Medium UX and accessibility gaps.                                                                     |
| Multi-tenant/security posture                            | 79         | No critical/high findings in the 07-31 security pass; Postgres RLS is designed but not enabled (tenant isolation is currently app-level filtering only, no DB-level backstop) — the single biggest structural security gap.                                                                                                                                                                           |
| DevOps/infra resilience                                  | 60         | CI/CD strong; but DB migration bookkeeping has now silently broken **three separate times** (07-11, 07-29, 07-30) via two different root causes (stale journal, BOM + out-of-order timestamp), each causing production-shaped outages (e.g. every login returning HTTP 500) with zero warning from the tooling.                                                                                       |
| **Overall (independent architecture audit, 2026-07-31)** | **74**     | See `ARCHITECTURE_AUDIT_2026-07-31.md` for full risk matrix.                                                                                                                                                                                                                                                                                                                                          |

---

## 3. Module-by-Module Audit

Each module below follows the requested 13-point framework, compressed for density. Where a module has not yet been subjected to a dedicated internal QA pass (Job Work, Consignment, Customers-as-a-standalone-surface), this is stated explicitly rather than invented.

### 3.1 Customers

- **Purpose:** Master record for every buyer — profile, addresses, GST registration status, credit terms, price-list assignment, interaction history, health score.
- **Manual processes:** Manual entry of GSTIN/address/credit limit at creation; manual price-list assignment; manual detection of duplicate customers (name/phone/GSTIN fuzzy match exists in `@erp/utils` for CSV import dedupe, but is not run proactively on manual creation).
- **Bottlenecks:** Every new customer requires a human to know which price list, which branch, which credit terms apply — no suggested defaults from similar customers.
- **Time-consuming activities:** Re-entering the same customer's data across Sales, CRM, and POS if created inconsistently in different flows.
- **Human dependency:** 100% — no self-service customer creation from any channel except the (Phase 3) Customer Portal for existing accounts.
- **Error-prone tasks:** GSTIN validation is a plain awaited call that silently mislabels a valid GSTIN as invalid for roles lacking `GST_VIEW`, without a toast — a confirmed, still-open bug.
- **Missing features:** Proactive duplicate-customer flagging at creation time (dedupe scoring exists but only runs on bulk CSV import); customer segmentation auto-suggestion at creation.
- **Missing reports:** Customer lifetime value trend, churn-risk cohort export.
- **Missing dashboards:** A single "Customer Command Center" merging CRM health score + Sales history + Support tickets + Loyalty tier is architecturally possible (all data exists in sales-service) but not built as one view.
- **Missing notifications:** No proactive "this customer hasn't ordered in 90 days" trigger to the assigned rep.
- **Missing approvals:** Credit-limit overrides exist and are UI-reachable (fixed 2026-07-12), correctly gated.
- **Missing integrations:** No accounting-grade e-KYC / GST-portal live verification of GSTIN at entry (would prevent invalid GSTINs from ever being saved).
- **Missing AI:** No duplicate-detection-at-creation-time AI, no churn prediction, no next-best-action suggestion.

### 3.2 Sales (Invoices, Quotations, Payments, Returns, Delivery Challans)

- **Purpose:** The core order-to-cash cycle.
- **Grounded findings:** Quotation `accept()` had **no reachable path anywhere in the app** until 2026-07-12 — the entire quotation→invoice pipeline was structurally unreachable despite the backend supporting it since an earlier phase. Quotation-creation UI didn't exist (silently rendered the Invoice form instead). "Record Payment" from an invoice dropped its `invoiceId` context, producing unallocated payments with no link back. Credit-limit/price-floor override had no UI despite full backend support. Sale Return creation was **100% broken for every user** (hardcoded empty `lines: []` against a backend requiring ≥1 line) until rebuilt 2026-07-13. `SALES_MANAGER` never had `QUOTATION_CONVERT` in its default permission set — the role built to run the sales workflow could not complete its own core action, for all 5 tenants that existed at the time.
- **Bottlenecks:** Quotation, invoice, and payment are three separate manual clicks even when a quotation is accepted as-is with zero changes.
- **Time-consuming:** Manual GST-state resolution per invoice line (now correctly derived from the real seller/customer state, but computed independently by 4 different services — see GSTCalculator finding, Section 2).
- **Human dependency:** High — no auto-conversion of accepted quotations, no auto-invoice-from-recurring-order.
- **Error-prone:** CESS tax was silently dropped from POS cart totals for months (real under-collection, fixed 2026-07-24); tax-inclusive pricing (`priceIncludesTax` column exists) is **still ignored** by `GSTCalculator`/`InvoiceService` platform-wide — a live, unfixed, backend-wide gap.
- **Missing features:** No recurring/subscription invoicing; no auto-reminder ladder for overdue invoices (payment-reminder automation is a Section-4 candidate); no manager-PIN override flow for POS discount/price-floor violations; no coupon/promo-code system; no flat-₹ discount (percentage-only).
- **Missing reports:** Sales-by-item report had wrong column joins (fixed); COGS derivation now uses `items.wacc_cost` as a tenant-wide estimate, not true per-transaction FIFO cost.
- **Missing dashboards:** Sales Analytics exists but is only reachable via a card, not the sidebar nav (same pattern repeats in Purchase/Inventory/HR analytics — a systemic nav-discoverability gap, not a Sales-specific one).
- **Missing notifications:** No automatic "invoice is now overdue" alert to the customer or the rep; no automatic low-stock-blocked-a-sale alert.
- **Missing approvals:** Sale Return / Credit Note **approve/cancel routes don't exist at all** for those entities — a genuine feature gap, not an RBAC-wiring bug (confirmed by code search).
- **Missing integrations:** No payment gateway auto-reconciliation (Razorpay/UPI/PhonePe webhook → auto-mark-paid); no e-commerce channel sync.
- **Missing AI:** No AI quote generator, no next-best-product suggestion at invoice time, no AI dynamic pricing, no AI churn-triggered win-back offer.

### 3.3 CRM

- **Purpose:** Full CRM suite built natively inside `sales-service` (17 tables, no dedicated crm-service) — Pipeline, Segments, Campaigns, Journeys, Loyalty, Referrals, Inbox, Campaign ROI, Seasons, Territories, Quotas, API Keys, Export Schedules, field-sales Routes, DLT Templates.
- **Grounded findings:** Phase 1 (Contacts/Accounts, Leads, Customer 360, Ticketing, ERP-Native integration, DLT/TRAI SMS compliance hard-gated, CSV import with dedupe scoring, dashboards) and Phase 2 (Pipeline with atomic Won→real-Quotation creation, Journey Builder on the existing scheduler-cron mechanism, Loyalty tiering with fixed dead point-expiry/redemption race/CASHIER RBAC gap, Referral program, Omnichannel Inbox, Advanced Segmentation) are **fully shipped and verified**. Phase 3 (AI/predictive — statistical, not ML-vendor; Self-Service Portal with a new CUSTOMER JWT role hardened across all 14 services; Mobile CRM E2E-verified 10/10; Multi-language comms — though `campaignTemplates` has **zero frontend UI**, a pre-existing gap) is complete. Phase 4 (Territory Management, Quota Management, Festival Intelligence AI, Public API & BI Export with new API-key auth, Field Sales/Distributor CRM with the platform's first offline-write queue, CTI/Twilio — call recording deliberately OFF pending user compliance review) is complete as of the last update in this memory trail.
- **Known open gap:** Campaign engagement tracking (`opened_at`/`clicked_at` columns exist on the schema and real Playwright specs exist for them) has **never actually been run** — status genuinely unknown, not "broken," just unverified.
- **Bottlenecks:** No dedicated crm-service means CRM scale characteristics are coupled to sales-service's own load profile.
- **Missing AI (beyond what's shipped):** No AI lead-scoring explanation ("why is this a hot lead"), no AI email/WhatsApp reply drafting in the Inbox, no AI campaign-copy generator, no AI churn-prediction-to-loyalty-offer auto-trigger.
- **Missing integrations:** No native Instagram/Facebook Lead Ads ingestion; no LinkedIn Sales Navigator sync.

### 3.4 Inventory (Items, Stock, Transfers, Adjustments, Physical Verification, Fabric Rolls, Valuation, Suppliers)

- **Purpose:** Stock master data, movement, and valuation across warehouses.
- **Grounded findings:** `PUT /price-lists/:id/items` had **zero tenant-ownership check** — any user with `ITEM_EDIT` could corrupt another tenant's pricing (fixed). Purchase Return, Sale Return, and Stock Adjustment write-offs updated quantity but never called `ValuationService` — book value silently diverged from physical reality on 3 of 5 stock-mutating flows; stock-adjustment losses never posted to accounting at all (the seeded GL account for the loss rule didn't exist — nobody had ever triggered it). **No branch-level RBAC scoping existed anywhere in inventory-service** until fixed. 6+ of 13 inventory reports in report-service queried columns that don't exist on the real schema. Item Variants had a fully-correct backend but zero frontend (built).
- **Deliberately deferred (documented, not built):** batch/lot FEFO beyond receipt-time capture, serial number tracking (confirmed out of scope — no serialized goods in a textile/garment business), warehouse bin/location hierarchy, a dedicated Opening Stock entry flow, tenant-level inventory settings, proactive low-stock push alerts.
- **Missing dashboards:** No single view combining Stock Aging + Slow-Moving + Dead Stock + Reorder Point in one screen.
- **Missing notifications:** Low-stock alerts exist as a scheduled job (`inventory.low-stock`) but proactive push to the responsible purchase manager is not confirmed wired end-to-end to a UI notification.
- **Missing AI:** No AI demand forecasting, no AI dead-stock liquidation suggestion, no AI fabric-consumption prediction (high-value given confirmed textile/garment business context), no AI reorder-point auto-tuning.

### 3.5 Purchase (Dashboard, POs, GRNs, Supplier Payments, Returns, Expenses)

- **Purpose:** Full procure-to-pay cycle.
- **Grounded findings — 7 critical bugs (money/compliance-corrupting), all fixed:** Purchase-return GST ledger entries recorded ₹0 (payload contract mismatch — same bug class as GST module's 4 instances); accounting-service had **zero consumer** for `PURCHASE_RETURN_APPROVED` — purchase returns never hit the general ledger at all; interstate purchase returns always taxed as intrastate (hardcoded); bounced **supplier** cheques never reversed in the GL (hardcoded reference type); landed-cost allocation double-counted when applied twice; supplier credit limit existed in the DB but was unreachable from any schema or UI; multiple RBAC dead-permission-constant gaps (EXPENSE_APPROVE granted to nobody, AUDITOR had zero purchase visibility).
- **7 enterprise features found missing and built in the same pass:** Purchase Requisition, RFQ/Quotation Comparison, Blanket PO/Rate Contract, a real Purchase Invoice variance-layer (system is 2-way PO↔GRN match, deliberately not rebuilt into 3-way), Vendor/Supplier Rating, a purpose-built Purchase KPI Dashboard, bulk CSV Import/Export (the import engine already existed platform-wide in scheduler-service — just had zero frontend UI for suppliers).
- **Branch-scope enforcement gap found systemic** (not PO-specific) — closed across every branch-carrying entity including indirect cases (debit notes via parent join, landed costs via GRN join, polymorphic attachments needing a dispatcher).
- **Deliberately deferred:** multi-currency (no schema, no FX handling anywhere), full FEFO batch consumption, GSTCalculator consolidation (assessed, flagged as a dedicated future pass — the divergence is a confirmed live bug, see Section 2).
- **Readiness trajectory:** 82 → 88 → 91 → 93/100 across four same-day passes — the single best-documented improvement arc in the codebase.
- **Missing AI:** No AI purchase predictor / auto-reorder-to-PO, no AI supplier recommendation, no AI landed-cost anomaly detection, no AI invoice-vs-PO variance explanation.

### 3.6 GST (Register, GSTR-1/3B/9, e-Invoice, GSTR-2A Reconciliation, Compliance Calendar)

- **Purpose:** Indian GST compliance — the single highest-regulatory-risk module in the product.
- **Grounded findings — a confirmed, recurring bug _class_, not isolated incidents:** RCM self-assessment could not be triggered by any real user action (the `isRegistered` field was silently stripped by a Zod schema in a _different_ service than the one enforcing RCM logic); a sale-return accounting journal failed to post at all due to a one-character account-code typo (`4200` vs the real `4900`); RCM tax amount was always ₹0 even once RCM correctly triggered (the same zeroed-payload-for-a-different-consumer pattern); GSTR-9 misclassified **100% of real taxable revenue as nil-rated** because `gst_rate` was never populated by any of the three producing consumers; CDNR credit notes were always misclassified as CDNUR with blank GSTIN/name (producer never sent a field the consumer had always read). **This is the fourth confirmed instance of the same "producer/consumer event-payload contract drift" bug shape inside this one module alone** — the single strongest evidence in this whole audit for prioritizing a shared contract-test harness (Section 6) over continuing to fix these one at a time.
- **Also found:** RCM Register had a fully wired backend and API client with zero frontend UI ever calling it (fixed); e-Invoice/e-Way Bill generation is correctly blocked only on a missing external `NIC_API_KEY` credential — not a bug, a genuine external dependency the user must obtain.
- **Status as of the last pass:** every testable-without-external-credentials area in this module is live-verified working.
- **Missing AI:** No AI GST error detection (would have caught all 4 payload-drift bugs above automatically via anomaly detection on ledger completeness), no AI GSTR filing pre-check, no AI HSN/SAC auto-classification.

### 3.7 Accounting (CoA, Journals, Trial Balance, P&L, Balance Sheet, Cash Flow, Bank Reconciliation, Fixed Assets, TDS, Cost Centers)

- **Purpose:** General ledger and statutory financial reporting.
- **Grounded findings:** Every expense posted a phantom ₹0 journal (same field-drift bug class, third confirmed occurrence — `totalAmount` vs `grandTotal`). **Two independent report engines** (accounting-service's dedicated pages vs. report-service's Reports-Browser versions) gave **genuinely different Balance Sheet and Cash Flow numbers** for the same tenant/period — still not fully reconciled as of 2026-07-31. Journal reversal bypassed the period-closed check. Period tagging used wall-clock processing time instead of the real event's `occurredAt` (now fixed across 11 consumers). Trial Balance had no period lower bound. Employee Loans Receivable was never credited down on payroll EMI collection. Depreciation batch had no scheduler job. Earlier: Trial Balance and Balance Sheet's default "as of today" view showed **zero activity, always** (UTC-midnight date-parsing bug); Balance Sheet was **structurally guaranteed never to balance** during an open financial year (no Current Year Earnings rollup); there was **no way to create the first Financial Year** for a new tenant — a genuine go-live blocker still requiring a manual step; Trial Balance's account table and P&L's line items were populated with the wrong field names, rendering blank/`NaN` on an otherwise-loading page.
- **Deliberately deferred:** TDS auto-posting on supplier payments (no tax rules/rates/thresholds modeled — needs product sign-off).
- **Missing AI:** No AI journal-entry suggestion, no AI anomaly/fraud detection on postings, no AI cash-flow forecast, no AI expense auto-categorization.

### 3.8 Job Work (Orders, New Order)

- **Not yet subjected to a dedicated internal QA pass in the memory trail available for this audit** — the one confirmed prior finding is that Job Work Orders had no detail page until built during the Production module pass. Recommend this be the next module scoped for a comprehensive audit using the same methodology as Purchase/Inventory/GST, given the pattern-match rate found everywhere else audited (branch-scoping gaps, RBAC dead constants, report-column drift) is high enough to assume similar issues exist here until verified.

### 3.9 Consignment (Stock, Settlements, Reorder Report, Barcode Labels)

- **Not yet subjected to a dedicated internal QA pass.** The Reorder Report specifically is known to have had a hardcoded `branchId: 1` bug (fixed as part of a platform-wide sweep) and made zero real POs before being rebuilt during the Production module audit. Given that history, Consignment Settlements and Stock reconciliation are reasonable next-audit candidates.

### 3.10 Reports (Reports Browser, Report Scheduler)

- **Purpose:** ~90-case general-purpose report registry serving CSV/Excel export, PDF (for 3 fixed business documents), and scheduling.
- **Grounded findings:** A capstone column-by-column audit found **43 of 77 report cases (56%)** referenced nonexistent database columns and errored at runtime — one wave was fixed, then a **second independent audit found 25 more hard-broken plus 4 silently-wrong** cases the first wave never touched, spanning Sales, Purchase, Financial, and GST reports, plus a live regression from an unrelated payroll-encryption migration nobody had cross-checked. **Do not trust in-code "FIXED" comments without independently re-verifying against the live schema** — this was tested directly by this audit trail and found to be a real, recurring trap.
- **Also fixed:** a PDF-schedule footgun where the default output format (`PDF`) had no actual PDF-building code path for scheduled emails, silently sending nothing.
- **Not fixed, flagged:** no PDF export for the generic ad-hoc Reports Hub; zero audit-log coverage on report run/export/schedule actions; no caching on dashboard endpoints except one report; no streaming/bounded exports (`report_run_history.resultData` stores full result sets as JSONB — a real scale risk); `fileUrl` column exists but nothing ever archives to it.
- **Missing AI:** No AI natural-language report builder ("show me last quarter's slow-moving stock by branch"), no AI-written executive summary per report run.

### 3.11 HR (Employees, Attendance, Shifts, Leave, Payroll, Salary Structures, PF/ESI/PT, Form 16, Alterations, Tailor Work Log, Holiday Calendar)

- **Grounded findings:** Payroll calculation for the **entire company** aborted if even one active employee lacked a salary structure, with the run left permanently stuck in `CALCULATING` and **no UI path to retry** — fixed with per-employee error isolation plus a resume path. Employee creation 422'd on every genuinely-optional field left blank (same blank-string-vs-`.optional()` schema mismatch pattern found 3 times in this codebase). Employee Loans had a fully-built backend (full CRUD, real permission) with **zero frontend entry point** until built.
- **Not yet deep-tested:** PF/ESI/PT challan generation, Form 16 batch generation, bulk employee import, tailor piece-rate payroll (confirmed working on smoke-check only), RBAC for a dedicated HR-manager role.
- **Missing AI:** No AI payroll validator (would have caught the ₹0-blocking-employee bug class automatically), no AI leave-pattern/attendance-anomaly detection, no AI shift/schedule optimizer.

### 3.12 Organization (Branches, Warehouses, Users, GST Config, Feature Flags, SSO, Integrations, Notification Templates, Security Settings)

- **Grounded findings — the single highest bug-density module found in any pass:** Organization Settings 422'd on save for any tenant that hadn't filled in every optional field — **would have blocked literally the first settings screen any real client touches during onboarding.** Branch City/State/PIN Code were completely non-functional (flat vs. nested field mismatch, silently dropped by non-strict Zod) — every branch's city/state was always blank in the database no matter what was typed, for the life of the bug. Warehouse editing was **completely broken for every warehouse in the app** (missing optimistic-lock `version` field, plus a `reset(fullApiRow)` footgun that resubmitted the entire raw API row including `deletedAt`/`tenantId`). `apiClient.request()` crashed on **any** `204 No Content` response — a single shared-code-path bug that silently broke **7 different DELETE flows across the platform** (SSO config, employee, cost centers, attachments in two services, roles, holidays) simultaneously, all traced to one root cause and fixed once.
- **Missing AI:** No AI-assisted tenant onboarding wizard, no AI-suggested default CoA/branch/warehouse setup by business type.

### 3.13 System (Security Audit Log, Audit Logs, Event Store, DLQ, Saga Monitor, Schema Registry, Projections, Performance, Scheduler Jobs, Search Analytics)

- **Purpose:** Platform-internal operational tooling — never seen by a real tenant, only the vendor's own team.
- **Grounded findings:** **Event Store admin page is permanently empty and will stay that way** — a real architectural gap, not a bug: the write path (`EventStoreService.append()`) has zero callers anywhere in the codebase; the "Rebuild Aggregate State" action can never do anything. (Real audit trail needs are separately and correctly covered by the populated `audit_logs` table — this gap doesn't leave the product without an audit trail, it just means event-sourcing replay tooling has no data.) Schema Registry had a complete field-name mismatch masked only by React not crashing on `undefined` (fixed). Outbox dead-letters were **invisible and unreplayable** — the relay worker marked events failed but never wrote to the table the DLQ admin console actually reads (fixed). Prometheus metrics for DLQ depth/outbox lag/job execution were **defined and referenced in live alert rules for months while never actually being set anywhere** — alerts could structurally never fire (fixed, same bug class found independently in event-service, auth-service, and DAP tour content — three separate discoveries of "dashboard wired to nothing"). **Only 5 of 15 services actually consume Kafka** — most cross-service coordination is synchronous HTTP or duplicated in-process logic, not truly event-driven, despite the platform's architecture documents implying otherwise. Database migration bookkeeping has broken silently **three separate times** via two distinct root causes (stale journal never regenerated for hand-written SQL; a UTF-8 BOM plus an out-of-order timestamp that silently kills every migration after it, forever, with no error) — currently clean (149/149) but explicitly flagged as fragile, not resolved, pending a CI check that would catch this before merge.
- **Missing AI:** No AI-assisted DLQ triage/root-cause summarization, no AI anomaly detection on job execution patterns.

---

## 4. Automation Opportunity Catalog

90 concrete automations, grouped by module. Priority/Difficulty/ROI are consulting judgment calls based on the grounded findings above plus standard ERP automation economics — treat as a starting negotiation for backlog ranking, not a precise measurement.

**Legend:** P = Priority (H/M/L), D = Difficulty (Easy/Med/Hard), ROI = 1–10.

### 4.1 Sales & Invoicing

| #   | Automation                                               | Trigger                                                 | Conditions                                         | Actions                                                                          | Benefit                                                          | Time Saved                  | P   | D    | ROI |
| --- | -------------------------------------------------------- | ------------------------------------------------------- | -------------------------------------------------- | -------------------------------------------------------------------------------- | ---------------------------------------------------------------- | --------------------------- | --- | ---- | --- |
| 1   | Auto quotation→invoice on acceptance                     | Quotation status → ACCEPTED                             | No line edits pending                              | Create invoice from quotation lines, notify rep                                  | Removes a manual re-entry step now that the accept path exists   | ~5 min/quote                | H   | Easy | 8   |
| 2   | Invoice payment-reminder ladder                          | Invoice overdue by N days                               | Not fully paid, not disputed                       | Send WhatsApp/SMS/email at 0/7/15/30 days, escalate to rep at 30+                | Reduces DSO                                                      | 30–60 min/week per AR clerk | H   | Med  | 9   |
| 3   | Auto payment-gateway reconciliation                      | Razorpay/UPI/PhonePe webhook received                   | Amount matches an open invoice within tolerance    | Mark invoice paid, allocate payment, post journal                                | Removes manual bank-statement matching                           | Hours/week at scale         | H   | Med  | 9   |
| 4   | Credit-limit breach escalation                           | Invoice would exceed customer credit limit              | Requester lacks override permission                | Route to SALES_MANAGER for one-tap approve/reject                                | Removes "call the manager" friction, keeps the control           | Minutes/incident            | M   | Easy | 6   |
| 5   | Recurring invoice generator                              | Cron (daily)                                            | Customer has an active recurring-billing agreement | Auto-generate + send invoice                                                     | New revenue-model enabler (subscriptions/AMC)                    | Hours/month                 | M   | Med  | 7   |
| 6   | Sale-return auto credit-note                             | Sale return approved                                    | —                                                  | Auto-generate credit note, notify customer, offer wallet-credit or refund choice | Faster resolution, less manual CN creation                       | 10 min/return               | H   | Easy | 7   |
| 7   | Delivery-challan → auto-invoice on delivery confirmation | Challan marked delivered                                | Tenant setting enables auto-invoice                | Convert to invoice, send                                                         | Closes a currently fully-manual gap                              | 5–10 min/challan            | M   | Med  | 6   |
| 8   | Dormant-customer win-back trigger                        | No order in 90 days                                     | Customer previously active (≥3 orders)             | Enroll in CRM win-back journey, notify rep                                       | Revenue recovery                                                 | N/A (revenue, not time)     | H   | Easy | 8   |
| 9   | POS shift-close blocked-by-offline-queue auto-retry      | Shift close attempted with pending offline sales        | —                                                  | Already correctly blocks close; add auto-retry sync every 30s while blocked      | Faster shift close for cashiers                                  | 2–5 min/shift               | M   | Easy | 5   |
| 10  | GST-inclusive-price auto-flag                            | Invoice line created on a `priceIncludesTax` price list | Backend still ignores the flag today               | Alert finance the moment this combination occurs, until the backend fix ships    | Prevents silent under/over-collection now, not after a fix ships | N/A (risk mitigation)       | H   | Easy | 7   |

### 4.2 CRM

| #   | Automation                          | Trigger                                                | Conditions                                                | Actions                                                                               | Benefit                                                                       | Time Saved                   | P   | D    | ROI |
| --- | ----------------------------------- | ------------------------------------------------------ | --------------------------------------------------------- | ------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- | ---------------------------- | --- | ---- | --- |
| 11  | Lead auto-assignment by territory   | Lead created                                           | Territory Management module already shipped               | Route to the owning rep by pincode/zone                                               | Removes manual triage                                                         | Minutes/lead                 | H   | Easy | 8   |
| 12  | Lead-response SLA escalation        | Lead untouched for N hours                             | Status still NEW                                          | Escalate to manager, notify rep                                                       | Reduces lead-decay                                                            | N/A (conversion-rate impact) | H   | Easy | 8   |
| 13  | Won-deal → onboarding checklist     | Pipeline stage → WON                                   | —                                                         | Already atomically creates a Quotation; extend to auto-create an onboarding task list | Consistent handoff                                                            | 10–15 min/deal               | M   | Easy | 6   |
| 14  | Birthday/anniversary auto-wish      | Cron (daily)                                           | Customer DOB/anniversary = today, DLT-compliant template  | Send WhatsApp/SMS via DLT-approved template                                           | Retention touch at zero manual cost                                           | N/A                          | M   | Easy | 6   |
| 15  | Loyalty-tier-change notification    | Points crossing tier threshold                         | —                                                         | Notify customer, unlock tier benefits automatically                                   | Removes manual tier admin (already partly automated — extend to notification) | Minutes/customer             | M   | Easy | 5   |
| 16  | Campaign engagement auto-close-loop | Email/SMS opened or clicked                            | `opened_at`/`clicked_at` columns exist, unpopulated today | Wire the write path, then trigger a follow-up journey step on click                   | Closes a confirmed dead gap (Section 3.3)                                     | N/A                          | H   | Easy | 7   |
| 17  | Referral-reward auto-payout         | Referred customer's first invoice paid                 | Referral program rules satisfied                          | Auto-credit referrer's loyalty points/wallet                                          | Removes manual referral-desk reconciliation                                   | 5–10 min/referral            | M   | Easy | 6   |
| 18  | Support-ticket auto-escalation      | Ticket unresolved past SLA                             | Priority ≥ Medium                                         | Escalate to next tier, notify manager                                                 | SLA compliance                                                                | N/A                          | H   | Easy | 7   |
| 19  | AI lead-score-drop alert            | Predictive score drops >20 points                      | —                                                         | Notify assigned rep with the "why" (churn signal)                                     | Proactive save vs. reactive loss                                              | N/A                          | M   | Med  | 7   |
| 20  | Festival-season auto-campaign draft | Compliance-approved festival calendar date approaching | Festival Intelligence AI already shipped (statistical)    | Auto-draft (not auto-send) a campaign for rep review                                  | Saves campaign-planning time each season                                      | Hours/season                 | M   | Easy | 6   |

### 4.3 Inventory

| #   | Automation                                             | Trigger                                     | Conditions                                     | Actions                                                                                                     | Benefit                                        | Time Saved                  | P   | D    | ROI |
| --- | ------------------------------------------------------ | ------------------------------------------- | ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ---------------------------------------------- | --------------------------- | --- | ---- | --- |
| 21  | Low-stock → auto-draft PO                              | Stock crosses reorder point                 | Preferred supplier + last purchase price known | Draft (not submit) a PO for buyer review                                                                    | Removes manual monitoring                      | 15–30 min/SKU/week at scale | H   | Med  | 9   |
| 22  | Physical-verification variance auto-adjustment routing | Variance count submitted                    | Variance > threshold                           | Route to approver, auto-post if within tolerance                                                            | Faster stock-count close                       | Hours/cycle                 | M   | Med  | 6   |
| 23  | Stock-transfer stuck-in-DRAFT reminder                 | Transfer in DRAFT > 24h                     | —                                              | Remind creator, escalate at 48h                                                                             | Closes a previously-confirmed dead-end pattern | N/A                         | M   | Easy | 6   |
| 24  | Dead-stock auto-flag                                   | Cron (weekly)                               | Zero movement in N days                        | Flag item, suggest markdown/liquidation campaign                                                            | Frees working capital                          | N/A (capital, not time)     | H   | Med  | 8   |
| 25  | Fabric-roll near-exhaustion alert                      | Remaining meters < threshold                | —                                              | Alert cutting floor + purchase                                                                              | Prevents production stoppage                   | N/A                         | M   | Easy | 6   |
| 26  | Price-list tenant-scope auto-audit                     | Cron (daily)                                | —                                              | Verify every price-list row belongs to the owning tenant (regression guard for the fixed cross-tenant vuln) | Continuous security assurance                  | N/A                         | H   | Easy | 7   |
| 27  | Cross-warehouse rebalancing suggestion                 | One warehouse low, sibling warehouse excess | Same item, same tenant                         | Suggest a Stock Transfer, one-click create                                                                  | Reduces emergency purchasing                   | Hours/incident              | M   | Med  | 7   |

### 4.4 Purchase

| #   | Automation                                | Trigger                            | Conditions                                                  | Actions                                                      | Benefit                                                  | Time Saved          | P   | D    | ROI |
| --- | ----------------------------------------- | ---------------------------------- | ----------------------------------------------------------- | ------------------------------------------------------------ | -------------------------------------------------------- | ------------------- | --- | ---- | --- |
| 28  | PO auto-approval under threshold          | PO submitted                       | Total ≤ tenant's tiered-approval threshold (already exists) | Auto-approve, skip manual step                               | Faster procurement for routine buys                      | Minutes/PO          | H   | Easy | 8   |
| 29  | GRN-received → 3-way variance auto-flag   | GRN approved                       | Purchase Invoice variance layer exists                      | Auto-flag if PO/GRN/Invoice amounts diverge beyond tolerance | Catches billing errors before payment                    | Hours/incident      | H   | Med  | 8   |
| 30  | Supplier-payment-due reminder             | Payment due date approaching       | Not yet paid                                                | Notify AP clerk, escalate if overdue                         | Avoids penalty/late fees, protects supplier relationship | 30 min/week         | H   | Easy | 7   |
| 31  | PDC (post-dated cheque) clearing reminder | PDC clearing date = today+2        | —                                                           | Remind AP to ensure funds available                          | Prevents bounced cheques                                 | N/A                 | M   | Easy | 6   |
| 32  | Blanket-PO/rate-contract expiry alert     | Contract validity window closing   | —                                                           | Notify buyer 30/15/7 days out                                | Prevents lapsed-contract purchasing at wrong rates       | N/A                 | M   | Easy | 6   |
| 33  | Vendor-rating auto-update                 | GRN quality/on-time flags recorded | —                                                           | Recompute supplier rating automatically                      | Keeps rating current without manual review cycles        | N/A                 | M   | Easy | 6   |
| 34  | RFQ auto-comparison summary               | All invited suppliers have quoted  | —                                                           | Auto-generate a comparison table, notify buyer               | Faster sourcing decisions                                | 30–60 min/RFQ       | M   | Med  | 7   |
| 35  | Requisition → auto-RFQ or auto-PO routing | Requisition approved               | Preferred-supplier rule exists vs. needs sourcing           | Route automatically to RFQ or direct PO                      | Removes manual routing decision                          | Minutes/requisition | M   | Med  | 6   |

### 4.5 GST

| #   | Automation                               | Trigger                                  | Conditions                           | Actions                                                                            | Benefit                                                            | Time Saved            | P   | D    | ROI |
| --- | ---------------------------------------- | ---------------------------------------- | ------------------------------------ | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------ | --------------------- | --- | ---- | --- |
| 36  | GST-ledger completeness auto-audit       | Cron (daily)                             | —                                    | Flag any ledger row with `gst_rate` NULL or tax amount ₹0 where taxable amount > 0 | Would have caught all 4 confirmed payload-drift bugs automatically | N/A (compliance risk) | H   | Easy | 10  |
| 37  | GSTR filing due-date reminder ladder     | Compliance Calendar due date approaching | Not yet marked filed                 | Remind at 7/3/1 days, escalate at 0                                                | Avoids late-filing penalties                                       | N/A                   | H   | Easy | 9   |
| 38  | GSTR-2A auto-reconciliation run          | New GSTR-2A data available (monthly)     | —                                    | Auto-run reconciliation, flag mismatches only                                      | Removes manual trigger-and-wait                                    | Hours/month           | H   | Med  | 8   |
| 39  | RCM self-assessment auto-trigger audit   | Cron (weekly)                            | Supplier `isRegistered=false` exists | Verify at least one GRN from that supplier produced a non-zero RCM ledger entry    | Regression guard for a previously-critical bug                     | N/A                   | M   | Easy | 6   |
| 40  | e-Invoice IRN auto-retry                 | IRN generation fails (transient)         | Retryable error class                | Auto-retry with backoff, alert only on final failure                               | Reduces manual resubmission                                        | Minutes/invoice       | M   | Easy | 6   |
| 41  | HSN/SAC auto-suggestion at item creation | New item created                         | No HSN/SAC set                       | Suggest HSN/SAC from a lookup/AI classifier                                        | Reduces GST misclassification risk at the source                   | Minutes/item          | M   | Med  | 7   |

### 4.6 Accounting

| #   | Automation                                      | Trigger                                   | Conditions                                                 | Actions                                                                                           | Benefit                                                                                   | Time Saved            | P   | D    | ROI |
| --- | ----------------------------------------------- | ----------------------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | --------------------- | --- | ---- | --- |
| 42  | ₹0-journal auto-audit                           | Journal posted                            | Debit or credit total = 0 while source document amount > 0 | Flag immediately, notify accounting                                                               | Would have caught the expense and sale-return ₹0-journal bugs automatically at the source | N/A (compliance risk) | H   | Easy | 10  |
| 43  | Cross-engine BS/Cash-Flow divergence auto-check | Cron (daily)                              | —                                                          | Compare accounting-service vs report-service output for the same tenant/period, alert on mismatch | Direct regression guard for a confirmed still-open bug                                    | N/A                   | H   | Easy | 9   |
| 44  | New-tenant Financial-Year auto-provisioning     | Tenant provisioned                        | No financial year exists yet                               | Auto-create the default FY (calendar or April–March)                                              | Removes a confirmed manual go-live blocker                                                | 10–15 min/tenant      | H   | Easy | 8   |
| 45  | Bank-statement auto-import & match              | Statement file uploaded / bank API polled | —                                                          | Auto-match to open payments/receipts, flag exceptions only                                        | Removes manual bank reconciliation line-by-line                                           | Hours/week            | H   | Hard | 8   |
| 46  | Month-end close checklist automation            | Cron (month-end -1 day)                   | —                                                          | Auto-run depreciation batch, trial balance snapshot, remind on open items                         | Speeds close cycle                                                                        | Hours/month           | M   | Med  | 7   |
| 47  | Fixed-asset depreciation batch                  | Cron (monthly, now exists)                | —                                                          | Already automated — extend with exception-only email summary                                      | Confidence without manual verification                                                    | 15 min/month          | L   | Easy | 4   |
| 48  | Employee-loan EMI auto-reconciliation audit     | Payroll run approved                      | Employee has an active loan                                | Verify Employee Loans Receivable was credited (regression guard for a confirmed prior bug)        | Compliance assurance                                                                      | N/A                   | M   | Easy | 6   |

### 4.7 HR & Payroll

| #   | Automation                                | Trigger                            | Conditions                          | Actions                                                                                           | Actions                                                                                                    | Time Saved      | P   | D    | ROI |
| --- | ----------------------------------------- | ---------------------------------- | ----------------------------------- | ------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | --------------- | --- | ---- | --- |
| 49  | Payroll pre-flight validator              | Payroll run created                | —                                   | Check every active employee has a salary structure _before_ calculation starts, list gaps upfront | Prevents the confirmed "one bad record blocks the company" failure mode proactively rather than reactively | 30–60 min/cycle | H   | Easy | 9   |
| 50  | Attendance-anomaly auto-flag              | Daily attendance sync              | Missing punch, or pattern deviation | Flag for HR review                                                                                | Reduces manual attendance audit                                                                            | Hours/month     | M   | Med  | 6   |
| 51  | Leave-balance auto-accrual                | Cron (monthly)                     | —                                   | Credit leave balances per policy                                                                  | Removes manual accrual entry                                                                               | Hours/month     | M   | Easy | 6   |
| 52  | PF/ESI/PT challan auto-generation         | Cron (monthly, statutory due date) | —                                   | Auto-generate challan, remind for filing                                                          | Compliance + time savings                                                                                  | Hours/month     | H   | Med  | 8   |
| 53  | Form 16 batch generation                  | Cron (annual, FY-end)              | —                                   | Auto-generate for all employees, notify for download                                              | Removes manual one-by-one generation                                                                       | Hours/year      | M   | Med  | 6   |
| 54  | New-hire onboarding checklist             | Employee created                   | —                                   | Auto-create checklist tasks (assets, access, salary structure, ID)                                | Consistent onboarding                                                                                      | 30 min/hire     | M   | Easy | 5   |
| 55  | Employee-loan repayment schedule reminder | EMI due                            | —                                   | Remind payroll to include in next run                                                             | Prevents missed deductions                                                                                 | N/A             | L   | Easy | 4   |

### 4.8 Organization / Settings / System

| #   | Automation                          | Trigger                 | Conditions | Actions                                                                                                                                                                       | Benefit                                                                | Time Saved                         | P   | D    | ROI |
| --- | ----------------------------------- | ----------------------- | ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- | ---------------------------------- | --- | ---- | --- |
| 56  | RBAC dead-permission-constant sweep | Cron (weekly) + CI gate | —          | Diff every `role-defaults.ts` grant against actual `requirePermission()` calls across all services; flag any constant granted but never checked, or checked but never granted | Directly prevents the bug class that has recurred 6+ independent times | N/A (prevents recurring incidents) | H   | Med  | 10  |
| 57  | Migration journal integrity check   | CI (pre-merge) + cron   | —          | Assert `_journal.json` entry count == migration file count, no BOM, monotonically increasing `when`                                                                           | Directly prevents 3 confirmed silent outages (incl. all-logins-500)    | N/A                                | H   | Easy | 10  |
| 58  | Dead-metric detector                | CI or cron              | —          | Diff every exported Prometheus metric against real `.inc()/.set()` call sites; flag metrics referenced in alert rules but never actually written                              | Prevents alerts that can structurally never fire (confirmed 3x)        | N/A                                | M   | Easy | 8   |
| 59  | 204-response contract test          | CI                      | —          | Assert every `code(204)` route round-trips cleanly through the shared API client                                                                                              | Regression guard for a confirmed platform-wide bug                     | N/A                                | M   | Easy | 6   |
| 60  | New-tenant onboarding wizard        | Tenant provisioned      | —          | Sequence: Org Settings → first Branch/Warehouse → CoA seed → first Financial Year → first Users/Roles, blocking nothing but flagging incomplete steps                         | Removes at least 3 confirmed manual go-live steps found in this audit  | 1–2 hours/tenant                   | H   | Med  | 8   |
| 61  | Feature-flag rollout auto-report    | Flag toggled            | —          | Log + notify affected tenants automatically                                                                                                                                   | Change-management visibility                                           | N/A                                | L   | Easy | 4   |

### 4.9 Cross-Cutting / Platform

| #   | Automation                                                 | Trigger                                                 | Conditions                                                    | Actions                                                                                                                                  | Benefit                                                                                                                  | Time Saved | P   | D    | ROI |
| --- | ---------------------------------------------------------- | ------------------------------------------------------- | ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ---------- | --- | ---- | --- |
| 62  | Event-contract test harness                                | CI (pre-merge)                                          | Any outbox-event producer or consumer changed                 | Diff every field a consumer reads against what the current producer actually writes, fail the build on mismatch                          | Directly prevents the single most-repeated bug class in this entire audit (4+ confirmed instances)                       | N/A        | H   | Hard | 10  |
| 63  | Report-registry schema-drift check                         | CI (pre-merge) or nightly                               | —                                                             | Run every report-service case against a real schema snapshot, not mocked `db.execute()`                                                  | Prevents the 43+25-case breakage from recurring silently                                                                 | N/A        | H   | Med  | 9   |
| 64  | Branch-scope coverage scanner                              | CI                                                      | New route added                                               | Assert every entity with a `branchId` column has enforced scoping on list/detail/create/mutating routes                                  | Prevents the systemic gap found and closed in Purchase from recurring elsewhere (e.g. Job Work, Consignment — unaudited) | N/A        | H   | Med  | 8   |
| 65  | GSTCalculator / round2 consolidation                       | One-time refactor, then CI guard against re-duplication | —                                                             | Extract one canonical implementation into `@erp/shared-utils`, delete the 4 copies, add a lint rule blocking new local reimplementations | Fixes a confirmed live financial-correctness bug and prevents recurrence                                                 | N/A        | H   | Hard | 9   |
| 66  | Optimistic-lock `version` field coverage check             | CI                                                      | Entity has a `version` column                                 | Assert every edit form sends it back                                                                                                     | Prevents the Warehouse-edit-100%-broken bug class from recurring                                                         | N/A        | M   | Easy | 6   |
| 67  | Blank-optional-field schema symmetry check                 | CI                                                      | Frontend Zod schema vs backend Zod schema for the same entity | Flag any field the frontend allows as `''` that the backend's plain `.optional()` would reject                                           | Prevents the confirmed 3x-recurring pattern (supplier, employee, more)                                                   | N/A        | M   | Med  | 7   |
| 68  | Hardcoded `branchId: 1` / `warehouseId: 1` literal scanner | CI                                                      | —                                                             | grep-based static check                                                                                                                  | Already swept once manually; make it permanent                                                                           | N/A        | L   | Easy | 5   |
| 69  | Weekly cross-service test-coverage report                  | Cron (weekly)                                           | —                                                             | Auto-email a coverage-ratio trend per service, flag any service below the 07-31 audit's baseline                                         | Keeps the known-thin services (inventory/purchase/auth) visible                                                          | N/A        | M   | Easy | 5   |
| 70  | Postgres RLS rollout tracker                               | One-time initiative                                     | GUC-per-request gap (ES-36) resolved                          | Auto-verify RLS policies exist and are enabled per tenant table                                                                          | Closes the single biggest structural security gap (app-level-only tenant isolation)                                      | N/A        | H   | Hard | 9   |

_(A further ~20 lower-priority automations — e.g. auto-archival of `report_run_history` to S3, auto-labelling of DLQ items by root-cause pattern, auto-scaling alerts for job queue depth — are catalogued in the Automation Marketplace, Section 7, as templates rather than repeated here.)_

---

## 5. AI Feature Catalog

Organized by module. Each idea states whether it can be built **statistically/heuristically today** (matching how the existing CRM AI suite was actually built — no ML vendor dependency) or genuinely needs an **LLM/ML layer** (Claude/OpenAI/Gemini API, or a trained model).

### 5.1 Sales & POS

- **AI Quote Generator** (LLM) — draft a quotation from a natural-language description of what the customer wants.
- **AI Dynamic Pricing Advisor** (Statistical) — suggest a price within policy bounds based on customer segment, order size, season.
- **AI Next-Best-Product Suggestion** (Statistical, market-basket) — at invoice/POS line-add time.
- **AI Invoice Anomaly Detector** (Statistical) — flag an invoice whose margin, discount, or tax pattern deviates from the customer/item's historical norm.
- **AI CESS/Tax-Inclusive-Pricing Auditor** (Rule-based) — a direct, cheap AI-adjacent safeguard against the two confirmed tax-calculation gaps in this module.
- **AI Credit-Risk Scorer** (Statistical) — score credit-limit-override requests by payment history before they reach a manager.
- **AI Voice-to-POS** (LLM/ASR) — voice-driven item search/add for cashiers.

### 5.2 CRM

- **AI Smart Follow-up Generator** (LLM) — drafts the next outreach message per lead/deal stage.
- **AI Email/WhatsApp Reply Assistant** (LLM) — suggested replies inside the Omnichannel Inbox.
- **AI Lead Score Explainer** (Statistical + LLM summary) — turns the existing predictive score into a plain-language "why."
- **AI Campaign Copywriter** (LLM) — drafts campaign content, DLT-template-compliant variants included.
- **AI Duplicate Customer/Contact Detector** (Statistical, extend the existing CSV-import dedupe scorer to run proactively on manual creation).
- **AI Churn Predictor** (Statistical) — extends the existing health-scoring service.
- **AI Territory/Quota Rebalancer** (Statistical/optimization) — suggests territory reassignment from real performance data.
- **AI Meeting/Call Summarizer** (LLM + ASR) — for the CTI/Twilio integration once recording is compliance-approved.
- **AI Segment Builder from Natural Language** (LLM → query) — "customers who bought fabric but not thread in 60 days."

### 5.3 Inventory & Purchase

- **AI Demand Forecasting** (Statistical, time-series) — per-SKU, feeding the low-stock→auto-PO automation.
- **AI Fabric Consumption Predictor** (Statistical) — high-relevance given the confirmed textile/garment business context; predicts roll consumption per order pattern.
- **AI Dead-Stock Liquidation Advisor** (Statistical) — suggests markdown %/bundling to clear flagged dead stock.
- **AI Supplier Recommendation Engine** (Statistical, using the newly-built Vendor Rating data) — ranks suppliers for a new RFQ.
- **AI Purchase Predictor** (Statistical) — auto-drafts POs from consumption trend + lead time.
- **AI Landed-Cost Anomaly Detector** (Statistical) — flags a landed-cost allocation that deviates from historical freight/duty ratios.
- **AI PO-GRN-Invoice Variance Explainer** (LLM summary over structured diff) — turns the new 3-way variance layer's numeric diffs into a plain-language explanation.
- **AI Smart Barcode Recognition** (CV/ML) — camera-based barcode/label reading beyond laser-scanner input.

### 5.4 GST & Accounting

- **AI GST Error Detection** (Rule-based + Statistical) — the single highest-ROI AI feature in this report given the 4 confirmed payload-drift bugs already found; flags ledger rows with impossible tax-rate/amount combinations before they reach a filed return.
- **AI Journal Entry Suggestion** (LLM + rule-based) — for manual journal entries (e.g., ad-hoc adjustments), suggest the correct debit/credit account pair.
- **AI Expense Categorization** (Statistical/LLM classifier) — auto-categorize expense-line entries from vendor name + description.
- **AI OCR for Invoice/GRN Entry** (OCR + LLM extraction) — scan a supplier invoice, pre-fill the GRN/Purchase Invoice.
- **AI Cash Flow Forecast** (Statistical, time-series over AR/AP aging + recurring commitments).
- **AI Fraud/Anomaly Detection on Journals** (Statistical) — unusual posting patterns, off-hours entries, round-number clustering.
- **AI Profit Leakage Detector** (Statistical) — cross-references margin erosion against the known GSTCalculator-divergence and ₹0-journal bug classes as a standing detector, not just a one-time fix.
- **AI Bank-Reconciliation Matcher** (Statistical/fuzzy-match) — auto-suggests matches for ambiguous bank lines.
- **AI GSTR Filing Pre-Check** (Rule-based) — cross-validates GSTR-1/3B/9 internal consistency before filing (directly modeled on the GSTR-9-vs-GSTR-3B contradiction this audit found).

### 5.5 HR & Payroll

- **AI Payroll Validator** (Rule-based + Statistical) — pre-flight check before every run (see automation #49), extended with anomaly detection on salary changes month-over-month.
- **AI Attendance Anomaly Detection** (Statistical) — flags buddy-punching patterns, chronic lateness trends.
- **AI Leave Prediction** (Statistical) — forecasts leave-heavy periods for staffing planning.
- **AI Shift/Roster Optimizer** (Optimization) — for retail/POS branch staffing.
- **AI Resume/Onboarding Document Understanding** (OCR + LLM) — extract structured employee data from uploaded ID/education documents.

### 5.6 Reports & Platform-Wide

- **AI Natural Language Search / Report Builder** (LLM → SQL against the report registry, not raw tables) — "show me GRN price trend for Supplier X last quarter."
- **AI Business Copilot** (LLM, RAG over the tenant's own data + this report's known-gap list) — a chat surface across the whole ERP for "why is my balance sheet off" style questions, explicitly designed to route financial questions through the _rule engine_, not free-form SQL, given the confirmed report-engine drift.
- **AI Document Understanding** (OCR + LLM) — generalized across GRN/Invoice/Expense receipt capture.
- **AI Executive Summary Generator** (LLM) — auto-written plain-language summary attached to every scheduled report email.
- **AI DLQ/Incident Root-Cause Summarizer** (LLM over structured error data) — for the System module's admin tooling.

---

## 6. The Automation Module — Workflow Engine Design

### 6.1 Should NEXORAA build one?

**Yes — recommended as a Phase 2 initiative**, for a specific reason grounded in this audit rather than generic ERP-vendor logic: the single most repeated failure pattern found across every module is **"the backend capability exists, but nothing ever triggers or surfaces it."** Employee Loans, TDS auto-posting, RCM Register, PO/voucher PDFs, the supplier CSV importer, campaign engagement tracking, low-stock alerts, GST filing reminders — these are not architecture failures, they are **missing wiring**, discovered one QA pass at a time. A general-purpose, user-configurable workflow engine converts "wire this one thing" into "give any admin the tool to wire the next hundred things themselves," which is the only way to stop this pattern from recurring forever.

The existing scheduler-service is already a strong foundation to build on, not replace: 44 real jobs on BullMQ+Redis with distributed locking, retry, and (as of the 2026-07-22 observability audit) full execution history and Prometheus metrics. The workflow engine should be a **new orchestration layer on top of this proven job engine**, not a rewrite of it.

### 6.2 Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  Workflow Builder UI (web-frontend, new module under         │
│  Organization → Automation)                                  │
│  - Visual drag-and-drop canvas (React Flow or similar)       │
│  - Trigger node → Condition/Filter nodes → Action nodes      │
│  - Parallel/Sequential branch support, Delay/Timer nodes      │
└───────────────────────────┬───────────────────────────────────┘
                             │ saves as versioned JSON DAG
┌───────────────────────────▼───────────────────────────────────┐
│  New: automation-service (16th microservice)                  │
│  - WorkflowDefinitionService (CRUD, versioning, templates)     │
│  - TriggerRegistry (event-bus subscriptions + cron + webhook   │
│    + API-trigger + polling DB-trigger)                        │
│  - WorkflowExecutionEngine (DAG walker, calls existing          │
│    JobRegistry/BullMQ for durable step execution, NOT a new    │
│    queue — reuses scheduler-service's proven locking/retry)    │
│  - ConditionEvaluator (safe expression sandbox, not eval())    │
│  - ApprovalGateService (human-in-the-loop steps, reuses the    │
│    existing notification/approval UI patterns)                │
│  - ExecutionHistoryStore (per-run step log, same shape as the  │
│    scheduler's job_history table)                              │
└───────────────────────────┬───────────────────────────────────┘
                             │ subscribes to
┌───────────────────────────▼───────────────────────────────────┐
│  Existing Kafka event bus (outbox pattern, event-service)      │
│  + new: a webhook-ingestion endpoint + cron triggers via        │
│  the existing scheduler + a DB-change trigger via a thin        │
│  Debezium-style poller on flagged tables                        │
└─────────────────────────────────────────────────────────────┘
```

**Why a new service, not bolted onto scheduler-service or event-service:** scheduler-service owns _time-based_ jobs; event-service owns the _outbox/inbox/DLQ_ mechanics. A workflow engine needs to own _user-authored, versioned, multi-step business logic_ that spans both — giving it its own bounded context avoids further overloading two services that already have clear, separate responsibilities (consistent with this codebase's existing microservice boundaries).

### 6.3 Required capabilities (mapped to the requested spec)

| Capability                                                                                                                                                                                                                         | Design decision                                                                                                                                                                                                                                                                                                         |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Visual Workflow Builder / Drag & Drop                                                                                                                                                                                              | React Flow canvas in web-frontend; nodes serialize to a versioned JSON DAG stored in `automation-service`                                                                                                                                                                                                               |
| Conditions / Filters                                                                                                                                                                                                               | A sandboxed expression evaluator (e.g., `jsonata` or a custom safe-subset evaluator — never raw `eval()`, given this is financial data) operating on the triggering event's payload                                                                                                                                     |
| Approvals                                                                                                                                                                                                                          | A first-class node type that pauses the DAG and creates a task in the existing notification/task system; resumes on approve/reject                                                                                                                                                                                      |
| Parallel Flows                                                                                                                                                                                                                     | DAG supports fan-out nodes; engine tracks per-branch completion before a join node proceeds                                                                                                                                                                                                                             |
| Sequential Flows                                                                                                                                                                                                                   | Default DAG edge behavior                                                                                                                                                                                                                                                                                               |
| Timers / Delays                                                                                                                                                                                                                    | A `wait` node type that reschedules the BullMQ job for a future timestamp (reuses existing delayed-job support)                                                                                                                                                                                                         |
| Schedulers / Cron Jobs                                                                                                                                                                                                             | Trigger type backed directly by the existing scheduler-service cron registration                                                                                                                                                                                                                                        |
| Webhook Trigger                                                                                                                                                                                                                    | New signed-webhook ingestion endpoint (HMAC verification, matching the pattern already used for other signature-verified webhooks in this codebase)                                                                                                                                                                     |
| API Trigger                                                                                                                                                                                                                        | Authenticated `POST /automation/trigger/:workflowId` using the existing API-key auth (already built for the Public CRM API/BI Export, Section 3.3)                                                                                                                                                                      |
| Database Trigger                                                                                                                                                                                                                   | A polling-based "row changed" trigger on a small allowlist of tables initially (not full CDC/Debezium in v1 — matches this codebase's pragmatic, non-over-engineered style)                                                                                                                                             |
| Business-event triggers (Invoice Created, Customer Created, Lead Won, Payment Received, Low Stock, GST Due, Payroll Completed, Attendance Missing, Purchase Approved, GRN Completed, Stock Adjusted, User Login, Any Custom Event) | Subscribe directly to the existing outbox-event Kafka topics — **this is the single biggest reason this engine is cheap to build**: the events already exist and are already published, just not consumed by anything general-purpose today                                                                             |
| Workflow Versioning                                                                                                                                                                                                                | Every save creates a new version row; running instances pin to the version they started on                                                                                                                                                                                                                              |
| Workflow Testing                                                                                                                                                                                                                   | A "dry run" mode that evaluates conditions and shows which branch would fire, without executing actions                                                                                                                                                                                                                 |
| Workflow Logs / Execution History                                                                                                                                                                                                  | Per-run, per-node status/timestamp/payload snapshot, same UI pattern as the existing Scheduler Jobs dashboard                                                                                                                                                                                                           |
| Retry Failed Jobs                                                                                                                                                                                                                  | Reuses BullMQ's existing retry/backoff, exposed per-node in the UI                                                                                                                                                                                                                                                      |
| Dead Letter Queue                                                                                                                                                                                                                  | Failed workflow runs land in the _same_ `dlq_items` table and admin console already fixed for outbox events — one unified DLQ, not a second one                                                                                                                                                                         |
| Audit Trail                                                                                                                                                                                                                        | Every workflow create/edit/enable/disable/manual-trigger writes to the existing `audit_logs` table                                                                                                                                                                                                                      |
| Role Permissions                                                                                                                                                                                                                   | New `AUTOMATION_VIEW/CREATE/EDIT/DELETE/EXECUTE` permissions, following this codebase's existing granular-permission convention exactly (and — given the RBAC dead-constant pattern found 6+ times — these must be added to role-defaults.ts and verified against real route checks in the same PR, not as a follow-up) |
| Workflow Templates                                                                                                                                                                                                                 | Backed by Section 7's 120-template marketplace, one-click "install into my tenant"                                                                                                                                                                                                                                      |

### 6.4 Guardrails specific to this codebase's known failure modes

Given the grounded findings above, the engine's own design should defend against the bug classes this audit already found elsewhere:

1. **No direct financial-write actions** — any action node that would post a journal, adjust stock valuation, or change a GST ledger must call the existing domain service (`InvoiceService`, `PostingMatrixService`, etc.), never write to a table directly, so the workflow engine cannot become a fifth place where GST/valuation logic gets reimplemented and drifts.
2. **Every trigger payload is validated against the same shared schema the real event producer uses** — closing off a fifth potential instance of the "producer/consumer payload drift" bug class this audit found four times already.
3. **Branch-scoping is enforced on every workflow's data access** the same way it now is everywhere else in the platform, from day one — not retrofitted after a gap is found.
4. **Every new automation ships with its RBAC permission wired and role-defaults.ts updated in the same change**, per the "56. RBAC dead-permission-constant sweep" automation above.

---

## 7. Automation Marketplace — 120 Reusable Templates

Presented as a compact catalog, grouped by category. Each is installable as a pre-built workflow once the engine (Section 6) exists.

**Sales & Revenue (18):** Lead Follow-up Sequence · Auto Invoice Reminder Ladder · Quotation Expiry Reminder · Quotation Auto-Convert on Accept · Payment Received → Thank-You Message · Payment Overdue Escalation · Auto Credit-Note on Return · Recurring Invoice Generator · Delivery-Challan-to-Invoice · Abandoned-Cart-Style Quote Follow-up · High-Value-Deal Manager Alert · Credit-Limit-Breach Approval Routing · Discount-Above-Threshold Approval · New-Customer Welcome Sequence · Customer Win-Back (90-day dormant) · Birthday/Anniversary Wishes · Milestone-Order Congratulations · POS Shift-Close Reminder.

**CRM & Marketing (16):** New-Lead Auto-Assignment · Lead-SLA Escalation · Lead-Score-Drop Alert · Won-Deal Onboarding Checklist · Referral-Reward Auto-Payout · Loyalty-Tier-Upgrade Notification · Loyalty-Points-Expiring Reminder · Support-Ticket SLA Escalation · Campaign-Click Follow-up · Festival-Season Campaign Draft · NPS/CSAT Survey Trigger · Segment-Membership-Change Notification · Territory Reassignment Approval · Quota-Shortfall Alert · Inbox-Message-Unanswered Escalation · Journey-Step Timeout Reminder.

**Inventory & Warehouse (14):** Low-Stock Auto-PO-Draft · Reorder-Point Breach Alert · Dead-Stock Flag · Stock-Transfer-Stuck-in-Draft Reminder · Physical-Verification-Variance Routing · Fabric-Roll Near-Exhaustion Alert · Cross-Warehouse Rebalancing Suggestion · Expiring-Batch Alert (once FEFO ships) · Price-List Change Notification · New-Item-No-HSN Alert · Negative-Stock Investigation Trigger · Warehouse-Capacity-Threshold Alert · Item-Never-Sold-90-Days Flag · Consignment-Settlement-Due Reminder.

**Purchase & Procurement (14):** PO Auto-Approval Under Threshold · PO High-Value Approval Routing · GRN-Overdue Reminder · 3-Way-Variance Flag · Supplier-Payment-Due Reminder · PDC-Clearing Reminder · Blanket-PO-Expiry Alert · Vendor-Rating Auto-Update · RFQ-Response-Deadline Reminder · RFQ-All-Quoted Auto-Summary · Requisition-Approval Routing · Supplier-Onboarding Checklist · Landed-Cost-Anomaly Flag · Purchase-Return Auto Debit-Note.

**GST & Compliance (12):** GSTR Filing-Due Reminder Ladder · GST-Ledger-Completeness Auto-Audit · GSTR-2A Auto-Reconciliation Run · RCM-Trigger Verification · e-Invoice-Failure Auto-Retry · Compliance-Calendar Escalation · HSN/SAC-Missing Alert · GSTIN-Validation-Failure Alert · CDNR/CDNUR-Classification Audit · Annual-Return-Prep Checklist · TDS-Threshold-Crossed Alert · E-Way-Bill-Expiry Reminder.

**Accounting & Finance (14):** ₹0-Journal Auto-Audit · Cross-Engine BS/Cash-Flow Divergence Check · New-Tenant Financial-Year Auto-Provision · Month-End-Close Checklist · Bank-Statement Auto-Match · Depreciation-Batch Exception Summary · Period-Close Lockout Enforcement · Cost-Center-Budget-Breach Alert · Fixed-Asset-Disposal Approval · TDS-Deduction Reminder · Employee-Loan-EMI Reconciliation Audit · Trial-Balance-Imbalance Alert · Year-End-Close Checklist · Journal-Reversal-Approval Routing.

**HR & Payroll (14):** Payroll Pre-Flight Validator · Attendance-Anomaly Flag · Leave-Balance Auto-Accrual · PF/ESI/PT Challan Generation · Form-16 Batch Generation · New-Hire Onboarding Checklist · Employee-Loan-Repayment Reminder · Probation-End Reminder · Contract-Renewal Reminder · Birthday Wishes (Employee) · Work-Anniversary Wishes · Shift-Swap Approval Routing · Overtime-Threshold Alert · Exit-Clearance Checklist.

**Platform & Ops (18):** RBAC Dead-Permission Sweep · Migration-Journal Integrity Check · Dead-Metric Detector · 204-Response Contract Test · New-Tenant Onboarding Wizard · Feature-Flag Rollout Report · DLQ-Depth Escalation · Job-Execution-Failure Escalation · Kafka-Consumer-Lag Alert · Backup-Completion Verification · SSL-Cert-Expiry Reminder · API-Key-Expiry Reminder · Failed-Login-Spike Alert · Suspicious-Impersonation-Activity Alert · Scheduled-Report-Failure Alert · Data-Export-Completion Notification · Storage-Quota-Threshold Alert · Uptime/Health-Check Escalation Matrix.

_(120 templates total: 18+16+14+14+12+14+14+18 = 120.)_

---

## 8. Integration Roadmap

| Integration                                        | Use Case                                                                                                                          | Priority                |
| -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ----------------------- |
| WhatsApp Business API                              | Already DLT/TRAI-gated for CRM; extend to invoice reminders, payment confirmations, GST filing alerts                             | H                       |
| Email (SendGrid + Mailhog fallback, already wired) | Extend to workflow-engine action nodes generically                                                                                | H                       |
| SMS (DLT-compliant, already wired for CRM)         | Same extension as WhatsApp                                                                                                        | H                       |
| Razorpay / UPI / PhonePe                           | Payment-link generation on invoice send + webhook auto-reconciliation (Automation #3)                                             | H                       |
| Bank APIs (account aggregator / statement feeds)   | Auto bank reconciliation (Automation #45)                                                                                         | M                       |
| OCR (invoice/GRN/receipt capture)                  | Feeds AI OCR features (Section 5.3/5.4)                                                                                           | M                       |
| Claude / OpenAI / Gemini API                       | Powers every LLM-tagged AI feature in Section 5; recommend Claude given existing Anthropic tooling already in use for engineering | H                       |
| Google Sheets / Excel                              | Two-way sync for report exports already built (CSV/Excel export exists platform-wide)                                             | M                       |
| Power BI                                           | Read-only data feed via the existing Public API/BI Export (already shipped for CRM, Section 3.3) — extend to all modules          | M                       |
| Tally                                              | Bidirectional CoA/journal sync for tenants migrating from Tally                                                                   | M                       |
| Zoho                                               | Lead-import bridge for tenants migrating CRM data in                                                                              | L                       |
| Slack / Microsoft Teams                            | Workflow-engine notification channel, approvals-in-chat                                                                           | M                       |
| Google Drive / Dropbox / OneDrive                  | Document attachment sync (attachments already exist as a polymorphic entity type)                                                 | L                       |
| eSign                                              | Quotation/PO/contract signing                                                                                                     | M                       |
| Barcode Scanner (USB/Serial)                       | Already wired in POS (with confirmed checksum validation added 2026-07-24)                                                        | — (done)                |
| Biometric                                          | Attendance capture hardware integration                                                                                           | M                       |
| IoT Devices / RFID                                 | Warehouse bin-level tracking (post bin/location hierarchy build)                                                                  | L                       |
| Printers / Label Printers                          | Barcode label printing (Consignment module)                                                                                       | M                       |
| NIC e-Invoice/e-Way Bill API                       | Already integrated, blocked only on the tenant obtaining `NIC_API_KEY` credentials                                                | — (pending credentials) |

---

## 9. Auto-Generated Reports Catalog

Reports that should run on a schedule and land in an inbox/dashboard without anyone asking, once the workflow engine and reliable report registry (Section 3.10 fixes) are in place:

**Daily:** Daily Sales Summary · Today's Collections · Pending Payments (aging) · Low Stock · Cash Position · GST Ledger Completeness Audit · ₹0-Journal Audit · Job-Execution Failure Digest.

**Weekly:** Top Customers · Top Products · Slow-Moving Stock · Dead Stock · Purchase Forecast vs Actual · Sales Forecast vs Actual · Branch Comparison · Warehouse Comparison · Campaign Engagement Summary · Vendor Rating Changes.

**Monthly:** Cash Flow Statement · Profit Analysis (by branch, by cost center) · Inventory Aging · Employee Productivity · Tailor Productivity · Campaign ROI · GST Filing Status Summary · Bank Reconciliation Exceptions · TDS Summary · Payroll Cost Trend.

**Quarterly/Annual:** GSTR-9 Pre-Check Summary · Form 16 Batch · Fixed-Asset Depreciation Schedule · Annual Customer Cohort Retention · Vendor Performance Scorecard.

**Exception-triggered (not scheduled — fires on anomaly):** Fraud/Anomaly Report · Cross-Engine Report-Divergence Report (Automation #43) · RBAC Dead-Permission Report (Automation #56) · Migration-Integrity Report (Automation #57) · Branch-Scope-Gap Report (Automation #64).

---

## 10. Automation / AI Scorecard by Module

| Module                  | Automation Score /100 | AI Readiness /100 | Process Maturity /100 | UX Score /100 | Business Impact /100 | Recommendation                                                                                                  |
| ----------------------- | --------------------- | ----------------- | --------------------- | ------------- | -------------------- | --------------------------------------------------------------------------------------------------------------- |
| Customers               | 25                    | 30                | 65                    | 70            | 70                   | Add dedupe-at-creation + churn signal; low effort, real payoff                                                  |
| Sales & Invoicing       | 35                    | 35                | 75                    | 72            | 90                   | Highest-traffic module — prioritize payment-reminder + reconciliation automations first                         |
| CRM                     | 55                    | 60                | 88                    | 80            | 85                   | Most mature module already (4 phases shipped) — next step is AI-layer, not more wiring                          |
| Inventory               | 30                    | 25                | 75                    | 68            | 85                   | Low-stock auto-PO is the single highest-ROI automation in the whole catalog                                     |
| Purchase                | 40                    | 25                | 85                    | 74            | 82                   | Best-audited module (93/100 readiness) — mainly needs the automation catalog wired, not fixes                   |
| GST                     | 30                    | 20                | 80                    | 65            | 95                   | Highest compliance risk — prioritize the GST-ledger-completeness auto-audit above all else                      |
| Accounting              | 28                    | 20                | 70                    | 66            | 92                   | Prioritize the cross-engine-divergence check and ₹0-journal audit immediately                                   |
| Job Work                | 15                    | 10                | 55                    | 60            | 55                   | Needs a dedicated QA/gap-analysis pass before automation investment                                             |
| Consignment             | 15                    | 10                | 50                    | 58            | 50                   | Same — audit before automate                                                                                    |
| Reports                 | 20                    | 25                | 60                    | 62            | 75                   | Fix the schema-drift CI gate before adding more reports on top of an unstable base                              |
| HR                      | 32                    | 22                | 72                    | 68            | 78                   | Payroll pre-flight validator is a fast, high-relief win                                                         |
| Organization/Settings   | 18                    | 10                | 55                    | 60            | 88                   | Highest bug density found anywhere — treat as still-fragile despite fixes; add the onboarding-wizard automation |
| System (platform admin) | 45                    | 15                | 68                    | 55            | 60                   | Internal-only impact, but the migration-integrity and dead-metric checks here protect every other module        |

_(Scores are consulting judgment calibrated against the grounded findings in Section 3 — not derived from an automated measurement tool. Re-score after Phase 1 of the roadmap below.)_

---

## 11. Implementation Roadmap

### Phase 1 — Quick Wins (Highest ROI), 4–6 weeks

**Goal: stop the bleeding on the bug classes that have already recurred multiple times, and land the highest-ROI single automations.**

| Item                                                                          | Effort | Business Value                         | Risk | Dependencies                    |
| ----------------------------------------------------------------------------- | ------ | -------------------------------------- | ---- | ------------------------------- |
| Migration-journal integrity CI check (#57)                                    | Low    | High (prevents outage-class incidents) | Low  | None                            |
| RBAC dead-permission-constant sweep, one-time + CI gate (#56)                 | Med    | High                                   | Low  | None                            |
| ₹0-journal auto-audit (#42)                                                   | Low    | High                                   | Low  | None                            |
| GST-ledger-completeness auto-audit (#36)                                      | Low    | High                                   | Low  | None                            |
| Cross-engine BS/Cash-Flow divergence check (#43)                              | Low    | High                                   | Low  | None                            |
| New-tenant Financial-Year auto-provisioning (#44)                             | Low    | High (removes a go-live blocker)       | Low  | None                            |
| Payment-reminder ladder (#2)                                                  | Med    | High                                   | Low  | Notification templates (exist)  |
| Low-stock auto-draft-PO (#21)                                                 | Med    | High                                   | Low  | Preferred-supplier data quality |
| Payroll pre-flight validator (#49)                                            | Low    | High                                   | Low  | None                            |
| 204-response / blank-optional-field / version-field CI guards (#59, #66, #67) | Low    | Medium                                 | Low  | None                            |

**Effort:** ~1 senior engineer-month equivalent. **Business value:** disproportionately high — every item here directly targets a bug class that has already caused a real incident in this codebase. **Risk:** low — all are additive checks/automations, not rewrites.

### Phase 2 — Core Automation, 2–3 months

**Goal: build the Automation/Workflow Engine (Section 6) and wire the top 30 marketplace templates.**

| Item                                                                                      | Effort | Business Value | Risk                                     | Dependencies                                                                                                 |
| ----------------------------------------------------------------------------------------- | ------ | -------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `automation-service` (new microservice) — trigger registry, DAG engine, execution history | High   | High           | Medium                                   | Reuses scheduler-service's BullMQ, event-service's outbox topics                                             |
| Workflow Builder UI                                                                       | High   | High           | Medium                                   | Design system components (note: `packages/ui` gaps flagged in the architecture audit should be closed first) |
| Approval-gate node type                                                                   | Medium | High           | Low                                      | Existing notification/task infra                                                                             |
| 30 highest-priority marketplace templates pre-installed                                   | Medium | High           | Low                                      | automation-service live                                                                                      |
| Event-contract test harness (#62)                                                         | High   | Very High      | Medium                                   | Requires enumerating every outbox producer/consumer pair — a real but bounded effort                         |
| GSTCalculator / round2 consolidation (#65)                                                | Medium | High           | Medium (touches financial-critical code) | Needs its own dedicated, carefully-tested pass — already flagged, not yet scheduled                          |

### Phase 3 — AI Features, 2–3 months (can overlap Phase 2's tail)

**Goal: layer AI onto a now-more-trustworthy data spine.**

- AI GST Error Detection, AI Journal Entry Suggestion, AI Expense Categorization (build first — highest compliance ROI, lowest data-trust risk since Phase 1's audits are already in place).
- AI Payroll Validator, AI Duplicate Customer Detector (extend existing dedupe scorer).
- AI Smart Follow-up Generator, AI Email/WhatsApp Reply Assistant (Claude API, RAG over CRM Inbox history).
- AI Demand Forecasting, AI Fabric Consumption Predictor (statistical time-series, no LLM needed).
- Report-service schema-drift CI gate (#63) should land before or alongside this phase — an AI copilot that reads from a report layer known to silently break on schema drift is a credibility risk.

### Phase 4 — Predictive Intelligence, 3–4 months

- AI Cash Flow Forecast, AI Profit Leakage Detector, AI Fraud/Anomaly Detection on Journals.
- AI Supplier Recommendation Engine, AI Landed-Cost Anomaly Detector (using Vendor Rating data, now several months mature).
- AI Churn Predictor extension (deeper than the existing statistical health score).
- Postgres RLS rollout (#70) — the biggest remaining structural security gap; predictive-intelligence-era ERP handling more automated financial actions raises the bar on tenant-isolation guarantees.

### Phase 5 — Autonomous ERP, ongoing

- AI Business Copilot (RAG across the tenant's real data, routed through the rule engine — not raw SQL — per the Section 6.4 guardrail).
- Autonomous low-stock-to-PO-to-approval-to-order cycles for trusted, high-confidence SKUs (human-in-the-loop by default, opt-in full-autonomy per tenant policy).
- AI-assisted month-end close and GST filing pre-checks that a human only needs to review, not perform.
- Continuous self-auditing (the Phase 1 audit automations, generalized into a standing "AI QA agent" that runs the same kind of grounded, evidence-based audit this report performed — on a schedule, not just when a human asks).

---

## 12. Final Product Vision

NEXORAA's real competitive asset is not a missing-feature list — the CRM roadmap alone already rivals mid-market Salesforce/Dynamics depth (pipeline, journeys, loyalty, referrals, omnichannel, segmentation, territory/quota management, a self-service portal, mobile, CTI). The real asset, and the real risk, is **operational trust**: whether the numbers on a P&L, a GSTR-9, or a stock valuation report can be trusted without a human re-deriving them by hand. This audit found that trust has been earned the hard way — one QA pass, one bug, one fix at a time — and that the same handful of bug _shapes_ (event-payload drift, dead RBAC constants, duplicated financial logic, wired-backend-no-frontend) keep recurring because nothing in the platform itself prevents them structurally.

The vision this report argues for is not "add more AI features." It is: **close the structural gaps that let the same bug classes recur (Phase 1), build one general-purpose engine that turns "we found a wiring gap" into "any admin can wire it themselves" (Phase 2), and only then layer AI on top of a data spine trustworthy enough that an AI-generated journal suggestion or GST anomaly flag is actually more reliable than what a distracted human would produce (Phases 3–5).** Done in that order, NEXORAA becomes an ERP where routine work — reminders, reconciliations, reorders, filings, follow-ups — genuinely disappears from a human's task list, and where the humans who remain are reviewing AI-drafted decisions instead of re-typing data that already exists somewhere else in the system. That is the realistic, evidence-grounded version of "the most automated ERP platform in the market" — built on top of what NEXORAA has actually already proven it can ship, not a greenfield rewrite.
