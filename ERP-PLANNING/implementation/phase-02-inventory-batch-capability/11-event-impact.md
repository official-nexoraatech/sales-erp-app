# 11 — Event Impact

## 1. No new event type needed

`ITEM_CREATED`/`ITEM_UPDATED` (existing `EventTypes`, already published by `item.routes.ts` on every create/update, confirmed by reading the handler in `01-current-code-evidence.md`'s evidence-gathering pass) already fire on the exact requests that would set `fefoEnabled` — the field rides in the existing event payload automatically (same pattern Phase 1 relied on for `GET /users/me`'s `enabledCapabilities` riding through an existing object spread, `21-post-implementation-review.md` §5). No producer change beyond the payload naturally including the new field.

## 2. No new consumer needed

Nothing in the codebase currently reacts to item-level flag changes via Kafka (confirmed — no existing consumer subscribes to `ITEM_UPDATED` for flag-driven side effects). This phase introduces none either; `nearExpiryAlert.job.ts` is scheduler-triggered (`POST /inventory/near-expiry-alert`), not event-driven, and stays that way.

## 3. FIFO layer consumption change is not an event-architecture concern

`consumeFifoLayers`'s ordering change (`05-service-impact.md` §3) is a same-transaction, in-process change to which DB rows get decremented — it does not change what events fire, their payload shape, or their ordering guarantees. Whatever event already fires on a sale/transfer (e.g. `INVOICE_CONFIRMED`, stock-adjustment events) continues unchanged; the FIFO layer selection is an implementation detail invisible at the event-envelope level.

## 4. `EVENT_GOVERNANCE.md` (Phase 7, per `16-phase-roadmap.md`)

Not written by this phase — remains a separate, already-identified documentation deliverable (`00-roadmap-analysis.md`'s renumbering table, "Phase 3 (future)"). This phase's own event usage fully complies with the conventions that document will formalize (no new topic, existing envelope fields, no new consumer) without needing to wait for it.
