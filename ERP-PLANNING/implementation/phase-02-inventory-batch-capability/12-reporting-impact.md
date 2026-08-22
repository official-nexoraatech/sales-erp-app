# 12 — Reporting Impact

## 1. Near-Expiry Stock is an operational read, not an analytical report

`11-reporting-architecture.md` recommends new industry-specific _analytical_ needs prefer the `event-service` Projections component over adding more direct-DB coupling to `report-service`'s `ReportEngine.ts`. This phase's `GET /inventory/near-expiry-stock` (`07-api-contracts.md` §2) is deliberately **not** built as a `report-service` slug or a projection — it's a small, tenant-scoped, low-cardinality, real-time operational query ("what's expiring soon, right now") served directly by `inventory-service` off `inventory_fifo_layers`, the exact same query shape `nearExpiryAlert.job.ts` already proves correct and performant (the dedicated `idx_fifo_layers_fefo_order` index exists for this). This matches the architecture's own distinction (`11-reporting-architecture.md` §2-§3): operational reads stay with the owning service; only genuinely analytical, cross-tenant-scale, or historical-trend work should prefer projections.

## 2. Why this doesn't contradict `11-reporting-architecture.md`

That document's guidance is about **new analytical** work specifically (its own example: "hotel occupancy trends, manufacturing OEE") — a running list of "what's about to expire" is operational inventory state, not a trend/aggregate analysis, and belongs with the service that owns the data, consistent with `01-current-state.md` §9's domain-ownership principle (ADR-08) that this plan preserves unchanged.

## 3. Existing `ReportEngine.ts` — untouched

No new report slug added to the 2472-line `ReportEngine.ts`. If a future phase wants a _historical_ "Batch Aging Report" (trend over time, per `21-capability-resolution-architecture.md` §6's worked example) rather than a live snapshot, that would be the first genuinely analytical use of this capability's data and should follow the projection-preference recommendation — explicitly deferred, not built here.

## 4. What this phase does not do

Does not retrofit any existing report. Does not add a data warehouse or new analytical infrastructure. Does not change `ReplicaRouter` usage.
