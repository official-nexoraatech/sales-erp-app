# OFFLINE-02 Completion Report — Offline Sync Idempotency & Retry Hardening
**Date:** 2026-07-05
**Status:** COMPLETE

## Findings Closed

| Finding | Fix Summary | Verified By |
|---|---|---|
| No idempotency key anywhere in the offline POS-sale flow — a retried sync (lost ack) creates a duplicate invoice, stock deduction, and payment | Client attaches a stable `operationId` (`crypto.randomUUID()`) to a `PendingSale` at queue time (`offlineDb.ts`'s `queueSale`), carried through every retry; server stores it as `invoices.clientOperationId` (nullable, `unique(tenantId, clientOperationId)`), written atomically inside the same insert `InvoiceService.create()` already runs — a repeat is caught as a Postgres 23505 and translated into `DuplicateOperationError` instead of a new row. `pos.routes.ts` catches this before `confirm()`/payment/loyalty ever run, so none of that downstream side-effect chain executes twice | `offline02-idempotency.test.ts` (6 tests), `offline02-pos-sale-idempotency.test.ts` (3 tests) |
| A genuine race — two near-simultaneous submissions of the same `operationId` — could return an error or a half-committed row to the loser | `pos.routes.ts`'s `waitForOperationResult()` polls (up to 10× 150ms) for the winning request's invoice to leave `DRAFT` before returning it; if it never resolves in that window, returns `409 DUPLICATE_OPERATION_PROCESSING` (client's existing retry-on-failure path — see below — picks it up next sync attempt) rather than a raw 500 or a partial result | `offline02-pos-sale-idempotency.test.ts`'s "polls until the in-flight winner commits" and "returns 409 if the in-flight winner never resolves" tests |
| Dead `incrementRetries`, no backoff or stuck-item detection — a permanently-failing queued sale retried forever, silently, on every reconnect | `syncPending()` now calls `incrementRetries()` on every failed attempt (both thrown exceptions and non-ok responses, which previously did nothing at all); `incrementRetries()` transitions the record to `status: 'stuck'` once `retries >= MAX_RETRIES` (5); `syncPending()` skips `stuck` items; POS UI shows a distinct "⚠ N sales need attention" indicator alongside the existing pending-sync count | `offlineDb.test.ts` (5 tests, using a minimal in-memory `indexedDB` fake — jsdom doesn't implement IndexedDB) |

## Idempotency Design

**Chosen: a nullable `client_operation_id` column + `unique(tenant_id, client_operation_id)` on `invoices` itself** (not a separate tracking table).

Why: the invoice-creation insert (`InvoiceService.create()`) is the single earliest write in the whole POS-sale flow, and it already runs inside its own atomic transaction. Making that same INSERT the atomic claim point means a rejected retry never reaches `confirm()` (stock deduction), payment creation, or loyalty accrual — all of it is prevented for free, not just the invoice row. This mirrors the exact convention already used for `notification_log.idempotency_key` (nullable `varchar` + tenant-scoped unique index, see `0021_es26_notification_idempotency.sql`) and for `invoices.invoiceNumber` itself (also nullable + unique, since `DRAFT` invoices don't have one yet). A separate tracking table would need its own transaction coordination with the invoice insert to get the same atomicity — the doc's own instruction ("do not add a second, separate transaction") rules that out here.

Reconstructing the "original result" for a duplicate/retry doesn't need a stored response snapshot: `grandTotal`, `loyaltyPointsEarned`, and `loyaltyRedemptionValue` are already columns on `invoices`, and `paymentIds` is recovered via `payment_allocations` (already indexed by `invoiceId`). No new response-payload storage was needed.

- **Migration file:** `packages/db-client/migrations/0031_offline02_pos_sale_idempotency.sql` (+ `meta/_journal.json` entry `idx: 31`)
- **Schema:** `packages/db-client/src/schema/sales.ts` — `invoices.clientOperationId` + `invoices_tenant_client_operation_id` unique index

## Files Changed

| File | Change |
|---|---|
| `packages/db-client/migrations/0031_offline02_pos_sale_idempotency.sql` | New — `client_operation_id` column + unique index on `invoices` |
| `packages/db-client/migrations/meta/_journal.json` | Added journal entry for migration 0031 |
| `packages/db-client/src/schema/sales.ts` | Added `clientOperationId` column + `invoices_tenant_client_operation_id` unique constraint |
| `apps/sales-service/src/domain/InvoiceService.ts` | Added `DuplicateOperationError`; `create()` now writes `clientOperationId` in its insert and translates a 23505 on the new constraint into `DuplicateOperationError` (mirrors the existing `isUniqueViolation`/`INVOICE_NUMBER_DUPLICATE` pattern from ES-23) |
| `apps/sales-service/src/api/pos.routes.ts` | `POSSaleSchema` gains optional `operationId` (UUID); `POST /pos/sales` passes it through as `clientOperationId`; catches `DuplicateOperationError`, polls via new `waitForOperationResult()`, and returns the original invoice/payment/loyalty result (200) or `409 DUPLICATE_OPERATION_PROCESSING` if the winner hasn't committed yet |
| `apps/pos-frontend/src/offlineDb.ts` | `PendingSale` gains `operationId` (set once in `queueSale` via `crypto.randomUUID()`) and `status: 'pending' \| 'stuck'`; new `MAX_RETRIES` (5); `incrementRetries()` now transitions to `'stuck'` past the threshold |
| `apps/pos-frontend/src/POSScreen.tsx` | `syncPending()` sends `operationId` with every retry, calls `incrementRetries()` on any failed attempt (previously a no-op on non-ok responses), and skips `stuck` items; new `stuckCount` state + UI indicator |
| `apps/sales-service/src/__tests__/offline02-idempotency.test.ts` | New — 6 tests on `InvoiceService.create()`'s dedup translation |
| `apps/sales-service/src/__tests__/offline02-pos-sale-idempotency.test.ts` | New — 3 tests on the route's duplicate/race/timeout handling |
| `apps/pos-frontend/src/__tests__/offlineDb.test.ts` | New — 5 tests on `queueSale`/`incrementRetries`/stuck-state transition |

## Tests: 14/14 new PASS (6 + 3 sales-service, 5 pos-frontend) | full `sales-service` suite: 55/55 PASS (16 pre-existing DB-gated skipped) | `pos-frontend` suite: 12/12 PASS | type-check: PASS (`db-client`, `sales-service`, `pos-frontend`) | build: PASS (same three packages)

`pnpm lint` on the touched files: no new error categories. `pos-frontend`'s three touched/new files are fully clean. `sales-service`'s new/touched files surface only the same two pre-existing, repo-wide gaps already present before this phase (`no-undef` on `process`/`setTimeout` — the shared `eslint.config.mjs` declares no Node/browser globals at all, affecting ~223+ pre-existing lines across the monorepo, see `[[preexisting_lint_debt]]`) — confirmed by diffing against already-established reference test files (`invoice-validation.test.ts`, `pos-branch-isolation.test.ts`) which show the identical warning/error shape.

## Live DB Verification

**No live DB was available this session** (Docker Desktop unreachable — same gap as prior ES-22–ES-24 and OFFLINE-01 sessions). The migration SQL and schema change were written by hand and cross-checked against the existing `notification_log.idempotency_key` migration/schema pair for syntax and convention consistency, but neither was run against a real Postgres instance. All idempotency-logic tests use scripted mock DB layers (matching this repo's established no-DB test harness pattern from `invoice-validation.test.ts`) rather than a real unique-constraint violation — the exact shape of the simulated Postgres error (`{code: '23505', constraint_name: ...}`) matches the pre-existing `isUniqueViolation()` helper's expectations (already used by ES-23's `INVOICE_NUMBER_DUPLICATE` path), but this has not been confirmed against a real `postgres` driver error object. **This migration should be run and its dedup behavior re-verified against a live DB before this phase is considered production-safe.**

## Known Issues / Deferred

- **Idempotency is scoped to `POST /pos/sales` only**, per this phase's explicit scope — any future offline-write endpoint (held-sale creation, returns) must independently adopt the same `clientOperationId` pattern.
- **The direct-online-attempt path (`isOnline === true`) doesn't carry an `operationId` on its first try** — only the client's `queueSale()` fallback (triggered when the direct POST's response comes back non-ok) generates one. If the direct attempt's fetch *throws* (e.g. the connection drops before any response, rather than returning a non-2xx status), the current `saleMutation` code has no catch around that specific branch and never calls `queueSale()` at all — the sale is neither queued nor retried. This is a pre-existing gap (not introduced by this phase) adjacent to, but distinct from, the documented failure scenario (which is specifically about retries of *already-queued* items); worth a follow-up fix but out of this phase's explicit scope.
- **`waitForOperationResult()`'s polling window (10 × 150ms ≈ 1.5s) is a fixed, unconfigurable constant** — reasonable for the concurrent-duplicate-submission race this phase targets, but if `confirm()`'s downstream chain (stock deduction, payment, loyalty) ever grows significantly slower, this window may need to become configurable.
- **`MAX_RETRIES = 5` and the 150ms poll interval are simple fixed constants**, not exponential backoff — matches the phase's explicit scope ("pick a sensible default... and note it's configurable"); tuning them is left for real-world outage-pattern data per the roadmap's own stated approach to sizing later phases.
- **A full stuck-item resolution workflow (retry-manually, discard, edit-and-resubmit) is out of scope** — the POS UI only surfaces a count, per this phase's brief (OFFLINE-06/07's job).
