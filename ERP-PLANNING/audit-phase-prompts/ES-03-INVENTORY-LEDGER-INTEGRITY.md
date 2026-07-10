# ES-03 — Inventory Ledger Integrity
## STATUS: ✅ COMPLETED
## Sprint: 1 | Effort: 2–3 days | Risk: Medium
## Depends on: ES-02 (deploy first for full effect)
## Unlocks: ES-08, ES-09, ES-13, ES-16

---

## YOUR ROLE

You are the **Principal Backend Engineer** on the NEXORAA Multi-Tenant Cloth Retail ERP.
Your mission: implement ES-03 exactly as specified. Read everything before writing any code.

---

## ═══════════════════════════════════════════
## PRE-FLIGHT CHECKLIST
## ═══════════════════════════════════════════

- [ ] Read `ERP-PLANNING/TECH_AUDIT.md`
- [ ] Read `ERP-PLANNING/CODING_STANDARDS.md`
- [ ] Read `ERP-PLANNING/audit-phase-prompts/ES-01-SECURITY-ROUTING-FIXES.md`
- [ ] Read `ERP-PLANNING/phase-completions/ES-02_COMPLETION.md` — understand outbox relay is running
- [ ] Read `apps/sales-service/src/domain/InvoiceService.ts` — find `confirm()` method
- [ ] Read `apps/purchase-service/src/domain/PurchaseReturnService.ts` — find `approve()` method
- [ ] Read `apps/purchase-service/src/domain/GRNService.ts` — check if it writes to inventory_ledger
- [ ] Read `apps/inventory-service/src/domain/InventoryLedgerService.ts` — find `recordMovement()`
- [ ] Read `packages/db-client/src/schema/inventory.ts` — verify `inventory_ledger` columns
- [ ] Check `apps/inventory-service/src/api/` for existing internal routes
- [ ] Grep for consignment sale logic: `grep -r "consignment" apps/production-service/src apps/sales-service/src`
- [ ] Run `pnpm build` and `pnpm test` — confirm clean baseline
- [ ] Verify ES-02 complete: `OutboxRelayWorker.ts` exists in event-service

---

## ═══════════════════════════════════════════
## COMPLETED PHASES
## ═══════════════════════════════════════════

| Phase | Title | Key Changes Relevant to You |
|-------|-------|----------------------------|
| ES-01 ✅ | Security & Routing | search-service JWT; rate limit 10/15min |
| ES-02 ✅ | Outbox Relay | Relay worker running; period_closures seeded; INVOICE_CONFIRMED events now reach accounting |

---

## ═══════════════════════════════════════════
## PROJECT CONTEXT
## ═══════════════════════════════════════════

### Tech Stack
Node.js 20 + TypeScript 5 strict | Fastify 4 | PostgreSQL 16 + Drizzle ORM | PgBouncer |
Elasticsearch 8 | BullMQ + Redis 7 | Kafka 3 | RS256 JWT | AES-256-GCM | Turborepo + pnpm |
React 18 + Vite 5 + Tailwind v4 | React Query v5 | Vitest

### Multi-Tenant Rules
- Every Drizzle query: `.where(eq(table.tenantId, ctx.tenantId))`
- Tenant ID: ALWAYS from `request.auth.tenantId` — NEVER from body/params
- Service boundaries: sales-service CANNOT import inventory-service code directly (microservices)

### Auth Pattern
```typescript
fastify.post('/resource', {
  preHandler: [authenticate, requirePermission(PERMISSIONS.X)],
}, handler)
```

### Distributed Patterns
**Outbox:** every state-changing domain event written to `outbox_events` IN SAME DB TRANSACTION.
**Inbox:** every Kafka consumer checks `inbox_events` by `event_id` before processing (idempotency).

### Standard Service Structure
```
src/api/      # Routes + Zod validation only
src/domain/   # All business logic
src/consumers/ # Kafka consumers
src/middleware/ # authenticate.ts
```

