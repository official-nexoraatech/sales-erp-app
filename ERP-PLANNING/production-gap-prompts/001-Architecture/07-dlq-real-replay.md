# [PG-007] DLQ Real Kafka Replay

> Template version 1.0. Every gap-prompt file in this tree must follow this exact section order. Do not add sections; do not omit sections that apply. If a section genuinely does not apply to this gap, write "Not applicable — <one-line reason>" instead of deleting it, so the structure stays diffable across files.

**Category:** Architecture
**Priority:** Critical
**Complexity:** S — one route handler, one new producer method on an existing class, no schema change, no new dependency
**Depends on:** none
**Blocks:** none
**Primary service(s)/package(s):** apps/event-service (`api/dlq.routes.ts`, `outbox/OutboxRelayWorker.ts`, `main.ts`)

---

## Overview

- **Business objective:** the admin Dead-Letter Queue console (`apps/web-frontend/src/pages/admin/distributed/DLQPage.tsx`) lets an operator click "Replay All Pending" for a topic, and the UI genuinely believes this re-delivers the failed messages — it shows a `REPLAYED` count and a success toast ("All PENDING items queued for replay"). Today that action is a lie: it flips a database column and nothing is re-published to Kafka. Any tenant-visible business event that dead-lettered (e.g. a failed notification dispatch, a failed search-index sync) is **permanently lost** the moment an operator clicks Replay, because the row is marked `REPLAYED` — meaning "handled, do not show again" — even though the downstream consumer that needed it never received it a second time.
- **Current implementation:** `apps/event-service/src/api/dlq.routes.ts`, `POST /admin/dlq/:topic/replay` (lines 111-135): selects all `dlqItems` rows for the topic with `status = 'PENDING'`, then does exactly one thing —
  ```ts
  // Mark as REPLAYED (in a real system, would re-publish to Kafka)
  if (pending.length > 0) {
    await db.update(dlqItems).set({ status: 'REPLAYED', lastRetriedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(dlqItems.topic, topic), eq(dlqItems.status, 'PENDING')));
  }
  ```
  The comment on the line above the update is the gap, verbatim, in the shipped code.
- **Current architecture:** `dlqItems` (`packages/db-client/src/schema/distributed.ts:66-91`) already stores everything needed to actually replay a message: `topic`, `payload` (jsonb), `headers` (jsonb, defaults `{}`), `retryCount`, `status`. The only Kafka producer instance in `event-service` today lives inside `OutboxRelayWorker` (`apps/event-service/src/outbox/OutboxRelayWorker.ts`), constructed and connected in its `start()` method (line 59-60) and kept as a private field (`private producer: Producer | null`). `dlq.routes.ts` has no reference to this producer or to any other Kafka client — it only receives `ctxFactory` from `main.ts` (`await dlqRoutes(sub, ctxFactory)`, `main.ts:91`).
- **Current limitations:** there is no code path anywhere in `event-service` by which the DLQ replay handler could publish to Kafka even if it wanted to — the producer is private to a sibling class that the route never sees. This is a wiring gap, not a design gap: the outbox relay's producer connection is the correct thing to reuse (same client ID conventions, same broker list, already connected and kept alive for the process lifetime), it just was never exposed.

## Existing Code Analysis

- **What already exists and should be reused:** `OutboxRelayWorker`'s already-connected `Producer` instance (`kafkajs`, `Partitioners.LegacyPartitioner`, matching every other Kafka producer in this codebase) — do not create a second, independent Kafka client just for DLQ replay; that would double the connection count for no benefit and risk broker-list/clientId drift between the two. The existing `dlqItems` schema and its `topic`/`payload`/`headers` columns — no new column needed, they were clearly designed for this from the start (M12.4 comment in the schema file).
- **What should never be modified:** the `GET /admin/dlq/summary`, `/admin/dlq/:topic`, `/admin/dlq/:topic/:id`, and `POST /admin/dlq/:id/discard` handlers in `dlq.routes.ts` are correct as-is and out of scope — only the `POST /admin/dlq/:topic/replay` handler's body changes. `OutboxRelayWorker`'s existing `start()`/`stop()`/`processBatch()`/`getQueueDepth()` logic must not be altered — only a new public method is added alongside them.
- **Prior related work:** none specific to DLQ replay; `[[outbox_payload_truncation_pattern]]` in project memory documents a related-but-distinct gap (producers writing fewer fields than consumers read) worth checking on this same DLQ payload path if it's ever touched again, but is not itself part of this fix.

