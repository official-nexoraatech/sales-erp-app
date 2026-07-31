# CRM-ROADMAP Phase 3, Feature 2 — Self-Service Customer Portal — Completion Report

**Date:** 2026-07-30
**Status:** Code-complete, unit/integration-tested against a real local Postgres, zero
regressions confirmed in every touched service's full test suite. **A dedicated human security
review is still required before production** — this is the roadmap's own explicitly-named
highest-risk item (first non-employee authenticated surface in the codebase), and no amount of
this session's own testing substitutes for that independent pass. This report is written so a
reviewer can re-verify the findings below directly.

## Summary

Introduces a brand-new `CUSTOMER` auth role and a fully separate customer-facing frontend app,
following the approved plan at (session-local) `elegant-giggling-frost.md`. Every prior
CRM-ROADMAP feature this session assumed the caller is always a staff employee; this one breaks
that assumption for the first time.

### Backend

- **Schema** (migration `0134_customer_portal_accounts.sql`): `crm_portal_accounts`,
  `crm_portal_refresh_tokens`, `crm_portal_password_tokens` (mirror `users`/`refresh_tokens`/
  `password_reset_tokens` shapes). `crm_tickets.created_by` made nullable + new
  `created_by_portal_account_id` column, so a portal-raised ticket doesn't need a fake staff
  `users.id`.
- **Permissions** (migration `0135_customer_portal_permission_backfill.sql` + `role-defaults.ts`):
  `PORTAL_ACCOUNT_MANAGE` (staff provisioning, OWNER/ADMIN/SUPER_ADMIN) and
  `IMPERSONATE_PORTAL_CUSTOMER` (kept separate from `IMPERSONATE_USER`, deliberately withheld from
  ADMIN — same sensitivity precedent as staff impersonation).
