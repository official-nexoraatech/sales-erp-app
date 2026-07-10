# ES-24 — Event Architecture Integrity: Outbox, Inbox & Saga Orchestrator
## STATUS: ✅ COMPLETE (orchestrator + 1/9 sagas) — see phase-completions/ES-24_COMPLETION.md
## Sprint: 6 | Effort: 5–8 days | Risk: Critical (financial double-processing / silent event loss)
## Depends on: ES-02 (outbox relay), ES-23 (concurrency hardening — do after, not before, since both
##             touch accounting-service and you don't want to stack conflicting in-flight changes)
## Unlocks: any future phase relying on saga compensation actually working
## Source: `ERP-PLANNING/ARCHITECTURE_AUDIT_REPORT.md` findings C6, C7, H3, H11, M15, M16, M23

---

## YOUR ROLE

You are the **Principal Platform Engineer** on the NEXORAA Multi-Tenant Cloth Retail ERP, owning
the event-driven backbone (outbox, inbox, saga orchestration).

The 2026-07-03 architecture audit found that the **Golden Rule of the outbox pattern — "an event is
never published directly; it's written to `outbox_events` in the SAME transaction as the business
data" — is violated in accounting-service**, that the **inbox idempotency check has a
check-then-act race that lets a redelivered event be processed twice**, and that **the Saga
Orchestrator described in the architecture spec does not exist anywhere in the codebase** — the
admin "retry"/"compensate" buttons only change a status label and never re-execute or compensate
anything. This phase fixes the first two (data-correctness bugs) and builds the third (a
completeness gap the spec treats as mandatory).

**This is the highest-technical-difficulty phase in this remediation program. Budget real time for
it, and do not let scope creep into rewriting the outbox/inbox mechanism itself — both are correctly
built; you're fixing specific violations of the pattern, and adding the orchestrator that's missing
around them.**

---

## ═══════════════════════════════════════════
## PRE-FLIGHT CHECKLIST
## ═══════════════════════════════════════════

- [ ] Read `ERP-PLANNING/ARCHITECTURE_AUDIT_REPORT.md` §2 (C6, C7), §3 (H3, H11), §4 (M15, M16,
      M23)
- [ ] Read `ERP-PLANNING/ERP_MASTER_SPEC.md` §4.4 (Outbox), §4.5 (Inbox), §4.6 (Saga Orchestration
      — note the 9 sagas listed: INVOICE_CREATION, PURCHASE_GRN, STOCK_TRANSFER,
      PAYMENT_PROCESSING, PAYROLL_PROCESSING, YEAR_END_CLOSE, SALE_RETURN, CUSTOMER_MERGE,
      TENANT_CLOSE)
- [ ] Read `ERP-PLANNING/audit-phase-prompts/ES-02-OUTBOX-RELAY-ACCOUNTING.md` and its completion
      report
- [ ] Read `packages/platform-sdk/src/events.ts` in FULL — this is the core file for this phase.
      Study `PlatformEventBus.publish()` (line ~179-194, opens its own transaction),
      `publishInTransaction()` (line ~149-177, the transaction-aware variant that already exists
      and is correct), and `PlatformEventConsumer.subscribe()` (line ~229-264, the inbox TOCTOU bug)
- [ ] Read `apps/event-service/src/outbox/OutboxRelayWorker.ts` — confirmed correct
      (`FOR UPDATE SKIP LOCKED`, retry+DLQ) — do not modify unless a fix here specifically requires it
- [ ] Read `apps/event-service/src/api/saga.routes.ts` in full (lines ~154-184 especially) — the
      current fake retry/compensate endpoints you're replacing with real behavior
- [ ] Read `packages/db-client` schema for `saga_log` (find it under `src/schema/` — likely
      `distributed.ts` or similar) — understand the existing columns before adding an engine on top
- [ ] Read `apps/accounting-service/src/api/accounts.routes.ts:114-171` and
      `opening-balances.routes.ts:399-406` — the specific outbox-outside-transaction violations
