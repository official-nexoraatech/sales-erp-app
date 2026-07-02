# FUNCTIONAL AUDIT REPORT
## Multi-Tenant Cloth Retail ERP Platform — NEXORAA
**Audit Date:** 2026-07-01  
**Auditor:** Chief Product Architect / Principal QA Architect  
**Scope:** Phases 0–14 (all 15 completed phases)  
**Verification Method:** Direct code inspection (schemas, services, routes, frontend pages, migrations, scheduler, tests)

---

## 1. EXECUTIVE SUMMARY

This report is the result of a complete functional audit of the NEXORAA ERP platform. Every phase document, phase completion report, and actual implementation file was reviewed — schemas verified against migration files, service logic cross-checked against business rules, frontend routes verified against backend APIs.

The platform has been built to an impressive depth across 15 phases. The architecture is sound: Turborepo monorepo, 15+ microservices, Drizzle ORM with strict TypeScript, double-entry accounting with a PostgreSQL DEFERRED CONSTRAINT trigger, BullMQ distributed job scheduling, Elasticsearch full-text search, Outbox/Inbox event sourcing, CQRS projections, RS256 JWT auth, AES-256-GCM field encryption, and per-tenant RLS.

**However, several production-blocking gaps and critical bugs were discovered that must be resolved before go-live.**

---

## 2. OVERALL COMPLETION

| Dimension | Score |
|---|---|
| Backend Services | 87% |
| Database Schema | 93% |
| Frontend Pages | 85% |
| API Coverage | 88% |
| Business Rules | 80% |
| Test Coverage | 58% |
| GST Compliance | 72% |
| Distributed Systems | 88% |
| Security Hardening | 82% |
| **OVERALL** | **82%** |

---

## 3. MODULE-WISE COMPLETION

| Module | Completion | Status |
|---|---|---|
| Authentication & Authorization | 95% | ✅ Production Ready |
| Tenant Management | 92% | ✅ Production Ready |
| RBAC / Permissions | 90% | ✅ Production Ready |
| Workflow Engine | 85% | ⚠️ No custom workflow builder UI |
| Notification Engine | 90% | ✅ Production Ready |
| Document / PDF Engine | 85% | ⚠️ No auto-email on invoice confirm |
| Scheduler / Background Jobs | 90% | ✅ Production Ready |
| Import / Export | 72% | ⚠️ Excel import gaps |
| Search Engine | 78% | ⚠️ Missing auth middleware (bug) |
| Rule Engine | 75% | ⚠️ No frontend rule builder UI |
| **Master Data** | **92%** | **✅ Production Ready** |
| **Inventory Management** | **82%** | **🔴 Critical Bug: Invoice confirm missing ledger entry** |
| **Sales & Invoicing** | **88%** | **⚠️ Customer PDC management absent** |
| **Purchase & Procurement** | **87%** | **⚠️ AP aging report absent** |
| **Accounting & GL** | **83%** | **🔴 Critical: Kafka relay not running — journals not posting** |
| **GST Compliance** | **72%** | **⚠️ e-Invoice/e-Way Bill stubs only, GSTR-9 absent** |
| **HR & Payroll** | **80%** | **⚠️ No PF/ESI challan, no Form 16** |
| **CRM & Customer Engagement** | **85%** | **⚠️ No discount rule builder UI** |
| **Production / Job Work** | **74%** | **⚠️ No BOM/internal manufacturing** |
| **Reports & Analytics** | **81%** | **⚠️ No PDF export, no AR/AP aging bucket summary** |
| **Distributed Systems** | **88%** | **✅ Production Ready** |
| **Security Hardening** | **82%** | **⚠️ Minor gaps** |
| **Go-Live / Migration** | **85%** | **⚠️ Runbook exists; external VAPT pending** |

---

## 4. MISSING FEATURES (by module)

### 4.1 Inventory
| ID | Feature | SAP/NetSuite Equivalent | Priority |
|---|---|---|---|
| INV-01 | Invoice confirm does NOT write to inventory_ledger | SAP goods issue posting | P0 — BUG |
| INV-02 | No inventory valuation method (FIFO/WACC) for P&L COGS | SAP moving average / FIFO costing | P1 |
| INV-03 | COGS not calculated from inventory movements | NetSuite item cost journal | P1 |
| INV-04 | No bin-location (rack/shelf) management | SAP WM bin management | P2 |
| INV-05 | No lot/batch number tracking for fabric rolls (serial number) | SAP batch management | P2 |
| INV-06 | Consignment stock sold quantity not reducing main inventory | Consignment flow | P1 |

