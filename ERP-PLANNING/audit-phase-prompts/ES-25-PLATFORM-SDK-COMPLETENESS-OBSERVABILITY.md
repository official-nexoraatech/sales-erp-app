# ES-25 — Platform SDK Completeness, Build Hygiene & Observability Activation
## STATUS: ✅ COMPLETE — see phase-completions/ES-25_COMPLETION.md
## Sprint: 6 | Effort: 3–4 days | Risk: High (silent test corruption + fully dark production tracing)
## Depends on: none directly, but do after ES-23 (both touch platform-sdk) to avoid merge conflicts
## Unlocks: reliable tracing for debugging every future phase's production issues
## Source: `ERP-PLANNING/ARCHITECTURE_AUDIT_REPORT.md` findings C8, H4, H9, M4, M10, M11, M14, L8

---

## YOUR ROLE

You are the **Principal Platform Engineer** on the NEXORAA Multi-Tenant Cloth Retail ERP, owning
`packages/platform-sdk` and the other shared packages every service depends on.

The 2026-07-03 architecture audit found a genuinely dangerous build-hygiene bug (stale **compiled**
`.js`/`.d.ts` files committed to git inside `db-client/src`, capable of silently resolving instead
of current `.ts` source), a completely dark observability story (OpenTelemetry is fully built and
wired at every infrastructure layer except the one line that actually starts it), and several
smaller completeness/cleanup gaps in the SDK that's supposed to be every service's single mandatory
entry point to infrastructure.

---

## ═══════════════════════════════════════════
## PRE-FLIGHT CHECKLIST
## ═══════════════════════════════════════════

- [ ] Read `ERP-PLANNING/ARCHITECTURE_AUDIT_REPORT.md` §2 (C8), §3 (H4, H9), §4 (M4, M10, M11, M14),
      §5 (L8)
- [ ] Read the memory note (if you have access to prior session memory) on the `@erp/db` vitest
      barrel export bug — it documents the exact root cause found during this audit
- [ ] Run `git status --porcelain packages/db-client/src` and `git ls-files packages/db-client/src
      | grep -E '\.(js|d\.ts|js\.map|d\.ts\.map)$'` — confirm which compiled files are currently
      tracked in git before deleting anything
- [ ] Read `packages/db-client/src/schema/index.ts` and `src/index.ts` — the `export * from './X.js'`
      barrel chains using explicit `.js` specifiers