- [ ] Read `apps/accounting-service/src/domain/JournalEngine.ts` `post`/`reverse` — the CORRECT
      pattern (single `db.transaction` wrapping both the business write and
      `publishInTransaction`) to copy for the Step 2 fix
- [ ] Read `apps/accounting-service/src/api/journal.routes.ts:128,161` and
      `apps/gst-service/src/**` (confirm zero `ctx.events`/outbox usage repo-wide via grep) for M15/M16
- [ ] Read `apps/accounting-service/src/api/accounts.routes.ts:177-198` (`DELETE`) for H11/M23
- [ ] Run `pnpm test --filter @erp/accounting-service --filter @erp/gst-service --filter
      @erp/event-service --filter @erp/sdk` — confirm a clean baseline

---

## ═══════════════════════════════════════════
## PROJECT CONTEXT
## ═══════════════════════════════════════════

### Why C6 matters
```typescript
// WRONG (current accounting-service accounts.routes.ts pattern):
await ctx.db.raw.insert(accounts).values(data);       // commits immediately, autocommit
await ctx.events.publish('ACCOUNT_CREATED', payload);  // opens its OWN separate transaction

// CORRECT (already used in JournalEngine.post):
await ctx.db.transaction(async (trx) => {
  await trx.insert(accounts).values(data);
  await eventBus.publishInTransaction(trx, 'ACCOUNT_CREATED', payload);
}); // one atomic commit — if the process dies mid-way, NEITHER happens, which is safe;
    // the old way could commit the account and lose the event forever.
```