### Coding Standards
- TypeScript strict — no `any`
- No `console.log` — use `packages/logger`
- Drizzle ORM for all DB access
- No business logic in route handlers
- Errors: typed classes from `packages/shared-types/src/errors.ts`
- Error codes: `MODULE_TYPE` pattern (e.g., `STOCK_INSUFFICIENT`)
- `/* global process */` at top of files using `process.env`

### `inventory_ledger` Required Schema
```
id UUID PRIMARY KEY
tenant_id UUID NOT NULL
item_id UUID NOT NULL
warehouse_id UUID NOT NULL
movement_type VARCHAR(20) NOT NULL  -- 'STOCK_IN' | 'STOCK_OUT' | 'ADJUSTMENT'
quantity INTEGER NOT NULL
unit_cost BIGINT NOT NULL           -- paise
reference_type VARCHAR(30)          -- 'INVOICE' | 'PURCHASE_RETURN' | 'GRN' | 'CONSIGNMENT_SALE'
reference_id UUID
created_at TIMESTAMPTZ DEFAULT NOW()
created_by UUID
```
Verify this schema exists in `packages/db-client/src/schema/inventory.ts`. Add missing columns via migration.

---

## ═══════════════════════════════════════════
## OBJECTIVE
## ═══════════════════════════════════════════

Fix three bugs where `items.available_qty` is updated but no row is written to `inventory_ledger`.

**Why critical:** `inventory_ledger` is the audit source of truth for ALL stock movements.
Required for FIFO/WACC valuation (ES-13), inventory reconciliation, and stock reports.
Every confirmed invoice since launch has an INCOMPLETE stock audit trail.

---

## ═══════════════════════════════════════════
## SCOPE
## ═══════════════════════════════════════════

### IN SCOPE

**Fix 1 — Invoice confirmation writes STOCK_OUT**

File: `apps/sales-service/src/domain/InvoiceService.ts`

In the `confirm(invoiceId, ctx)` method:
- After updating `available_qty` for each invoice line, call the inventory-service internal API
- The call must happen INSIDE the same Drizzle transaction (use transaction callback)
- If the ledger write fails → rollback the entire transaction (qty deduction AND ledger write both roll back)
- `referenceType = 'INVOICE'`, `referenceId = invoiceId`

Cross-service call: `POST /internal/ledger` on inventory-service (see below).

**Fix 2 — Purchase return approval writes STOCK_IN**

File: `apps/purchase-service/src/domain/PurchaseReturnService.ts`

In `approve(returnId, ctx)`:
- After qty is restored in `available_qty`, call inventory-service internal API
- Same transaction pattern as Fix 1
- `referenceType = 'PURCHASE_RETURN'`, `referenceId = returnId`
- `movement_type = 'STOCK_IN'`

**Fix 3 — Consignment sale writes STOCK_OUT**

Find the consignment sale service (check `apps/production-service/src/domain/` or `apps/sales-service/src/domain/`).
Add:
- `available_qty` reduction on main warehouse (if not already done)
- `STOCK_OUT` ledger write with `referenceType = 'CONSIGNMENT_SALE'`

**Fix 4 — GRN approval (verify or fix)**

File: `apps/purchase-service/src/domain/GRNService.ts`

Check if `approve()` already writes to `inventory_ledger` with `movement_type = 'STOCK_IN'`.
- If YES: add a comment `// ✓ writes inventory_ledger STOCK_IN` and move on
- If NO: add the write inside the same transaction, `referenceType = 'GRN'`

**Internal API route in inventory-service (create if missing)**

File: `apps/inventory-service/src/api/internal.routes.ts` (or add to existing routes)

```typescript
// POST /internal/ledger
// Called by other services to record stock movements
// NOT protected by authenticate (internal only — secure via network policy)
fastify.post('/internal/ledger', async (request, reply) => {
  const { type, itemId, warehouseId, quantity, unitCost, referenceType, referenceId, tenantId } = request.body;
  await inventoryLedgerService.recordMovement(type, itemId, warehouseId, quantity, unitCost, referenceType, referenceId, tenantId);
  return reply.code(200).send({ data: { recorded: true } });
});
```