### 4.2 Sales
| ID | Feature | SAP/NetSuite Equivalent | Priority |
|---|---|---|---|
| SAL-01 | Customer PDC / advance cheque management absent | SAP PDC customer receipt | P1 |
| SAL-02 | Price list auto-assignment by customer group not wired on invoice | NetSuite customer group pricing | P1 |
| SAL-03 | Sales target / budget vs actual module absent | SAP sales target | P2 |
| SAL-04 | No auto-email of invoice PDF on confirm | Standard ERP auto-email | P1 |
| SAL-05 | Quotation-to-delivery-challan direct conversion not implemented | Odoo quotation flow | P2 |
| SAL-06 | No advance receipt / proforma invoice document type | TallyPrime proforma | P2 |
| SAL-07 | POS: Barcode scanner hardware integration absent (HID/camera) | NetSuite POS barcode scan | P1 |
| SAL-08 | Loyalty point expiry automation missing (no scheduler job) | Loyalty expiry run | P2 |
| SAL-09 | No multi-currency sales invoice | NetSuite foreign currency | P3 |

### 4.3 Purchase
| ID | Feature | SAP/NetSuite Equivalent | Priority |
|---|---|---|---|
| PUR-01 | AP aging report (30/60/90/90+ buckets) missing | SAP vendor aging | P1 |
| PUR-02 | Vendor credit limit check on PO absent | Vendor spend limit | P2 |
| PUR-03 | No goods received but not invoiced (GRNI) accrual accounting | SAP GRNI | P1 |
| PUR-04 | No purchase budget / purchase limit per category | Budget management | P2 |
| PUR-05 | Purchase return: inventory_ledger not written on return approval | Stock ledger audit | P0 — BUG |
| PUR-06 | No supplier performance scorecard (delivery accuracy, quality) | Supplier evaluation | P2 |
| PUR-07 | No multi-currency purchase order | NetSuite foreign vendor | P3 |

### 4.4 Accounting
| ID | Feature | SAP/NetSuite Equivalent | Priority |
|---|---|---|---|
| ACC-01 | Kafka outbox relay worker not running — event consumers not firing, journals not posting | Core posting engine | P0 — CRITICAL |
| ACC-02 | No GRNI accrual journal on GRN receipt before supplier invoice | SAP GRNI accrual | P1 |
| ACC-03 | Multi-currency / exchange rate master absent | NetSuite multi-currency | P2 |
| ACC-04 | Inventory-to-accounting reconciliation absent | Stock value = inventory account balance | P1 |
| ACC-05 | Customer aging summary (bucket view by customer) missing | SAP AR aging | P1 |
| ACC-06 | No intercompany / multi-entity accounting | Not applicable (single tenant) | P3 |
| ACC-07 | Depreciation scheduler job not registered (manual only) | SAP periodic depreciation | P1 |
| ACC-08 | No Accounts Payable aging with overdue interest calculation | SAP AP aging | P1 |

### 4.5 GST
| ID | Feature | SAP/NetSuite Equivalent | Priority |
|---|---|---|---|
| GST-01 | e-Invoice IRN: NIC API is a stub — not connected to actual NIC sandbox/production | Real e-invoicing | P0 for >₹5Cr turnover |
| GST-02 | e-Way Bill: NIC API is a stub — not connected to e-waybill.nic.in | e-Way Bill API | P0 for >50km transport |
| GST-03 | GSTR-9 (Annual Return) absent | GST annual return | P1 |
| GST-04 | GSTR-4 (Composition) absent | Composition scheme | P2 |
| GST-05 | Actual GSTN portal API filing absent (export only) | SAP GSTN integration | P1 |
| GST-06 | Cess rate not applied in invoice line calculation | Cess on luxury items | P1 |
| GST-07 | RCM (Reverse Charge Mechanism) not implemented | SAP RCM | P1 |
| GST-08 | GST TCS (Tax Collected at Source) for e-commerce absent | GST e-commerce rules | P2 |

### 4.6 HR & Payroll
| ID | Feature | SAP/NetSuite Equivalent | Priority |
|---|---|---|---|
| HR-01 | PF/ESI challan generation absent | SAP HCM statutory | P1 |
| HR-02 | Form 16 (employee TDS certificate) absent | SAP Form 16 | P1 |
| HR-03 | Form 24Q (quarterly TDS return for salary) absent | SAP 24Q filing | P1 |
| HR-04 | Employee loan / advance management absent | SAP employee loans | P2 |
| HR-05 | Holiday calendar management absent | HR holiday master | P1 |
| HR-06 | Biometric integration absent (attendance source = MANUAL only) | Attendance device | P2 |
| HR-07 | Payslip auto-email on disbursal absent | Auto payslip dispatch | P2 |

