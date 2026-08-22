# 27 — Full Affected-Flow Matrix

Every flow that reads or writes `inventory_fifo_layers` (the table carrying `batchNumber`/`expiryDate`), across all four services. Confirmed by direct code read (this session's two research passes + `24-pre-implementation-review.md`), not inferred. "Capability required" / "Permission required" describe **new** checks this phase adds — per `26-decision-record.md`'s boundary confirmation, no flow below except the item-configuration route itself gains a new capability/permission check; all consumption flows trust the already-gated `items.fefoEnabled` column as their single source of truth.

Engine column key: **Shared** = `packages/platform-sdk/src/valuation-engine.ts` (`@erp/sdk`, FEFO-aware today). **Local-stale** = `apps/sales-service/src/domain/ValuationService.ts` (no FEFO, no batch/expiry fields) — the target of D1.

---

## Inventory — transfers, adjustments, physical verification

### 1. Stock Transfer (dispatch + receive)

- **Service / file**: `inventory-service` — `StockTransferService.ts` → `InventoryLedgerService.ts` → shared engine
- **Call sites**: `dispatch()` → `deductStock()` (`InventoryLedgerService.ts:104` → `consumeForStockOut`) at `StockTransferService.ts:194`; `receive()` → `addStock()` (`InventoryLedgerService.ts:60` → `applyStockIn`) at `StockTransferService.ts:281` and `:354`
- **Engine**: Shared
- **Batch data read?** Yes — dispatch consumption reads `expiryDate`/`receivedAt` ordering
- **Batch data written?** Yes — receive-side `applyStockIn` writes a new layer at the destination warehouse; batch/expiry are **not threaded from the source layer** (the call site doesn't carry them forward) — a transferred item's batch/expiry identity is not preserved across a transfer today
- **FEFO allocation?** Yes, already live — activates silently for any `fefoEnabled: true` item once the write path (Phase 2B) ships
- **Expiry validation?** None — no block, no warning
- **Capability required (new)?** No — trusts `items.fefoEnabled`
- **Permission required (new)?** No — existing transfer permissions unchanged
- **Behavior when capability disabled**: No possible change (`fefoEnabled` can never be `true`)
- **Behavior when capability enabled + item `fefoEnabled=true`**: Dispatch consumption order shifts from receipt-order to expiry-order — first time this fires for any given item, silently
- **Financial impact?** Yes — the specific layer's unit cost dispatched (and thus the cost basis carried into the new layer at the destination) can differ from what FIFO would have chosen when source layers have differing unit costs
- **Migration impact?** None
- **Tests required (new)**: FEFO-ordering test for transfer dispatch with mixed-expiry layers; regression test proving `fefoEnabled=false` transfers are byte-identical to pre-phase behavior; note the batch/expiry-not-carried-forward gap as a known limitation, not silently left untested-and-undocumented

### 2. Stock Adjustment (write-off / found-stock)

- **Service / file**: `inventory-service` — `StockAdjustmentService.ts:173` → `InventoryLedgerService.adjustStock()` (`:169` OUT / `:184` IN) → shared engine
- **Engine**: Shared
- **Batch data read?** Yes (OUT direction)
- **Batch data written?** Yes (IN direction, found-stock case) — no batch/expiry captured on the adjustment input (aggregate quantity only)
- **FEFO allocation?** Yes, already live
- **Expiry validation?** None
- **Capability required (new)?** No
- **Permission required (new)?** No
- **Behavior when disabled**: No change
- **Behavior when enabled**: Write-off consumption silently prefers the earliest-expiring layer — **not necessarily the specific batch a physical count found overstocked/damaged**, since `StockAdjustmentService` has no batch-targeting field (D3, non-blocking follow-up)
- **Financial impact?** Yes — write-off cost value changes depending on which layer's unit cost is selected
- **Migration impact?** None
- **Tests required**: FEFO-ordering test for OUT-direction adjustment; regression for `fefoEnabled=false`; explicit test documenting (not fixing) the aggregate-only write-off gap

### 3. Physical Verification (approve/reconcile)

- **Service / file**: `inventory-service` — `PhysicalVerificationService.ts:288` → `InventoryLedgerService.adjustStock()` → shared engine
- **Engine**: Shared
- **Batch data read/written?** Same as Stock Adjustment (identical underlying call)
- **FEFO allocation?** Yes, already live
- **Expiry validation?** None
- **Capability/Permission required (new)?** No / No
- **Behavior when disabled/enabled**: Same pattern as Stock Adjustment
- **Financial impact?** Yes, same mechanism
- **Migration impact?** None
- **Tests required**: FEFO-ordering test for variance reconciliation; regression; same aggregate-only-write-off caveat as #2

---

## Purchase — GRN, purchase returns

### 4. GRN Receipt (goods receipt / stock-in)

- **Service / file**: `purchase-service` — `GRNService.ts:396-408` → `ValuationService.applyStockIn` → shared engine (**only** call site in the entire codebase that writes `batchNumber`/`expiryDate` onto a new layer, confirmed)
- **Engine**: Shared
- **Batch data read?** No (pure stock-in)
- **Batch data written?** Yes — unconditionally, whenever the GRN line provides `batchNumber`/`expiryDate`, regardless of the item's `fefoEnabled` value (no conditioning on the flag anywhere in `GRNService.ts`)
- **FEFO allocation?** N/A — stock-in only, no consumption
- **Expiry validation?** None — no future-date check, no batch-number uniqueness constraint per item/warehouse (only non-unique indexes exist on `inventory_fifo_layers`)
- **Capability required?** No — REUSABLE DOMAIN, stays unconditional (confirmed correct classification, `03-capability-definition.md` §1, not revised)
- **Permission required?** No new permission — existing GRN permissions unchanged
- **Behavior when capability disabled/enabled**: **Identical either way** — this is the one flow genuinely unaffected by the capability's state, by design
- **Financial impact?** None directly (landed-cost capture logic unaffected)
- **Migration impact?** None
- **Tests required**: None new for this flow itself — existing GRN batch-capture tests (`grn-batch-expiry.integration.test.ts`, confirmed to exist) already cover it; regression proof only

### 5. Purchase Return

- **Service / file**: `purchase-service` — `PurchaseReturnService.ts:228` → `ValuationService.consumeForStockOut` → shared engine
- **Engine**: Shared
- **Batch data read?** Yes
- **Batch data written?** No (consumption only)
- **FEFO allocation?** Yes, already live — **the original plan's `05-service-impact.md` §2 claim of "purchase-service: no change" is false for this specific route**, confirmed
- **Expiry validation?** None
- **Capability/Permission required (new)?** No / No
- **Behavior when disabled**: No change
- **Behavior when enabled**: Return-side consumption silently shifts to expiry-order. `ReturnLineInput` has no `batchNumber`/`fifoLayerId` field (confirmed, no such field in the interface) — the operator cannot target the specific physical batch being sent back to the supplier; the system picks whichever layer FEFO/FIFO order selects (D3 gap)
- **Financial impact?** Yes — return's cost-basis/reversal amount can differ from the batch actually being returned
- **Migration impact?** None
- **Tests required**: FEFO-ordering test for return consumption; regression for `fefoEnabled=false`; document the batch-targeting gap (D3)

---

## Production — job-work orders

### 6. Job-Work Material Issue (raw-material consumption)

- **Service / file**: `production-service` — `JobWorkOrderService.ts:200` (`issueMaterials()`) → `ValuationService.consumeForStockOut` → shared engine
- **Engine**: Shared
- **Batch data read?** Yes
- **Batch data written?** No
- **FEFO allocation?** Yes, already live — **`production-service` is omitted from the original plan entirely; this is the "4th service" the gate review found**
- **Expiry validation?** None
- **Capability/Permission required (new)?** No / No
- **Behavior when disabled/enabled**: Same silent-activation pattern as the inventory-service flows
- **Financial impact?** Yes — raw-material cost basis absorbed into the job-work order's cost can shift
- **Migration impact?** None
- **Tests required**: New FEFO-ordering test (none exist today for this service on this dimension); regression via `job-work-order-valuation.integration.test.ts` (confirmed to exist, currently non-FEFO-aware)

### 7. Job-Work Completion (finished-goods receipt)

- **Service / file**: `production-service` — `JobWorkOrderService.ts:392` (`complete()`) → `ValuationService.applyStockIn` → shared engine
- **Engine**: Shared
- **Batch data read?** No
- **Batch data written?** **No** — confirmed this call site does **not** pass `batchNumber`/`expiryDate` at all; finished goods from job-work receive zero batch/expiry tagging today, unlike GRN receipts. A distinct, newly-identified gap: a Manufacturing/food-processing tenant relying on lot traceability from raw material through to finished good would find the chain breaks here.
- **FEFO allocation?** N/A — stock-in only
- **Expiry validation?** N/A
- **Capability/Permission required (new)?** No / No
- **Behavior when disabled/enabled**: No change either way — this flow's gap (missing batch/expiry on finished-goods receipt) is independent of the capability's state; enabling `INVENTORY_BATCH` does not fix it
- **Financial impact?** None directly
- **Migration impact?** None
- **Tests required**: A regression test confirming the current (gap) behavior explicitly, so a future session doesn't assume finished-goods lot tracking already works. **Fixing this gap is out of scope for Phase 2A/2B** — recorded as a named, tracked limitation, not silently absorbed or silently dropped.

---

## Sales — invoices, POS, sales returns (currently the Local-stale engine — D1's target)

### 8. Invoice Confirm (regular invoicing)

- **Service / file**: `sales-service` — `InvoiceService.ts:623` (`confirmInTransaction`) → **local** `ValuationService.consumeForStockOut` (`ValuationService.ts:135-220`) → `consumeFifoLayers` (`:222-286`, unconditional `orderBy(asc(receivedAt))` at line 243)
- **Callers**: `invoice.routes.ts:187` (create), `:284` (confirm)
- **Engine**: **Local-stale** — no `fefoEnabled` parameter exists on this copy's `consumeFifoLayers` at all
- **Batch data read?** Yes, but `expiryDate`/`batchNumber` are read from the row and **ignored** for ordering purposes
- **Batch data written?** N/A (stock-out)
- **FEFO allocation?** **No — this is the actual defect.** Even when `items.fefoEnabled = true`, this path always consumes strictly by `receivedAt`
- **Expiry validation?** None
- **Capability required (new)?** No — trusts the column, once D1 is resolved
- **Permission required (new)?** No
- **Behavior when capability disabled**: No change (unaffected either way today)
- **Behavior when capability enabled (post-D1 fix)**: Once reconciled per D1, this becomes the primary flow where FEFO takes effect for the highest-transaction-volume path
- **Financial impact?** **Direct and immediate once fixed** — `InvoiceService.ts:631` computes `cogsPerUnit` from `lineCogs`/`lineQty`, aggregated into `invoiceCogsTotal` (`:811`), emitted as the `COGS_CALCULATED` event's `cogsTotal` field. `accounting-service`'s `CogsAccountingConsumer.ts:22-46` trusts this number as-is and posts `DR COGS / CR Inventory` for exactly that amount — see `28-financial-impact-analysis.md`
- **Migration impact?** None (schema complete); D1's code migration (dedup) is the load-bearing change here, not a DB migration
- **Tests required**: Full new FEFO-ordering suite equivalent to `valuation-engine-fefo.test.ts` but exercised through `InvoiceService.confirm()`; regression proof for `fefoEnabled=false` against every existing invoice-ledger/invoice-workflow test (`invoice-ledger.test.ts`, `sales-workflow.test.ts`, confirmed zero current FEFO references)

### 9. POS Checkout

- **Service / file**: `sales-service` — `pos.routes.ts:366` (create) / `:442` (`trxInvoiceSvc.confirm()`) — **same `InvoiceService.confirm()` code path as #8**, same engine, same defect, same fix
- All columns identical to #8 — listed separately only because the brief's flow matrix explicitly calls out POS as its own row and because `pos.routes.ts` wraps the call in its own transaction (`pos.routes.ts:435` constructs a transaction-scoped `InvoiceService`)
- **Tests required**: POS-specific regression test (`pos.routes.ts` already has its own test surface) confirming checkout produces the same FEFO-ordered result as a regular invoice for the same item/layers

### 10. Sales Return (restock)

- **Service / file**: `sales-service` — `SaleReturnService.ts:233` → **local** `ValuationService.applyStockIn` (also called from `InvoiceService.ts:902` for invoice-cancel reversal, and from `LoyaltyService.ts` for a loyalty-related stock reversal — a third caller of the local engine, newly confirmed this session)
- **Engine**: **Local-stale**
- **Batch data read?** No
- **Batch data written?** **No** — the local `StockInValuationParams` interface (lines 14-24) has no `batchNumber`/`expiryDate` fields at all (the shared engine's equivalent does). A returned unit's batch/expiry identity is lost on restock today, regardless of the item's `fefoEnabled` state
- **FEFO allocation?** N/A (stock-in)
- **Expiry validation?** N/A
- **Capability required (new)?** No
- **Permission required (new)?** No
- **Behavior when disabled/enabled**: No change either way until D1 is resolved — this gap is independent of the capability flag
- **Financial impact?** Cost-basis capture on restock still works (unit cost is preserved); **traceability is what's lost** — directly relevant to the phase's own pharma/food-safety business justification, since a returned batch re-enters inventory with no record of which batch/expiry it belongs to
- **Migration impact?** None
- **Tests required**: New test asserting restock preserves `batchNumber`/`expiryDate` once migrated to the shared engine (D1); regression for cost-basis handling on returns; same test needed for `InvoiceService.ts:902`'s cancel-reversal path and `LoyaltyService.ts`'s reversal path, since both share the same local engine and the same fix

---

## Cross-cutting summary

| #   | Flow                    | Service            | Engine today                           | FEFO live today?                        | Expiry blocked? | New capability check? | Financial impact once fixed |
| --- | ----------------------- | ------------------ | -------------------------------------- | --------------------------------------- | --------------- | --------------------- | --------------------------- |
| 1   | Stock Transfer          | inventory-service  | Shared                                 | Dormant (no item can be flagged yet)    | No              | No                    | Yes                         |
| 2   | Stock Adjustment        | inventory-service  | Shared                                 | Dormant                                 | No              | No                    | Yes                         |
| 3   | Physical Verification   | inventory-service  | Shared                                 | Dormant                                 | No              | No                    | Yes                         |
| 4   | GRN Receipt             | purchase-service   | Shared                                 | N/A (stock-in)                          | N/A             | No                    | None                        |
| 5   | Purchase Return         | purchase-service   | Shared                                 | Dormant                                 | No              | No                    | Yes                         |
| 6   | Job-Work Material Issue | production-service | Shared                                 | Dormant                                 | No              | No                    | Yes                         |
| 7   | Job-Work Completion     | production-service | Shared                                 | N/A (stock-in, batch not even threaded) | N/A             | No                    | None (separate gap)         |
| 8   | Invoice Confirm         | sales-service      | **Local-stale**                        | **No — the actual defect**              | No              | No                    | Yes, direct GL impact       |
| 9   | POS Checkout            | sales-service      | **Local-stale** (same code path as #8) | **No**                                  | No              | No                    | Yes, direct GL impact       |
| 10  | Sales Return            | sales-service      | **Local-stale**                        | N/A (stock-in, batch not threaded)      | N/A             | No                    | Traceability loss, not cost |

Nine live consumption/capture flows, one item-configuration route (`inventory-service`'s `POST/PUT /items`, carrying the phase's only new capability/permission checks — `BATCH_CONFIGURE`), and one new read-only route (`GET /inventory/near-expiry-stock`, carrying `BATCH_VIEW`). Everything else in this matrix inherits its behavior from the `items.fefoEnabled` column alone.
