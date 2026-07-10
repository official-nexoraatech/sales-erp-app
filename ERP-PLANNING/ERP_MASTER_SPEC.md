# ERP MASTER SPECIFICATION
## Cloth Retail ERP — Architecture Bible
### Version: 1.0 | Status: APPROVED | Never Rewrite This Document

---

> **This document is the single source of truth for all architecture decisions.
> Every Claude session, every developer, every phase MUST follow this document.
> Never redesign. Never simplify. Only implement.**

---

## 1. PROJECT OVERVIEW

**Product:** Enterprise Cloth Retail ERP (SaaS, Multi-Tenant)
**Domain:** Indian cloth retail — sarees, dress material, suiting, shirting, fabric by meter, readymade garments, alteration services
**Target Users:** Small to mid-size cloth retail shops (1–20 branches), wholesale distributors, garment manufacturers
**Architecture Style:** Event-Driven Microservices + CQRS + Event Sourcing (selective) + Saga Orchestration
**Deployment:** Kubernetes (cloud-native), multi-tenant SaaS
**Compliance:** GST (Indian), Indian Labour Law, Indian Accounting Standards, PDPB (India data privacy)

---

## 2. TECHNOLOGY STACK

### Backend
| Layer | Technology | Version |
|---|---|---|
| Runtime | Node.js | 20 LTS |
| Language | TypeScript | 5.x strict mode |
| API Framework | Fastify | 4.x |
| ORM | Drizzle ORM | latest |
| Database | PostgreSQL | 16 |
| Cache | Redis | 7 Cluster |
| Message Bus | Kafka | 3.6 |
| Search | Elasticsearch | 8.x |
| Object Storage | S3-compatible (MinIO dev, AWS S3 prod) | - |
| PDF Generation | Puppeteer (headless Chrome) | latest |
| Job Scheduler | BullMQ | latest |
| Validation | Zod | 3.x |
| Auth | JWT (RS256) + Argon2id passwords | - |
| Secrets | HashiCorp Vault | latest |
| Tracing | OpenTelemetry + Jaeger | latest |
| Metrics | Prometheus + Grafana | latest |
| Logging | Winston + Loki | latest |

### Frontend
| Layer | Technology | Version |
|---|---|---|
| Framework | React | 19 |
| Language | TypeScript | 5.x strict mode |
| Build Tool | Vite | 6.x |
| Routing | React Router | 7.x |
| Server State | TanStack React Query | 5.x |
| Client State | Zustand | 5.x |
| Forms | React Hook Form + Zod | 7.x + 4.x |
| UI Styles | Tailwind CSS | v4 |
| Icons | Lucide React | latest |
| Charts | Recharts | 3.x |
| Notifications | React Hot Toast | latest |
| Dark Mode | `@custom-variant dark` + `darkMode: 'class'` | Tailwind v4 |

### Infrastructure
| Component | Technology |
|---|---|
| Container Orchestration | Kubernetes 1.29+ |
| Service Mesh | Istio 1.20+ |
| Container Registry | Docker Hub / AWS ECR |
| IaC | Helm Charts + Terraform |
| CI/CD | GitHub Actions |
| Secrets | HashiCorp Vault (Kubernetes auth) |
| Monitoring | Prometheus + Grafana + Jaeger |
| Log Aggregation | Loki + Grafana |

---

## 3. REPOSITORY STRUCTURE

