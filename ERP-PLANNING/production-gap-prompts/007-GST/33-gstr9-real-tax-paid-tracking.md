# [PG-040] GSTR-9 — Real Table 9 Tax-Paid Tracking

> Template version 1.0. Every gap-prompt file in this tree must follow this exact section order. Do not add sections; do not omit sections that apply. If a section genuinely does not apply to this gap, write "Not applicable — <one-line reason>" instead of deleting it, so the structure stays diffable across files.

**Category:** GST
**Priority:** Medium
**Complexity:** M — no new table needed (an existing filing-tracker row already has a home for this data), but requires persisting real per-period discharge figures at GSTR-3B filing time and changing GSTR-9's annual aggregation to read them instead of re-deriving from Table 4
**Depends on:** PG-039 (GSTR-3B — RCM/import/ITC-reversal bucket computation; shares the same `computeItcSetoff()` output this package needs to persist, and PG-039's `manual_adjustments` column addition to `gst_return_filings` is the same table this package writes real discharge data to)
**Blocks:** none
**Primary service(s)/package(s):** apps/gst-service (src/domain/GSTR9Engine.ts, src/domain/GstReturnTrackerService.ts, src/domain/Gstr3bService.ts, src/api/gst-returns.routes.ts), packages/db-client/src/schema/gst.ts

---

## Overview

- **Business objective:** GSTR-9 is the annual return every registered dealer files reconciling the year's 12 monthly GSTR-3B filings. Table 9 ("Tax Paid") is supposed to show what was **actually discharged** — the real cash-ledger debit plus real ITC-ledger utilization recorded at the time each month's GSTR-3B was filed. Today it instead reports the exact same number as Table 4 ("Tax Liability"), which is a different concept — liability is what was *owed*, tax paid is what was *actually settled* (via cash + ITC set-off). For any tenant whose actual monthly set-off differed even slightly from the crude liability figure (which, given PG-039 fixes the underlying RCM/reversal buckets, will now regularly differ month-to-month), Table 9 silently reports a number that isn't true, in a document an accountant may file as-is.
- **Current implementation:** `apps/gst-service/src/domain/GSTR9Engine.ts`, `generateGSTR9()`, lines 138–149:
  ```ts
  // ── Table 9 — Tax paid ──────────────────────────────────────────────────────
  // This codebase's GST ledger doesn't separately track cash-vs-ITC discharge per
  // period (that split lives transiently in Gstr3bService.computeItcSetoff, computed
  // per-month, not persisted) — Table 9 reports the total output tax liability for the
  // FY, matching Table 4. See ES-10 completion report for this documented limitation.
  const table9: GSTR9Table9 = {
    igst: table4.igst,
    cgst: table4.cgst,
    sgst: table4.sgst,
    cess: table4.cess,
    total: table4.total,
  };
  ```
  The code's own comment is exact and accurate about the root cause: `Gstr3bService.computeItcSetoff()` (apps/gst-service/src/domain/Gstr3bService.ts, lines 148–224) already computes the real per-period `cashRequired` and ITC-utilization split — that is the true "tax paid" figure — but it is computed fresh every time `GET`/`POST /gst/gstr3b` is called and **never persisted anywhere**. `FEATURE_INVENTORY.md` §5.5 and §8 both confirm: "GSTR-9 annual return (Table 9 tax-paid is a documented simplification that mirrors Table 4 rather than tracking real cash/ITC discharge)."
- **Current architecture:** `gst_return_filings` (packages/db-client/src/schema/gst.ts, lines 113–139) is the existing per-tenant/return-type/period filing tracker (unique on `tenant_id, return_type, period`), already used by `GstReturnTrackerService.markFiled()` (apps/gst-service/src/domain/GstReturnTrackerService.ts, lines 86–128) to flip a filing's `status` to `FILED`/`LATE_FILED` and stamp `filedDate`/`filedBy`/`referenceNumber`. It already has a `filingData: jsonb('filing_data')` column intended exactly for "whatever extra data belongs to this filing" — **but `markFiled()` never writes anything into `filingData`, ever** (confirmed by reading the full method body — the `.set({...})` call only touches `status`, `filedDate`, `filedBy`, `referenceNumber`, `updatedAt`). So the "existing filing/payment table tied to the filing calendar" does exist, but it is currently write-only for status metadata and has never been used to store the actual computed discharge figures — it is not populated at all today, not partially populated.
- **Current limitations:** `GSTR9Engine.generateGSTR9()` (lines 65–152) computes Table 9 purely by copying Table 4's already-computed FY totals — it has no code path that reads `gst_return_filings` at all, so even if `filingData` were populated by some other mechanism today, GSTR-9 wouldn't look at it.

## Existing Code Analysis

- **What already exists and should be reused:** `Gstr3bService.computeItcSetoff()` already returns exactly the shape needed — `cashRequired: { igst, cgst, sgst }` (real cash discharge after ITC set-off) and the `setoff` breakdown (`igstFromIgst`, `igstFromCgst`, etc. — real ITC utilization by source). `gst_return_filings.filingData: jsonb` already exists as the designated column for this. `GstReturnTrackerService.markFiled()` is the existing single choke-point where a GSTR-3B filing transitions to `FILED` — this is the natural place to persist the real discharge figures, since "marking filed" is the moment a tenant is asserting "this is what I actually paid," not merely "this is what the system computed."
- **What should never be modified:** `GSTR9Engine.ts`'s Table 4/5/6/7 computations (taxable outward supplies, nil-rated, ITC availed, ITC reversed) are correct and out of scope — this package only changes Table 9's source. `Gstr3bService.computeItcSetoff()`'s algorithm itself must not change (already verified correct, see PG-039). `GstReturnTrackerService.getCalendar()`/`getStatus()` (the calendar/status read paths) are unrelated and must not be touched.
- **Prior related work:** PG-039 (`007-GST/32-gstr3b-rcm-import-itc-reversal-buckets.md`) fixes the *inputs* to `computeItcSetoff()` (RCM, ITC reversal) and adds a `manual_adjustments` jsonb column to this same `gst_return_filings` table for import overrides — implement PG-039 first, or at minimum coordinate schema changes, since both packages touch `gst_return_filings` with additive jsonb-shaped columns and the migration numbers must not collide (re-check the latest migration number at implementation time for both). The ES-10 phase (`ERP-PLANNING/audit-phase-prompts/ES-10-GST-COMPLIANCE-CESS-RCM-GSTR9.md`) is where this simplification was originally introduced and self-documented — this package is the deferred follow-up that phase anticipated ("See ES-10 completion report for this documented limitation," per the code comment itself).

## Architecture

- **Persist real discharge at filing time, not at compute time.** When a tenant calls `POST /gst/returns/GSTR3B/mark-filed` for a given period (the existing endpoint in `apps/gst-service/src/api/gst-returns.routes.ts`), that is the authoritative moment the real per-period tax-paid figure should be locked in — not recomputed later, since the ledger could theoretically change after filing (e.g. a late-arriving credit note in a future period should not silently retroactively alter a prior period's "what was actually paid" figure once it's been filed). `GstReturnTrackerService.markFiled()` gains a new optional parameter/step: for `returnType === 'GSTR3B'`, before flipping status, call `Gstr3bService.compute(db, tenantId, period)` one more time (or accept the already-computed result as a parameter from the route, to avoid a redundant computation if the caller already has it — see Backend), extract `cashRequired`/`setoff` from `computeItcSetoff()`'s output, and write it into `gst_return_filings.filingData` as `{ cashRequired: { igst, cgst, sgst }, itcUtilized: { igst, cgst, sgst }, filedAt: <timestamp> }` (itcUtilized derived by summing the relevant `setoff.*` fields per tax head — e.g. total IGST ITC utilized = `igstFromIgst + cgstFromIgst + sgstFromIgst`... actually re-derive per the existing `ItcSetoff.setoff` field names directly, do not invent new field names that don't map 1:1 to what `computeItcSetoff()` already returns).
- **GSTR-9's Table 9 reads the persisted per-period figures, summed across the FY**, instead of mirroring Table 4. `GSTR9Engine.generateGSTR9()` gains a query against `gst_return_filings` for `tenantId`, `returnType='GSTR3B'`, `period IN (...FY's 12 periods...)`, reads each row's `filingData.cashRequired`/`filingData.itcUtilized`, and sums them across all 12 periods to build `table9`. **This changes Table 9's meaning correctly**: if 10 of 12 months are filed with real persisted figures and 2 are not yet filed (still `PENDING`), the honest answer is that Table 9 cannot be fully computed for the FY yet — surface this explicitly (see below) rather than silently falling back to Table 4 for missing months, which would reintroduce exactly the bug this package fixes.
- **Explicit partial-year handling:** add a `table9Complete: boolean` and `unfiledPeriods: string[]` to `GSTR9Data` so the API response tells the caller plainly "8 of 12 periods have real filed figures, 4 do not — Table 9 total below reflects only the 8 filed periods" rather than presenting a full-year total that's silently missing months. This is a deliberate, small scope addition beyond "just swap the source" because shipping Table 9 as newly "precise" while silently omitting unfiled months would be a worse, harder-to-detect bug than the current honest simplification.

## Database Changes

- **No new table** — `gst_return_filings.filingData: jsonb` already exists and is the correct home for this (confirmed above: it exists, is currently always null, and is exactly scoped for "extra data about this specific filing"). No migration needed purely for this package's schema, **but** coordinate with PG-039's migration (which adds `manual_adjustments` to the same table) — if PG-039 lands first, no further schema change is needed here; if this package lands first, no schema change is needed either, since it only starts writing to an already-existing column. Either way: **no migration file is required for this package specifically** — the column already exists in the current schema (`packages/db-client/src/schema/gst.ts` line 130).
- **Rollback strategy:** not applicable — no schema change. If this feature needs to be reverted, `filingData` simply stops being written/read; existing rows retain whatever was already there (harmless, since nothing else in the codebase currently reads `filingData` for any other purpose — confirmed by grep, no other reference to `.filingData` exists in `apps/gst-service/src` today).

## Backend

- **Modify `apps/gst-service/src/domain/GstReturnTrackerService.ts`, `markFiled()`:** add an optional parameter `dischargeData?: { cashRequired: Record<'igst'|'cgst'|'sgst', number>; itcUtilized: Record<'igst'|'cgst'|'sgst', number> }`. When `returnType === 'GSTR3B'` and `dischargeData` is provided, include `filingData: { ...dischargeData, computedAt: new Date().toISOString() }` in the existing `.set({...})` call (alongside the existing `status`/`filedDate`/`filedBy`/`referenceNumber` fields — do not restructure the rest of the method). If `dischargeData` is omitted (e.g. marking GSTR1/GSTR9/GSTR9C filed, where this concept doesn't apply), behave exactly as today — `filingData` stays untouched/null.
- **Modify `apps/gst-service/src/api/gst-returns.routes.ts`, `POST /gst/returns/:returnType/mark-filed`:** when `returnType === 'GSTR3B'`, before calling `GstReturnTrackerService.markFiled()`, call `Gstr3bService.compute(ctx.db, tenantId, body.data.period)` to get the real `itcSetoff.cashRequired`/`itcSetoff.setoff`, derive `dischargeData` from it, and pass it through. This keeps `Gstr3bService` as the single source of truth for the computation and `GstReturnTrackerService` as the pure persistence layer, consistent with the existing separation of concerns in this codebase (service classes compute, route handlers orchestrate).
- **Modify `apps/gst-service/src/domain/GSTR9Engine.ts`, `generateGSTR9()`:** add a query for `gst_return_filings` rows (`tenantId`, `returnType='GSTR3B'`, `period IN periods`) alongside the existing `gst_ledger` query. Build `table9` by summing each filed row's `filingData.cashRequired` (and `itcUtilized` if the GSTR-9 form's Table 9 needs the ITC-utilized breakdown too — verify against the actual GSTR-9 form fields at implementation time; the government Table 9 form line items are "Integrated Tax/Central Tax/State Tax/Cess paid in cash" and "paid through ITC" as separate rows, so `GSTR9Table9` may need to grow from one flat `{igst,cgst,sgst,cess,total}` shape into two sub-objects — `paidInCash` and `paidThroughItc` — to match the real form structure, which is itself more correct than today's single flat number that conflates the two). Compute `table9Complete`/`unfiledPeriods` by checking which of the FY's periods have a `FILED`/`LATE_FILED` `gst_return_filings` row with non-null `filingData` vs. which are `PENDING` or missing `filingData`.
- **Events/Kafka:** not applicable — no new events; this is a same-service read/write.
- **Validation:** `dischargeData` values, if ever accepted directly from an API caller rather than always server-computed (this package's design computes it server-side from `Gstr3bService.compute()`, so no client input needed for it — do not add a client-writable `dischargeData` field to the `mark-filed` request body, since that would let a caller assert an arbitrary "amount paid" not backed by the ledger, undermining the whole point of this fix).
- **Backfill for already-filed periods:** any `gst_return_filings` rows already marked `FILED` for `GSTR3B` before this change ships will have `filingData = null` — `GSTR9Engine`'s new logic must treat these as "unfiled for Table 9 purposes" (include them in `unfiledPeriods`, exclude from the sum) rather than crashing or silently treating them as zero-contributing without flagging it. Do not attempt to retroactively backfill `filingData` for historical filings by re-running `Gstr3bService.compute()` against current ledger state — that would compute what the ledger looks like *now*, not what was actually filed *then* (the ledger may have changed since), which would be fabricating history. This limitation should be called out plainly in the API response (`unfiledPeriods` covers this case too) rather than hidden.

## Frontend

- Not applicable as a required deliverable (Medium priority, backend computation gap), but if a GSTR-9 review page exists under `apps/web-frontend/src/pages/gst/` (verify at implementation time), it should render the new `table9Complete`/`unfiledPeriods` fields as a visible warning banner ("Table 9 reflects N of 12 filed periods; M periods not yet filed are excluded") rather than silently showing a possibly-incomplete total as if it were final.

## API Contract

- `POST /gst/returns/GSTR3B/mark-filed` (existing endpoint, `apps/gst-service/src/api/gst-returns.routes.ts`) — **behavior change, same request/response shape**: now additionally computes and persists real discharge data into `gst_return_filings.filingData` as a side effect. Request body unchanged (`{ period, referenceNumber? }`); response unchanged (`{ data: { message } }`).
- `GET /gst/gstr9?year=YYYY-YY` — **response shape change**: `table9` changes from `{ igst, cgst, sgst, cess, total }` (mirroring Table 4) to a real form-shaped `{ paidInCash: {igst,cgst,sgst,cess,total}, paidThroughItc: {igst,cgst,sgst,cess,total} }` (or equivalent — confirm exact GSTR-9 form field names at implementation time), plus new top-level `table9Complete: boolean` and `unfiledPeriods: string[]` fields on `GSTR9Data`.
- `GET /gst/gstr9/export?year=YYYY-YY` — same response shape change, propagated (it wraps `generateGSTR9()`'s result).
- Error codes: unchanged (`400 VALIDATION_ERROR` for bad `year`/`period` format).

## Multi-Tenant Considerations

- No change to isolation — `gst_return_filings` queries are already scoped by `tenantId` (existing unique constraint includes `tenant_id`); the new `GSTR9Engine` query for filing rows must use the same `eq(gstReturnFilings.tenantId, tenantId)` filter already used everywhere else in this file, consistent with the rest of the codebase's explicit-filter convention (no RLS).

## Integration

- **apps/gst-service** only — `GSTR9Engine.ts`, `GstReturnTrackerService.ts`, `Gstr3bService.ts` (read-only reference, no logic change to `computeItcSetoff()` itself), `gst-returns.routes.ts`. No other service touched; no new event.

## Coding Standards

- Reuses the existing `gst_return_filings.filingData` jsonb column and the existing `markFiled()` choke-point rather than inventing a new persistence path or table — consistent with "reuse over rebuild." Reuses `Gstr3bService.compute()`/`computeItcSetoff()` as the single computation source rather than re-deriving cash/ITC figures independently inside `GSTR9Engine` or `GstReturnTrackerService`. The one deliberate new concept — treating "marked filed" as the moment a figure gets locked in, rather than always-live-recomputed — is justified above (a filed government return's numbers must not silently drift if the underlying ledger changes later).

## Performance

- Negligible — `GSTR9Engine.generateGSTR9()` already queries `gst_ledger` for up to 12 periods; adding a second query against `gst_return_filings` for the same 12 periods (indexed by `idx_gst_return_filings_tenant` on `tenant_id, return_type, status`) is a small additional read, not a scale concern.

## Security

- No new attack surface — `dischargeData` is always server-computed from `Gstr3bService.compute()`, never accepted as raw client input (see Backend section), so there's no way for a caller to assert a fabricated "amount paid." Existing `GSTR9_VIEW`/`GSTR9_FILE`/`GST_FILE` permission checks are unchanged.

## Testing

- Extend `apps/gst-service/src/__tests__/gst-engine.test.ts`'s `describe('GSTR9Engine.generateGSTR9')` block (currently has tests 5–7 for Table 4/6/tenant-isolation): add a test that marks 2 of 12 periods' GSTR-3B as filed with known `computeItcSetoff()` output, calls `generateGSTR9()`, and asserts `table9` sums only those 2 periods' persisted `cashRequired`/`itcUtilized`, `table9Complete === false`, and `unfiledPeriods` lists the other 10.
- Add a test for `GstReturnTrackerService.markFiled()`: marking a `GSTR3B` period filed with `dischargeData` populates `filingData` correctly; marking a `GSTR1` period filed (no `dischargeData` concept) leaves `filingData` null, unchanged from today's behavior.
- Add a test for the backfill/historical case: a `GSTR3B` filing marked `FILED` with `filingData = null` (simulating a pre-this-change filing) is correctly excluded from `table9`'s sum and appears in `unfiledPeriods`, without throwing.
- Regression: existing tests 5–7 in `gst-engine.test.ts` for Table 4/6/tenant-isolation must continue passing unchanged, since this package does not touch those tables.

## Acceptance Criteria

- [ ] `POST /gst/returns/GSTR3B/mark-filed` persists real `cashRequired`/`itcUtilized` figures (from `Gstr3bService.computeItcSetoff()`) into `gst_return_filings.filingData` for that period.
- [ ] `GET /gst/gstr9` Table 9 sums real persisted per-period discharge figures across the FY's filed periods, not a copy of Table 4.
- [ ] A financial year with some periods not yet filed correctly reports `table9Complete: false` and lists `unfiledPeriods`, rather than silently substituting Table 4 for the missing months.
- [ ] A pre-existing `FILED` GSTR-3B row with no `filingData` (simulating data from before this change) is treated as unfiled for Table 9 purposes, not crashed on or silently zero-filled.
- [ ] `pnpm --filter @erp/gst-service type-check` and `pnpm --filter @erp/gst-service test` pass.
- [ ] The removed "mirrors Table 4" code comment is replaced with an accurate description of the new real-discharge-tracking behavior and its partial-year caveat.

## Deliverables

- **Files to create:** none (no new files strictly required — extending existing modules; a new test file `apps/gst-service/src/__tests__/gstr9-table9-tax-paid.test.ts` is recommended for isolation from the existing `gst-engine.test.ts` file's unrelated coverage, but this is a test-organization choice, not new production code).
- **Files to modify:** `apps/gst-service/src/domain/GSTR9Engine.ts` (Table 9 computation + `table9Complete`/`unfiledPeriods`), `apps/gst-service/src/domain/GstReturnTrackerService.ts` (`markFiled()` accepts and persists `dischargeData`), `apps/gst-service/src/api/gst-returns.routes.ts` (`POST /gst/returns/:returnType/mark-filed` computes and passes `dischargeData` for GSTR3B).
- **Migrations:** none (reuses the existing `filingData` jsonb column).
- **APIs added/changed:** `GET /gst/gstr9` and `GET /gst/gstr9/export` response shape for `table9` changes; `POST /gst/returns/GSTR3B/mark-filed` gains a persistence side-effect (no request/response shape change).
- **Events added/changed:** none.
- **Tests added:** `gstr9-table9-tax-paid.test.ts` (or equivalent extension of `gst-engine.test.ts`).

---

## Context Preservation (for a fresh AI session with no prior history)

**Previous Work Summary:** `GSTR9Engine.generateGSTR9()` (apps/gst-service/src/domain/GSTR9Engine.ts) correctly computes Tables 4/5/6/7 from the `gst_ledger` table across a financial year's 12 periods, but Table 9 ("Tax Paid") is a hardcoded copy of Table 4 ("Tax Liability") — the code's own comment admits the real per-period cash/ITC-discharge split exists transiently in `Gstr3bService.computeItcSetoff()` but "is not persisted." `gst_return_filings` (packages/db-client/src/schema/gst.ts) is the existing per-tenant/return-type/period filing tracker with a `filingData: jsonb` column intended for exactly this kind of per-filing extra data — but `GstReturnTrackerService.markFiled()` currently never writes to it.

**Current Objective:** make `markFiled()` persist real `computeItcSetoff()`-derived cash/ITC-discharge figures into `filingData` whenever a GSTR-3B period is marked filed, then change `GSTR9Engine`'s Table 9 to sum those persisted per-period figures across the FY instead of mirroring Table 4 — explicitly surfacing (not silently hiding) any FY periods that aren't yet filed or predate this change and thus have no persisted figure.

**Architecture Snapshot:** `gst_return_filings` is unique on `(tenant_id, return_type, period)`; `Gstr3bService.computeItcSetoff()` (verified correct, do not modify) returns `cashRequired: {igst,cgst,sgst}` and a `setoff` object with per-source ITC utilization — these are the real "tax paid" figures. This package depends on PG-039 (`007-GST/32-gstr3b-rcm-import-itc-reversal-buckets.md`), which fixes the RCM/reversal *inputs* to that same `computeItcSetoff()` call and adds its own additive jsonb column to this same `gst_return_filings` table — coordinate migration numbers if both are implemented close together, though this package itself needs no migration (it only starts writing to the already-existing `filingData` column).

**Completed Components:** GSTR-9 Tables 4/5/6/7 (correct, unchanged by this package); the GSTR-3B `computeItcSetoff()` algorithm (correct, unchanged); the `gst_return_filings` tracker table and `markFiled()`/`getCalendar()`/`getStatus()` methods (existing, `markFiled()` extended by this package, the other two untouched).

**Pending Components:** PG-039's RCM/import/reversal bucket fixes (this package benefits from more accurate `computeItcSetoff()` inputs once PG-039 ships, but does not strictly require it to be done first — this package's persistence mechanism works with whatever `computeItcSetoff()` currently returns, correct or not; PG-039 improves the *accuracy* of what gets persisted, this package builds the *persistence and FY-aggregation* itself).

**Known Constraints:** dev-phase, no live production filings exist yet to worry about historical-data migration correctness for (per project memory) — but the code must still handle the "filed with no filingData" case gracefully for forward-compatibility, since real filings will eventually predate future changes too.

**Coding Standards:** see Coding Standards section — reuse `filingData` jsonb column and the `markFiled()` choke-point; do not add a new table; do not make `dischargeData` client-writable.

**Reusable Components:** `Gstr3bService.compute()`/`computeItcSetoff()` (the single computation source), `gst_return_filings.filingData` (the existing persistence column).

**APIs Already Available:** `POST /gst/returns/GSTR3B/mark-filed`, `GET /gst/gstr9`, `GET /gst/gstr9/export` — all existing endpoints whose internals this package changes, none of whose request shapes change.

**Events Already Available:** not applicable.

**Shared Utilities:** `@erp/logger`, `@erp/types`, Zod — used identically to existing gst-service routes.

**Feature Flags:** not applicable — correctness fix to a mandatory annual-return computation, not opt-in.

**Multi-Tenant Rules:** unchanged — every query already filters by `tenantId`, including the new `gst_return_filings` read inside `GSTR9Engine`.

**Security Rules:** `dischargeData` must remain server-computed only, never client-writable, to prevent a caller asserting a fabricated discharge figure; existing `GSTR3B_FILE`/`GSTR9_VIEW`/`GSTR9_FILE` permission checks are otherwise unchanged.

**Database State:** depends on migrations through `0034_organization_theme_config.sql` (or whatever PG-039's migration lands as, if implemented first) — no new migration required by this package itself.

**Testing Status:** `apps/gst-service/src/__tests__/gst-engine.test.ts` tests 5–7 cover `GSTR9Engine` Tables 4/6/tenant-isolation today; zero existing coverage for Table 9 or for `markFiled()`'s `filingData` behavior — this package's tests are net-new.

**Next Session Plan:** single session — Medium complexity, three files to modify, no schema migration of its own required.

**Prompt for the Next Session:** "Implement `ERP-PLANNING/production-gap-prompts/007-GST/33-gstr9-real-tax-paid-tracking.md` (PG-040). Before writing code, re-read `apps/gst-service/src/domain/GSTR9Engine.ts` lines 138–152 and `apps/gst-service/src/domain/GstReturnTrackerService.ts`'s `markFiled()` method in full, and check whether PG-039 (`007-GST/32-gstr3b-rcm-import-itc-reversal-buckets.md`) has already been implemented — if so, confirm its `manual_adjustments` column addition to `gst_return_filings` and reconcile migration numbering; if not, this package needs no migration of its own. Make `markFiled()` persist real `Gstr3bService.computeItcSetoff()` output into the existing `filingData` jsonb column when marking a GSTR3B period filed, then change `GSTR9Engine.generateGSTR9()`'s Table 9 to sum persisted per-period figures across the FY, with explicit `table9Complete`/`unfiledPeriods` fields for any period lacking a persisted figure — do not silently fall back to Table 4 for missing months."