- [ ] Read `packages/db-client/.gitignore` (or the root `.gitignore`'s coverage of this path) —
      confirm `dist/` is excluded but `src/**/*.js` is not
- [ ] Read `packages/shared-types/src/` for the same stale-compiled-file pattern — the audit flagged
      this package as having a related-but-unconfirmed truncation bug; check if it has the same
      committed-compiled-file root cause
- [ ] Read `packages/platform-sdk/src/telemetry.ts` in full and `packages/platform-sdk/src/index.ts`
      to confirm `initializeTelemetry` is exported
- [ ] Grep all `apps/*/src/main.ts` for `initializeTelemetry` — confirm zero call sites
- [ ] Read `packages/platform-sdk/src/context.ts` in full — the `PlatformContext` interface (lines
      ~34-46) and `PlatformContextFactory.create()` (lines ~114-116, where feature flags are
      reconstructed per-request)
- [ ] Read `packages/platform-sdk/src/feature-flags.ts` in full — L1/L2 cache and
      `subscribeToInvalidations` (line ~109)
- [ ] Read `packages/event-bus-client/src/index.ts:30-39` (the dead stub) and confirm via grep that
      nothing except a dead vitest alias references `@erp/events`
- [ ] Read `packages/platform-sdk/src/database.ts:16-28` (`.raw` vs `.transaction()` session-GUC
      handling)
- [ ] Read `apps/production-service/src/main.ts:5,28-34` and `BarcodeService.ts:5,43-46`
- [ ] Read `packages/platform-sdk/src/index.ts:17-21` for `StorageClient`/`PlatformAttachments`
      exports not currently attached to `PlatformContext`
- [ ] Run `pnpm build` and `pnpm test` repo-wide — confirm a clean baseline before touching anything
      (this phase touches a shared package every service depends on — be extra careful)

---

## ═══════════════════════════════════════════
## PROJECT CONTEXT
## ═══════════════════════════════════════════

### Why C8 is dangerous, not just untidy
`export * from './auth.js'` with an explicit `.js` extension is the correct NodeNext/ESM convention
for TypeScript source that will later compile `auth.ts` → `auth.js`. The problem is **there is
already a stale, out-of-date `auth.js` physically sitting in `src/` right now**, committed to git.
Vite/Vitest's resolver, when it sees an explicit `.js` specifier, prefers a literal on-disk match
over TS-aware rewriting back to `auth.ts` — so depending on exact resolution order it can silently
load the stale compiled file instead of transpiling the current source. This isn't hypothetical:
the audit diffed them and found the committed `auth.js` is missing 3 real exports
(`activeSessions`, `securityAuditLog`, `blockedIps`) that exist in current `auth.ts`.

### Coding Standards
- TypeScript strict — no `any`
- Any change to `packages/platform-sdk` or `packages/db-client` requires running the FULL repo
  build+test after your change, not just the package itself — these are load-bearing for every
  service

---

## ═══════════════════════════════════════════
## OBJECTIVE
## ═══════════════════════════════════════════

1. **[C8, L8]** Remove stale compiled artifacts from `db-client/src` (and any other package with the
   same pattern), prevent recurrence
2. **[H4]** Activate OpenTelemetry tracing in every backend service
3. **[H9]** Attach `files` to `PlatformContext`; resolve or explicitly descope `metrics` /
   `notifications` / `search`
4. **[M4]** Migrate production-service off its raw `ioredis` client onto `ctx.cache`
5. **[M10]** Make the feature-flag L1 cache actually persist across requests; wire up hot-reload
6. **[M11]** Delete the dead `event-bus-client` package
7. **[M14]** Resolve the RLS session-GUC gap on non-transactional `ctx.db.raw` queries

---

## ═══════════════════════════════════════════
## SCOPE
## ═══════════════════════════════════════════

### Step 1 — Remove stale compiled artifacts [C8, L8]

1. Delete every tracked `.js`, `.d.ts`, `.js.map`, `.d.ts.map` file inside `packages/db-client/src/`
   (both `schema/` and the top-level `src/index.js`/`.d.ts`). Verify after deletion that
   `pnpm --filter @erp/db build` still produces a correct `dist/` (the actual compiled output
   belongs in `dist/`, not `src/`).
2. Add `src/**/*.js`, `src/**/*.js.map`, `src/**/*.d.ts`, `src/**/*.d.ts.map` to
   `packages/db-client/.gitignore` (create the file if it doesn't exist) — be careful not to
   accidentally ignore legitimately-hand-written `.js` files if any exist anywhere in this package
   (check first; if none exist, the broad pattern is safe).
3. Check `packages/shared-types/src/` for the identical pattern (the audit flagged a probable-same
   root cause behind the `@erp/types` truncation bug) — if stale compiled files are committed
   there too, apply the same fix.
4. Add a CI step (in `.github/workflows/ci.yml`, near the existing lint/build steps) that fails if
   `git status --porcelain` shows any `.js`/`.d.ts` file inside a `packages/*/src/` directory after
   a clean checkout — this prevents the bug from recurring via a future `tsc` run accidentally
   writing compiled output next to source instead of into `dist/`.
5. After cleanup, run every test suite that imports `@erp/db` or `@erp/types` via a value import
   (not just type-only) WITHOUT any `vi.mock('@erp/db', ...)` workaround temporarily removed, to
   confirm the real fix resolves the underlying issue rather than just removing the symptom the
   mocks were hiding. Restore the mocks afterward only if there's still a legitimate reason for
   them unrelated to this bug (document which, if any, in your completion report).

### Step 2 — Activate OpenTelemetry [H4]

In every `apps/*/src/main.ts` (all 15+ backend services), call `initializeTelemetry({ serviceName:
'<service-name>', ... })` from `packages/platform-sdk` at the very top of the file, before any other
imports execute significant side effects — check `packages/platform-sdk/src/telemetry.ts`'s exact
signature and required config (likely `OTEL_EXPORTER_OTLP_ENDPOINT` from env). Gate it so a missing
`OTEL_EXPORTER_OTLP_ENDPOINT` env var disables tracing cleanly (no crash) rather than failing
service startup — check whether `telemetry.ts` already handles this gracefully; if not, add the
guard.

Verify against the local Docker Compose stack (Jaeger is already running per
`docker-compose.yml:174-191`): after wiring, make a request through 2-3 services (e.g. create an
invoice, which touches sales-service → inventory-service/accounting-service via events) and confirm
spans actually appear in the Jaeger UI (`localhost:16686`).

### Step 3 — PlatformContext completeness [H9]

`packages/platform-sdk/src/context.ts:34-46`: attach `StorageClient`/`PlatformAttachments` (already
implemented, just not wired in) as `ctx.files`, matching the pattern of the other sub-clients
already attached.

For `metrics`, `notifications`, `search` (genuinely absent — no implementation files exist): do NOT
build full implementations in this phase — that's a larger scope than a hygiene/completeness pass.
Instead:
- Confirm whether services currently get `/metrics` and search functionality some other way (they
  do — `packages/logger`'s `createMetricsHandler` for metrics, direct calls to search-service's API
  for search, direct calls to notification-service's API for notifications). If so, this is a
  **documentation gap, not a functional gap** — update `ERP-PLANNING/ERP_MASTER_SPEC.md` §9's
  `PlatformContext` reference to either mark these three as "not implemented — access via direct
  service API instead" or remove them from the mandatory list, whichever the team decides is
  accurate. Do not silently leave the spec claiming something false.
- Record this decision explicitly in the completion report — this is a judgment call, not a
  mechanical fix, and the next engineer needs to know why the interface doesn't match the spec.

### Step 4 — production-service PlatformContext compliance [M4]

`apps/production-service/src/main.ts:5,28-34`: remove the direct `new Redis(...)` instantiation.
`apps/production-service/src/domain/BarcodeService.ts:5,43-46`: change its constructor/methods to
accept and use `ctx.cache` (the `TenantScopedCache` from `PlatformContext`) instead of a raw Redis
client. Update `apps/production-service/src/api/barcode.routes.ts` call sites accordingly. Confirm
tenant-namespacing now applies to whatever this service was caching (it wasn't getting the
`tenant:{id}:` prefix before — check whether that caused any actual cross-tenant cache collision in
existing barcode data, and note the finding either way).

### Step 5 — Feature flag cache fix [M10]

`packages/platform-sdk/src/context.ts:114-116`: `PlatformFeatureFlags` is currently constructed
fresh per `PlatformContextFactory.create()` call (i.e., per HTTP request), defeating its L1
in-memory cache. Hoist the `PlatformFeatureFlags` instance (or at minimum its L1 `Map`) to live at
the `PlatformContextFactory` level — constructed once per service process (or once per tenant if
tenant-scoping requires it; check the existing L1 key structure in `feature-flags.ts` to see
whether it already embeds `tenantId` in its cache keys, which would make a single shared instance
safe across tenants), and reused across `create()` calls rather than rebuilt each time.

Call `subscribeToInvalidations()` once at each service's bootstrap (`main.ts`, alongside the Step 2
telemetry init) rather than never, so the hot-reload pub/sub path the code already implements
actually does something.

### Step 6 — Delete dead package [M11]

Delete `packages/event-bus-client` entirely (confirmed dead — both `createEventProducer`/
`createEventConsumer` unconditionally throw, and grep found zero real importers, only a dead
vitest-config alias in `apps/auth-service`). Remove the dead alias from
`apps/auth-service/vitest.config.ts`. Remove any reference to `@erp/events` from root
`package.json` workspaces, `turbo.json`, or any Dockerfile that lists it. Search
`ERP-PLANNING/TECH_AUDIT.md` and update its §22 "Unused/Stub Dependencies" note to say this was
resolved (this audit doc is a living reference other sessions read — keep it accurate).

### Step 7 — RLS session-GUC gap [M14]

`packages/platform-sdk/src/database.ts:16-28`: `.raw` currently returns the plain pooled database
with no `app.current_tenant_id` session variable set; only `.transaction()` sets it. Investigate
whether Postgres RLS policies actually exist and depend on this GUC (check
`packages/db-client/migrations/*.sql` for `CREATE POLICY` / `ENABLE ROW LEVEL SECURITY`
statements — the audit did not confirm this either way for this specific package).
- If RLS policies exist and depend on the GUC: set it per-connection-checkout (e.g. in a
  `postgres.js` `onnotice`/connection-init hook, or by making `.raw` also wrap each call in a
  lightweight transaction) so `ctx.db.raw` reads get the same defense-in-depth as `.transaction()`
  writes.
- If no RLS policies exist yet (tenant isolation is enforced entirely by hand-written
  `WHERE tenant_id = ...` predicates): update `ERP_MASTER_SPEC.md` §4.2's claim that "PostgreSQL
  Row-Level Security enabled on all tables" to reflect reality, rather than leaving a false safety
  claim in the architecture bible. This is a security-relevant documentation correction — treat it
  with the same care as a code fix.

### OUT OF SCOPE
- Implementing full `metrics`/`notifications`/`search` sub-clients on `PlatformContext` — descope
  per Step 3, don't build
- Building actual RLS policies from scratch if they don't exist — that's a dedicated security
  hardening phase, not a hygiene pass (flag it in "Known Issues" if this is the case)

---

## ═══════════════════════════════════════════
## TESTING REQUIREMENTS
## ═══════════════════════════════════════════

1. A test importing a value symbol from `@erp/db` (e.g. `activeSessions`) without any `vi.mock`
   resolves correctly and matches the current schema — proves C8's fix
2. A manual/integration check: after Step 2, a real request produces a visible trace in Jaeger with
   spans from at least 2 different services for one request chain
3. `ctx.files` is present and functional on `PlatformContext` in a test
4. production-service's barcode caching goes through `ctx.cache` (mock/spy the cache client and
   assert it's called, with a tenant-prefixed key)
5. Feature-flag L1 cache: two sequential `ctx.features.isEnabled(...)` calls within the same process
   (simulating two requests) only hit Redis (L2) once, not twice — proves the cache now persists
6. `pnpm build` succeeds repo-wide with `event-bus-client` removed from the workspace (proves
   nothing was actually depending on it)

---

## ═══════════════════════════════════════════
## BUILD VERIFICATION
## ═══════════════════════════════════════════

```bash
pnpm install   # regenerate lockfile after removing event-bus-client
pnpm build     # full repo build — this phase touches shared packages, verify EVERYTHING still builds
pnpm --filter @erp/db build
pnpm --filter @erp/sdk build
pnpm --filter @erp/production-service build
pnpm lint
pnpm type-check
pnpm test   # full repo test suite — do not scope this down for this phase
```

---

## ═══════════════════════════════════════════
## VERIFICATION CHECKLIST
## ═══════════════════════════════════════════

- [ ] `git ls-files packages/db-client/src | grep -E '\.(js|d\.ts)$'` returns nothing
- [ ] CI has a guard preventing recurrence
- [ ] A real Jaeger trace is visible for a multi-service request chain
- [ ] `ctx.files` exists on `PlatformContext`; `ERP_MASTER_SPEC.md` §9 accurately reflects the
      status of `metrics`/`notifications`/`search`
- [ ] production-service has zero raw `ioredis`/`new Redis(` instantiations
- [ ] Feature-flag L1 cache demonstrably persists across simulated requests
- [ ] `packages/event-bus-client` no longer exists in the repo; full repo build succeeds without it
- [ ] `ERP_MASTER_SPEC.md` §4.2's RLS claim matches reality (either fixed in code or corrected in
      docs)

---

## ═══════════════════════════════════════════
## REGRESSION CHECKLIST
## ═══════════════════════════════════════════

- [ ] Every service still builds and starts (`pnpm dev` or equivalent smoke check) after the
      telemetry init is added — a bad `OTEL_EXPORTER_OTLP_ENDPOINT` config must not crash startup
- [ ] All existing `vi.mock('@erp/db', ...)` / `vi.mock('@erp/types', ...)` workarounds in test
      files still pass (removing the root cause doesn't require removing every mock immediately —
      only remove a mock if you've confirmed the real import now works correctly without it)
- [ ] production-service's barcode functionality behaves identically from the API caller's
      perspective after the `ctx.cache` migration
- [ ] Feature flags still correctly reflect DB-level changes (L2/Redis layer is unaffected by
      Step 5, only L1 behavior changes)

---

## ═══════════════════════════════════════════
## DEFINITION OF DONE
## ═══════════════════════════════════════════

- [ ] C8, H4, H9, M4, M10, M11, M14, L8 all closed per the fixes above (H9's `metrics`/
      `notifications`/`search` may be closed via documentation correction rather than
      implementation — that's an acceptable resolution per Step 3)
- [ ] Full repo `pnpm build`, `pnpm lint`, `pnpm type-check`, `pnpm test` all pass
- [ ] Completion report saved at `ERP-PLANNING/phase-completions/ES-25_COMPLETION.md`
- [ ] `ERP-PLANNING/ARCHITECTURE_AUDIT_REPORT.md` updated: mark C8, H4, H9, M4, M10, M11, M14, L8
      with current status and a pointer to the completion report

---

## ═══════════════════════════════════════════
## COMPLETION REPORT TEMPLATE
## ═══════════════════════════════════════════

**Save as:** `ERP-PLANNING/phase-completions/ES-25_COMPLETION.md`

```markdown
# ES-25 Completion Report — Platform SDK Completeness, Build Hygiene & Observability
**Date:** [YYYY-MM-DD]
**Status:** COMPLETE

## Findings Closed
| ID | Finding | Fix Summary | Verified By |
|---|---|---|---|
| C8 | Stale compiled artifacts committed | Deleted, gitignored, CI guard added | test + CI |
| H4 | OTel never initialized | initializeTelemetry() called in all main.ts | Jaeger trace screenshot/description |
| H9 | PlatformContext missing 4 sub-clients | files attached; metrics/notifications/search descoped + docs corrected | manual review |
| M4 | production-service raw ioredis | Migrated to ctx.cache | test |
| M10 | Feature flag L1 cache defeated per-request | Hoisted to factory level | test |
| M11 | Dead event-bus-client package | Deleted | build passes without it |
| M14 | RLS session-GUC gap on .raw queries | [fixed / documented as no-RLS-exists] | manual review |
| L8 | Duplicate stale artifact (index.js) | Same fix as C8 | - |

## Files Changed
[Table]

## Tracing Verification
[Describe what you saw in Jaeger for which request chain]

## Tests: [N]/[N] PASS | lint: PASS | type-check: PASS | build: PASS (full repo)

## Known Issues / Deferred
[e.g. if RLS policies don't exist at all, note that as a separate future security phase]
```
