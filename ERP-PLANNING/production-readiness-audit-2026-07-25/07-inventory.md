# Inventory Module — Fresh Production-Readiness Audit (2026-07-25)

Scope: `apps/inventory-service` (items, stock levels, warehouses, stock adjustments, stock
transfers, physical verification, fabric rolls) + `apps/web-frontend/src/pages/inventory,items`.
Audited live against the running stack (gateway :3000, inventory-service :3012,
accounting-service :3019, Postgres, Kafka) using tenant 2 "QA E2E Test Co" plus a freshly
provisioned tenant 93 for cross-tenant checks. All prior claims were re-verified from scratch,
not trusted.

## Summary

Most of the module's CRUD, workflow, RBAC, and tenant-isolation surface is genuinely solid and
was re-confirmed live: item creation, the Stock Adjustment Draft→Submit→Approve gate, the full
Stock Transfer happy path, the recent dispatch-cancel reversal fix (commit `c68c2ab`), Physical
Verification's counting/variance/approve flow, Fabric Rolls Receive→Cut, cross-tenant isolation,
branch-scoped RBAC, and the INVENTORY_MANAGER permission fix from 2026-07-12 all behaved
correctly under live testing with real record IDs.

However, this audit found and live-confirmed **two Critical and one High bug that were not
caught by the 2026-07-21 audit** (which raised readiness to a claimed 80/100). Together they mean
a multi-warehouse tenant using the default WACC costing method — which is every new item unless
FIFO is explicitly chosen — can silently corrupt its own stock counts and will silently lose
every stock-write-off's accounting entry, with the per-warehouse valuation report simultaneously
reporting zero stock/value for the very items affected. None of these three bugs produce a
visible error to the user in the normal flow; each was only surfaced by comparing values across
independent read paths (per-warehouse stock endpoint vs. global item total vs. Postgres vs.
Kafka/accounting journals).

**Readiness: 52/100.** The prior 80/100 score does not hold up: the specific things it claimed
fixed (cross-tenant vuln, branch RBAC, 3/5-flows valuation gap) are indeed still fixed, but this
pass found a different, more fundamental class of live data-integrity bug in the exact same
multi-warehouse/valuation code paths that audit was scoped to.

---

## What works (verified live)

- **Item create/edit** — `POST /items` with SKU, HSN, GST rate, pricing all validate and persist
  correctly (item id 43, "AUDIT Test Item WACC"); `availableQty` correctly initializes to 0 and
  `costingMethod` correctly defaults to `WACC`.
- **Stock Adjustment Draft→Submit→Approve** — created adjustment id 46 (EXCESS, 100 units @ ₹50),
  confirmed stock only changes on `approve()`, not `submit()`; after approval WH-MAIN correctly
  showed `availableQty: 100.000`.
- **Stock Transfer full happy path** — transfer id 28 (WH-MAIN→WH-SEC, 15 units):
  create→submit→approve→dispatch (WH-MAIN 100→85)→receive (WH-SEC 0→15). Quantities matched
  exactly at every step.
- **Stock Transfer dispatch-then-cancel reversal (commit `c68c2ab`)** — transfer id 27 (20 units):
  dispatched (WH-MAIN 100→80), then cancelled; WH-MAIN correctly restored to 100.000. The recent
  fix is confirmed working live.
- **Physical Verification** — verification id 29 on WH-MAIN: `start-counting` correctly snapshot
  both stocked items (including item 43 at the correct systemQty 80); the "chicken-and-egg" line
  bug fix (2026-07-12) confirmed still fixed — lines were visible via `/variances` immediately
  after start-counting, before any count was entered; entered a physical count of 75 (variance
  −5), approved, auto-generated adjustment id 51, and WH-MAIN stock correctly dropped to 75.
- **Fabric Rolls Receive→Cut** — roll id 9 received at 100m, cut 30m, correctly left at 70m with
  status `PARTIALLY_CUT` and a correct cut-history entry.
- **Cross-tenant isolation** — provisioned a brand-new tenant (93) via the platform-operator
  provisioning API and confirmed its user gets `NOT_FOUND`/empty results for every one of tenant
  2's items, warehouses, stock, stock adjustments, and price lists. The 2026-07-21 "cross-tenant
  price-list vuln fixed" claim holds.
