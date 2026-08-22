# Event Governance

Codifies conventions already implicit in this codebase's event/outbox mechanism — this is a
documentation deliverable, not new infrastructure (source: `multi-industry-platform/
10-event-architecture.md`, Phase 7 of `16-phase-roadmap.md`). Every convention below already
holds for every event type in `packages/shared-types/src/events.ts`; new services and new event
types (including a future industry vertical) should follow the same rules rather than inventing
new ones.

## 1. The envelope

Every event is an `ERPEventPayload` (`packages/shared-types/src/events.ts`):

```ts
interface ERPEventPayload {
  eventId: string; // ULID, unique per event instance
  eventType: string; // see Naming below
  schemaVersion: number;
  aggregateType: string;
  aggregateId: number;
  tenantId: number;
  userId: number;
  correlationId: string;
  causationId: string;
  occurredAt: string;
  payload: Record<string, unknown>;
}
```

This is written to the transactional `outboxEvents` table in the same DB transaction as the
business change it describes, then relayed to Kafka by `event-service`'s `OutboxRelayWorker`
(`apps/event-service/src/outbox/OutboxRelayWorker.ts`). Nothing about this mechanism needs to
change for a new service or a new industry vertical — extend `EventTypes`, not the envelope shape.

## 2. Naming

`SCREAMING_SNAKE_CASE`, `<AGGREGATE>_<PAST_TENSE_ACTION>` — e.g. `INVOICE_CONFIRMED`,
`STOCK_DEDUCTED`, `PURCHASE_RETURN_APPROVED`. Already codified in `CODING_STANDARDS.md` §3
("Events") and consistently followed by every entry in `EventTypes`
(`packages/shared-types/src/events.ts`).

## 3. Topic derivation — use the real transform, not `KafkaTopics`

The **actual** topic a published event lands on is derived mechanically at relay time
(`OutboxRelayWorker.ts:153`):

```ts
const topic = `erp.${row.event_type.toLowerCase().replace(/_/g, '.')}`;
```

e.g. `INVOICE_CONFIRMED` → `erp.invoice.confirmed`. A new event type needs **zero** relay-side
configuration — adding it to `EventTypes` is the only step required for it to become publishable
and subscribable.

**Known inconsistency, not yet cleaned up**: `events.ts` also exports a `KafkaTopics` interface
with a _different_, domain-segmented naming scheme (e.g. `INVOICE_CONFIRMED: 'erp.sales.invoice
.confirmed'`) that does **not** match what `OutboxRelayWorker` actually publishes. This was
already caught and worked around in `automation-service/src/main.ts`'s own `topicFor()` helper,
whose comment states explicitly: use the real `erp.<type.lowercase.dotted>` transform, not the
aspirational `KafkaTopics` interface. Any new consumer should do the same — derive the topic from
`eventType` directly, never hardcode a topic string from `KafkaTopics`. Reconciling or removing
`KafkaTopics` is a small follow-up, not done here (out of scope for a docs-only pass).

## 4. Ownership

One aggregate, one owning service, always. The service that owns an aggregate is the only one
that ever writes its `outboxEvents` rows. A new industry aggregate (e.g. a future `RESERVATION`
or `PRODUCTION_ORDER` for a service not yet built) gets a single authoritative owner decided at
that service's design time — never split across two services, and never inferred implicitly from
whichever service happens to touch it first.

## 5. Versioning

`schemaVersion` exists on every envelope today but has no written compatibility policy until now:

- New fields on an existing `eventType`'s `payload` must be **additive and optional**. A consumer
  that doesn't know about a new field must keep working unchanged.
- A breaking change (removing a field, changing a field's meaning or type) requires bumping
  `schemaVersion` and a consumer migration window — old and new versions coexisting until every
  consumer has moved. The schema-registry component already exists to support this; no new
  mechanism is being added by this document.

## 6. Idempotency

Consumers must be idempotent on `eventId`, not on business content. This is already the pattern
`notification-service` uses for delivery dedup (its `idempotencyKey`-based dedup on
`notification.routes.ts` / `webhook.routes.ts`) — new consumers should key their own dedup
tracking off the event's `eventId` the same way, since Kafka's at-least-once delivery means any
consumer can see the same event more than once.

## 7. Correlation / Causation

`correlationId` and `causationId` are already present on every envelope. A service that makes an
HTTP call in response to a consumed event must propagate `correlationId` through that call,
matching the existing internal-key-guarded HTTP convention (e.g.
`apps/event-service/src/sagas/gstComplianceProxy.ts`). This is how a single business action stays
traceable end-to-end across services in logs/traces, not just within one service's own event
chain.

## 8. Cross-service calls

Services never import each other's `src` — confirmed by the existing GST/accounting decoupling
and `gstComplianceProxy.ts`'s own internal-key-guarded HTTP call. A new service (including a
future industry vertical's service) talks to Commerce Core services via Kafka events or
internal-key-guarded HTTP only, the same as every existing service does today.

## 9. Sagas

`SagaOrchestrator` (`packages/platform-sdk/src/saga.ts`) supports two distinct usage patterns —
pick deliberately, don't default to whichever is simplest to write:

- **Inline `run()`** — the caller already has live steps + context in hand (starting a saga as
  part of handling the current request) and passes them directly; no prior registration needed.
  This is what `InvoiceService.confirm()` does for its `INVOICE_CREATION` saga
  (`apps/sales-service/src/domain/InvoiceService.ts`) — but because nothing registered a step
  factory for `INVOICE_CREATION`, it **cannot** be retried or compensated later from just a
  `sagaId` (e.g. via `event-service`'s admin API in a different process) — calling that would
  throw `SAGA_TYPE_NOT_REGISTERED`. Acceptable here only because `confirm()` already runs as one
  Postgres transaction by design (splitting it into true saga steps was deliberately rejected — a
  prior ES-24 decision, since accounting posting isn't actually synchronous in this codebase).
- **`register(sagaType, factory)`** — a step factory is registered once at service startup so the
  saga can be reconstructed and retried/compensated from just a `sagaId` later, in the same or a
  different process. This is the pattern `GST_COMPLIANCE_SAGA_TYPE` actually uses, registered
  independently in both `apps/event-service/src/sagas/gstComplianceProxy.ts` and `apps/
gst-service/src/domain/GstComplianceSaga.ts` (each process needs its own registration, since the
  registry is per-process).

A genuine multi-step **cross-service** transaction (e.g. a future Hotel booking that reserves a
room, creates a folio, and books a deposit invoice) should use the registered-factory pattern, not
inline `run()`, so it can actually be retried/compensated via the admin API if a step fails in
production — this is existing infrastructure being extended to a new flow, not new infrastructure.

## 10. What this document does not change

No new event bus, no change to the outbox pattern, no gRPC. This is a policy write-down of
mechanisms that already exist and already work — see `multi-industry-platform/
10-event-architecture.md` for the original analysis this document formalizes.