**`InventoryLedgerService.recordMovement()` signature**

Ensure this method exists with exactly this signature:
```typescript
async recordMovement(
  type: 'STOCK_IN' | 'STOCK_OUT' | 'ADJUSTMENT',
  itemId: string,
  warehouseId: string,
  quantity: number,
  unitCost: number,         // paise
  referenceType: string,
  referenceId: string,
  tenantId: string,
  tx?: DrizzleTransaction   // optional — used when called within a transaction
): Promise<void>
```

### OUT OF SCOPE
- FIFO/WACC cost calculations (ES-13)
- COGS journal entries (ES-13)
- Any frontend changes
- Any other services besides sales, purchase, inventory

---

## ═══════════════════════════════════════════
## ARCHITECTURE RULES
## ═══════════════════════════════════════════

1. **Atomicity:** The ledger INSERT must be in the SAME Drizzle transaction as the `available_qty` UPDATE. Use Drizzle's `db.transaction(async (tx) => { ... })` pattern.

2. **Service boundary:** `sales-service` cannot import `inventory-service` code. The cross-service call must be an HTTP call to the internal route. Use `fetch` or an internal HTTP client.

3. **Transaction + HTTP call problem:** If the HTTP call to inventory-service happens inside the Drizzle transaction callback, and the transaction rolls back, the HTTP call may have already fired. To handle this:
   - Option A (preferred): Make the inventory ledger write happen AFTER the transaction commits via the outbox pattern (emit `INVOICE_CONFIRMED` event which already triggers inventory-service via Kafka if a consumer exists)
   - Option B: Check if `inventory-service` shares the SAME PostgreSQL database as `sales-service`. If yes, they can share a transaction via a passed transaction object.
   - **Whichever option you choose, document your decision clearly in a comment.**

4. The `inventory_ledger` table must only ever GROW (append-only). Never UPDATE or DELETE rows.

---

## ═══════════════════════════════════════════
## DATABASE RULES
## ═══════════════════════════════════════════

- No new tables needed if `inventory_ledger` already exists
- If `inventory_ledger` is missing columns, add via migration: `0008_es03_inventory_ledger_columns.sql`
  (or `0009_` if ES-02 already created `0008_`)
- After any schema change: run `pnpm drizzle-kit generate`, review generated SQL, commit
- Never edit existing migration files — only add new ones

---

## ═══════════════════════════════════════════
## TESTING REQUIREMENTS
## ═══════════════════════════════════════════

Create `apps/sales-service/src/__tests__/invoice-ledger.test.ts`:
1. Confirm invoice → `SELECT COUNT(*) FROM inventory_ledger WHERE reference_id = $invoiceId` equals number of invoice lines
2. Each row has `movement_type = 'STOCK_OUT'` and the correct quantity
3. **Atomicity test:** mock `recordMovement` to throw → invoice confirmation rolls back → `available_qty` unchanged

Create `apps/purchase-service/src/__tests__/purchase-return-ledger.test.ts`:
4. Approve purchase return → `inventory_ledger` has `STOCK_IN` row for each returned item

Create `apps/inventory-service/src/__tests__/ledger-service.test.ts`:
5. `recordMovement('STOCK_OUT', ...)` inserts correct row with all fields populated
6. `recordMovement` with invalid `tenantId` → throws error (does not silently succeed)

---

## ═══════════════════════════════════════════
## BUILD VERIFICATION
## ═══════════════════════════════════════════

```bash
pnpm --filter @erp/sales-service build
pnpm --filter @erp/sales-service type-check
pnpm --filter @erp/purchase-service build
pnpm --filter @erp/purchase-service type-check
pnpm --filter @erp/inventory-service build
pnpm --filter @erp/inventory-service type-check
pnpm lint
pnpm test --filter @erp/sales-service
pnpm test --filter @erp/purchase-service
pnpm test --filter @erp/inventory-service
```

---

## ═══════════════════════════════════════════
## VERIFICATION CHECKLIST
## ═══════════════════════════════════════════

