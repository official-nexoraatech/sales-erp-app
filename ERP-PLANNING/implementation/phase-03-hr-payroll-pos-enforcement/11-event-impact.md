# 11 — Event Impact

## No new event types, no changed event contracts

`requireCapability` is a preHandler that either lets a request through unchanged or replies before the handler body runs. It never touches `PlatformEventBus`, never wraps or intercepts an existing `emit`/`publish` call. Every event a gated route's handler already emits on success (e.g., `InvoiceService.confirm()`'s existing domain events for a POS sale, `PayrollEngine`'s existing events for a payroll run) is emitted identically, with identical payload shape, when the capability check passes.

## What happens to an event on denial

Nothing — the handler body (including any event emission) never executes when `requireCapability` denies the request. No new "capability denied" event is emitted; denial is observed only via the existing `erp_capability_check_denied_total` metric and request logs (`18-observability.md`), matching Phase 1/2B's precedent of "log + metric, not an event."

## Consumers confirmed unaffected

Any Kafka consumer or outbox-driven downstream (accounting postings from `COGS_CALCULATED`-style events, search-index updates, report projections) reads events that are only ever emitted after a successful (200/201) response — since this phase changes zero success-path behavior, zero downstream consumer sees any different event shape or volume pattern _for allowed requests_. For **denied** requests (a tenant with the capability off), the relevant event simply never fires — same as if the user had never attempted the action, which is the correct, expected downstream behavior for a legitimately blocked action.
