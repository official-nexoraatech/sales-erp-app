# ES-16 — Backend Performance & Hardening
## STATUS: ✅ COMPLETED 
## Sprint: 4 | Effort: 4–5 days | Risk: Medium
## Depends on: ES-03 (ledger), ES-13 (FIFO), ES-14 (validation)
## Unlocks: ES-17

---

## YOUR ROLE

You are the **Principal Backend Engineer + DevOps** on the NEXORAA Multi-Tenant Cloth Retail ERP.
Your mission: add missing database indexes, implement Redis caching for hot read paths, add circuit breakers for cross-service HTTP calls, harden rate limits, and add health check endpoints for all services.

---

## ═══════════════════════════════════════════
## PRE-FLIGHT CHECKLIST
## ═══════════════════════════════════════════

- [ ] Read `ERP-PLANNING/TECH_AUDIT.md`
- [ ] Read `ERP-PLANNING/CODING_STANDARDS.md`
- [ ] Read `ERP-PLANNING/phase-completions/ES-03_COMPLETION.md`
- [ ] Read `ERP-PLANNING/phase-completions/ES-13_COMPLETION.md`
- [ ] Read `apps/inventory-service/src/` — find existing Redis usage if any
- [ ] Read `packages/platform-sdk/src/` — find existing Redis client, circuit breaker, rate limiter
- [ ] Read `packages/db-client/migrations/` — list all existing indexes in migration files
- [ ] Check: which services lack a `GET /health` endpoint
- [ ] Check: does `packages/platform-sdk` have a `RedisClient` wrapper?
- [ ] Check `docker-compose.yml` for Redis service config
- [ ] Run `pnpm build` — confirm clean baseline
- [ ] Run `EXPLAIN ANALYZE` on at least 3 slow queries (identify from previous phases)

---

## ═══════════════════════════════════════════
## COMPLETED PHASES
## ═══════════════════════════════════════════

| Phase | Status | Key Changes Relevant to You |
|-------|--------|----------------------------|
| ES-03 ✅ | Inventory Ledger | inventory_ledger table now has data |
| ES-13 ✅ | Valuation | FIFO layers table; queries on (tenant_id, item_id, received_at) |
| ES-14 ✅ | Validation | Business rules validated at boundaries |

---

## ═══════════════════════════════════════════
## PROJECT CONTEXT
## ═══════════════════════════════════════════

### Tech Stack
Node.js 20 + TypeScript 5 strict | Fastify 4 | PostgreSQL 16 | Redis 7 | PgBouncer |
BullMQ + Redis | Kafka 3 | Turborepo + pnpm | Docker + Docker Compose | Vitest

### Multi-Tenant Rules
- Every Drizzle query: `.where(eq(table.tenantId, ctx.tenantId))`
- Redis key pattern: `tenant:{tenantId}:{entity}:{id}` — MANDATORY prefix
- Never cache cross-tenant data without tenant isolation

### Redis Caching Rules
```typescript
// Key convention: tenant:{tenantId}:{feature}:{key}
// Example: tenant:550e8400:items:itemcode:CLOTH-001

// TTL guidelines:
// Master data (items, customers, vendors): 5 minutes (300s)
// Configuration (settings, roles): 15 minutes (900s)
// Report results: 1 minute (60s)
// Session / JWT: handled by auth-service separately

// Invalidation: on write, invalidate affected keys
// Pattern: await redis.del(`tenant:${tenantId}:items:*`) — wildcard via SCAN + DEL
```

### Circuit Breaker Pattern
```typescript
// Use Opossum (npm: opossum) or implement simple state machine
// Config: 5 failures in 10s → open; 30s half-open; close on success
// Protect: HTTP calls from sales-service → inventory-service
//          HTTP calls from purchase-service → inventory-service

const circuitBreaker = new CircuitBreaker(inventoryLedgerHTTPCall, {
  timeout: 3000,
  errorThresholdPercentage: 50,
  resetTimeout: 30000,
});
circuitBreaker.fallback(() => { throw new ERPError('INVENTORY_SERVICE_UNAVAILABLE', ...); });
```

### Database Index Strategy
```
Every WHERE clause used frequently should have an index.
Multi-column index order: (tenant_id, ...) — tenant_id always first.
INCLUDE columns: for covering indexes that avoid heap fetches.
```

### Health Check Pattern
```typescript
fastify.get('/health', async (request, reply) => {
  const [dbOk, redisOk, kafkaOk] = await Promise.all([
    checkDB(), checkRedis(), checkKafka()
  ]);
  const status = (dbOk && redisOk && kafkaOk) ? 'healthy' : 'degraded';
  return reply.code(status === 'healthy' ? 200 : 503).send({
    status,
    checks: { db: dbOk, redis: redisOk, kafka: kafkaOk },
    version: process.env['SERVICE_VERSION'] ?? 'unknown',
    uptime: process.uptime(),
  });
});
```

### Coding Standards
- TypeScript strict — no `any`
- No `console.log` — use `packages/logger`
- `/* global process */` at top of files using `process.env`

