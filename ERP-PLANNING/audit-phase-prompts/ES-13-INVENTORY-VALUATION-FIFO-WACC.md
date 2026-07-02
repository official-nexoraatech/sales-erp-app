# ES-13 — Inventory Valuation: FIFO & WACC
## STATUS: 🔴 PENDING
## Sprint: 3 | Effort: 4–5 days | Risk: High
## Depends on: ES-03 (ledger integrity), ES-08 (sales), ES-09 (purchase GRNI)
## Unlocks: ES-16, ES-17

---

## YOUR ROLE

You are the **Principal Backend + Frontend Engineer** on the NEXORAA Multi-Tenant Cloth Retail ERP.
Your mission: implement correct inventory valuation using FIFO (First In First Out) and WACC (Weighted Average Cost of Capital) costing methods, and calculate Cost of Goods Sold (COGS) per invoice line.

---

## ═══════════════════════════════════════════
## PRE-FLIGHT CHECKLIST
## ═══════════════════════════════════════════

- [ ] Read `ERP-PLANNING/TECH_AUDIT.md`
- [ ] Read `ERP-PLANNING/CODING_STANDARDS.md`
- [ ] Read `ERP-PLANNING/phase-completions/ES-03_COMPLETION.md` — note if `unit_cost` in ledger is 0
- [ ] Read `ERP-PLANNING/phase-completions/ES-08_COMPLETION.md`
- [ ] Read `ERP-PLANNING/phase-completions/ES-09_COMPLETION.md`
- [ ] Read `apps/inventory-service/src/domain/InventoryLedgerService.ts` — full file
- [ ] Read `packages/db-client/src/schema/inventory.ts` — `inventory_ledger`, `items` columns
- [ ] Check: does `inventory_ledger.unit_cost` column exist? Is it populated?
- [ ] Check: does `items` table have `costing_method` column ('FIFO' | 'WACC')?
- [ ] Check: does `items` table have `wacc_cost` and `current_stock_value` columns?
- [ ] Read `apps/purchase-service/src/domain/GRNService.ts` — what unit_cost does GRN write?
- [ ] Run `pnpm build` and `pnpm test` — confirm clean baseline

---

## ═══════════════════════════════════════════
## COMPLETED PHASES
## ═══════════════════════════════════════════

| Phase | Status | Key Changes Relevant to You |
|-------|--------|----------------------------|
| ES-03 ✅ | Inventory Ledger | STOCK_IN/STOCK_OUT rows written; unit_cost may be 0 |
| ES-08 ✅ | Sales | Invoice confirmed → STOCK_OUT to ledger |
| ES-09 ✅ | Purchase | GRN STOCK_IN writes unit_cost from PO price |

---

## ═══════════════════════════════════════════
## PROJECT CONTEXT
## ═══════════════════════════════════════════

### Tech Stack
Node.js 20 + TypeScript 5 strict | Fastify 4 | PostgreSQL 16 + Drizzle ORM | React 18 + Vite 5 + Tailwind v4 | Vitest

### Multi-Tenant Rules
- Every Drizzle query: `.where(eq(table.tenantId, ctx.tenantId))`
- Tenant ID: ALWAYS from `request.auth.tenantId`

### Money Rules
- ALL amounts in paise
- FIFO cost per unit: paise integer
- WACC cost: `Math.round(totalStockValue / totalQty)` in paise

### Inventory Valuation Domain Rules
```
FIFO (First In First Out):
  When issuing stock (STOCK_OUT), consume the oldest STOCK_IN layers first
  Cost of goods sold = cost of oldest available layers
  
  Data model: "FIFO layers" — each STOCK_IN creates a layer
  Layer: { item_id, warehouse_id, quantity, unit_cost, received_at, remaining_qty }
  On STOCK_OUT: consume layers in received_at ASC order until qty fulfilled
  
WACC (Weighted Average Cost):
  wacc_cost = (current_stock_value + new_receipt_value) / (current_qty + new_qty)
  Update items.wacc_cost on every STOCK_IN event
  Cost of goods sold = qty_sold × wacc_cost at time of sale
  
COGS Journal:
  On invoice confirmation (after inventory ledger write):
  DR Cost of Goods Sold / CR Inventory Asset
  Amount = sum of each line's COGS (FIFO or WACC depending on item setting)
  Write COGS_JOURNAL_REQUIRED event to outbox → accounting-service posts journal
```

### Architecture Rule
- Valuation calculation happens in `inventory-service` — not in `sales-service`
- `sales-service` does NOT import inventory-service code (microservice boundary)
- COGS is calculated asynchronously via Kafka: `INVOICE_CONFIRMED` → inventory-service calculates COGS → `COGS_CALCULATED` event → accounting-service posts journal

### Coding Standards
- TypeScript strict — no `any`
- No `console.log` — use `packages/logger`
- Drizzle ORM for all queries
- `/* global process */` at top of files using `process.env`

---

