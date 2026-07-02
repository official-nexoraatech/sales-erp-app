# PHASE 1 — CORE PLATFORM ENGINES — SESSION STARTER PROMPT
## Paste this entire prompt as your first message in a new Claude session.

---

```
You are the Principal Platform Engineer on an enterprise Cloth Retail ERP project. Your sole job in this session is to implement Phase 1 — Core Platform Engines. Do NOT redesign anything. Do NOT simplify. Continue exactly from where Phase 0 left off.

═══════════════════════════════════════════
ARCHITECTURE BIBLE (READ FIRST — MANDATORY)
═══════════════════════════════════════════

Read: ERP-PLANNING/TECH_AUDIT.md       <- full stack, all packages+versions, what NOT to add
Read: ERP-PLANNING/TEST_CREDENTIALS.md  <- test logins (email/password/tenantId) for dev/smoke testing
Read: ERP-PLANNING/ERP_MASTER_SPEC.md
Read: ERP-PLANNING/CODING_STANDARDS.md
Read: ERP-PLANNING/phase-completions/PHASE_0_COMPLETION.md  ← Phase 0 handoff

These three documents are your source of truth. Every decision you make must align with them.

═══════════════════════════════════════════
WHAT EXISTS FROM PHASE 0
═══════════════════════════════════════════

Phase 0 delivered:
- Complete monorepo structure (Turborepo, pnpm workspaces)
- Docker Compose local stack (PostgreSQL, Redis, Kafka, MinIO, Elasticsearch, Jaeger, Grafana, Vault)
- CI/CD pipeline (GitHub Actions)
- Platform SDK complete (PlatformContext, TenantScopedDatabase, Cache, Locks, AuditLogger, EventBus, FeatureFlags)
- Auth Service complete (JWT login/refresh/logout, RBAC middleware)
- Observability pipeline (structured logging, metrics, tracing)
- Kubernetes manifests + Istio mTLS

[Check PHASE_0_COMPLETION.md for the exact public interfaces and folder structure.]

DO NOT rebuild anything from Phase 0. Use it as-is.

═══════════════════════════════════════════
YOUR OBJECTIVE — PHASE 1
═══════════════════════════════════════════

Build the 8 platform engines that every business module (Phases 2–11) will call. These are NOT business features — they are shared infrastructure. After this phase, a developer building the Sales module can call WorkflowEngine.trigger(), NotificationEngine.send(), PDFEngine.generate(), and SchedulerEngine.register() without writing those themselves.

═══════════════════════════════════════════
MILESTONE SEQUENCE (DO IN THIS ORDER)
═══════════════════════════════════════════

MILESTONE 1.1 — Tenant Engine (apps/tenant-service)
  - POST /admin/tenants (full provisioning in < 30 seconds)
  - Provisioning: create record → create schema → run migrations → seed default roles/permissions → create admin user → create S3 prefix → create Elasticsearch indices → create feature flags → send welcome email
  - PATCH /admin/tenants/:id/suspend
  - PATCH /admin/tenants/:id/activate
  - PATCH /admin/tenants/:id/close
  - Tenant context middleware: extracts tenantId from JWT, validates status (cached 60s)
  - Test: provision tenant, verify all 9 provisioning steps completed

MILESTONE 1.2 — RBAC Engine
  - Complete permissions.ts file with ALL ~180 permissions (see ERP_MASTER_SPEC.md Section 12)
  - role-defaults.ts: default permission set per role (OWNER, ADMIN, CASHIER, ACCOUNTANT, etc.)
  - Roles CRUD API: GET/POST/PUT/DELETE /roles
  - Role permissions API: GET/PUT /roles/:id/permissions
  - User-role assignment (in auth-service)
  - Branch-scoped access: users see only their assigned branches
  - Test: cashier permission check passes for INVOICE_CREATE, fails for PAYROLL_PROCESS

MILESTONE 1.3 — Approval Workflow Engine (in platform-sdk)
  - workflow_definitions table
  - workflow_instances table
  - workflow_approvals table
  - WorkflowEngine.trigger(event, entity) → finds matching definition, creates instance
  - WorkflowEngine.approve(instanceId, nodeId, userId, comment)
  - WorkflowEngine.reject(instanceId, nodeId, userId, comment)
  - WorkflowEngine.getStatus(instanceId)
  - GET /approvals/pending (for notification bell)
  - POST /approvals/:id/approve
  - POST /approvals/:id/reject
  - 20 pre-built approval workflow definitions seeded per tenant
  - Background job: expire pending approvals → escalate
  - Event: APPROVAL_REQUESTED, APPROVAL_GRANTED, APPROVAL_REJECTED, APPROVAL_ESCALATED

MILESTONE 1.4 — Notification Engine (apps/notification-service)
  - notification_templates table
  - notification_log table
  - Channels: SMS (MSG91), WhatsApp (WhatsApp Business API), Email (Sendgrid), In-App
  - NotificationEngine.send(tenantId, eventType, recipient, templateData)
  - Template rendering with Handlebars
  - In-app notifications via WebSocket/SSE + unread count
  - POST /notifications/preferences (per-user channel preferences)
  - Quiet hours: no SMS between 22:00 and 08:00 IST
  - Retry: 3 attempts exponential backoff per channel
  - Events: NOTIFICATION_SENT, NOTIFICATION_DELIVERED, NOTIFICATION_FAILED

MILESTONE 1.5 — Document and PDF Engine (in report-service)
  - PDF generation with Puppeteer (headless Chrome)
  - Handlebars HTML templates → PDF
  - Templates for: TAX_INVOICE, QUOTATION, DELIVERY_CHALLAN, PURCHASE_ORDER, PAYMENT_RECEIPT, SALARY_SLIP
  - Number Series Engine:
    - number_series_config table
    - NumberSeriesEngine.next(type, branchId) → next formatted number (thread-safe, uses DB sequence)
    - Number format: "INV/{FY-SHORT}/{SEQ:5}" → "INV/25-26/00001"
    - Reset per financial year
    - POST /config/number-series/:type (configure format)
    - POST /config/number-series/:type/preview (see next number)

MILESTONE 1.6 — Scheduler Engine (apps/scheduler-service)
  - BullMQ job queue with Redis
  - JobRegistry: register(jobName, cronExpression, handler, config)
  - Distributed lock before run (prevents duplicate execution across pods)
  - Job history table: last 30 runs per job type per tenant
  - Admin API: GET /jobs (list all with last run status, next run)
  - Admin API: POST /jobs/:name/trigger (manual run with permission)
  - Admin API: PATCH /jobs/:name/pause and /resume
  - All 30+ system jobs registered (see ERP_MASTER_SPEC.md roadmap section)

MILESTONE 1.7 — Import/Export Engine (in scheduler-service or dedicated)
  - import_jobs table
  - POST /imports/upload → jobId
  - POST /imports/:jobId/map → column mapping
  - POST /imports/:jobId/validate → dry-run result
  - POST /imports/:jobId/execute → async processing
  - GET /imports/:jobId/status → progress (SSE stream)
  - POST /imports/:jobId/rollback
  - GET /imports/templates/:entityType → Excel template download
  - POST /exports/generate
  - GET /exports/:jobId/download → signed URL

MILESTONE 1.8 — Search Engine (apps/search-service)
  - Custom Elasticsearch wrapper
  - Per-entity index management (create, alias swap, reindex)
  - Custom analyzers: erp_name_analyzer with synonyms (pvt=private, ltd=limited, etc.)
  - Phonetic matching for Indian names
  - GET /search?q=ravi&types=customer,item,invoice (global search)
  - Entity-specific search endpoints (see roadmap)
  - POST /admin/search/reindex/:tenantId/:entity

MILESTONE 1.9 — Rule Engine (in platform-sdk)
  - business_rules table
  - RuleEngine.evaluate(event, context) → RuleResult[]
  - Rule conditions: EQUALS, NOT_EQUALS, GREATER_THAN, LESS_THAN, BETWEEN, IN, NOT_IN
  - Rule actions: SET_FIELD, ADD_DISCOUNT, BLOCK, WARN, NOTIFY, TRIGGER_APPROVAL
  - Rules CRUD: GET/POST/PUT/DELETE /rules
  - POST /rules/simulate (test rule without saving)
  - 6 pre-built rule templates seeded per tenant (from roadmap)

═══════════════════════════════════════════
STANDARDS REMINDER
═══════════════════════════════════════════

- Every new table: has tenant_id, created_at, updated_at, created_by, version
- Every new API endpoint: has permission guard
- Every state change: writes to audit_log via ctx.audit.log()
- Every cross-service call: goes via Outbox pattern (never direct Kafka publish from business code)
- Every service: exposes /health and /metrics endpoints

═══════════════════════════════════════════
HOW TO WORK
═══════════════════════════════════════════

1. Read the Phase 0 completion report first to understand exact public interfaces.
2. Announce each milestone before starting.
3. Write complete, working code — no placeholders.
4. Run tests after each milestone.
5. At phase end, generate Phase Completion Report using ERP-PLANNING/PHASE_COMPLETION_TEMPLATE.md.

═══════════════════════════════════════════
ACCEPTANCE CRITERIA
═══════════════════════════════════════════

✅ POST /admin/tenants provisions a tenant in < 30 seconds (verify all 9 steps)
✅ WorkflowEngine: invoice triggers approval, approver receives notification, approve → continues
✅ NotificationEngine: SMS sent via MSG91 in dev/staging test mode
✅ PDF: invoice PDF renders with all required fields (logo, GSTIN, GST breakdown)
✅ NumberSeries: concurrent calls never return duplicate numbers (test with 100 concurrent)
✅ Import: 10,000 customer rows imported in < 5 minutes with error report
✅ Search: query returns in < 200ms with fuzzy matching for Indian names
✅ RuleEngine: block rule prevents invoice save correctly
✅ All 30+ jobs listed in admin dashboard with correct cron schedules

Begin with Milestone 1.1 — Tenant Engine. Confirm you have read all three reference files before writing any code.

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
  ERP-PLANNING/phase-completions/PHASE_1_COMPLETION.md

The report must be generated and saved BEFORE closing this session.

```