- [ ] Confirm invoice via API → `SELECT * FROM inventory_ledger WHERE reference_id = '{invoiceId}'` → one row per line item
- [ ] Each `inventory_ledger` row: `movement_type = 'STOCK_OUT'`, correct qty, non-null `unit_cost`
- [ ] `items.available_qty` matches: `(initial_qty) - SUM(ledger STOCK_OUT qty) + SUM(ledger STOCK_IN qty)`
- [ ] Approve purchase return → `inventory_ledger` rows with `movement_type = 'STOCK_IN'` and `reference_type = 'PURCHASE_RETURN'`
- [ ] Simulate ledger failure → invoice confirmation returns error, `available_qty` unchanged in DB
- [ ] GRN approval → `inventory_ledger` row with `movement_type = 'STOCK_IN'` and `reference_type = 'GRN'`
- [ ] Consignment sale → `inventory_ledger` row with `movement_type = 'STOCK_OUT'` and `reference_type = 'CONSIGNMENT_SALE'`
- [ ] All new tests pass
- [ ] `pnpm lint` passes

---

## ═══════════════════════════════════════════
## REGRESSION CHECKLIST
## ═══════════════════════════════════════════

- [ ] Invoice confirmation still works end-to-end (status transitions DRAFT → CONFIRMED)
- [ ] Outbox events from ES-02 still publish correctly (INVOICE_CONFIRMED reaches accounting-service)
- [ ] No duplicate journal entries in `financial_entries` (inbox deduplication working)
- [ ] Purchase return approval still updates supplier outstanding balance
- [ ] `items.available_qty` queries still return correct values
- [ ] GRN approval still updates `purchase_orders.received_quantity`
- [ ] Existing inventory-service unit tests still pass

---

## ═══════════════════════════════════════════
## DEFINITION OF DONE
## ═══════════════════════════════════════════

- [ ] Every confirmed invoice has `STOCK_OUT` rows in `inventory_ledger`
- [ ] Every approved purchase return has `STOCK_IN` rows in `inventory_ledger`
- [ ] GRN approval has `STOCK_IN` rows in `inventory_ledger`
- [ ] Ledger write failure causes full transaction rollback (atomicity preserved)
- [ ] All integration tests pass
- [ ] Zero build errors, zero TypeScript errors, zero lint warnings
- [ ] Completion report saved at `ERP-PLANNING/phase-completions/ES-03_COMPLETION.md`

---

## ═══════════════════════════════════════════
## COMPLETION REPORT TEMPLATE
## ═══════════════════════════════════════════

**Save as:** `ERP-PLANNING/phase-completions/ES-03_COMPLETION.md`

```markdown
# ES-03 Completion Report — Inventory Ledger Integrity
**Date:** [YYYY-MM-DD]
**Status:** COMPLETE

## Summary
[What was fixed and how]

## Architecture Decision (cross-service atomicity)
[Document which approach was used for the transaction+HTTP issue and why]

## Files Changed
| File | Change |
|------|--------|
| apps/sales-service/src/domain/InvoiceService.ts | Modified — STOCK_OUT ledger write |
| apps/purchase-service/src/domain/PurchaseReturnService.ts | Modified — STOCK_IN ledger write |
| apps/purchase-service/src/domain/GRNService.ts | [Modified or Verified] |
| apps/inventory-service/src/domain/InventoryLedgerService.ts | Modified/Verified |
| apps/inventory-service/src/api/internal.routes.ts | [NEW if created] |
| [consignment service file] | Modified — STOCK_OUT ledger write |

## Tests Added
[List test files and counts]

## Test Results
pnpm test: [PASS] | pnpm lint: [PASS] | pnpm build: [PASS]

## Verification Results
[Checklist with ✅ / ❌]

## Issues Encountered
[Problems and resolutions]

## Phases Now Unblocked
ES-08, ES-09, ES-13, ES-16

## Notes for ES-13 (Inventory Valuation)
[Important context: e.g., unit_cost field is currently always 0 — ES-13 will populate it]
```