### Why C7 matters
The inbox consumer currently does: SELECT (check PROCESSED) → INSERT with `onConflictDoNothing()`
→ unconditionally run `handler()`. The bug: it never checks whether ITS OWN insert actually won.
If two redeliveries race, the loser's insert silently no-ops (correct), but the loser still runs
`handler()` anyway (wrong) because it never checked. Fix: use `.returning()` on the insert and only
run `handler()` if a row was actually returned (i.e., this call's insert won the race).

### Saga scope reality check
Building all 9 sagas listed in the spec with full step/compensation logic is a multi-week effort on
its own and is **explicitly out of scope for this phase**. Your job is to build the **orchestrator
engine** (the reusable mechanism: step execution, state persistence to `saga_log`, compensation
triggering on failure, retry semantics) and wire it into **one** real saga end-to-end as a proof —
`INVOICE_CREATION` is the best choice since `apps/sales-service` already has the individual pieces
(stock deduction, accounting post, event publish) that a saga would orchestrate, per the chaos
report's Experiment 1.1 which already demonstrates compensation working for this exact flow at the
infrastructure level. The remaining 8 sagas are a follow-up phase — say so explicitly in your
completion report's "Known Issues / Deferred" section; do not claim this phase built all 9.

### Coding Standards
- TypeScript strict — no `any`
- No `console.log` — use `packages/logger`
- Every outbox/inbox change needs a test that proves the specific race is closed

---

## ═══════════════════════════════════════════
## OBJECTIVE
## ═══════════════════════════════════════════

1. **[C6]** Wrap accounting-service's account create/update and opening-balance-lock writes +
   their event publishes in a single transaction
2. **[C7]** Fix the inbox TOCTOU race so a redelivered event can never be processed twice
3. **[H3]** Build a real `SagaOrchestrator` and wire it into the `INVOICE_CREATION` saga end-to-end;
   make the admin retry/compensate endpoints actually do something
4. **[H11]** Implement the `DELETE /accounts/:id` financial-entries check that was left as a TODO
5. **[M15]** Emit domain events from manual journal posting/reversal
6. **[M16]** Add outbox event publishing to gst-service for e-invoice/e-way-bill generation
7. **[M23]** Add the missing `tenantId` predicate to the accounts DELETE query

---

## ═══════════════════════════════════════════
## SCOPE
## ═══════════════════════════════════════════

### Step 1 — Fix the inbox TOCTOU race [C7] (do this first — smallest, highest-value fix)

`packages/platform-sdk/src/events.ts:229-264` (`PlatformEventConsumer.subscribe`): change the
inbox-row insert to use `.returning()`, and only proceed to call `handler(event, trx)` if the
insert actually returned a row (meaning this call won any conflict). If the insert returns zero
rows (another transaction already claimed this `eventId`+`consumerService`), skip straight to
completion/ack without running the handler — this replaces the current SELECT-first check, which
raced.

### Step 2 — Fix accounting-service outbox violations [C6]

`apps/accounting-service/src/api/accounts.routes.ts:114-125` (POST) and `:151-171` (PUT): wrap the
insert/update and the `ctx.events.publish(...)` call in one `ctx.db.transaction(async (trx) => {
...trx.insert/update...; await eventBus.publishInTransaction(trx, ...); })`, matching
`JournalEngine.post`'s pattern exactly.

`apps/accounting-service/src/api/opening-balances.routes.ts:399-406` (POST lock): same fix.

Grep the rest of `apps/accounting-service/src/api/*.routes.ts` for any other `ctx.events.publish`
call that isn't inside a `ctx.db.transaction`/`trx` block — fix any additional instances found,
since the audit's spot-check may not have been exhaustive within this service.

### Step 3 — Build the Saga Orchestrator [H3]

New file: `packages/platform-sdk/src/saga.ts` (or `packages/platform-sdk/src/saga/` if it grows
into multiple files — match the existing package's file-organization convention, check whether
`events.ts` is a single file or a directory first).

Minimum viable engine, matching the spec's vocabulary (§4.6):
```typescript
interface SagaStepDefinition<TContext> {
  name: string;
  type: 'COMPENSATABLE' | 'RETRYABLE' | 'IRREVERSIBLE';
  execute: (ctx: TContext) => Promise<void>;
  compensate?: (ctx: TContext) => Promise<void>; // required if type === 'COMPENSATABLE'
}

class SagaOrchestrator {
  async run<TContext>(sagaType: string, sagaId: string, steps: SagaStepDefinition<TContext>[], ctx: TContext): Promise<void>;
  // persists each step's start/success/failure to saga_log as it goes
  // on a step failure: runs compensate() for all previously-succeeded COMPENSATABLE steps, in reverse order
  // IRREVERSIBLE step failure: do not attempt compensation of prior steps automatically — mark saga
  //   FAILED_NEEDS_MANUAL_REVIEW and leave a clear saga_log entry (matches spec's "trigger correction
  //   message + manual review ticket" note)
  async retry(sagaId: string): Promise<void>;      // re-runs from the last failed step, not from scratch
  async compensate(sagaId: string): Promise<void>; // manually triggers compensation from current state
}
```

Wire `apps/event-service/src/api/saga.routes.ts`'s `POST /admin/sagas/:id/retry` and
`/compensate` endpoints to actually call `orchestrator.retry(id)` / `.compensate(id)` instead of
just flipping a status column.

**Proof-of-concept saga:** refactor `apps/sales-service`'s invoice confirmation flow
(`InvoiceService.confirm()` or wherever stock deduction + accounting post + event publish
currently happens as ad hoc sequential calls) to run through `SagaOrchestrator.run('INVOICE_CREATION',
...)` with steps for: validate → deduct stock (COMPENSATABLE: restore stock) → post accounting
entry (COMPENSATABLE: reverse entry) → publish INVOICE_CONFIRMED event (IRREVERSIBLE once
published). Confirm this doesn't regress the existing chaos-engineering Experiment 1.1 behavior
(saga compensation on inventory-service kill during invoice confirm) — if anything, this should make
that experiment's PASS result backed by a real orchestrator instead of ad hoc error handling.

### Step 4 — Accounting correctness gaps [H11, M23]

`apps/accounting-service/src/api/accounts.routes.ts:177-198` (`DELETE`):
- Implement the TODO at line ~194: before soft-deleting, query `financial_entries` for any row
  referencing this account; if any exist, reject with a clear `BusinessError` (e.g.
  `ACCOUNT_HAS_TRANSACTIONS`).
- Add `eq(accounts.tenantId, tenantId)` to the WHERE clause, matching every other mutation in this
  file.

### Step 5 — Missing domain events [M15, M16]

`apps/accounting-service/src/domain/JournalEngine.ts` (`post`, `reverse`) and their callers in
`apps/accounting-service/src/api/journal.routes.ts:128,161`: publish `JOURNAL_POSTED` /
`JOURNAL_REVERSED` events inside the same `db.transaction` the journal write already uses, via
`publishInTransaction`.

`apps/gst-service`: add outbox event publishing for e-invoice generation
(`apps/gst-service/src/api/einvoice.routes.ts`) and e-way bill generation
(`eway-bill.routes.ts:82-87`) — e.g. `EINVOICE_GENERATED` / `EWAY_BILL_GENERATED` — in the same
transaction as whatever DB write currently happens alongside the `ctx.audit.log(...)` call. Keep
the existing audit-log call; add the event publish alongside it, don't replace it.

### OUT OF SCOPE
- Building out the other 8 sagas listed in the spec (PURCHASE_GRN, STOCK_TRANSFER,
  PAYMENT_PROCESSING, PAYROLL_PROCESSING, YEAR_END_CLOSE, SALE_RETURN, CUSTOMER_MERGE,
  TENANT_CLOSE) — orchestrator + one proof saga only
- Any change to `OutboxRelayWorker.ts` itself (already correct)
- A UI for saga monitoring beyond what `saga.routes.ts` already exposes

---

## ═══════════════════════════════════════════
## TESTING REQUIREMENTS
## ═══════════════════════════════════════════

1. **Inbox race**: two concurrent consumer calls with the same `eventId` — assert `handler()` runs
   exactly once (mock/spy the handler and assert call count)
2. **Outbox atomicity**: simulate a failure between the account insert and the event publish (e.g.
   throw inside a test double for `publishInTransaction`) — assert the account insert is ALSO
   rolled back (proving they're now one transaction)
3. **Saga happy path**: `INVOICE_CREATION` saga runs all steps successfully, `saga_log` shows
   COMPLETED with all step records
4. **Saga compensation**: force a failure at the accounting-post step (mock it to throw) — assert
   the stock-deduction step's `compensate()` actually runs (stock is restored), matching what the
   chaos report's Experiment 1.1 already validates at the infra level, but now provably driven by
   the orchestrator's logic in a unit/integration test
5. **Saga retry**: force a failure, call `orchestrator.retry(sagaId)`, assert it resumes from the
   failed step rather than re-running already-succeeded steps
6. `DELETE /accounts/:id` with existing `financial_entries` → rejected; without → succeeds
7. `JOURNAL_POSTED`/`JOURNAL_REVERSED` events appear in `outbox_events` after a journal post/reverse
8. `EINVOICE_GENERATED`/`EWAY_BILL_GENERATED` events appear in `outbox_events` after generation

---

## ═══════════════════════════════════════════
## BUILD VERIFICATION
## ═══════════════════════════════════════════

```bash
pnpm --filter @erp/sdk build
pnpm --filter @erp/accounting-service build
pnpm --filter @erp/gst-service build
pnpm --filter @erp/event-service build
pnpm --filter @erp/sales-service build
pnpm lint
pnpm type-check
pnpm test --filter @erp/sdk --filter @erp/accounting-service --filter @erp/gst-service --filter @erp/event-service --filter @erp/sales-service
```

---

## ═══════════════════════════════════════════
## VERIFICATION CHECKLIST
## ═══════════════════════════════════════════

- [ ] A redelivered Kafka event (simulated in test) is processed exactly once
- [ ] Account create/update and opening-balance-lock are atomic with their event publish (proven
      by the rollback test)
- [ ] `SagaOrchestrator` exists, is used by `INVOICE_CREATION`, and `saga.routes.ts`'s retry/
      compensate endpoints actually invoke it
- [ ] Deleting an account with financial entries is rejected; without, it succeeds
- [ ] Journal post/reverse and GST e-invoice/e-way-bill generation now write outbox events
- [ ] `pnpm lint` and `pnpm type-check` pass

---

## ═══════════════════════════════════════════
## REGRESSION CHECKLIST
## ═══════════════════════════════════════════

- [ ] Chaos-engineering Experiment 1.1 (kill inventory-service during invoice confirm) behavior is
      preserved or improved — re-run manually against the local stack if available and record the
      result
- [ ] Chaos-engineering Experiment 3.3 (Kafka down → outbox accumulates → resumes) is unaffected —
      you didn't touch `OutboxRelayWorker.ts`
- [ ] Existing account CRUD (create/update/list/get) still works normally
- [ ] ES-02's outbox relay accounting integration is unaffected outside the specific routes you
      changed
- [ ] Normal (non-failure) invoice creation still completes successfully through the new saga path

---

## ═══════════════════════════════════════════
## DEFINITION OF DONE
## ═══════════════════════════════════════════

- [ ] C6, C7, H3 (orchestrator + one proof saga), H11, M15, M16, M23 all closed per the fixes above
- [ ] All new tests pass; regression suite green
- [ ] `pnpm lint` and `pnpm type-check` pass repo-wide
- [ ] Completion report saved at `ERP-PLANNING/phase-completions/ES-24_COMPLETION.md`, explicitly
      listing the 8 sagas NOT yet built as follow-up work
- [ ] `ERP-PLANNING/ARCHITECTURE_AUDIT_REPORT.md` updated: mark C6, C7, H3 (partial — orchestrator
      exists, 1/9 sagas wired), H11, M15, M16, M23 with current status and a pointer to the
      completion report

---

## ═══════════════════════════════════════════
## COMPLETION REPORT TEMPLATE
## ═══════════════════════════════════════════

**Save as:** `ERP-PLANNING/phase-completions/ES-24_COMPLETION.md`

```markdown
# ES-24 Completion Report — Event Architecture Integrity
**Date:** [YYYY-MM-DD]
**Status:** COMPLETE (orchestrator + 1/9 sagas) / PARTIAL

## Findings Closed
| ID | Finding | Fix Summary | Verified By |
|---|---|---|---|
| C6 | Outbox writes outside transaction | Wrapped in db.transaction + publishInTransaction | rollback test |
| C7 | Inbox TOCTOU race | .returning()-gated handler execution | concurrency test |
| H3 | No SagaOrchestrator | Built engine; wired INVOICE_CREATION | saga tests |
| H11 | DELETE account no financial_entries check | Implemented TODO | test |
| M15 | Journal post/reverse no events | JOURNAL_POSTED/REVERSED added | test |
| M16 | gst-service no events | EINVOICE_GENERATED/EWAY_BILL_GENERATED added | test |
| M23 | DELETE account missing tenantId filter | Added | manual review |

## Saga Orchestrator
- Location: [file]
- Sagas wired: INVOICE_CREATION only
- Sagas NOT yet built (follow-up): PURCHASE_GRN, STOCK_TRANSFER, PAYMENT_PROCESSING,
  PAYROLL_PROCESSING, YEAR_END_CLOSE, SALE_RETURN, CUSTOMER_MERGE, TENANT_CLOSE

## Files Changed
[Table]

## Tests: [N]/[N] PASS | lint: PASS | type-check: PASS | build: PASS

## Chaos Re-verification
Experiment 1.1 (inventory-service kill during invoice confirm): [PASS/FAIL + notes]

## Known Issues / Deferred
- 8 remaining sagas are specified but not implemented — recommend a dedicated ES-2X phase per
  saga or a batched follow-up phase
```
