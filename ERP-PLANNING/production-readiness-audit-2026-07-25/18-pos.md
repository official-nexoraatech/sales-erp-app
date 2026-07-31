# POS Module — Fresh Production-Readiness Audit (2026-07-25)

Scope: `apps/pos-frontend` + its calls to sales-service/inventory-service/gst-service through
the gateway. Tenant 2 "QA E2E Test Co", role CASHIER, per `ERP-PLANNING/TEST_CREDENTIALS.md`.

## Method

No browser-automation tool was available in this environment (no Playwright/DevTools MCP
surfaced). The core checkout/shift/payment/return flow was verified **live against the real
running stack** (gateway :3000, sales-service, inventory-service, tenant-service, all backed
by the real dev Postgres) by issuing the exact same HTTP calls pos-frontend's own code makes
(read from `POSScreen.tsx`, `orgStore.ts`, `pos.routes.ts` etc. first, then replayed as a
cashier-authenticated client). Test data was created live where the existing catalog didn't
support it (see "Test data created" below). Frontend-only concerns that need an actual
rendered DOM/keyboard/mouse (focus traps, aria-live announcements, true `navigator.onLine`
offline simulation, Web Serial/USB hardware) were verified by **reading the current source**
and cross-checking against the automated test suite, not by driving a real browser — flagged
explicitly below as unverified-live.

The 31-file / 192-test `pnpm --filter @erp/pos-frontend test` suite was run and is 100% green.

## Summary

The core POS transaction loop — open shift, multi-item mixed-line sale with a discount, CESS
correctly calculated, split cash+UPI payment, shift close — all worked correctly and matched
server-side math exactly on live data. The 2026-07-24 session's 9 critical + 10 second-wave
High fixes (offline-reload lockup, shift-close/pending-sales, offline item search, CESS
under-collection, loyalty change-calc, split-payment validation, Web Serial reopen, cash-drawer
permission, barcode checksum, focus trap, aria-live, font-size, keyboard-shortcut leaks) are
all present in the current working tree and consistent with what the code does at runtime.

However, this audit found **one new CRITICAL bug that defeats the GST-state-hardcoding fix
(commit `dc9651d`) for the actual role that runs the till**: `GET /api/tenant/organization`
strips the `gstin` field for any caller without `ORGANIZATION_VIEW` (a deliberate PG-013
bank-detail-leak fix), and `CASHIER`'s default role grants list — both in this tenant's live
JWT and in `apps/tenant-service/src/rbac/role-defaults.ts` — does **not** include
`ORGANIZATION_VIEW`. `orgStore.ts`'s `getCachedSellerStateCode()`/`refreshCachedSellerStateCode()`
therefore always receive `gstin: undefined` for a cashier, `setCachedSellerStateCode()` is
never called, and `salePayload()`'s `getCachedSellerStateCode() ?? '27'` silently falls back to
the hardcoded Maharashtra state code on every sale a cashier rings up — for both the
foreground POSScreen fetch and the shift-open bootstrap fetch, since both call the same
endpoint. It doesn't manifest as wrong tax in this specific test tenant only because tenant 2's
real GSTIN happens to start with `27` (Maharashtra) too — for any tenant registered in a
different state, every CASHIER-rung sale would still get the wrong CGST/SGST-vs-IGST split,
which is exactly the compliance bug commit `dc9651d` was supposed to have eliminated.

Readiness: **72/100** — the checkout/shift/payment/CESS/discount/return core is solid and
live-verified, but a compliance-critical fix is silently inert for the role that actually
operates the terminal, and ~8 High + ~10 Medium UX/feature gaps remain open by design
(documented, not hidden).

## What works (verified live)

- **Login + RBAC**: `cashier@qa-e2e.local` logs in via the doubled-prefix gateway path with a
  JWT scoped to exactly `POS_ACCESS`/`POS_OPEN_SHIFT`/`POS_CLOSE_SHIFT` + the sales/customer
  view-create set from `role-defaults.ts`. A non-POS role (`accountant@qa-e2e.local`) gets a
  clean `403 FORBIDDEN` on `POST /pos/sessions/open` and `GET /pos/sessions/active`.