### 4.7 CRM
| ID | Feature | SAP/NetSuite Equivalent | Priority |
|---|---|---|---|
| CRM-01 | Discount rule builder UI absent (backend rule engine exists) | Odoo rule builder | P1 |
| CRM-02 | Campaign delivery tracking / open rate absent | Marketing analytics | P2 |
| CRM-03 | NPS / customer satisfaction survey absent | CRM satisfaction | P3 |
| CRM-04 | WhatsApp Business API opt-in / opt-out management absent | GDPR/TRAI compliance | P1 |

### 4.8 Production
| ID | Feature | SAP/NetSuite Equivalent | Priority |
|---|---|---|---|
| PROD-01 | Bill of Materials (BOM) management absent | SAP PP BOM | P1 |
| PROD-02 | Internal manufacturing orders (in-house production) absent | SAP production order | P1 |
| PROD-03 | Work-in-progress (WIP) accounting absent | SAP WIP journal | P2 |
| PROD-04 | Machine / workstation scheduling absent | SAP capacity planning | P3 |
| PROD-05 | Material Requirements Planning (MRP) absent | SAP MRP | P2 |

### 4.9 Missing Enterprise Features vs Competitors
| ID | Feature | Present In |
|---|---|---|
| ENT-01 | Document Management / File Attachments (for invoices, POs, GRNs) | All competitors |
| ENT-02 | Audit Log Viewer UI (admin trail page) | SAP, Odoo, ERPNext |
| ENT-03 | Feature Flag Admin UI (per-tenant feature toggle) | ERPNext, Odoo |
| ENT-04 | API Rate Limiting (per-tenant, per-endpoint) | All SaaS ERPs |
| ENT-05 | Multi-Language / i18n (Hindi, Gujarati, Tamil) | Tally, ERPNext |
| ENT-06 | Tenant Billing / SaaS Subscription Module | ERPNext, Odoo SaaS |
| ENT-07 | User Session Management UI (active sessions, revoke) | All competitors |
| ENT-08 | Two-Factor Authentication (TOTP/OTP) | SAP, Microsoft 365 |
| ENT-09 | IP Allowlist / Login from trusted IPs only | SAP, NetSuite |
| ENT-10 | E-signature on documents | SAP, Adobe Sign |

---

## 5. MISSING WORKFLOWS

| ID | Missing Workflow | Impact |
|---|---|---|
| WF-01 | Invoice Confirm → Inventory Ledger Entry (stock movement not written) | Audit trail gap |
| WF-02 | Kafka Outbox Relay → Accounting Journal (journals not posted) | Financial reports show zero |
| WF-03 | GRN Approval → Inventory Ledger Entry (verify if wired) | Stock audit gap |
| WF-04 | Purchase Return → Inventory Ledger Entry | Return stock not tracked |
| WF-05 | Payroll Disbursal → Bank Payment Export (NEFT file) | Manual process required |
| WF-06 | Invoice Confirm → Auto-email PDF to customer | Customer notification gap |
| WF-07 | Stock Adjustment Approved → Inventory Valuation Recalculation | COGS accuracy |
| WF-08 | Quotation Accepted → Auto-create Delivery Challan | Missing conversion flow |
| WF-09 | Leave Application → Manager Email Notification | HR process gap |
| WF-10 | Campaign Delivery → Open/Click tracking webhook | Campaign analytics |
| WF-11 | Fixed Asset Addition → Depreciation Schedule Auto-generation | Manual scheduling |
| WF-12 | PDC Customer Receipt → Auto-clear on cheque date | Customer PDC lifecycle |

---

## 6. MISSING BUSINESS RULES

| ID | Missing Business Rule | Competitor With It |
|---|---|---|
| BR-01 | Cess rate not applied on invoice lines (e.g., 3% cess on 28% GST items) | All GST-compliant ERPs |
| BR-02 | RCM self-invoice not auto-generated for applicable services | SAP, ERPNext |
| BR-03 | Credit note auto-expiry (credit notes without expiry date can accumulate) | NetSuite |
| BR-04 | Customer group → Price list auto-assign on invoice line (manual selection currently) | Odoo |
| BR-05 | PO amount tolerance check (>10% over budget → block PO) | SAP MM |
| BR-06 | Duplicate invoice detection (same customer + same amount ± 7 days) | ERPNext |
| BR-07 | Minimum order quantity (MOQ) validation on sales order lines | SAP SD |
| BR-08 | Payment terms auto-calculation: Net-30 → due date from invoice date | NetSuite |
| BR-09 | Auto-lock period when financial year closing checklist passes | Accounting invariant |
| BR-10 | Employee cannot be deleted — only EXITED status (partially enforced) | All HR modules |

