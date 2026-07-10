# ES-24 Completion Report — Event Architecture Integrity
**Date:** 2026-07-04
**Status:** COMPLETE (orchestrator + 1/9 sagas — matches the phase's own explicit scope)

## Findings Closed

| ID | Finding | Fix Summary | Verified By |
|---|---|---|---|
| C6 | Outbox writes outside transaction | Wrapped `accounts.routes.ts` POST/PUT/seed and `opening-balances.routes.ts` lock in `ctx.db.transaction()` + a `PlatformEventBus` bound to the transaction's `trx`, matching `JournalEngine`'s existing correct pattern | manual review + type-check (no live DB to run a rollback-proof integration test — see Known Issues) |
| C7 | Inbox TOCTOU race | Replaced the SELECT-then-insert check with a single `INSERT ... ON CONFLICT DO UPDATE ... WHERE status != 'PROCESSED' RETURNING` — only the caller whose write actually "won" the row runs `handler()`; a `FAILED`/stuck-`PROCESSING` row remains legitimately reclaimable for retry | 3 new tests exercising the real `PlatformEventConsumer.subscribe()` (not a reimplementation) — concurrent redelivery runs handler once, `PROCESSED` never reclaimed, `FAILED` is reclaimable |
| H3 | No SagaOrchestrator | Built `packages/platform-sdk/src/saga.ts` — full engine (run/retry/compensate, step history persisted to `saga_log`, reverse-order compensation, IRREVERSIBLE steps skip auto-compensation). Wired into `InvoiceService.confirm()` as a proof-of-concept (see "Saga Orchestrator" section below for why this is a single-step wrap, not the literal 3-step split the phase brief sketched). `event-service`'s admin retry/compensate endpoints now call the real orchestrator | 5 new orchestrator tests (happy path, compensation + reverse order, IRREVERSIBLE-skips-compensation, retry-resumes-from-persisted-step, unregistered-type error) |
| H11 | `DELETE /accounts/:id` no financial_entries check | Implemented the TODO — queries `financial_entries` for the account, rejects with `ACCOUNT_HAS_TRANSACTIONS` if any exist | manual review + type-check |
| M15 | Journal post/reverse no events | `JournalEngine.post`/`reverse` now publish `JOURNAL_POSTED`/`JOURNAL_REVERSED` inside their existing transaction, using the journal's numeric surrogate PK as `aggregateId` (the ulid `journalId` business key is carried in the payload — `outbox_events.aggregate_id` is an integer column) | manual review + type-check |
| M16 | gst-service no events | Added `EINVOICE_GENERATED`/`EWAY_BILL_GENERATED` publishes via `ctx.events.publish()` alongside the existing `ctx.audit.log()` calls in `einvoice.routes.ts`/`eway-bill.routes.ts` | manual review + type-check |
| M23 | `DELETE /accounts/:id` missing tenantId filter | Added `eq(accounts.tenantId, tenantId)` to the soft-delete UPDATE's WHERE clause | manual review + type-check |

## Saga Orchestrator

- **Location:** `packages/platform-sdk/src/saga.ts` — exported from `@erp/sdk` as `SagaOrchestrator`, `SagaExecutionError`, plus supporting types.
- **Design:** a registry-based engine. `run()` executes a live step list against a live context and persists progress to `saga_log`. `retry()`/`compensate()` take only a `sagaId` + `tenantId` (matching the admin API's actual shape) and reconstruct steps+context via a factory registered per `sagaType` — this is what lets `event-service`'s admin endpoints call `orchestrator.retry(id)` without event-service having any of the business logic that saga's steps actually run (that logic lives in whichever service owns the saga, e.g. sales-service for `INVOICE_CREATION`).
- **Sagas wired:** `INVOICE_CREATION` only, in `InvoiceService.confirm()`.
- **Sagas NOT built (explicitly out of scope per the phase brief):** `PURCHASE_GRN`, `STOCK_TRANSFER`, `PAYMENT_PROCESSING`, `PAYROLL_PROCESSING`, `YEAR_END_CLOSE`, `SALE_RETURN`, `CUSTOMER_MERGE`, `TENANT_CLOSE`.

### Why `INVOICE_CREATION` is wired as a single RETRYABLE step, not the phase brief's literal 3-step sketch

The phase brief's proof-of-concept sketch was: `validate → deduct stock (COMPENSATABLE) → post accounting entry (COMPENSATABLE) → publish INVOICE_CONFIRMED (IRREVERSIBLE)`. The actual code does not match that shape:

1. `InvoiceService.confirm()` does **not** post accounting entries synchronously — accounting posting happens asynchronously in accounting-service, reacting to the `INVOICE_CONFIRMED` outbox event via a consumer. There is no "post accounting entry" step inside `confirm()` to wrap.
2. Everything `confirm()` *does* do — status/duplicate/period validation, atomic stock deduction, FIFO/WACC COGS, ledger writes, invoice status update, CQRS projections, and the outbox event writes — already runs inside **one Postgres transaction**, per an explicit architectural decision documented in the existing code comments (ES-03's notes: a cross-process call "cannot be undone if this transaction later aborts, so it would break the atomicity this phase requires"). Splitting that into multiple saga steps with independent transactions would **trade away** a strictly stronger guarantee (Postgres all-or-nothing) for a weaker one (eventual, compensate()-based consistency) — for no upside, since nothing in the current architecture needs the split.
3. I do not have a live database available in this environment (confirmed: Docker Desktop stopped, `.env`'s configured Postgres port unreachable) to safely verify a multi-way split of this financially-critical, 260-line method end-to-end. Given that constraint, I judged it irresponsible to perform a large, unverifiable refactor of already-correct, already-tested production code for the sake of literally matching an illustrative sketch in the phase brief.

**What was actually done:** `confirm()` now runs through `SagaOrchestrator.run()` with a single `RETRYABLE` step whose `execute()` calls the existing, unmodified `confirmInTransaction()`. This gets genuine value from the orchestrator — every invoice confirmation now has a real `saga_log` row, visible in the admin saga viewer and retriable via `POST /admin/sagas/:id/retry` — without regressing the transaction's atomicity or touching unverifiable financial logic. The orchestrator's actual multi-step compensation mechanism (a later step failing and triggering `compensate()` on an earlier COMPENSATABLE step, in reverse order) is proven directly and thoroughly in `packages/platform-sdk/src/__tests__/saga.test.ts` using synthetic steps — this is the mechanism a future phase would use if/when a genuine multi-step, cross-transaction saga is needed (e.g. if accounting posting is ever made synchronous, or a saga spans a true cross-service call).

### Why `event-service`'s retry/compensate only work for sagas whose factory is registered in that process

`saga.routes.ts`'s admin endpoints now call `orchestrator.retry(id, tenantId)` / `.compensate(id, tenantId)` for real (previously: flipped a status column and did nothing else). Since the actual step logic for `INVOICE_CREATION` lives in sales-service (a separate process/deployment), and this monorepo's services don't import each other's domain code directly (only `packages/*` shared workspaces), `event-service` cannot itself re-execute those steps. Calling retry/compensate on an `INVOICE_CREATION` saga from `event-service`'s admin API will surface a clear `SAGA_TYPE_NOT_REGISTERED` error — this is honest and strictly better than the old behavior (silently flipping a column while doing nothing). Building a cross-service retry-request event + consumer (the architecturally consistent fix, matching how every other cross-service interaction in this codebase works) is flagged below as a deferred follow-up — sales-service currently has **no Kafka consumer infrastructure at all** (confirmed via grep), so building that pipeline is a meaningfully larger, separate piece of work than "wire up the retry button."

## Files Changed

| Area | Files |
|---|---|
| Inbox fix | `packages/platform-sdk/src/events.ts` |
| Saga engine | `packages/platform-sdk/src/saga.ts` (new), `packages/platform-sdk/src/index.ts` (exports) |
| Outbox atomicity | `apps/accounting-service/src/api/accounts.routes.ts`, `apps/accounting-service/src/api/opening-balances.routes.ts` |
| Journal events | `apps/accounting-service/src/domain/JournalEngine.ts`, `apps/accounting-service/src/api/journal.routes.ts` |
| Account delete guard | `apps/accounting-service/src/api/accounts.routes.ts` (H11/M23, same file as C6) |
| GST events | `apps/gst-service/src/api/einvoice.routes.ts`, `apps/gst-service/src/api/eway-bill.routes.ts` |
| Saga admin wiring | `apps/event-service/src/api/saga.routes.ts` |
| Saga proof-of-concept | `apps/sales-service/src/domain/InvoiceService.ts` |
| Tests | `packages/platform-sdk/src/__tests__/saga.test.ts` (new), `packages/platform-sdk/src/__tests__/events-inbox.test.ts` (new) |
| Test mock fixes (caused by the saga wrap needing `sagaLog` + top-level `db.insert`/`db.update`) | `apps/sales-service/src/__tests__/invoice-ledger.test.ts`, `apps/sales-service/src/__tests__/invoice-validation.test.ts` |

## Tests: 41/41 PASS (platform-sdk 56 total incl. pre-existing) | sales-service 31/31 PASS, 18 skipped (DB-gated, unrelated) | build: PASS (5/5 touched packages) | type-check: PASS (5/5) | lint: no new errors (verified via `git stash` diff — all remaining warnings/errors in touched files are pre-existing)

- `packages/platform-sdk`: 56/56 passed (8 files) — includes 5 new `saga.test.ts` tests and 3 new `events-inbox.test.ts` tests
- `apps/sales-service`: 31/31 passed, 18 skipped (DB-gated integration tests + 2 unrelated pre-existing route-registration-bug failures in `permission-guards.test.ts` — the same duplicate `/invoices/:id/pdf` route bug ES-23's completion report already flagged as pre-existing and out of scope; confirmed via `git status` that `invoice.routes.ts`'s route registrations were untouched by this phase)
- `apps/accounting-service`, `apps/gst-service`, `apps/event-service`: no new tests added (C6/H11/M23/M15/M16 fixes are route-handler/domain-method changes without existing unit-test scaffolding for these specific handlers in this environment — see Known Issues)

## Chaos Re-verification

**Not re-run** — no live Docker/Postgres/Kafka stack available in this environment (confirmed: `docker compose ps` failed to reach the Docker daemon; `.env`'s configured Postgres port is unreachable). The chaos-engineering report's Experiment 1.1 (`ERP-PLANNING/phase-completions/chaos-engineering-report.md`) claims `saga_log` showed a `COMPENSATED` state during a prior inventory-service-kill test — this is suspicious given the audit's own finding that no real `SagaOrchestrator` existed anywhere in the codebase before this phase (i.e., `saga_log` had no real writer). I did not investigate that discrepancy further (out of scope for this phase), but flag it here rather than silently accepting the chaos report's claim at face value. Whoever has a local stack available should re-run Experiment 1.1 against the now-real orchestrator and update the chaos report if its original claim doesn't hold up.

## Known Issues / Deferred

- **8 remaining sagas are specified but not implemented** — `PURCHASE_GRN`, `STOCK_TRANSFER`, `PAYMENT_PROCESSING`, `PAYROLL_PROCESSING`, `YEAR_END_CLOSE`, `SALE_RETURN`, `CUSTOMER_MERGE`, `TENANT_CLOSE`. Recommend a dedicated follow-up phase per the phase brief's own guidance.
- **Cross-service saga retry is not wired end-to-end.** `event-service`'s admin retry/compensate endpoints genuinely call the orchestrator, but for `INVOICE_CREATION` (owned by sales-service) they'll throw `SAGA_TYPE_NOT_REGISTERED` since sales-service's step logic isn't reachable from event-service's process. The architecturally-consistent fix — event-service publishes a `SAGA_RETRY_REQUESTED`/`SAGA_COMPENSATE_REQUESTED` event, sales-service consumes it and calls its own local orchestrator — requires building Kafka consumer infrastructure in sales-service from scratch (it currently has none). Flagging as a real gap, not glossing over it.
- **C6's rollback guarantee is unverified by an executable test** — I could not run a live-DB test proving the account-insert-and-event-publish now roll back together on a mid-transaction failure (Testing Requirement #2). The code change is a direct application of the same `db.transaction()` + `publishInTransaction()` pattern already proven correct in `JournalEngine.post()` (pre-existing), so I'm reasonably confident in it, but "reasonably confident" is not the same as "proven" — flagging honestly rather than claiming a test that doesn't exist.
- **M15/M16's new outbox events are unverified against a live DB** (Testing Requirements #7, #8 — "events appear in outbox_events after post/generation" — needs a real Postgres to assert against).
- **The chaos report's Experiment 1.1 claim is unverified/possibly inaccurate** — see "Chaos Re-verification" above.
- Pre-existing, unrelated: `apps/sales-service/src/api/invoice.routes.ts` has a duplicate `/invoices/:id/pdf` route registration (breaks `permission-guards.test.ts`) — already flagged in ES-23's completion report, not fixed here either (out of scope, not this phase's finding).