- **Shift open/close**: `POST /pos/sessions/open` (branchId 1, warehouseId 5) → 201; session
  correctly tracked as OPEN, `totalSales`/`totalTransactions` increment on each sale;
  `POST /pos/sessions/:id/close` computes `expectedCash = openingCash + totalSales` and
  `cashVariance` correctly (verified: opening ₹2000 + sales ₹2685 = expected ₹4685; closing cash
  entered ₹3500 → variance −₹1185, matched by hand).
- **Multi-item sale with mixed lines, discount, CESS**: created a real invoice
  (`INV/26-27/00005`) with a 10%-discounted line (Cotton Saree ×2 @ ₹1000, GST 5%) and a
  CESS-liable line (item 42 ×3 @ ₹250 override price, GST 5% + CESS 1%). Server response:
  subtotal ₹2750, discount ₹200, taxable ₹2550, CGST ₹63.75, SGST ₹63.75, IGST ₹0, **CESS
  ₹7.50** (exactly 1% of the ₹750 CESS-line taxable amount — not under-collected), grand total
  ₹2685.00, matching hand-calculation exactly. CGST/SGST split (not IGST) is correct for an
  intrastate sale (both `placeOfSupply` and `sellerStateCode` = `27`).
- **Split payment**: `payments: [{CASH, 1500}, {UPI, 1185}]` summing to the ₹2685 due — accepted,
  invoice went straight to `PAID` with `balanceDue: 0`, two payment rows created and allocated
  atomically in one DB transaction (confirmed by reading `pos.routes.ts`'s `POST /pos/sales`
  handler, which wraps confirm+payments+loyalty+session-totals in a single `ctx.db.raw.transaction`).
- **Shift close with a pending held sale doesn't lose data**: parked a cart via
  `POST /pos/held-sales`, then closed the session — the close succeeded and the held-sale row
  was still present and listable afterward (backend never deletes/blocks on held sales at
  close time). Client-side, `ShiftCloseScreen.tsx` separately blocks closing while
  `getPendingSales()` (the **offline sync queue**, a different concept from held sales) is
  non-empty, with a "Sync now" button and a stuck-item callout — this is the actual
  2026-07-24-fixed bug ("shift-close ignored pending offline sales"), confirmed present in
  current source at `apps/pos-frontend/src/ShiftCloseScreen.tsx:35-72`.
- **RBAC on POS routes**: every `pos.routes.ts` handler is gated
  `requireAnyPermission([POS_MANAGE, POS_ACCESS])` or the narrower `POS_OPEN_SHIFT`/
  `POS_CLOSE_SHIFT`; the branch-scope check (`branchInScope`) independently rejects a
  `branchId` outside the caller's JWT `branchIds`.
- **Test suite**: `pnpm --filter @erp/pos-frontend test -- --run` → **31 test files, 192 tests,
  100% pass**, ~24s. Only benign React `act()` console warnings, no failures.
- **9 critical + 10 second-wave-High 2026-07-24 fixes spot-checked in current source** (not
  re-litigated line-by-line, but confirmed present, not reverted):
  - `session.ts`'s `fetchActiveSession()` returns a distinct `'offline'` status; `main.tsx`
    handles it as `'offline-unknown'` rather than hanging on `'checking'` forever.
  - `useItemSearch.ts`'s `fetchSearchPage()` falls back to `searchOffline()` (reads the Dexie
    `catalogItems` table) both when `!navigator.onLine` and when the live `fetch()` throws —
    code path is sound and would function offline; not driven through an actual disconnected
    browser session.
  - CESS is a real field on `CartItem`/line totals now (confirmed live above — not just a
    display fix, the actual invoice CESS amount is correct).
  - `POS_CASH_DRAWER` permission check present (`grep` hit in `POSScreen.tsx`), matching
    `role-defaults.ts`'s comment that CASHIER deliberately does not get it.
  - `isValidBarcodeChecksum()` exists with its own test file; `index.css` root font-size no
    longer a hardcoded `14px` pixel value; `role="status"` present on `POSSummary`/
    `SyncStatusPanel` for `aria-live`.
  - `writeSerial()`'s reopen guard, focus-trap/`aria-modal` on `ReceiptOverlay`, and
    modal-stack mutual exclusion were not independently re-derived but are consistent with the
    passing `ReceiptOverlay.test.tsx`/`crossCutting.test.tsx` files present in the suite.

## Bugs/gaps found

### NEW — Critical

