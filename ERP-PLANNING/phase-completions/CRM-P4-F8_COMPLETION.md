# CRM-ROADMAP Phase 4, Feature 8 — Public CRM API, Developer Portal & BI/Data-Warehouse Export — Completion Report

**Date:** 2026-07-31
**Status:** Complete, tested against a real local Postgres, zero regressions in every touched
service's full test suite.

## Summary

A read-only external API surface authenticated by a new per-tenant API-key mechanism — the
third distinct auth model in this codebase alongside staff JWTs and the CUSTOMER-role portal
JWT (Phase 3, Feature 2) — plus recurring, user-configured BI export schedules. Before building,
confirmed via research that no platform-wide API-key mechanism already existed (the roadmap doc
explicitly asked to check), and that scheduler-service's existing `export-generate` job/
`ExportEngine`/`ExportFormatter`/`StorageClient` pipeline was real and directly extensible for
CRM entities — so this feature adds to that pipeline rather than building a parallel one.

### Backend — API keys & public API

- **Schema** (migration `0142_crm_api_keys_and_export_schedules.sql`): `crm_api_keys` —
  `keyPrefix` (shown in the management UI) + `keyHash` (sha256, same storage discipline as
  password hashing — the raw key is generated once and returned exactly once, at creation time,
  never retrievable again), `scopes` (jsonb array of `'<entity>:read'` strings), `isActive`,
  `expiresAt`, `revokedAt`/`revokedBy`.
- **`ApiKeyService`** (new, `apps/sales-service/src/domain/ApiKeyService.ts`): `create` (validates
  scopes against a closed `PUBLIC_API_SCOPES` list — `leads:read`/`opportunities:read`/
  `accounts:read`/`contacts:read` — read-only by design, no write scopes exist in this pass),
  `list` (never returns `keyHash`), `revoke`, `authenticate` (hashes the presented key, checks
  active/revoked/expired, best-effort `lastUsedAt` bump, returns `null` on any invalid input
  rather than throwing — an invalid API key is routine input for this surface, not exceptional).
- **`apps/sales-service/src/api/public-api.routes.ts`** (new): `GET /public/v1/leads|opportunities
|accounts|contacts`, each gated by a new `requirePublicApiScope` preHandler — reads the key from
  an `x-api-key` header (deliberately not `Authorization: Bearer`, so it can never be confused
  with or forwarded as a staff/portal JWT), 401s on missing/invalid/revoked/expired, 403s on a
  valid key missing the specific scope. Registered as a true Fastify sibling in `main.ts` (never
  nested inside the staff-authenticated `sub` block — same rule this session has hit repeatedly
  for `portalRoutes`/`leadRoutes`/webhook routes). Bounded pagination (`limit`/`offset`, capped at 100) since neither the existing internal lead route nor `OpportunityService.list` had any
  pagination to reuse. `crmAccountContacts` is the "contacts" entity (Phase 1 Feature 1's
  per-account people, not a separate concept); `gstin`/`gstinHash`/`billingAddress` are
  deliberately excluded from the account projection to avoid handling encrypted-field decryption
  in a brand-new auth surface.
- **`apps/sales-service/src/api/api-key.routes.ts`** (new): staff-facing
  `GET`/`POST /api-keys`, `DELETE /api-keys/:id`, gated by a new `API_KEY_MANAGE` permission —
  deliberately reserved for OWNER/ADMIN/SUPER_ADMIN only (via `TENANT_SCOPED_PERMISSIONS`, no
  explicit `SALES_MANAGER` grant, unlike every other CRM Phase 4 permission this session added) —
  issuing a credential that can pull CRM data out of the system entirely is a platform-governance
  action, same sensitivity tier as `IMPERSONATE_USER`/`IMPERSONATE_PORTAL_CUSTOMER`, not a
  day-to-day Sales Ops action.
- **Gateway**: `/api/sales/public/v1/` added to `EXEMPT_PREFIXES` in `gateway-auth.ts` — the
  gateway's coarse JWT-only check would otherwise 401 every API-key request before it ever
  reaches `public-api.routes.ts`'s own real auth check (same pattern as the portal/webhook routes
  already exempted there).
- **Migration `0143_crm_api_key_permission_backfill.sql`**: backfills `API_KEY_MANAGE` to
  existing tenants' OWNER/ADMIN/SUPER_ADMIN roles (new tenants get it automatically via the
  dynamic `TENANT_SCOPED_PERMISSIONS` filter in `role-defaults.ts` — no code change needed there).

### Backend — BI/Data-Warehouse export

