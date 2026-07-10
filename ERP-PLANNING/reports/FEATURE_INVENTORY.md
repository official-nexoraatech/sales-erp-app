
# Cloth Retail ERP — Complete Feature Inventory

**Generated:** 2026-07-08, via direct source-code audit (routes, DB schema, domain services, background jobs, frontend components) across all 14 backend services, 2 frontends, and 9 shared packages. This document supersedes narrative claims in prior planning docs where the two disagree — every claim below is grounded in a file path.

> **Scope note:** This is a B2B/retail-operations ERP for a clothing business. There is **no external customer-facing portal or app anywhere in the codebase** — end retail customers never log in; they are managed as CRM records and interact only passively (invoices, receipts, WhatsApp/SMS/email notifications, loyalty point balances communicated by staff). Section 1 below reflects that reality rather than inventing a portal that doesn't exist.

---

## 0. System Overview

| Layer | Components |
|---|---|
| **Frontends** | `web-frontend` (full ERP SPA, React), `pos-frontend` (offline-capable POS terminal, React) |
| **Backend services** | `auth-service`, `tenant-service`, `sales-service`, `purchase-service`, `inventory-service`, `production-service`, `accounting-service`, `gst-service`, `hr-service`, `event-service`, `notification-service`, `scheduler-service`, `search-service`, `report-service`, `api-gateway` (**unimplemented stub**) |
| **Shared packages** | `@erp/db` (Drizzle schema/client), `@erp/sdk` (platform-sdk: audit, saga, rate-limit, storage, telemetry, feature-flags, rule-engine, workflow), `@erp/types` (permissions/events/validators), `@erp/logger`, `@erp/config`, `@erp/utils`, `@erp/cache` (**stub, unused**), `design-tokens`, `event-bus-client` (**orphaned, unused**) |
| **Datastore** | Single shared Postgres (Drizzle ORM, 35 migrations), one schema for the whole monorepo, tenant isolation via `tenant_id` column on every table (no RLS, no per-tenant schema) |
| **Messaging** | Kafka (via raw `kafkajs`, not the orphaned shared wrapper) + a DB-backed outbox-relay pattern (`event-service`) |
| **Search** | Elasticsearch, 30 indexed entities, real-time Kafka sync + scheduled reindex |
| **Object storage** | MinIO (S3-compatible) for attachments/exports/logos |
| **Observability** | OpenTelemetry→Jaeger tracing, Prometheus metrics, Winston structured logging — wired into 13 of 14 backend services (all but `api-gateway`) |
| **Secrets** | HashiCorp Vault **provisioned but never called** — secrets are plain env vars in practice |

---

## 1. User-Facing Features (staff who operate the system)

Since there is no external customer portal, "user features" means what a logged-in staff member (of any role) can do. Baseline capabilities available to any authenticated user, gated only by their permissions:

- **Global command palette** (`Ctrl/Cmd`-triggered) — fuzzy search across 28+ entity types, action-mode (`>` prefix) to run any permitted nav route or quick-create as a command, saved searches, recent pages/searches, keyboard navigation, offline-aware empty state.
- **Personal settings**: profile edit, password change, avatar upload, own active-session list + per-session revoke, MFA enroll/confirm/disable + backup-code regeneration.
- **Notifications**: in-app bell with unread count (5s SSE poll), mark-as-read, per-event-type channel preference (SMS/Email/WhatsApp/In-App); toast notifications on every mutation.
- **Appearance**: light/dark/high-contrast theme, reduced-motion toggle, density mode (compact/comfortable/spacious), tenant-branded colors/fonts that live-sync across browser tabs.
- **Data tables everywhere**: sort, per-table persisted column visibility, bulk row selection + bulk actions, pagination, sticky headers.
- **Dashboards**: KPI cards + 8 chart types (sales trend, category mix, payment-mode split, stock levels, month-over-month, top customers, receivables ageing, purchase trend), refreshed live.
- **POS checkout experience** (cashiers): barcode/camera scan, quick-item grid, split-tender payment (cash/card/UPI/loyalty), UPI QR generation, held/parked sales, customer quick-create, receipt print (3 paper sizes) + WhatsApp/email resend, works fully **offline** with automatic background sync on reconnect.

---

## 2. Administrator Features

