# ES-25 Completion Report — Platform SDK Completeness, Build Hygiene & Observability
**Date:** 2026-07-04
**Status:** COMPLETE

## Findings Closed
| ID | Finding | Fix Summary | Verified By |
|---|---|---|---|
| C8 | Stale compiled artifacts committed in `db-client/src` | Deleted 32 tracked `.js`/`.d.ts`/`.js.map`/`.d.ts.map` files; same pattern also found and fixed in `shared-types`, `config`, `logger`; `.gitignore` added to all 4 packages; CI guard added | Rebuilt all 4 packages, confirmed `dist/` output complete (previously-missing `activeSessions`/`securityAuditLog`/`blockedIps` exports now present); temporary throwaway vitest test confirmed a value import from `@erp/db` resolves correctly with zero `vi.mock` |
| H4 | `initializeTelemetry()` never called | Called in all 14 active `apps/*/src/main.ts` (`api-gateway` excluded — it's a 4-line stub with no bootstrap logic); fixed `telemetry.ts` gating so a missing `OTEL_EXPORTER_OTLP_ENDPOINT` cleanly disables tracing instead of always defaulting to `localhost:4318`; wrapped SDK init in try/catch so a failure never crashes service startup | `pnpm build` across all touched services; manual code review of gating logic (live Jaeger verification not possible — see Known Issues) |
| H9 | `PlatformContext` missing 4 sub-clients | `files` (`PlatformAttachments`) attached as optional `ctx.files`, backed by `StorageClient` constructed once at `PlatformContextFactory` level when `storage` config is supplied; `sales-service`/`purchase-service` migrated off manually-constructed `PlatformAttachments` to `ctx.files`; `metrics`/`notifications`/`search` were never implemented and have working equivalents elsewhere (Prometheus via `@erp/logger`, direct HTTP calls to notification-service/search-service) — closed via correcting `ERP_MASTER_SPEC.md` §9 rather than building new sub-clients | `pnpm --filter @erp/sdk --filter @erp/sales-service --filter @erp/purchase-service build` passes; manual review |
| M4 | production-service raw `ioredis` | `BarcodeService` migrated from raw `Redis` to `TenantScopedCache` (`ctx.cache`); `barcode.routes.ts` and `main.ts` updated to drop the manual Redis client entirely | `pnpm --filter @erp/production-service build`; zero `new Redis(`/`from 'ioredis'` remaining in the service (grep-verified) |
| M10 | Feature-flag L1 cache defeated per-request | `PlatformFeatureFlags`'s L1 `Map` hoisted to `PlatformContextFactory`-level (`createFeatureFlagL1Cache()`), shared across every `create()` call; `subscribeFeatureFlagInvalidations()` added to the factory and called once at bootstrap in all 8 services that use `PlatformContextFactory`. Also fixed a **latent bug found while wiring this up**: the invalidation-subscriber destructured `flagKey` from the pub/sub message, but `publishInvalidation` actually publishes the field as `key` — so hot-reload invalidation has never fired since it was written. Rewired `subscribeToInvalidations` to operate directly on the shared L1 map and read the correct field name | New regression test added to `PlatformFeatureFlags.test.ts`: two separate instances sharing one L1 map only hit L2 once across two simulated requests (8/8 tests pass) |
| M11 | Dead `event-bus-client` package | Package deleted entirely; dead `@erp/events` vitest alias removed from `apps/auth-service/vitest.config.ts`; `@erp/events` build step and `COPY` lines removed from `apps/auth-service/Dockerfile`; `TECH_AUDIT.md` §22 updated to record the resolution | `pnpm install` (workspace scope dropped from 26→25 packages); full repo `pnpm build` passes (24/24 tasks, down from 25) with the package gone |
| M14 | RLS session-GUC gap on `.raw` queries | Investigated: zero `CREATE POLICY`/`ENABLE ROW LEVEL SECURITY` statements exist anywhere in `packages/db-client/migrations/` — tenant isolation is enforced entirely at the application layer via hand-written `WHERE tenant_id = ...` predicates. Since no RLS policies exist for the GUC to matter to, building RLS from scratch is out of scope for this hygiene pass (per the phase's own descope). Corrected `ERP_MASTER_SPEC.md` §4.2's false claim that RLS is "enabled on all tables" to describe reality, and noted that `TenantScopedDatabase.transaction()`'s GUC-setting is currently inert | `grep -r "CREATE POLICY\|ENABLE ROW LEVEL SECURITY" packages/db-client/migrations` returns nothing |
| L8 | Duplicate stale artifact (`index.js`) | Same fix as C8 | Same as C8 |

## Files Changed
| Area | Files |
|---|---|
| Stale artifact cleanup | Deleted 32 files across `packages/{db-client,shared-types,config,logger}/src/`; added `.gitignore` to all 4; `.github/workflows/ci.yml` (new guard step in the `lint` job) |
| Telemetry | `packages/platform-sdk/src/telemetry.ts` (gating + try/catch); all 14 active `apps/*/src/main.ts` (import + `initializeTelemetry()` call) |
| PlatformContext / files | `packages/platform-sdk/src/context.ts` (`ctx.files`, `StorageClient` wiring); `apps/sales-service/src/main.ts`, `apps/sales-service/src/api/attachment.routes.ts`; `apps/purchase-service/src/main.ts`, `apps/purchase-service/src/api/attachment.routes.ts`; `ERP-PLANNING/ERP_MASTER_SPEC.md` §9 |
| production-service cache | `apps/production-service/src/domain/BarcodeService.ts`, `apps/production-service/src/api/barcode.routes.ts`, `apps/production-service/src/main.ts` |
| Feature-flag L1 cache | `packages/platform-sdk/src/feature-flags.ts`, `packages/platform-sdk/src/context.ts`, `packages/platform-sdk/test/unit/PlatformFeatureFlags.test.ts`; 8 `apps/*/src/main.ts` files using `PlatformContextFactory` (`subscribeFeatureFlagInvalidations()` call) |
| event-bus-client removal | Deleted `packages/event-bus-client/`; `apps/auth-service/vitest.config.ts`, `apps/auth-service/Dockerfile`; `ERP-PLANNING/TECH_AUDIT.md` §22 |
| RLS documentation | `ERP-PLANNING/ERP_MASTER_SPEC.md` §4.2 |
| Audit trail | `ERP-PLANNING/ARCHITECTURE_AUDIT_REPORT.md` (C8, H4, H9, M4, M10, M11, M14, L8 marked fixed); `ERP-PLANNING/audit-phase-prompts/ES-25-*.md` status line |

## Tracing Verification
**Not performed live** — Docker Desktop was not running in this environment (`docker ps` failed to
connect to the daemon), so the local Jaeger instance from `docker-compose.yml` could not be started
and no real trace could be captured. What was verified instead:
- `initializeTelemetry()` is called at the top of all 14 active services' `main.ts`, before route
  registration.
- The gating logic was reviewed by hand: with `OTEL_EXPORTER_OTLP_ENDPOINT` unset, `initializeTelemetry`
  now returns immediately (no exporter/SDK constructed) instead of the previous behavior of always
  defaulting to `http://localhost:4318` whenever `NODE_ENV=production`.
  SDK construction is also wrapped in try/catch so a bad endpoint can never crash service startup.
- All touched services build successfully with the new import.

**Recommendation:** the next session with a working Docker environment should run
`docker-compose up -d jaeger` (already defined), set `OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318`
in `.env`, start 2-3 services, make a request that crosses them (e.g. create an invoice via
sales-service, which emits events consumed by inventory-service/accounting-service), and confirm
linked spans appear in the Jaeger UI at `localhost:16686`. This is a pure infra-availability gap in
this session, not a code gap.

## Tests
- `packages/platform-sdk` (`PlatformFeatureFlags.test.ts`): 8/8 PASS (7 pre-existing + 1 new
  regression test for the M10 fix)
- Full repo `pnpm test` (via `turbo run test --continue`): 19/24 packages passed on the first
  parallel run; the 5 "failures" were investigated individually and **all confirmed pre-existing and
  unrelated to this phase**:
  - `gst-service`, `accounting-service`: timeout-only failures (5000ms default) that pass cleanly
    when re-run in isolation (1.1-1.4s) — resource contention from running all 24 packages' test
    suites in parallel, not a real regression.
  - `hr-service` (`holiday.test.ts`, `permission-guards.test.ts`), `scheduler-service`
    (`ImportEngine.test.ts`): reproduce identically in isolation, but the failing files are
    byte-identical to the last commit (`git diff HEAD` on each returns nothing) — pre-existing bugs
    at HEAD, untouched by this phase or any other uncommitted work in the tree.
  - `sales-service` (`permission-guards.test.ts`, duplicate route registration in
    `invoice.routes.ts`): caused by unrelated pre-existing **uncommitted** changes to
    `invoice.routes.ts` (148 insertions, present before this session started) — not something this
    phase touched or introduced.
- `pnpm type-check` (repo-wide): **30/30 PASS**
- `pnpm build` (repo-wide): **24/24 PASS** (25→24 after `event-bus-client` removal)
- `pnpm lint` (repo-wide): 21/24 packages fail, but exclusively on pre-existing `no-undef` errors
  (missing `process`/`crypto`/`fetch`/`require` ESLint globals) matching the ~223-error baseline
  documented from a prior session. Spot-checked the two lint findings inside files this phase
  touched (`context.ts`'s unused `Kafka` import, `feature-flags.ts`'s `import('ioredis').default`
  inline type) — both existed in `HEAD` before this phase's changes; zero new lint errors introduced.

## Known Issues / Deferred
- **Live Jaeger trace not captured** — Docker wasn't running in this session; see Tracing
  Verification above for the manual follow-up steps.
- **RLS policies don't exist at all** — confirmed via migration grep. Building actual
  `CREATE POLICY`/`ENABLE ROW LEVEL SECURITY` statements as defense-in-depth is explicitly out of
  scope for this hygiene phase (per its own descope) and should be a dedicated security-hardening
  phase.
- **`api-gateway` has no telemetry call** — it's a literal 4-line stub (`export {}`, no `bootstrap()`)
  per H2; nothing to instrument yet.
- Pre-existing lint debt (~223 errors, missing ESLint env globals) and the 4 confirmed-pre-existing
  test failures above are unrelated to this phase and were not fixed, per the surgical-changes
  principle — fixing them is a separate cleanup task.