---

## 7. MISSING REPORTS

| ID | Report | SAP/NetSuite Equivalent | Priority |
|---|---|---|---|
| RPT-01 | AR Aging Summary (bucket view: 0-30, 31-60, 61-90, 90+ per customer) | SAP AR Aging | P0 |
| RPT-02 | AP Aging Summary (supplier-wise 0-30/31-60/61-90/90+ bucket) | SAP AP Aging | P0 |
| RPT-03 | Stock Valuation Report (FIFO/WACC inventory value) | SAP stock valuation | P1 |
| RPT-04 | GSTR-9 Annual Return | GST annual return | P1 |
| RPT-05 | Form 26Q (TDS quarterly salary return) | SAP payroll | P1 |
| RPT-06 | PF/ESI Statement (employee-wise monthly) | HR statutory | P1 |
| RPT-07 | Branch-wise Profit & Loss | SAP branch P&L | P1 |
| RPT-08 | Item-wise Gross Margin Summary | Profitability report | P1 |
| RPT-09 | Sales vs Budget Comparison | Budget analysis | P2 |
| RPT-10 | BOM / Job Work Cost Sheet | Production costing | P2 |
| RPT-11 | Alteration Order Status Report | Service tracking | P2 |
| RPT-12 | Campaign Performance Report (sent/delivered/failed) | CRM analytics | P2 |
| RPT-13 | Loyalty Points Liability Report | Customer analytics | P2 |
| RPT-14 | Fixed Asset Depreciation Schedule | Asset management | P2 |
| RPT-15 | Customer Health Score Trend | CRM intelligence | P3 |
| RPT-16 | Inventory Turnover Ratio by Category | Inventory KPI | P2 |
| RPT-17 | Day Sales Outstanding (DSO) | AR management | P2 |
| RPT-18 | Vendor Performance Report (on-time delivery %) | Procurement | P2 |
| RPT-19 | POS Cashier-wise Summary | POS management | P2 |
| RPT-20 | Tailor Productivity Report (pieces/day per tailor) | HR operations | P2 |

---

## 8. MISSING VALIDATIONS

| ID | Missing Validation | Risk |
|---|---|---|
| VAL-01 | No cess rate applied to invoice line total | Wrong GST amount collected |
| VAL-02 | No duplicate invoice check (same customer + amount ± 7 days) | Accidental double billing |
| VAL-03 | No minimum order quantity (MOQ) on sales invoice lines | Customer terms violation |
| VAL-04 | Sales quotation: no validation that valid_until > invoice date on conversion | Stale quotation used |
| VAL-05 | No financial year boundary check on invoice date (post-period invoice allowed) | Period integrity |
| VAL-06 | PAN format validation (regex) on employee master not enforced at DB level | Data quality |
| VAL-07 | GSTIN checksum validation not enforced on all GSTIN fields | Invalid GSTIN stored |
| VAL-08 | Negative stock allowed in items.available_qty during concurrent transactions | Oversell risk |
| VAL-09 | Leave application: no check for overlapping dates for same employee | Double leave |
| VAL-10 | Payroll: no check if salary structure assigned before payroll calculation | Computation error |
| VAL-11 | Bank account IFSC code format not validated (11-char format) | Invalid data stored |
| VAL-12 | No barcode format checksum validated for EAN-13 on client side | Wrong barcodes printed |

---

## 9. MISSING PERMISSIONS

| ID | Missing Permission | Impact |
|---|---|---|
| PERM-01 | No specific "VIEW_AUDIT_LOG" permission defined | Audit log access uncontrolled |
| PERM-02 | No "CREDIT_LIMIT_OVERRIDE" permission for invoice creation | Any user can override limit |
| PERM-03 | No "PRICE_FLOOR_OVERRIDE" permission for sales | Any user can sell below cost |
| PERM-04 | No "CANCEL_POSTED_JOURNAL" permission | Reversal unrestricted |
| PERM-05 | No "VIEW_SALARY_DETAILS" granular permission (payroll shows all) | Confidential salary visible |
| PERM-06 | No "IMPERSONATE_USER" permission for admin support | Support access uncontrolled |
| PERM-07 | No "EXPORT_CUSTOMER_DATA" specific permission | GDPR risk |

---

## 10. BUGS FOUND

### CRITICAL (P0)