**GST-state-hardcoding fix is silently inert for the CASHIER role** (the role that actually
runs the till). `GET /api/tenant/organization` (`apps/tenant-service/src/api/organization.routes.ts:103-141`)
omits `gstin`/`pan`/`tan`/`cin`/`bankDetails` from its response for any caller lacking
`ORGANIZATION_VIEW` — this is intentional, correct behavior for a prior bank-detail-leak fix
(PG-013). But `CASHIER`'s default permission set
(`apps/tenant-service/src/rbac/role-defaults.ts:89-112`) does not grant `ORGANIZATION_VIEW`,
and both `POSScreen.tsx`'s background `useQuery(['pos-org-gstin'], …)` and
`orgStore.ts`'s `refreshCachedSellerStateCode()` (called from `ShiftOpenScreen.tsx` right after
shift-open) call exactly that endpoint. Live-verified: logging in as
`cashier@qa-e2e.local` and calling `GET /api/tenant/organization` returns an object with no
`gstin` key at all; the identical call as `owner@qa-e2e.local` (who has `ORGANIZATION_VIEW`)
returns `"gstin":"27AABCU9603R1ZM"`. Since `getCachedSellerStateCode()` never gets set,
`salePayload()`'s `getCachedSellerStateCode() ?? '27'` always falls through to the hardcoded
`'27'` fallback for a cashier — for every sale, forever, not just before first sync.
**Business impact**: for any tenant not registered in Maharashtra, every POS sale rung up by a
CASHIER (the normal terminal operator) gets the wrong CGST/SGST-vs-IGST split — the exact
compliance bug commit `dc9651d` claimed to fix, silently unfixed for the primary user. Doesn't
show up as a symptom on tenant 2 only because its real GSTIN also happens to start with `27`.
**Fix direction**: either grant a narrow read (e.g. an `authenticate`-only `gstin`-only field,
or a small dedicated endpoint mirroring the `/pos/upi-vpa` pattern that already reads
`organizationSettings` cross-service without gating on `ORGANIZATION_VIEW`) so POS staff can
get the seller state code without exposing bank details, or push the derivation server-side
into `POST /pos/sales` itself instead of trusting a client-cached value at all.

### NEW — Note (not POS-specific, flagged for awareness)

`POST /pos/sales`'s `POSSaleSchema` accepts `gstRate`/`cessRate` per line directly from the
client (`apps/sales-service/src/api/pos.routes.ts:108-119`), and `InvoiceService.create()`
(`apps/sales-service/src/domain/InvoiceService.ts:140-151`) uses those values as-is in
`GSTCalculator.computeLine()` rather than re-validating them against the item's own
`gstRate`/`cessRate` in the `items` table. In normal operation pos-frontend always sources
these from `GET /pos/items/search`'s own server-computed values, so this isn't reachable
through the UI as tested. This is shared with every other invoice-creation path
(`InvoiceFormPage.tsx` etc.), not POS-specific, so it's not scored against this module, but
worth a cross-service note since a compromised/buggy client could under/over-collect tax on
any given line.

### Confirmed still-present (documented 2026-07-24, spot-checked, not fixed)

- **No manager-PIN/supervisor-override** for discount-limit or price-floor violations — dead-ends
  the sale.
- **No idle-timeout/auto-logout** on a shared kiosk terminal — grepped for
  `idle-timeout`/`managerPin`/`auto-logout`, zero hits.
- **No coupon/promo system, no flat-₹ discount, no wallet/gift-card modes** — percentage
  discount only, confirmed in `useCart.ts`.
- **No reprint/duplicate-receipt or PDF-download path** — `ReceiptOverlay`'s `CompletedSale`
  shape has no way to be reconstructed from a past invoice (payment mode/tendered/change are
  POS-session-local, never persisted to the invoice row).
- **Customer-specific/price-list pricing not auto-applied** on customer selection.

Not independently re-verified this session (trusted from the detailed 2026-07-24 audit record,
which itself was verified-current at that time and whose fixes for the _other_ ~10 items were
confirmed above): duplicate split-payment modes (reassessed as **not a bug** — legitimate),
order/line-discount desync, ambiguous quick-item substring matching, no offline-queue progress
indicator, no deletion-propagation for offline-cached soft-deleted rows, no price-change
staleness warning, HC-mode not wired into pos-frontend's `ThemeContext`.

## Untested/unknown areas (no real browser available)