## Architecture

- Add a public method to `OutboxRelayWorker`: `async publishRaw(topic: string, key: string, value: Record<string, unknown>, headers: Record<string, string>): Promise<void>` that sends one message via the worker's already-connected `this.producer` (throwing if the worker hasn't been `start()`-ed yet — `event-service`'s `main.ts` always starts the worker before the HTTP server accepts admin traffic in practice, but the method should defensively check `if (!this.producer) throw new Error('OutboxRelayWorker not started')` rather than assume). This is the smallest possible surface change: one method, no new class, no new connection.
- Pass the already-constructed `worker` instance into `dlqRoutes(sub, ctxFactory, worker)` from `main.ts` (mirrors how `healthOutboxRoutes(fastify, worker)` already receives it on line 86 — same pattern, same file, immediately adjacent).
- `POST /admin/dlq/:topic/replay` becomes: select `PENDING` rows for the topic (unchanged) → for each row, call `worker.publishRaw(row.topic, String(row.id), row.payload, row.headers as Record<string,string>)` → on success, update that row's status to `REPLAYED` (unchanged column) → on a per-row publish failure, leave that row `PENDING` (do not mark it replayed) and increment its `retryCount`, so a partial-batch Kafka outage doesn't silently lose the still-unpublished remainder. This mirrors `OutboxRelayWorker.processBatch()`'s own per-row try/catch pattern (`OutboxRelayWorker.ts:107-167`) rather than inventing a new error-handling shape.
- Response shape changes from `{ replayed: pending.length, topic }` (previously always "true" regardless of what happened) to `{ replayed: <actually succeeded count>, failed: <count still PENDING>, topic }` — the UI's existing `totalReplayed` sum (`DLQPage.tsx:55`) continues to work unchanged since it still reads a `replayed` number, just now an honest one.

## Database Changes

Not applicable — no schema change. `dlqItems.payload`/`.headers`/`.topic` already exist and already contain what a real replay needs.

## Backend

- **Files to modify:** `apps/event-service/src/outbox/OutboxRelayWorker.ts` (add `publishRaw`), `apps/event-service/src/api/dlq.routes.ts` (rewrite the replay handler body, change its signature to accept `worker: OutboxRelayWorker`), `apps/event-service/src/main.ts` (pass `worker` into `dlqRoutes(sub, ctxFactory, worker)`).
- **Events/Kafka:** no new topics — replay publishes to the exact topic already stored on the DLQ row (the same topic the message originally failed on).
- **Validation/authorization:** unchanged — route stays gated on `PERMISSIONS.AUDIT_LOG_VIEW` per existing convention (see Security section for the same PG-015 cross-reference noted in PG-006).
- **Idempotency:** replaying a message re-publishes it to Kafka with the same key it originally had context for (`String(row.id)` as a stand-in partition key — acceptable since the goal is redelivery, not exact-original-ordering guarantees); downstream consumers must already be idempotent for their own retry/redelivery handling (this is a pre-existing expectation of the outbox pattern generally, not new to this fix) — do not add new consumer-side dedup logic as part of this package, that is out of scope.
- **Telemetry:** log a `warn` (not `error`) for any row that fails to republish and stays `PENDING`, matching `OutboxRelayWorker`'s own logging conventions (`createLogger({ serviceName: 'event-service' })`), so a partial-replay failure is visible in existing log aggregation without needing a new alert.

## Frontend

- Not applicable — `DLQPage.tsx`'s existing mutation (`dlqApi.replay(topic)`, line 66) and its success/error toasts require no change; the response shape addition (`failed` count) is additive and can be silently ignored by the current UI, or surfaced in a later, separate UI polish package if desired (not required for this fix to be correct).

## API Contract

- `POST /admin/dlq/:topic/replay` (unchanged path/method) → `200 { data: { replayed: number, failed: number, topic: string } }` (previously `{ replayed: number, topic: string }` where `replayed` was always `pending.length` regardless of outcome). No new error codes — a total Kafka outage during replay surfaces as `replayed: 0, failed: <n>` in a `200`, not a `5xx`, consistent with the route's existing all-or-partial-success shape (the route itself doesn't fail; individual message publishes might).