```
/
├── apps/
│   ├── api-gateway/          # Kong / custom Fastify gateway — descoped as of ES-27 (stub only,
│   │                         # see ERP-PLANNING/phase-completions/ES-27_COMPLETION.md); services
│   │                         # are reached directly until "ES-28 — API Gateway Implementation"
│   ├── sales-service/        # Sales, Invoices, Quotations, POS
│   ├── inventory-service/    # Stock, Reservations, Transfers
│   ├── accounting-service/   # Double-entry, Ledger, Reports
│   ├── purchase-service/     # PO, GRN, Supplier Payments
│   ├── hr-service/           # Employees, Attendance, Payroll
│   ├── gst-service/          # GST returns, e-Invoice, e-Way Bill
│   ├── notification-service/ # SMS, Email, WhatsApp, In-App
│   ├── scheduler-service/    # BullMQ jobs, cron management
│   ├── search-service/       # Elasticsearch wrapper
│   ├── report-service/       # Report generation, PDF export
│   ├── auth-service/         # JWT, users, roles, permissions
│   ├── tenant-service/       # Tenant provisioning, lifecycle
│   ├── web-frontend/         # Main React SPA (ERP web app)
│   └── pos-frontend/         # POS-specific React app (touch UI)
│
├── packages/
│   ├── platform-sdk/         # PlatformContext and all sub-clients
│   ├── shared-types/         # TypeScript interfaces, enums, permissions
│   ├── shared-utils/         # Date formatting, Indian number formatting
│   ├── db-client/            # Drizzle schema + migrations
│   ├── event-bus-client/     # Kafka producer/consumer wrapper
│   ├── cache-client/         # Redis wrapper
│   ├── logger/               # Winston structured logger
│   └── config/               # Environment configuration
│
├── infrastructure/
│   ├── k8s/                  # Kubernetes manifests
│   ├── helm/                 # Helm charts per service
│   ├── istio/                # Istio configs (mTLS, retries, circuit breakers)
│   └── terraform/            # Cloud infrastructure
│
├── ERP-PLANNING/             # This folder — never deployed
└── docker-compose.yml        # Local development
```

---

## 4. ARCHITECTURE PATTERNS

### 4.1 Platform SDK (MANDATORY — Never Bypass)
Every service handler receives a `PlatformContext`. All infrastructure access MUST go through the SDK.

```typescript
// CORRECT:
async function createInvoice(cmd: CreateInvoiceCommand, ctx: PlatformContext) {
  await ctx.db.invoices.insert(data);          // Tenant-scoped DB
  await ctx.cache.set('key', value, 300);      // Tenant-namespaced cache
  await ctx.events.publish(Event.INVOICE_CONFIRMED, payload); // Tenant-tagged
  await ctx.audit.log({ action: 'INVOICE_CREATED', entityId: id });
  await ctx.locks.withLock(`invoice:${id}`, 5000, fn);
}

// WRONG — never access infrastructure directly:
await redis.set('key', value);       // NO — bypasses tenant isolation
await db.query('SELECT ...');        // NO — bypasses tenant filtering
await kafka.produce('topic', msg);   // NO — bypasses schema validation
```

### 4.2 Tenant Isolation (CRITICAL)
- Every database table has `tenant_id INTEGER NOT NULL`
- Tenant isolation is enforced at the **application layer** via hand-written
  `WHERE tenant_id = ...` predicates in `TenantScopedDatabase` (`packages/platform-sdk/src/database.ts`)
  and route-level query filters — **no PostgreSQL Row-Level Security policies exist** in any
  migration (verified ES-25, M14: zero `CREATE POLICY`/`ENABLE ROW LEVEL SECURITY` statements
  repo-wide). `TenantScopedDatabase.transaction()` sets the `app.current_tenant_id` session GUC,
  but it is currently inert — no RLS policy reads it. Adding real RLS policies as defense-in-depth
  is deferred to a dedicated security-hardening phase, not this hygiene pass.
- Every Redis key prefixed: `tenant:{tenantId}:{key}`
- Every Elasticsearch index scoped: `erp_{tenantId}_{entity}`
- Every file storage path prefixed: `/tenants/{tenantId}/`
- Every Kafka event payload contains `tenantId`
- Missing tenant context → throw `SecurityError` immediately

### 4.3 CQRS Pattern
- **Write Model**: Normalized tables, transactions, ACID
- **Read Model**: Projection tables, pre-aggregated, eventual consistency
- Projections updated by event consumers (async, < 30 seconds)
- API reads from projections for: Dashboard, CustomerBalance, StockLevel, CustomerAging
- API reads from live DB for: single entity lookup, transaction detail, real-time stock check
- Every projection includes `lastUpdatedAt` and `lagMs` in API response metadata