- **User & role management**: full CRUD on users and tenant-scoped custom roles, permission-set editing per role, per-user role/branch assignment, self-escalation guard (can't grant permissions you don't hold yourself), last-OWNER deletion guard, admin-initiated password reset (requires the *admin's own* password as re-auth), manual account lock/unlock.
- **Impersonation**: admin can generate a 1-hour token carrying a target user's exact roles/permissions, fully audit-logged (start/end) — **backend-complete but has no frontend UI/button anywhere**, so it's currently only reachable via direct API call.
- **Security & audit**: append-only audit log (before/after diffs, actor, IP), dedicated security-audit-log view (impersonation/MFA/session/suspicious-login events), IP-based brute-force blocking, per-user lockout policy.
- **Feature flags**: tenant-level toggles (`einvoice_enabled`, `whatsapp_enabled`, `fifo_valuation`, `mfa_required`, `purchase_3way_match`, `hr.tailoring.enabled`, `sales.loyalty.enabled`, `inventory.fabric-rolls.enabled`, and more) with per-tenant override display — **enforced server-side only**; the frontend has no client-side flag-gated rendering.
- **Organization/tenant settings**: legal name, GSTIN/PAN, bank details (used for POS UPI QR), logo upload, brand theme (color/font — radius scale stored but not applied), branches (head-office singleton, GSTIN per branch), warehouses.
- **Platform administration** (cross-tenant, separate `PLATFORM_TENANT_MANAGE` permission and a distinct `PLATFORM_OPERATOR` role): tenant provisioning, list/activate/suspend/close tenants with reason capture.
- **Distributed-systems operations console**: live admin viewers for Event Store (replay aggregate state), Dead-Letter Queue (per-topic pending/replayed/discarded, bulk replay, payload inspection), Saga Monitor (retry/compensate), Schema Registry (versioned event schemas + compatibility checks), Projections (status/rebuild), Performance baselines. These are real operational tools, not placeholders — though see §8 for what's simulated underneath.
- **Search administration**: reindex triggers, bulk-index, tenant index create/delete, per-entity stats, search analytics (no-result rate, click rate, latency, popular queries).
- **Import/Export tooling**: CSV import wizard (upload→column-map→validate→execute→rollback) for customers/suppliers/items/employees/opening-stock; generic export job API (**stub — see §8**).
- **Scheduler control**: view/trigger/pause/resume any of the 31 registered background jobs, view last-30-run history.

---

## 3. Staff/Employee Role Features (by function)

| Function | What they do in the system |
|---|---|
| **Cashier** | POS checkout, held sales, customer lookup/quick-create, receipt printing/resend, capped discounting (10% cap unless overridden), loyalty redemption |
| **Sales Manager** | Full invoice/quotation/payment/credit-note/sale-return lifecycle, discount override, customer CRM (interactions, segments, campaigns, seasons), reports |
| **Purchase Manager** | Purchase order lifecycle incl. approval/amendment, GRN 3-way match, landed-cost allocation, purchase returns/debit notes, supplier payments (incl. PDC tracking), expense approval, supplier statements |
| **Inventory Manager** | Item/category/brand/unit/warehouse masters, stock adjustments (with ₹50k approval threshold), transfers, physical verification, fabric-roll cutting, barcode generation/printing, reorder-driven PO creation |
| **Accountant** | Chart of accounts, journal entries/reversal, ledger, bank reconciliation, opening-balance wizard, GST filing (register/GSTR-1/3B/9/e-invoice/e-way-bill), fixed assets & depreciation, TDS |
| **Accountant Supervisor** | Everything above plus financial-year open/close, trial balance/P&L/balance sheet/cash-flow, bank-reconciliation finalize |
| **HR Manager** | Employee master (encrypted PAN/bank), attendance (incl. correction), leave approval, payroll run → calculate → approve → disburse, statutory (PF/ESI challans, Form 16), holiday calendar, garment-alteration order assignment |
| **Auditor** | Read-only access across financial/GST/reports plus both audit-log permission variants |
| **Data Officer** | Customer view + data-export permission only |
| **Staff (baseline role)** | View-only across invoices/quotations/customers/items/stock/attendance/leave |
| **Platform Operator** | Cross-tenant provisioning/suspension only (no visibility into any tenant's business data) |

---

## 4. Roles & Access Control

### 4.1 All Roles (seeded per tenant at provisioning, `apps/tenant-service/src/rbac/role-defaults.ts`)

`OWNER`, `SUPER_ADMIN` (functionally identical to OWNER — no behavioral distinction found besides the "last OWNER" deletion guard being OWNER-specific), `ADMIN` (everything except financial-year close, payroll processing, impersonation), `SALES_MANAGER`, `CASHIER`, `PURCHASE_MANAGER`, `ACCOUNTANT`, `ACCOUNTANT_SUPERVISOR`, `INVENTORY_MANAGER`, `HR_MANAGER`, `STAFF`, `AUDITOR`, `DATA_OFFICER`, plus the platform-only `PLATFORM_OPERATOR` (seeded once via migration, not part of the standard per-tenant set).

### 4.2 Permission Model

~298 fine-grained permission constants (`packages/shared-types/src/permissions.ts`), grouped by domain (organization, branch, warehouse, users, roles, customers, suppliers, items, invoices, quotations, payments, returns, credit notes, POS, purchase orders, GRN, expenses, accounting, GST, inventory/stock, HR, CRM, reports, dashboard, approvals/workflow, notifications, scheduler, import/export, search, business rules, price lists, overrides, config/audit, platform). Enforcement is via a `requirePermission()` Fastify preHandler on the backend and a matching `PermissionGate`/`usePermission()`/`PermissionRoute` layer on the frontend, all driven from one nav-to-permission map (`web-frontend/src/lib/navigation.ts`) that also feeds the command palette.

### 4.3 Known Gaps in the RBAC Model (verified in code, current as of 2026-07-08)

- **Dead permission constants** (defined, never checked anywhere): `APPROVAL_VIEW/APPROVE/REJECT` (approvals are actually scoped by `approverId = caller` instead), `BRANCH_CREATE/UPDATE/DELETE/ASSIGN_USER` (real routes use one catch-all `BRANCH_MANAGE`), `BRANCH_SCOPE_BYPASS` (planned record-level bypass feature, never implemented, granted to no role), `USER_ACTIVATE/DEACTIVATE/RESET_PASSWORD` (superseded by `USER_MANAGE`), `ORGANIZATION_UPDATE`/`ORGANIZATION_SETTINGS_UPDATE` (real writes use `ORG_SETTINGS_EDIT`), `WORKFLOW_CONFIG`, `CONFIG_VIEW/UPDATE`. In `event-service`, dedicated `DLQ_VIEW`/`SAGA_VIEW` constants exist but every admin route there actually gates on the broader `AUDIT_LOG_VIEW` instead.
- **Frontend/backend enforcement mismatches** (page is hidden client-side, but the backend has no matching check, so the data is reachable by any authenticated user via direct API call): `GET /branches` and `GET /organization` (tenant-service) — the latter means legal name, GSTIN/PAN, and **bank account details** are readable by any logged-in user of any role, not just admins.
- **`web-frontend/src/constants/permissions.ts` is a hand-mirrored copy** of the backend's permission list rather than a shared import — a standing drift risk between frontend gating and backend enforcement.
- **Orphaned route**: `admin/audit-logs` (`AuditLogPage`) is permission-gated but absent from the nav config and command palette — reachable only by typing the URL directly.
- **Tenant lifecycle enforcement is dead code**: `createTenantContextMiddleware` (blocks SUSPENDED/CLOSED tenants) is fully written but never registered in any service — a suspended or closed tenant's users can currently still log in and use the app. Documented as a known, deliberately unresolved gap in `ES-21_COMPLETION.md`.

---

## 5. Module-Wise Features

### 5.1 Sales (`sales-service`)
Quotations (draft→sent→viewed→accepted→converted/expired/rejected) → Invoices (draft→confirm [stock deduction + COGS + full GST breakdown]→cancel/duplicate/PDF) → Payments (cash/card/UPI/cheque/NEFT/RTGS/credit-note/advance/loyalty modes, race-safe allocation across invoices, cheque-bounce handling) → Sale Returns (auto-generates a Credit Note, optional physical-stock restoration) → Credit Notes (apply/refund). Delivery Challans (dispatch→convert-to-invoice). Full POS backend (sessions, checkout, held sales, quick-items, customer search, UPI VPA lookup, loyalty redeem). CRM: customer interactions/follow-ups, rule-based segments with live preview, SMS/WhatsApp/Email campaigns, festival/wedding "season" planner with stock/loyalty multipliers, customer health-score, birthday/anniversary auto-greetings. Loyalty program (₹100=1pt earn, 1pt=₹0.50 redeem, BRONZE/SILVER/GOLD tiers), feature-flagged. Supplier master also lives here (shared with purchase-service). No e-invoice/e-way-bill logic in this service itself (lives in `gst-service`).

### 5.2 Purchase (`purchase-service`)
Purchase Orders (draft→submit→approve [vendor credit-limit check, overridable]→amend [diff-tracked]→cancel) → GRN (3-way match against PO, price-variance flagging at 5% threshold, over-receipt guard, RCM self-assessment for unregistered suppliers) → Landed Costs (customs/freight/insurance/handling, allocated by value/qty/weight, feeds effective unit cost into inventory valuation) → Purchase Returns → Debit Notes. Supplier Payments (allocation, cheque-bounce reversal, post-dated-cheque tracking with 3-day-ahead alerting). Expenses (simple draft→submit→approve→pay, 6 categories).

### 5.3 Production / Job-Work (`production-service`)
Despite the name, **no BOM/manufacturing work-order engine exists** — actual scope is: **Job-Work** (outsourced stitching/processing: draft→materials-issued→in-progress→quality-check [per-piece pass/fail/rework]→complete [posts finished-goods stock-in + reject/scrap adjustments]→cancel), **Barcode/Label** generation (real EAN13 check-digit algorithm, CODE128/QR, batch printing, Redis-cached lookups), **Consignment Stock** (supplier-owned-until-sold tracking, FIFO settlement, explicitly excluded from the balance sheet until sold), and **Reorder Automation** (below-reorder-level report → auto-create draft POs grouped by supplier — GST on these auto-POs is hardcoded to 18% CGST+SGST regardless of actual item rate, a real gap vs. the rest of the app).

### 5.4 Inventory (`inventory-service`)
Items (variants, price lists, deterministic barcode generation, price-change history), Warehouses (one default per branch), Category/Brand/Unit masters. Stock ledger with two valuation methods (FIFO layer consumption oldest-first, or Weighted Average Cost) recomputed with row-level locking to avoid concurrency bugs. Stock Adjustments (8 reason types, ₹50k approval threshold), Stock Transfers (full dispatch/receive lifecycle with partial-receive support), Reservations (reserve/fulfill/release/expire-stale), Physical Verification (count→variance review→auto-generates a shortage adjustment), Fabric Rolls (feature-flagged: receive by meters, FIFO cutting), Stock Valuation report. Nightly reconciliation job compares ledger sum vs. the CQRS read-model projection and records discrepancies.

### 5.5 GST Compliance (`gst-service`)
GST rate/HSN master (seeded), CGST/SGST vs IGST auto-switch calculator, RCM flagging. GST Register + period summary. GSTR-1 (all sections incl. HSN summary; **Excel export is a stub returning JSON**). GSTR-2A reconciliation (import + auto-match ±1% tolerance). GSTR-3B (full ITC set-off algorithm in mandated IGST→CGST→SGST order; **RCM/import-of-goods/import-of-services/ITC-reversal buckets are always zero, not computed**). GSTR-9 annual return (Table 9 tax-paid is a documented simplification that mirrors Table 4 rather than tracking real cash/ITC discharge). Filing calendar with auto-generated due dates and pending/overdue tracking. **e-Invoice (IRN)**: real NIC IRP integration (sandbox/prod), auto-generate on B2B invoice confirm, auto-cancel within the 24h window (flags `CANCEL_REQUIRED_MANUALLY` after), retry-with-backoff, duplicate/invalid-GSTIN handling. **e-Way Bill**: real generation (blocked under ₹50,000), expiring-soon alerts.

### 5.6 Accounting (`accounting-service`)
Hierarchical Chart of Accounts (6 types, 18 sub-types, system-account protection). Double-entry Journal Engine (period-open check before every post, DB-trigger-enforced DR=CR balance, ULID IDs, reversal support). Account Ledger with running balance. Bank Reconciliation (import→match→finalize). Opening-Balance Wizard (5 steps: customers/suppliers/stock/accounts/cash-bank, simplified trial-balance check before lock — self-documented as simplified). Financial Year open/close (**closing entry posts a self-balancing pair to the same Retained Earnings account rather than a real Income Summary account** — a modeling simplification, self-documented in code). Live-computed Trial Balance / P&L / Balance Sheet / Cash Flow (**cash flow is direct-method operating-only; investing/financing sections are always empty**). Fixed Assets & Depreciation (SLM/WDV, monthly batch run, disposal with gain/loss posting). TDS (194C/194H/194J, Form 16A certificates, 26Q data). Tenant-configurable Posting Matrix (event→account rules). Consumes 13 Kafka event types from other services (already-computed GST/COGS amounts — no domain-logic duplication found in this pass, contrary to an earlier note; worth re-checking sales/inventory side specifically). No multi-currency, no departments/cost-centers.

### 5.7 HR & Payroll (`hr-service`)
Employee master with field-level AES encryption (PAN, bank account) plus HMAC lookup hashes; Aadhaar stored as last-4 only. Departments/designations. Attendance (manual/shift-based OT calc/correction with audit trail; biometric-import endpoint is a **no-op stub**). Leave management (gender restriction, document-required threshold, carry-forward cap, apply→approve auto-creates attendance rows, reject/cancel with balance rollback). Payroll: real Indian statutory engine — PF (12%/₹15k cap, EPS/EPF split), ESI (0.75%/3.25%, ≤₹21k gross only), Professional Tax (**hardcoded to Maharashtra slabs only**), Section 192 TDS (FY2024-25 new-regime slabs); loan deductions are hardcoded to zero (feature not built). Payslip PDF generation. Statutory filings (PF/ESI CSV export + filed-tracking, Form 16). **Garment-alteration order module** (a retail-tailoring-specific workflow beyond typical HR scope: state machine received→assigned→in-progress→QC→ready→delivered, tailor assignment, piece-rate work log feeding payroll, WhatsApp notification on ready), feature-flagged. Photo/document upload and bulk employee/attendance import are all **stub endpoints** (placeholder URL / instant `202 QUEUED` with no real processing).

### 5.8 Auth (`auth-service`)
RS256 JWT (900s TTL) + rotating opaque refresh tokens (SHA-256 hashed at rest) + per-device session tracking (self-service list/revoke). TOTP 2FA (encrypted secret, 10 single-use backup codes, enroll→confirm two-step, disable requires re-auth). Argon2id password hashing (12-char minimum, no complexity rules, no reuse history). Account lockout (5 attempts/15min) plus separate Redis-backed per-IP brute-force blocking (5 fails/10min → 1hr block). Business-rule engine (CRUD + simulate). User/role CRUD with self-escalation guard. **Full impersonation feature** (audit-logged) with no frontend entry point. Security audit log. Feature-flag admin API. No SSO/OAuth/SAML. Password-reset emails are **not actually sent** — the token is only logged (dev-stub, `TODO Milestone 0.6`).

### 5.9 Tenant/Organization (`tenant-service`)
9-step checkpointed tenant provisioning (record→shared-schema no-op→seed roles/permissions→seed workflow templates→create admin user + default Head-Office branch→configure S3 prefix→create ES indices [best-effort]→set 15 default feature flags→send welcome email [best-effort]) with suspend/activate/close lifecycle. Branch management (head-office singleton, GSTIN per branch). Organization settings (legal identity, bank details for POS UPI, logo, brand theme). Approval-workflow instance status/approve/reject (self-scoped by approver ID). Platform-level cross-tenant admin (separate permission/role track). Internal search-sync feed for user/role docs.

### 5.10 Event Infrastructure (`event-service`)
DB-backed **outbox relay** (`SELECT...FOR UPDATE SKIP LOCKED`, 500ms poll, 100-row batches, 5 retries then dead-lettered in place) publishing to dynamically-named Kafka topics (`erp.<event.type>`). Admin consoles for Event Store (replay), DLQ (**replay marks the row REPLAYED but does not actually re-publish to Kafka** — a real functional gap), Saga monitor (**the saga-orchestrator registry mechanism exists but zero saga types are actually registered anywhere in the codebase**, so retry/compensate always throws `SAGA_TYPE_NOT_REGISTERED`), Schema Registry (versioned schemas + compatibility checks), Projections (**rebuild is a `setTimeout` simulation, not a real replay job**), Performance baselines (hardcoded P95 targets for 4 endpoints).

### 5.11 Notifications (`notification-service`)
Real external integrations: SMS via MSG91, Email via SendGrid, WhatsApp via Meta Cloud API, plus DB-logged In-App (SSE poll, no WebSocket). Handlebars templates per (tenant, event-type, channel). Quiet-hours suppression for SMS (22:00–08:00 IST, hardcoded). Per-user channel preferences. SHA-256-derived idempotency keys with a DB unique constraint (retries are no-ops). 3-attempt exponential-backoff delivery retry.

### 5.12 Scheduler (`scheduler-service`)
BullMQ-based `JobRegistry` with Redis distributed locking (one pod runs a given job). **31 registered jobs** spanning accounting, inventory, GST, HR/payroll, sales/CRM, purchase, workflow-approval, search reindex/sync, and platform maintenance (outbox/audit-log/token/partition/import/notification-log/export cleanup). Import engine (CSV, per-entity Zod schemas, transform pipeline, rollback support). **Export-job API is a stub** — `/generate` instantly marks the job ready with a placeholder signed URL and no real file; `/download` returns two comment lines, not actual data. Several "simple" jobs (trial-balance snapshot, outstanding report, credit-limit review, etc.) are log-only stubs with no real body.

### 5.13 Search (`search-service`)
Elasticsearch-backed, **30 indexed entity types**, one index per tenant+entity, custom analyzers (synonyms, n-grams, Hindi stopwords). Real-time sync via ~55 mapped Kafka event types; branch-scoped for applicable entities; date-range filters; saved searches; click/latency analytics; dedicated DLQ view scoped to this service's own failed sync events. Backed by scheduler-service's weekly full-reindex + 10-minute incremental catch-up.

### 5.14 API Gateway (`api-gateway`)
**Entirely unimplemented.** `main.ts` is a 5-line placeholder (`export {}`); declared dependencies (`@fastify/http-proxy`, cors/helmet/rate-limit) are never imported. No routing, no JWT validation, no tenant injection happens here — every frontend calls each backend service directly on its own port. Deliberately excluded from the CI Docker build matrix.

### 5.15 Reporting & Analytics (`report-service`)
**60 registered report definitions** across Sales (18), Purchase (11), Inventory (13), Financial (14), GST (6), HR (6), Analytics (6) categories — all have real SQL implementations (none stubbed). Formats: JSON/CSV/Excel, sync or async (with run-history polling). PDF generation via Puppeteer + Handlebars (7 document templates incl. Tax Invoice, Payslip, P&L), India-locale helpers (amount-in-words). Scheduled/emailed reports via `croner` + `nodemailer` (real SMTP delivery, single-node, no distributed lock). Dedicated hand-written SQL dashboards (KPIs, 8 charts, alerts, live POS analytics sidebar). Number-series configuration engine for document numbering. AR/AP aging as dedicated legacy-style endpoints. Previously-reported "day-book/ledger column bug" is **confirmed fixed** (ES-26) — current code uses the correct schema columns.

### 5.16 Web Frontend (`web-frontend`)
Full SPA covering every module above: Dashboard, Sales/CRM, Inventory, Purchase, Accounting/GST, Production (job-work/consignment/reorder/barcode), Analytics/Reports, HR/Payroll, Settings, Security, the Distributed-Systems admin suite, and Platform Admin (tenants). Every route is permission-gated with a graceful in-page "Access Denied" rather than a redirect. Design-token-based theming (light/dark/high-contrast + reduced motion), tenant branding synced cross-tab, density modes, global command palette with saved searches and action-mode, feature-rich data grid (column visibility, bulk actions, sticky columns), Recharts-based charts, date-range pickers, `beforeunload`-only dirty-form guard, axe-core accessibility test harness (7 real a11y bugs found and fixed across development phases), keyboard shortcuts (incl. chord sequences). No offline capability here — that's POS-only by design.

### 5.17 POS Frontend (`pos-frontend`)
Full offline-capable checkout: cart, per-line/order discount (server-capped at 10% unless overridden), split-tender payment, UPI QR, loyalty redemption, held sales, customer search/quick-create, barcode (keyboard-wedge + camera via `@zxing/browser`), receipt print (3 sizes) + WhatsApp/email resend. Offline via Dexie/IndexedDB: reference-data mirror with delta sync, outbound queues for sales/customers with `operationId`-based idempotency (server dedupes, no duplicate invoices on retry), stock-conflict detection and resolution UI (adjust-and-requeue or cancel), Background Sync API where the browser supports it (Chromium/Android only — Firefox/Safari fall back to manual/online-event sync). Token refresh with proactive pre-expiry renewal. Server-side branch-isolation guard (**but no branch-picker UI** — branch/warehouse are hardcoded client-side). 2FA users are blocked from POS login (must use the main ERP app). Tenant branding synced across POS tabs only (not cross-origin with web-frontend). Returns/exchange deliberately reuse the web-frontend flow via a new-tab link rather than reimplementing it. **Shift/cash-drawer open/close/summary exists fully in the backend but has no reachable frontend UI at all** (`sessionId` hardcoded to `1`). No cash-drawer or weighing-scale hardware integration; thermal printing is via the browser print dialog only, not a native driver.

---

## 6. Workflow-Wise Features (end-to-end business processes)

1. **Order-to-cash**: Quotation → (client-driven) Invoice creation → Confirm (stock deduction, COGS, GST breakdown, e-invoice auto-trigger for B2B) → Payment (single or split-tender, allocation across invoices) → optional Sale Return → auto Credit Note → apply/refund.
2. **Procure-to-pay**: Purchase Order → approval (credit-limit gated) → amendment → GRN (3-way match, price-variance flag, RCM self-assessment for unregistered suppliers) → Landed Cost allocation → Supplier Payment (incl. PDC tracking) → optional Purchase Return → Debit Note.
3. **Retail POS sale (online or offline)**: cart build → discount → payment (incl. loyalty) → invoice create+confirm in one step → receipt → (if offline) queued with idempotent operationId → synced on reconnect → server-side stock-conflict detection if stock moved while offline.
4. **Job-work (outsourced manufacturing)**: order creation with raw-material requirement → material issue (stock deduction) → in-progress → per-piece quality check (pass/fail/rework) → completion (finished-goods stock-in + reject/scrap adjustment) → optional cancel with material restoration.
5. **Consignment stock**: receive (not yet owned, no financial posting) → sale (FIFO consumption by receipt date) → periodic settlement → supplier payable.
6. **Reorder automation**: nightly report of below-reorder-level items → grouped draft PO creation per supplier (with the noted hardcoded-18%-GST gap).
7. **Inventory integrity cycle**: stock adjustment (approval above ₹50k) / transfer (dispatch→receive, partial-receive) / physical verification (count→variance→auto shortage-adjustment) / nightly ledger-vs-projection reconciliation.
8. **GST compliance cycle**: transaction → GST ledger entry (via Kafka consumer) → period register/summary → GSTR-1/GSTR-3B preparation → GSTR-2A reconciliation against purchases → annual GSTR-9 → e-invoice IRN generation/cancellation → e-way bill generation, all tracked against an auto-generated filing calendar.
9. **Accounting close cycle**: opening-balance wizard (one-time) → ongoing journal posting (manual + event-driven from other services) → bank reconciliation → month/period lock → financial-year close (posts a simplified closing entry) → statutory reports (P&L/BS/TB/cash-flow).
10. **Payroll cycle**: salary-structure assignment → monthly run creation → calculate (statutory PF/ESI/PT/TDS per employee) → approve (posts accrual journal via event) → disburse (posts payable-clearing journal via event) → payslip generation/bulk-send.
11. **Leave cycle**: apply (validated against balance/gender/document rules) → approve (auto-fills attendance) / reject / cancel (balance rollback), with monthly accrual and year-end carry-forward as scheduled jobs.
12. **Garment alteration**: received → assigned to tailor → in-progress → quality check → ready (customer notified) → delivered (payment-sufficiency checked), feeding piece-rate payroll.
13. **Tenant lifecycle**: provisioning (9 checkpointed steps) → active operation → suspend/reactivate → close, all admin-triggered (automatic enforcement of suspended/closed state is not yet wired — see §8).
14. **Scheduled reporting**: cron-defined report subscription → periodic generation → email delivery with CSV/Excel attachment and unsubscribe link.
15. **Search indexing cycle**: domain event → Kafka → real-time index upsert, backed by weekly full-reindex + 10-minute incremental catch-up for drift correction.
16. **Approval workflow**: generic approval-instance engine used by at least the tenant-service approvals endpoints; approver sees pending items scoped to their own identity and approves/rejects.

---

## 7. Technical & Architectural Features

**Backend stack**: Fastify services, Drizzle ORM over a single shared Postgres 16, Zod request validation throughout, `@fastify/helmet` + `@fastify/cors` + `@fastify/rate-limit` (tenant-or-IP-keyed) registered in every real service.

**Event-driven architecture**: transactional outbox pattern (write to `outbox_events` in the same DB transaction as the business change) + a dedicated relay worker publishing to Kafka with `SKIP LOCKED` polling and bounded retries; dynamic topic naming derived from event-type strings; ~55+ distinct event types consumed across services.

**CQRS-style read models**: `projection_stock_level`, `projection_dashboard_daily`, `projection_customer_balance`, `projection_supplier_balance` maintained alongside the append-only ledgers/journals they summarize.

**Offline-first POS**: Dexie/IndexedDB local store, delta-sync reference data, idempotent write queue, Background Sync API (where supported), conflict-resolution UI for stock races.

**CI/CD** (`GitHub Actions`, 11 jobs): lint (incl. a guard against committed compiled artifacts) → type-check → test (real Postgres+Redis containers, ≥80% coverage gate) → Playwright E2E smoke (web-frontend, mocked API) → Docker build/push matrix for 14 of 15 services (api-gateway excluded) → dependency audit → Semgrep SAST → Trivy image scan → TruffleHog secrets scan → Snyk scan → a staging-deploy stage that is **currently a placeholder** (kubectl/helm commands commented out).

**Observability**: OpenTelemetry traces → Jaeger, Prometheus metrics (`prom-client`, custom `erp*` counters for invoices/sagas/DLQ depth/outbox lag/negative stock/auth brute-force) → Grafana, Winston structured JSON logs with correlation IDs (optional Loki transport, not part of the provisioned stack) — wired into 13 of 14 backend services.

**Security**: RS256 JWT + rotating refresh tokens, TOTP 2FA, Argon2id hashing, append-only audit logging, constant-time internal service-to-service API keys, field-level AES encryption + HMAC lookup hashing for PII (PAN, bank accounts) in HR, per-route rate limiting, full CI-side security scanning (SAST/container/secrets/dependency).

**Infrastructure — provisioned vs. actually used** (from `docker-compose.yml` against real code):
| Component | Status |
|---|---|
| Postgres primary | ✅ primary datastore |
| Postgres replica | ❌ read-replica client exists in code, zero callers |
| Redis | ✅ direct `ioredis` usage (auth, report, scheduler, tenant, production, inventory) — the dedicated `@erp/cache` package is a stub that throws "not implemented" |
| Kafka/Zookeeper | ✅ heavily used via raw `kafkajs` — the intended shared `event-bus-client` wrapper package is orphaned (no source, stale dist only) |
| MinIO | ✅ real S3-compatible storage client for attachments/exports/logos |
| Elasticsearch | ✅ Global Search feature, fully wired |
| Jaeger / Prometheus / Grafana | ✅ tracing/metrics wired in 13/14 services; Grafana is dashboard-only (expected) |
| Mailhog | ✅ default SMTP target in dev for scheduled-report emails |
| Vault | ❌ provisioned, config plumbing exists, **zero code calls it** — secrets are plain env vars |
| pgbouncer / exporters / backup | infra-only, not application-code concerns |

---

## 8. Hidden, Internal, Experimental, or Partially-Implemented Features

This section consolidates every gap found during the audit — real code that exists but doesn't fully do what its name/route/UI implies:

- **API Gateway does not exist** — a 5-line stub; every client calls services directly, port-by-port.
- **Saga orchestration is unwired** — the registry-based `SagaOrchestrator` mechanism is implemented but **no saga type is registered anywhere**, so the Saga Monitor's retry/compensate always fails with `SAGA_TYPE_NOT_REGISTERED`.
- **DLQ replay doesn't replay** — marks an item `REPLAYED` in the database without re-publishing it to Kafka.
- **Projection rebuild is simulated** — a `setTimeout`, not a real replay job (comment: "in production, would enqueue a BullMQ job").
- **Export-job API is a placeholder** — instantly "completes" with a fake signed URL; no file is ever generated.
- **`@erp/cache` package is a stub** that throws on use; every service that needs caching bypasses it with direct `ioredis` calls instead.
- **`event-bus-client` package is orphaned** — no source code, only a stale committed build output; every service rolled its own Kafka client instead.
- **Vault is provisioned but never integrated** — purely aspirational secrets management; real secrets are plain environment variables.
- **Postgres read-replica client exists but has zero callers** — all reads hit the primary.
- **Tenant suspension/closure is not enforced** — the middleware that would block a suspended/closed tenant's users exists, is exported, but is never registered in any service (documented, deliberate gap).
- **Impersonation has no frontend UI** — fully working backend + API client function, no button/route anywhere calls it.
- **Two live authorization mismatches**: `GET /organization` (exposes GSTIN/PAN/bank details to any authenticated user) and `GET /branches` have no backend permission check despite being permission-gated in the frontend nav.
- **GSTR-1 Excel export is a stub** returning JSON under a different label; GSTR-3B's RCM/import/ITC-reversal buckets are always zero; GSTR-9's tax-paid table is a simplification that mirrors liability rather than tracking actual discharge.
- **Accounting's year-end closing entry is a self-balancing placeholder** against Retained Earnings rather than a true Income Summary account; cash-flow report has no investing/financing sections; opening-balance lock check is explicitly a "simplified" trial-balance check.
- **HR**: biometric attendance import is a no-op stub; employee photo/document upload return placeholder URLs; bulk employee/attendance import just returns "queued" with no processing; Professional Tax is hardcoded to Maharashtra slabs only; payroll loan deductions are hardcoded to zero (feature not built).
- **Inventory**: `GET /items/:id/stock` is dead/stub code (superseded by the real stock endpoint elsewhere); warehouse-scoped valuation is a proportional estimate, not true per-warehouse costing.
- **Production/Reorder**: auto-created purchase orders use a hardcoded 18% CGST+SGST split regardless of the item's real GST rate or interstate status.
- **Auth**: password-reset emails are not actually sent (link is only logged) — an explicit dev-milestone TODO.
- **POS**: shift/cash-drawer open-close-summary is fully built server-side with no reachable frontend entry point at all; no branch-picker UI despite a server-side branch guard; no cash-drawer/weighing-scale hardware integration; thermal printing relies on the OS print dialog, not a native ESC/POS driver.
- **Tenant provisioning**: the S3/MinIO configuration step is a no-op that only records a prefix string; there's no automated way to bootstrap the very first platform-operator account.
- **Orphaned nav route**: an `admin/audit-logs` page exists and is permission-gated but is missing from the navigation config/command palette entirely.
- **Frontend permission constants are a hand-maintained mirror**, not a shared import from the backend's canonical list — a standing source of future drift.
- **CI's staging-deploy job is a placeholder** — the actual deployment commands are commented out.
- **Several scheduler jobs are log-only stubs** with no real implementation body (e.g. trial-balance snapshot, outstanding report, credit-limit review) despite being registered and "running" on schedule.
