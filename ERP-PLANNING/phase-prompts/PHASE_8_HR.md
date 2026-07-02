# PHASE 8 — HUMAN RESOURCES — SESSION STARTER PROMPT

---

```
You are the Principal Full-Stack Engineer (HR Domain) on an enterprise Cloth Retail ERP. Your job: implement Phase 8 — HR, Payroll, and Alteration Workflow completely. This phase is relatively independent from Sales/Purchase but must integrate with the payroll accounting journal.

═══════════════════════════════════════════
MANDATORY READING
═══════════════════════════════════════════
All the file in teh phase-completion and phase prompt, readme.md adn all other .md files
Read: ERP-PLANNING/TECH_AUDIT.md       <- full stack, all packages+versions, what NOT to add
Read: ERP-PLANNING/TEST_CREDENTIALS.md  <- test logins (email/password/tenantId) for dev/smoke testing
Read: ERP-PLANNING/ERP_MASTER_SPEC.md
Read: ERP-PLANNING/CODING_STANDARDS.md
Read: ERP-PLANNING/phase-completions/PHASE_2_COMPLETION.md  ← branches schema
Read: ERP-PLANNING/phase-completions/PHASE_6_COMPLETION.md  ← JournalEngine API (for payroll accounting)

═══════════════════════════════════════════
SENSITIVITY — ENCRYPTED FIELDS
═══════════════════════════════════════════

The following employee fields MUST be encrypted with AES-256-GCM before storage:
- employee.pan             (use ctx.encryption.encrypt())
- employee.bank_account_no (use ctx.encryption.encrypt())
- employee.salary_details  (store in salary_structures with encryption)

Companion _hash columns for exact-match search (HMAC, not searchable by partial match).
Aadhaar: store ONLY the last 4 digits, never the full 12-digit number.
Salary: NEVER cache in Redis (even encrypted). NEVER log. NEVER include in list API responses.

═══════════════════════════════════════════
MILESTONE SEQUENCE
═══════════════════════════════════════════

MILESTONE 8.1 — Employee Master
  Schema: employees, departments, designations (from roadmap schemas)
  Employment types: FULL_TIME, PART_TIME, CONTRACT, DAILY_WAGE, TRAINEE, TAILOR
  
  API:
    POST/GET/PUT /api/v2/employees
    POST /api/v2/employees/:id/photo/upload
    POST /api/v2/employees/:id/documents/upload  (offer letter, ID proof, etc.)
    POST /api/v2/employees/:id/exit  (record exit date and reason)
    GET  /api/v2/employees/:id       (full detail — salary only if PAYROLL_VIEW permission)
    GET  /api/v2/departments + POST/PUT/DELETE
    GET  /api/v2/designations + POST/PUT/DELETE
    POST /api/v2/employees/import
  
  Events: EMPLOYEE_JOINED, EMPLOYEE_EXITED
  
  Frontend:
    Employee list with search, department filter, employment type filter
    Employee create/edit form (full — all sections as tabs)
    Employee view page (profile, salary, documents, leave history)

MILESTONE 8.2 — Attendance Management
  Schema: attendance, shifts (from roadmap schemas)
  
  Attendance sources:
    MANUAL: Manager marks from web app
    BIOMETRIC: Import from biometric machine CSV (standard format)
    MOBILE_APP: Future capability (feature flag)
    
  Rules:
    First punch = check-in, last punch = check-out
    work_hours = check_out_time - check_in_time
    grace_period_minutes configurable per shift
    LATE if check-in > shift_start_time + grace_period
    HALF_DAY if work_hours < shift.half_day_hours
    overtime_hours = max(0, work_hours - shift.standard_hours)
    
  API:
    POST /api/v2/attendance/mark           (in/out for one employee)
    POST /api/v2/attendance/bulk-mark      (team mark for a date)
    GET  /api/v2/attendance/:employeeId?month=2025-06
    PUT  /api/v2/attendance/:id/correct    (with reason — audited)
    POST /api/v2/attendance/import         (biometric CSV import)
    GET  /api/v2/attendance/report         (team report with filters)
    GET  /api/v2/attendance/team-summary   (manager: all team, one month)
  
  Scheduler: daily at 23:59 → auto-import from biometric server if configured
  
  Frontend:
    Attendance calendar view per employee (month with color-coded status)
    Team attendance grid (employees × dates)
    Biometric import screen with error report

MILESTONE 8.3 — Leave Management
  Schema: leave_types, employee_leave_balance, leave_applications (from roadmap)
  
  Default leave types seeded per tenant:
    - Casual Leave: 12 days/year, non-carry-forward
    - Sick Leave: 12 days/year, non-carry-forward, document required if > 2 days
    - Earned Leave: 15 days/year, carry forward up to 30 days
    - Maternity Leave: 26 weeks (gender=FEMALE only, applicable after 6 months)
    - Paternity Leave: 15 days (gender=MALE only)
    - Compensatory Off: earned from overtime, expires in 30 days
    
  Flow: APPLY → PENDING → APPROVED/REJECTED
  On APPROVED: deduct from balance, create attendance records for leave days
  On CANCELLED (before leave starts): restore balance
  
  API:
    GET  /api/v2/leave-types
    GET  /api/v2/employees/:id/leave-balance
    POST /api/v2/leave-applications
    POST /api/v2/leave-applications/:id/approve
    POST /api/v2/leave-applications/:id/reject
    POST /api/v2/leave-applications/:id/cancel
    GET  /api/v2/approvals/leaves/pending  (manager's pending approvals)
    
  Scheduler:
    Monthly: accrue leave for eligible employees
    December 31: carry forward eligible leave, expire non-carry-forward
    
  Frontend:
    Leave application form
    Leave calendar (team view — who is on leave when)
    Leave balance card on employee profile

MILESTONE 8.4 — Payroll Processing
  Schema: salary_structures, employee_salaries, payroll_runs, payroll_slips (from roadmap)
  
  Processing flow:
    1. Create payroll_run for month
    2. For each active employee:
       a. Get working days for month (from calendar + shifts)
       b. Calculate present days (from attendance)
       c. Calculate paid leave days (from approved leaves)
       d. Calculate LOP days (absent - unpaid leaves)
       e. Pro-rate salary: basic × (present+paid_leave) / working_days
       f. Compute PF: employee 12% of basic, employer 12% of basic
       g. Compute ESI: if gross <= 21000 → employee 0.75%, employer 3.25%
       h. Compute Professional Tax (state-wise, per slab)
       i. Apply loan deductions
       j. Net salary = gross - all deductions
    3. Generate salary slip PDF per employee
    4. Post accounting journal: DR Salary Expense, CR Salary Payable
    5. On disburse: DR Salary Payable, CR Bank
    
  Tailor-specific: aggregate tailor_work_log amounts → add as piece_rate_amount
  
  API:
    POST /api/v2/payroll-runs            (create for month)
    GET  /api/v2/payroll-runs
    GET  /api/v2/payroll-runs/:id
    POST /api/v2/payroll-runs/:id/calculate   (compute all slips — preview)
    POST /api/v2/payroll-runs/:id/approve     (lock — requires PAYROLL_APPROVE)
    POST /api/v2/payroll-runs/:id/disburse    (mark as paid, post accounting)
    GET  /api/v2/payroll-slips/:id/pdf        (salary slip PDF for employee)
    POST /api/v2/payroll-runs/:id/bulk-send   (WhatsApp/email slips to all)
    
  Saga (PAYROLL_PROCESSING):
    Step 1 (COMPENSATABLE): Lock payroll run
    Step 2 (COMPENSATABLE): Calculate all slips
    Step 3 (COMPENSATABLE): Post salary payable journal entry
    Step 4 (COMPENSATABLE): Post employer PF/ESI journal
    Step 5 (IRREVERSIBLE): Post disbursal journal (bank debit)
    Step 6 (IRREVERSIBLE): Send salary slips to employees

MILESTONE 8.5 — Alteration Order Management
  Schema: alteration_orders, alteration_tasks (from roadmap schemas)
  
  Status machine:
    RECEIVED → ASSIGNED → IN_PROGRESS → QUALITY_CHECK → READY → DELIVERED → CANCELLED
  
  API:
    POST /api/v2/alterations
    GET  /api/v2/alterations
    GET  /api/v2/alterations/:id
    PUT  /api/v2/alterations/:id
    POST /api/v2/alterations/:id/assign   (assign to tailor)
    POST /api/v2/alterations/:id/status   (update status)
    POST /api/v2/alterations/:id/deliver  (collect balance → DELIVERED)
    GET  /api/v2/alterations/tailor/:id   (tailor's work queue)
    GET  /api/v2/alterations/overdue      (manager view)
    
  Notifications:
    On READY: WhatsApp to customer "Your alteration is ready. Ref: ALT-0042"
    On ASSIGNED: In-app to tailor
    Daily: notify tailor 1 day before promised_date for pending alterations
    Daily: notify manager of overdue alterations
  
  Scheduler: daily 08:00 → find alterations where promised_date = today → alert tailor
  Scheduler: daily 08:30 → find overdue alterations → alert manager
  
  Frontend:
    Alteration counter screen (receive + assign on one screen)
    Alteration list with status Kanban view (optional) or table
    Alteration detail page
    Tailor's work queue (mobile-friendly)
    Delivery screen (show balance due, accept payment)

MILESTONE 8.6 — Tailor Work Log (piece-rate)
  Schema: tailor_work_log (feature-flagged: hr.tailoring.enabled)
  
  API:
    POST /api/v2/tailor-work-log        (log work done)
    GET  /api/v2/tailor-work-log?employeeId=X&month=2025-06
    GET  /api/v2/tailor-work-log/summary?month=2025-06  (total earning per tailor)

═══════════════════════════════════════════
ACCEPTANCE CRITERIA
═══════════════════════════════════════════

✅ Employee create: salary data encrypted, Aadhaar stored as last 4 only
✅ Attendance import: 30-day biometric CSV for 20 employees processes in < 30 seconds
✅ Leave: approve reduces balance, cancel restores balance (both verified)
✅ Payroll: net salary = gross - PF(employee) - ESI - PT - loan deductions (verified)
✅ Payroll: LOP reduces salary proportionally (test case: 2 LOP days out of 26)
✅ Alteration: WhatsApp sent when status → READY
✅ Tailor work log: piece-rate total flows into payroll correctly


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
  ERP-PLANNING/phase-completions/PHASE_8_COMPLETION.md

The report must be generated and saved BEFORE closing this session.

```