# [PG-046] Reorder Auto-PO — Real GST Rate Lookup

> Template version 1.0. Every gap-prompt file in this tree must follow this exact section order. Do not add sections; do not omit sections that apply. If a section genuinely does not apply to this gap, write "Not applicable — <one-line reason>" instead of deleting it, so the structure stays diffable across files.

**Category:** Production
**Priority:** High
**Complexity:** S — the fix is a query join plus swapping a hardcoded literal for a call to an existing, already-proven calculation function; no schema change and no new service integration is required.
**Depends on:** none
**Blocks:** none
**Primary service(s)/package(s):** apps/production-service (src/domain/ReorderService.ts, src/api/reorder.routes.ts)

---

## Overview

- **Business objective:** the reorder-automation feature lets a tenant generate draft Purchase Orders automatically from a below-reorder-level stock report, grouped by supplier. Every one of those auto-created POs today posts **18% CGST+SGST (9%+9%) on every line, unconditionally** — regardless of the item's actual GST rate (many items are not 18%: cotton fabric/certain garments are frequently 5% or 12%; some accessories differ again) and regardless of whether the transaction is even intrastate (CGST+SGST only applies when buyer and supplier are in the same state — an interstate purchase should be 100% IGST, never split CGST/SGST). A tenant that reorders from an out-of-state supplier or stocks any item that isn't actually 18% GST gets **every auto-generated PO's tax figures wrong**, which is a real GST-filing-accuracy defect once that PO is received (GRN) and posted to the ledger/GST returns, not a cosmetic rounding issue.
- **Current implementation:** confirmed by direct read of `apps/production-service/src/domain/ReorderService.ts`, `createPOsFromReorder` (lines 105-137). Every purchase-order line is inserted with:
  ```ts
  gstRate: '18',
  cgstRate: '9',
  sgstRate: '9',
  igstRate: '0',
  taxableAmount: String(lineTotal),
  cgstAmount: String(lineTotal * 0.09),
  sgstAmount: String(lineTotal * 0.09),
  igstAmount: '0',
  lineTotal: String(lineTotal * 1.18),
  ```
  and the PO-level `grandTotal` is likewise force-multiplied by a flat `1.18` (line 136: `grandTotal: String(grandTotal * 1.18)`). There is no reference anywhere in this file to the item's actual GST rate, its HSN code, or the supplier's/branch's state for an interstate check — the `0.09`/`0.09`/`1.18` literals are unconditional for every line of every auto-created PO, for every tenant.
- **Current architecture:** `ReorderService.createPOsFromReorder` groups the caller-supplied `items: Array<{ itemId, supplierId, quantity, unitPrice }>` by `supplierId`, then inserts one `purchaseOrders` row + N `purchaseOrderLines` rows per supplier group inside a single transaction, followed by a `REORDER_PO_CREATED` outbox event. The request schema (`apps/production-service/src/api/reorder.routes.ts`, `CreatePOsSchema`) only accepts `branchId, warehouseId, placeOfSupply, items[{itemId, supplierId, quantity, unitPrice}]` — it never collects or forwards the item's GST rate/HSN, nor the supplier's state code (`sellerStateCode`), so even if the hardcoding were removed, today's request payload has no per-item GST-rate/HSN data and no seller-state data to compute a real answer from.
- **Current limitations:** items already carry real, per-item GST data (`packages/db-client/src/schema/items.ts` line 171-173: `hsnCode` (notNull), `gstRate` (decimal, default `'18'` but genuinely per-item and frequently overridden away from 18 for real catalog items), `cessRate`). `purchaseOrders` already has a `sellerStateCode` column (`packages/db-client/src/schema/purchase.ts` line 41) that the *normal* (non-reorder) PO-creation flow already populates and uses — `ReorderService` simply never reads either of these existing, real data sources.

## Existing Code Analysis