- **Finding 1 (the fix that changed the plan's shape): hardened all 14 services'
  `apps/*/src/middleware/authenticate.ts`** to reject any `roles: ['CUSTOMER']` JWT with 401,
  _before_ the new role became valid anywhere. Confirmed via direct code read that none of these
  files previously checked `roles` at all — several have `KNOWN_EXCEPTIONS`-listed self-service
  routes (auth-service sessions, notification-service inbox, hr-service employee self-service,
  event-service DAP, tenant-service approvals) that trust `request.auth.userId` as a real employee
  id with zero further check. Since this codebase has no DB-level foreign keys and both `users`
  and `crm_portal_accounts` are `bigserial` starting at 1 per tenant, a portal account's numeric id
  could otherwise coincidentally reach a real employee's own data on an entirely different
  service. Verified with 5 new cross-service tests (see Testing).
- **`apps/auth-service/src/routes/portal-auth.routes.ts`** (new): `POST /auth/portal/set-password`
  (consumes an invite token, mirrors `reset-password.ts`), `/login` (argon2, IP-based
  brute-force protection reused from `suspicious-login.ts`, issues `roles:['CUSTOMER']` +
  `customerId`), `/refresh` (own `portal_refresh_token` cookie, scoped to
  `/api/auth/auth/portal`, deliberately narrower than the staff cookie's `/api/auth`), `/logout`.
  Portal auth events are logged to `security_audit_log` with `actorId: 0` (the existing
  `SUSPICIOUS_LOGIN` sentinel convention) — a portal account id is never written into an
  employee-shaped `actorId`/`targetUserId` field, only into free-form `details`.
- **`apps/auth-service/src/routes/portal-impersonate.routes.ts`** (new):
  `POST /admin/impersonate/portal-customer`, gated by `IMPERSONATE_PORTAL_CUSTOMER`, issues a
  short-lived (1hr) access-token-only credential (no refresh token). Deliberately has **no**
  companion `/end` route — unlike staff impersonation, the token itself is CUSTOMER-role and so
  is rejected by every staff service's own hardened `authenticate.ts`; it simply expires.
- **`apps/sales-service/src/api/customer.routes.ts`**: new
  `POST /customers/:id/portal-account` (staff-only, `PORTAL_ACCOUNT_MANAGE`) — idempotent
  provision-or-reinvite, unusable placeholder password hash until the customer completes
  set-password, fire-and-forget invite email via `send-raw-internal` (same pattern as
  `InvoiceNotificationService`, not the DB-templated `send-internal` path, which would need a
  default template seeded per tenant first).
- **`apps/sales-service/src/api/portal.routes.ts`** (new) + **`middleware/portal-auth.ts`** (new
  `requirePortalAuth` preHandler, the customer-facing mirror of `authenticate.ts`): `GET /portal/me`,
  `orders`, `orders/:id`, `tickets` (list/create/detail/messages), `loyalty`, `referral`,
  `preferences` (get/put). **Finding 3**: every route uses the raw `ErpDatabase` handle directly,
  never `PlatformContextFactory`/`PlatformContext` — that factory has no portal-actor concept and
  would force a numeric portal-account id through an employee-shaped audit/event path, silently
  mis-attributing it. Every route filters `customerId`/`tenantId` only from the verified JWT claim;
  an ownership mismatch always 404s, never 403 (a 403 would itself confirm the row exists for
  someone else).
- **Gateway**: 4 new `EXEMPT_PATHS` entries for the public portal-auth routes.
- **`TicketService.create`/`addMessage`** extended: `createdBy` now optional alongside
  `createdByPortalAccountId`; `authorId` now accepts `null` for a portal-authored reply (the
  existing `authorName` denormalized-snapshot design already handled "no live users.id to join
  against").

### Frontend

New standalone `apps/customer-portal` app (port 5176), following the `pos-frontend` precedent for
"a second user-facing surface with a different auth/session model" rather than a route-tree
bolted onto `web-frontend` (whose `api/client.ts` hardcodes its own auth store with no injection
point). Own `portalAuth.store.ts` (Zustand, access token in-memory only, never persisted — same
hardening `web-frontend`'s own audit already applied), own `portalApiClient.ts`. Pages: login,
set-password, an impersonation entry point (`/impersonate-entry?token=`) for staff "view as this
customer", dashboard (order list), order detail, tickets (list/create/detail/reply), loyalty,
referral, preferences.

## Decisions / deviations (flagged, not silently decided)

1. **No staff-side "impersonate as customer" UI button was built in `web-frontend`.** The backend
   route and the portal-side entry page exist; wiring a trigger into the staff Customer 360 page
   is a reasonable, small follow-up but wasn't in the plan's own 10-step list.
2. **No account-level login lockout for portal accounts** (`crm_portal_accounts` has no
   `failedLoginAttempts`/`lockedUntil` columns). Brute-force protection instead reuses the
   existing IP-based `checkIpBlocked`/`recordFailedLoginAndMaybeBlock` (generic, not table-specific,
   already used by staff login). A per-account lockout is a reasonable future hardening but adds
   schema scope this pass didn't need.
3. **No Prometheus metric for portal login success/failure** — logged via the structured logger
   instead. Reusing the staff `erpAuthLoginTotal` metric would have mixed portal and staff counts
   under one series; adding a new metric was deferred as unnecessary scope for this pass.
4. **`send-raw-internal` (pre-rendered body) used for the portal invite email, not
   `send-internal`'s DB-templated `eventType` lookup** — the latter needs a default
   `notification_templates` row seeded per tenant, which doesn't exist for a new `eventType` yet.
   Matches `InvoiceNotificationService`'s own existing precedent in this exact service.
5. **Referral share link uses the gateway-fronted `GET /api/sales/r/:code` URL**, matching the
   existing format `web-frontend`'s `CustomerViewPage.tsx` already uses for the same data — not
   this new app's own origin, which has no such route.

## Findings from planning, now verified in code

- **Finding 1** (cross-service role-collision risk): fixed in all 14 `authenticate.ts` files;
  proven with 5 new tests spinning up each flagged service's actual `KNOWN_EXCEPTIONS` route file
  wired exactly the way that service's own `main.ts` wires it.
- **Finding 2** (`crm_tickets.created_by` NOT NULL): fixed via migration; proven by
  `portal-ticket-appears-in-staff-inbox.test.ts`.
- **Finding 3** (`PlatformContext`/audit-log actor mis-attribution risk): avoided by design —
  portal routes never construct a `PlatformContext` at all.

## Testing performed this session

- `pnpm --filter @erp/types build` / `@erp/db build` / `@erp/sdk build` — clean, after schema/
  permission/JWT-payload changes.
- `pnpm --filter <service> type-check` — clean on all 14 touched services, `api-gateway`,
  `tenant-service`, and the new `customer-portal` app.
- Both migrations live-applied to the local dev Postgres (see "DB migration bookkeeping" finding
  below for why this needed an unplanned detour) — confirmed via direct schema introspection:
  3 new tables exist, `crm_tickets.created_by`/`created_by_portal_account_id` nullable/present,
  78 `PORTAL_ACCOUNT_MANAGE` + 52 `IMPERSONATE_PORTAL_CUSTOMER` role grants backfilled.
- **New tests, all passing against the real local Postgres**:
  - `apps/sales-service/src/__tests__/portal-auth-middleware.test.ts` (6 tests) —
    `requirePortalAuth` claim-extraction edge cases: no header, malformed token, expired token,
    non-CUSTOMER role, CUSTOMER role missing `customerId`, valid pass-through.
  - `apps/sales-service/src/__tests__/portal-auth-boundary.integration.test.ts` (9 tests) — the
    single highest-value test in the feature per the plan: two real seeded customers, a
    parameterized route table over every `:id`-scoped portal route asserting customer A gets 404
    on customer B's order/ticket/ticket-messages (never 403), a self-defending meta-assertion
    that scrapes `portal.routes.ts` for `:id` routes and fails if the table's length drifts, list
    endpoints proven to never leak the other customer's rows, a staff-shaped token rejected on
    every portal route, and a positive control.
  - **5 new cross-service Finding-1 tests**, one per flagged `KNOWN_EXCEPTIONS` file, each
    building the real route with that service's own real `authenticate` and real registration
    convention (scoped hook vs. per-route vs. whole-file hook) and asserting a CUSTOMER-role JWT
    is rejected while a staff token is not: `auth-service` (`sessions.routes.ts`), `hr-service`
    (`employee-self-service.routes.ts`), `event-service` (`dap.routes.ts`), `tenant-service`
    (`approval.routes.ts`), `notification-service` (`notification.routes.ts`).
  - `portal-ticket-appears-in-staff-inbox.test.ts` — a portal-created ticket (`createdBy` null,
    `createdByPortalAccountId` set) shows up in the staff `GET /tickets` inbox unchanged.
  - Extended `campaign-service.test.ts`'s existing granular-consent describe block with one new
    case proving a `consentSource: 'CUSTOMER_PORTAL'` opt-out is honored by
    `applyGranularConsentFilter` identically to a staff-recorded one — confirmed by code read
    that this filter never branches on `consentSource` at all, only channel/category/consented.
  - `route-guard-coverage.test.ts` and `dead-permission-constants.test.ts` both pass with the new
    `requirePortalAuth` marker and the 2 new permission constants.
- **Full regression sweep, all touched services, real DB where applicable**: `auth-service` (63
  tests), `api-gateway` (51), `tenant-service` (53 + 9 skipped), `hr-service` (79),
  `event-service` (30 + 3 skipped), `notification-service` (93 + 3 skipped), `accounting-service`
  (69 + 7 skipped), `inventory-service` (41 + 15 skipped), `sales-service` (515 of 516 — see below)
  — **zero regressions from this feature's changes** in any of them.

## Two significant pre-existing issues found incidentally (not part of this feature, not fixed)

1. **`packages/db-client/migrations/meta/_journal.json` had a UTF-8 BOM**, silently breaking
   `drizzle-kit migrate`'s JSON parsing entirely (a bare `JSON.parse` on the file, no BOM
   handling) — every `db:migrate` invocation for a while has been failing with a swallowed error
   (the CLI's own spinner hides it). **Fixed** (BOM stripped) since it directly blocked verifying
   this feature's own migrations.
2. **Even with the BOM fixed, `db:migrate` still applied nothing**: migration idx 87
   (`0087_hr_employee_user_link_self_service`) was assigned a `when` timestamp
   (`1790109335804`) far in the future relative to every migration after it — drizzle's migrator
   only compares against the single most-recently-applied migration's timestamp, so every
   migration from 88 onward is silently skipped forever once 87 is the last one recorded. Schema
   through migration 133 already exists in the local dev DB regardless (applied via some other,
   undiscovered mechanism this session didn't need to identify), meaning `db:migrate` itself has
   likely been a no-op in this environment for a long time. **Not fixed** — rewriting historical
   migration timestamps is a bigger, riskier, unrelated change; this feature's own two migrations
   were applied by executing their SQL directly instead. Flagged for a dedicated follow-up.
3. **Rebuilding `@erp/sdk` (needed for this feature's `customerId` JWT-payload addition) surfaced
   ~40 pre-existing test failures across `sales-service`'s suite** (permission-guard tests in
   `crm-campaign-permission-guards.test.ts`, `quotation-sale-return-permission-guards.test.ts`,
   `payment-view-permission-guard.test.ts`, `permission-guards.test.ts`, `pos-branch-isolation
.test.ts`, `sync-routes(.integration).test.ts`, and the equivalent in `hr-service`'s
   `permission-guards.test.ts`) — all fail identically (401 instead of an expected 403/200).
   Root cause: these test files sign tokens with issuer `'erp-test'` but never set
   `process.env.JWT_ISSUER` to match; `@erp/sdk`'s `verifyAccessToken` already enforces issuer
   matching in its _source_, but the previously-stale compiled `dist/` apparently didn't, masking
   the mismatch until a fresh build (which `turbo test`'s own `dependsOn: ["^build"]` would
   already trigger in a correct CI run). Confirmed by setting `JWT_ISSUER=erp-test` for the test
   run: all ~40 failures disappear. **Not fixed** — updating every affected test file's `beforeAll`
   is valuable but unrelated, unbounded, monorepo-wide scope; flagged as its own follow-up.
   One additional, unrelated, genuinely-different failure was found in `loyalty-service.test.ts`
   (a tier-demotion-on-redemption assertion) — pre-existing, uncommitted from earlier
   CRM-ROADMAP Phase 2 Feature 3 work, not touched by this feature.

## What is not done (remaining TODO)

| Item                                                                          | Why deferred                                                                                    | Target                                     |
| ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------ |
| Human security review sign-off                                                | Explicitly required by the roadmap's own DoD; no amount of automated testing substitutes for it | Before any production exposure             |
| Staff-side "impersonate as this customer" UI trigger                          | Backend route + portal entry page exist; not in the plan's own file list                        | Follow-up                                  |
| Portal account-level lockout                                                  | IP-based protection reused instead; schema has no lockout columns                               | If real abuse patterns emerge              |
| Fix the ~40 issuer-mismatch test failures in sales-service/hr-service         | Real, valuable, but unrelated monorepo-wide scope                                               | Dedicated follow-up pass                   |
| Fix migration-journal timestamp ordering (idx 87) so `db:migrate` works again | Rewriting historical migration timestamps is riskier than it's worth right now                  | Dedicated follow-up pass                   |
| Manual on-device / real-browser verification of `apps/customer-portal`        | Not run this session (dev server not started)                                                   | Before this feature ships to a real tenant |

## Deployment Checklist

- [ ] Run migrations `0134_customer_portal_accounts.sql` and
      `0135_customer_portal_permission_backfill.sql` against every real tenant's database —
      **`db:migrate` is currently broken in this environment** (see the journal-timestamp finding
      above); apply the SQL files directly if the migrate CLI still doesn't work by then.
  - Note: the `_journal.json` BOM fix in this same change set is required for `db:migrate` to even
    parse the file; the timestamp-ordering issue is separate and still unresolved.
- [ ] Set `CUSTOMER_PORTAL_URL` in production environment config (defaults to
      `http://localhost:5176`, wrong for any deployed environment).
- [ ] Add `apps/customer-portal`'s deployed origin to `ALLOWED_ORIGINS` in production config.
- [ ] Deploy/host the new `apps/customer-portal` frontend app (no CI/deploy pipeline wiring was
      part of this session's scope — confirm one exists before this ships).
- [ ] Complete the human security review this report's own header calls out before enabling
      portal-account provisioning for any real tenant.
