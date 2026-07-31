# CRM-ROADMAP Phase 1, Feature 6 — DLT/TRAI SMS Compliance — Completion Report

**Date:** 2026-07-29
**Status:** Complete.

## Summary

The one Phase 1 item that's a legal requirement, not a product bet: India's TRAI regulation
requires promotional SMS to use pre-registered DLT (Distributed Ledger Technology) templates.
Nothing in this codebase enforced this before. Per AR-8, enforcement lives in
notification-service, not as a new CRM-domain concept:

- New shared `matchesDltTemplate()` in `packages/shared-utils` — DLT's `{#var#}` placeholder
  convention converted to a regex wildcard, escaping the literal portion so special characters
  (`.`, `%`, `(`, `)`, ...) are matched literally, not as regex syntax. Used by both the hard
  gate (notification-service) and the earlier best-effort check (sales-service) so there is
  exactly one matching algorithm, not two that could drift apart.
- New `crm_dlt_templates` table (`packages/db-client/src/schema/crm.ts`) — the only new
  CRM-side artifact, per AR-8: tenant-registered template ID/header/pattern/expiry. Admin-only
  CRUD (`apps/sales-service/src/api/dlt-template.routes.ts`) — this codebase never registers
  anything with DLT itself, it only records what a tenant has already registered out-of-band.
- **The hard, blocking gate**: `NotificationEngine.sendRaw()` (notification-service) now
  rejects — throws, never silently skips — any `channel: 'SMS'` send explicitly marked
  `category: 'PROMOTIONAL'` that doesn't match an active, non-expired registered template.
  Every existing caller of `sendRaw` (workflow reminders, credit-limit alerts, birthday
  greetings sent outside a campaign, ...) is completely unaffected: `category` defaults to
  `'TRANSACTIONAL'` when omitted, and only `CampaignService` explicitly sets `'PROMOTIONAL'`.
- **The earlier check**: `CampaignService.send()` now fails fast — before dispatching to any
  recipient — if an SMS campaign's rendered content doesn't match a registered template,
  instead of letting every recipient fail individually through the (now-authoritative)
  notification-service gate. `POST /crm/campaigns` (create) and `POST /crm/campaigns/preview`
  both surface DLT compliance at creation/preview time via the same shared check.
- Frontend: new `DltTemplatesPage.tsx` (admin-only registration UI), and `CampaignFormPage.tsx`
  now shows a specific DLT error inline at preview time and surfaces the real server error
  message (not a generic "Failed to create campaign" toast) if creation is rejected.

## Decisions / deviations (flagged during implementation, not silently decided)

1. **The "promotional vs. transactional" signal is a new explicit `category` field, not
   inferred from `channel` or `eventType`.** `sendRaw()` is shared by campaigns AND every
   other ad-hoc notification (workflow reminders, credit-limit alerts, ...) — gating by
   `channel === 'SMS'` alone would have blocked OTP/order-confirmation-style transactional SMS
   too. `category` defaults to `'TRANSACTIONAL'`, so every pre-existing caller needed zero
   changes; only `CampaignService` was updated to explicitly pass `'PROMOTIONAL'`.
2. **No cross-service HTTP call for the gate check** — same finding as Feature 5:
   notification-service already has direct Postgres access to `crm_dlt_templates` (same
   physical database), so the gate reads it directly rather than calling sales-service.
3. **`@erp/utils` added as a new dependency to notification-service** (it didn't have it
   before) specifically so `matchesDltTemplate` has exactly one implementation shared by both
   services, per this feature's own "one matching algorithm" requirement — a small, safe,
   additive `package.json` change, not a new abstraction invented for its own sake.
4. **Campaign creation IS blocked (not just warned)** for non-compliant SMS content, per the
   phase doc's literal Playwright scenario wording ("blocked at creation/preview time"). The
   pre-insert check in `POST /crm/campaigns` uses a synthetic rendered sample (no real
   recipient needs to be resolved just to validate template shape) so it works even for an
   empty-segment campaign.
5. **DLT templates page lives at `pages/crm/DltTemplatesPage.tsx`, not
   `pages/crm/settings/DltTemplatesPage.tsx`.** No `pages/crm/settings/` subfolder exists
   anywhere in this codebase — every CRM page lives flat under `pages/crm/` (same stale-path
   pattern found and worked around in every prior Phase 1 feature).
6. **Fixed a pre-existing gap while touching this code**: `CampaignFormPage.tsx`'s campaign
   creation error handler showed a hardcoded generic toast regardless of the actual server
   error — this would have silently swallowed the new DLT rejection message, defeating this
   feature's own "clear, specific error" requirement. Fixed to surface the real error message
   (matching a pattern already used elsewhere in the same file for media uploads).

## Acceptance Criteria

- [x] No promotional SMS can be sent from this platform without matching a tenant-registered
      DLT template — the hard gate in `NotificationEngine.sendRaw`, covered directly (rejects
      with zero templates, rejects with a non-matching template, rejects an expired template
      even if content would otherwise match).
- [x] Transactional SMS is unaffected — covered directly: `category` omitted (the default for
      every pre-existing caller) sails through regardless of what templates are or aren't
      registered.
- [x] Configure a DLT template → create an SMS campaign matching it → sends successfully —
      covered directly (`checkDltCompliance` returns compliant once a matching template
      exists; `sendRaw` accepts a matching promotional SMS end-to-end).
- [x] Non-matching SMS campaign content blocked at creation/preview time with a clear,
      specific error — `POST /crm/campaigns` throws `BusinessError('DLT_TEMPLATE_MISMATCH', ...)`
      before inserting anything; the frontend now surfaces that exact message instead of a
      generic failure toast.
- [x] A tenant with zero registered templates gets clean, actionable guidance, not a cryptic
      error — the specific message directs them to "register one in CRM Settings."