### 4.4 Event-Driven Architecture (Outbox Pattern — MANDATORY)

**The Golden Rule:** An event is NEVER published directly from application code.
It is always written to `outbox_events` in the SAME database transaction as the business data.
A separate publisher process reads outbox and publishes to Kafka.

```typescript
// Inside a DB transaction — CORRECT:
await trx.invoices.insert(invoiceData);
await trx.outboxEvents.insert({
  eventId: ulid(),
  eventType: 'INVOICE_CONFIRMED',
  aggregateType: 'Invoice',
  aggregateId: invoice.id,
  payload: buildPayload(invoice),
  tenantId
});
// Both committed atomically. Publisher handles Kafka delivery separately.
```

### 4.5 Inbox Pattern (Idempotency — MANDATORY)
Every event consumer checks inbox before processing:

```typescript
async function handleInvoiceConfirmed(event) {
  await db.transaction(async (trx) => {
    const existing = await trx.inboxEvents.findOne({
      eventId: event.eventId, consumerService: 'INVENTORY'
    });
    if (existing?.status === 'PROCESSED') return; // Idempotent skip
    
    await trx.inboxEvents.insert({ eventId: event.eventId, ... });
    // ... do work ...
    await trx.inboxEvents.update({ eventId }, { status: 'PROCESSED' });
  });
}
```

### 4.6 Saga Orchestration
Multi-step operations use the Saga Orchestrator:
- Steps classified as: `COMPENSATABLE`, `RETRYABLE`, or `IRREVERSIBLE`
- On step failure: compensate all completed COMPENSATABLE steps in reverse
- IRREVERSIBLE steps (SMS sent, WhatsApp sent): trigger correction message + manual review ticket
- All sagas logged in `saga_log` table with full step history

**Sagas implemented:**
1. INVOICE_CREATION (10 steps)
2. PURCHASE_GRN (5 steps)
3. STOCK_TRANSFER (8 steps)
4. PAYMENT_PROCESSING (6 steps)
5. PAYROLL_PROCESSING (7 steps)
6. YEAR_END_CLOSE (8 steps)
7. SALE_RETURN (6 steps)
8. CUSTOMER_MERGE (5 steps)
9. TENANT_CLOSE (10 steps)

### 4.7 Optimistic Locking
All mutable entities have `version INTEGER NOT NULL DEFAULT 0`.
Update pattern:
```sql
UPDATE invoices SET status = $1, version = version + 1
WHERE id = $2 AND version = $3;  -- Fails if someone else updated
-- rows_affected = 0 → throw OptimisticLockError → client must retry
```

### 4.8 Distributed Locks (Redis Redlock)
Used for: stock deduction, invoice number generation, payroll processing, job scheduling.
```typescript
await ctx.locks.withLock(`stock:${itemId}:${warehouseId}`, 5000, async () => {
  // Critical section — atomic stock deduction
});
```

### 4.9 Event Sourcing (Selective Application)
Applied to: `inventory_ledger`, `financial_entries` (append-only, never update/delete).
These tables are the authoritative history. Current quantities are derived by summation.
Snapshots taken every 50–100 events per aggregate for performance.

### 4.10 Distributed Consistency — Decision Guide (PG-011)

This system has **no 2PC/XA distributed transaction coordinator, and never should have one**.
For Kafka + a shared Postgres, a 2PC coordinator adds an availability-reducing single point
of failure to solve a problem the three mechanisms below already solve without it. This is a
deliberate architectural stance, not an oversight — do not introduce one without re-reading
this section first.

The three sanctioned pillars, and when to reach for each:

| Need | Pillar | Where |
|---|---|---|
| "I made a local write and must reliably tell other services about it" (no synchronous wait on their reaction) | **Outbox pattern** (§4.4) | `event-service`'s `OutboxRelayWorker` |
| "I must call out to 2+ systems in sequence within one logical operation, and a later step failing should compensate earlier ones" | **Saga orchestration** (§4.6) | `@erp/sdk`'s `SagaOrchestrator` |
| "The same logical operation might arrive more than once (client retry, offline-queue replay, at-least-once Kafka redelivery, DLQ replay) and must not be double-applied" | **Idempotency keys** (this section) | `@erp/sdk`'s `idempotency.ts` |