## Multi-Tenant Considerations

- `dlqItems.tenantId` is nullable today (`packages/db-client/src/schema/distributed.ts:81` — `tenantId: integer('tenant_id')`, no `.notNull()`), meaning some DLQ rows may be cross-tenant infrastructure events rather than tenant-scoped business events; this fix does not change that — it republishes whatever tenant context was already stored in the row's `payload`/`headers` at the time it dead-lettered, unchanged. No new tenant-scoping logic is needed since replay is purely republishing already-persisted data, not generating new business data.

## Integration

- **event-service only** — this is entirely self-contained; no other service's code changes. Downstream consumers of the replayed topic (accounting-service, gst-service, search-service, notification-service — whichever originally subscribed to that topic) receive the redelivered message exactly as if it had been published the first time; no changes needed on their side since Kafka consumption is already the existing contract.

## Coding Standards

- Reuses the existing `kafkajs` `Producer` and its existing connection/lifecycle management inside `OutboxRelayWorker` — does not introduce a second Kafka client, a new producer library, or a new retry/backoff mechanism (the existing per-row try/catch pattern in `processBatch()` is copied, not reinvented).

## Performance

- Negligible — replay volume is operator-triggered and bounded by DLQ depth for one topic at a time (already paginated for viewing, `PaginationSchema` in `dlq.routes.ts`); the "replay all pending for a topic" action itself isn't currently paginated (matches the existing handler's behavior — pulls all `PENDING` rows for the topic in one query), which is acceptable at this codebase's current DLQ volumes but should be revisited (batch it) if the same page ever shows DLQ depths in the thousands. Flagging, not fixing, since it is a pre-existing characteristic of the route, not something this fix introduces.

## Security

- No new permission surface — the fix doesn't touch authorization, and the existing `AUDIT_LOG_VIEW` gate is unchanged. Same PG-015 cross-reference as PG-006/PG-008: this route's permission constant is a known mismatch against the dedicated `DLQ_VIEW`/`DLQ_MANAGE` constants that already exist in `packages/shared-types/src/permissions.ts:377-378` — out of scope here to avoid overlapping two Critical-priority packages' diffs.

## Testing

- New tests in `apps/event-service/src/__tests__/` (a new `dlq-replay.test.ts`, alongside the existing `outbox-relay.test.ts`): mock `OutboxRelayWorker.publishRaw` to (a) always succeed → all PENDING rows become `REPLAYED`, response `{ replayed: n, failed: 0 }`; (b) throw for a subset → only the successfully-published rows become `REPLAYED`, the rest stay `PENDING` with incremented `retryCount`, response reflects the split.
- Manual repro: insert a row directly into `dlq_items` with a real topic/payload, stop the downstream consumer, trigger replay via the admin UI or `curl -X POST .../admin/dlq/<topic>/replay`, confirm (via Kafka consumer-group offset inspection or a temporary consumer) that a message actually lands on the topic, then restart the consumer and confirm it processes it.

## Acceptance Criteria

- [x] `POST /admin/dlq/:topic/replay` calls `worker.publishRaw(...)` for each `PENDING` row instead of only updating a status column.
- [x] A row that fails to republish (simulated Kafka outage) stays `PENDING` with `retryCount` incremented, not `REPLAYED`.
- [ ] A row that successfully republishes becomes `REPLAYED` and is verifiably present on the Kafka topic (consumer-visible) — not verified this session, no live Kafka broker available.
- [x] `pnpm --filter @erp/event-service test` passes, including the new `dlq-replay.test.ts`.
- [x] The comment `// Mark as REPLAYED (in a real system, would re-publish to Kafka)` no longer exists in the codebase.

## Deliverables

- **Files to create:** `apps/event-service/src/__tests__/dlq-replay.test.ts`.
- **Files to modify:** `apps/event-service/src/outbox/OutboxRelayWorker.ts`, `apps/event-service/src/api/dlq.routes.ts`, `apps/event-service/src/main.ts`.
- **Migrations:** none.
- **APIs added/changed:** `POST /admin/dlq/:topic/replay` response shape gains a `failed` field.
- **Events added/changed:** none — republishes to the DLQ row's already-recorded topic.
- **Tests added:** `dlq-replay.test.ts`.