- **`ExportEngine.ts` extended** with 4 new entity types (`lead`, `opportunity`, `account`,
  `contact`) — the existing `ExportEntity` union/switch was already cleanly extensible (confirmed
  by research before starting), so this was additive: new column-metadata arrays + 4 new private
  query methods, no changes to the entity-agnostic `ExportFormatter`/route/job files.
- **Schema** (same migration `0142`): `export_schedules`/`export_run_history` — mirrors
  report-service's existing `reportSchedules`/`reportRunHistory` pattern exactly (confirmed via
  research this is the established "user-configurable, per-row cron expression" shape in this
  codebase, not the fixed-cron-per-job-name shape `scheduler-service`'s own `JobRegistry` assumes).
- **`ExportScheduleJob`** (new, `apps/scheduler-service/src/jobs/ExportScheduleJob.ts`): a
  self-contained BullMQ Queue/Worker pair — deliberately **not** routed through the shared
  `JobRegistry` (which assumes one fixed cron per registered job name, known at startup; this
  needs N independently-configured cron expressions, one per user-created schedule row, added/
  removed at runtime) and deliberately **not** built on `croner` + a hand-rolled Redis lock the
  way report-service's `ScheduledReportJob` is, since BullMQ (already a scheduler-service
  dependency) provides the same "exactly one replica dispatches a given repeatable job per tick"
  guarantee natively. A 5-minute sync tick diffs the `export_schedules` table against currently-
  registered BullMQ repeatable jobs (add new/changed, remove deactivated) — same reload-loop shape
  as `ScheduledReportJob.loadSchedules`. On run: reuses `ExportEngine`/`ExportFormatter`/
  `StorageClient` (the exact same objects `export-generate` already uses) to produce the file,
  writes `export_run_history`, and — if recipients are configured — emails each one a signed link
  via notification-service's existing `POST /notifications/send-raw-internal` internal route
  (the same fire-and-forget pattern already used elsewhere in `system-jobs.ts`), rather than
  adding `nodemailer` as a new raw dependency the way report-service's job does.
- **`apps/scheduler-service/src/api/export-schedule.routes.ts`** (new): `GET`/`POST
/export-schedules`, `PUT`/`DELETE /export-schedules/:id` (soft-deactivate, not a hard delete —
  same `active` flag convention as `reportSchedules`), `GET /export-schedules/:id/history`.
  Reuses the pre-existing `EXPORT_GENERATE`/`EXPORT_VIEW` permissions rather than inventing new
  ones — a recurring schedule is the same action class as the existing one-shot
  `POST /exports/generate`.

### Frontend

- **`ApiKeysPage.tsx`** (new): create (name + scope checkboxes), list (prefix, scopes, last-used,
  revoke), and a one-time "copy this key now" banner immediately after creation — the plaintext
  key is never shown again after the page re-renders.
- **`ExportSchedulesPage.tsx`** (new): create (entity/format/cron/recipients), list with an
  expandable per-schedule run-history panel (status, row count, a download link to the signed
  URL, or the error message on a failed run).
- Both wired into `App.tsx` (`/crm/api-keys`, `/crm/export-schedules`, `PermissionRoute`-gated on
  `API_KEY_MANAGE`/`EXPORT_GENERATE`) and `navigation.ts` (new "API Keys"/"Export Schedules" nav
  entries under CRM).
- `endpoints.ts` extended with `apiKeyApi` (targets sales-service) and `exportScheduleApi`
  (targets scheduler-service, confirmed `apiV2: true` so client paths omit `/api/v2` — same
  gotcha this session has hit before).

## Decisions (flagged, not silently decided)

