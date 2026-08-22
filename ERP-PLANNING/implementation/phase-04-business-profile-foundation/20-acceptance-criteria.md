# 20 — Acceptance Criteria

Status: **Implemented and verified 2026-08-19** — see `26-implementation-report.md`. Checkboxes below reflect actual verified state, not intent.

## Prerequisite

- [x] D1 (`default_capability_keys` vs. `default_module_keys` naming) answered by the user — `25-decision-record.md`. Confirmed: rename.
- [x] D2 (migration numbering) acknowledged — journal's tail entry re-checked at implementation time; claimed `0170` (was still free).

## Schema

- [x] `industries` table exists, exactly one seed row (`COMMERCE`) — verified by direct SQL.
- [x] `business_types` table exists, exactly two seed rows (`CLOTH_RETAIL`, `GROCERY`), both `industry_id`-linked to `COMMERCE`, `default_capability_keys` seeded per D1's resolution (`[]` and `["INVENTORY_BATCH"]` respectively) — verified by direct SQL.
- [x] `tenants.business_type_id` exists, nullable FK to `business_types.id`.
- [x] Every existing tenant's `business_type_id` correctly resolves to a `business_types` row whose `code` equals that tenant's own `vertical` — verified by direct SQL against real data (28/28 tenants, 0 mismatches, 0 nulls), not merely asserted.

## Code

- [~] `setTenantBusinessType()` **not built as a separate function** — deviation, documented in `26-implementation-report.md` §3: exactly one call site exists in the entire codebase (provisioning), so the resolution logic was inlined into `TenantProvisioner.provision()` per CLAUDE.md §2 rather than extracted into a single-caller helper. The _behavior_ this criterion cares about (writes both `vertical` and `business_type_id` together, throws a clear error for an unrecognized code) is fully implemented, just not as a standalone named function.
- [x] `TenantProvisioner.ts`'s provisioning flow sets `business_type_id` for every new tenant, in the same insert as `vertical`.
- [x] All 5 confirmed `vertical`-reading call sites (`01-current-code-evidence.md` §2) are unmodified — confirmed by `git diff --stat` scope, and pass their existing tests unchanged (regression suite green).

## Testing

- [~] **No standalone unit test for the error-throw branch** (`No business_types row found for vertical: ...`) — honest gap, not silently dropped: this branch is defensive and unreachable in practice today, since `tenant.schemas.ts`'s Zod enum constrains `vertical` to exactly the two values the migration seeds; the two reachable branches (`CLOTH_RETAIL`, `GROCERY`) are both proven by the real-DB integration test below. A dedicated mocked-DB unit test for the unreachable branch was judged not worth the file/setup overhead for a codepath that can't currently be hit — revisit if `tenant.schemas.ts`'s enum is ever widened.
- [x] Migration correctness verified against real Postgres, not skipped — direct SQL, `26-implementation-report.md` §4.
- [x] New integration test proves a freshly-provisioned tenant gets both fields correctly, for **both** business types — extended `tenant.integration.test.ts`, run for real against Postgres this session (5/5 passed, not left `describe.skipIf`-skipped).
- [x] Full `apps/tenant-service` regression suite passes with zero new failures — 64/65 (1 pre-existing, unrelated MinIO-gated skip), confirmed both with and without `DATABASE_URL` set.

## Backward compatibility

- [x] Zero behavior change for any existing tenant, any existing route, any existing test — confirmed by the regression suite and the direct-SQL mismatch check (0/28).

## Security

- [x] `15-security-impact.md`'s checklist confirmed — no new trust boundary, no new tenant-scoped write path, no client-supplied field trusted.

## Definition of Done

Schema and code criteria checked (with two honestly-recorded, low-risk deviations above), D1/D2 resolved, full regression suite green, migration verified against live data — not merely against this document's claims. A third-party/independent post-implementation review (mirroring `phase-01`/`phase-02`/`phase-03`'s standard) has **not** been run as a separate pass this session — this implementation report and acceptance-criteria check were produced by the same session that wrote the code, not independently re-verified from a fresh read. Recommend a follow-up independent review before treating this phase as at the same verification tier as Phase 1/2B.
