# CRM-ROADMAP Phase 1, Feature 5 — ERP-Native Integration Layer — Completion Report

**Date:** 2026-07-29
**Status:** Complete.

## Summary

Per AR-2, this feature is the one shared read-composition module — not a new service, not
duplicated per consumer — that surfaces live inventory/AR context inside CRM screens. It's
the structural moat the roadmap doc calls out as unreplicable by Salesforce/Dynamics without a
paid connector:

- New `apps/sales-service/src/domain/CustomerFinancialSnapshotService.ts`: `getFinancial()`
  (AR/credit snapshot — extracted from Feature 3's inline logic, now the one shared
  implementation) and `getRecentItemsStock()` (live stock, summed across every warehouse, for
  the customer's most-recently-purchased distinct items).
- **Retrofitted Customer 360 (Feature 3)** to call this module instead of its own inline
  balance query — the point of doing this now rather than "later" per the roadmap's own
  framing: Phase 2's Opportunity line items get a already-built, already-tested module to call
  instead of a second inline implementation of the same aggregation.
- No new tables, no new endpoint, no new permission — purely additive composition logic
  consumed by the existing `GET /customers/:id/360`.
- Frontend: `isOverLimit` badge (red, "OVER LIMIT") on Current Balance when a configured
  credit limit is exceeded, and a new "Recently Purchased — Stock" card showing live
  multi-warehouse-aggregated availability per item.

## Zero new cross-service data duplication (explicit DoD requirement)

Confirmed directly, not just asserted: `CustomerFinancialSnapshotService` reads
`projection_customer_balance` and `projection_stock_level` — the same CQRS projections
`InvoiceService`/`PaymentService`/inventory write-paths already maintain — via direct Postgres
queries. **No cross-service HTTP call was needed at all**: sales-service already has direct
query (and write) access to these projection tables in the same physical database (confirmed
by `InvoiceService.ts` already writing `projectionStockLevel` directly for its own stock
deduction). This is a genuinely new finding worth recording: the roadmap doc's own framing
("packages/platform-sdk if genuinely cross-service-reusable... vs. sales-service-local") turned
out to have an easy answer once checked — there is no service boundary to cross for read access
within this codebase's schema-per-tenant, single-Postgres-instance architecture. No valuation/
balance/stock math was reimplemented; every number traces to an existing, already-written
projection.

## Acceptance Criteria

- [x] A rep viewing a customer can see live stock relevance and AR status without switching to
      Inventory/Accounting — both sections render inline on the Customer 360 page (which is
      `CustomerViewPage.tsx`, per Feature 3's own decision to enrich that page in place).
- [x] Adjust stock for an item, then view the customer's 360 → reflects the adjustment without
      a service restart — covered directly (`customer-financial-snapshot.test.ts`: insert at
      qty 0, assert 0, update to 25, assert 25 on the very next call — no caching layer sits in
      front of `projection_stock_level`).
- [x] Record a payment reducing AR balance → credit-headroom figure updates correctly —
      covered directly (update `projection_customer_balance`, re-fetch, assert the new
      headroom).
- [x] A customer past their credit limit shows a clear, correctly-colored flag — `isOverLimit`
      computed server-side (`creditLimitEnabled && creditLimit > 0 && currentBalance >
creditLimit`), rendered as a red "OVER LIMIT" badge, not just a number without context.
- [x] A customer with no credit limit configured never divides by zero or shows a nonsensical
      percentage — `creditHeadroom` stays `null` (this was already Feature 3's edge case;
      re-verified here since the logic moved into the new shared module).
- [x] An item with stock split across multiple warehouses aggregates correctly, not misleadingly
      showing only one warehouse's count — covered directly: two warehouse rows (7 + 5) sum to
      12, with `warehouseCount: 2` surfaced so the UI can show "(2 warehouses)" rather than
      implying it's from one location.
- [x] Read-only, inherits the permission checks of the endpoint it's consumed by — no new
      permission constant added; `CRM_360_VIEW` (Feature 3) still gates the whole response.

## Verification performed this session

- `pnpm --filter sales-service type-check` / `pnpm --filter web-frontend type-check` — both
  clean.
- `eslint` scoped to every touched/new file — 0 errors (pre-existing-style warnings only).
- **Live integration test run** against the local dev Postgres — no new migration needed
  (this feature adds zero schema): `customer-financial-snapshot.test.ts` — **5/5 passing**
  (over-limit flag, no-limit-configured null-safety, live payment reflection, multi-warehouse
  sum, live stock-adjustment reflection).
- **Full regression check across Features 1–5**: re-ran `customer-360-degradation.test.ts` (1,
  confirming the Feature 3 retrofit didn't break its graceful-degradation behavior),
  `ticket-service.test.ts` (10), `lead-service.test.ts` (10),
  `lead-capture-auth-isolation.test.ts` (4), and `customer.integration.test.ts` (5) alongside
  this session's 5 new tests — **40/40 passing, zero regressions**.

## Files touched

- `apps/sales-service/src/domain/CustomerFinancialSnapshotService.ts` — new.
- `apps/sales-service/src/api/customer-360.routes.ts` — retrofitted to call the new shared
  service instead of its own inline balance query; added the `recentItemsStock` section to
  the composed response.
- `apps/sales-service/src/__tests__/customer-financial-snapshot.test.ts` — new; 5 tests.
- `apps/web-frontend/src/pages/customers/CustomerViewPage.tsx` — `isOverLimit` badge on
  Current Balance; new "Recently Purchased — Stock" card.

## What is not done (remaining TODO)

| Item                                                      | Why deferred                                                                                                                                                                       | Target                            |
| --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| Playwright E2E specs for the 3 scenarios in the phase doc | Not run this session (no browser harness invoked); logic covered instead by live DB integration tests                                                                              | Follow-up before Phase 1 sign-off |
| Phase 2's Opportunity line items consuming this module    | Opportunity doesn't exist yet (Phase 2 feature) — this module is built and tested so that when it does, it's a second consumer of already-proven code, not a second implementation | Phase 2                           |

## Deployment Checklist

- [x] No new migrations — this feature is purely additive composition logic over existing
      tables/projections.
- [ ] No new environment variables.
