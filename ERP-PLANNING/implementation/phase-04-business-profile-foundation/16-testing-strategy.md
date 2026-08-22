# 16 — Testing Strategy

## New coverage — no existing test to extend

`01-current-code-evidence.md` §6 confirmed zero existing test file covers `TenantProvisioner`'s vertical-selection logic. This phase's tests are the first, not an extension.

## Unit tests

`apps/tenant-service/src/__tests__/set-tenant-business-type.test.ts` (new): `setTenantBusinessType()` correctly resolves both known codes (`CLOTH_RETAIL`, `GROCERY`) to the right `business_types.id`, throws `UNKNOWN_BUSINESS_TYPE` (or the chosen error shape) for an unrecognized code, and correctly writes both `vertical` and `business_type_id` in the same call (a mocked-DB test, matching this repo's existing unit-test convention for `TenantProvisioner`-adjacent logic).

## Migration/data tests

Idempotency: re-running the backfill `UPDATE` twice produces the same end state (trivial to prove, `06-database-impact.md`'s backfill is a pure function of `vertical`, not a counter/incrementing value). Correctness: after migration, every existing tenant's `business_type_id` resolves to a `business_types.code` equal to its own `vertical` value — a direct SQL assertion, run against the real dev DB (this phase should not merely assert this against a mock, since the entire value of the backfill is that it's correct against _real_ existing rows — matches the standard `39-implementation-report.md`/`41-phase-2b-closure-review.md` both held Phase 2B's migration to).

## Integration test

A new tenant provisioned through `POST /admin/tenants` (real route, real DB) ends up with both `vertical` and `business_type_id` set correctly and consistently — proves the full path, not just the isolated helper function.

## Regression

Full `apps/tenant-service` test suite re-run before/after — must show zero new failures. Given this phase touches `TenantProvisioner.ts` (a file with existing, unrelated tests), a diff-based check (not just "the suite is green") confirms no existing assertion's behavior shifted.

## Backward compatibility test

A dedicated test proving all 5 confirmed `vertical`-reading call sites (`01-current-code-evidence.md` §2) behave identically before/after this phase for an existing tenant — the `accounting-service`/`scheduler-internal.routes.ts` call sites are in a different service, so this is better proven by a targeted integration test (seed a tenant, verify `default-accounts.ts`'s chart-of-accounts selection still matches the tenant's `vertical`) than by a unit test alone.

## Not required

Performance tests (two small reference tables, one nullable FK column — no query pattern this could meaningfully regress). Security tests beyond `15-security-impact.md`'s already-thin checklist (there is very little new surface to probe). Any test touching `report-service`/`search-service`/`event-service`/`ai-copilot-service` (all confirmed untouched, `11`-`14`).
