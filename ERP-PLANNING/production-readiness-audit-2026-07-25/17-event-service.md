# Event Service — Production Readiness Audit (2026-07-25)

Scope: `apps/event-service` backend (outbox relay, saga orchestration engine, event store,
schema registry, DLQ admin console) plus its dependency on the shared consumer/producer code
in `packages/platform-sdk/src/events.ts` and `saga.ts`. Frontend admin pages are out of scope
(separate audits). All findings below are live-verified against the running stack (gateway
:3000, event-service :3023, Postgres via `docker exec erp-postgres-primary psql`) unless
explicitly marked as code-inspection-only.

## Summary

The outbox pattern itself — event-service's actual job — works correctly and was
live-verified end-to-end (created a real `BRANCH_CREATED` event, watched it land in
`outbox_events`, get relayed to Kafka, and marked `published=true` inside the worker's
500ms poll window). RBAC on every admin surface (DLQ, Saga, Schema Registry, Projections) is
correctly enforced live. The `INVOICE_CREATION` saga is real and has genuinely compensated 6
times on stock-insufficiency errors with an intact step history.

However, this session's central question — whether event-service's DLQ/outbox monitoring
(claimed "fixed" 2026-07-23) actually catches the consumer-side failures found in today's
sibling audits — has a definitive **no**. The DLQ (`dlq_items` table) and the outbox-relay
health endpoint only ever see failures on the _publish_ leg (event-service's own Kafka
producer). They are structurally blind to _consume_-leg failures in the other five services
(accounting, gst, sales, scheduler, search) that use `PlatformEventConsumer` from
`packages/platform-sdk/src/events.ts` — a completely different, disconnected table
(`inbox_events`) whose own failure-recording write is provably broken. Live query:
`dlq_items` has **zero rows, ever**, and `inbox_events` has **zero `FAILED` rows out of 2,218
processed**, despite sibling audits today proving real handler failures occurred (e.g.
accounting-service's provably-failed GRN/payment postings). The 2026-07-23 "DLQ is now
visible" fix genuinely fixed outbox-relay dead letters; it did nothing for, and cannot see,
inbox/consumer dead letters — which per this session's sibling audits are the more common and
more severe failure class.

Two more real gaps: the saga admin retry/compensate API is non-functional for the only saga
type with real production data (`INVOICE_CREATION`, 64 rows) because no process in the entire
codebase registers a step factory for that saga type. And the migration bookkeeping backlog
flagged 2026-07-23 has grown, not shrunk (88 applied / 104 files on disk now, vs 88/102 then) —
confirmed to be a bookkeeping/audit-trail problem only, not live schema drift (spot-checked
columns/tables from migrations 0091–0102 are all present in the live DB).

## THE CRITICAL ARCHITECTURAL QUESTION — answered

**Does event-service's DLQ actually catch the consumer-side failures found in sibling audits
today, or are they invisible to it?**

**They are invisible to it, by construction — this is not a bug in event-service's DLQ code,
it's an architectural gap: the DLQ and the inbox are two unrelated systems that happen to share
an admin service.**

Evidence:

1. **`dlq_items` is populated by exactly one writer**: `OutboxRelayWorker.processBatch()`
   (`apps/event-service/src/outbox/OutboxRelayWorker.ts:189`), which inserts a row only when
   its own Kafka `producer.send()` fails `maxRetryAttempts` (5) times in a row. This is the
   _publish_ leg — event-service relaying its own outbox table to Kafka. Live query:

   ```
   SELECT topic, status, count(*) FROM dlq_items GROUP BY topic, status;   → 0 rows
   ```

   Live query: `outbox_events` currently shows 569 published / 0 failed — the publish leg is
   healthy, which is _why_ DLQ is empty, not because nothing has ever failed anywhere.

2. **Consumer-side (inbox) failures never reach `dlq_items` at all** — there is no code path
   from `PlatformEventConsumer`'s catch block to the `dlq_items` table. Its only DB write on
   failure is a bare `UPDATE inbox_events SET status='FAILED' ... WHERE eventId=... AND
consumerService=...` (`packages/platform-sdk/src/events.ts:213-221`), issued via `db.raw`
   **after** the enclosing `db.transaction(trx => {...})` block has already thrown and rolled
   back. That transaction is what inserted the `PROCESSING` claim row in the first place
   (line 176-189) — so on rollback, the row the subsequent `UPDATE` is trying to match no
   longer exists, and the `UPDATE` silently matches 0 rows. Postgres does not error on a
   0-row `UPDATE`. The only surviving trace of the failure is a single `stderr` log line
   (line 207-209) — no DB row, no metric, no admin-visible signal.

3. **Live confirmation this is really happening in this DB, right now**:

   ```
   SELECT status, count(*) FROM inbox_events GROUP BY status;
   →  PROCESSED | 2218        (zero FAILED rows)

   SELECT consumer_service, status, count(*) FROM inbox_events GROUP BY 1,2;
   →  accounting-service | PROCESSED | 142
      gst-service        | PROCESSED | 73
      sales-service      | PROCESSED | 41
      scheduler-service  | PROCESSED | 733
      search-service     | PROCESSED | 1229
   ```

   This exactly reproduces the pattern the accounting-service sibling audit found today (0
   FAILED rows despite provably-failed handlers) — and shows it is not accounting-service-
   specific, it is universal to every one of the 5 services using `PlatformEventConsumer`
   (confirmed via `grep -l "new PlatformEventConsumer"` across `apps/*/src/main.ts`:
   search-service, scheduler-service, gst-service, accounting-service, sales-service — exactly
   the 5 `consumer_service` values seen above).

4. **event-service itself has zero `PlatformEventConsumer` usages** (grepped its own `src/` —
   no matches). It is not itself vulnerable to the rollback bug for its own processing, because
   it does no Kafka consumption of its own — it only publishes (`OutboxRelayWorker`), reads
   other services' tables for admin display (`dlq_items`, `saga_log`, `event_store`,
   `projection_metadata`), and drives the GST-compliance saga via plain HTTP calls to
   gst-service (`apps/event-service/src/sagas/gstComplianceProxy.ts`), not Kafka.