**Idempotency keys — two distinct strategies, kept separate on purpose:**

- **Hard uniqueness** — the operation must never be double-applied, ever. Backed by a
  Postgres unique constraint (`tenantId` is always the first column, e.g.
  `invoices_tenant_client_operation_id`), translated from a raw `23505` into a typed
  `409 DUPLICATE_OPERATION` instead of an opaque `500`. Use `@erp/sdk`'s
  `isUniqueConstraintViolation()` / `withIdempotentInsert()` / `DuplicateOperationError`.
  This is the correct choice for financial-record creation (invoices, customers, POS sales)
  — the reference implementation these were extracted from is
  `apps/sales-service/src/domain/InvoiceService.ts`.
- **Soft, time-windowed dedup** — re-sending after the bucket expires is acceptable (e.g.
  notification sends, where resending after 5 minutes is not a correctness bug). Use
  `@erp/sdk`'s `deriveTimeBucketedDedupKey()`, generalized from
  `apps/notification-service/src/domain/NotificationEngine.ts`'s `deriveIdempotencyKey`.
  A hard unique constraint is the wrong tool here; a hash-based dedup key is the wrong tool
  for financial-record creation. Pick based on which failure mode is unacceptable, not habit.

This is distinct from the **Inbox pattern** (§4.5), which is consumer-side dedup for
Kafka event processing (keyed by `eventId` + `consumerService`) — idempotency keys (this
section) are for API-level writes that might be retried by a client or an offline queue,
not for event consumption.

Every idempotency key or unique constraint must include `tenantId` as its first component —
a global, non-tenant-scoped key is a cross-tenant collision risk.

---

## 5. DATABASE CONVENTIONS

### 5.1 Naming
- Tables: `snake_case` plural nouns (`invoice_lines`, `purchase_orders`)
- Columns: `snake_case` (`created_at`, `tenant_id`, `grand_total`)
- Indexes: `idx_{table}_{columns}` (`idx_invoices_tenant_date`)
- Foreign Keys: `fk_{table}_{ref_table}` (auto-named by Drizzle)
- Enums: defined as `VARCHAR(50)` with CHECK constraints (not PostgreSQL ENUM type)

### 5.2 Mandatory Columns on Every Table
```sql
tenant_id    INTEGER NOT NULL                    -- Always first
created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()  -- Updated by trigger
created_by   INTEGER NOT NULL                    -- User ID
version      INTEGER NOT NULL DEFAULT 0          -- Optimistic locking
```

### 5.3 Soft Delete
Never hard-delete records that have business history.
```sql
deleted_at   TIMESTAMPTZ    -- NULL = active, timestamp = deleted
deleted_by   INTEGER
```
All queries automatically filter `WHERE deleted_at IS NULL` via SDK.

### 5.4 Temporal History
Critical entities (customers, items, invoices, employees) have `_history` tables.
DB trigger archives previous state on every UPDATE.
Partitioned by year: `customers_history_2025`, `customers_history_2026`

### 5.5 Partitioning
Large append-only tables partitioned by year:
- `inventory_ledger` → `inventory_ledger_2025`, `inventory_ledger_2026`
- `financial_entries` → `financial_entries_2025`, `financial_entries_2026`
- `event_store` → `event_store_2025`, `event_store_2026`
- `audit_log` → `audit_log_2025`, `audit_log_2026`
- `outbox_events` → `outbox_events_2025`

Maintenance job creates next year's partition on December 1.

### 5.6 Identifiers
- Primary keys: `BIGSERIAL` (for entities), `UUID` (for saga/correlation IDs)
- Event IDs: `ULID` (sortable, timestamp-prefixed, use `ulid` package)
- Correlation IDs: `UUIDv7` (sortable UUID, better for indexes)