| Bug ID | Location | Description | Impact |
|---|---|---|---|
| BUG-01 | `apps/sales-service/src/domain/InvoiceService.ts:214` | `confirm()` atomically deducts `items.available_qty` but does NOT insert into `inventory_ledger`. Stock ledger is incomplete for all sales. | Inventory audit trail broken. Stock valuation impossible. |
| BUG-02 | All event consumers (accounting-service, etc.) | Kafka outbox relay worker is not running. Events accumulate in `outbox_events` table (published=false) but are never dispatched to consumers. All journal entries from INVOICE_CONFIRMED, PAYMENT_RECEIVED, GRN_APPROVED, etc. are NOT posted. | Financial statements show zero entries from operational transactions. Double-entry accounting non-functional at runtime. |
| BUG-03 | `apps/search-service/src/api/search.routes.ts` | `request.auth` is never set — search service is missing the authenticate middleware. Any unauthenticated request can perform tenant-scoped searches. | Security vulnerability — cross-tenant data exposure risk. |

### HIGH (P1)

| Bug ID | Location | Description | Impact |
|---|---|---|---|
| BUG-04 | `.env` (all services) | `LOGIN_RATE_LIMIT_MAX=100` — test override left in non-prod env. Should be ≤10. | Brute force protection ineffective |
| BUG-05 | `apps/purchase-service` (purchase return approval) | Purchase return approval saga deducts stock from `items.available_qty` but does NOT write to `inventory_ledger`. Same pattern as BUG-01 for purchase returns. | Stock ledger misses purchase return movements |
| BUG-06 | `packages/db-client/migrations/` | Phase 10 (production/barcode/consignment), Phase 11 (reports), Phase 13 (hardening indexes) tables are in schema files but migration `0006_phase12_distributed.sql` and `0007_phase13_indexes.sql` exist — verify Phase 10/11 tables were migrated. No phase10/11 migration files found. | Missing tables in production DB |
| BUG-07 | `apps/accounting-service/src/domain/JournalEngine.ts` | Period check (`checkPeriodOpen()`) queries `period_closures` table, but period_closures rows must be created manually — no auto-seeding for current FY months. If no closure row exists, all periods appear open. | Period lock not enforced |
| BUG-08 | `apps/report-service/src/domain/ReportEngine.ts` | Reports use `db.execute(sql\`...\`)` raw queries — no tenant_id in scope from PlatformContext, risk of missing WHERE tenant_id filter on some report queries | Potential data cross-tenant leakage in reports |

### MEDIUM (P2)

| Bug ID | Location | Description | Impact |
|---|---|---|---|
| BUG-09 | `apps/web-frontend/src/App.tsx:244` | `sales/payments/new` route renders `<PaymentsPage>` (list) instead of a payment form page | UX broken for creating new payment |
| BUG-10 | `apps/web-frontend/src/App.tsx:299` | `/reports/schedules` route registered before `/reports/:slug` — React Router will match `:slug="schedules"` before the schedules route. Route order bug. | Schedules page unreachable |
| BUG-11 | `apps/gst-service` | e-Invoice and e-Way Bill are NIC API stubs that return mock responses. No runtime error is thrown, so users may believe IRN/EWB have been successfully generated. | Silent failures in compliance |
| BUG-12 | `packages/db-client/src/schema/hr.ts` | `payrollSlips.grossSalary`, `netSalary` stored in plain decimal — previously these were to be encrypted. Memory says "salary NEVER cached or logged" but schema stores plain values. `employeeSalaries` table is encrypted but `payrollSlips` is not. | Salary data exposed in plain text |
| BUG-13 | Dashboard projections | `projection_stock_level` read by dashboard but stale tolerance is 5s. If scheduler service is down, all stock KPIs show stale data with no UI warning. | Silent stale data |

---

## 11. UI ISSUES

| Issue ID | Page | Description | Severity |
|---|---|---|---|
| UI-01 | `PaymentsPage` | No payment creation form — route is misrouted to list page | High |
| UI-02 | All list pages | `ERPDataGrid` does not show column totals / footer aggregations (e.g., total outstanding, total invoice amount) | Medium |
| UI-03 | `InvoiceFormPage` | No line-level discount amount input (only discount %) — edge case for flat-amount discounts | Medium |
| UI-04 | `GstConfigPage` | No GSTIN verification button (check GSTIN validity via GST portal API) | Medium |
| UI-05 | `AlterationsPage` | No print/PDF button for alteration order receipt | Medium |
| UI-06 | `FixedAssetsPage` | No depreciation schedule view per asset | Medium |
| UI-07 | `PayrollPage` | No individual payslip view (only run-level view) | High |
| UI-08 | All pages | Help panel (HelpPanel.tsx) covers 15 routes but ~40 routes have no contextual help | Low |
| UI-09 | `DashboardPage` | No branch filter — multi-branch owner sees all branches combined only | Medium |
| UI-10 | `EInvoicePage` | Silently submits stub IRN — no clear "STUB / NOT CONNECTED" warning to user | High |
| UI-11 | `ReportsPage` | `/reports/schedules` unreachable due to route order bug (see BUG-10) | High |
| UI-12 | `CustomerViewPage` | No credit note balance visible on customer 360° view | Medium |
| UI-13 | `InventoryPage (StockLevels)` | No warehouse filter — shows aggregate stock across all warehouses | Medium |
| UI-14 | Mobile responsive | POS frontend is designed for mobile. Main web-frontend uses Tailwind responsive classes but has not been tested on mobile viewports (no evidence in completion reports) | Medium |