- **What already exists and should be reused:** `apps/purchase-service/src/domain/GSTCalculator.ts` is a proven, already-in-production static class (`GSTCalculator.computeLine({ unitPrice, quantity, discountPct, discountAmount, gstRate, cessRate?, sellerStateCode, placeOfSupply })` → `{ taxableAmount, cgstRate, sgstRate, igstRate, cgstAmount, sgstAmount, igstAmount, cessRate, cessAmount, lineTotal }`), doing exactly the intrastate-vs-interstate CGST/SGST-vs-IGST auto-switch this gap needs: `const isIntrastate = input.sellerStateCode === input.placeOfSupply; cgstRate = isIntrastate ? gstRate/2 : 0; igstRate = isIntrastate ? 0 : gstRate;`. `apps/purchase-service/src/domain/PurchaseOrderService.ts` already calls this calculator correctly per-line for the *normal* (non-reorder) PO-creation path (lines 50-61: builds `GSTLineInput` per line from `l.gstRate`/`l.hsnCode`/`params.sellerStateCode ?? params.placeOfSupply`/`params.placeOfSupply`, then `GSTCalculator.sumTotals(computedLines)`) — this is the exact integration pattern to mirror, confirmed by direct read, not a guess. `apps/sales-service/src/domain/GSTCalculator.ts` is a near-identical (independently duplicated) implementation used the same way at invoice-confirm time — its existence confirms this codebase's established convention is **per-service duplication of the GST-calculation domain logic**, not a network call to a shared "gst-service" microservice. (There is a separate `gst-service` in this monorepo, but it owns GSTR-1/GSTR-3B/GSTR-9 return filing and e-invoice/e-way-bill generation — it is not a synchronous per-line tax-rate calculator that other services call at transaction time. Confirmed by this codebase's own documented architecture note: "No cross-service transactional logic — ledger-writing services duplicate domain logic (GSTCalculator, ValuationService) rather than call another service.") The correct fix therefore is a **new, small `GSTCalculator.ts` in `apps/production-service`**, copying the same proven shape already duplicated in `sales-service` and `purchase-service` — not a network call to `gst-service` or to `purchase-service`.
- **What should never be modified:** `ReorderService.getReorderRequired` (the below-reorder-level report itself) is correct and out of scope — only `createPOsFromReorder`'s hardcoded tax block needs to change. `purchase-service`'s and `sales-service`'s own `GSTCalculator.ts` files must not be imported cross-service (that would violate the established per-service-duplication convention and create an unwanted runtime dependency of production-service on purchase-service's internal module) — copy the logic into a new file, don't import across service boundaries.
- **Prior related work:** none in `ERP-PLANNING/phase-completions/` — `FEATURE_INVENTORY.md` §5.3 (Production) and §8 both flag the reorder-automation feature's hardcoded 18% GST as a known gap, confirmed accurate by this direct read.

## Architecture

