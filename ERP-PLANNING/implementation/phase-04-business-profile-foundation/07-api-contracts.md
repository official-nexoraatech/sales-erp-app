# 07 — API Contracts

## No breaking change to any existing endpoint

`POST /admin/tenants` (`tenant.routes.ts:137`) keeps its exact request shape — `CreateTenantSchema`'s `vertical` field is unchanged (`05-service-impact.md`). The response shape (`ProvisionResult`) is unchanged unless the optional audit-payload addition (`05-service-impact.md`'s `tenant.routes.ts:154` note) is taken, which is response-adjacent (audit log, not the HTTP response body) and invisible to the API consumer either way.

## No new endpoint

This phase adds no route. `industries`/`business_types` are ops-managed, seeded once by migration — no admin CRUD UI/API for them is built in this phase (out of scope; if a future phase needs to let a platform operator add a new business type without a migration, that's separate, larger work — `TO VERIFY` whether the roadmap ever calls for it, not assumed here).

## Internal contract addition

`setTenantBusinessType(db, tenantId, businessTypeCode)` is a new internal function signature (`05-service-impact.md`) — not an HTTP contract, a TypeScript one. No versioning concern.
