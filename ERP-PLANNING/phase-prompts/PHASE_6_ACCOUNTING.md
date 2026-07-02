# PHASE 6 — ACCOUNTING — SESSION STARTER PROMPT

---

```
You are the Principal Engineer (Accounting Domain + Indian CA) on an enterprise Cloth Retail ERP. This is the most sensitive phase. Every number must balance. Every business rule must be enforced at the database level, not just the application level. Do NOT redesign. Do NOT simplify.

═══════════════════════════════════════════
MANDATORY READING
═══════════════════════════════════════════
All the file in teh phase-completion and phase prompt, readme.md adn all other .md files
Read: ERP-PLANNING/TECH_AUDIT.md       <- full stack, all packages+versions, what NOT to add
Read: ERP-PLANNING/TEST_CREDENTIALS.md  <- test logins (email/password/tenantId) for dev/smoke testing
Read: ERP-PLANNING/ERP_MASTER_SPEC.md
Read: ERP-PLANNING/CODING_STANDARDS.md
Read: ERP-PLANNING/phase-completions/PHASE_2_COMPLETION.md  ← Chart of accounts schema
Read: ERP-PLANNING/phase-completions/PHASE_4_COMPLETION.md  ← INVOICE_CONFIRMED event payload
Read: ERP-PLANNING/phase-completions/PHASE_5_COMPLETION.md  ← GRN_APPROVED, SUPPLIER_PAYMENT_MADE payloads

═══════════════════════════════════════════
THE GOLDEN RULE OF ACCOUNTING — NEVER BYPASS
═══════════════════════════════════════════

Every journal entry MUST balance: SUM(debit_amount) = SUM(credit_amount) per journal_id.

This is enforced by a PostgreSQL trigger that runs BEFORE COMMIT:

  CREATE OR REPLACE FUNCTION validate_journal_balance()
  RETURNS TRIGGER AS $$
  DECLARE balance DECIMAL;
  BEGIN
    SELECT SUM(debit_amount) - SUM(credit_amount) INTO balance
    FROM financial_entries WHERE journal_id = NEW.journal_id;
    IF ABS(balance) > 0.01 THEN
      RAISE EXCEPTION 'Journal % is unbalanced: DR-CR = %', NEW.journal_id, balance;
    END IF;
    RETURN NEW;
  END;
  $$ LANGUAGE plpgsql;

This trigger CANNOT be bypassed. If your application code posts unbalanced entries, the DB rejects the transaction. This is intentional.

═══════════════════════════════════════════
MILESTONE SEQUENCE
═══════════════════════════════════════════

MILESTONE 6.1 — Double Entry Engine
  Schema:
    - financial_entries table (PARTITIONED BY RANGE(created_at) → by year)
    - Each row = one line of a journal entry (not one full entry)
    - financial_entries_2025, financial_entries_2026 partitions
    - Trigger: validate_journal_balance fires on INSERT for each journal_id
    - NEVER allow UPDATE or DELETE on financial_entries
    - journal_id links DR and CR lines of one accounting event
  
  JournalEngine (in accounting-service):
    JournalEngine.post(ctx: PlatformContext, entry: JournalEntry): Promise<string>
    // entry: { journalId (ULID), description, lines: [{accountId, debitAmount, creditAmount}] }
    // Validates: at least 2 lines, sum(DR) = sum(CR), all accounts exist and are active
    // Returns: journalId
    
    JournalEngine.reverse(journalId): Promise<string>
    // Creates mirror entry with DR/CR flipped, links to original via reversal_of
  
  PostingMatrix (config table defining which accounts to debit/credit per event):
    - INVOICE_CONFIRMED: DR Accounts Receivable, CR Sales Revenue, CR GST Payable
    - GRN_APPROVED: DR Inventory Asset, CR Accounts Payable
    - PAYMENT_RECEIVED: DR Cash/Bank, CR Accounts Receivable
    - SUPPLIER_PAYMENT_MADE: DR Accounts Payable, CR Cash/Bank
    - SALE_RETURN_APPROVED: DR Sales Returns, CR Accounts Receivable
    - EXPENSE_APPROVED: DR Expense Account, CR Accounts Payable
    - EXPENSE_PAID: DR Accounts Payable, CR Cash/Bank
    - STOCK_ADJUSTMENT (damage): DR Loss Account, CR Inventory Asset
    - SALARY_DISBURSED: DR Salaries Expense, CR Cash/Bank

MILESTONE 6.2 — Event Consumers (Accounting Automation)
  Consume each event, call JournalEngine.post() with correct PostingMatrix entries:
  
  Kafka consumers in accounting-service:
    InvoiceAccountingConsumer:    handles INVOICE_CONFIRMED, INVOICE_CANCELLED
    GRNAccountingConsumer:        handles GRN_APPROVED
    PaymentAccountingConsumer:    handles PAYMENT_RECEIVED, SUPPLIER_PAYMENT_MADE, CHEQUE_BOUNCED
    SaleReturnAccountingConsumer: handles SALE_RETURN_APPROVED
    ExpenseAccountingConsumer:    handles EXPENSE_APPROVED, EXPENSE_PAID
    SalaryAccountingConsumer:     handles PAYROLL_PROCESSED
    
  Each consumer uses Inbox pattern (idempotent processing from Phase 0).
  
  API:
    GET /api/v2/accounts/:id/ledger?from=&to=   (account ledger with pagination)
    GET /api/v2/journals/:id                      (journal detail: all DR/CR lines)

MILESTONE 6.3 — Financial Reports Engine
  Trial Balance:
    GET /api/v2/reports/trial-balance?asOf=&branchId=
    For every account: opening_balance + period_debits - period_credits = closing_balance
    Must balance: sum(debit_balances) = sum(credit_balances)
    
  Profit and Loss:
    GET /api/v2/reports/profit-loss?from=&to=&branchId=
    Revenues - COGS - Operating Expenses - Financial Charges = Net Profit
    Compared to previous period
    
  Balance Sheet:
    GET /api/v2/reports/balance-sheet?asOf=&branchId=
    Assets = Liabilities + Equity
    Must balance (validate in code and raise alert if not)
    
  Cash Flow Statement:
    GET /api/v2/reports/cash-flow?from=&to=
    Operating + Investing + Financing activities

MILESTONE 6.4 — Bank Reconciliation
  Schema: bank_accounts, bank_statements, bank_reconciliation_items
  
  Process:
    1. Import bank statement (PDF parse or CSV)
    2. Auto-match bank entries with book entries by amount + date
    3. Manual match for unmatched
    4. Flag: in books but not in bank, in bank but not in books
    
  API:
    POST /api/v2/bank-accounts
    POST /api/v2/bank-reconciliation/:accountId/import
    GET  /api/v2/bank-reconciliation/:accountId/items
    POST /api/v2/bank-reconciliation/:accountId/items/:id/match
    GET  /api/v2/bank-reconciliation/:accountId/summary
    POST /api/v2/bank-reconciliation/:accountId/finalize
  
  Frontend: Bank reconciliation matching UI (drag-and-match interface)

MILESTONE 6.5 — Financial Year Management
  Schema: financial_years, period_closures
  
  Financial year: April 1 – March 31 (configurable per tenant)
  
  Year-End Close Saga (YEAR_END_CLOSE):
    Pre-close checklist (10 steps — all must pass before close allowed):
      □ All invoices confirmed or cancelled (no DRAFT)
      □ All GRNs received or cancelled
      □ All supplier payments allocated
      □ All customer payments allocated
      □ Bank reconciliation completed for all accounts
      □ Trial balance balances (DR = CR)
      □ No unprocessed outbox events
      □ Stock reconciliation passed
      □ All approvals completed
      □ Owner 2FA re-authentication (for security)
    
    Close steps (compensatable):
      1. Post closing entries (P&L to Retained Earnings)
      2. Create new FY record with opening balances
      3. Lock current FY (no further posting)
      4. Archive reports
    
  API:
    GET  /api/v2/financial-years
    POST /api/v2/financial-years/:id/close/checklist (check all 10 conditions)
    POST /api/v2/financial-years/:id/close (only if checklist passes)
    POST /api/v2/financial-years/:id/lock-period  (lock month, not full year)
  
  Note: After lock, any attempt to post to a closed period → FinancialPeriodClosedError

MILESTONE 6.6 — Fixed Asset Register
  Schema: fixed_assets, asset_depreciation_schedule
  
  Methods: SLM (Straight Line), WDV (Written Down Value)
  Auto-depreciation journal: posted by monthly scheduler job
  
  API:
    POST/GET/PUT /api/v2/fixed-assets
    GET  /api/v2/fixed-assets/:id/depreciation-schedule
    POST /api/v2/fixed-assets/:id/dispose  (sale/scrap with gain/loss posting)

MILESTONE 6.7 — TDS Management
  Schema: tds_entries, tds_certificates
  
  Sections: 194C (contractors), 194H (commission), 194J (professional)
  
  On supplier payment: if payee category → auto-deduct TDS
  Certificate: Form 16A generated quarterly
  Return data: 26Q format
  
  API:
    GET /api/v2/tds/liability?period=    (amount to deposit)
    GET /api/v2/tds/certificates/:supplierId
    GET /api/v2/tds/26q-data?period=

═══════════════════════════════════════════
ACCEPTANCE CRITERIA
═══════════════════════════════════════════

✅ CRITICAL: Attempt to post unbalanced journal → PostgreSQL trigger raises exception
✅ Invoice confirmed → accounting entries posted within 5 seconds (via event consumer)
✅ Trial balance: DR total = CR total (verified on test data)
✅ P&L: Revenue - COGS - Expenses = Net Profit (cross-check manually)
✅ Balance Sheet: Assets = Liabilities + Equity (cross-check manually)
✅ Year-close: all 10 checklist items must pass before close is allowed
✅ Period lock: posting to locked period returns FinancialPeriodClosedError
✅ Reversed journal: DR and CR exactly flipped from original


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
  ERP-PLANNING/phase-completions/PHASE_6_COMPLETION.md

The report must be generated and saved BEFORE closing this session.

```