**Conclusion**: event-service's admin DLQ console is working exactly as coded, and the
2026-07-23 fix that populated it was a real, correct fix — for outbox-relay dead letters only.
But it created false confidence: an operator watching that console today would see "0 dead
letters" and reasonably conclude the platform's event pipeline is healthy, while the actual
failures sibling audits found today (consumer-side handler failures in 5 downstream services)
are completely invisible to it and always will be until `packages/platform-sdk/src/events.ts`
either (a) writes its FAILED status inside the same transaction scope that can commit
independently of the handler's rollback (e.g. a separate short transaction, not `db.raw`
issued post-rollback against a row that no longer exists), or (b) routes consumer-side failures
into `dlq_items` as a second writer, giving the existing admin UI/API a single place to see
both failure classes. This is a shared-code fix (`platform-sdk`), not something event-service's
own code can fix in isolation — but event-service's admin console is the only place an operator
would ever look for it, and it will keep reporting a false "all healthy" story until then.

## What works (verified live)

- **Outbox publish path**: created `Audit Test Branch <ts>` via `POST /api/tenant/branches`,
  confirmed a new `outbox_events` row (id 2472, `BRANCH_CREATED`) appeared and was
  `published=true` within the worker's poll window (<2s). `GET /health/outbox` correctly
  reflected the new `lastPublishedAt` timestamp immediately after.
- **Outbox retry/backoff/dead-letter-on-publish-failure logic**: code-reviewed, well-designed
  — exponential backoff (`retryBaseDelayMs * 2^n`, capped 5 min), `FOR UPDATE SKIP LOCKED`
  batch claim released before the Kafka network call (correct for PgBouncer transaction-mode
  pools), Prometheus gauges (`erpOutboxPendingCount`, `erpDlqDepth`) refreshed every poll tick.
- **RBAC on all four admin route groups**, live-verified with a real STAFF-role JWT (which has
  none of the `DLQ_VIEW`/`SAGA_VIEW`/`SCHEMA_REGISTRY_VIEW` permissions):
  `GET /admin/dlq/summary`, `GET /admin/sagas/summary`, `GET /schema-registry/catalog` all
  correctly returned `403 FORBIDDEN`. `role-defaults.ts` grants view-only DLQ/Saga/Schema
  permissions to ACCOUNTANT_SUPERVISOR/AUDITOR-class roles and full `*_MANAGE` only to
  OWNER/ADMIN (via the `TENANT_SCOPED_PERMISSIONS` blanket grant) — correctly scoped.
- **`INVOICE_CREATION` saga actually runs and actually compensates**: live query on
  `saga_log` shows 63 real rows this environment has produced (58 `COMPLETED`, 6
  `COMPENSATED`), with intact step history, e.g. saga `01KYB3B7Q6BSB58K9KSM87YKMT` correctly
  recorded `confirmInvoiceTransaction` FAILED with `"Item 44 has only 0 units available"` and
  transitioned to `COMPENSATED`. This is more sagas than ES-24 (2026-07-23) had on record,
  confirming the mechanism is live and being exercised by real traffic, not just a
  proof-of-concept that never runs.
