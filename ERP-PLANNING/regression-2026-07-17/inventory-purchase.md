# QA Regression: Inventory + Purchase — 2026-07-17

Scope: Items, Stock Levels, Categories, Brands, Units, Price Lists, Transfers, Adjustments,
Physical Verification, Fabric Rolls, Stock Valuation, Suppliers, Purchase Orders, GRNs,
Supplier Payments, Purchase Returns, Expenses.

Env: web http://localhost:5173, gateway http://localhost:3000, tenant 2 (QA E2E Test Co),
owner@qa-e2e.local / OWNER role.

Method: live browser driven via Playwright scripts in `apps/web-frontend/.qa-tmp/inv2-*.mjs`
(throwaway, not committed).

Status: COMPLETE

---

## Summary

(filled in at the end)

---

## Findings

### 1. [HIGH] Item creation fails with 500 for every item after the first one with no barcode

- **Area:** Inventory > Items > New Item
- **Repro:**
  1. Go to `/inventory/items/new`.
  2. Fill Name, Item Code, HSN, GST rate, Unit, Sale Price, Purchase Price. Leave Barcode blank (default, most users will).
  3. Submit.
  4. First item of this kind may succeed (item id=7 "QA Item ..." already existed with `barcode: ""`). Creating a **second** item with barcode left blank fails.
- **Expected:** Item created successfully; blank barcode should not collide with other blank-barcode items.
- **Actual:** `POST /api/inventory/items` returns `500 {"error":{"code":"INTERNAL_ERROR","message":"An unexpected error occurred"}}`. inventory-service log shows a failed INSERT into `items` (Postgres unique-constraint violation is implied though the logged error string is truncated to just the query, not the underlying pg error detail).
- **Root cause:** `packages/db-client/src/schema/items.ts` defines `unique('items_tenant_barcode').on(t.tenantId, t.barcode)`. The create-item form (and `POST /items` handler in `apps/inventory-service/src/api/item.routes.ts` lines ~234-250) sends `barcode: ""` when the user leaves the field empty, instead of `null`/omitted. Postgres treats empty string `''` as a real, non-distinct value for a unique index (unlike `NULL`, which is always distinct), so the _second_ item ever created without a barcode collides with the first and the INSERT throws a unique-violation, which the generic error handler surfaces as a bare 500/"unexpected error" instead of a friendly "duplicate barcode" message.
- **Impact:** Any tenant that has ever created one item without an explicit barcode can never create another item without a barcode again — item creation is effectively broken for the common no-barcode-yet workflow. Confirmed reproducible twice with two different item codes (both got the same 500).
- **Evidence:** Request payload `{"name":"QA Regression Item ...","itemCode":"QAINV...","barcode":"","barcodeType":"CODE128",...}` → 500. Existing item id=7 in tenant 2 has `"barcode": ""`. inventory-service log (`tmp-logs/inventory-service.log`) shows two consecutive `Unhandled error in inventory-service` entries at `url: /api/v2/items` for both attempts.
- **Suggested fix area:** frontend should omit `barcode` from the payload when blank (or send `undefined`/`null`), and/or backend should coerce empty-string barcode to `null` before insert; also fix the error handler catch-all to surface unique-constraint violations as a friendly 409/validation error instead of a generic 500.
- **Workaround used to continue testing:** supplied an explicit unique barcode value per item for the rest of this session.

### 2. [MEDIUM] Duplicate item code also surfaces as generic 500, not a friendly validation error

