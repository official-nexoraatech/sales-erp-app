# 10 — Event Architecture: Governance for New Industry Domains

## 1. The mechanism is already sound — this is a documentation/policy deliverable, not new code

Confirmed in `01-current-state.md` §10: every event envelope (`ERPEventPayload`, `packages/shared-types/src/events.ts`) already carries `eventId, eventType, schemaVersion, aggregateType, aggregateId, tenantId, userId, correlationId, causationId, occurredAt, payload`. The transactional outbox, DLQ, schema registry, and event store all already exist and work. Nothing here needs re-architecting.

## 2. Policy to write down (not yet a formal doc anywhere)

- **Naming**: `EventTypes` constant, `SCREAMING_SNAKE_CASE`, `<AGGREGATE>_<PAST_TENSE_ACTION>` (e.g. `INVOICE_CONFIRMED`). Topic derivation is automatic (`erp.<type.lowercase.dotted>`) — a new industry service registering a new event type needs **zero** relay-side configuration, confirmed by `OutboxRelayWorker.ts:153`'s generic derivation and PG-027's own doc noting "no new topic-registration step needed."
- **Ownership**: one aggregate, one owning service, always (brief §12). New industry aggregates (e.g. `RESERVATION`, `PRODUCTION_ORDER` for a future service) get a single authoritative owner from day one — decided at Phase-10-service-design time, not left implicit.
- **Versioning**: `schemaVersion` field already exists on every envelope but is not yet paired with a written compatibility policy (e.g. "additive fields only within a major version"). Recommend documenting: new fields must be optional; breaking changes require a new `schemaVersion` and a consumer migration window, mirroring how the schema-registry component already exists to support this.
- **Idempotency**: consumers must be idempotent on `eventId` (already the pattern used by e.g. `notification-service`'s delivery dedup, per PG-027's doc reference to its "SHA-256-derived idempotency key pattern"). No new mechanism — just a documented expectation for new consumers.
- **Correlation/Causation**: already present on every envelope; new services should propagate `correlationId` through any HTTP calls they make in response to a consumed event, matching the existing internal-HTTP-call convention (`x-internal-key` calls, e.g. `gstComplianceProxy.ts`).
- **Cross-service calls**: the existing convention ("apps don't import each other's src", confirmed in `gstComplianceProxy.ts:6` and the GST/accounting decoupling in `01-current-state.md` §6) continues — a new industry service talks to Commerce Core services via Kafka events or internal-key-guarded HTTP, never a shared TS import.

## 3. Saga usage

`SagaOrchestrator` (`packages/platform-sdk/src/saga.ts`) is currently wired only for GST-compliance proxying. A new industry with genuine multi-step cross-service transactions (e.g. a Hotel booking that reserves a room, creates a folio, and books a deposit invoice) should use the same orchestrator rather than inventing ad hoc choreography — this is existing infrastructure being extended to a new use case, not new infrastructure.

## 4. What this plan does not do

Does not introduce a new event bus, does not change the outbox pattern, does not add gRPC (brief §10, confirmed no concrete need). No new code is scoped here — Phase 7 in `16-phase-roadmap.md` is a documentation deliverable (write the policy above into a real `EVENT_GOVERNANCE.md`) plus, if Phase 10 picks an industry needing multi-step sagas, wiring `SagaOrchestrator` to that specific flow.
