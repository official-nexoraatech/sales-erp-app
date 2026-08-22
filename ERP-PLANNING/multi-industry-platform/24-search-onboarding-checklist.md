# 24 — Search Onboarding Checklist

Phase 8 deliverable (`16-phase-roadmap.md`). A step-by-step checklist for adding a new
searchable entity type when onboarding a new industry/vertical — e.g. Manufacturing's `boms`,
or a future industry's `reservation`/`patient`/`production_order`. See
`12-search-architecture.md` for the underlying design (physical, index-name-based tenant
isolation — `erp_${tenantId}_${entity}` — already proven at 29 entity types; nothing here changes
that mechanism).

## Steps

1. **Register the entity** in `apps/search-service/src/domain/SearchEngine.ts`'s entity list —
   add its name, index mapping (fields, analyzers), and any entity-specific search-result
   projection fields.
2. **Wire the sync path**: the owning service (e.g. `production-service` for `boms`) must emit
   an outbox event on create/update/delete (`BOM_CREATED`, `BOM_UPDATED`, ... — see
   `EVENT_GOVERNANCE.md` for naming) that a new consumer in search-service picks up and indexes
   into `erp_${tenantId}_${entity}`. Do not have the owning service call Elasticsearch
   directly — the outbox/consumer indirection is what keeps search-service the single owner of
   index lifecycle and keeps the owning service decoupled from ES availability.
3. **Tenant isolation**: confirm the new index name is derived from `tenantId`, never a
   client-supplied value — mirrors every existing entity, no new isolation logic to write.
4. **RBAC**: the search route/UI surface for the new entity must gate on the same permission the
   entity's own CRUD routes already require (e.g. `BOM_VIEW`) — search must never be a side-door
   around normal permission checks.
5. **Capability-awareness**: if the entity belongs to a capability that isn't universally
   enabled (e.g. `BOM` is `MANUFACTURING`-only), the frontend global-search UI should not surface
   it as a searchable type for tenants without that capability — check
   `CAPABILITY_REGISTRY`/`enabledModules` the same way the nav layer does
   (`05-module-capability-model.md`), rather than letting an empty/irrelevant result type appear.
6. **Backfill**: for an entity type added to an already-live index-per-tenant scheme, write a
   one-off backfill script that reindexes existing rows for tenants that already have data (a
   brand-new vertical's entity type has no existing rows to backfill — only relevant when adding
   search to a pre-existing entity that predates this checklist).
7. **Test**: at minimum, an integration test proving a created/updated/deleted row is
   findable/removed from that tenant's index and NOT visible to another tenant's index — mirrors
   the isolation proof pattern already used for every existing entity type's search tests.

## What this does not change

Does not introduce a new search technology, does not consolidate per-entity-per-tenant indexes,
does not change how existing entity types are indexed. Purely a checklist for the _next_ entity
type, so a new vertical's first search integration follows the existing correct pattern instead
of re-deriving it from scratch (or skipping isolation/RBAC/capability-awareness by oversight).