---

## Context Preservation (for a fresh AI session with no prior history)

**Previous Work Summary:** `apps/event-service/src/api/dlq.routes.ts`'s `POST /admin/dlq/:topic/replay` handler only flips `dlqItems.status` from `PENDING` to `REPLAYED` in Postgres — it never touches Kafka. The admin DLQ console (`DLQPage.tsx`) already polls and displays this status as if it were real. The only Kafka producer in `event-service` lives privately inside `OutboxRelayWorker`, never exposed to the route.

**Current Objective:** expose a `publishRaw` method on `OutboxRelayWorker`, pass the worker instance into `dlqRoutes`, and rewrite the replay handler to actually publish each pending row's stored `payload`/`headers` to its stored `topic` before marking it `REPLAYED` — with partial-failure handling that leaves un-republished rows `PENDING`.

**Architecture Snapshot:** `dlqItems` (`packages/db-client/src/schema/distributed.ts:66-91`) already stores `topic`, `payload` (jsonb), `headers` (jsonb) — everything needed for a real replay, no schema change required. `OutboxRelayWorker` (`apps/event-service/src/outbox/OutboxRelayWorker.ts`) owns the only Kafka producer in this service; `main.ts` already constructs and starts it before registering routes (`main.ts:44-51, 86-98, 113`).

**Completed Components:** the DLQ read/discard routes (`summary`, list, detail, discard) are already correct and unaffected by this fix. `OutboxRelayWorker`'s core batch-publish loop (the original-publish path, not replay) is already correct and unaffected.

**Pending Components:** PG-015 (DLQ/SAGA/PROJECTION permission-granularity fix — routes gated on `AUDIT_LOG_VIEW` instead of dedicated constants) is explicitly out of scope here. Batching/pagination of the "replay all pending" query for very large DLQ depths is flagged but not required at current scale.

**Known Constraints:** single shared Postgres, no RLS — `dlqItems.tenantId` is nullable (some rows are cross-tenant infra events); replay preserves whatever tenant context was already in the stored payload, it does not re-derive or re-validate it.

**Coding Standards:** reuses the existing `kafkajs` producer and the existing per-row try/catch error-handling shape already established in `OutboxRelayWorker.processBatch()` — no new Kafka client, no new retry library.

**Reusable Components:** `OutboxRelayWorker`'s existing connected `Producer` (via the new `publishRaw` method), the existing `dlqItems` Drizzle table.

**APIs Already Available:** not applicable — this fix changes an existing endpoint's implementation, it doesn't consume another service's API.

**Events Already Available:** whichever Kafka topic is stored on each `dlqItems.topic` — the fix republishes to that exact topic, no new topic is introduced.

**Shared Utilities:** `@erp/logger` (`createLogger`) for the new warn-level log on partial replay failure.

**Feature Flags:** not applicable.

**Multi-Tenant Rules:** `dlqItems.tenantId` is nullable; replay does not add or change tenant filtering — it republishes exactly the payload/headers already stored, as-is.

**Security Rules:** unchanged — route stays gated on `PERMISSIONS.AUDIT_LOG_VIEW` pending PG-015's broader reconciliation.

**Database State:** `dlq_items` table exists with all needed columns (no migration needed) — verify at implementation time that no concurrent work has changed its shape since this file was authored.

**Testing Status:** `apps/event-service/src/__tests__/outbox-relay.test.ts` covers the original-publish path only; zero tests exist for DLQ replay today (there was nothing real to test).

**Next Session Plan:** single session — Complexity S, one method + one handler rewrite + one wiring change in `main.ts`.

**Prompt for the Next Session:** "Implement `ERP-PLANNING/production-gap-prompts/001-Architecture/07-dlq-real-replay.md` (PG-007). Before writing code, re-read the current `apps/event-service/src/api/dlq.routes.ts` and `outbox/OutboxRelayWorker.ts` to confirm the replay handler still only updates a status column and the producer is still private — this is the load-bearing assumption for the whole fix. Add `publishRaw` to `OutboxRelayWorker`, wire it through `main.ts` into `dlqRoutes`, rewrite the replay handler with per-row publish + partial-failure handling, then write `dlq-replay.test.ts`."
