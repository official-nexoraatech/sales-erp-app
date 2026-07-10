# [PG-039] GSTR-3B — RCM / Import / ITC-Reversal Bucket Computation

> Template version 1.0. Every gap-prompt file in this tree must follow this exact section order. Do not add sections; do not omit sections that apply. If a section genuinely does not apply to this gap, write "Not applicable — <one-line reason>" instead of deleting it, so the structure stays diffable across files.

**Category:** GST
**Priority:** High
**Complexity:** L — touches a mandated tax-liability calculation (RCM output-tax self-assessment) where getting the wiring wrong has real compliance risk, requires new schema fields for import-of-goods, and two of the four buckets (import-of-services, ITC reversal) have no existing source data at all and must be scoped as explicitly deferred rather than half-built
**Depends on:** none
**Blocks:** PG-040 (GSTR-9's Table 9 fix reuses the per-period discharge data this package produces)
**Primary service(s)/package(s):** apps/gst-service (src/domain/Gstr3bService.ts, src/domain/GstLedgerService.ts, src/consumers/GRNGstConsumer.ts), apps/purchase-service (src/domain/GRNService.ts, src/domain/GSTCalculator.ts), packages/db-client/src/schema/gst.ts

---

## Overview

- **Business objective:** GSTR-3B is the monthly self-assessed summary return that determines actual cash GST liability. Four of its mandated line items — Table 3.1(d) inward supplies liable to reverse charge, Table 4A(1) ITC on import of goods, Table 4A(2) ITC on import of services, and Table 4B ITC reversed (Rules 42/43 and blocked credits) — are always reported as zero regardless of real transactions. For a business with any unregistered-supplier purchases (RCM already exists and is flagged elsewhere in this same system), any imports, or any exempt-supply mix, filing GSTR-3B with these buckets hardcoded to zero is not a UI polish gap — it produces a return that understates liability (RCM) or overstates net ITC (reversal), which is a real compliance/penalty risk if a tenant ever files this number instead of hand-correcting it.
- **Current implementation:** `apps/gst-service/src/domain/Gstr3bService.ts`, `compute()` (lines 70–140). Table 3.1(d) is hardcoded:
  ```ts
  inwardRcm: { igst: 0, cgst: 0, sgst: 0, cess: 0, taxableValue: 0 },
  ```
  Table 4A is hardcoded for imports and RCM:
  ```ts
  importOfGoods: { igst: 0, cgst: 0, sgst: 0, cess: 0 },
  importOfServices: { igst: 0 },
  ...
  rcm: { igst: 0, cgst: 0, sgst: 0, cess: 0 },
  ```
  Table 4B (ITC reversed) is hardcoded:
  ```ts
  itcReversed: { rule42_43: { igst: 0, cgst: 0, sgst: 0, cess: 0 } },
  ```
  Only `table31.outwardTaxable` (from `summary.sales`/`summary.creditNotes`) and `table4.itcAvailable.inwardSupplies` (from `summary.purchases`/`summary.purchaseReturns`) are real, sourced from `GstLedgerService.getSummary()`. The strict IGST→CGST→SGST `computeItcSetoff()` algorithm (lines 148–224) is genuinely correct and out of scope for this package — confirmed by reading it: it implements the mandated 7-step set-off order exactly (IGST liability drains IGST ITC → CGST ITC → SGST ITC; CGST/SGST liabilities never cross-utilize each other's ITC). `FEATURE_INVENTORY.md` §5.5 confirms independently: "GSTR-3B (full ITC set-off algorithm in mandated IGST→CGST→SGST order; **RCM/import-of-goods/import-of-services/ITC-reversal buckets are always zero, not computed**)".
- **Current architecture:** `Gstr3bService.compute()` calls `GstLedgerService.getSummary(db, tenantId, period)` (apps/gst-service/src/domain/GstLedgerService.ts, lines 98–161), which aggregates `gst_ledger` rows grouped by `entryType`/`itcEligible` but currently only ever splits by `entryType IN ('SALES_INVOICE','PURCHASE','CREDIT_NOTE','PURCHASE_RETURN')` — it does **not** currently split by `rcmApplicable`, even though that boolean column already exists on every `gst_ledger` row (`packages/db-client/src/schema/gst.ts`, line 96: `rcmApplicable: boolean('rcm_applicable').notNull().default(false)`) and is already populated correctly at write time.
- **Current limitations — verified per-bucket, this is the core of the gap:**
  1. **RCM (Table 3.1(d) + Table 4A rcm):** the data already exists and is already flagged correctly — it is simply not read. `GstLedgerService` already has a working `getRcmRegister()` method (lines 79–95) that filters `gst_ledger` by `rcmApplicable = true`. Upstream, `apps/purchase-service/src/domain/GRNService.ts` already sets `rcmApplicable: true` on GRN creation when `supplier.isRegistered === false` (confirmed by `apps/purchase-service/src/__tests__/rcm.test.ts`, test 4: "unregistered supplier → rcmApplicable = true, grandTotal excludes GST"), and `apps/gst-service/src/consumers/GRNGstConsumer.ts` (`handleGRNApproved`, line 87) already copies `p.rcmApplicable` onto the inserted `gst_ledger` row. **This bucket is a pure wiring gap** — the source-of-truth flag exists end-to-end, `Gstr3bService.compute()` just never queries it.
  2. **Import of goods (Table 4A(1)):** no distinguishing data exists anywhere in the schema. `packages/db-client/src/schema/purchase.ts` has `placeOfSupply`/`sellerStateCode` (both Indian state codes) but no `country`, `isImport`, or customs-related field on suppliers, purchase orders, or GRNs (confirmed by grep — zero matches for `country|isImport|customsB` across `packages/db-client/src/schema`). There is no Bill-of-Entry/customs-duty capture anywhere in purchase-service. **This bucket cannot be computed from existing data — it requires new input fields first.**
  3. **Import of services (Table 4A(2)):** same as above, and additionally India's import-of-services GST treatment is itself RCM-like (recipient self-assesses IGST) but on a services-purchase concept this ERP doesn't model at all (purchase-service models only goods receipt via GRN; there is no "service bill"/RCM-services entry point). **Cannot be computed from existing data — genuinely out of scope until a service-purchase or RCM-on-services capture flow is designed**, which is a larger product decision than this package should make unilaterally.
  4. **ITC reversal (Table 4B, Rules 42/43 + blocked credits):** `gst_ledger` already has an `itcEligible: boolean` column and an `itcReversalReason: varchar` column (schema lines 90–91), and `GRNGstConsumer.ts` already threads `p.itcEligible`/`p.itcReversalReason` through from the purchase event payload when the caller sets them — but grep of `apps/purchase-service/src` shows nothing ever sets `itcReversalReason` or `itcEligible: false` today (the GRN event payload interface declares the fields optional and `GRNGstConsumer` defaults `itcEligible: p.itcEligible !== false`, i.e. always eligible unless a caller explicitly says otherwise, and no caller currently does). Separately, `GSTR9Engine.ts` (Table 7, lines 129–136) already computes an approximation — `sum(purchaseReturns) + sum(ineligiblePurchases where !itcEligible)` — using exactly this same `itcEligible` flag. Rule 42/43 (reversal proportional to exempt-supply turnover ratio) is a distinct, formula-driven reversal this system has no exempt/taxable turnover-ratio computation for at all. **Partially computable today** (blocked-credit reversals, if any purchase is ever marked `itcEligible: false` — currently none are) but **Rule 42/43's proportional/exempt-ratio reversal is not computable without first building an exempt-turnover-ratio calculation**, which does not exist.

## Existing Code Analysis

- **What already exists and should be reused:** `GstLedgerService.getRcmRegister()` (already filters by `rcmApplicable = true`) — reuse or extend `getSummary()` to also split by `rcmApplicable` so `Gstr3bService` gets both buckets from one query pass, consistent with how it already gets ordinary purchases. The `itcEligible`/`itcReversalReason` columns on `gst_ledger` (already exist, already partially wired from purchase events, currently just never populated with a `false`/reason by any real caller). `GSTR9Engine.ts`'s Table 7 computation is the existing precedent for "ITC reversal = purchase returns + explicitly-ineligible purchases" — GSTR-3B's Table 4B should use the identical definition for the blocked-credit portion, for consistency between the two returns (a business filing both should see the same reversal logic, not two different approximations).
- **What should never be modified:** `Gstr3bService.computeItcSetoff()` (lines 148–224) — the IGST→CGST→SGST algorithm is correct and independently verified against the mandated GST rule order; this package only changes what feeds into `table31`/`table4` *before* set-off runs, not the set-off algorithm itself. `GRNService.ts`'s RCM-detection logic (`supplier.isRegistered === false → rcmApplicable = true`, `grandTotal` excludes GST for RCM purchases) must not be touched — it is correct and already tested (`rcm.test.ts`). Do not touch `apps/purchase-service/src/domain/GSTCalculator.ts`'s CGST/SGST/IGST intra/inter-state math.
- **Prior related work:** `ERP-PLANNING/audit-phase-prompts/ES-10-GST-COMPLIANCE-CESS-RCM-GSTR9.md` built RCM detection, GSTR-3B, and GSTR-9 in the same phase — the RCM-flagging-but-not-consuming-it gap is a known leftover from that phase, not a regression. Per project memory (`architecture_no_cross_service_valuation.md`), this codebase's convention is that GST-domain logic is duplicated per-service rather than called cross-service (e.g. `GSTCalculator` exists independently in both purchase-service and gst-service) — this package's RCM wiring stays entirely inside gst-service's own `gst_ledger`-sourced data, consistent with that existing pattern, and does not introduce a new cross-service call to purchase-service.

## Architecture

- **RCM bucket (fully in scope, wire existing data):** extend `GstLedgerService.getSummary()` to additionally group by `rcmApplicable` for `entryType = 'PURCHASE'` rows (alongside the existing `itcEligible` grouping), returning a new `purchases.rcm: { taxable, cgst, sgst, igst, cess }` sub-object (rows where `rcmApplicable = true`) separate from the existing non-RCM `purchases` totals (which should be redefined to exclude RCM rows, since RCM output tax is a distinct liability line, not an ordinary ITC line, per GST rules — a business self-assesses RCM as *output* tax owed in 3.1(d), then separately claims it back as *input* tax credit in 4A once paid). `Gstr3bService.compute()` then sets `table31.inwardRcm` from this new `purchases.rcm` bucket (this is the *liability* side — RCM tax the business owes as if it were the supplier) and `table4.itcAvailable.rcm` from the same rows (this is the *ITC* side — the business can claim back what it self-assessed, in the same period per standard practice, since this system pays RCM via challan immediately rather than modeling a payment-then-claim lag). This must feed into `computeItcSetoff()`'s liability input alongside `outwardTaxable` — i.e. total IGST/CGST/SGST liability for set-off purposes should be `outwardTaxable + inwardRcm`, not `outwardTaxable` alone (currently `computeItcSetoff()` is called with only `table31.outwardTaxable` — this package must add `inwardRcm` into that liability figure, and add `itcAvailable.rcm` into the ITC figure, otherwise the set-off calculation still silently ignores RCM even after Tables 3.1(d)/4A start reporting it correctly — **this cross-check is essential**, a display-only fix that doesn't feed set-off would be worse than the current all-zero state because it would look complete while the cash-required number stays wrong).
- **Import of goods/services (out of scope for real computation, ship as an explicit manual-entry escape hatch, not silent zero):** since no schema field distinguishes import purchases, do not attempt to auto-detect them heuristically (e.g. guessing from `placeOfSupply === '96'`/GSTIN absence is unreliable and would produce wrong numbers with false confidence, which is worse than an honest zero). Instead: keep these two sub-buckets at zero in the *computed* result but add an optional manual-override input to the export/mark-filed flow (see Backend) so a user who knows their actual import IGST for the period can enter it before filing, and it flows into `computeItcSetoff()`'s ITC figure. This is explicitly scoped as "manual entry, not auto-computation" — document this distinction clearly in the API contract and UI copy so accountants are not misled into thinking it's derived from ledger data.
- **ITC reversal (partially in scope — blocked-credit portion only):** `table4.itcReversed.rule42_43` should be renamed in intent (keep the field name for GSTN-form compatibility, but compute only the blocked-credit component): sum purchases in the period where `itcEligible = false`, using the identical definition already used in `GSTR9Engine.ts` Table 7, for consistency across returns. The proportional Rule 42/43 exempt-ratio reversal (a formula requiring total exempt-supply value ÷ total turnover × common-credit ITC) is explicitly NOT computed by this package — document this as a known limitation in the code comment (replacing the current all-encompassing "always zero" comment with a precise one: "blocked-credit reversal is computed from itcEligible=false purchases; Rule 42/43 proportional exempt-ratio reversal is not computed — requires a turnover-ratio engine, out of scope, see PG-039 file") so a future session doesn't think this bucket is now fully solved. Also flag to the product/business owner that **no purchase in this codebase's data currently has `itcEligible = false` set by any caller** — so until `apps/purchase-service` (or a manual gst-service correction UI) actually sets it, this bucket will correctly compute to zero for the trivial reason that there's genuinely nothing to reverse yet, not because the code is broken.

## Database Changes

- **No new tables.** One additive migration to support the manual import-IGST override described above: add a `manualAdjustments: jsonb('manual_adjustments')` column to `gst_return_filings` (packages/db-client/src/schema/gst.ts) to store `{ importOfGoodsIgst?: number, importOfServicesIgst?: number, enteredBy: number, enteredAt: string }` per period/return-type row, keyed the same way `filingData` already is. Reuse the existing `gst_return_filings` row for the `GSTR3B` return-type/period rather than creating a new table — it already exists precisely to hold per-filing extra data (`filingData: jsonb`), and this is conceptually the same kind of thing (a small, sparse, per-filing override), so a second table would duplicate an existing concept.
- Migration: next sequential file, `0035_pg039_gstr3b_manual_adjustments.sql` (confirm the latest number against `packages/db-client/migrations/` at implementation time — `0034_organization_theme_config.sql` is the latest as of this writing). `ALTER TABLE gst_return_filings ADD COLUMN manual_adjustments JSONB;` — nullable, no default, no backfill needed (existing rows simply have no manual adjustment, which is correct — they had none).
- **Rollback:** `ALTER TABLE gst_return_filings DROP COLUMN manual_adjustments;` — safe, since the column is purely additive and nothing else depends on it existing.
- **Not required:** no schema change for the RCM bucket wiring itself — `rcmApplicable`, `itcEligible`, `itcReversalReason` all already exist on `gst_ledger` and are already populated at write time by `GRNGstConsumer.ts`.

## Backend

- **Modify `apps/gst-service/src/domain/GstLedgerService.ts`, `getSummary()`:** add `rcmApplicable` to the `groupBy()` alongside the existing `entryType`/`itcEligible` grouping, and add a new `rcm: { taxable, cgst, sgst, igst, cess }` key to the returned object, computed as `sum(rows where entryType='PURCHASE' AND rcmApplicable=true)`. Redefine the existing `purchases.*` sums to exclude RCM rows (`entryType='PURCHASE' AND rcmApplicable=false`) so RCM and ordinary ITC don't double-count.
- **Modify `apps/gst-service/src/domain/Gstr3bService.ts`, `compute()`:**
  - `table31.inwardRcm` ← `summary.rcm` (was hardcoded zero).
  - `table4.itcAvailable.rcm` ← `summary.rcm` (was hardcoded zero); `table4.itcAvailable.total` must include it in the sum.
  - `table4.itcReversed.rule42_43` ← sum of `entryType='PURCHASE' AND itcEligible=false` rows for the period (was hardcoded zero) — add a small helper query or extend `getSummary()` with an `ineligiblePurchases` bucket, mirroring `GSTR9Engine.ts` Table 7's existing definition exactly, for cross-return consistency.
  - `table4.itcAvailable.importOfGoods`/`importOfServices` stay zero from ledger data, but `compute()` gains an optional parameter (or a second method, `applyManualAdjustments()`) that merges in `gst_return_filings.manual_adjustments.importOfGoodsIgst`/`importOfServicesIgst` for that tenant/period if present, before the figure is passed into `computeItcSetoff()`.
  - `computeItcSetoff()`'s call site: change the liability argument from `{ igst: table31.outwardTaxable.igst, ... }` to `{ igst: table31.outwardTaxable.igst + table31.inwardRcm.igst, ... }` (same for cgst/sgst), and the ITC argument from `table4.netItcAvailable` to a figure that includes `rcm` + any manual import adjustment + subtracts `itcReversed.rule42_43` — i.e. `netItcAvailable` itself must be recomputed to net out reversal and include RCM/import before set-off runs (currently `netItcAvailable` mirrors `itcAvailable.total` without subtracting `itcReversed` at all — this is itself a latent bug independent of the zero-bucket issue, worth fixing in the same pass since it's the same code block).