- **Event Store write path is real and populated** (previously flagged empty
  2026-07-13, confirmed fixed by 2026-07-16 per e2e spec comments, re-confirmed here): live
  query shows 37 rows in `event_store`, written from `InvoiceService`/`PaymentService` in
  sales-service via `EventStoreService.append()`.
- **Schema Registry compatibility engine is real**, not just a stub — `POST
/schema-registry/schemas/:type/check` runs genuine BACKWARD/FORWARD/FULL diffing and returns
  422 `SCHEMA_INCOMPATIBLE` on violations (code-reviewed; catalog shows a real v1→v2
  `INVOICE_CONFIRMED` evolution adding `branchId`/`metadata` under `BACKWARD` mode).
- **Saga orchestrator engine's core semantics** (`packages/platform-sdk/src/saga.ts`) are
  sound: RETRYABLE/COMPENSATABLE/IRREVERSIBLE step typing, reverse-order compensation on
  failure, `COMPENSATION_FAILED` distinct from `COMPENSATED` so a partially-failed rollback
  doesn't lie about its own success, full persisted step history for audit.

## Other bugs/gaps found

1. **HIGH — Saga admin retry/compensate is non-functional for the only saga type with real
   data.** `SagaOrchestrator.retry()`/`.compensate()` require a registered step factory for the
   saga's `sagaType` (`packages/platform-sdk/src/saga.ts:97-100, 119-122`). event-service's own
   registered orchestrator (`apps/event-service/src/sagas/gstComplianceProxy.ts`) registers only
   `GST_COMPLIANCE_SAGA_TYPE` — which has **zero rows ever** in `saga_log` (never exercised in
   this environment). The 64 real `INVOICE_CREATION` sagas were all started by sales-service
   creating a fresh `new SagaOrchestrator(this.db)` per call
   (`apps/sales-service/src/domain/InvoiceService.ts:417`) with **no `.register()` call
   anywhere** — not in sales-service, not in event-service, not anywhere in the codebase
   (grepped `INVOICE_CREATION` + `SagaOrchestrator` across `apps/`). So `POST
/admin/sagas/:id/retry` or `/compensate` on any real `INVOICE_CREATION` saga would throw
   `SAGA_TYPE_NOT_REGISTERED` (confirmed via code path, not live-executed — a mutating call
   against real saga rows was blocked by this session's tool sandbox policy). Business impact
   is softened by a deliberate design choice documented in-code (`InvoiceService.ts:403-415`):
   `confirmInTransaction` is one atomic Postgres transaction, so there's genuinely nothing
   partial for compensation to undo — but the admin UI's Retry/Compensate buttons would still
   present a confusing hard failure to an operator for the one saga type they're most likely to
   click it on.
2. **MEDIUM — Migration bookkeeping backlog persists and has grown.**
   `drizzle.__drizzle_migrations` has 88 rows; 104 `.sql` files exist in
   `packages/db-client/migrations/` (0000–0103) — 16 unapplied per the journal, up from the
   "88/102" (14 unapplied) figure recorded 2026-07-23. Spot-checked that this is bookkeeping
   drift, not schema drift: `outbox_events.next_retry_at` (migration 0102),
   `purchase_requisitions`/`rfqs`/`purchase_invoices`/`supplier_rating` tables (migrations
   0091-0095) all exist live in the DB — meaning migrations are being applied out-of-band
   (hand-run SQL) without updating the tracking table, consistent with the
   `db_migration_bookkeeping_broken` pattern noted in project memory. Risk: a fresh-environment
   bootstrap via the standard `drizzle-kit migrate` tooling cannot be trusted to reflect what's
   actually been applied to this DB, and the gap is widening each session rather than closing.
3. **LOW/MEDIUM — Schema Registry is enforced nowhere except its own manual-check API.**
   `SchemaRegistry` (from `@erp/sdk`) is instantiated only inside
   `apps/event-service/src/api/schema-registry.routes.ts` — grepped the entire `apps/` tree,
   no other file references it. Neither `PlatformEventBus.publishInTransaction()` nor
   `PlatformEventConsumer`'s message handling ever calls it. So the compatibility engine (item
   verified above as "real") never actually gates real event traffic — an incompatible payload
   shape can be published and consumed freely; only a human manually calling the check/register
   endpoint would ever see a rejection. It is, in the audit prompt's own framing, a passive
   catalog with an unused enforcement engine bolted on. Also cosmetic: the live catalog has 7
   leftover `QA_E2E_TEST_EVENT_<timestamp>` entries with empty `{required:[],properties:{}}`
   schemas from prior test sessions, still present — no environment/session isolation on this
   table.