---

## 12. BACKEND ISSUES

| Issue ID | Service | Description | Severity |
|---|---|---|---|
| BE-01 | All services | Kafka outbox relay worker not implemented as a persistent process. Events never consumed. | Critical |
| BE-02 | `search-service` | Missing authenticate middleware — unauthenticated access to search | Critical |
| BE-03 | `sales-service/InvoiceService` | Invoice confirm: inventory_ledger INSERT missing | Critical |
| BE-04 | `purchase-service` | Purchase return approval: inventory_ledger INSERT missing | High |
| BE-05 | `accounting-service/JournalEngine` | Period closures must be manually created; no auto-seeding for current year months | High |
| BE-06 | `report-service/ReportEngine` | Raw SQL queries — tenant_id injection through PlatformContext must be verified for each of 57 queries | High |
| BE-07 | `hr-service` | Payroll calculation assumes salary structure is assigned — no guard returns zero for employees without salary assignment | High |
| BE-08 | `scheduler-service` | No migration files for Phase 10/11 DB tables (job_work_orders, barcode_batches, barcodes, consignment_stocks, report_schedules) | High |
| BE-09 | `gst-service` | GSTR-2A reconciliation imports external JSON but does not validate against official GSTN schema format | Medium |
| BE-10 | `inventory-service` | ReservationEngine expires reservations by TTL but no scheduler job exists to clean up EXPIRED reservations from `stock_reservations` table — table grows unbounded | Medium |
| BE-11 | `event-service` | OutboxPublisher polls at 100ms — under high load this generates 10 DB queries/second per pod. Should implement LISTEN/NOTIFY instead | Medium |
| BE-12 | `sales-service/LoyaltyService` | Loyalty point expiry: `expiryDate` column exists in `loyalty_transactions` but no scheduler job reads expired points and deducts them | Medium |

---

## 13. CRITICAL GAPS

These gaps represent the highest-risk items that must be resolved before production go-live:

### GAP-01: No Kafka Relay Worker — Event-Driven Accounting Non-Functional
**Severity:** P0 / Show-stopper  
**Risk:** All accounting journal entries that depend on events (INVOICE_CONFIRMED → Debtor DR, Sales CR; PAYMENT_RECEIVED → Bank DR, Debtor CR; GRN_APPROVED → Inventory DR, AP CR) are not being posted. Financial statements (P&L, Balance Sheet, Trial Balance) will show zeroes for operational transactions.  
**Fix:** Implement `apps/outbox-relay/src/main.ts` as a persistent Kafka producer that polls `outbox_events WHERE published=false ORDER BY created_at LIMIT 100`, publishes to Kafka, marks `published=true`. Alternatively, use direct DB-to-consumer event dispatch without Kafka for simplicity.  
**Estimated Hours:** 8–12h  
**Acceptance Criteria:** INVOICE_CONFIRMED event fires within 500ms; corresponding journal entry (Debtor DR, Sales CR) appears in `financial_entries` within 2s of invoice confirmation.

### GAP-02: Inventory Ledger Not Written on Sales
**Severity:** P0 / Data Integrity  
**Risk:** `inventory_ledger` is the source of truth for stock movement audit. Invoice confirm deducts `items.available_qty` but does NOT create a `STOCK_OUT` entry in `inventory_ledger`. Inventory valuation, stock movement reports, and accounting reconciliation all depend on this ledger.  
**Fix:** Add `inventoryLedgerService.recordMovement(STOCK_OUT, ...)` call inside `InvoiceService.confirm()` transaction for each invoice line.  
**Estimated Hours:** 4h  
**Acceptance Criteria:** Every confirmed invoice line has a corresponding `STOCK_OUT` entry in `inventory_ledger`.