## ═══════════════════════════════════════════
## OBJECTIVE
## ═══════════════════════════════════════════

1. Fix `inventory_ledger.unit_cost` — populate it from GRN purchase price
2. Add FIFO layer tracking for items with `costing_method = 'FIFO'`
3. Add WACC recalculation on every STOCK_IN
4. Calculate COGS per invoice line on STOCK_OUT
5. Post COGS journal to accounting-service via Kafka
6. Stock Valuation Report (current stock × cost per item)

---

## ═══════════════════════════════════════════
## SCOPE
## ═══════════════════════════════════════════

### IN SCOPE

**Step 1 — Schema additions**

`packages/db-client/src/schema/inventory.ts`:

Add `costing_method` to `items`:
```sql
costing_method VARCHAR(10) NOT NULL DEFAULT 'WACC',  -- 'FIFO' | 'WACC'
wacc_cost BIGINT NOT NULL DEFAULT 0,  -- current WACC in paise
current_stock_value BIGINT NOT NULL DEFAULT 0,  -- total value = qty × cost
```

New table `inventory_fifo_layers`:
```sql
id UUID PRIMARY KEY DEFAULT gen_random_uuid()
tenant_id UUID NOT NULL
item_id UUID NOT NULL
warehouse_id UUID NOT NULL
received_at TIMESTAMPTZ NOT NULL
original_qty INTEGER NOT NULL
remaining_qty INTEGER NOT NULL
unit_cost BIGINT NOT NULL  -- paise
source_ledger_id UUID NOT NULL REFERENCES inventory_ledger(id)
created_at TIMESTAMPTZ DEFAULT NOW()
INDEX: (tenant_id, item_id, warehouse_id, received_at ASC) — for FIFO consumption order
```

Add to `inventory_ledger`:
```sql
cogs_per_unit BIGINT  -- paise: cost used for this movement
```

Migration: `000X_es13_inventory_valuation.sql`

**Step 2 — Fix unit_cost on GRN STOCK_IN**

`apps/purchase-service/src/domain/GRNService.ts`:
When building the `POST /internal/ledger` payload for GRN approval:
- Set `unitCost` to the PO line's `unit_price` (in paise)
- Currently: likely passing 0

`apps/inventory-service/src/api/internal.routes.ts`:
Accept `unitCost` in the payload. Pass it through to `recordMovement`.

`apps/inventory-service/src/domain/InventoryLedgerService.ts`:
In `recordMovement()`:
- Store `unit_cost` in `inventory_ledger` row

**Step 3 — WACC recalculation on STOCK_IN**

`apps/inventory-service/src/domain/ValuationService.ts` (new file):

```typescript
async updateWACC(itemId: string, warehouseId: string, newQty: number, newUnitCost: number, tenantId: string, tx: DrizzleTransaction): Promise<void> {
  const item = await tx.select().from(items).where(and(eq(items.id, itemId), eq(items.tenantId, tenantId))).for('update');
  const currentValue = item.currentStockValue;
  const currentQty = item.availableQty;  // before this STOCK_IN
  const newTotalValue = currentValue + (newQty * newUnitCost);
  const newTotalQty = currentQty + newQty;
  const newWacc = newTotalQty > 0 ? Math.round(newTotalValue / newTotalQty) : 0;
  await tx.update(items).set({ waccCost: newWacc, currentStockValue: newTotalValue }).where(eq(items.id, itemId));
}
```

Also call from within `recordMovement()` when `type = 'STOCK_IN'` and `item.costingMethod = 'WACC'`.

**Step 4 — FIFO layer creation on STOCK_IN**

`apps/inventory-service/src/domain/ValuationService.ts`:

```typescript
async createFIFOLayer(itemId, warehouseId, qty, unitCost, ledgerRowId, tenantId, tx): Promise<void>
```

Call this from `recordMovement()` when `type = 'STOCK_IN'` and `item.costingMethod = 'FIFO'`.

**Step 5 — COGS calculation on STOCK_OUT**

`apps/inventory-service/src/domain/ValuationService.ts`:

```typescript
async calculateCOGS(itemId, warehouseId, qty, tenantId, tx): Promise<number> {
  // For FIFO: consume layers oldest first, return weighted average cost
  // For WACC: return item.wacc_cost
}
```

Call from `recordMovement()` when `type = 'STOCK_OUT'`:
- Calculate COGS via `calculateCOGS()`
- Set `cogs_per_unit` on the `inventory_ledger` row
- Emit `COGS_CALCULATED` event with `{ referenceId, cogsTotalPaise }` to outbox

**Step 6 — COGS Journal (accounting-service)**

`apps/accounting-service/src/consumers/cogs.consumer.ts` (create):
On `COGS_CALCULATED` event:
- Check inbox deduplication
- Post journal: DR Cost of Goods Sold / CR Inventory Asset
- Amount = `cogsTotalPaise`
- Both accounts must already exist in chart of accounts (verify or create seed)