- **Branch RBAC** — created warehouse id 87 under branch 6, and a new user scoped only to branch 1
  (role INVENTORY_MANAGER, `branchIds:[1]`, no `BRANCH_SCOPE_BYPASS`); confirmed a clean
  `WAREHOUSE_OUT_OF_SCOPE` 403 on both `GET /warehouses/87` and `POST /stock-adjustments` against
  it. The 2026-07-21 "no branch RBAC fixed" claim holds.
- **RBAC** — INVENTORY_MANAGER can create stock adjustments/transfers (201); HR_MANAGER (zero
  inventory permissions) gets a clean 403 on `GET /items`, `POST /stock-adjustments`, and
  `POST /stock-transfers`. The 2026-07-12 dead-permission-constant fix holds.

---

## Bugs / gaps found

### 1. CRITICAL — Stock-availability check uses the tenant-wide total, not the specific

warehouse's actual stock (WACC-costed items — the default costing method)

`InventoryLedgerService.deductStock()`, `.adjustStock()` (OUT direction), and `.transferStock()`
(`apps/inventory-service/src/domain/InventoryLedgerService.ts`) all gate the "enough stock?"
check on `items.availableQty` — a single tenant-wide running total across _all_ warehouses — not
on the specific warehouse's row in `projectionStockLevel`, which is what every read endpoint
(`GET /inventory/stock/:itemId`) and the UI actually display. FIFO-costed items are incidentally
protected (`ValuationService.consumeFifoLayers` filters by `warehouseId` and throws a real
per-warehouse `StockInsufficientForCostingError`), but **WACC — the default for every new item —
has no equivalent per-warehouse guard.**

**Live reproduction:** item 43 had 100 units only in WH-MAIN (id 5); WH-SEC (id 9) had zero.

- Created+approved a SHORTAGE (OUT) adjustment of 30 units **at WH-SEC**, which physically had 0.
  It succeeded. `GET /inventory/stock/43` afterward: WH-MAIN still 100.000, WH-SEC clamped to
  0.000 (via `Math.max(0, delta)` on first insert) — but `items.availableQty` (global) dropped to 70. **The global counter and the true per-warehouse sum (100) are now permanently out of sync.**
- To prove the corruption is load-bearing, not cosmetic: tried a legitimate 71-unit OUT
  adjustment **at WH-MAIN**, which physically had 100 units. It was **wrongly rejected**:
  `{"error":{"code":"INSUFFICIENT_STOCK","message":"Insufficient stock. Available: 70", ...}}` —
  blocked by the corrupted global counter, not the real (and sufficient) warehouse stock.
- The desync persists and does not self-heal: after further legitimate transfers (which preserve
  the global sum correctly across their own dispatch/receive pairs), `items.availableQty` stayed
  permanently 30 units below the true per-warehouse sum (`GET /items/43`: `availableQty: "70.000"`
  vs. `GET /inventory/stock/43` summing to 100/90/etc. across warehouses at each check).

**Impact:** any multi-warehouse tenant can (a) silently phantom-deduct stock from a warehouse
that has none, corrupting the item's book value and the tenant-wide counter permanently, and (b)
subsequently have legitimate withdrawals from a warehouse that genuinely has enough stock
wrongly blocked as "insufficient," since the check reads the now-wrong global figure. This
affects Stock Adjustments (reproduced live) and, by the identical code path, Stock Transfer
dispatch (`StockTransferService.dispatch()` → `InventoryLedgerService.deductStock`) — not
separately reproduced but the code is shared and unconditional.

### 2. CRITICAL — Stock-adjustment write-off (LOSS) postings silently never reach the general

ledger; the one that does succeed posts to the wrong account

Reproduced 3-for-3: two direct Stock Adjustment approvals (ids 47, 49) and one
Physical-Verification-auto-generated adjustment (id 51) — all LOSS-direction — never produced a
journal. The single GAIN-direction adjustment (id 46) did post a journal. Root-caused via direct
Postgres/Kafka inspection (`docker exec erp-postgres-primary psql`, `kafka-console-consumer`):

