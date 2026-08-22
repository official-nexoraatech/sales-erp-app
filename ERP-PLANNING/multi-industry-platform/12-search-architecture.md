# 12 — Search Architecture

## 1. Current state (verified — a strength, not a gap)

`apps/search-service/src/domain/SearchEngine.ts` indexes 29 entity types today, with **physical, index-name-based tenant isolation**: `` `erp_${tenantId}_${entity}` `` (`01-current-state.md` §13), not a query-time filter that could be forgotten. This is a strong-by-construction guarantee that directly supports multi-industry growth without any redesign.

## 2. Onboarding a new industry's searchable entities

Adding a new entity type (e.g. `reservation`, `production_order`, `patient`) is additive: register the entity in `SearchEngine.ts`'s entity list, define its index mapping, and wire the owning service's outbox events to a new consumer that syncs into `erp_${tenantId}_${new_entity}`. No cross-service coupling is introduced — each service's data stays indexed under its own entity name, isolated per tenant exactly like the existing 29.

## 3. What this plan does not do

Does not change the isolation mechanism (already correct). Does not consolidate indexes across entities (per-entity-per-tenant indexes are a deliberate, working isolation boundary — collapsing them would reduce isolation for no benefit). Does not add a new search technology — Elasticsearch is already provisioned (`docker-compose.yml`) and proven at 29 entity types; no evidence suggests it can't scale to more.