4. **LOW — Event Store coverage is narrow.** Only `InvoiceService`/`PaymentService` in
   sales-service ever call `EventStoreService.append()`. None of the other 14 services do. The
   admin Event Store page will only ever surface invoice/payment lifecycle events — reasonable
   as a scoped implementation, but worth knowing it is not a general-purpose event-sourcing
   store for the platform, contrary to what "Event Store" as a page name implies.

## Untested/unknown areas

- `PLATFORM_OPERATOR`'s specific grants for DLQ/Saga/Schema/Event-Store/Projection permissions
  were not traced or live-tested (role-defaults.ts has no explicit `PLATFORM_OPERATOR:` block
  found by name search — it's likely seeded separately per a migration comment referencing
  `0020_es21_platform_operator.sql`); ran out of scope budget to chase this down.
- `POST /admin/dlq/:topic/replay` and `/discard` were code-reviewed only — `dlq_items` is
  empty in this environment so there was nothing to exercise them against live. Their own unit
  tests (`dlq-replay.test.ts`) are currently all failing on the pre-existing JWT-issuer
  test-infra issue (see Tests below), so they are not independently test-verified right now
  either.
- Projection rebuild's BullMQ enqueue → scheduler-service consumption handoff (PG-008) was
  read but not live-triggered end-to-end.
- `GST_COMPLIANCE_SAGA_TYPE` has never run in this environment (0 rows in `saga_log`) — its
  correctness under real NIC-integration failure conditions is completely unverified live.
- Did not attempt to independently reproduce a live consumer-handler crash against a real
  Kafka topic in this session to re-derive the rollback bug from first principles beyond the DB
  count evidence above — treated as already conclusively demonstrated by today's sibling
  accounting-service audit and corroborated here via the identical DB pattern across all 5
  consumer services.

## Tests

`pnpm --filter @erp/event-service test`: **1 file passed / 3 files failed, 1 test passed / 27
failed / 3 skipped.**

- `outbox-relay.test.ts` — passed (4 tests, 3 skipped) — this suite doesn't go through HTTP
  auth, it exercises `OutboxRelayWorker` directly.
- `dlq-replay.test.ts`, `projections-rebuild.test.ts`, `permission-granularity.test.ts` — all
  27 failures are `expected <intended-status> to be 401` (or `401 not to be 401`), i.e. every
  request the tests fire is bounced at the authenticate hook before it ever reaches the
  permission check or handler logic under test. This matches the known pre-existing
  JWT-issuer test-infra 401-vs-403 issue called out in the audit brief — not a real application
  bug, but it does mean `permission-granularity.test.ts` (which is specifically supposed to
  prove the DLQ/Saga/Schema/Projection/Event-Store/Performance permission boundaries are
  correct) is currently providing **zero actual coverage** of that claim in CI. The live manual
  RBAC check against a real STAFF JWT (see "What works") is the only current evidence those
  boundaries hold.

## Readiness score: 58/100

**Justification.** The parts event-service directly owns and controls — the outbox relay
worker — are solid and live-verified working correctly, including its own dead-letter path.
RBAC is correctly enforced everywhere it was checked. The saga _engine_ is well-built and the
one saga type with real traffic (`INVOICE_CREATION`) is genuinely running and genuinely
compensating in production-like conditions. Those are real, working foundations.

But the score is held down hard by the critical finding: the DLQ console — event-service's
flagship reliability feature, the thing an operator would open first after an incident — cannot
see the failure class that today's sibling audits proved is actually happening across 5 other
services, and will report "0 dead letters, all healthy" indefinitely regardless of how many
consumer-side handlers are silently failing platform-wide. That is worse than an empty DLQ with
no claims made about it — it's a monitoring surface that actively signals false confidence,
because the same table (`dlq_items`) is genuinely, correctly populated for its narrower purpose
(outbox-publish failures), so it looks trustworthy. Stacked on top: the saga retry/compensate
admin action is provably broken for the only saga type anyone would ever click it on, and the
migration-tracking backlog that was flagged as a concern two days ago has gotten worse, not
better. Schema Registry's real compatibility engine gates nothing in the actual event path,
which is a smaller but real gap between what the feature name promises and what it does. None
of this is data-corrupting today (schema itself is intact; the outbox path that carries real
business events is healthy), but it is a readiness-blocking gap in the platform's actual
observability of its own failure modes — which is the entire point of this module.