### 5.7 Encrypted Fields
These fields are AES-256-GCM encrypted at application layer before storing:
- `customers.gstin`, `customers.pan`
- `employees.pan`, `employees.bank_account_no`, `employees.salary`
- `suppliers.bank_account_no`
- Companion `_hash` column (HMAC) exists for exact-match search

### 5.8 Migration Strategy
All migrations follow Expand/Contract (zero downtime):
1. EXPAND: Add new column (nullable, backward-compatible)
2. MIGRATE: Backfill old data (background job, batched)
3. DEPLOY: New code uses new column
4. CONTRACT: Remove old column after 1 sprint

Never use PostgreSQL ENUM types (hard to migrate). Use VARCHAR(50) with check constraints.

---

## 6. API STANDARDS

### 6.1 URL Conventions
```
GET    /api/v2/{resource}              List (paginated)
POST   /api/v2/{resource}              Create
GET    /api/v2/{resource}/:id          Get one
PUT    /api/v2/{resource}/:id          Full update
PATCH  /api/v2/{resource}/:id          Partial update
DELETE /api/v2/{resource}/:id          Soft delete
POST   /api/v2/{resource}/:id/{action} State change (confirm, cancel, approve)
```
Versioning convention for breaking changes (new prefix alongside old, retire only after both frontends migrate): see `ERP-PLANNING/API_VERSIONING.md` (PG-010).

### 6.2 Response Envelope
```typescript
// Success list:
{ "data": { "content": [...], "totalElements": 100, "page": 0, "size": 20, "totalPages": 5 } }

// Success single:
{ "data": { ...entity } }

// Success with projection metadata (CQRS reads):
{ "data": { ...entity }, "_projection": { "lastUpdatedAt": "...", "lagMs": 1200, "isStale": false } }

// Error:
{ "error": { "code": "INSUFFICIENT_STOCK", "message": "Available: 3, Requested: 5",
             "field": "quantity", "correlationId": "abc-123" } }
```

### 6.3 Pagination Query Params
```
?page=0&size=20&sort=createdAt,desc&search=ravi&status=ACTIVE
```
Default: `page=0`, `size=20`, max `size=100`.

### 6.4 Idempotency
All POST/PUT endpoints accept `Idempotency-Key` header.
Server stores result for 7 days. Same key → return stored result.

### 6.5 Error Codes (Machine-Readable)
```
INSUFFICIENT_STOCK, CREDIT_LIMIT_EXCEEDED, DUPLICATE_INVOICE_NUMBER,
INVALID_GSTIN, INVALID_HSN, OPTIMISTIC_LOCK_CONFLICT, VALIDATION_ERROR,
PERMISSION_DENIED, TENANT_SUSPENDED, WORKFLOW_APPROVAL_REQUIRED,
FINANCIAL_PERIOD_CLOSED, INSUFFICIENT_PERMISSIONS
```

### 6.6 Authentication
All requests (except `/auth/*` and `/health`) require:
```
Authorization: Bearer {accessToken}
```
Gateway validates JWT, injects tenant + user into request context.

---

## 7. EVENT STANDARDS

### 7.1 Event Naming Convention
`{ENTITY}_{PAST_TENSE_ACTION}` in SCREAMING_SNAKE_CASE
```
INVOICE_CONFIRMED, INVOICE_CANCELLED, INVOICE_PAYMENT_RECORDED
STOCK_DEDUCTED, STOCK_RECEIVED, RESERVATION_CREATED, RESERVATION_EXPIRED
CUSTOMER_CREATED, CUSTOMER_CREDIT_LIMIT_CHANGED, CUSTOMER_BLOCKED
GRN_APPROVED, PO_CREATED, PURCHASE_RETURN_APPROVED
PAYMENT_RECEIVED, PAYMENT_MADE, CHEQUE_BOUNCED
EMPLOYEE_JOINED, PAYROLL_PROCESSED, LEAVE_APPROVED
```