- **Wrong account code, all tenants:** `PostingMatrixService.ts`'s `STOCK_ADJUSTMENT_LOSS`/
  `STOCK_ADJUSTMENT_GAIN` rules use account code `1310` labeled "Inventory Asset" in a comment —
  but per `default-accounts.ts` and the live Chart of Accounts, `1310` is actually **"Prepaid
  Expenses"**; the real Inventory account is `1200`. This means the one journal that _did_ post
  (id 156, for adjustment 46) debited **Prepaid Expenses**, not Inventory — silently misstating
  the balance sheet for every tenant, not just the ones hitting the missing-account bug below.
- **Missing seeded account, at least tenant 2:** account `6110` ("Stock Adjustment Loss") is
  defined in `default-accounts.ts` but does not exist in tenant 2's actual, already-provisioned
  Chart of Accounts (`SELECT ... FROM accounts WHERE tenant_id=2 AND account_code='6110'` → 0
  rows). Every LOSS posting throws inside `PostingMatrixService.buildJournalEntry` for want of
  this account — a seed/backfill gap for tenants provisioned before `6110` was added, same class
  as the earlier GST classification backfill gap.
- **The failure is then completely invisible, platform-wide:** `PlatformEventConsumer`
  (`packages/platform-sdk/src/events.ts`) wraps the inbox-claim INSERT _and_ the handler call in
  one `db.transaction()`. When the handler throws, the whole transaction — including the claim
  row — rolls back. The `catch` block's recovery step is an `UPDATE ... SET status='FAILED'`
  (not an upsert), which then matches **zero rows** and silently no-ops. Combined with Kafka's
  offset still auto-committing past the message, the failure leaves **no** trace anywhere:
  confirmed no `inbox_events` row, no `dlq_items` row, no journal — only a `process.stderr.write`
  line that isn't persisted to any log file this session captured. This bug affects every
  service using this shared consumer whenever any handler throws, not just this flow, but this
  is the mechanism that makes the accounting gap above production-invisible.

**Impact:** every stock write-off (damage/shortage/theft/expiry adjustment, or a physical-count
shortfall) silently fails to hit the books at all — inventory shrinkage stops being expensed —
while the accounting service reports no error and inventory-service reports the adjustment as
cleanly `APPROVED`. This is exactly the failure mode item #5 of this audit's brief asked to rule
out ("confirm accounting-service receives a correctly valued posting").

### 3. HIGH — Per-warehouse Stock Valuation Report always returns zero

`GET /inventory/valuation?warehouseId=<id>` returns `qty: 0, estimated: true` for **every** item
tested, even when that exact item demonstrably has real stock in that exact warehouse per both
`GET /inventory/stock/:itemId` and a direct Postgres query.