- [x] A template that's expired doesn't count as compliant — `expiresAt` checked defensively
      (nullable, since real DLT expiry semantics need provider-side confirmation, flagged as
      the phase doc's own stated edge case).
- [x] Explicit sign-off that the gate is blocking, not advisory — `NotificationEngine.sendRaw`
      **throws** (via `BusinessError`, mapped to a 422 by the shared error handler), it does
      not skip-with-a-warning; this is the literal DoD requirement for this feature.

## Verification performed this session

- `pnpm --filter @erp/db build` / `@erp/types build` / `@erp/utils build` — all clean.
- `pnpm --filter sales-service type-check` / `notification-service type-check` /
  `web-frontend type-check` — all clean.
- `eslint` scoped to every touched/new file — 0 errors (pre-existing-style warnings only).
- **Live migration** applied directly to the local dev Postgres:
  `0112_crm_dlt_templates.sql` and `0113_crm_dlt_permission_backfill.sql` (78 rows).
- `dlt-compliance.test.ts` (notification-service) — **10/10 passing**: 4 pure
  `matchesDltTemplate` matching-logic tests (including regex-special-character escaping) + 6
  `sendRaw` gate tests (no templates, non-matching, matching-succeeds, expired-template,
  transactional-unaffected, non-SMS-channel-unaffected).
- `campaign-service.test.ts` (sales-service) — **90/90 passing** (86 pre-existing + 4 new
  `checkDltCompliance` tests), confirming zero regression to the existing campaign test suite.
- **Full regression check across Features 1–6**: re-ran every prior feature's test file
  alongside this session's new ones — **130/130 passing, zero regressions**.
- `pnpm --filter @erp/types test -- route-guard-coverage` — `dlt-template.routes.ts` is
  **not** in the failure list; the test's 2 failures are the same pre-existing ones from
  every prior session in this roadmap.

## Files touched

- `packages/shared-utils/src/index.ts` — new `matchesDltTemplate`.
- `packages/db-client/src/schema/crm.ts` — `crmDltTemplates` table + type exports.
- `packages/db-client/migrations/0112_crm_dlt_templates.sql` — new table.
- `packages/db-client/migrations/0113_crm_dlt_permission_backfill.sql` — new; backfills
  `CRM_DLT_TEMPLATE_MANAGE` for existing tenants' OWNER/ADMIN/SUPER_ADMIN roles.
- `packages/db-client/migrations/meta/_journal.json` — appended entries.
- `packages/shared-types/src/permissions.ts` — new `CRM_DLT_TEMPLATE_MANAGE`.
- `apps/notification-service/package.json` — new `@erp/utils` dependency.
- `apps/notification-service/src/domain/NotificationEngine.ts` — `category` field on
  `SendRawInput`; the hard DLT gate in `sendRaw()`.
- `apps/notification-service/src/api/notification.routes.ts` — `category` added to
  `SendRawInternalSchema`.
- `apps/notification-service/src/__tests__/dlt-compliance.test.ts` — new; 10 tests.
- `apps/sales-service/src/api/dlt-template.routes.ts` — new; CRUD.
- `apps/sales-service/src/domain/CampaignService.ts` — new `checkDltCompliance` (exported) +
  `assertDltCompliant` (internal); `send()` fails fast pre-dispatch; `previewSample()` returns
  `dltCompliant`/`dltError`; every campaign send now tags `category: 'PROMOTIONAL'`.
- `apps/sales-service/src/api/crm.routes.ts` — pre-insert DLT block in `POST /crm/campaigns`.
- `apps/sales-service/src/main.ts` — registered `dltTemplateRoutes`.
- `apps/sales-service/src/__tests__/campaign-service.test.ts` — 4 new `checkDltCompliance` tests.
- `apps/web-frontend/src/api/endpoints.ts` — new `dltTemplateApi`.
- `apps/web-frontend/src/schemas/dltTemplate.schema.ts` — new.
- `apps/web-frontend/src/pages/crm/DltTemplatesPage.tsx` — new.
- `apps/web-frontend/src/pages/crm/CampaignFormPage.tsx` — DLT error surfaced at preview time;
  real server error message now shown on creation failure (was a hardcoded generic toast).
- `apps/web-frontend/src/lib/navigation.ts` — new "DLT Templates" nav item under CRM.
- `apps/web-frontend/src/App.tsx` — new `/crm/dlt-templates` route.

## What is not done (remaining TODO)

| Item                                                                                                   | Why deferred                                                                                                                               | Target                                                                         |
| ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------ |
| Playwright E2E specs for the 3 scenarios in the phase doc                                              | Not run this session (no browser harness invoked); logic covered instead by unit + live DB integration tests                               | Follow-up before Phase 1 sign-off                                              |
| Real DLT provider API integration (auto-checking expiry/registration status with the telecom operator) | Explicitly out of scope per AR-8 — "the code's job is to enforce the gate, not handle the registration process"                            | Not planned — this is a legal/config process, not a code gap                   |
| Documented emergency-override path for the blocking gate                                               | Phase doc explicitly calls this out as needing its own deliberate, audit-logged design ("not a casual flag flip") — not built this session | Follow-up before Phase 1 sign-off, if an emergency-send need is confirmed real |

## Deployment Checklist

- [ ] Run migrations `0112_crm_dlt_templates.sql` and `0113_crm_dlt_permission_backfill.sql`
      against every target database (staging/prod) — verified applied against the local dev
      DB this session only.
- [ ] **Every tenant currently running promotional SMS campaigns must register at least one
      matching DLT template before this deploys**, or their next campaign send will be
      rejected (by design — this is the point of the feature, but it's an operational
      heads-up, not just a code note).
- [ ] No new environment variables.