- **True offline behavior**: `navigator.onLine`-gated code paths (offline item search fallback,
  offline-reload lockup fix, service-worker background sync) were verified by reading the
  source and confirming the relevant unit/integration tests pass — not by actually disconnecting
  a real browser tab from the network and observing the UI.
- **Web Serial/USB hardware** (barcode scanner, receipt printer, cash drawer kick): no physical
  or virtual USB/Serial device was available; verified only via the existing
  `webPrinter.test.ts`/`hardwarePrinting.test.tsx` unit tests (both pass) and a source read of
  the reopen-guard fix.
- **Accessibility** (focus trap, `aria-live`, screen-reader announcements, keyboard-shortcut
  guards): verified via `axe-core`-backed component tests (all pass) and source grep, not a
  real screen reader or keyboard-only session.
- **Loyalty earn/redeem live calc**: `sales.loyalty.enabled` feature flag is **off** for tenant
  2 (all 20 customers show `loyaltyPoints: 0`), and attempting to toggle it via
  `PUT /api/auth/admin/feature-flags/sales.loyalty.enabled` was blocked by this environment's
  own tool-permission sandboxing (denied as a config-mutation action), so the fixed
  change-calc formula (`amountDue = grandTotal - redemptionValue`, unified between
  `POSScreen.tsx` and `POSPaymentPanel.tsx`) was verified by **code read only** — confirmed the
  single-source `LOYALTY_POINT_VALUE = 0.5` export matches `LoyaltyService.ts`'s
  `DEFAULT_REDEEM_RATE = 0.5` exactly, and traced the `amountDue` threading through Change/UPI
  QR/split-Required — but not exercised end-to-end against a real `POST /pos/sales` with
  `loyaltyPointsRedeem > 0`.
- **GST-ledger/GSTR downstream posting for a POS-originated sale specifically**: per the task
  scope, not re-verified here since it shares sales-service's already-audited invoice path;
  only the invoice-row CGST/SGST/CESS amounts were checked (see above), not the GST-service-side
  ledger entry it should produce.
- **Web-frontend "Returns/Exchange" cross-app link** (`target="_blank"` to
  `{WEB_FRONTEND_URL}/sales/returns/new`): opens a separate origin with no token-passing
  mechanism found — a cashier would need a separate web-frontend login. Not re-tested this
  session (prior 2026-07-13 QA pass already marked this "returns-link" verified with zero bugs);
  flagged only as an untested assumption carried forward, not a new finding.

## Test data created (live dev DB, tenant 2)

- Stock adjustment `ADJ-2-1784937444907` (EXCESS, warehouse 5): +50 units to item 42 ("Basic
  Information", the only catalog item with `cessRate > 0`), so a CESS-liable line could actually
  be sold (it had 0 stock before). Submitted and approved.
- POS session `POS-2-1784937459923` (id 108): opened branch 1 / warehouse 5, opening cash
  ₹2000; closed with closing cash ₹3500 (variance −₹1185, deliberately mismatched to exercise
  the variance calc).
- Invoice `INV/26-27/00005` (id 128): 2-line sale (Cotton Saree ×2 @ 10% discount, item 42 ×3
  with CESS), split CASH ₹1500 + UPI ₹1185, `PAID`.
- Held sale id 25 (session 108, "Audit held sale" label) — left in place (not resumed/discarded)
  to demonstrate it survives shift close; harmless leftover test data.

## Readiness score: 72/100

- **−15**: the CASHIER-role GST-state fallback bug — a compliance-critical regression of the
  exact defect the module was already "fixed" for, live-confirmed, affects every non-Maharashtra
  tenant's real POS sales.
- **−8**: ~8 remaining High-severity gaps (manager override, idle-timeout, reprint, cash-drawer
  cross-check UX, price-list auto-apply, etc.) — all documented, none hidden, none blocking a
  basic retail counter but real gaps against Square/Shopify/Toast/Clover-class expectations.
- **−5**: loyalty earn/redeem couldn't be live-exercised (feature flag off, toggle blocked by
  this session's own tooling) — code looks correct but wasn't proven end-to-end.
- Core transaction integrity (multi-line sale, discount, CESS, split payment, shift
  open/close/variance, RBAC, offline-search/offline-reload code paths, 192/192 tests green) is
  solid and live-verified, which is why this isn't scored lower.