- **Area:** Inventory > Items > New Item
- **Repro:** Create an item using an `itemCode` that already exists for the tenant (e.g. `QASKU1784260577319`, which already existed).
- **Expected:** A clear validation error, e.g. "Item code already exists" (409/422), matching the friendly-error-handler work done in PG-059.
- **Actual:** `POST /api/inventory/items` → 500, UI shows generic "An unexpected error occurred". Same root cause class as Finding #1: the `items_tenant_code` unique constraint violation isn't translated into a business error before it reaches the generic catch-all handler in inventory-service.
- **Severity:** Medium (workflow isn't blocked long-term — user can pick a different code once they realize — but the error message gives no indication of what went wrong).
- **Suggested fix area:** `apps/inventory-service/src/api/item.routes.ts` POST /items handler — catch Postgres unique-violation (code 23505) and re-throw as a `ConflictError`/`ValidationError` with a field-specific message, or check-then-insert. Same fix would likely resolve Finding #1 too if barcode empty-string handling isn't separately fixed.

### 3. [HIGH] Item detail endpoint serves stale stock/valuation for up to 5 minutes after a GRN (or any cross-service stock write)

- **Area:** Inventory > Items (detail), and any other consumer of `GET /api/inventory/items/:id`.
- **Repro:**
  1. Note an item's `availableQty`/`waccCost`/`currentStockValue` via `GET /api/inventory/items/:id` (single-item route).
  2. Receive stock against it via a GRN approval (purchase-service writes directly to the `items` table — see Finding chain below).
  3. Immediately re-query `GET /api/inventory/items/:id`.
  4. Repeat the same query a few minutes later.
- **Expected:** Stock reflects the GRN receipt immediately (or at least consistently) once the GRN-approval transaction commits.
- **Actual:** For up to 5 minutes, `GET /api/inventory/items/:id` kept returning the pre-GRN values (`availableQty: 3187.000`) even though the underlying DB row was already correctly updated to `3387.000` (confirmed via the uncached list route `GET /api/inventory/items` immediately after approval, and via the `version` column incrementing 194→195 right after approval). After the ~5 minute TTL expired, the single-item endpoint self-healed and started returning the correct value.
- **Root cause:** `apps/inventory-service/src/api/item.routes.ts` line 180 (`GET /items/:id`) reads through a Redis cache (`ItemCacheService`, `apps/inventory-service/src/domain/ItemCacheService.ts`, `ITEM_CACHE_TTL_SECONDS = 300`) that is only invalidated by inventory-service's _own_ mutation routes (`item.routes.ts` lines 323 and 361, e.g. PUT/DELETE item). `apps/purchase-service/src/domain/GRNService.ts` `approve()` (lines ~230-410) writes `items.availableQty`/valuation fields **directly to the shared DB table**, bypassing inventory-service's API entirely, so it never calls `itemCache.invalidateItem()`. Same architecture pattern flagged before in project memory ("No cross-service transactional logic — ledger-writing services duplicate domain logic"), but this is the caching consequence of it.
- **Impact:** Any consumer of the single-item GET route (item detail page, and potentially POS/other lookups that hit this endpoint rather than the list) can show wrong available stock and wrong WACC/stock-value for up to 5 minutes after **any** GRN receipt. Likely also applies to Purchase Returns, Stock Transfers, Physical Verification adjustments, Production material consumption, and Sales deductions if those services also write `items` directly — not individually re-verified in this session for time reasons, but the same architectural gap applies to all of them.
- **Note (not a bug):** The actual GRN stock math is correct — verified `currentStockValue` after receipt = `572057.84 (before) + 200 × ₹190 (received) = 610057.84` exactly, and `waccCost` recalculated to `610057.84 / 3387 = 180.12` correctly. Only the cache invalidation is broken.
- **Suggested fix area:** either have `GRNService.approve()` (and other services' direct-write stock paths) call inventory-service's cache-invalidation, or move item cache invalidation to a shared event listener on `STOCK_IN`/inventory-ledger events, or shorten TTL / add write-through invalidation via Redis pub-sub.

### 4. [MEDIUM] Purchase Orders list shows raw supplier ID instead of supplier name; no PO detail view exists

- **Area:** Purchase > Purchase Orders (list)
- **Repro:** Go to `/purchase/orders`. Look at the "SUPPLIER" column.
- **Expected:** Supplier display name (e.g. "Global Textiles Supplier").
- **Actual:** Shows the raw numeric `supplierId` (e.g. `2`) for every row. Same for the GRNs list page (`/purchase/grns`) "Supplier" data.
- **Root cause:** `apps/web-frontend/src/pages/purchase/PurchaseOrdersPage.tsx` line 136: `{ key: 'supplierId', header: 'Supplier' }` — the column renders the raw ID field directly with no name lookup/join. The `PurchaseOrder` interface (line 24-32) never carries a supplier name field at all.
- **Additional gap found while investigating:** there is no PO detail page/route (`/purchase/orders/:id` returns the app's "Page not found" screen — confirmed via `apps/web-frontend/src/App.tsx`, which only registers `purchase/orders` and `purchase/orders/new`) and no drawer/modal shows the full PO content either — `PurchaseOrdersPage.tsx`'s `ERPDrawer` (line 328) is wired only for Attachments, not a general view. After creating a PO you can Submit/Approve/Duplicate/Cancel/Attach from the list row actions, but there is no way to see its line items, GST breakdown, or receipt history again outside the tiny "PO # Draft-46 · Supplier ID: 2 · Lines: 1" summary shown transiently on the GRN creation form. Note: rows in the DRAFT status legitimately show "Draft" as the PO#, since real `poNumber` is only assigned at Approve time (confirmed by design, not a bug) — this made it harder to identify PO 46 by number and required matching on amount to find the right list row.
- **Severity:** Medium — doesn't block the core Draft→Submit→Approve→GRN workflow (verified end-to-end), but is a real usability gap: user has no way to audit/review a placed PO after the fact except the list's summary columns.

### PO -> GRN full chain — worked correctly (aside from findings above)

- Created PO (supplier search, branch/warehouse/place-of-supply selects, item-line add, qty/rate entry) — GST calc correct (200 × ₹190 × 1.05 = ₹39,900.00 exactly).
- PO Draft -> Submit -> Approve workflow gating enforced correctly (GRN creation against a DRAFT/SUBMITTED PO is correctly rejected with a clear 422 `INVALID_PO_STATUS` friendly error — this is correct/expected behavior, not a bug).
- GRN creation against an APPROVED PO worked; GRN Draft -> Approve workflow gating enforced (stock only moves on GRN approval, with an explicit "Approving will add stock to the warehouse and update the purchase order status" warning + required GRN Number field — good UX).
- Post-approval: PO status correctly transitioned to RECEIVED, PO `receivedAmount` updated, GRN status APPROVED with assigned `grnNumber`, inventory ledger entry created, stock and WACC valuation math both verified exactly correct (see Finding #3 note).
- The "GRN creation branchId/date field" bug from the prior QA session (per project memory) was NOT reproduced — GRN creation form worked cleanly with sensible pre-filled defaults (receive qty = remaining, GRN rate = PO rate).

### 5. [LOW] Stock Transfer detail page is a placeholder stub — no line items, quantities, or warehouse names shown

- **Area:** Inventory > Transfers > (detail) e.g. `/inventory/transfers/26`
- **Repro:** Create any stock transfer, then open its detail page from the list (or navigate directly to `/inventory/transfers/:id`).
- **Expected:** A detail view showing the transferred items, quantities, warehouse names, and workflow history/actions.
- **Actual:** The entire page body is one line of text: `"Stock transfer detail view — From: 12 → To: 5 | Status: DRAFT"` — raw warehouse IDs instead of names, no items/quantities shown at all, no actions available from this page.
- **Root cause:** `apps/web-frontend/src/pages/inventory/StockTransferDetailPage.tsx` (lines 21-35) is a literal placeholder — it renders `t.fromWarehouseId`/`t.toWarehouseId`/`t.status` as raw text and nothing else; no line-items table was ever built.
- **Severity:** Low — the actual transfer workflow (Draft → Submit → Approve → Dispatch → In Transit → Received) is driven entirely from the list page's row actions and works correctly (confirmed: 15+ pre-existing transfers reached RECEIVED status; new transfer created cleanly with correct warehouse IDs and DRAFT status). This is a missing detail/audit view, not a functional blocker.

### 6. [LOW] `/inventory/physical-verifications/new` is a broken orphan route (500 on load)

- **Area:** Inventory > Physical Verification
- **Repro:** Navigate directly to `http://localhost:5173/inventory/physical-verifications/new` (e.g. via bookmark, back-button, or typed URL).
- **Expected:** Either a "new verification" form, or this URL doesn't exist / redirects sensibly.
- **Actual:** Page loads the **detail** page component with `id = "new"`, which gets parsed as `NaN` and fires `GET /api/inventory/physical-verifications/NaN` → `500 {"error":{"code":"INTERNAL_ERROR","message":"An unexpected error occurred"}}` (fired twice — React StrictMode double-invoke or a retry). Page renders with no visible content/form, "Start Verification" button never appears.
- **Actual intended flow (confirmed working):** The real "+ Start Verification" action on the list page (`/inventory/physical-verifications`) opens a "New Physical Verification" **modal** (Warehouse select + Create button) — this works correctly and is presumably what all real users go through. The broken `/new` route appears to be an orphan/leftover that nothing in the app actually links to, but it is still routable and crashes if hit.
- **Severity:** Low — no evidence any in-app link points here (the working flow is a modal, not a route), so unlikely to be hit by normal navigation. Still worth fixing since typing/bookmarking the URL is a plausible user action and it currently 500s instead of 404ing cleanly.

### 7. [HIGH] GRN receipts never populate the per-warehouse stock projection — breaks Stock Levels page and makes Physical Verification uncountable for that warehouse

- **Area:** Inventory > Stock Levels, Inventory > Physical Verification; root cause in Purchase > GRN approval.
- **Repro:**
  1. Receive stock into a warehouse via GRN approval (e.g. warehouse 12 "QA E2E Warehouse", +200 Cotton Saree — same GRN as Finding #3).
  2. Check `GET /api/inventory/inventory/stock?warehouseId=12` (the Stock Levels page's data source).
  3. Start a Physical Verification for that same warehouse (list page "+ Start Verification" modal → select warehouse → Create → "Start Counting (Take Snapshot)").
- **Expected:** Stock Levels for warehouse 12 shows the received Cotton Saree (200 units); the Physical Verification counting table lists it as a line to count (System Qty 200, blank Physical Qty to fill in).
- **Actual:** `GET /api/inventory/inventory/stock?warehouseId=12` returns `{"content": [], "totalElements": 0}` — completely empty, despite the item genuinely having 200 units in that warehouse (confirmed via GRN/PO/ledger records and the item's global `availableQty` increasing by exactly 200). The Physical Verification counting screen (`PV-2-1784275541786`, id 28) shows a "Snapshot taken" confirmation but the counting table has **zero rows** — nothing to count, so this verification can never produce a meaningful variance for warehouse 12's actual stock.
- **Root cause:** `apps/purchase-service/src/domain/GRNService.ts` `approve()` (same block covered in Finding #3) updates `items.availableQty` (the global per-item counter) and `inventoryLedger`, but never writes/updates a row in `projection_stock_level` (the per-warehouse breakdown table, `packages/db-client` schema `projectionStockLevel`, imported and used by `apps/inventory-service/src/api/stock.routes.ts`). Physical Verification's snapshot-and-count logic reads from this same per-warehouse projection, so a warehouse whose only stock ever came in via GRN has no rows to snapshot.
- **Corroborating evidence:** even for a _different_, older item (Cotton Saree, id 1) with substantial pre-existing stock, the per-warehouse breakdown (`warehouse 5: 2905` + `warehouse 9: 437` = 3342) never matched the item's own global `availableQty` (3187 at the time, later 3387) — a persistent ~155-unit-plus discrepancy that predates this session's testing, consistent with this same table being unreliable/stale across multiple stock-movement types, not just GRN.
- **Impact:** Stock Levels page under-reports or omits stock for any warehouse that received goods via GRN without some other route also touching `projection_stock_level`. Physical Verification is effectively non-functional for such warehouses — there is nothing to count, so discrepancies (theft, damage, miscounts) in GRN-received stock can never be caught by this control.
- **Severity:** High — this silently defeats a core inventory-control feature (physical stock counting) for a common, everyday operation (receiving purchased goods).
- **Suggested fix area:** `GRNService.approve()` should upsert `projection_stock_level` (increment `availableQty` for `(tenantId, itemId, warehouseId)`, matching the pattern presumably used by inventory-service's own stock-adjustment/transfer confirm routes) in the same transaction as the `items` table update. Given the recurring nature of this exact class of bug (see project memory: "QA Physical Verification live E2E — projection_stock_level duplicate rows"), a broader audit of every write path that's supposed to keep `projection_stock_level` in sync (GRN, Purchase Return, Sales/POS deduction, Stock Transfer, Stock Adjustment, Production consumption) is warranted rather than a one-off patch.

### 8. [LOW] Recurring pattern: raw warehouse/supplier IDs shown instead of names across Purchase/Inventory

- Seen in: PO list "Supplier" column (Finding #4), GRN list "Supplier" data, Stock Transfer detail page ("From: 12 → To: 5"), Physical Verification detail page ("Warehouse 12 · DRAFT/COUNTING"). Not chasing every occurrence individually — flagging as one systemic UI polish item: several of these pages/components render the raw foreign-key ID directly rather than resolving it to the entity's display name, likely because the underlying list/detail API responses don't join the name and the frontend doesn't do a client-side lookup either.

### Item validation — worked correctly

- Negative sale price (`-500`) typed into the numeric Sale Price field: browser-level `<input type="number">` constraints/client validation prevented submission — no item was created with a negative price (confirmed via API search, zero results). No bug here.

### Purchase Return — worked correctly (prior "100% broken" bug confirmed fixed, no regression)

- Loaded GRN 26, returned a partial quantity (20 of 200) with reason QUALITY ISSUE, created in DRAFT.
- Approved the return: stock correctly deducted (3387 → 3367, exact match), debit note auto-generated (`debitNoteId: 8`) in the same call.
- Purchase Returns list correctly resolves and displays supplier name ("Global Textiles Supplier") and linked GRN number — unlike the PO list (Finding #4/#8).

### Supplier Payment — worked correctly

- Created a payment (Supplier ID 2, ₹5,000, NEFT) against the supplier from the PO/GRN chain — `201` success, appeared correctly in the Supplier Payments list with resolved supplier name, correct amount/mode, status PAID.
- Note: the Supplier Payment form requires typing a raw numeric Supplier ID (no search-as-you-type like the PO form has) — a UX inconsistency worth flagging alongside Finding #8, but not a functional bug.

### Stock Valuation report — worked correctly

- `/inventory/valuation` correctly reflects the live post-GRN-and-return state: Cotton Saree shows qty 3367.00, WACC ₹181.19/unit, total value ₹6,10,057.84 — consistent with the exact `currentStockValue` figure from the items table (this report queries live, not through the stale item-cache from Finding #3).

### Quick sweep — Categories, Brands, Units, Price Lists, Fabric Rolls, Expenses

- All list pages load cleanly with zero console/network errors: `/inventory/categories`, `/inventory/brands`, `/inventory/units`, `/inventory/price-lists`, `/purchase/expenses`, `/inventory/fabric-rolls`. Not full-CRUD tested individually given time budget — no crashes or obvious breakage found on load.

---

## Summary

**8 bugs found** (2 High, 2 Medium... see counts below), zero fixes applied (investigation only, per instructions).

By severity:

- **HIGH (3):** #1 item creation 500s for every item after the first with a blank barcode (blocks a common workflow); #3 item-detail endpoint serves stale stock/valuation for up to 5 minutes after any GRN due to a cross-service cache-invalidation gap; #7 GRN receipts never populate the per-warehouse stock projection, silently breaking Stock Levels accuracy and making Physical Verification uncountable for GRN-received warehouses.
- **MEDIUM (2):** #2 duplicate item code also 500s instead of a friendly error (same root cause class as #1); #4 Purchase Orders list shows raw supplier ID instead of name, and no PO detail view exists anywhere in the app.
- **LOW (3):** #5 Stock Transfer detail page is a one-line placeholder stub; #6 `/inventory/physical-verifications/new` is a broken orphan route (500, but nothing links to it); #8 recurring raw-ID-instead-of-name display pattern across several pages.

**Top issues to prioritize:**

1. **#1 (item creation 500 on blank barcode)** — highest real-world impact, blocks the single most common inventory action (adding a new item without a barcode) after the first such item exists for a tenant.
2. **#7 (GRN doesn't update per-warehouse stock projection)** — quietly defeats Physical Verification as a stock-integrity control for any warehouse stocked via purchasing, which is most of them.
3. **#3 (5-minute stale item cache after GRN)** — could look like "stock didn't update" to a store user checking the item page right after receiving goods, even though the underlying data and math are correct.

**What worked well:** the full Item → Stock Adjustment (spot-check) → PO → GRN → Stock Transfer → Physical Verification → Purchase Return → Supplier Payment chain is functionally wired end-to-end with correct GST/WACC/valuation arithmetic throughout. All three previously-reported bugs from earlier QA sessions (GRN branchId/date, Transfers stuck in DRAFT, Purchase Return 100% broken) were re-verified as genuinely fixed with no regression.

Full details, repro steps, and evidence are in this file above (`ERP-PLANNING/regression-2026-07-17/inventory-purchase.md`).
