# OFFLINE-02 — Offline Sync Idempotency & Retry Hardening
## STATUS: 🔲 NOT STARTED
## Sprint: Offline-2 | Effort: Small–Medium (2–4 days) | Risk: Critical (financial double-processing)
## Depends on: OFFLINE-01 (POS token refresh — sync must be able to run at all after a real outage before this matters)
## Unlocks: OFFLINE-03 through OFFLINE-06 (every later phase assumes queued writes sync safely without duplication)
## Source: `ERP-PLANNING/reports/OFFLINE_READINESS_REPORT.md` §6, §9 (idempotency row)

---

## YOUR ROLE

You are the **Platform Engineer** closing the single most severe finding in the
2026-07-05 offline-readiness audit: **there is no idempotency key anywhere in the
offline POS-sale flow**, so a retried sync — caused by a lost acknowledgment, the most
common failure mode on unstable connections — creates a duplicate invoice, a duplicate
stock deduction, a duplicate payment record, and duplicated loyalty-points accrual.

This is not a theoretical edge case for this project: the whole premise of the offline
initiative is that stores will queue sales for hours and sync in a burst on reconnect,
which is exactly the scenario that triggers lost-ack retries. This phase must close that
gap using the same atomic-claim pattern already proven correct elsewhere in this
codebase (the inbox pattern in `packages/platform-sdk/src/events.ts`), not a new
mechanism.

---

## PRE-FLIGHT CHECKLIST

