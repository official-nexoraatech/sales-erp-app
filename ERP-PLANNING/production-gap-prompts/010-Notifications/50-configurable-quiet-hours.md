# [PG-047] Configurable Quiet Hours (currently hardcoded IST)

> Template version 1.0. Every gap-prompt file in this tree must follow this exact section order. Do not add sections; do not omit sections that apply. If a section genuinely does not apply to this gap, write "Not applicable — <one-line reason>" instead of deleting it, so the structure stays diffable across files.

**Category:** Notifications
**Priority:** Low
**Complexity:** S — no schema change is required for the tenant-level default (the existing `feature_flags.config` jsonb column already fits); the change is a small refactor of one pure function plus a lookup, and a genuine (previously undiscovered) dead-column wiring fix for the per-user override.
**Depends on:** none
**Blocks:** none
**Primary service(s)/package(s):** apps/notification-service (src/domain/NotificationEngine.ts, src/api/notification.routes.ts)

---

## Overview

- **Business objective:** SMS notifications are suppressed between 22:00 and 08:00 IST — a reasonable default so a tenant's customers don't get promotional/reminder SMS at 2am. Today this window is a hardcoded module-level constant with no way for any tenant to change it, regardless of their actual business hours, customer base timezone expectations, or SMS-provider-cost tolerance for stricter/looser quiet hours. This is Low priority (a hardcoded sensible default is not a production blocker) but it is a real configurability gap once any tenant asks "why can't I turn this off for my urgent SMS" or "our customers are fine getting SMS until 23:00" — and, as this pass discovered, part of the fix (a per-user opt-out) already has UI-facing plumbing that is silently dead.
- **Current implementation:** confirmed by direct read of `apps/notification-service/src/domain/NotificationEngine.ts`, lines 57-65:
  ```ts
  const QUIET_HOURS_START = 22; // 22:00 IST
  const QUIET_HOURS_END = 8;    // 08:00 IST

  function isQuietHours(): boolean {
    const now = new Date();
    const istOffset = 5.5 * 60 * 60 * 1000;
    const istTime = new Date(now.getTime() + istOffset);
    const hour = istTime.getUTCHours();
    return hour >= QUIET_HOURS_START || hour < QUIET_HOURS_END;
  }
  ```
  `isQuietHours()` takes **no arguments** — no `tenantId`, no `userId`, nothing — and is called unconditionally at two call sites: `send()` (line 120: `if (channel === 'SMS' && isQuietHours())`) and `sendRaw()` (line 207: same check). It is structurally incapable of varying by tenant today; it is a pure, global, IST-only function.
- **A more interesting finding than the task's framing suggests — a dead per-user override column:** `packages/db-client/src/schema/notification.ts`, the `notificationPreferences` table (lines 86-107), already has a `quietHoursEnabled: boolean('quiet_hours_enabled').notNull().default(true)` column. `apps/notification-service/src/api/notification.routes.ts` (lines 62, 233, 247) already accepts `quietHoursEnabled: z.boolean().optional()` in its preference-update request schema and **writes** it to the `notificationPreferences` row. But `NotificationEngine.send()` (the only method that reads `notificationPreferences` at all, lines 88-110) only ever reads `p.smsEnabled`/`p.emailEnabled`/`p.whatsappEnabled`/`p.inAppEnabled` into its `prefs` object (lines 103-108) — **`p.quietHoursEnabled` is never read anywhere in `NotificationEngine.ts`.** A user can call the existing preference-update API, set `quietHoursEnabled: false`, get a `200` response, see it persisted in the database — and it has **zero effect** on whether their SMS gets suppressed at 2am, because `isQuietHours()` is called unconditionally regardless of this column's value. This is a write-only, dead-read column that predates this package and should be fixed as part of it, since it's the same underlying gap (quiet hours aren't actually configurable end-to-end) and fixing only the tenant-level default without also wiring up the already-built per-user override would leave a known-broken API contract in place.
- **Current architecture:** `NotificationEngine.send()` is the single per-notification dispatch path used by every producer across the platform (invoice reminders, payment confirmations, CRM campaigns via `sendRaw()`, etc.) — both `send()` and `sendRaw()` independently call the same module-level `isQuietHours()` function.
- **Current limitations:** no tenant-level configuration of the quiet-hours window exists at all; the one user-level override that *does* exist in the schema and API (`quietHoursEnabled`) is silently ignored by the engine that's supposed to honor it.

