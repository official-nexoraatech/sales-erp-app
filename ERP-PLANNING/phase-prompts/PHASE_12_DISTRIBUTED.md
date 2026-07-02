# PHASE 12 — DISTRIBUTED PLATFORM IMPLEMENTATION — SESSION STARTER PROMPT

---

```
You are the Principal Distributed Systems Engineer on an enterprise Cloth Retail ERP. Your job: implement Phase 12 — the full distributed systems layer that makes this ERP enterprise-grade at scale. This phase does NOT add business features. It ensures the system is correct, consistent, and resilient at production load. Do NOT redesign. Every pattern here was specified in the Architecture Bible.

═══════════════════════════════════════════
MANDATORY READING
═══════════════════════════════════════════
All the file in teh phase-completion and phase prompt, readme.md adn all other .md files
Read: ERP-PLANNING/TECH_AUDIT.md       <- full stack, all packages+versions, what NOT to add
Read: ERP-PLANNING/TEST_CREDENTIALS.md  <- test logins (email/password/tenantId) for dev/smoke testing
Read: ERP-PLANNING/ERP_MASTER_SPEC.md  ← especially Sections 4.2–4.9
Read: ERP-PLANNING/CODING_STANDARDS.md
Read ALL phase completion reports in ERP-PLANNING/phase-completions/
(You need to understand every service's events and tables to wire up the distributed layer)

═══════════════════════════════════════════
WHAT THIS PHASE ADDS
═══════════════════════════════════════════

This phase makes existing code:
1. More consistent (CQRS projections as authoritative read models)
2. More resilient (Saga compensations fully tested + operational runbooks)
3. More observable (event store, DLQ management, saga monitoring)
4. More maintainable (schema registry, event catalog)
5. Zero data loss (Outbox + Inbox verification audit)

═══════════════════════════════════════════
MILESTONE SEQUENCE
═══════════════════════════════════════════

MILESTONE 12.1 — Event Store (Full Implementation)
  Schema: event_store (PARTITIONED BY RANGE(occurred_at))
  From ERP_MASTER_SPEC.md Section 4.3
  
  EventStore service:
    EventStore.append(event: DomainEvent): Promise<void>
      → validate schema against SchemaRegistry
      → insert with optimistic concurrency check (aggregate_type + aggregate_id + version)
      → index in Elasticsearch for query
    
    EventStore.getHistory(aggregateType, aggregateId): Promise<DomainEvent[]>
    EventStore.rebuild(aggregateType, aggregateId): Promise<AggregateState>
    EventStore.query(filters: EventStoreQuery): Promise<DomainEvent[]>
    EventStore.snapshot(aggregateType, aggregateId): Promise<void>
    
  Apply event sourcing to: Invoice (rebuild from DRAFT → events), Customer Balance (rebuild from payments)
  
  Snapshot policy: snapshot every 50 events per aggregate (configurable)
  
  Admin API:
    GET /api/v2/admin/events/store?aggregateType=Invoice&aggregateId=123
    GET /api/v2/admin/events/store?eventType=INVOICE_CONFIRMED&from=2025-06-01
    POST /api/v2/admin/events/replay/:aggregateType/:aggregateId  (rebuild state)

MILESTONE 12.2 — CQRS Projections (Full Production Implementation)
  Verify all CQRS projections from earlier phases are correctly implemented:
  
  Projection 1: projection_dashboard_daily
    Event handlers: INVOICE_CONFIRMED, INVOICE_CANCELLED, PAYMENT_RECEIVED, EXPENSE_APPROVED
    Consistency tier: EVENTUAL (target: 30s lag, tolerance: 120s)
    
  Projection 2: projection_customer_balance
    Event handlers: INVOICE_CONFIRMED, INVOICE_CANCELLED, PAYMENT_RECEIVED, CREDIT_NOTE_APPLIED
    Consistency tier: NEAR_REAL_TIME (target: 2s lag)
    
  Projection 3: projection_stock_level
    Event handlers: STOCK_DEDUCTED, STOCK_RECEIVED, RESERVATION_CREATED, RESERVATION_RELEASED
    Consistency tier: NEAR_REAL_TIME (target: 2s lag)
    
  Projection 4: projection_customer_aging
    Scheduled rebuild: every 1 hour
    Consistency tier: SCHEDULED
    
  Each projection API response MUST include:
    _projection: { lastUpdatedAt, lagMs, isStale }
  
  Stale detection: if lagMs > staleTolerance → isStale: true → client shows "data as of X min ago"
  
  Projection rebuild tool:
    POST /api/v2/admin/projections/:name/rebuild (re-process all events for this projection)

MILESTONE 12.3 — Outbox/Inbox Audit and Hardening
  Audit ALL existing services — verify:
    □ Every INSERT that should produce an event also inserts into outbox_events in SAME transaction
    □ Every event consumer uses inbox_events for idempotency
    □ No service publishes directly to Kafka (bypass the outbox)
    
  Create audit report: outbox coverage by service (% of state-changing operations with outbox entry)
  
  Harden OutboxPublisher:
    Polling: every 100ms for PENDING events (batch: 100)
    Schema validation: validate against SchemaRegistry before publish
    Dead letter: events with retry_count > 5 → move to DLQ topic
    Metrics: publish lag (time from outbox insert to Kafka publish)
    Alert: if max lag > 30 seconds → PagerDuty P1
    
  Harden InboxConsumer:
    Verify all consumers use transactions when marking processed
    Verify all consumers handle duplicate delivery correctly (test with replay)

MILESTONE 12.4 — Dead Letter Queue Management
  DLQ topics (one per main topic + .dlq suffix):
    erp.sales.invoice.confirmed.dlq, erp.inventory.stock.deducted.dlq, etc.
  
  dlq_items table:
    topic, partition, offset, payload, error_message, retry_count, status (PENDING, REPLAYED, DISCARDED)
  
  Admin API:
    GET  /api/v2/admin/dlq/summary       (all topics with depth counts)
    GET  /api/v2/admin/dlq/:topic        (messages in DLQ, paginated)
    GET  /api/v2/admin/dlq/:topic/:id    (single message detail)
    POST /api/v2/admin/dlq/:topic/replay (replay all PENDING messages)
    POST /api/v2/admin/dlq/:id/discard   (discard after investigation)
    
  Alert: DLQ depth > 10 messages on any topic → P1 Slack alert
  
  Admin UI:
    DLQ management page: table of topics with depth + replay button
    Message inspector: view raw payload + error + retry history

MILESTONE 12.5 — Saga Monitoring Dashboard
  saga_log table (from Phase 0 design — verify it exists, add if not)
  
  Saga status tracking:
    Active sagas (IN_PROGRESS + started > 30 min ago → STALLED alert)
    Failed sagas (COMPENSATION_REQUIRED or COMPENSATION_FAILED)
    Successful sagas (last 24h: count + avg duration)
    
  Admin API:
    GET /api/v2/admin/sagas/summary      (counts by status and type)
    GET /api/v2/admin/sagas?status=FAILED (list failed sagas)
    GET /api/v2/admin/sagas/:id          (full saga step history)
    POST /api/v2/admin/sagas/:id/retry   (retry from last failed step)
    POST /api/v2/admin/sagas/:id/compensate (manually trigger compensation)
  
  Admin UI:
    Saga monitoring page: live status board
    Failed saga queue with: saga type, failed step, error, retry button

MILESTONE 12.6 — Schema Registry
  Schema registry service (simple HTTP + PostgreSQL backed):
  
  schemas table: event_type, schema_version, json_schema, compatibility_mode, registered_at
  
  API:
    POST /api/v2/schema-registry/schemas          (register schema)
    GET  /api/v2/schema-registry/schemas/:type    (get latest schema)
    GET  /api/v2/schema-registry/schemas/:type/:version
    POST /api/v2/schema-registry/schemas/:type/check  (compatibility check before register)
    GET  /api/v2/schema-registry/catalog          (full event catalog)
    
  Upcasters registered in code (not in DB — code is source of truth):
    Register upcaster for: InvoiceConfirmed v1→v2 (from Architecture Bible refinements)
    
  All Kafka producers MUST validate against schema before publishing.
  Incompatible schema change → 422 error with compatibility explanation.

MILESTONE 12.7 — Performance Baseline and Profiling
  This milestone establishes what is fast before load testing (Phase 13).
  
  Instrument these endpoints with detailed query profiling:
    POST /api/v2/invoices/confirm   (target: < 500ms P95)
    GET  /api/v2/dashboard/kpis     (target: < 200ms P95)
    GET  /api/v2/items/by-barcode   (target: < 50ms P95)
    GET  /api/v2/customers/search   (target: < 200ms P95)
    
  N+1 query detection middleware:
    In staging: log warning if any request makes > 3 DB queries
    
  Slow query log:
    Enable in PostgreSQL: log_min_duration_statement = 200ms
    Dashboard: slow query list in Grafana

═══════════════════════════════════════════
ACCEPTANCE CRITERIA
═══════════════════════════════════════════

✅ Event store: concurrent inserts on same aggregate → unique version constraint prevents duplicates
✅ CQRS: dashboard projection updated within 30 seconds of invoice confirmation (measured)
✅ Outbox: 100% of state-changing operations produce outbox events (audit report shows 100%)
✅ Inbox: replay 5 identical events → processed exactly once (verified via inbox_events table)
✅ DLQ: manually push bad message to DLQ → appears in admin UI → replay → processes correctly
✅ Saga monitoring: failed saga appears in dashboard, retry succeeds
✅ Schema registry: incompatible schema change → blocked (returns 422)
✅ Stale projection: when projection lag > tolerance → isStale: true in API response


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
  ERP-PLANNING/phase-completions/PHASE_12_COMPLETION.md

The report must be generated and saved BEFORE closing this session.

```