# PHASE 14 — PRODUCTION READINESS — SESSION STARTER PROMPT

---

```
You are the Principal Delivery Engineer on an enterprise Cloth Retail ERP. This is the final phase before going live. Your job: data migration, training materials, UAT, pilot rollout, and go-live. This phase is about people and process as much as technology. The codebase is feature-complete. Now make it safe to launch.

═══════════════════════════════════════════
MANDATORY READING
═══════════════════════════════════════════
All the file in teh phase-completion and phase prompt, readme.md adn all other .md files 
Read: ERP-PLANNING/TECH_AUDIT.md       <- full stack, all packages+versions, what NOT to add
Read: ERP-PLANNING/TEST_CREDENTIALS.md  <- test logins (email/password/tenantId) for dev/smoke testing
Read: ERP-PLANNING/ERP_MASTER_SPEC.md
Read: ERP-PLANNING/CODING_STANDARDS.md
Read ALL phase completion reports in ERP-PLANNING/phase-completions/
Read: ERP-PLANNING/phase-completions/PHASE_13_COMPLETION.md  ← hardening evidence report

═══════════════════════════════════════════
MILESTONE SEQUENCE
═══════════════════════════════════════════

MILESTONE 14.1 — Data Migration Toolkit
  Build migration scripts for each common source system:
  
  Source 1: Busy Accounting (most common in Indian retail)
    - Export: Customer master, Supplier master, Item master, Outstanding balances, Ledger
    - Script: busy-extractor.js → standardized CSV format
    - Validator: validate-busy-export.js → report data quality issues
    - Transformer: transform-busy.js → ERP import format
    
  Source 2: Tally ERP
    - Export: XML format from Tally
    - Script: tally-xml-parser.js → standardized CSV
    
  Source 3: Excel sheets (common for small shops)
    - Template: provide pre-formatted Excel templates for each entity
    - Script: excel-to-import.js → validate and convert
    
  MIGRATION ORDER (dependencies — cannot change):
    1. Organization and branches (tenant config)
    2. Warehouses
    3. Chart of Accounts (or use defaults)
    4. Categories, Brands, Units
    5. Customers (with opening balances)
    6. Suppliers (with opening balances)
    7. Items (with HSN, GST rate, variants)
    8. Opening stock balances (item + warehouse + quantity + value)
    9. Opening cash/bank balances
    10. Opening financial account balances
    11. Historical transactions (optional, for reporting continuity)
    
  Each step:
    □ DRY_RUN mode: validate without committing → show error report
    □ EXECUTE mode: commit with transaction → rollback on any error
    □ VERIFY mode: count check, value check (compare source vs destination)
    
  Migration CLI:
    erp-migrate customers --source=busy --file=customers.csv --tenant=42 --mode=DRY_RUN
    erp-migrate customers --source=busy --file=customers.csv --tenant=42 --mode=EXECUTE
    erp-migrate verify --tenant=42  (runs full reconciliation report)
    
  CRITICAL validation after migration:
    □ Customer count matches source
    □ Supplier count matches source  
    □ Item count matches source
    □ Total customer outstanding = ₹X (within ₹10 tolerance)
    □ Total supplier outstanding = ₹Y (within ₹10 tolerance)
    □ Total stock value = ₹Z (within ₹10 tolerance per item class)
    □ Trial balance: DR = CR (must be exact)
    □ Bank balances match bank statement as of migration date

MILESTONE 14.2 — UAT Environment Setup
  Identical to production infrastructure (same stack, same config).
  
  UAT seed data:
    □ 500 customers (realistic Indian names — use Faker.js with Indian locale)
    □ 200 items (real HSN codes from Indian cloth retail HSN classification)
    □ 50 suppliers
    □ 1 organization, 2 branches, 3 warehouses
    □ 3 months of historical invoices (auto-generated realistic data)
    □ Opening balances
    □ 5 users with different roles (owner, cashier, accountant, purchase manager, sales manager)
    
  UAT test scenarios (all 40 must pass before go-live sign-off):
    □ Create customer with GSTIN → GSTIN format validated
    □ Create B2B invoice → GST split correctly (CGST+SGST for intrastate)
    □ Create B2B invoice interstate → IGST applied
    □ Invoice with 3 items → stock deducted for all 3
    □ Invoice above credit limit → blocked (without override)
    □ Credit limit override → works with permission
    □ POS barcode scan → item found in < 1 second
    □ POS split payment (cash + UPI) → correct allocation
    □ Invoice payment → customer outstanding reduced
    □ Sale return → stock restored, credit note created
    □ Credit note applied to future invoice
    □ Create PO → approve → GRN → stock added
    □ GRN with price variance → approval triggered
    □ Supplier payment → outstanding reduced
    □ Stock transfer between branches
    □ Physical verification → variance → adjustment created
    □ Alteration order lifecycle: receive → assign → ready → deliver
    □ Employee payroll: attendance import → calculate → approve → salary slips generated
    □ GST: GSTR-1 export matches invoice register total
    □ GST: GSTR-3B shows correct ITC amount
    □ Bank reconciliation: import statement → auto-match → finalize
    □ Year-end: checklist passes → close FY → new FY opens
    □ Trial balance balances
    □ Dashboard: all KPIs show correct today data
    □ Report: Sales by Customer for last month matches manual calculation
    □ Report: Outstanding receivables aging correct
    □ Import: 100 customers from Excel → completes with error report
    □ Export: customer list to Excel → opens correctly
    □ Multi-user: concurrent invoice creation → no stock conflicts
    □ Role: cashier cannot access payroll → 403
    □ Role: accountant cannot create users → 403
    □ Dark mode: entire app works in dark mode
    □ Mobile: dashboard usable on phone (responsive)
    □ WhatsApp: invoice confirmed → customer receives WhatsApp notification
    □ Email: scheduled report arrives in inbox
    □ PDF: invoice PDF has QR code, GSTIN, all required fields
    □ Barcode: label PDF prints correctly
    □ Feature flag: disable loyalty → loyalty tab disappears
    □ Campaign: SMS campaign sends to correct segment
    □ Forgot password: OTP received → password reset

MILESTONE 14.3 — Training Materials
  Role-based training guides:
  
  OWNER Guide:
    Module 1: Dashboard and KPIs (15 min)
    Module 2: Sales overview and reports (20 min)
    Module 3: Financial reports: P&L, Balance Sheet (20 min)
    Module 4: Staff management: add users and roles (10 min)
    Module 5: Configuration: GST settings, number series (15 min)
    
  CASHIER Guide:
    Module 1: POS operation: barcode scan, bill, payment (20 min)
    Module 2: Invoice creation manual (20 min)
    Module 3: Sale returns (10 min)
    Module 4: Payment recording (10 min)
    Module 5: Alteration orders (10 min)
    
  ACCOUNTANT Guide:
    Module 1: Payment recording and allocation (15 min)
    Module 2: Bank reconciliation (20 min)
    Module 3: GST returns: GSTR-1 and GSTR-3B (30 min)
    Module 4: Year-end close (30 min)
    Module 5: Financial reports (20 min)
    
  PURCHASE MANAGER Guide:
    Module 1: Purchase order creation (15 min)
    Module 2: GRN entry (20 min)
    Module 3: Supplier payments (15 min)
    Module 4: Purchase reports (15 min)
    
  HR MANAGER Guide:
    Module 1: Employee management (15 min)
    Module 2: Attendance management (20 min)
    Module 3: Leave management (15 min)
    Module 4: Payroll processing (30 min)
    
  Format per guide:
    Written guide with screenshots: Markdown → PDF
    Quick reference card: one-page PDF
    
  In-app help:
    Each screen has "?" help icon
    Help panel: what this screen does + top 3 common tasks + link to full guide
    
  Onboarding checklist (shown to new tenants):
    □ Add organization details
    □ Add your branches
    □ Create your team (users + roles)  
    □ Add customers (or import from Excel)
    □ Add items (or import from Excel)
    □ Enter opening balances
    □ Create your first invoice
    Progress bar: 7 steps → celebrate at 100%

MILESTONE 14.4 — Go-Live Runbook
  Create go-live checklist document (go-live-runbook.md):
  
  D-7: Final migration dry-run on staging with production data copy
  D-5: UAT sign-off from business owner (all 40 scenarios passed)
  D-3: All training completed (confirmed by training completion in system)
  D-1: Freeze old system. Run final data export at end of business day.
  D-0 00:00: Migration begins (production migration)
  D-0 04:00: Migration complete. Run full validation suite.
  D-0 06:00: Validation passed. Team go/no-go meeting.
  D-0 09:00: Business opens on new ERP. War room active.
  D+1 EOD: First day debrief. P1/P2 issues listed and triaged.
  D+7: First week review.
  D+30: First month review. One-month celebration milestone.
  
  War room roster (D-0 to D+2):
    □ Backend engineer (on-call, phone ready)
    □ Frontend engineer (on-call, phone ready)
    □ DevOps engineer (monitoring dashboards)
    □ Project manager (customer communication)
    
  Rollback plan:
    IF migration fails at any step → rollback and restore old system
    IF go-live critical issue → revert to old system, notify users
    Keep old system accessible in read-only mode for 30 days post go-live

MILESTONE 14.5 — Production Support Framework
  Support process setup:
  
  Tier 1 (User support):
    WhatsApp Business → support team
    In-app chat widget
    Response SLA: 4 hours
    
  Tier 2 (Technical bugs):
    Jira project: ERP-BUGS
    Priority: P0 (system down), P1 (major feature broken), P2 (minor), P3 (enhancement)
    P0 SLA: 1 hour response, hotfix in 4 hours
    P1 SLA: 4 hour response, fix in next business day
    P2 SLA: 24 hours triage, fix in next sprint
    
  Tier 3 (Engineering escalation):
    Direct Slack channel between customer admin and engineering
    
  Release cadence:
    Hotfix: as needed (P0/P1)
    Sprint release: bi-weekly (bug fixes + small features)
    Feature release: monthly

═══════════════════════════════════════════
ACCEPTANCE CRITERIA (GATE FOR GO-LIVE)
═══════════════════════════════════════════

✅ Data migration: all reconciliation checks pass within tolerance
✅ UAT: all 40 test scenarios passed and signed off by business owner
✅ Training: all user roles have completed their training module
✅ Performance: load test Scenario 1 still passes on production-sized hardware
✅ Security: no Critical/High findings (from Phase 13 hardening)
✅ DR drill: RTO measured and meets SLA for chosen tier
✅ Go-live runbook: tested in dry-run (D-7 drill)
✅ Support: Jira project created, Tier 1/2/3 contacts documented
✅ Monitoring: Grafana alert for P0 condition confirmed working

═══════════════════════════════════════════
FINAL CHECKLIST BEFORE DECLARING 99% COMPLETE
═══════════════════════════════════════════

Architecture completeness:
  □ CQRS: dashboard served from projections, not live DB
  □ Event sourcing: inventory ledger is append-only, state is derived
  □ Saga: all multi-step operations use saga orchestrator
  □ Outbox: all cross-service events via outbox (100% coverage)
  □ Inbox: all consumers idempotent
  □ Schema registry: all events validated before publish
  □ Distributed locks: stock deduction and number series use Redis locks
  □ Service mesh: mTLS STRICT between all services
  □ Tenant isolation: tested, no cross-tenant data possible

Business completeness:
  □ Sales: invoice, POS, payment, return, credit note, quotation, delivery challan
  □ Purchase: PO, GRN, landed cost, supplier payment, purchase return, debit note
  □ Inventory: ledger, reservations, transfers, adjustments, physical verification, fabric rolls
  □ Accounting: double entry, P&L, balance sheet, bank reconciliation, year close
  □ GST: GSTR-1, GSTR-3B, e-invoice, e-way bill, GSTR-2A reconciliation, TDS
  □ HR: employees, attendance, leave, payroll, alterations, tailor work log
  □ CRM: 360° view, health scoring, campaigns, segments, birthday automation
  □ Reports: 50+ reports across all modules
  □ Platform: auth, RBAC, workflow, notifications, search, import/export, scheduler

Congratulations. 99% enterprise completeness achieved.

═══════════════════════════════════════════
POST-IMPLEMENTATION VERIFICATION CHECKLIST
═══════════════════════════════════════════

Once all milestones above are done, run every check below before generating the report.
Do NOT skip any step. Fix all issues found before moving on.

── 1. MILESTONE COMPLETENESS ────────────────────────────────────────────────
Re-read EVERY milestone in this prompt. For each one confirm:
  ✔ Schema table(s) exist in migration file
  ✔ Domain service / business logic implemented
  ✔ API routes registered with authenticate + requirePermission
  ✔ Zod validation on all request bodies and query params
  ✔ Outbox event written in same DB transaction (all state-changing ops)
  ✔ Audit log entry written
  ✔ Frontend page / component wired (if applicable)
List any milestone, sub-step, or field that is missing or partial. Fix before proceeding.

── 2. VALIDATION COVERAGE ───────────────────────────────────────────────────
For every new API route in this phase verify:
  ✔ 400 returned for invalid/missing request body fields
  ✔ 401 returned when Authorization header is absent
  ✔ 403 returned when user lacks required permission
  ✔ 404 returned for unknown IDs (with tenant_id scope — never leak cross-tenant data)
  ✔ 422 returned for business rule violations (insufficient stock, duplicate, etc.)
  ✔ All error responses use { error: { code, message, details? } } envelope
  ✔ All success responses use { data: { ... } } envelope

── 3. BUILD CHECK ───────────────────────────────────────────────────────────
Run build for every service and frontend touched in this phase:

  pnpm --filter @erp/<service-name> build      ← repeat for each modified service
  pnpm --filter @erp/web-frontend build
  pnpm --filter @erp/pos-frontend build        ← only if POS was changed

Zero build errors required. Fix all before proceeding.

── 4. TYPESCRIPT STRICT CHECK ──────────────────────────────────────────────
Run type-check for each modified service:

  pnpm --filter @erp/<service-name> type-check

Zero errors required. Specifically fix:
  ✔ No implicit `any` — use `unknown` or proper types
  ✔ All function return types declared
  ✔ No non-null assertions (!) unless unavoidable with a comment
  ✔ No `as unknown as X` casts without justification
  ✔ Consistent type imports (import type { ... })

── 5. LOCAL RUN & SMOKE TEST ────────────────────────────────────────────────
Start each modified service in dev mode:

  pnpm --filter @erp/<service-name> dev

Then test EVERY new API endpoint manually (curl or browser):
  ✔ Happy path returns correct response and status code
  ✔ GET /health returns { status: "ok" } on the service port
  ✔ Unauthenticated request returns 401
  ✔ Insufficient permission returns 403
  ✔ Invalid body returns 400 with field-level errors
  ✔ Full lifecycle flow works end-to-end (e.g., DRAFT → CONFIRM → PAID)

For frontend changes open http://localhost:5173, login, and verify:
  ✔ Navigate to every new page — no blank screen, no console errors
  ✔ Create, list, edit, delete flows all work
  ✔ Loading states, empty states, and error toasts display correctly
  ✔ Dark mode renders correctly on all new components

── 6. GENERATE PHASE COMPLETION REPORT ─────────────────────────────────────
Generate the Phase Completion Report using the template at:
  ERP-PLANNING/PHASE_COMPLETION_TEMPLATE.md

Save it as:
  ERP-PLANNING/phase-completions/PHASE_14_COMPLETION.md

The report must be generated and saved BEFORE closing this session.

```