## Existing Code Analysis

- **What already exists and should be reused:** `packages/db-client/src/schema/index.ts`'s `featureFlags` table (`id, tenantId, flagKey, enabled, config (jsonb), createdAt, updatedAt`, unique on `(tenantId, flagKey)`) is this codebase's established per-tenant configuration mechanism (used for flags like `einvoice_enabled`, `fifo_valuation` per other packages' documentation) — its `config` jsonb column is an exact fit for storing `{ quietHoursStart: 22, quietHoursEnd: 8 }` per tenant without any new table or migration. `notificationPreferences.quietHoursEnabled` (already exists, already has a working write path via `notification.routes.ts`) is the correct per-user override mechanism and should be wired into `NotificationEngine.send()`'s existing `prefs` lookup — it is already being fetched in the same query that populates `prefs.SMS`/`prefs.EMAIL`/etc. (lines 90-99), so reading one more field off the same already-fetched row is a trivial addition, not a new query.
- **What should never be modified:** `sendRaw()`'s and `send()`'s existing dedup/idempotency logic (`deriveIdempotencyKey`, `onConflictDoNothing` on `notificationLog`), the per-channel `deliverViaChannel`/`sendSms`/`sendEmail`/`sendWhatsApp` implementations, and the existing per-channel `prefs.SMS === false` opt-out check (line 114) — all correct, unrelated, out of scope. The default IST 22:00-08:00 window itself must remain the behavior for any tenant that hasn't configured an override and for any user who hasn't disabled `quietHoursEnabled` — this is an additive configurability change, not a default-behavior change, so every existing tenant sees identical SMS-suppression behavior unless they explicitly opt out.
- **Prior related work:** `apps/notification-service/src/__tests__/NotificationEngine.test.ts` already has dedicated quiet-hours test cases (`'skips SMS at 22:00 IST'`, `'skips SMS at 02:00 IST'`, `'does NOT skip SMS at 10:00 IST'`) — these are the exact regression cases that must keep passing once the window becomes tenant-configurable (they exercise the *default* window, which must not change for tenants that don't configure an override) and the natural home for new test cases covering the tenant override and the (currently dead) per-user override.

## Architecture

- **Tenant-level default window:** a new `feature_flags` row per tenant, `flagKey: 'notification_quiet_hours'`, `config: { startHour: number, endHour: number }` (both IST, matching today's implicit timezone assumption — no timezone field is being added, since this codebase's notification/SMS delivery has no multi-timezone concept anywhere else to build on, and IST is this platform's only operating timezone per every other India-specific compliance feature already in this codebase, e.g. GST/PT). If no such flag row exists for a tenant, default to today's exact `{ startHour: 22, endHour: 8 }` — this is the critical backward-compatibility guarantee: **every tenant that has never touched this setting must see byte-identical SMS-suppression behavior before and after this package.**
- **Per-user override (fixing the dead column):** `isQuietHours()` gains an optional `overrideDisabled: boolean` parameter (or equivalent) — `NotificationEngine.send()` passes `prefs.quietHoursEnabled === false` (already available in the same query that populates the rest of `prefs`, just never threaded through today) so a user who has explicitly disabled quiet hours for a given `eventType` genuinely bypasses the suppression, matching what the existing API contract (`quietHoursEnabled` in `notification.routes.ts`) already implies it does. `sendRaw()` has no `recipientUserId`-keyed preference lookup today (it's used for pre-rendered messages like CRM campaigns, per its own doc comment) — leave its quiet-hours check as tenant-level-only (no per-user override applies, since there's no user-preference row to check in that code path); this is a smaller, deliberate scope boundary, not an oversight.
- **Resolution order:** `isQuietHours(tenantId, quietHoursEnabledForUser?)` → if `quietHoursEnabledForUser === false`, return `false` immediately (user opted out, skip the window check entirely) → else look up the tenant's `feature_flags` row for `notification_quiet_hours` (fall back to the hardcoded `{22, 8}` default if absent) → apply the existing IST-offset-and-hour-range logic against the resolved window.
- **Component/data flow:** `NotificationEngine.send()`/`sendRaw()` → (unchanged) fetch `notificationPreferences` row if `recipientUserId` present → (new) also read `quietHoursEnabled` off that same row → (new) `isQuietHours(input.tenantId, prefs.quietHoursEnabled === false ? false : undefined)` → (new, inside `isQuietHours`) look up tenant's `notification_quiet_hours` feature flag, falling back to the existing hardcoded default.

## Database Changes

- Not applicable for the tenant-level default — reuses the existing `feature_flags` table (`packages/db-client/src/schema/index.ts`), no new table/column. A migration is only needed to **seed** a `notification_quiet_hours` feature-flag row per existing tenant if this codebase's convention is to always have an explicit row rather than relying on an application-code fallback for absent rows — recommend **not** seeding one, and relying on the application-code default instead (per PG-044's/PG-036's established pattern of "additive, nullable, defaults preserve existing behavior without requiring a backfill"), since a seeded row for every tenant is unnecessary write-amplification for a feature most tenants will never touch.
- No change needed to `notificationPreferences.quietHoursEnabled` — the column already exists; this package only makes it get *read*.
- Rollback strategy: not applicable — no schema change.

## Backend

- `apps/notification-service/src/domain/NotificationEngine.ts`: change `isQuietHours()` (currently a zero-argument free function) to accept `(tenantId: number, userOverrideDisabled?: boolean)`, add a tenant `feature_flags` lookup (query `featureFlags` where `tenantId` + `flagKey = 'notification_quiet_hours'`, falling back to `{ startHour: 22, endHour: 8 }` if no row or `enabled: false`), and thread `userOverrideDisabled` from the already-fetched `notificationPreferences.quietHoursEnabled` at both call sites (`send()` line ~120, `sendRaw()` line ~207 — note `sendRaw()` has no per-user preference lookup today, so it only gets the tenant-level check, not the per-user override, per the Architecture section's stated scope boundary).
- `apps/notification-service/src/api/notification.routes.ts`: no change needed to the existing preference-update route (it already correctly writes `quietHoursEnabled` — the bug was purely on the read side, in `NotificationEngine`). Optionally add a new tenant-settings route (`PATCH /notification-settings/quiet-hours` or similar, under an existing settings-routes file if one exists) to let an admin configure the tenant-level window via the `feature_flags` table — verify at implementation time whether a generic feature-flag-config route already exists in `tenant-service` that this could reuse instead of adding a notification-service-specific one.
- Events/Kafka: not applicable — no event-shape change.

## Frontend

- Existing per-user notification-preferences UI (wherever it lives — verify at implementation time, likely a notification-settings panel) already has, or should have, the `quietHoursEnabled` toggle wired to the existing working write API — if the toggle doesn't already exist in the UI, note that as a smaller, separate finding (the write API has existed with no UI to drive it, which is itself odd) but building that toggle is in scope for this package since it's the user-facing half of "fixing the dead column."
- New tenant-level "Quiet Hours" settings control (start/end hour picker) under notification/tenant settings, following the existing settings-page conventions in this codebase (`ERPFormField`, permission-gated).

## API Contract

- Existing `PATCH` preference-update route: no shape change (the `quietHoursEnabled` field already exists in its request schema) — behavior fix only.
- New (optional, if not reusing an existing generic feature-flag-config route): `PATCH /notification-settings/quiet-hours` → request `{ startHour: number (0-23), endHour: number (0-23) }` → `200 { data: { startHour, endHour } }`. Error: `400 INVALID_QUIET_HOURS_RANGE` if hours are out of range.

## Multi-Tenant Considerations

- The tenant-level quiet-hours window is stored per-tenant in `feature_flags` (`tenantId` scoped, matching every other feature flag in this codebase) — no cross-tenant leakage risk since the existing `feature_flags` table already enforces `unique(tenantId, flagKey)` and every lookup filters by `tenantId`.
- The per-user override remains scoped to `notificationPreferences` (`tenantId` + `userId` + `eventType`), unchanged from today's existing (if currently dead) column.

## Integration

- **notification-service only** — no other of the 14 services needs to change; every producer of a notification (sales-service invoice reminders, hr-service payroll notifications, CRM campaigns, etc.) already calls the same `NotificationEngine.send()`/`sendRaw()` entry points unchanged.

## Coding Standards

- Reuses the existing `feature_flags` table and its `config` jsonb convention rather than introducing a new settings table or a new tenant-configuration mechanism, per the Master Roadmap's "check existing tables before introducing a new utility" guidance.
- `isQuietHours`'s refactor from a zero-argument free function to one accepting `(tenantId, userOverrideDisabled?)` follows the same pattern already used elsewhere in this file for tenant-scoped lookups (e.g. the `notificationPreferences`/`notificationTemplates` queries in `send()`, which already filter by `tenantId`).

## Performance

- One additional `feature_flags` lookup per SMS-channel notification dispatch — cacheable in-process for a short TTL (e.g. 60s) if this proves to be a meaningful additional query volume in practice, but given SMS is already a relatively low-frequency channel compared to IN_APP/EMAIL, a per-call lookup is acceptable for v1; do not add caching preemptively without evidence it's needed.
- No change to the existing `notificationPreferences` query — `quietHoursEnabled` rides along in the same already-fetched row, no new query for the per-user override.

## Security

- Not applicable beyond the existing tenant-scoping/permission model — the new tenant-level settings route (if added) should be gated behind an existing notification/tenant-settings-management permission, not a new bespoke one, following this codebase's convention of reusing existing configuration-management permissions where one already covers the area.

## Testing

- Extend `apps/notification-service/src/__tests__/NotificationEngine.test.ts`: the three existing quiet-hours cases (22:00/02:00/10:00 IST) must continue to pass unchanged for a tenant with no `notification_quiet_hours` feature flag configured (regression-safe default); add a case where a tenant has configured a custom window (e.g. `{ startHour: 23, endHour: 6 }`) and SMS at 22:30 IST is **not** suppressed (previously would have been, under the old hardcoded default) while SMS at 23:30 IST **is** suppressed; add a case proving the previously-dead `quietHoursEnabled: false` per-user override now genuinely bypasses suppression at 2am IST (this is the regression test for the dead-column bug this package fixes).

## Acceptance Criteria

- [ ] A tenant with no configured quiet-hours override sees byte-identical SMS-suppression behavior to today (22:00-08:00 IST) — regression-safe.
- [ ] A tenant can configure a custom quiet-hours window via the `feature_flags`-backed mechanism, and SMS dispatch correctly honors it instead of the hardcoded default.
- [ ] A user who sets `quietHoursEnabled: false` via the existing (previously dead-read) preference API genuinely bypasses SMS suppression during quiet hours — closing the dead-column gap found during this pass.
- [ ] `pnpm --filter notification-service test` passes, including new tenant-override and per-user-override tests, without breaking the three existing quiet-hours regression cases.

## Deliverables

- **Files to create:** none required (reuses `feature_flags`); optionally a new tenant-settings route file if no existing generic feature-flag-config route can be reused (confirm at implementation time).
- **Files to modify:** `apps/notification-service/src/domain/NotificationEngine.ts` (`isQuietHours` signature + tenant-flag lookup + per-user-override wiring at both `send()` and `sendRaw()` call sites), `apps/notification-service/src/__tests__/NotificationEngine.test.ts` (new test cases), possibly a notification/tenant-settings frontend page (per-user toggle UI, if missing, and a new tenant-level quiet-hours settings control).
- **Migrations:** none required (no seed migration recommended per Database Changes — application-code default covers absent rows).
- **APIs added/changed:** existing preference-update route unchanged in shape (behavior fix only); optional new `PATCH /notification-settings/quiet-hours` if no reusable generic route exists.
- **Events added/changed:** none.
- **Tests added:** tenant-custom-window case, per-user-override-now-works case, in `NotificationEngine.test.ts`.

---

## Context Preservation (for a fresh AI session with no prior history)

**Previous Work Summary:** `apps/notification-service/src/domain/NotificationEngine.ts` hardcodes SMS quiet hours to 22:00-08:00 IST via a zero-argument `isQuietHours()` function (lines 57-65), called unconditionally at two sites (`send()` line 120, `sendRaw()` line 207) with no tenant or user awareness. Separately — and more interesting than the task's original framing — `notificationPreferences.quietHoursEnabled` (a per-user override column, `packages/db-client/src/schema/notification.ts` line 97) already has a fully working **write** path via `notification.routes.ts`'s existing preference-update route, but is **never read** by `NotificationEngine.send()`, making it a silent dead column: a user can toggle it via the existing API and see zero behavioral effect.

**Current Objective:** make quiet hours tenant-configurable via the existing `feature_flags` table (`config: { startHour, endHour }`, falling back to today's `{22, 8}` default for any tenant that hasn't configured an override — zero behavior change for the default case), and fix the dead-column bug by wiring `notificationPreferences.quietHoursEnabled` into `isQuietHours()`'s per-user override path at the `send()` call site (`sendRaw()` has no per-user preference lookup today and is deliberately left tenant-level-only).

**Architecture Snapshot:** `feature_flags` (`packages/db-client/src/schema/index.ts`, `tenantId + flagKey` unique, `config` jsonb) is this codebase's established per-tenant configuration mechanism — reuse it, don't invent a new settings table. `notificationPreferences` (`packages/db-client/src/schema/notification.ts`) already carries `quietHoursEnabled` with a working write path; the bug is purely on the read side in `NotificationEngine.ts`. The three existing quiet-hours tests in `NotificationEngine.test.ts` (22:00/02:00/10:00 IST cases) encode the exact default behavior that must remain unchanged for tenants with no override configured.

**Completed Components:** the per-user `quietHoursEnabled` write path (`notification.routes.ts` lines 62, 233, 247) — already correct, do not touch; only the read side in `NotificationEngine.ts` needs fixing.

**Pending Components:** `sendRaw()`'s quiet-hours check stays tenant-level-only in this package (no per-user override, since that code path has no `recipientUserId`-keyed preference lookup) — extending it to support a per-user override for `sendRaw()` callers is explicitly out of scope unless a future need arises.

**Known Constraints:** the default IST 22:00-08:00 window must remain byte-identical behavior for any tenant/user that hasn't explicitly configured an override — this is a configurability addition, not a default-behavior change.

**Coding Standards:** reuse the existing `feature_flags` table/convention; match this file's existing tenant-scoped-query style (as already used for `notificationPreferences`/`notificationTemplates` lookups in `send()`).

**Reusable Components:** `featureFlags` table (`packages/db-client/src/schema/index.ts`), the already-fetched `notificationPreferences` row in `send()` (just read one more field off it).

**APIs Already Available:** the existing preference-update route in `notification.routes.ts` already accepts and persists `quietHoursEnabled` — no new write-path API needed for the per-user fix.

**Events Already Available:** not applicable — no event-shape change.

**Shared Utilities:** `@erp/logger`, standard Drizzle query patterns already used throughout `NotificationEngine.ts`.

**Feature Flags:** new flag key `notification_quiet_hours` (via the existing `feature_flags` mechanism), `config: { startHour, endHour }`, absent-row fallback to `{22, 8}`.

**Multi-Tenant Rules:** tenant-level window is `tenantId`-scoped in `feature_flags`, matching every other flag; per-user override remains `tenantId + userId + eventType`-scoped in `notificationPreferences`, unchanged.

**Security Rules:** no new permission required for the per-user-override fix (reuses the existing preference-update route's existing gating); a new tenant-level settings route, if added, should reuse an existing notification/tenant-settings-management permission rather than introduce a new one.

**Database State:** no schema change — both tables involved (`feature_flags`, `notificationPreferences`) already exist with the needed columns.

**Testing Status:** `apps/notification-service/src/__tests__/NotificationEngine.test.ts` already covers the default-window behavior (three cases: 22:00, 02:00, 10:00 IST) — these must keep passing unchanged; new cases needed for tenant-custom-window and per-user-override-now-works.

**Next Session Plan:** single session — S complexity, one file's core logic change plus test additions, no schema/migration work.

**Prompt for the Next Session:** "Implement `ERP-PLANNING/production-gap-prompts/010-Notifications/50-configurable-quiet-hours.md` (PG-047). Before writing code, re-confirm `apps/notification-service/src/domain/NotificationEngine.ts`'s current `isQuietHours()` signature and both call sites (`send()`, `sendRaw()`) still match this document's line references, and re-confirm `notificationPreferences.quietHoursEnabled` is still write-only/dead-read as described — this is the more interesting and more concretely fixable half of this gap, distinct from simply adding tenant-level configurability. Do not add per-user-override support to `sendRaw()` — that path has no user-preference lookup today and is deliberately out of scope."