- **New/modified endpoint:** extend `POST /gst/gstr3b/export` (apps/gst-service/src/api/gstr3b.routes.ts) to accept an optional body `{ manualAdjustments?: { importOfGoodsIgst?: number; importOfServicesIgst?: number } }`, persist it to `gst_return_filings.manual_adjustments` for that tenant/period (upsert, matching the existing `gstReturnFilings` unique constraint on `tenant_id, return_type, period`), then re-run `Gstr3bService.compute()` with it applied before returning. Keep `GET /gst/gstr3b` (view-only) reading whatever manual adjustment was last saved for that period, if any, so the on-screen number before filing matches what export produces.
- **Events/Kafka:** not applicable — no new events; this stays within gst-service's own read/compute path.
- **Validation:** `manualAdjustments` values, if provided, must be `z.number().nonnegative()` — reject negative adjustments (a negative "import IGST" makes no domain sense).
- **Authorization:** unchanged permission model — `GSTR3B_VIEW` for the GET, `GSTR3B_FILE` for the POST/export (manual-adjustment entry should require `GSTR3B_FILE` since it affects the filed figure, not `GSTR3B_VIEW`).
- **Audit logging:** extend the existing `ctx.audit.log({ action: 'GSTR3B_EXPORTED', ... })` call's `after` payload to include whether manual adjustments were applied (amounts + who entered them), so an auditor can later see a filed return included a hand-entered import figure rather than a pure system computation.