**Live reproduction:** item 43 at WH-MAIN (id 5) — `GET /inventory/stock/43` and
`SELECT available_qty FROM projection_stock_level WHERE item_id=43 AND warehouse_id=5` both
correctly show `75.000`. `GET /inventory/valuation?warehouseId=5` for the same item returns
`{"qty": 0, "unitCost": 50, "totalValue": 0}`. Reproduced identically for item 1 ("Cotton
Saree", known non-zero at WH-MAIN). Reran the endpoint's own correlated subquery directly against
Postgres (outside the app) and it correctly returned `75.000` — the SQL itself is correct, so the
bug is in how `apps/inventory-service/src/api/valuation.routes.ts` builds/executes it via
drizzle-orm (the tenant-wide view, with no `warehouseId`, is unaffected and returns correct
totals). Not root-caused further (would require modifying/instrumenting code, out of scope for
an audit-only pass) but the effect is 100% reproducible.

**Impact:** the warehouse-scoped Stock Valuation Report (a PG-032 feature) is non-functional —
any user filtering the valuation report to a specific warehouse sees zero stock and zero value
for the entire warehouse, every time.

---

## Known pre-existing debt (re-confirmed, not new — do not re-flag as fresh)

- `STOCK_TRANSFER_MANAGE`, `STOCK_ADJUSTMENT_MANAGE`, `PHYSICAL_VERIFICATION_VIEW`,
  `PHYSICAL_VERIFICATION_MANAGE`, `FABRIC_ROLL_VIEW`, `FABRIC_ROLL_CREATE`, `FABRIC_ROLL_MANAGE`,
  `STOCK_TRANSFER_APPROVE`, `STOCK_PHYSICAL_VERIFY`, `STOCK_RESERVE`, `STOCK_REPORT_VIEW` are all
  genuinely dead permission constants in `apps/inventory-service` — no route checks any of them
  (fabric-roll routes gate on `ITEM_VIEW`/`ITEM_EDIT` instead; physical-verification routes gate
  on `WAREHOUSE_MANAGE`). Confirmed this is already tracked and explicitly allowlisted as
  known PG-014-class debt in `packages/shared-types/src/__tests__/dead-permission-constants.test.ts`
  — not a new finding. Practical impact today: none for INVENTORY_MANAGER (it holds the real
  gating permissions these routes actually check), but a custom role built around these
  granular-sounding constants would silently not work as an admin would expect from their names.
- Test suite: `pnpm test` in `apps/inventory-service` → **3 files / 9 tests failed**, all with the
  identical "expected 403, got 401" signature (`items-price-list-search.test.ts`,
  `sync-routes.test.ts`, `warehouse-adjustment-transfer-permission-guards.test.ts`). This matches
  the documented pre-existing uncommitted JWT-issuer-validation work-in-progress on
  `packages/platform-sdk/src/auth.ts` flagged in the audit brief, not a new regression. 32 passed,
  15 skipped.

## Untested / unknown

- GRN-triggered stock receipt → accounting posting (`GRNAccountingConsumer` is a separate code
  path from the Stock-Adjustment one covered above; not exercised this session — used direct
  Stock Adjustments instead).
- FIFO costing end-to-end — every item created defaults to WACC; no FIFO item was created/tested,
  so FIFO layer consumption and its warehouse-scoped valuation path are unverified live (code
  review suggests FIFO is _not_ exposed to bug #1 above, but this wasn't live-confirmed).
- Concurrency/race behavior on approve()/dispatch() — the code has explicit atomic-claim UPDATE
  patterns with detailed comments explaining the race they close; not stress-tested with real
  concurrent requests this session.
- Item variants (`variantId` dimension) stock tracking — not exercised.
- Stock reservation (`ReservationEngine.ts`) — not exercised.
- Inventory import/export — not exercised.
- Web-frontend UI itself (`apps/web-frontend/src/pages/inventory`) — this pass was API-level
  only; did not drive the actual browser UI, so any UI-specific rendering/wiring bugs on top of a
  correct API are not covered here.

## Test data created this session (tenant 2 unless noted)

- Item 43 "AUDIT Test Item WACC" (WACC costing), item 44 "AUDIT Fabric Item"
- Stock Adjustments 46 (EXCESS +100, WH-MAIN), 47 (SHORTAGE −30, WH-SEC — the phantom-deduction
  repro), 48 (rejected — the false-insufficient-stock repro), 49 (DAMAGE −5, WH-MAIN), 51
  (auto-generated from Physical Verification 29)
- Stock Transfers 27 (WH-MAIN→WH-SEC 20, dispatched then cancelled), 28 (WH-MAIN→WH-SEC 15, full
  receive)
- Physical Verification 29 (WH-MAIN)
- Fabric Roll 9 (100m received, 30m cut)
- Warehouse 87 (branch 6, for the branch-RBAC repro)
- Price List 3 "Audit PL"
- Users: `audit.branch1@qa-e2e.local` (branch-1-scoped INVENTORY_MANAGER)
- Tenant 93 "Inv Audit Isolation Tenant ..." with admin `inv-audit-1784928925@example.com` (for
  the cross-tenant repro)

## Readiness score: 52/100

- −20 for the two Critical live-confirmed data-integrity bugs (multi-warehouse stock corruption;
  silently-lost accounting postings for every stock write-off) — both hit the module's core
  promise (accurate stock, correctly valued) for the common case of >1 warehouse.
- −10 for the High per-warehouse valuation report bug — a reporting feature that always returns
  zero is arguably worse than no feature at all (false confidence).
- −8 for the accounting integration reliability gap (silent swallow with zero DLQ/log trace) —
  this is a trust/observability problem on top of the correctness problem.
- Otherwise the module's workflow surface (adjustments, transfers, physical verification, fabric
  rolls), RBAC, branch scoping, and tenant isolation are genuinely solid and were re-verified
  live with real data, which is why this isn't scored lower.