- **New `apps/production-service/src/domain/GSTCalculator.ts`**, copying `purchase-service`'s `GSTCalculator.computeLine`/`sumTotals` shape verbatim (same interface names, same rounding convention `Math.round(x * 100) / 100`) — this is the "only as much redesign as the gap needs" answer: production-service needs the same intrastate/interstate switch purchase-service already has proven correct, and this codebase's own convention is to duplicate this specific calculator per service rather than share it, so introducing a shared `@erp/gst-calculator` package here would be a **larger, out-of-scope refactor** of an established (if unusual) architectural convention — flag it as a possible future consolidation, but do not attempt it as part of this High/S-complexity fix.
- **Item GST-rate/HSN lookup:** `createPOsFromReorder` currently receives only `{ itemId, supplierId, quantity, unitPrice }` per item from the caller. Add a join against `items` (already imported in `ReorderService.ts` — it's used by `getReorderRequired`, just not by `createPOsFromReorder`) to fetch `gstRate`/`hsnCode`/`cessRate` for each `itemId` at PO-creation time, rather than trusting the caller to supply it — this matches the read of `getReorderRequired`, which already queries `items` for the same tenant/item set, so the join pattern is already established in this same file.
- **Seller-state resolution for interstate detection:** `CreatePOsSchema` (in `reorder.routes.ts`) currently has no `sellerStateCode` field. Two options, stated explicitly rather than picked silently: (1) require the caller to pass `sellerStateCode` per supplier group (mirrors `purchase-service`'s normal PO-creation contract, which already makes `sellerStateCode` an optional request field — see `purchase-order.routes.ts` line 31), or (2) look up each supplier's registered state from the supplier master (if `purchase-service`'s supplier table already stores a state field — verify at implementation time) so the caller doesn't have to supply it redundantly. **Recommend option 2** (server-side lookup) since the reorder-automation flow is explicitly a "nightly automated" feature per its own framing — an automated job has no human in the loop to supply `sellerStateCode` per PO, so it must be resolvable from data already on file for the supplier, not from request input. If the supplier master does not yet store a state field, fall back to option 1 (accept it as an optional request field, defaulting to `placeOfSupply` — i.e. assume intrastate — only as a last resort, and log a warning so a tenant relying on that silent default can be identified later).
- **Component/data flow:** `POST /inventory/reorder/create-pos` → `ReorderService.createPOsFromReorder` → for each item, join `items` for `gstRate`/`hsnCode`/`cessRate` → resolve `sellerStateCode` for the item's `supplierId` (per the resolution strategy above) → `GSTCalculator.computeLine({ unitPrice, quantity, discountPct: 0, discountAmount: 0, gstRate: item.gstRate, cessRate: item.cessRate, sellerStateCode, placeOfSupply: params.placeOfSupply })` → per-line `cgstRate/sgstRate/igstRate/cgstAmount/sgstAmount/igstAmount` replace the current hardcoded block → `GSTCalculator.sumTotals(lines)` replaces the current flat `* 1.18` PO-level total.

## Database Changes

Not applicable — no schema change. `items.gstRate`/`hsnCode`/`cessRate` and `purchaseOrders.sellerStateCode` already exist; this package only adds a query that reads them (a join `ReorderService.ts` doesn't currently perform in `createPOsFromReorder`, though the same file's `getReorderRequired` already queries `items`).

## Backend

- `apps/production-service/src/domain/GSTCalculator.ts` (new file): copy of `purchase-service`'s `GSTCalculator.computeLine`/`sumTotals`, same interfaces/rounding.
- `apps/production-service/src/domain/ReorderService.ts`: `createPOsFromReorder` — before the per-item loop (lines 106-132), fetch `items` rows for the involved `itemId`s (`gstRate`, `hsnCode`, `cessRate`) in one query (avoid N+1 — batch-select by `itemId IN (...)`, matching this file's existing single-query style in `getReorderRequired`); resolve `sellerStateCode` per `supplierId` per the Architecture section's recommended server-side lookup; replace the hardcoded `gstRate: '18', cgstRate: '9', sgstRate: '9', igstRate: '0'` block and the flat `lineTotal * 1.18`/`grandTotal * 1.18` multipliers with `GSTCalculator.computeLine(...)`/`sumTotals(...)` output, storing `hsnCode` on each `purchaseOrderLines` row too (the existing normal PO-creation flow already stores `hsnCode` per line — per the grep of `PurchaseOrderService.ts` lines 105-113 — `purchaseOrderLines` almost certainly already has an `hsnCode` column; confirm and populate it here for consistency, since today's reorder-created lines silently omit it).
- `apps/production-service/src/api/reorder.routes.ts`: `CreatePOsSchema` — no required field change if the server-side supplier-state lookup (option 2) is used; if falling back to option 1 (request-supplied `sellerStateCode`), add it as `z.string().length(2).optional()` per supplier-group item, following the exact optionality convention already used by `purchase-service`'s own `CreatePOSchema`.
- Events/Kafka: `REORDER_PO_CREATED` outbox event payload is unchanged in shape (still `{ poId, supplierId, itemCount }`) — the fix is entirely in how the PO's own stored tax fields are computed, not in what's published about it.

## Frontend

Not applicable — this is a backend calculation-accuracy fix. The existing reorder-required report / "Create POs" action UI (wherever it lives in web-frontend — verify at implementation time, likely under `production` or `inventory` pages) needs no shape change since the PO's tax fields are computed server-side and already displayed via the existing PO-detail view once created.

## API Contract

- `POST /inventory/reorder/create-pos` — request shape unchanged unless the option-1 fallback (`sellerStateCode` per item) is needed; response shape unchanged (`201 { data: { poIds } }`). The only externally-visible change is that the created POs' `purchaseOrders`/`purchaseOrderLines` rows (readable via the existing `GET /purchase-orders/:id` in purchase-service, since reorder-created POs live in the same `purchaseOrders` table) now carry correct, item-specific, intrastate/interstate-correct GST figures instead of a flat 18% CGST+SGST.

## Multi-Tenant Considerations

- The new `items` lookup must stay tenant-scoped (`eq(items.tenantId, tenantId)`, matching every other query in this file) — no new isolation logic needed since `ReorderService`'s constructor already receives a tenant-scoped `ErpDatabase`/`ctx.db.raw` per the existing `reorder.routes.ts` handler pattern.

## Integration

- **production-service only** for the code change. The resulting POs are read/received by **purchase-service** (GRN flow) exactly as today — no purchase-service code change is needed, since the fix makes production-service write *correct* values into the same `purchaseOrders`/`purchaseOrderLines` tables purchase-service already owns and already reads for GRN/ledger posting. This is worth flagging explicitly: production-service directly writing into purchase-service's tables (`purchaseOrders`, `purchaseOrderLines`, both imported from `@erp/db` in `ReorderService.ts`) is a pre-existing cross-service data-ownership pattern in this codebase, not something this package introduces or should attempt to refactor — it's out of scope here, but a future architecture review might want to reconsider whether `production-service` should instead call a `purchase-service` API to create reorder POs rather than writing directly into its tables.

## Coding Standards

- Reuses the exact `GSTCalculator` shape already proven twice in this codebase (`sales-service`, `purchase-service`) rather than inventing a third, different calculation approach — the new `production-service` copy should match those two as closely as possible so a future consolidation (if ever undertaken) is a mechanical dedup, not a behavior-reconciliation exercise.
- No new Fastify/Zod/Drizzle pattern introduced — this is a same-file, same-service change using patterns already present in `ReorderService.ts` (batched `items` query, transaction-scoped inserts).

## Performance

- One additional batched `SELECT ... WHERE item_id IN (...)` per `createPOsFromReorder` call (not per-item — batch it) — negligible, this endpoint is a low-frequency (manual or nightly-triggered) admin action, not a hot path.
- Supplier-state resolution: if done via a join/batched lookup keyed by the distinct `supplierId`s already being grouped in this same method, adds no meaningful overhead.

## Security

- Not applicable beyond the existing `REORDER_CREATE_PO` permission already gating this route (`reorder.routes.ts` line 46) — this is a calculation-accuracy fix, not a new capability or new attack surface.

## Testing

- New `apps/production-service/src/__tests__/reorder-gst.test.ts` (or extend an existing `ReorderService` test file if one exists — verify at implementation time): an item with `gstRate: '12'` produces `cgstRate/sgstRate: 6/6` (intrastate) or `igstRate: 12` (interstate) — not the old hardcoded 18/9/9; an interstate reorder PO (`sellerStateCode !== placeOfSupply`) produces `igstAmount > 0` and `cgstAmount === sgstAmount === 0`; an item with a non-zero `cessRate` correctly carries cess through to the PO line (today's hardcoded block has no cess handling at all — confirm this is also a real, if smaller, gap being closed incidentally); PO-level `grandTotal` matches `GSTCalculator.sumTotals`'s output, not a flat `* 1.18`.
- Regression case: an 18%-GST item bought intrastate should still produce the exact same `cgstRate: 9, sgstRate: 9, igstRate: 0` figures as today (proving the fix is a generalization, not a behavior change, for the one case today's hardcoding happens to get right).

## Acceptance Criteria

- [ ] A reorder-created PO for a 5% or 12% GST item shows that item's real rate split correctly across CGST/SGST or IGST — not a flat 18%.
- [ ] A reorder-created PO where the supplier's state differs from `placeOfSupply` shows 100% IGST, `0` CGST/SGST.
- [ ] A reorder-created PO's `hsnCode` per line matches the item's real HSN code (previously silently omitted).
- [ ] An 18%-GST intrastate item still produces `cgstRate: 9, sgstRate: 9` (regression-safe for the one case today's hardcoding happens to match).
- [ ] `pnpm --filter production-service type-check` and `pnpm --filter production-service test` pass, including new GST-accuracy tests.

## Deliverables

- **Files to create:** `apps/production-service/src/domain/GSTCalculator.ts`, `apps/production-service/src/__tests__/reorder-gst.test.ts` (or equivalent extension of an existing test file).
- **Files to modify:** `apps/production-service/src/domain/ReorderService.ts` (`createPOsFromReorder` — remove hardcoded tax block, add `items` join + `GSTCalculator` call), `apps/production-service/src/api/reorder.routes.ts` (only if the option-1 `sellerStateCode` request-field fallback is needed).
- **Migrations:** none.
- **APIs added/changed:** `POST /inventory/reorder/create-pos` request shape unchanged (unless the fallback path adds an optional `sellerStateCode` field); response shape unchanged; only the created POs' stored tax figures change (become correct).
- **Events added/changed:** none — `REORDER_PO_CREATED` payload shape unchanged.
- **Tests added:** `reorder-gst.test.ts` (multi-rate, interstate, cess, and 18%-intrastate-regression cases).

---

## Context Preservation (for a fresh AI session with no prior history)

**Previous Work Summary:** `apps/production-service/src/domain/ReorderService.ts`, `createPOsFromReorder` (lines 105-137), hardcodes every auto-generated reorder PO's GST to `gstRate: '18', cgstRate: '9', sgstRate: '9', igstRate: '0'` and multiplies every line/PO total by a flat `1.18`, regardless of the item's real `gstRate`/`hsnCode`/`cessRate` (all already present on `items`, confirmed via `packages/db-client/src/schema/items.ts` lines 171-173) or whether the transaction is interstate (`purchaseOrders.sellerStateCode` already exists per `packages/db-client/src/schema/purchase.ts` line 41, but `ReorderService` never populates or checks it).

**Current Objective:** replace the hardcoded tax block with a real per-item `GSTCalculator.computeLine` call (new small file in `production-service`, copying the proven shape already independently duplicated in `apps/sales-service/src/domain/GSTCalculator.ts` and `apps/purchase-service/src/domain/GSTCalculator.ts`) — join `items` for real `gstRate`/`hsnCode`/`cessRate`, resolve the supplier's state for a correct intrastate-vs-interstate CGST/SGST-vs-IGST switch (prefer server-side supplier-master lookup over trusting request input, since reorder-automation is meant to run unattended/nightly), and use `GSTCalculator.sumTotals` for the PO-level grand total instead of a flat `* 1.18`.

**Architecture Snapshot:** this codebase's established, confirmed convention is **per-service duplication of GST-calculation domain logic** (sales-service and purchase-service each have their own near-identical `GSTCalculator.ts`) — there is a separate `gst-service` microservice in this monorepo, but it owns return-filing/e-invoice concerns, not per-line transactional tax calculation, and is never called synchronously by other services for this purpose. The correct fix is a third, production-service-local copy of the same calculator, not a network call to any other service.

**Completed Components:** `ReorderService.getReorderRequired` (the below-reorder-level report itself) is correct and unrelated — do not touch. `purchase-service`'s and `sales-service`'s own `GSTCalculator.ts` are the two proven reference implementations to copy from (do not import them cross-service — copy the logic into a new production-service-local file).

**Pending Components:** whether production-service should eventually call a `purchase-service` API to create reorder POs instead of writing directly into purchase-service's `purchaseOrders`/`purchaseOrderLines` tables (a pre-existing cross-service data-ownership pattern, confirmed but explicitly out of scope for this package — flagged for a future architecture review, not to be attempted here).

**Known Constraints:** the reorder-PO-creation flow is meant to run as a nightly/automated job with no human in the loop — any seller-state resolution must be resolvable from data already on file (supplier master), not assumed to come from a human-supplied request field, except as a last-resort fallback.

**Coding Standards:** match `purchase-service`'s `GSTCalculator.ts` interface/rounding convention exactly (`computeLine`/`sumTotals`, `Math.round(x * 100) / 100`), and match `ReorderService.ts`'s existing single-batched-query style (as already used in `getReorderRequired`) for the new `items` lookup — avoid N+1 per-item queries.

**Reusable Components:** `apps/purchase-service/src/domain/GSTCalculator.ts` (reference implementation to copy, not import), `items.gstRate`/`hsnCode`/`cessRate` (already exist, just never read by this file), `purchaseOrders.sellerStateCode` (already exists, just never populated by this file).

**APIs Already Available:** `apps/purchase-service`'s normal (non-reorder) `POST /purchase-orders` route already demonstrates the correct integration pattern end-to-end (`PurchaseOrderService.ts` lines 50-61) — read it as the template before writing the fix.

**Events Already Available:** `REORDER_PO_CREATED` outbox event — payload shape unchanged by this package.

**Shared Utilities:** none new — standard Drizzle query patterns already used throughout `ReorderService.ts`.

**Feature Flags:** none — this is a core calculation-accuracy fix, not an opt-in feature.

**Multi-Tenant Rules:** the new `items` lookup must stay tenant-scoped (`eq(items.tenantId, tenantId)`), matching every other query already in this file.

**Security Rules:** no new permission needed; existing `REORDER_CREATE_PO` gate on `POST /inventory/reorder/create-pos` is unchanged and sufficient.

**Database State:** no schema change — all needed columns (`items.gstRate/hsnCode/cessRate`, `purchaseOrders.sellerStateCode`) already exist.

**Testing Status:** no existing test file specifically covers `ReorderService.createPOsFromReorder`'s tax computation (verify at implementation time whether any test currently asserts the hardcoded 18% figures, which would need updating to assert correct per-item figures instead). New test file/cases per Testing section above.

**Next Session Plan:** single session — S complexity, one service, no schema change, no cross-service coordination beyond reading already-existing columns.

**Prompt for the Next Session:** "Implement `ERP-PLANNING/production-gap-prompts/009-Production/42-reorder-auto-po-real-gst-rate.md` (PG-046). Before writing code, re-read `apps/purchase-service/src/domain/GSTCalculator.ts` and `PurchaseOrderService.ts` lines 50-61 as the exact integration pattern to mirror — do not call `gst-service` or import `purchase-service`'s calculator directly; copy the logic into a new `apps/production-service/src/domain/GSTCalculator.ts`. Confirm whether the supplier master (purchase-service) stores a per-supplier state field before deciding between the server-side-lookup and request-field-fallback options for seller-state resolution described in this document's Architecture section."