### 7.2 Event Payload Structure (MANDATORY)
```typescript
interface ERPEventPayload {
  eventId: string;          // ULID — globally unique
  eventType: string;        // From enum above
  schemaVersion: number;    // For upcasting
  aggregateType: string;    // 'Invoice', 'Customer', etc.
  aggregateId: number;
  tenantId: number;
  userId: number;           // Who triggered
  correlationId: string;    // UUIDv7 — traces request chain
  causationId: string;      // Parent event ID (if triggered by another event)
  occurredAt: string;       // ISO 8601 timestamp
  payload: Record<string, unknown>; // Event-specific data
}
```

### 7.3 Kafka Topic Naming
`erp.{domain}.{entity}.{action}` (lowercase, dots as separators)
```
erp.sales.invoice.confirmed
erp.inventory.stock.deducted
erp.accounting.entry.posted
erp.gst.einvoice.generated
erp.hr.payroll.processed
```

DLQ topics: same name + `.dlq` suffix
```
erp.sales.invoice.confirmed.dlq
```

---

## 8. SECURITY STANDARDS

### 8.1 Authentication
- Passwords: Argon2id (NOT bcrypt, NOT sha256)
- Access Token: RS256 JWT, 15 minute TTL
- Refresh Token: stored as SHA-256 hash in DB, 7 day TTL
- Account lockout: 5 failed attempts → 15 min lockout
- Never log passwords, tokens, or API keys

### 8.2 Authorization
- Every API endpoint declares required permission
- `requirePermission('INVOICE_CREATE')` middleware
- Never check permissions in business logic — only at controller/route level
- Branch-scoped access: users see only assigned branches' data

### 8.3 Data Classification
| Class | Examples | Encryption | Logging |
|---|---|---|---|
| PUBLIC | Item catalog, price list | None | Full |
| INTERNAL | Invoices, transactions | At rest | Full |
| CONFIDENTIAL | Customer GSTIN, PAN | Field-level | Mask |
| RESTRICTED | Salary, bank accounts | Field-level + TLS | Never log |

### 8.4 Input Validation
- All input validated with Zod schemas at API boundary
- SQL injection: impossible via Drizzle ORM (parameterized queries only)
- XSS: React escapes by default; sanitize any HTML content
- File uploads: virus scan before processing, type whitelist
- Never use `eval()`, `innerHTML` with user data, or `dangerouslySetInnerHTML`

### 8.5 Secrets
- Never in source code, never in environment files committed to git
- All secrets in HashiCorp Vault
- Access via Kubernetes service account identity
- Rotated quarterly (automated)

---

## 9. PLATFORM SDK REFERENCE

```typescript
class PlatformContext {
  // Tenant-scoped database (auto WHERE tenant_id)
  db: TenantScopedDatabase
  
  // Redis cache (auto prefix tenant:{id}:)
  cache: TenantScopedCache
  
  // Kafka event bus (schema validated, outbox pattern)
  events: PlatformEventBus
  
  // Redis distributed locks (Redlock + fencing tokens)
  locks: DistributedLockManager
  
  // Audit log (append-only, immutable)
  audit: PlatformAuditLogger
  
  // Feature flags (L1+L2 cached, hot-reload)
  features: PlatformFeatureFlags
  
  // File storage (tenant-scoped) — present only when the service configures
  // `storage` in PlatformContextFactory; undefined otherwise
  files?: PlatformAttachments
  
  // Approval workflow engine
  workflows: PlatformWorkflowEngine
  
  // Business rule engine
  rules: PlatformRuleEngine
  
  // OpenTelemetry tracing
  trace<T>(spanName: string, fn: () => Promise<T>): Promise<T>
}
```

**Not implemented on `PlatformContext`** (resolved ES-25 H9 — access these directly instead of
through the context):
- **Metrics** — no `ctx.metrics`. Services use `packages/logger`'s `createMetricsHandler` /
  `createHttpMetricsHook` to expose Prometheus metrics on `/metrics` directly.
- **Notifications** — no `ctx.notifications`. Services call notification-service's HTTP API
  directly.
