# OFFLINE-07 — Conflict Detection & Resolution UX
## STATUS: 🔲 NOT STARTED
## Sprint: Offline-7 | Effort: Medium (3–5 days) | Risk: Medium
## Depends on: OFFLINE-02 (idempotency), OFFLINE-04 (locally-cached stock/price data to detect staleness against), OFFLINE-06 (status UI surface to hang conflict indicators on)
## Unlocks: nothing further in this series — this is the last correctness-hardening phase before OFFLINE-08/09/10
## Source: `ERP-PLANNING/reports/OFFLINE_READINESS_REPORT.md` §6

---

## YOUR ROLE

You are the **Backend + Frontend Engineer** closing the audit's finding that "there is
no conflict-resolution strategy of any kind — no last-write-wins, no merge, no
user-facing conflict prompt." The backend's atomic stock-deduction check
(`InvoiceService.ts:374-398`) already correctly *detects* a conflict (stock changed
since a queued sale was created) and *fails safely* (no oversell) — but today that
failure surfaces as a stuck queue item with a generic error and no path forward for the
cashier. This phase adds the missing resolution layer on top of the already-correct
detection.

---

## PRE-FLIGHT CHECKLIST

- [ ] Read `apps/sales-service/src/domain/InvoiceService.ts:360-398` in full — confirm current behavior on insufficient stock during sync (throws `InsufficientStockError`), and whether this has changed since the original audit
- [ ] Read `packages/db-client/src/schema/sales.ts` — `invoices.version` column, and confirm (per the audit) whether any update path checks it as an optimistic lock; re-verify current state before assuming it's still unchecked
- [ ] Read OFFLINE-02's stuck-item state in `offlineDb.ts`/`POSScreen.tsx` — this phase adds a specific "stock conflict" sub-reason to that state rather than inventing a parallel mechanism
- [ ] Read OFFLINE-06's sync status UI — this phase's conflict indicator should extend that surface, not build a separate one
- [ ] Confirm what "resolution" should mean for a stock conflict from a retail-operations perspective — the roadmap defaults to "reject and clearly notify, offer adjust-and-retry," not automatic partial fulfillment, since silently changing what a customer already paid for is a business-policy decision, not a technical one; if the client has a specific preference (e.g. auto-adjust to available quantity), confirm before building the auto-adjust path

---

## PROJECT CONTEXT

### What already works (don't touch)

Stock deduction is atomic and safe: `UPDATE items SET availableQty = availableQty - qty,
version = version + 1 WHERE availableQty >= qty` inside a transaction. A queued sale
that syncs after stock ran out correctly fails closed with `InsufficientStockError`. This
is correct and should not change.

### What's missing

When that failure happens during a sync (as opposed to a live, online sale attempt where
the cashier sees the error immediately), the queued item today just sits in the pending
queue, indistinguishable from any other sync failure, with no indication of *what*
changed or *what to do about it*. This phase's job is entirely about that gap: detect
that a stuck item's failure reason is specifically a stock conflict (vs. a network error,
an auth error, etc.), and give the cashier/manager a clear resolution path — see the
current (possibly changed) stock level, and either adjust the queued sale's quantity and
retry, or cancel that line/the sale with a clear audit trail of what happened.

### `invoices.version` as an optimistic lock

The audit found this column exists but isn't checked anywhere. If this phase's
conflict-detection work touches any invoice-update path (e.g. the adjust-and-retry flow
re-submitting a modified sale), add the `WHERE version = $expected` guard at that point,
matching the already-correct pattern used for `items.version`. Don't do a
codebase-wide sweep for every place `invoices` might theoretically be updated
concurrently unless you find one directly in this phase's path — that's scope creep
beyond what this phase needs.

### Coding Standards
- TypeScript strict — no `any`
- Do not touch `InvoiceService.ts`'s existing atomic stock-check logic — this phase adds
  a resolution layer around its failure, not a change to the check itself
- Reuse OFFLINE-02's stuck-item state and OFFLINE-06's status UI rather than parallel mechanisms

---

## OBJECTIVE

1. The backend distinguishes a stock-conflict sync failure from other failure types in its response (a specific error code, not a generic 500/422)
2. The client recognizes this specific failure reason on a stuck item and shows the cashier/manager the current available stock alongside the originally-queued quantity
3. The cashier/manager can adjust the queued sale's quantity (or cancel that line) and retry, with the retry going through the same idempotent sync path as any other sync attempt
4. `invoices.version` is enforced as an optimistic lock on whatever update path this resolution flow introduces

---

## SCOPE

### Step 1 — Backend: distinguishable conflict response

Confirm/ensure `InsufficientStockError` (or whatever error type `InvoiceService.ts`
throws) is translated into a specific, machine-readable error code in the `POST
/pos/sales` response (e.g. `{ error: 'STOCK_CONFLICT', available: N, requested: M }`),
not a generic error shape — the client needs to distinguish this from "network failed"
or "auth failed" to route it to the right UI.