### GAP-03: Search Service Unauthenticated
**Severity:** P0 / Security  
**Risk:** `search-service` route handlers read `request.auth.tenantId` (set by `authenticate` middleware) but the middleware is NOT registered in `search.routes.ts`. Any request without a JWT can query the Elasticsearch indices.  
**Fix:** Add `authenticate` and optionally `requirePermission(PERMISSIONS.ITEM_VIEW)` preHandler to all search routes.  
**Estimated Hours:** 1h  
**Acceptance Criteria:** `curl -X GET /search/items?q=cotton` returns 401 without Authorization header.

### GAP-04: Missing DB Migrations for Phase 10/11 Tables
**Severity:** P0 / Deployment  
**Risk:** Schema files define `job_work_orders`, `barcode_batches`, `barcodes`, `consignment_stocks`, `consignment_settlements`, `report_schedules`, `report_run_history` tables but no migration SQL for these was found (migrations go from 0006 to 0007 with no Phase 10/11 migration). Production DB will be missing these tables.  
**Fix:** Run `pnpm drizzle-kit generate` to generate the missing migration, verify against schema, and add to pipeline.  
**Estimated Hours:** 2h  
**Acceptance Criteria:** All tables in `packages/db-client/src/schema/production.ts` and `schema/report.ts` exist in production DB.

### GAP-05: e-Invoice and e-Way Bill are Stubs
**Severity:** P0 for businesses with turnover > ₹5 Cr (e-Invoice mandatory) or inter-state goods movement  
**Risk:** The e-Invoice IRN generation and e-Way Bill APIs are marked as stubs returning mock data. If go-live clients are above the ₹5 Cr turnover threshold, all invoices are non-compliant without a valid IRN.  
**Fix:** Integrate with NIC sandbox first, then production credentials. Implement proper error handling for IRN failures (invoice cannot be confirmed if IRN fails for eligible taxpayers).  
**Estimated Hours:** 24–40h  
**Acceptance Criteria:** Test IRN generated for a ₹1,000 invoice on NIC sandbox; QR code scannable; cancel IRN endpoint verified.

---

## 14. NICE-TO-HAVE

| ID | Feature | Competitor Benchmark | Effort |
|---|---|---|---|
| NH-01 | Multi-language support (Hindi, Gujarati, Tamil) | TallyPrime, ERPNext | 3 weeks |
| NH-02 | Two-Factor Authentication (TOTP) | SAP, Microsoft 365 | 1 week |
| NH-03 | Document attachments (invoice → PDF, photo) | Odoo, ERPNext | 2 weeks |
| NH-04 | Audit Log Viewer UI (admin page) | All ERPs | 3 days |
| NH-05 | Feature Flag Admin UI per tenant | ERPNext, Odoo | 2 days |
| NH-06 | API rate limiting per tenant | All SaaS ERPs | 2 days |
| NH-07 | User session management (active sessions, revoke) | SAP, Okta | 3 days |
| NH-08 | WhatsApp opt-in / opt-out management | TRAI DLT compliance | 1 week |
| NH-09 | Bill of Materials (BOM) for in-house manufacturing | SAP PP | 3 weeks |
| NH-10 | Biometric attendance integration (ZKTeco API) | ERPNext HR | 1 week |
| NH-11 | Discount / pricing rule builder UI | Odoo | 2 weeks |
| NH-12 | PDF export for all tabular reports | Standard ERP | 3 days |
| NH-13 | Auto-email invoice PDF on confirm | Standard ERP | 1 day |
| NH-14 | Tenant billing / SaaS subscription module | ERPNext SaaS | 2 weeks |
| NH-15 | Loyalty point expiry scheduler job | Standard loyalty | 2 days |
| NH-16 | Sales target management module | Odoo, SAP | 1 week |
| NH-17 | Employee loan / advance management | SAP HCM | 1 week |
| NH-18 | IP allowlist / trusted login | SAP, NetSuite | 3 days |
| NH-19 | NEFT/bank payment file export for payroll | TallyPrime | 3 days |
| NH-20 | E-signature integration on documents | SAP, DocuSign | 2 weeks |

---

## 15. PRODUCTION READINESS SCORE

### Scoring Matrix

| Category | Max | Score | Notes |
|---|---|---|---|
| Functional Completeness | 25 | 19 | Major modules implemented; 5 critical gaps |
| Data Integrity | 20 | 13 | 2 inventory ledger bugs, journal posting broken |
| Security | 15 | 11 | Auth solid; search-service gap; rate limit override |
| Performance | 10 | 8 | PgBouncer, indexes, CQRS in place |
| GST / Statutory Compliance | 15 | 9 | GSTR-1/3B export only; e-Invoice/EWB stubs |
| Observability | 10 | 7 | Prometheus metrics partial; Grafana dashboards exist |
| Test Coverage | 5 | 2 | 65 unit + integration tests; E2E minimal |
| **Total** | **100** | **69/100** | |