- **Search** — no `ctx.search`. Services call search-service's HTTP API directly.

These three were never built as SDK sub-clients; each has a working equivalent elsewhere. This is
a documentation correction, not a functional gap — see `ES-25_COMPLETION.md` for the decision
record.

---

## 10. MODULE LIST AND DEPENDENCY ORDER

```
LAYER 0 — Infrastructure (no dependencies)
  PostgreSQL, Redis, Kafka, Elasticsearch, Vault, MinIO, Kubernetes

LAYER 1 — Platform SDK (depends on Layer 0)
  PlatformContext, Auth, RBAC, Observability

LAYER 2 — Platform Engines (depends on Layer 1, parallel)
  TenantEngine, WorkflowEngine, NotificationEngine, DocumentEngine,
  NumberSeriesEngine, SchedulerEngine, ImportExportEngine, SearchEngine, RuleEngine

LAYER 3 — Master Data (depends on Layer 2, parallel within)
  Organization → Branch → Warehouse
  Users → Roles (depends on Branch)
  Customers, Suppliers (depends on Branch)
  Categories → Brands → Units → Items (in this order)
  HSN Master, GST Rates (no dependencies in master data)
  Chart of Accounts (depends on Organization)
  Price Lists (depends on Items)
  Barcodes (depends on Items)

LAYER 4 — Inventory Core (depends on Layer 3)
  InventoryLedger → StockReservations → StockTransfers
  → StockAdjustments → PhysicalVerification → FabricRolls

LAYER 5 — Transactions (depends on Layer 4, Sales and Purchase parallel)
  Sales: Quotation → Invoice → POS → PaymentReceived → SaleReturn → CreditNote
  Purchase: PO → GRN → PurchaseReturn → SupplierPayment
  Both post to Accounting simultaneously

LAYER 6 — Accounting (built alongside Layer 5)
  ChartOfAccounts → JournalEngine → PostingMatrix
  → TrialBalance → P&L → BalanceSheet → BankReconciliation → YearClose

LAYER 7 — GST (depends on Layer 5 + 6)
  GSTRegister → GSTR1 → GSTR3B → eInvoice → eWayBill → GSTR2AReconciliation

LAYER 8 — HR (independent of Layer 5-7)
  Employees → Attendance → Leave → Payroll → Alterations

LAYER 9 — CRM (depends on Layer 5)
  CustomerActivity → HealthScoring → Campaigns → FestivalPlanning

LAYER 10 — Reports (depends on all transaction layers)
  Per-module reports built alongside each layer

LAYER 11 — Distributed Platform (added incrementally from Layer 5)
  EventStore → CQRSProjections → OutboxPublisher → SagaOrchestrator → SchemaRegistry

LAYER 12 — Enterprise Hardening (after all layers)
  PenTesting, LoadTesting, ChaosEngineering, BackupDrills

LAYER 13 — Production Readiness (final)
  DataMigration → UAT → Pilot → GoLive
```

---

## 11. FEATURE FLAG REGISTRY

| Flag Key | Default | Controls |
|---|---|---|
| `pos.enabled` | true | POS module |
| `gst.e-invoice.enabled` | false | IRN generation |
| `gst.e-way-bill.enabled` | false | e-Way Bill |
| `multi-branch.enabled` | false | Branch management |
| `inventory.fabric-rolls.enabled` | false | Fabric roll tracking |
| `inventory.variants.enabled` | true | Size/color variants |
| `inventory.reservations.enabled` | true | Stock reservations |
| `sales.quotations.enabled` | true | Quotation module |
| `sales.loyalty.enabled` | false | Loyalty program |
| `hr.alterations.enabled` | true | Alteration orders |
| `hr.tailoring.enabled` | false | Piece-rate payroll |
| `finance.double-entry.enabled` | true | Accounting module |
| `finance.tds.enabled` | false | TDS management |
| `integrations.whatsapp.enabled` | false | WhatsApp Business |
| `integrations.sms.enabled` | true | SMS notifications |
| `integrations.payment-gateway.enabled` | false | Online payment |
| `platform.ai.enabled` | false | AI recommendations |
| `platform.offline.enabled` | false | POS offline mode |

