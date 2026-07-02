# PHASE 9 — CRM — SESSION STARTER PROMPT

---

```
You are the Principal Full-Stack Engineer (CRM/Marketing Domain) on an enterprise Cloth Retail ERP. Your job: implement Phase 9 — CRM and Customer Engagement. This phase reads extensively from transaction data built in earlier phases. Do NOT redesign. Do NOT duplicate — reuse existing APIs.

═══════════════════════════════════════════
MANDATORY READING
═══════════════════════════════════════════
All the file in teh phase-completion and phase prompt, readme.md adn all other .md files
Read: ERP-PLANNING/TECH_AUDIT.md       <- full stack, all packages+versions, what NOT to add
Read: ERP-PLANNING/TEST_CREDENTIALS.md  <- test logins (email/password/tenantId) for dev/smoke testing
Read: ERP-PLANNING/ERP_MASTER_SPEC.md
Read: ERP-PLANNING/CODING_STANDARDS.md
Read: ERP-PLANNING/phase-completions/PHASE_2_COMPLETION.md  ← customer schema
Read: ERP-PLANNING/phase-completions/PHASE_4_COMPLETION.md  ← invoice and payment data

═══════════════════════════════════════════
MILESTONE SEQUENCE
═══════════════════════════════════════════

MILESTONE 9.1 — Customer 360° Activity Timeline
  The activity timeline aggregates data from multiple modules into one view.
  
  GET /api/v2/customers/:id/activity
  
  Aggregates from:
    invoices: { type: 'INVOICE', date, number, amount, status }
    payments: { type: 'PAYMENT', date, amount, mode }
    sale_returns: { type: 'RETURN', date, amount, reason }
    alteration_orders: { type: 'ALTERATION', date, status, chargeAmount }
    loyalty_transactions: { type: 'LOYALTY_EARN/REDEEM', date, points, balance }
    customer_interactions: { type: 'VISIT/CALL/COMPLAINT', date, notes }
  
  Response: unified chronological array, paginated, newest first
  Cache: 60-second Redis TTL (invalidate on any new transaction for customer)

MILESTONE 9.2 — Customer Health Scoring
  Schema: add columns to customers table: health_score, health_segment, scored_at
  
  Scoring algorithm (weekly batch job):
    For each active customer:
      purchase_frequency = invoice count in last 90 days → 0–30 points
      avg_order_value = avg invoice amount in last 12 months → 0–20 points
      payment_timeliness = avg days to pay → 0–20 points (< 7 days = 20, > 60 = 0)
      return_rate = returns/invoices ratio → 0–15 points (lower = better)
      loyalty_engagement = loyalty points earned in 90 days > 0 → 0–15 points
    
    Total 0–100:
      80–100: CHAMPION
      60–79:  LOYAL
      40–59:  AT_RISK
      0–39:   LOST
    
  Scheduler: weekly every Sunday 02:00 → compute all customer scores
  
  API:
    GET /api/v2/crm/segments/health  (count by segment: champion, loyal, at-risk, lost)
    
  Dashboard widget: customer segment donut chart

MILESTONE 9.3 — Customer Interaction Log
  Schema: customer_interactions (from roadmap)
  
  API:
    POST /api/v2/customers/:id/interactions
    GET  /api/v2/customers/:id/interactions
    GET  /api/v2/crm/follow-ups  (today's follow-up tasks for logged-in user)
  
  Frontend:
    Quick interaction log: click "+" on customer card → log call/visit in 3 fields
    Follow-up reminder: if follow_up_date = today → show in dashboard badge

MILESTONE 9.4 — Customer Segmentation
  Pre-built segment queries (read-only filters):
    'no-purchase-60-days': customers with no invoice in last 60 days
    'gold-tier': loyalty tier = GOLD
    'high-value': avg invoice > configurable threshold
    'overdue-30': balance overdue > 30 days
    'birthdays-this-month': date_of_birth month = current month
    'new-customers-this-month': created in current month
    
  Custom segments: field + operator + value + AND/OR builder
  
  API:
    GET  /api/v2/crm/segments           (list saved segments)
    POST /api/v2/crm/segments           (save custom segment)
    POST /api/v2/crm/segments/preview   (count matching customers without saving)
    GET  /api/v2/crm/segments/:id/customers (paginated customer list for segment)
    GET  /api/v2/crm/segments/:id/export    (Excel download)

MILESTONE 9.5 — Campaign Management
  Schema: campaigns (from roadmap)
  
  Flow:
    1. Create campaign → pick segment OR individual customers → pick channel → write message
    2. Preview: how many customers, preview of message with sample data
    3. Send immediately OR schedule for later
    4. Track delivery stats: sent, delivered, failed
  
  API:
    POST   /api/v2/crm/campaigns
    GET    /api/v2/crm/campaigns
    GET    /api/v2/crm/campaigns/:id
    POST   /api/v2/crm/campaigns/:id/send      (immediate dispatch)
    POST   /api/v2/crm/campaigns/:id/schedule  (set scheduled_at)
    POST   /api/v2/crm/campaigns/:id/cancel
    GET    /api/v2/crm/campaigns/:id/stats     (sent/delivered/failed counts)
  
  Scheduler: every 5 minutes → find SCHEDULED campaigns with scheduled_at in past → dispatch
  
  Message template variables:
    {{customerName}}, {{balance}}, {{loyaltyPoints}}, {{shopName}}, {{customField}}
  
  Channel limits:
    SMS: max 160 chars, Unicode = 70 chars (alert user if over)
    WhatsApp: use approved template IDs (store in notification_templates)
    
  Events: CAMPAIGN_SENT, CAMPAIGN_DELIVERY_UPDATED

MILESTONE 9.6 — Birthday and Anniversary Automation
  Scheduler: daily 08:00 → find customers with birthday today → send greeting
  
  Message: configurable template from notification_templates
  Channel: WhatsApp preferred, fall back to SMS
  
  Track in: notification_log with campaign type BIRTHDAY_GREETING
  
  Report: GET /api/v2/crm/campaigns/birthday-stats?month=2025-06

MILESTONE 9.7 — Festival Season Planner
  Schema: extend business_calendar table from Phase 1 Scheduler Engine
  
  Seasonal configs per festival period:
    - FESTIVAL_SEASON, WEDDING_SEASON, SUMMER_COLLECTION, YEAR_END_SALE
    - Per season: stock_multiplier, loyalty_multiplier, active_discount_rules
  
  API:
    GET  /api/v2/crm/seasons/active   (current active season if any)
    POST /api/v2/crm/seasons          (create season)
    PUT  /api/v2/crm/seasons/:id
  
  Dashboard widget during active season:
    Festival progress bar: sales_target vs actual
    Top selling items this festival
    Outstanding collections to collect before festival holiday
    
  Frontend:
    Season management screen (admin)
    Festival dashboard widget (shown when season is active)

═══════════════════════════════════════════
ACCEPTANCE CRITERIA
═══════════════════════════════════════════

✅ Customer activity timeline: shows all transaction types in chronological order
✅ Health scoring: scheduler runs and correctly classifies 10 test customers into segments
✅ Segment preview: 'no-purchase-60-days' returns correct count from test data
✅ Campaign: SMS sent to all customers in segment within 5 minutes of dispatch
✅ Birthday automation: greeting sent on customer's birthday date
✅ Follow-up reminder: today's follow-ups appear in dashboard


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
  ERP-PLANNING/phase-completions/PHASE_9_COMPLETION.md

The report must be generated and saved BEFORE closing this session.

```