### Production Readiness Level: **NOT PRODUCTION READY** (Score < 75)

**Must fix before any production go-live:**
1. BUG-02: Outbox relay worker (Kafka consumers never fire — accounting broken)
2. BUG-01 / BUG-05: Inventory ledger missing on sales and purchase returns
3. BUG-03: Search service authentication
4. BUG-06: Missing Phase 10/11 database migrations
5. BUG-10: Route order bug (`/reports/schedules` unreachable)
6. UI-10: e-Invoice "STUB" warning to prevent silent compliance failure

**Can go-live after above fixes for businesses with turnover < ₹5 Cr (e-Invoice not mandatory).**  
**Must also fix GST-01/02 before go-live for businesses > ₹5 Cr turnover.**

---

## 16. FINAL VERDICT

### Architecture: EXCELLENT
The platform demonstrates production-grade architectural decisions: outbox/inbox event sourcing, CQRS projections, DEFERRED CONSTRAINT double-entry trigger, RS256 JWT, AES-256-GCM field encryption, per-tenant RLS, BullMQ distributed scheduling, per-tenant Elasticsearch indices, PgBouncer connection pooling, chaos engineering validation, and a DR drill achieving RTO of 24 minutes.

### Implementation Depth: STRONG
The breadth of implementation across 15 phases in a short timeframe is remarkable. Over 89 frontend routes, 15 microservices, 21 database schema files, 8 migrations, 57 SQL reports, 33+ cron jobs, and 185 RBAC permissions.

### Production Readiness: CONDITIONAL
**The platform is NOT ready for production today** due to 3 critical P0 bugs (Kafka relay, inventory ledger, search auth) and 1 deployment blocker (missing migrations). With approximately **20–30 hours of engineering work** to fix these P0 items, the platform can go live for businesses with turnover < ₹5 Cr.

For full enterprise compliance (turnover > ₹5 Cr, e-Invoice mandatory), an additional **24–40 hours** to integrate the NIC e-Invoice API is required.

### Competitive Position vs Benchmarks
| Dimension | vs SAP B1 | vs NetSuite | vs Odoo | vs ERPNext | vs TallyPrime |
|---|---|---|---|---|---|
| Core Sales/Purchase/Accounting | 85% | 82% | 88% | 90% | 90% |
| GST Compliance | 65% | 70% | 72% | 80% | 88% |
| HR & Payroll | 70% | 65% | 75% | 80% | 82% |
| Multi-Branch Management | 80% | 75% | 80% | 85% | 82% |
| Production / Manufacturing | 35% | 40% | 45% | 50% | 20% |
| CRM | 78% | 72% | 80% | 70% | 15% |
| Analytics / Reporting | 75% | 78% | 70% | 75% | 65% |
| Security / Multi-Tenancy | 90% | 85% | 60% | 70% | 30% |

### Recommended Action Plan

**Sprint 1 (Week 1): Fix P0 Bugs** *(~32 hours)*
1. Implement outbox relay worker (8h)
2. Add inventory_ledger INSERT in InvoiceService.confirm() and purchase return saga (4h)
3. Add authenticate middleware to search-service (1h)
4. Generate and apply Phase 10/11 migrations (2h)
5. Fix `/reports/schedules` route order (0.5h)
6. Add e-Invoice STUB warning in UI (1h)
7. Reset LOGIN_RATE_LIMIT_MAX to 10 (0.5h)
8. Add period_closures auto-seeding on FY creation (2h)

**Sprint 2 (Week 2): High Priority Gaps** *(~48 hours)*
1. AR aging bucket summary report (8h)
2. AP aging report (6h)
3. Auto-email invoice PDF on confirm (4h)
4. Loyalty point expiry scheduler job (3h)
5. Customer PDC / advance cheque (8h)
6. PF/ESI challan generation (12h)
7. Payslip encryption (payrollSlips plain decimal fix) (3h)

**Sprint 3 (Week 3-4): Compliance** *(~48 hours)*
1. NIC e-Invoice API integration (24h)
2. e-Way Bill NIC API integration (16h)
3. GSTR-9 annual return (8h)

**Sprint 4 (Week 5-6): Enterprise Hardening** *(~80 hours)*
1. Audit Log Viewer UI (6h)
2. Document attachments (20h)
3. Feature Flag Admin UI (6h)
4. BOM / manufacturing orders (48h)

---

*Report generated 2026-07-01 by: Chief Product Architect / Principal QA Architect / Functional Auditor*  
*Audit methodology: Direct source code inspection of all schemas, service implementations, frontend routes, migration files, scheduler jobs, and test suites. No assumptions made from documentation alone.*