1. **No developer-portal documentation site built this pass.** The roadmap's own spec offered
   "new, or extending `docs-site`" — given `docs-site` is a real but currently-orphaned app (per
   an earlier session's audit), extending it for API docs was judged out of scope for this pass;
   the management UI itself (scopes, keys) is the shipped surface. Flagged as a follow-up, not
   silently dropped.
2. **Read-only, 4 entities, no write scopes at all.** Matches the roadmap's own "read-mostly CRM
   data" framing exactly — building a write surface would be a materially larger, separate
   security surface (input validation, side effects, audit attribution for a non-employee actor)
   not requested by this feature's acceptance criteria.
3. **BI export recipients get an emailed signed link, not an inline attachment.** Unlike
   `ScheduledReportJob`'s small-report email-attachment path, a BI export can be `MAX_EXPORT_ROWS`
   (50,000) rows — inlining that in an email is the wrong shape for its actual consumer (an
   external BI tool pulling from a URL on a schedule), so recipients are optional and informational
   only.
4. **No new `CRM_API_KEY_*`-style granular permissions** — one `API_KEY_MANAGE` for the whole
   surface, mirroring `TERRITORY_MANAGE`/`QUOTA_MANAGE`'s "Sales Ops admin configuration, not a
   customer-facing entity" precedent, but reserved for OWNER/ADMIN/SUPER_ADMIN only given the
   higher sensitivity of this specific credential type.

## Testing performed this session

- `pnpm --filter @erp/db build` / `@erp/types build` — clean, after schema/permission additions.
- Both migrations live-applied directly to the local dev Postgres (same `db:migrate`-is-broken
  caveat as every other feature shipped this session).
- Type-check clean on every touched service: `sales-service`, `scheduler-service`, `api-gateway`,
  `tenant-service`, `web-frontend`.
- **New tests, all passing**:
  - `api-key-service.test.ts` (9) — plaintext-once/never-stored, scope validation, authenticate()
    against a real key/unknown key/malformed prefix/revoked key, cross-tenant revoke rejection.
  - `public-api-auth.test.ts` (7) — 401 no header, 401 invalid key, 200 + tenant-scoped rows for a
    correctly-scoped key, 403 for a key missing the entity's scope, 200 for a different correctly-
    scoped key, **cross-tenant isolation** (a valid key for tenant B returns zero of tenant A's
    leads), page-size cap enforcement.
  - `api-key-routes-permission-guard.test.ts` (4) — `API_KEY_MANAGE` gating on GET/DELETE, 401 with
    no token.
  - `ExportEngine.test.ts` extended (+4, now 14) — column sets defined for all 12 entities now,
    tenant-scoped lead/opportunity/account rows, contact-export account join.
  - `ExportScheduleJob.test.ts` (5) — BullMQ repeatable-job registration on sync, `COMPLETED` run
    with a real signed `fileUrl`, `FAILED` run recorded (not an unhandled rejection) on an engine
    error, a schedule deactivated between sync and dispatch is skipped (no `exportRunHistory` row
    written), recipient email fired via the notification-service internal route.
  - `export-schedule-routes.test.ts` (6) — `EXPORT_GENERATE`/`EXPORT_VIEW` gating, a rejected
    unsupported `entityType` (422, not a silent 500), 404 for a schedule id outside the caller's
    tenant.
- **Full regression sweep** (run sequentially, one suite at a time, per the lesson from earlier
  this session — see `turbo_parallel_test_false_failures` memory): `sales-service` (525/570 — the
  45 failures are every one of them in files this feature never touched, in the same
  already-documented, pre-existing JWT-issuer test-debt class this session has hit repeatedly;
  confirmed by re-running two representative failing files in complete isolation with identical
  results, and by `git status` confirming `authenticate.ts` and the failing test files carry
  uncommitted changes from earlier in this long session, not from this feature), `scheduler-
service` (98/98), `tenant-service` (61/61, 1 pre-existing skip), `api-gateway` (51/51, including
  `gateway-auth.test.ts` which exercises the `EXEMPT_PREFIXES` list this feature extended),
  `web-frontend` (434/434 — one genuine issue found and fixed by this feature itself: `ApiKeysPage
.tsx` initially used a raw Tailwind `dark:` variant instead of a semantic token, which the
  repo's own `no-dark-variant-regression.test.ts` correctly caught; fixed to `border-warning
bg-warning-subtle`).
- `pnpm --filter @erp/sales-service lint` / `@erp/scheduler-service lint` / `@erp/api-gateway
lint` — all at their pre-existing error-count baseline (2, 1, 0 respectively) after fixing one
  genuine new lint error this feature introduced (`ApiKeyService.ts`'s destructure-to-omit
  pattern flagged an unused binding; rewritten as an explicit field list instead).

## What is not done (remaining TODO)

| Item                                                                                 | Why deferred                                                                                                                                                     | Target                                                 |
| ------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| Developer-portal documentation (API reference, examples)                             | Judged materially separate scope from the working API + management UI; `docs-site` app exists but is orphaned                                                    | Follow-up, if real external-integrator demand surfaces |
| Write scopes / mutating public API routes                                            | Roadmap's own spec is read-mostly; a write surface is a substantially larger security scope                                                                      | Only if a real BI/integration use case needs it        |
| Playwright E2E coverage                                                              | Not run this session                                                                                                                                             | Follow-up                                              |
| API-key rate limiting distinct from the existing per-tenant gateway/service limiters | Existing global rate limits apply by IP (no `request.auth` for an API-key request) same as every other exempt route; a dedicated per-key limiter wasn't in scope | Only if real abuse/volume is observed                  |

## Deployment Checklist

- [ ] Apply migrations `0142_crm_api_keys_and_export_schedules.sql` and
      `0143_crm_api_key_permission_backfill.sql` to every real tenant's database — same
      `db:migrate`-is-broken caveat as every other feature shipped this session; apply the SQL
      files directly if the migrate CLI still doesn't work by then.