---

## 12. PERMISSION CONSTANTS (ABBREVIATED)

Full list in `packages/shared-types/src/permissions.ts`. Key groups:

```
ORGANIZATION_*, BRANCH_*, WAREHOUSE_*
USER_*, ROLE_*
CUSTOMER_*, SUPPLIER_*
ITEM_*, CATEGORY_*, BRAND_*, UNIT_*
INVOICE_*, QUOTATION_*, PAYMENT_IN_*, SALE_RETURN_*, CREDIT_NOTE_*
PO_*, GRN_*, PURCHASE_RETURN_*, PAYMENT_OUT_*, EXPENSE_*
ACCOUNT_*, VOUCHER_*, JOURNAL_*, LEDGER_*, FINANCIAL_YEAR_*
GST_*, EINVOICE_*, EWAY_BILL_*
EMPLOYEE_*, ATTENDANCE_*, LEAVE_*, PAYROLL_*, SALARY_*
REPORT_*, STOCK_*, CONFIG_*, AUDIT_LOG_VIEW
CREDIT_LIMIT_OVERRIDE, DISCOUNT_OVERRIDE, PRICE_OVERRIDE
```

---

## 13. KEY BUSINESS RULES (NON-NEGOTIABLE)

1. **Stock never goes negative** — atomic SQL check: `UPDATE items SET qty = qty - :req WHERE qty >= :req`
2. **All financial entries are balanced** — DB trigger validates SUM(debit) = SUM(credit) per journal
3. **Inventory ledger is append-only** — never UPDATE or DELETE inventory_ledger rows
4. **Audit log is immutable** — only INSERT on audit_log, no UPDATE/DELETE ever
5. **GST auto-computed** — if seller state = place of supply → CGST+SGST, else IGST
6. **Invoice date cannot be in closed financial year** — checked at API layer
7. **Credit limit enforced** — invoice save fails if customer balance + new invoice > credit limit (unless CREDIT_LIMIT_OVERRIDE)
8. **Price floor enforced** — sale price cannot go below `min_sale_price` (unless PRICE_OVERRIDE)
9. **e-Invoice mandatory** — B2B invoices above configured threshold MUST get IRN before delivery
10. **Duplicate prevention** — invoice numbers are unique per tenant per financial year (DB unique constraint)
11. **Soft delete only** — never hard-delete customers, suppliers, items, employees with history
12. **Tenant isolation absolute** — query without tenant context is a security error, not a bug

---

## 14. APPROVAL WORKFLOW TRIGGERS

| Trigger | Threshold | Approver |
|---|---|---|
| Sale invoice | Amount > configurable | Sales Manager / Owner |
| Discount | % > configurable cap | Sales Manager |
| Purchase Order | Amount > configurable | Purchase Manager / Owner |
| GRN price variance | > 5% from PO | Purchase Manager |
| Expense | Amount > configurable | Department Head |
| Stock adjustment | Value > configurable | Inventory Manager |
| Payroll release | Always | Owner |
| Year-end close | Always | Owner (+ second factor) |
| New customer credit limit | Limit > configurable | Sales Manager |

---

## 15. CODING STYLE QUICK REFERENCE

See `CODING_STANDARDS.md` for full detail.

```typescript
// Function naming: verb + noun (camelCase)
async function createInvoice(), async function getCustomerById()

// File naming: PascalCase for classes/components, kebab-case for utils
InvoiceService.ts, createInvoice.handler.ts, invoice.utils.ts

// Async: always async/await, never callbacks
// Error handling: throw typed errors, never swallow
// Logging: use ctx.logger, never console.log in production
// Types: explicit return types on all public functions
// Imports: absolute paths via tsconfig paths, no relative ../../../
```

---

*Last Updated: 2026-06-29 | Approved By: Chief ERP Architect*
*This document evolves only when architecture decisions change — which requires team consensus.*