- [ ] Read `ERP-PLANNING/reports/OFFLINE_READINESS_REPORT.md` §6 (conflict handling) and §9 (idempotency gap row) in full
- [ ] Read `packages/platform-sdk/src/events.ts`'s `PlatformEventConsumer.subscribe` (the atomic `INSERT ... ON CONFLICT ... DO UPDATE ... WHERE status != 'PROCESSED' RETURNING` claim pattern) — this is the pattern to mirror, not reuse directly (it's Kafka-event-shaped; you're building the equivalent for client-submitted offline writes)
- [ ] Read `apps/pos-frontend/src/offlineDb.ts` in full — the `PendingSale` schema (`{id, payload, createdAt, retries}`), and the fact that `incrementRetries` is fully implemented but never called
- [ ] Read `apps/pos-frontend/src/POSScreen.tsx`'s `salePayload()`, `queueSale` call site, and `syncPending()` in full
- [ ] Read `apps/sales-service/src/api/pos.routes.ts`'s `POST /pos/sales` handler in full, including the `POSSaleSchema` validation and the `` `POS-${tenantId}-${Date.now()}` `` invoice-number generation
- [ ] Read `packages/db-client/src/schema/sales.ts` — the `invoices` table's existing unique constraint (`invoices_tenant_number`) and its `version` column
- [ ] Read `packages/db-client/src/schema/notification.ts:69-81` — the one other place in the codebase with an idempotency-key unique constraint, as a schema-convention reference
- [ ] Check whether a live dev DB is reachable (per `[[es24_no_live_db_available]]`-style prior sessions, this hasn't always been true) — if not, write migrations and tests carefully enough to be confident without a live run, and say so explicitly in the completion report
- [ ] Run `pnpm --filter @erp/sales-service test` and `pnpm --filter @erp/pos-frontend build` to confirm a clean baseline

---

## PROJECT CONTEXT

### The exact failure this phase closes

```
Cashier's device queues Sale A offline → connectivity returns → syncPending() POSTs
Sale A's payload to /pos/sales → server creates the invoice, deducts stock, records
payment, commits → response is being sent back → connection drops for one second →
client never sees the 200 → syncPending() treats this as a failure → Sale A stays in
the IndexedDB queue → next sync attempt (or next reconnect) POSTs the exact same
payload again → server has no way to know this is a repeat → creates a SECOND invoice,
deducts stock a SECOND time, records a SECOND payment.
```

Today's only relevant constraint, `unique('invoices_tenant_number').on(tenantId,
invoiceNumber)`, does nothing here because the invoice number is minted fresh
server-side on every call — both the original and the duplicate get different, both
valid, unique numbers.

### The fix, mirroring the existing inbox pattern

1. The client attaches a stable, client-generated UUID (`operationId`) to a queued sale
   **at the moment it's queued**, not at sync time — so retries of the same queued item
   always carry the same ID, across app restarts, tab closes, etc.
2. The server records `operationId` with a unique constraint scoped to tenant (mirror
   the notification-service convention: `unique(tenantId, operationId)`), and performs
   the sale-creation + operationId-record insert **in the same transaction** the
   existing invoice-confirmation logic already uses (`InvoiceService.confirm` /
   whatever `pos.routes.ts` calls) — do not add a second, separate transaction.
3. On a retried request with an `operationId` that already succeeded, the server
   returns the **original** result (same invoice, same invoice number) instead of
   creating anything new — this is what makes retries safe, not just "rejected."
4. If the original request is still in-flight when the retry arrives (a genuine race,
   not just a delayed retry), the unique-constraint violation on `operationId` must be
   caught and translated into "return the now-committed original result" rather than a
   500 — matching how the audit's prior work "translate[d] the Postgres unique-violation
   into a proper 422" for invoice-number races (see `[[architecture_audit_2026_07_03]]`
   / ES-23).

### Retry/backoff for the client side

`offlineDb.ts`'s `incrementRetries` exists and is fully implemented but dead — no
caller. Wire it up: increment on every failed sync attempt, and once a queued item hits
a configurable max-retry threshold, move it to a distinct "needs manual review" state
rather than retrying forever silently. Surface this to the cashier/admin (a small UI
affordance is fine here; a full monitoring dashboard is OFFLINE-06's job, not this
phase's).

### Coding Standards
- TypeScript strict — no `any`
- No `console.log` — use `packages/logger`
- New migration files follow this repo's existing drizzle migration numbering/naming convention — check the latest migration number under `packages/db-client` before adding a new one
- Every idempotency change needs a test that proves the specific duplicate-creation scenario is now closed

---

## OBJECTIVE

1. Every offline-queued sale carries a stable client-generated `operationId`, attached at queue time
2. `POST /pos/sales` accepts and atomically dedupes on `operationId`, returning the original result on any repeat instead of creating a new invoice
3. A race between two near-simultaneous submissions of the same `operationId` resolves to exactly one invoice, with the loser receiving the winner's result, not an error
4. `offlineDb.ts`'s dead `incrementRetries` is wired up with a max-retry threshold and a distinct stuck-item state

---

## SCOPE

### Step 1 — Client: attach `operationId` at queue time

`apps/pos-frontend/src/offlineDb.ts`: extend the `PendingSale` schema with `operationId:
string` (generate via `crypto.randomUUID()` — check it's available in the target
browser/runtime environment; polyfill if this app's build target requires it). Set it
once, in `queueSale`, not in `syncPending` — the whole point is that the same ID
survives every retry of the same queued item.

`apps/pos-frontend/src/POSScreen.tsx`: include `operationId` in the payload POSTed by
`syncPending()`.

### Step 2 — Backend: idempotency table + atomic dedupe

New migration: an idempotency-tracking mechanism for POS sales — either a dedicated
column + unique constraint on `invoices` (e.g. `client_operation_id`, `unique(tenantId,
clientOperationId)`, nullable for non-POS-originated invoices) or a separate tracking
table mirroring `notification.ts:69-81`'s pattern, whichever fits this schema's existing
conventions better — check how `invoices` already models optional/nullable
origin-specific columns before deciding, and justify the choice briefly in the
completion report.

`apps/sales-service/src/api/pos.routes.ts`: before creating the sale, attempt the
idempotency claim atomically alongside the sale-creation write in the same transaction.
On a unique-constraint violation (another request already claimed this `operationId`),
catch it and re-fetch + return the already-created invoice's result instead of
propagating a generic 500 — mirror the "translate unique-violation into a clean
response" pattern from the ES-23 invoice-number race fix (find that fix's code, likely
in `InvoiceService.ts` or `pos.routes.ts` itself, and match its shape).

### Step 3 — Client: wire up retry/backoff and a stuck-item state

`apps/pos-frontend/src/offlineDb.ts`: call `incrementRetries` on every failed sync
attempt in `syncPending()`. Add a `maxRetries` constant (pick a sensible default, e.g.
5, and note it's configurable); once a `PendingSale` exceeds it, mark it in a new status
field (e.g. `status: 'stuck'`) rather than continuing to retry it silently on every
future reconnect. Surface stuck items distinctly in the existing pending-count UI
(`POSScreen.tsx`) — a visible "N sales need attention" indicator is sufficient for this
phase; a full resolution workflow is OFFLINE-06/07's job.

### OUT OF SCOPE
- Background Sync API wiring (dead `DO_SYNC` scaffold) — that's OFFLINE-06
- Stock-conflict resolution UX (what happens when a queued sale's stock ran out by sync time) — that's OFFLINE-07, this phase only ensures a *retry* of the *same* request doesn't duplicate; a *rejected* sale (insufficient stock) is a separate, already-correctly-atomic failure mode per `InvoiceService.ts:374-398`
- Extending idempotency to any endpoint beyond `POST /pos/sales` — if a later phase adds more offline-write endpoints (held-sale creation, returns), they should follow this same pattern, but building them now is out of scope
- A full admin monitoring dashboard for stuck items — a visible count/indicator in the POS UI is enough for this phase

---

## TESTING REQUIREMENTS

1. Queueing the same conceptual sale twice (simulating a queue-then-retry) with the same `operationId` results in exactly one invoice on the backend after both requests are sent
2. Two near-simultaneous requests with the same `operationId` (simulated race) both receive the same invoice result; only one invoice is created (assert via DB row count, not just response equality)
3. Two different `operationId`s for two genuinely different sales both succeed independently
4. A failed sync increments `retries` on the corresponding `PendingSale`
5. A `PendingSale` exceeding `maxRetries` transitions to the stuck state and is no longer retried automatically
6. The stuck-item count is visible in the POS UI
7. Normal (non-retry) sale sync continues to work unchanged

---

## BUILD VERIFICATION

```bash
pnpm --filter @erp/db-client build
pnpm --filter @erp/sales-service build
pnpm --filter @erp/pos-frontend build
pnpm lint
pnpm type-check
pnpm test --filter @erp/sales-service --filter @erp/pos-frontend
pnpm --filter @erp/db-client drizzle-kit generate   # or this repo's equivalent migration-generation command — confirm exact script name first
```

---

## VERIFICATION CHECKLIST

- [ ] Retrying the same queued sale (same `operationId`) never creates a second invoice
- [ ] A simulated race between two identical-`operationId` requests resolves to exactly one invoice
- [ ] `incrementRetries` is called on every failed sync attempt
- [ ] A stuck-item state exists and is surfaced in the POS UI
- [ ] `pnpm lint` and `pnpm type-check` pass repo-wide

---

## REGRESSION CHECKLIST

- [ ] Normal online sale creation (not via the offline queue) is unaffected — confirm `operationId` is optional/backward-compatible for any caller that doesn't send one, or that all POS-originated sales are expected to send one and non-POS invoice creation paths are untouched
- [ ] Existing atomic stock-deduction behavior (`InvoiceService.ts:374-398`) is unchanged
- [ ] `offlineDb.ts`'s existing `queueSale`/`getPendingSales`/`deletePendingSale` behavior is unaffected outside the new fields added
- [ ] ES-23's invoice-number unique-violation-to-422 translation still works for its original (non-offline) scenario

---

## DEFINITION OF DONE

- [ ] Retried offline-sale syncs are provably idempotent (duplicate invoice/stock/payment creation is impossible for the same queued sale)
- [ ] Client-side retry/backoff and stuck-item detection are live
- [ ] All new tests pass; regression suite green
- [ ] `pnpm lint` and `pnpm type-check` pass repo-wide
- [ ] Completion report saved at `ERP-PLANNING/phase-completions/OFFLINE-02_COMPLETION.md`
- [ ] `ERP-PLANNING/reports/OFFLINE_FIRST_ROADMAP.md` updated to mark OFFLINE-02 complete with a pointer to the completion report

---

## COMPLETION REPORT TEMPLATE

**Save as:** `ERP-PLANNING/phase-completions/OFFLINE-02_COMPLETION.md`

```markdown
# OFFLINE-02 Completion Report — Offline Sync Idempotency & Retry Hardening
**Date:** [YYYY-MM-DD]
**Status:** COMPLETE / PARTIAL

## Findings Closed
| Finding | Fix Summary | Verified By |
|---|---|---|
| No idempotency key in offline POS-sale sync — duplicate invoices on retry | client operationId + atomic server-side dedupe | concurrency test |
| Dead incrementRetries, no backoff/stuck-item detection | wired up with maxRetries + stuck state | test |

## Idempotency Design
- Mechanism chosen: [column+constraint on invoices / separate tracking table] and why
- Migration file: [path]

## Files Changed
[Table]

## Tests: [N]/[N] PASS | lint: PASS | type-check: PASS | build: PASS

## Live DB Verification
[State whether a live DB was available to run the migration/tests against, or if this was verified by code review + unit tests only]

## Known Issues / Deferred
- Idempotency is scoped to POST /pos/sales only; any future offline-write endpoint must independently adopt this same pattern
- [Any other deferred items]
```