**Step 7 — Stock Valuation Report**

Route: `GET /api/v1/inventory/valuation?warehouseId=...&asOf=2026-07-01`
Guard: `requirePermission(PERMISSIONS.REPORT_VIEW)`

Response: list of items with `{ itemCode, itemName, qty, unitCost, totalValue, costingMethod }`
Total stock value in response footer.

Frontend: `apps/web-frontend/src/pages/inventory/StockValuationPage.tsx`
- `ERPDataGrid`: Item Code, Item Name, Quantity, Unit Cost (₹), Total Value (₹), Costing Method
- Filter by warehouse
- Filter by as-of date
- Footer: total stock value
- Export to CSV

### OUT OF SCOPE
- Landed cost adjustment
- Import duty / customs valuation
- Lower of Cost or NRV (Net Realizable Value) write-downs
- Standard costing

---

## ═══════════════════════════════════════════
## TESTING REQUIREMENTS
## ═══════════════════════════════════════════

`apps/inventory-service/src/__tests__/valuation.test.ts`:
1. WACC: receive 100 units @ ₹50 → WACC = ₹50. Receive 100 more @ ₹60 → WACC = ₹55.
2. FIFO: receive batch A (100u @ ₹50), batch B (100u @ ₹60). Sell 150u → COGS = (100×50 + 50×60) = ₹8,000. Remaining layer B: 50u @ ₹60.
3. FIFO: sell more than available → throws `STOCK_INSUFFICIENT`
4. GRN approval → `inventory_ledger.unit_cost` = PO line price (not 0)
5. STOCK_OUT via invoice → `inventory_ledger.cogs_per_unit` populated
6. `COGS_CALCULATED` event emitted after invoice STOCK_OUT
7. Stock valuation report: sum of `qty × unit_cost` matches `items.current_stock_value`

---

## ═══════════════════════════════════════════
## BUILD VERIFICATION
## ═══════════════════════════════════════════

```bash
pnpm --filter @erp/inventory-service build
pnpm --filter @erp/inventory-service type-check
pnpm --filter @erp/accounting-service build
pnpm --filter @erp/db-client build
pnpm --filter @erp/web-frontend build
pnpm lint
pnpm test --filter @erp/inventory-service
pnpm test --filter @erp/accounting-service
```

---

## ═══════════════════════════════════════════
## VERIFICATION CHECKLIST
## ═══════════════════════════════════════════

- [ ] After GRN: `inventory_ledger.unit_cost` = PO price (not 0)
- [ ] WACC item: `items.wacc_cost` updates after each STOCK_IN
- [ ] FIFO item: `inventory_fifo_layers` has rows after each STOCK_IN
- [ ] FIFO STOCK_OUT: oldest layers consumed first
- [ ] COGS journal posted in accounting-service for each invoice
- [ ] Stock valuation report: total value = sum of each item's (qty × cost)
- [ ] All 7 valuation tests pass
- [ ] `pnpm lint` passes

---

## ═══════════════════════════════════════════
## REGRESSION CHECKLIST
## ═══════════════════════════════════════════

- [ ] Existing STOCK_IN/STOCK_OUT still works (ES-03)
- [ ] Invoice confirmation still fires outbox events (ES-08)
- [ ] GRN approval still updates PO received quantities (ES-09)
- [ ] Existing inventory reports still function

---

## ═══════════════════════════════════════════
## DEFINITION OF DONE
## ═══════════════════════════════════════════

- [ ] FIFO layers tracked and consumed correctly
- [ ] WACC updated on every STOCK_IN
- [ ] COGS calculated per invoice line and posted to accounting
- [ ] Stock valuation report accurate
- [ ] 7 tests pass
- [ ] Completion report saved at `ERP-PLANNING/phase-completions/ES-13_COMPLETION.md`

---

## ═══════════════════════════════════════════
## COMPLETION REPORT TEMPLATE
## ═══════════════════════════════════════════

**Save as:** `ERP-PLANNING/phase-completions/ES-13_COMPLETION.md`

```markdown
# ES-13 Completion Report — Inventory Valuation FIFO & WACC
**Date:** [YYYY-MM-DD]
**Status:** COMPLETE

## Costing Methods Implemented
- FIFO: [IMPLEMENTED — FIFO layers table]
- WACC: [IMPLEMENTED — items.wacc_cost updated on STOCK_IN]

## COGS Integration
- COGS journal consumer: [IMPLEMENTED in accounting-service]
- Average COGS accuracy: [verified with test data]

## unit_cost Fix
- Was: GRN wrote unit_cost = 0 in ledger
- Now: GRN writes unit_cost = PO line price
- Historical data: [will have unit_cost=0 for pre-ES-13 rows — acceptable; documented here]

## Files Changed
[Table]

## Tests: 7/7 PASS | lint: PASS | build: PASS

## Phases Unblocked
ES-16 (performance: FIFO layer queries need index verification)
ES-17 (analytics: COGS data available)
```
