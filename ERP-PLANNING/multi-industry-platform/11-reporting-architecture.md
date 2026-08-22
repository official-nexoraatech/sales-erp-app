# 11 — Reporting Architecture

## 1. Current state (verified)

`apps/report-service/src/domain/ReportEngine.ts` queries Postgres directly (raw Drizzle SQL), likely via a read replica (`ReplicaRouter` import) — not Kafka-fed projections. The historically-duplicated financial-statement logic (Trial Balance/P&L/Balance Sheet/Cash Flow) is now consolidated into `packages/platform-sdk/src/financial-reports-engine.ts`, consumed identically by both `report-service` and `accounting-service` (`01-current-state.md` §12). This is a **genuine strength** confirmed by this discovery pass, not a gap.

## 2. Operational vs. analytical data — recommendation, not a retrofit

The brief (§14) asks the platform to distinguish operational from analytical data. Retrofitting the 2472-line `ReportEngine.ts`'s ~83 existing report slugs to a projection model is **not recommended** — they work today, the replica already isolates read load from the primary, and rewriting working reports has no evidence-based justification (CLAUDE.md §2/§3: don't refactor what isn't broken).

**For new work only**: any genuinely new, industry-specific analytical report (e.g. hotel occupancy trends, manufacturing OEE, restaurant table-turnover) should prefer the existing `event-service` Projections component (`apps/event-service/src/api/projections.routes.ts`) over adding another direct cross-schema query to `ReportEngine.ts`. This avoids growing report-service's coupling to every operational service's live schema — the projection approach already exists for other purposes and just needs to be the default choice for new analytical needs, not built new.

## 3. Domain ownership stays with the operational service

A new industry's reports still read that industry's own data through its owning service's schema (or a Kafka-fed projection of it) — report-service does not become the authoritative source for any domain data, only a read model, consistent with the brief's §12 domain-ownership principle.

## 4. What this plan does not do

Does not migrate existing reports to projections. Does not introduce a separate analytical database/warehouse — no evidence in the current architecture (single Postgres + one replica, no data-warehouse tooling found) justifies that scale of change, and it would contradict the brief's §22 caution against premature infrastructure. If report-service's direct-DB coupling becomes a measured bottleneck as more industries are added, that's a future, evidence-triggered decision, not one made here.