### Step 2 — Client: recognize and surface the conflict

In the sync logic (wherever OFFLINE-02's retry/stuck-item logic lives), catch the
`STOCK_CONFLICT` response specifically and mark the stuck `PendingSale` with this
sub-reason (plus the `available`/`requested` figures from the response) rather than the
generic stuck state.

### Step 3 — Resolution UI

Extend OFFLINE-06's status UI: a stuck item flagged as `STOCK_CONFLICT` shows the
cashier/manager the conflicting line, the currently-available quantity, and two actions:
adjust the queued sale to the available quantity and retry, or remove that line/cancel
the sale. Either path re-submits through the normal idempotent sync flow (same
`operationId` if adjusting, since it's still fundamentally the same queued transaction
being resolved — confirm this doesn't conflict with the "same ID = same original result"
dedup logic from OFFLINE-02; if adjusting the payload requires a new `operationId`
because the dedup logic would otherwise return the *stale* rejected result, use a new ID
and explicitly supersede/void the original stuck record).

### Step 4 — `invoices.version` optimistic lock

Wherever this resolution flow updates an existing invoice record (if it does — confirm
whether "adjust and retry" resubmits as a new sale attempt or updates an existing draft;
prefer resubmit-as-new if that avoids needing to touch invoice-update code at all), add
the `version` check if an update path is genuinely needed.

### OUT OF SCOPE
- Automatic partial fulfillment without cashier/manager confirmation (unless the client
  has explicitly requested this — confirm first)
- Conflict detection/resolution for anything other than stock (e.g. price changes
  between queue-time and sync-time) unless this phase's investigation finds that's a
  live concern worth the same treatment — if so, flag it as a finding for a follow-up
  rather than expanding this phase's scope silently
- A general-purpose merge/CRDT-style conflict resolution framework — this is a targeted fix for the one conflict type that actually occurs today (stock)

---

## TESTING REQUIREMENTS

1. A queued sale that fails sync due to insufficient stock returns a distinguishable `STOCK_CONFLICT` response, not a generic error
2. The client correctly routes a `STOCK_CONFLICT` stuck item to the resolution UI, showing accurate available/requested figures
3. Adjusting the quantity and retrying succeeds and results in exactly one invoice (idempotency preserved)
4. Cancelling the conflicting line/sale removes it from the pending queue with a clear record of what happened (for audit purposes)
5. A normal (non-conflicting) stuck item (e.g. a network-error stuck item) is unaffected by this new conflict-specific routing

---

## BUILD VERIFICATION

```bash
pnpm --filter @erp/sales-service build
pnpm --filter @erp/pos-frontend build
pnpm lint
pnpm type-check
pnpm test --filter @erp/sales-service --filter @erp/pos-frontend
```

---

## VERIFICATION CHECKLIST

- [ ] Stock-conflict sync failures are distinguishable from other failure types in the API response
- [ ] The resolution UI correctly shows available vs. requested quantity and offers adjust/cancel actions
- [ ] Both resolution paths preserve idempotency (no duplicate invoices)
- [ ] `invoices.version` is enforced wherever this flow updates an existing invoice, if applicable

---

## REGRESSION CHECKLIST

- [ ] Non-conflict stuck items (network/auth failures) are routed and handled exactly as before (OFFLINE-02/06 behavior unchanged)
- [ ] The existing atomic stock-check in `InvoiceService.ts` is untouched
- [ ] Normal online sale creation with insufficient stock still behaves as today (immediate error to the cashier, no change needed there)

---

## DEFINITION OF DONE

- [ ] Stock conflicts on offline-sale sync are detected, clearly surfaced, and resolvable without data corruption or duplicate invoices
- [ ] All new tests pass; regression suite green
- [ ] `pnpm lint` and `pnpm type-check` pass
- [ ] Completion report saved at `ERP-PLANNING/phase-completions/OFFLINE-07_COMPLETION.md`
- [ ] `ERP-PLANNING/reports/OFFLINE_FIRST_ROADMAP.md` updated to mark OFFLINE-07 complete

---

## COMPLETION REPORT TEMPLATE

**Save as:** `ERP-PLANNING/phase-completions/OFFLINE-07_COMPLETION.md`

```markdown
# OFFLINE-07 Completion Report — Conflict Detection & Resolution UX
**Date:** [YYYY-MM-DD]
**Status:** COMPLETE / PARTIAL

## What Changed
- Backend STOCK_CONFLICT error shape: [summary]
- Client resolution UI: [summary]
- invoices.version enforcement: [added at ... / not needed because ...]

## Files Changed
[Table]

## Tests: [N]/[N] PASS | lint: PASS | type-check: PASS | build: PASS

## Known Issues / Deferred
- Price-conflict handling (as opposed to stock) not addressed unless found to be a live concern — [state finding here]
```
