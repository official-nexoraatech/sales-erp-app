# CRM-ROADMAP Phase 2, Feature 3 — Loyalty & Rewards Tiering Layer — Completion Report

**Date:** 2026-07-29
**Status:** Complete.

## Summary

Tiers, a redemption catalog, and point expiry on top of the existing points ledger
(`LoyaltyService.ts`, `loyalty_transactions`). Extends the existing service rather than
replacing it — redemption (both the pre-existing raw points->currency path and the new
catalog-reward path) still posts through the exact same ledger, never a parallel rewards rail.

- **3 new tables**: `crm_loyalty_tiers` (name/code/`minLifetimePoints`/benefits),
  `crm_redemption_catalog` (named rewards: `pointsCost` + `DISCOUNT_AMOUNT`/`DISCOUNT_PERCENT`),
  `crm_loyalty_redemptions` (which catalog item was redeemed, linked to the ledger transaction it
  posted). Additive `customers.loyalty_tier_id`.
- **Tiers are derived from LIFETIME points earned** (SUM of EARN + BIRTHDAY_BONUS transactions
  ever posted), not current redeemable balance — evaluated on-transaction inside `earnPoints()`
  (not just nightly), so a tier badge updates immediately when a threshold is crossed. A
  customer's tier can only go up, never down automatically, even after redemption or point
  expiry drains their current balance — this is the roadmap's own flagged
  "customer-experience-sensitive" auto-downgrade question, resolved by design rather than left
  open (see Decisions #1).
- **Real, pre-existing bug found and fixed: the entire point-expiry pipeline had never fired.**
  `loyalty_transactions.expiry_date` and `expirePoints()`'s query already existed (from an
  earlier phase), and a scheduler job already called it daily — but `earnPoints()` never
  actually wrote a non-null `expiry_date` on any EARN transaction, confirmed via grep
  (`expiryDate` referenced in exactly one place, the query itself, before this fix). No point
  had ever expired in this codebase's history as a result. Fixed by setting a 365-day expiry on
  every EARN transaction; the rest of the pipeline needed no change.