## Frontend

- Not applicable as a required deliverable for this package (backend computation gap is the priority-High item), but if a GSTR-3B review/export page already exists under `apps/web-frontend/src/pages/gst/` (verify at implementation time), it should surface the new `table31.inwardRcm`/`table4.itcAvailable.rcm` figures (previously always zero, now real) and add two optional numeric inputs for the manual import-of-goods/import-of-services IGST override, clearly labeled "manual entry — not computed from ledger data" per the Architecture section's explicit-honesty requirement.

## API Contract

- `GET /gst/gstr3b?period=YYYY-MM` — response shape unchanged, but `table31.inwardRcm` and `table4.itcAvailable.rcm`/`table4.itcReversed.rule42_43` now return real (possibly non-zero) figures instead of always-zero; `table4.itcAvailable.importOfGoods`/`importOfServices` remain zero unless a manual adjustment was previously saved for that period, in which case they reflect it.
- `POST /gst/gstr3b/export?period=YYYY-MM` — **request body gains an optional field**: `{ manualAdjustments?: { importOfGoodsIgst?: number; importOfServicesIgst?: number } }`. Response shape unchanged (`{ data: { ...result, exportedAt } }`), but `result` now reflects RCM/reversal/manual-import figures per above.
- Error codes: `400 VALIDATION_ERROR` for negative/malformed `manualAdjustments` values; existing `401`/`403` unchanged.

