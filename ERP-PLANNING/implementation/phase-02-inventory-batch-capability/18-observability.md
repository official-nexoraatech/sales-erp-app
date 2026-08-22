# 18 — Observability

## 1. Metrics — reused, not new

Phase 1's `erp_capability_check_denied_total` counter (`packages/logger/src/erp-metrics.ts`, labelled `capability_key`+`outcome`) already generically covers any registry key — a denial on the new `GET /inventory/near-expiry-stock` route or the in-handler `item.routes.ts` check both increment it with `capability_key: 'INVENTORY_BATCH'` automatically, since `requireCapability`/`isCapabilityEnabled` are the same shared functions (`05-service-impact.md`). No new metric needed for the route-level check.

**One new increment site**: the in-handler `item.routes.ts` check (`05-service-impact.md` §1) is a novel call pattern (not going through the `requireCapability` preHandler, which is where the existing `.inc()` calls live — `capability-guard.ts`). The implementation must explicitly call `erpCapabilityCheckDeniedTotal.inc({ capability_key: 'INVENTORY_BATCH', outcome: 'disabled' | 'resolution_error' })` from the new call site too, or this specific denial path will be invisible in the existing dashboard — a real gap to avoid, not automatic.

## 2. Logging

Same pattern as Phase 1 (`request.log.warn` for a clean denial, `request.log.error` for resolution failure) — applied at the new in-handler call site in `item.routes.ts`, not just the route-level ones which get it automatically via `requireCapability`.

## 3. Audit

`fefoEnabled` changes on an item are already captured by the existing `PlatformAuditLogger` call every `PUT /items/:id` handler already makes (before/after diff, `before_data`/`after_data`/`changed_fields` — `01-current-state.md` §14) — no new audit code needed, the field is picked up automatically by the existing generic diff mechanism.

## 4. What this phase does not do

Does not add a new metric name, new log destination, or new audit table. Reuses Phase 1's observability surface entirely, with one new call site to wire (§1).
