# OFFLINE-07 Completion Report — Conflict Detection & Resolution UX
**Date:** 2026-07-05
**Status:** COMPLETE

## What Changed

### Backend — distinguishable STOCK_CONFLICT response (`apps/sales-service`)
- `InvoiceService.ts`'s existing `InsufficientStockError` (thrown by the already-correct
  atomic stock check in `confirm()`, untouched) now also carries `requested` (the queued
  quantity) and populates `ERPError.details` with `{ itemId, available, requested }`. The
  code stayed `INSUFFICIENT_STOCK` — it was already a specific, machine-readable 422 code
  distinct from network/auth failures, so a second name (`STOCK_CONFLICT`) for the same
  condition was judged unnecessary (see "Design decisions" below).
- `sendError()` (`http-errors.ts`) gained an optional `details` param so this shape reuses
  the existing helper instead of a one-off `reply.send(...)`.
- **`pos.routes.ts`'s `POST /pos/sales` now wraps `svc.confirm()` in a try/catch**: on
  `InsufficientStockError` it calls `svc.cancel()` (existing, unmodified method) on the
  invoice `create()` already committed, then returns 422 `INSUFFICIENT_STOCK` with the
  details above. This closes a real bug the investigation found (see below) — without it,
  a stock conflict left an orphaned, un-confirmable `DRAFT` invoice tied to the
  `operationId` forever, which would silently break any retry under that same id.

### Client — recognize + resolve conflicts (`apps/pos-frontend`)
- `db.ts`: `PendingSale` gained an optional `conflict?: { itemId, available, requested }`.
- `offlineDb.ts`: `markStockConflict()` routes a sync failure straight to `'stuck'` (no
  point counting a deterministic business rejection toward `MAX_RETRIES`); `resolveConflict(id, 'adjust' | 'cancel')`
  clamps the conflicting line to the available quantity (or cancels outright if that
  leaves zero lines) and re-queues under a **new** `operationId` — see design note below
  on why the original id can't be reused.
- `POSScreen.tsx`:
  - `syncPending()` detects `error.code === 'INSUFFICIENT_STOCK'` on a failed sync and
    calls `markStockConflict()` instead of `incrementRetries()`.
  - `refreshPendingCount()`/`retryStuckItems()` split conflict items out of the generic
    stuck-item bucket, so the existing "N items need attention — Retry" button never
    blindly re-submits an unresolved conflict.
  - New `StockConflictModal` (extends `SyncStatusPanel`'s existing stuck-item surface with
    a dedicated "N stock conflicts — Resolve" button) shows queued vs. currently-available
    quantity per conflicting item, with **Adjust & retry** / **Cancel sale** actions.
  - **Fixed a related live-checkout bug found during investigation**: the online
    `saleMutation` was queuing *any* non-ok server response (including deterministic
    business-rule rejections like `INSUFFICIENT_STOCK`, `CREDIT_LIMIT_EXCEEDED`,
    `PRICE_FLOOR_VIOLATION`) into the offline retry queue alongside showing the cashier an
    error — and that error message was broken too (`new Error(err.error)` on an object,
    rendering as `[object Object]`, since the server's error shape is
    `{ error: { code, message } }` not `{ error: string }`). Now only a genuine fetch
    failure (no server response at all) queues for retry; a completed rejection shows the
    real message immediately and is not queued. This was required for the phase's stated
    assumption to actually hold ("a live sale attempt shows the cashier an immediate
    error" — regression checklist item 3) and for cancel-orphan-invoice inline cleanup not
    to have its own duplicate silently re-queued behind it.

### `invoices.version` optimistic lock
**Not added — not needed.** The adjust-and-retry flow never updates an existing invoice
row: it resubmits as a brand-new `create()` + `confirm()` under a new `operationId` (per
the phase prompt's stated preference). The only "update" touching the orphaned invoice is
the existing, unmodified `cancel()` call, triggered exactly once per conflict by the
request that discovered it — no concurrent-writer scenario exists on that row for this
flow to guard against.

## Design decisions
1. **Reused `INSUFFICIENT_STOCK` instead of inventing `STOCK_CONFLICT`.** The phase
   prompt's example code was illustrative, not mandatory; the objective ("a specific
   error code, not a generic 500/422") was already satisfied by the domain error's
   existing code. A second name for the same condition would only add indirection.
2. **New `operationId` on adjust-and-retry is load-bearing, not a style choice.**
   `create()` commits its `DRAFT` invoice (with `clientOperationId`) in its own
   transaction, separate from `confirm()`'s. When `confirm()` fails on insufficient stock,
   that `DRAFT` row survives unless explicitly cancelled — and even after cancelling it,
   reusing the same `operationId` would hit `waitForOperationResult()`'s dedup path, which
   requires a non-null `invoiceNumber` (only assigned at `confirm()`) before returning a
   result. A cancelled-while-still-`DRAFT` invoice never gets one, so a same-id retry would
   time out into a permanent `409 DUPLICATE_OPERATION_PROCESSING`. This is exactly the
   failure mode the phase prompt anticipated and asked to confirm — confirmed, and
   designed around by always using a fresh id for the resubmission.
3. **Auto-adjust requires explicit cashier/manager confirmation**, per the roadmap
   default — the UI only adjusts when the "Adjust & retry" button is clicked, never
   automatically.

## Files Changed
| File | Change |
|---|---|
| `apps/sales-service/src/domain/InvoiceService.ts` | `InsufficientStockError` gains `requested` + `details` |
| `apps/sales-service/src/api/http-errors.ts` | `sendError()` gains optional `details` param |
| `apps/sales-service/src/api/pos.routes.ts` | catch `InsufficientStockError` around `confirm()`, cancel orphan, return details |
| `apps/sales-service/src/__tests__/offline07-stock-conflict.test.ts` | new — response shape + cancel-orphan behavior |
| `apps/pos-frontend/src/db.ts` | `PendingSale.conflict` + `StockConflict` type |
| `apps/pos-frontend/src/offlineDb.ts` | `markStockConflict()`, `resolveConflict()` |
| `apps/pos-frontend/src/POSScreen.tsx` | sync-side conflict detection, `StockConflictModal`, live-checkout queue-on-failure fix |
| `apps/pos-frontend/src/__tests__/offlineDb.test.ts` | new tests for conflict marking/resolution |

## Tests: 7/7 new PASS (2 backend, 5 frontend) | full suite: sales-service 63/63, pos-frontend 51/51 PASS | build: PASS (both packages) | type-check: PASS (both packages)

Lint: no new error categories introduced. Both packages' `pnpm lint` still fail overall due
to pre-existing missing-ESLint-globals debt (`crypto`, `fetch`, `process`, `window`, etc.
not declared as recognized globals — see `preexisting_lint_debt` note from an earlier
session, ~223 errors before this phase). New code follows the same style as adjacent
pre-existing lines in the same files (e.g. `crypto.randomUUID()` was already used in
`offlineDb.ts` before this phase).

## Known Issues / Deferred
- **Price-conflict handling** (price changed between queue-time and sync-time, as opposed
  to stock) is out of scope per the phase prompt and was not investigated as a live
  concern this session — no finding either way.
- The live-checkout queue-on-failure fix only distinguishes "server responded" vs. "fetch
  threw"; a response that times out at the network layer without the browser raising a
  catchable error (rare, but possible on some connections) isn't specifically handled
  differently from today's behavior.
