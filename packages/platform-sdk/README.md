# @erp/sdk

Shared platform infrastructure for backend services (`ERP_MASTER_SPEC` §4.1: "All infrastructure access MUST go through the SDK").

## Kafka usage convention

Services never call `producer.send()` directly outside the outbox relay. The pattern is:

1. Each service constructs its own `Kafka` client for connection bootstrap (`new Kafka({ clientId, brokers, retry })` in `main.ts`) — this low-level construction is unavoidable and stays in the service.
2. For consuming, wrap that client with `PlatformEventConsumer` (`./src/events.ts`). It handles topic subscription and inbox-table idempotency (`inboxEvents`, claimed via `onConflictDoUpdate` so redelivered messages can't double-process), and marks failed messages `FAILED` on the inbox row without crashing the consumer loop.
3. For publishing, never send to Kafka directly — write to the transactional outbox via `PlatformEventBus.publish()` / `publishInTransaction()` (`TenantScopedDatabase.insertIntoOutbox()`). `event-service`'s `OutboxRelayWorker` is the only thing that relays `outbox_events` rows to Kafka.

`PlatformEventBus` and `PlatformEventConsumer` are the sanctioned wrapper pair — there is no separate `event-bus-client` package.