---

## ═══════════════════════════════════════════
## OBJECTIVE
## ═══════════════════════════════════════════

1. Add missing database indexes for frequently-queried paths
2. Add Redis caching for item master data and customer data
3. Add circuit breakers to protect cross-service HTTP calls
4. Add rate limiting hardening beyond ES-01 (login rate limit)
5. Add health check endpoints to all microservices
6. Add Prometheus metrics for key counters

---

## ═══════════════════════════════════════════
## SCOPE
## ═══════════════════════════════════════════

### IN SCOPE

**Step 1 — Missing Database Indexes**

Create a new migration: `000X_es16_performance_indexes.sql`

Required indexes (verify each doesn't already exist before adding):
```sql
-- Invoice queries
CREATE INDEX IF NOT EXISTS idx_invoices_tenant_status_date 
  ON invoices(tenant_id, status, invoice_date DESC);
CREATE INDEX IF NOT EXISTS idx_invoices_tenant_customer 
  ON invoices(tenant_id, customer_id);
CREATE INDEX IF NOT EXISTS idx_invoices_tenant_due_date 
  ON invoices(tenant_id, due_date) WHERE status NOT IN ('PAID', 'CANCELLED');

-- Inventory
CREATE INDEX IF NOT EXISTS idx_inventory_ledger_tenant_item 
  ON inventory_ledger(tenant_id, item_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_fifo_layers_tenant_item_warehouse 
  ON inventory_fifo_layers(tenant_id, item_id, warehouse_id, received_at ASC) 
  WHERE remaining_qty > 0;

-- Purchase
CREATE INDEX IF NOT EXISTS idx_purchase_orders_tenant_status 
  ON purchase_orders(tenant_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_vendor_invoices_tenant_status 
  ON vendor_invoices(tenant_id, status);

-- Outbox / Inbox (critical for relay performance)
CREATE INDEX IF NOT EXISTS idx_outbox_events_tenant_status_created 
  ON outbox_events(tenant_id, status, created_at ASC) WHERE status = 'PENDING';
CREATE INDEX IF NOT EXISTS idx_inbox_events_event_id 
  ON inbox_events(event_id) WHERE processed_at IS NULL;

-- Search / Lookup
CREATE INDEX IF NOT EXISTS idx_items_tenant_code 
  ON items(tenant_id, item_code);
CREATE INDEX IF NOT EXISTS idx_customers_tenant_search 
  ON customers(tenant_id, customer_name text_pattern_ops);
```

**Step 2 — Redis caching (Item Master)**

`apps/inventory-service/src/domain/ItemCacheService.ts` (new file):

```typescript
export class ItemCacheService {
  async getItem(itemId: string, tenantId: string): Promise<Item | null>
  async setItem(item: Item, tenantId: string): Promise<void>  // TTL: 300s
  async invalidateItem(itemId: string, tenantId: string): Promise<void>
  async invalidateTenantItems(tenantId: string): Promise<void>
}
// Key: tenant:{tenantId}:item:{itemId}
```

Integrate in `ItemService`:
- `getItem()` → try cache first → on miss: DB fetch → cache result
- `updateItem()` / `deleteItem()` → invalidate cache after DB write

**Step 3 — Redis caching (Customer Master)**

Same pattern for customers in `sales-service`:
- Cache key: `tenant:{tenantId}:customer:{customerId}`
- TTL: 300s
- Invalidate on update

**Step 4 — Circuit Breaker for cross-service calls**

`packages/platform-sdk/src/circuitBreaker.ts` (new file):
Implement using `opossum` package (add to `packages/platform-sdk/package.json`).

Wrap in inventory-service internal HTTP calls:
- `apps/sales-service/src/` — wrap the `POST /internal/ledger` HTTP call
- `apps/purchase-service/src/` — wrap the `POST /internal/ledger` HTTP call

On circuit open: throw `ERPError('INVENTORY_SERVICE_UNAVAILABLE', 'Inventory service is temporarily unavailable. Try again in 30 seconds.', 503)`

**Step 5 — Rate limiting (BullMQ-based for all services)**

In each service's Fastify app startup:
- Add `@fastify/rate-limit` with these defaults:
  ```typescript
  { max: 200, timeWindow: '1 minute', keyGenerator: (req) => req.auth?.tenantId ?? req.ip }
  ```
- Specific routes can override with lower limits
- Use Redis as the rate limit store (already in stack)

(ES-01 already set login rate limit to 10/15min — don't change that)

**Step 6 — Health check endpoints**

Add `GET /health` to every service that is missing it:

Check each of these:
- `apps/auth-service`
- `apps/sales-service`
- `apps/purchase-service`
- `apps/inventory-service`
- `apps/accounting-service`
- `apps/hr-service`
- `apps/gst-service`
- `apps/report-service`
- `apps/event-service`
- `apps/search-service`

Health check must verify: DB connection, Redis connection (if used), Kafka producer connection (if used).

**Step 7 — Prometheus metrics**

`packages/platform-sdk/src/metrics.ts` (new file):
```typescript
import client from 'prom-client';

export const httpRequestDuration = new client.Histogram({
  name: 'http_request_duration_seconds',
  help: 'HTTP request duration',
  labelNames: ['method', 'route', 'status_code', 'service'],
});

export const outboxRelayTotal = new client.Counter({
  name: 'outbox_relay_total',
  help: 'Total outbox events relayed',
  labelNames: ['tenant_id', 'event_type'],
});
```

Add `GET /metrics` endpoint to each service (Prometheus scrape endpoint).
Use `prom-client` package (add to `packages/platform-sdk/package.json`).

### OUT OF SCOPE
- PgBouncer configuration (infrastructure layer)
- PostgreSQL read replicas
- Elasticsearch query optimization (separate)
- CDN / static asset optimization

---

## ═══════════════════════════════════════════
## TESTING REQUIREMENTS
## ═══════════════════════════════════════════

`apps/inventory-service/src/__tests__/item-cache.test.ts`:
1. `getItem()` on cache miss → fetches from DB, stores in cache (Redis key exists after)
2. `getItem()` on cache hit → returns cached value (DB not queried — mock DB)
3. `updateItem()` → cache key deleted after update
4. Cache key format: `tenant:{tenantId}:item:{itemId}` (verified by Redis key inspection)

`apps/sales-service/src/__tests__/circuit-breaker.test.ts`:
5. inventory-service 5× 500 errors → circuit opens → 6th call gets 503 immediately (no HTTP)
6. After 30s reset → circuit half-opens → next success closes it

`apps/sales-service/src/__tests__/health.test.ts`:
7. `GET /health` with all deps healthy → 200 `{ status: 'healthy' }`
8. `GET /health` with DB down → 503 `{ status: 'degraded', checks: { db: false } }`

---

## ═══════════════════════════════════════════
## BUILD VERIFICATION
## ═══════════════════════════════════════════

```bash
pnpm --filter @erp/platform-sdk build
pnpm --filter @erp/inventory-service build
pnpm --filter @erp/sales-service build
pnpm --filter @erp/purchase-service build
pnpm --filter @erp/db-client build
pnpm lint
pnpm test --filter @erp/inventory-service
pnpm test --filter @erp/sales-service
```

---

## ═══════════════════════════════════════════
## VERIFICATION CHECKLIST
## ═══════════════════════════════════════════

- [ ] New migration applies cleanly — only adds indexes (no table changes)
- [ ] `GET /api/v1/inventory/items/:id` cache hit visible (Redis key present after first call)
- [ ] Cache invalidated after `PUT /api/v1/inventory/items/:id`
- [ ] Circuit breaker opens after 5 consecutive failures to inventory-service
- [ ] All services respond to `GET /health` with correct status
- [ ] `GET /metrics` returns Prometheus text format
- [ ] 8 tests pass
- [ ] `pnpm lint` passes

---

## ═══════════════════════════════════════════
## REGRESSION CHECKLIST
## ═══════════════════════════════════════════

- [ ] Inventory ledger writes (ES-03) still work
- [ ] FIFO layer queries still correct (ES-13)
- [ ] Outbox relay (ES-02) still works with new outbox index
- [ ] Login rate limit (10/15min from ES-01) unchanged
- [ ] All existing test suites pass

---

## ═══════════════════════════════════════════
## DEFINITION OF DONE
## ═══════════════════════════════════════════

- [ ] 9 missing indexes added via migration
- [ ] Redis caching for items and customers
- [ ] Circuit breakers on cross-service HTTP calls
- [ ] Health check on all 10 services
- [ ] Prometheus metrics endpoint on all services
- [ ] 8 tests pass
- [ ] Completion report saved at `ERP-PLANNING/phase-completions/ES-16_COMPLETION.md`

---

## ═══════════════════════════════════════════
## COMPLETION REPORT TEMPLATE
## ═══════════════════════════════════════════

**Save as:** `ERP-PLANNING/phase-completions/ES-16_COMPLETION.md`

```markdown
# ES-16 Completion Report — Backend Performance & Hardening
**Date:** [YYYY-MM-DD]
**Status:** COMPLETE

## Indexes Added
| Index Name | Table | Columns | Purpose |
|------------|-------|---------|---------|
[List all new indexes]

## Caching
- Items cache: TTL 300s, key pattern `tenant:{id}:item:{id}` [IMPLEMENTED]
- Customers cache: TTL 300s [IMPLEMENTED]

## Circuit Breakers
- sales-service → inventory-service: [OPOSSUM — 5 failures / 10s window / 30s reset]
- purchase-service → inventory-service: [OPOSSUM — same config]

## Health Checks
- Services with /health before ES-16: [N]
- Services with /health after ES-16: [10]

## Tests: 8/8 PASS | lint: PASS | build: PASS

## Performance Improvement (if benchmarked)
[Optional: before/after latency for item lookup]
```