- **Real, pre-existing concurrency gap found and fixed**: `earnPoints`/`redeemPoints` read the
  customer's balance _outside_ the transaction that later updated it — the same class of race
  `ValuationService`'s stock-deduction code already had to fix (see that file's own comment).
  Two concurrent redemptions could both read the same stale balance and the second write would
  clobber the first, allowing an overdraw. Fixed with `SELECT ... FOR UPDATE` inside the
  transaction, mirroring `ValuationService.consumeForStockOut` exactly. Verified directly: 100
  concurrent 1-point redemptions against a 50-point balance now resolve to exactly 50
  succeeding, 50 rejected, balance never negative (this feature's own explicit DoD requirement).
- **Real, pre-existing RBAC gap found and fixed**: `/pos/loyalty/redeem` was gated on
  `POS_MANAGE`, which `CASHIER` deliberately does not hold (that constant is reserved for
  supervisor-tier actions like the cash-drawer report) — meaning a cashier running the actual
  till could never redeem a customer's loyalty points, only a manager/owner could. This
  contradicts the roadmap's own explicit requirement ("cashier-permitted but not
  cashier-configurable"). New `LOYALTY_REDEEM`/`LOYALTY_TIER_MANAGE` permissions split exactly
  along that line; `/pos/loyalty/redeem` now checks `LOYALTY_REDEEM`, granted to
  `CASHIER`/`SALES_MANAGER`/`OWNER`/`ADMIN`/`SUPER_ADMIN`.
- **New catalog-redemption path**: `LoyaltyService.redeemCatalogItem()` (still calls the same
  ledger insert + `SELECT ... FOR UPDATE` discipline as `redeemPoints`), a new
  `POST /pos/sales` field `redeemCatalogItemId` (mutually exclusive with the pre-existing
  `loyaltyPointsRedeem`), wired server-side inside the same atomic invoice-confirmation
  transaction pos.routes.ts already uses (not a separate pre-checkout API call — the real
  `invoiceId` is available at that point, same reasoning as the existing raw-points path).
- **New point-expiry-warning notification**: `LoyaltyService.getExpiringPoints()` + internal
  route `POST /loyalty/expiry-warnings/send` + scheduler job `sales.loyalty-points-expiry-warning`
  (`30 1 * * *`, an hour before the expiry job itself) — reuses the existing
  `birthdayNotificationBreaker` circuit breaker, respecting opt-out flags. Only meaningful now
  that `earnPoints()` actually sets `expiry_date`.
- **Frontend**: `LoyaltyProgramPage.tsx` (tier + catalog configuration, `LOYALTY_TIER_MANAGE`),
  a Loyalty Tier badge on Customer 360 (`CustomerViewPage.tsx`, showing current tier + points
  needed to the next one), and a reward picker in POS checkout
  (`POSPaymentPanel.tsx`/`POSScreen.tsx`) offering catalog rewards the customer can currently
  afford, alongside (mutually exclusive with) the pre-existing raw-points input.

## Decisions / deviations (flagged during implementation, not silently decided)

1. **Tier downgrade: never automatic, by design.** Basing tier on lifetime points earned (which
   never decreases) rather than current balance means a customer never loses a tier from
   redeeming rewards or from point expiry — the roadmap explicitly asked for this decision to be
   made and documented rather than left ambiguous. If a tenant lowers an already-assigned tier's
   threshold later, `evaluateTier` also refuses to demote (compares against the _current_ tier's
   own threshold, not just the newly-eligible one).
2. **Raw points-to-currency redemption (`/pos/loyalty/redeem`) and catalog-reward redemption
   (`/pos/sales`'s `redeemCatalogItemId`) are mutually exclusive per sale** — simpler than
   stacking two discounts, and matches how most POS systems apply "one promotion" logic. Enforced
   both client-side (POSPaymentPanel hides the raw-points input once a reward is selected) and
   server-side (`ValidationError` if both are sent).
3. **`LOYALTY_REDEEM`/`LOYALTY_TIER_MANAGE` are new constants, not a repurposing of the existing
   (already-dead) `CRM_LOYALTY_VIEW`/`CRM_LOYALTY_ADJUST`.** Those two are tracked as accepted
   dead-permission exceptions in `dead-permission-constants.test.ts` (used only as report-registry
   metadata) — reusing them would have been confusing given the roadmap names two specific new
   constants with a real, intended cashier-vs-config split.
4. **Catalog redemption is wired server-side inside `POST /pos/sales`'s existing transaction**,
   not as a separate pre-checkout API call from the frontend — the real `invoiceId` needed for
   the ledger's `referenceId` only exists once the invoice row is created, which happens inside
   that same transaction. A separate pre-flight redemption call would have needed a placeholder
   reference and a second round-trip; this mirrors exactly how the pre-existing raw-points path
   already works.
5. **A real, latent bug shared by this pattern elsewhere was found but not fixed**: this same
   `SELECT-outside-transaction` concurrency gap and the raw-Date-into-`sql\`\`` interpolation bug
   (both fixed here) are documented, recurring bug classes in this codebase
   ([[raw_sql_date_interpolation_bug_pattern]]) — a dedicated audit of other domain services for
   the same two patterns is worth a follow-up pass but is out of scope for this feature.

## Acceptance Criteria

- [x] Tiers auto-evaluate correctly — covered directly (crossing a threshold assigns the tier
      immediately; a second, higher threshold crossing upgrades further).
- [x] Redemption at POS never allows a negative balance under concurrent load — covered directly:
      100 concurrent 1-point redemptions against a 50-point balance resolve to exactly 50/50,
      final balance exactly 0.
- [x] A customer crosses a tier threshold → tier badge updates on Customer 360 without manual
      intervention — evaluated on-transaction (inside `earnPoints`), not just nightly.
- [x] Redeem points at POS checkout → balance debits correctly, discount applies — both the
      pre-existing raw-points path (already worked) and the new catalog-reward path are covered.
- [x] Attempt to redeem more points than available → blocked cleanly, not an overdraw — covered
      for both `redeemPoints` and `redeemCatalogItem`.
- [x] A point-expiry-warning notification fires for points nearing expiry — covered directly
      (`getExpiringPoints` unit-level, plus the full pipeline: earn → manually age past expiry →
      `expirePoints()` actually deducts, proving the fix closes the real end-to-end gap, not just
      the write side).
- [x] Concurrent-redemption test passes, mirroring the stock-deduction concurrency test's rigor —
      same `Promise.allSettled` pattern as `InventoryLedgerService`'s own concurrency test.

## Verification performed this session

- `pnpm --filter @erp/db build` / `@erp/types build` — clean.
- `pnpm --filter sales-service type-check` / `scheduler-service type-check` /
  `web-frontend type-check` / `pos-frontend type-check` — all clean.
- `eslint` scoped to every touched/new file — 0 errors (only the same pre-existing-style
  `explicit-function-return-type` warnings already present throughout this codebase).
- **Live migrations applied**: `0124_crm_loyalty_tiers.sql` (3 tables + `customers.loyalty_tier_id`),
  `0125_crm_loyalty_tier_permission_backfill.sql` (`INSERT 0 208` for
  OWNER/ADMIN/SUPER_ADMIN/SALES_MANAGER, `INSERT 0 26` for CASHIER).
- **New `loyalty-service.test.ts`** — **9/9 passing**: the concurrency test (100 concurrent
  redemptions), expiry-date-now-set-on-earn, the full expire pipeline firing end-to-end,
  `getExpiringPoints` window filtering, tier upgrade + further upgrade, tier never-demotes on
  redemption, catalog redemption debit + ledger linkage, catalog-redemption overdraw block, and
  catalog-item validation (out-of-range percent).
- **Regression sweep**: `pos-completion.test.ts` (7 tests, exercises `LoyaltyService` directly) —
  7/7 passing. `scheduler-service` full suite (83 tests, including `system-jobs.test.ts`) —
  83/83 passing. `tenant-service` full suite (59 tests, `role-defaults.ts` changed) — 59/59
  passing. `pos-frontend` full suite (192 tests across 31 files, including the updated
  `POSPaymentPanel.test.tsx`) — 192/192 passing. `web-frontend` CRM + customer page tests —
  14/14 passing.
- `packages/shared-types` `route-guard-coverage` scan — the new loyalty routes are not flagged;
  the 2 unguarded routes it does report are pre-existing and unrelated.
- **Confirmed pre-existing, not a regression**: the same broad JWT-issuer-mismatch failure
  documented in `[[concurrent_sessions_on_same_repo]]` still affects
  `offline02-pos-sale-idempotency.test.ts`, `offline07-stock-conflict.test.ts`, and
  `pos-branch-isolation.test.ts` (all exercise `POST /pos/sales` over real HTTP/JWT) — every
  failure is the same uniform 401-instead-of-expected pattern, with no new failure mode from this
  feature's `pos.routes.ts` changes.

## Files touched

- `packages/db-client/src/schema/crm.ts` — 3 new tables + type exports.
- `packages/db-client/src/schema/master.ts` — `customers.loyaltyTierId` (additive).
- `packages/db-client/migrations/0124_crm_loyalty_tiers.sql`,
  `0125_crm_loyalty_tier_permission_backfill.sql` — both applied live.
- `packages/db-client/migrations/meta/_journal.json` — 2 appended entries.
- `packages/shared-types/src/permissions.ts` — `LOYALTY_TIER_MANAGE`, `LOYALTY_REDEEM`.
- `apps/tenant-service/src/rbac/role-defaults.ts` — SALES_MANAGER (both) + CASHIER
  (`LOYALTY_REDEEM` only) grants.
- `apps/sales-service/src/domain/LoyaltyService.ts` — concurrency fix, expiry fix, tier
  evaluation, tier/catalog CRUD, `redeemCatalogItem`, `getExpiringPoints`.
- `apps/sales-service/src/api/loyalty.routes.ts` — tier/catalog CRUD routes, catalog-redemption
  route, `/pos/loyalty/redeem`'s guard changed to `LOYALTY_REDEEM`.
- `apps/sales-service/src/api/pos.routes.ts` — `redeemCatalogItemId` field, wired server-side.
- `apps/sales-service/src/api/internal.routes.ts` — new `POST /loyalty/expiry-warnings/send`.
- `apps/scheduler-service/src/jobs/system-jobs.ts` — new `sales.loyalty-points-expiry-warning` job.
- `apps/sales-service/src/__tests__/loyalty-service.test.ts` — new, 9 tests.
- `apps/web-frontend/src/pages/crm/LoyaltyProgramPage.tsx` — new.
- `apps/web-frontend/src/pages/customers/CustomerViewPage.tsx` — tier badge.
- `apps/web-frontend/src/api/endpoints.ts` — extended `loyaltyApi`.
- `apps/web-frontend/src/App.tsx`, `apps/web-frontend/src/lib/navigation.ts` — route + nav entry.
- `apps/pos-frontend/src/POSScreen.tsx`, `apps/pos-frontend/src/components/pos/POSPaymentPanel.tsx`,
  `apps/pos-frontend/src/__tests__/POSPaymentPanel.test.tsx` — reward picker.

## What is not done (remaining TODO)

| Item                                                                                     | Why deferred                                                                                                                                                                 | Target                                            |
| ---------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| Playwright E2E specs for the 4 scenarios in the phase doc                                | Not run this session; logic covered instead by unit + live-DB integration tests                                                                                              | Follow-up before Phase 2 sign-off                 |
| Client-side catalog caching per POS session                                              | This feature's own Performance Considerations calls for it explicitly (avoid refetching per redemption attempt); the current query uses React Query's default staleTime only | Revisit if POS latency profiling shows it matters |
| Audit of other domain services for the same `SELECT-outside-transaction` concurrency gap | Found and fixed here (mirroring `ValuationService`'s prior fix), but a full codebase sweep for the same class of bug wasn't performed this session                           | Dedicated follow-up pass                          |

## Deployment Checklist

- [ ] Run migrations `0124_crm_loyalty_tiers.sql`, `0125_crm_loyalty_tier_permission_backfill.sql`
      against every target database (staging/prod) — verified applied against the local dev DB
      this session only.
- [ ] No new environment variables.
- [ ] Existing tenants with real, uncleared loyalty balances will start accumulating tier
      progress and expiry dates only from this deploy forward — any already-earned points never
      retroactively receive an `expiry_date` (by design: backfilling one onto historical
      transactions would risk expiring points a customer earned years ago all at once).