## Multi-Tenant Considerations

- No change to the isolation model — `getSummary()`/`compute()` already scope every query by `tenantId`; the new `manual_adjustments` column lives on the already-tenant-scoped `gst_return_filings` row (unique on `tenant_id, return_type, period`), so cross-tenant leakage is not possible by construction, same as every other column on that table.

## Integration

- **apps/gst-service** (all changes) and **apps/purchase-service** (read-only reference — confirming `GRNService.ts`'s existing RCM-flagging behavior, no code change needed there since the flag is already correctly set and already flows through `GRNGstConsumer.ts`). No other service is touched; no new Kafka event type; no new cross-service call.

## Coding Standards

- Reuses the existing `GstLedgerService`/`Gstr3bService` split (query aggregation vs. tax-rule computation) rather than introducing a new layer. Reuses the `gst_return_filings.filingData`-style jsonb-column convention for the new `manual_adjustments` column rather than a new table, per the "reuse over rebuild" cross-cutting rule. Reuses Zod + `requirePermission()` unchanged. The one novel piece — a manual-override input path for a normally-computed field — is justified explicitly above (no existing pattern in this codebase covers "computed field with an optional human override before filing," so this is a deliberate, narrow, well-labeled exception, not a new general mechanism).

## Performance

- No material change — `getSummary()`'s additional `rcmApplicable` grouping is the same query shape with one more `GROUP BY` column, not an additional query; cost stays O(rows in period), same as today.

## Security

- `manualAdjustments` write path requires `GSTR3B_FILE` (a filing-level permission, not view-level) since it can change the reported liability — consistent with this codebase's existing pattern of gating anything that affects a filed government return behind the `_FILE` permission rather than `_VIEW`.
- Audit trail: every manual adjustment is captured in the `GSTR3B_EXPORTED` audit log entry's `after` payload (who entered it, what value), so it's traceable if a filed return's liability is later questioned.

## Testing

- Extend `apps/gst-service/src/__tests__/gst-engine.test.ts` (or add `apps/gst-service/src/__tests__/gstr3b-rcm-reversal.test.ts`): 
  - RCM: a `gst_ledger` PURCHASE row with `rcmApplicable=true` produces a non-zero `table31.inwardRcm` and `table4.itcAvailable.rcm`, and the same amount flows into `computeItcSetoff()`'s liability input (assert `cashRequired` reflects the added RCM liability, not just that the table displays it).
  - ITC reversal: a PURCHASE row with `itcEligible=false` produces a non-zero `table4.itcReversed.rule42_43`, matching the same total `GSTR9Engine.ts` Table 7 would compute for the same data (cross-check the two engines agree, since they now share the same definition).
  - Manual import adjustment: `POST /gst/gstr3b/export` with `manualAdjustments.importOfGoodsIgst = 5000` persists to `gst_return_filings.manual_adjustments` and a subsequent `GET /gst/gstr3b` for the same period reflects it in `table4.itcAvailable.importOfGoods`.
  - Regression: existing `computeItcSetoff()` unit-level behavior (IGST→CGST→SGST order) stays correct when RCM is added to the liability figure — add a case where RCM liability alone (no ordinary outward supply) still drains ITC in the correct order.
- Reference `apps/purchase-service/src/__tests__/rcm.test.ts` as the existing upstream RCM-flagging test — do not duplicate it, just confirm gst-service's consumer test coverage already exercises `handleGRNApproved` with `rcmApplicable: true` (check `apps/gst-service/src/__tests__/` for existing GRN-consumer coverage before writing a new one).

## Acceptance Criteria

- [ ] A tenant with at least one RCM-flagged GRN (unregistered supplier) sees non-zero `table31.inwardRcm` and `table4.itcAvailable.rcm` in `GET /gst/gstr3b`, and `itcSetoff.cashRequired` reflects the added liability (verified by a test with known input amounts).
- [ ] A tenant with at least one `itcEligible=false` purchase sees non-zero `table4.itcReversed.rule42_43`, matching `GSTR9Engine`'s Table 7 definition for the same data.
- [ ] Import-of-goods/services remain zero from ledger data alone, but a manual adjustment via `POST /gst/gstr3b/export` persists and reflects correctly on the next `GET`.
- [ ] `computeItcSetoff()`'s IGST→CGST→SGST order is unchanged and still passes all pre-existing test cases with RCM/reversal now included in its inputs.
- [ ] `pnpm --filter @erp/gst-service type-check` and `pnpm --filter @erp/gst-service test` pass.
- [ ] The code comment describing Table 4B's limitation is precise (blocked-credit only, not Rule 42/43 proportional) rather than a blanket "always zero" note.

## Deliverables

- **Files to create:** `packages/db-client/migrations/0035_pg039_gstr3b_manual_adjustments.sql` (number to be confirmed against latest at implementation time), `apps/gst-service/src/__tests__/gstr3b-rcm-reversal.test.ts`.
- **Files to modify:** `apps/gst-service/src/domain/GstLedgerService.ts` (`getSummary()` — add RCM/ineligible-purchase grouping), `apps/gst-service/src/domain/Gstr3bService.ts` (`compute()` — wire RCM/reversal/manual-import into Tables 3.1/4, fix `netItcAvailable` to net out reversal, and feed RCM into `computeItcSetoff()`'s inputs), `apps/gst-service/src/api/gstr3b.routes.ts` (accept/persist `manualAdjustments`), `packages/db-client/src/schema/gst.ts` (add `manualAdjustments` jsonb column to `gstReturnFilings`).
- **Migrations:** one new migration (see above).
- **APIs added/changed:** `POST /gst/gstr3b/export` request body gains optional `manualAdjustments`; both GSTR-3B endpoints' response figures for RCM/reversal buckets change from always-zero to computed.
- **Events added/changed:** none.
- **Tests added:** `gstr3b-rcm-reversal.test.ts`, extensions to `gst-engine.test.ts`.

---

## Context Preservation (for a fresh AI session with no prior history)

**Previous Work Summary:** `Gstr3bService.compute()` (apps/gst-service/src/domain/Gstr3bService.ts) has a genuinely correct IGST→CGST→SGST ITC set-off algorithm (`computeItcSetoff()`) and correctly computes ordinary outward-supply and ordinary-purchase-ITC figures from the `gst_ledger` table via `GstLedgerService.getSummary()`. But four sub-buckets are hardcoded to zero: RCM (Table 3.1(d) + 4A), import of goods (4A), import of services (4A), and ITC reversal (4B). Of these, RCM is a pure wiring gap — `gst_ledger.rcmApplicable` already exists, is already correctly set end-to-end from `apps/purchase-service/src/domain/GRNService.ts` (unregistered-supplier detection) through `apps/gst-service/src/consumers/GRNGstConsumer.ts`, and just needs to be read by `Gstr3bService`/`GstLedgerService`. Import of goods/services has no source data anywhere in the schema — no `country`/`isImport` field exists on suppliers/POs/GRNs — and cannot be computed without new input capture, which this package explicitly does NOT build (it adds a manual-override entry point instead). ITC reversal's blocked-credit component is computable via the existing `itcEligible`/`itcReversalReason` columns (mirroring `GSTR9Engine.ts`'s Table 7 logic) but currently no caller ever sets `itcEligible=false`, so it will correctly compute to zero until that changes elsewhere; the Rule 42/43 proportional exempt-ratio reversal has no supporting turnover-ratio calculation anywhere and is explicitly out of scope.

**Current Objective:** wire the RCM bucket end-to-end (including into `computeItcSetoff()`'s liability/ITC inputs, not just display), wire the blocked-credit portion of ITC reversal, and add an explicit, clearly-labeled manual-entry escape hatch for import-of-goods/services (persisted on `gst_return_filings.manual_adjustments`, a new additive jsonb column) rather than attempting unreliable auto-detection of imports from existing fields.

**Architecture Snapshot:** `gst_ledger` (packages/db-client/src/schema/gst.ts) is the single append-only source table for both GSTR-1 and GSTR-3B, already carrying `rcmApplicable`, `itcEligible`, `itcReversalReason` columns per row; `gst_return_filings` is the per-period/return-type tracker row (unique on tenant/type/period) already used for filing status and already has a `filingData` jsonb column, established pattern to extend for the new `manual_adjustments` column. `GstLedgerService.getSummary()` is the one aggregation point both `Gstr3bService` and (indirectly, via separate queries) `GSTR9Engine` build on.

**Completed Components:** RCM self-assessment detection at GRN-creation time (`GRNService.ts`, tested in `rcm.test.ts`); the IGST→CGST→SGST set-off algorithm (`computeItcSetoff()`); ordinary-purchase ITC and ordinary-outward-supply liability computation.

**Pending Components:** import-of-goods/services real computation (needs new schema fields on purchase-service's side — a separate, larger future package if ever prioritized, not this one); Rule 42/43 proportional exempt-ratio ITC reversal (needs an exempt-vs-taxable turnover-ratio engine that doesn't exist — also a separate future package).

**Known Constraints:** dev-phase, free to add the additive migration without a backward-compat dance (per project memory). Single shared Postgres, no RLS — tenant isolation is by explicit `tenant_id` filter, unchanged by this package.

**Coding Standards:** see Coding Standards section — reuse `GstLedgerService`/`Gstr3bService`'s existing split and the `gst_return_filings` jsonb-column convention; do not introduce a new table for manual adjustments.

**Reusable Components:** `GstLedgerService.getRcmRegister()` (existing RCM query, can be referenced/merged into `getSummary()`'s new grouping), `GSTR9Engine.ts` Table 7's ineligible-purchase definition (reuse the identical logic for GSTR-3B's blocked-credit reversal bucket, for cross-return consistency).

**APIs Already Available:** `GstLedgerService.getSummary()`, `Gstr3bService.computeItcSetoff()` — both to be extended, not replaced.

**Events Already Available:** `GRN_APPROVED` event already carries `rcmApplicable`/`itcEligible`/`itcReversalReason` in its payload (see `GRNGstConsumer.ts`'s `GRNApprovedPayload` interface) — no new event needed.

**Shared Utilities:** `@erp/logger`, `@erp/types` (`ValidationError`, `BusinessError`), Zod — all already used identically in `gstr3b.routes.ts`.

**Feature Flags:** not applicable — this is a correctness fix to a mandatory computation, not an opt-in feature.

**Multi-Tenant Rules:** unchanged — every query already filters by `tenantId`; the new `manual_adjustments` column lives on the already tenant-scoped `gst_return_filings` row.

**Security Rules:** manual-adjustment writes require `PERMISSIONS.GSTR3B_FILE` (filing-level), not `GSTR3B_VIEW`.

**Database State:** depends on migrations through `0034_organization_theme_config.sql`; adds one new additive migration (`manual_adjustments` jsonb column on `gst_return_filings`).

**Testing Status:** `apps/gst-service/src/__tests__/gst-engine.test.ts` covers `GSTCalculator.compute()` and `GSTR9Engine.generateGSTR9()` today but has no GSTR-3B-specific test coverage at all (confirmed by reading the file's `describe` blocks) — this package's tests are net-new coverage for `Gstr3bService`, not just extensions.

**Next Session Plan:** given L complexity, a single focused session can complete this if scoped tightly: (1) `GstLedgerService.getSummary()` RCM/ineligible grouping, (2) `Gstr3bService.compute()` wiring + the `netItcAvailable`-must-subtract-reversal fix + feeding RCM into `computeItcSetoff()`'s call, (3) the manual-adjustment migration + route + persistence, (4) tests. If time-constrained, the manual-adjustment escape hatch (item 3) can be deferred to a follow-up session since RCM/reversal wiring (items 1-2) is the higher-value, self-contained core fix — but do not ship items 1-2 without also fixing the `computeItcSetoff()` call-site inputs, since a display-only fix that doesn't affect cash-required would be misleading.

**Prompt for the Next Session:** "Implement `ERP-PLANNING/production-gap-prompts/007-GST/32-gstr3b-rcm-import-itc-reversal-buckets.md` (PG-039). Before writing code, re-read `apps/gst-service/src/domain/Gstr3bService.ts` and `apps/gst-service/src/domain/GstLedgerService.ts` in full, and re-verify `apps/purchase-service/src/domain/GRNService.ts`'s RCM-flagging is still exactly as described (unregistered supplier → `rcmApplicable=true`) since concurrent work may have touched it. Wire RCM into both the display tables AND `computeItcSetoff()`'s liability/ITC inputs — do not ship a display-only fix. Add the blocked-credit ITC-reversal bucket using the same definition as `GSTR9Engine.ts` Table 7. Do NOT attempt to auto-detect import-of-goods/services from existing fields — add the explicit manual-adjustment escape hatch instead, clearly labeled as manual entry."
