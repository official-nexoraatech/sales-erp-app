# [PG-017] Password Reset Email Delivery — Real Send

> Template version 1.0. Every gap-prompt file in this tree must follow this exact section order. Do not add sections; do not omit sections that apply. If a section genuinely does not apply to this gap, write "Not applicable — <one-line reason>" instead of deleting it, so the structure stays diffable across files.

**Category:** Security
**Priority:** Critical
**Complexity:** S — auth-service already generates and stores the token correctly; the only missing piece is triggering notification-service's already-real email pipeline
**Depends on:** none
**Blocks:** none
**Primary service(s)/package(s):** apps/auth-service/src/routes/forgot-password.ts, apps/notification-service

---

## Overview

- **Business objective:** self-service password reset is completely non-functional in any real deployment today. A user who forgets their password and clicks "forgot password" gets a `200 { message: 'If this email exists, a reset link has been sent' }` response — but no email is ever sent. The only place the reset link/token exists is a server log line. In production, no one can read that log, so the feature silently does nothing while telling the user it worked.
- **Current implementation:** confirmed by direct read of `apps/auth-service/src/routes/forgot-password.ts` — the route correctly: validates the request (`ForgotPasswordBody` Zod schema, email + tenantId), looks up the active user (constant-time-safe: always returns `200` regardless of whether the user exists, to prevent email enumeration — this part is already correctly implemented), generates a secure token (`generateSecureToken(32)`), hashes it (`sha256Hex`) before storing (`passwordResetTokens` table — plaintext token never persisted, only its hash, which is the correct security pattern), and sets an expiry. Then:
  ```ts
  // In production, send via SMTP. In dev, log the reset link (token is not sensitive itself — only hash stored)
  fastify.log.info({ userId: user.id, tenantId, expiresAt }, 'Password reset token generated — deliver via SMTP');
  // TODO (Milestone 0.6): trigger notification-service event for email delivery
  ```
  The comment and TODO are explicit and self-documenting — this was always known to be incomplete, not an accidental oversight.
- **Current architecture:** `notification-service` already has a fully real, working SendGrid integration used for other transactional emails (per `FEATURE_INVENTORY.md` §5.11), with per-(tenant, event-type, channel) Handlebars templates, SHA-256-derived idempotency keys with a DB unique constraint, and 3-attempt exponential-backoff retry. This is the exact infrastructure this gap needs to call — nothing new needs to be built at the delivery layer.
- **Current limitations:** the token itself is generated and stored correctly (this is not a token-generation or storage bug); the gap is purely "nothing calls notification-service to actually deliver it."

## Existing Code Analysis

- **What already exists and should be reused:** `generateSecureToken`/`sha256Hex` (`apps/auth-service/src/crypto.js`), the `passwordResetTokens` table and its correct hash-only-storage pattern, and — critically — notification-service's existing outbox-driven or direct-call event-consumption pattern (confirm which: does notification-service consume Kafka events via the outbox, like other cross-service notifications, or does auth-service call it directly via an internal service-to-service API call? Check how other services trigger notification-service today — e.g. how HR's "ready for pickup" WhatsApp notification or CRM's birthday/anniversary greeting gets triggered — and mirror that exact mechanism rather than inventing a second way to reach notification-service).
- **What should never be modified:** the email-enumeration-prevention behavior (always `200`, regardless of whether the user exists) — this must be preserved exactly; the email-sending trigger must happen only in the `if (user)` branch, silently, with no observable timing or response difference for the enumeration-prevention property to hold (check whether emitting an event synchronously before responding could introduce a timing side-channel — if so, fire the notification asynchronously/via outbox rather than awaiting it before the response).
- **Prior related work:** none — this is an explicitly-flagged, never-attempted `TODO`, not a regression or an abandoned fix.

## Architecture

- **Recommended mechanism:** follow the existing outbox pattern (write an event to `outbox_events` in the same DB transaction as the `passwordResetTokens` insert) rather than a direct synchronous call to notification-service — this matches the codebase's established cross-service communication convention (transactional outbox + relay, not direct service-to-service calls for this kind of workflow) and means the reset-token write and the "send email" intent are atomically consistent (if the transaction rolls back, no orphaned outbox event is created).
- **New event type:** `PASSWORD_RESET_REQUESTED` (or match existing naming convention for auth-related events, if one exists — check `packages/shared-types/src/events.ts` or equivalent for the naming pattern already used for other auth events like MFA enroll/login) carrying `{ userId, tenantId, resetLink }` (the reset link is constructed here, in auth-service, from the plaintext token — the *only* place the plaintext token exists before it's discarded; never emit the token hash, and never log the plaintext token in production, only in the existing dev-log path which stays as a dev convenience).
- **notification-service side:** add a new Handlebars template (`password-reset`, per-tenant-overridable like every other template) and a new consumer registration for `PASSWORD_RESET_REQUESTED`, following the exact pattern already used for whatever existing auth-adjacent notification (e.g. MFA-related or login-alert notifications, if any exist) already does — do not build a parallel email-sending path.

## Database Changes

Not applicable beyond what already exists — the `passwordResetTokens` table and the existing `outbox_events` table are both already in place; no new tables needed, only a new row shape (event type) written to the existing outbox table.

## Backend

- `apps/auth-service/src/routes/forgot-password.ts`: inside the `if (user)` block, after the `passwordResetTokens` insert, insert an outbox event row (same DB transaction) with type `PASSWORD_RESET_REQUESTED` and payload `{ userId, tenantId, resetLink }` where `resetLink` is built from `config`'s frontend base URL + the plaintext token (`plainToken`, already generated in-memory, never persisted). Remove or downgrade the `fastify.log.info` line to a debug-level log only reachable in non-production environments (keep some dev-convenience logging, but make it explicitly conditional on environment, not unconditional as today).
- `apps/notification-service`: add a consumer for `PASSWORD_RESET_REQUESTED` (mirroring the existing per-event-type consumer registration pattern), a new Handlebars template, and wire it into the existing idempotency-key + retry pipeline — no new retry/idempotency code needed, just a new template + event-type mapping.

## Frontend

- No frontend change needed for the "request reset" flow itself (the `200`-always response is unchanged). If a reset-confirmation page doesn't already exist (check `apps/web-frontend/src/pages/auth/` for a reset-password-with-token page) — if it doesn't exist, that's a related but separate gap (the email would link to a page that doesn't exist); verify at implementation time and flag/scope-expand only if genuinely missing, don't assume.

## API Contract

- No new endpoints; `POST /auth/forgot-password`'s response shape is unchanged. The internal outbox event `PASSWORD_RESET_REQUESTED` is new.

## Multi-Tenant Considerations

- The event payload must carry `tenantId` so notification-service can resolve the correct per-tenant Handlebars template override, exactly like every other tenant-scoped notification already does.

## Integration

- **auth-service → event-service (outbox relay) → notification-service (Kafka consumer) → SendGrid.** No other service involved.

## Coding Standards

- Reuses the existing outbox pattern (write-in-transaction, relay publishes) and notification-service's existing per-event-type Handlebars template + retry/idempotency pipeline — introduces zero new infrastructure, only a new event type and template.

## Performance

Not applicable — this is a low-volume, user-initiated action; no caching/batching concerns.

## Security

- Preserves the existing email-enumeration-prevention property (always `200`) — verify the outbox write happens only in the `if (user)` branch and doesn't introduce an observable timing difference significant enough to defeat that protection (a DB insert either way should already be roughly timing-neutral if a dummy no-op branch is added for the non-existent-user case — check whether one exists or needs adding).
- The plaintext token must only ever exist in-memory in `auth-service` and inside the outbox event payload until notification-service consumes and sends it — it is never persisted in plaintext (matches the existing hash-only storage design) and must not be logged in production.
- This closes a real, user-facing account-recovery gap that today constitutes a functional security regression: users who are locked out (forgotten password) have no working recovery path at all in a real deployment, which in practice pressures support staff toward less secure workarounds (manual DB resets, shared temporary passwords) if this isn't fixed.

## Testing

- `apps/auth-service/src/__tests__/`: assert an outbox event of type `PASSWORD_RESET_REQUESTED` is created (with correct payload shape, excluding the plaintext token from any log assertion) when a valid user requests a reset, and that no such event is created for a non-existent email (while the HTTP response is still `200` either way).
- `apps/notification-service/src/__tests__/`: assert the new consumer renders the template and calls the existing SendGrid send path with the correct recipient/template data; reuse existing idempotency-key test patterns to confirm a duplicate event doesn't send twice.
- End-to-end manual repro (dev environment with Mailhog, per `docker-compose.yml`'s existing dev SMTP target): request a reset, confirm an email actually arrives in Mailhog's inbox.

## Acceptance Criteria

- [ ] Requesting a password reset for a real user results in an actual email being sent (verified via Mailhog in dev, real SendGrid in staging/prod).
- [ ] Requesting a reset for a non-existent email still returns `200` with no observable difference in timing or response shape (enumeration protection intact).
- [ ] The plaintext reset token never appears in production logs.
- [ ] The reset-confirmation page the email links to actually exists and works (verified or flagged as a separate gap if missing).

## Deliverables

- **Files to modify:** `apps/auth-service/src/routes/forgot-password.ts` (add outbox event insert, downgrade/remove unconditional log), `packages/shared-types/src/events.ts` (or equivalent — add `PASSWORD_RESET_REQUESTED` event type), notification-service's consumer registration file and template directory (exact paths to confirm at implementation time).
- **Migrations:** none (outbox table already exists).
- **APIs added/changed:** none externally; one new internal outbox event type.
- **Events added/changed:** new `PASSWORD_RESET_REQUESTED` event.
- **Tests added:** auth-service outbox-event test, notification-service consumer/template test, Mailhog-based manual E2E check.

---

## Context Preservation (for a fresh AI session with no prior history)

**Previous Work Summary:** `apps/auth-service/src/routes/forgot-password.ts` correctly generates, hashes, and stores a reset token and correctly preserves email-enumeration protection — but explicitly stops short of delivery (`TODO Milestone 0.6`), only logging the token server-side. `notification-service` already has a fully working SendGrid + Handlebars + idempotency + retry pipeline used for other transactional emails.

**Current Objective:** wire the existing outbox pattern to carry a new `PASSWORD_RESET_REQUESTED` event from auth-service to notification-service's already-real email pipeline, without weakening the enumeration-prevention property or ever persisting/logging the plaintext token in production.

**Architecture Snapshot:** transactional outbox (write in same DB transaction as business change) → event-service relay → Kafka → per-service consumers is this codebase's standard cross-service communication pattern; notification-service already implements the receiving end for other event types.

**Completed Components:** token generation/hashing/storage; notification-service's SendGrid/template/retry infrastructure (for other event types).

**Pending Components:** none directly blocking — this package is self-contained, though it should verify the reset-confirmation frontend page exists (a related but distinct potential gap).

**Known Constraints:** must not introduce a timing side-channel that defeats the existing "always `200`" enumeration protection.

**Coding Standards:** outbox pattern, not direct service-to-service call, per this codebase's established convention.

**Reusable Components:** `generateSecureToken`/`sha256Hex` (`apps/auth-service/src/crypto.js`), notification-service's existing per-event-type consumer + Handlebars template + idempotency/retry pipeline.

**APIs Already Available:** `POST /auth/forgot-password` (unchanged response shape).

**Events Already Available:** the outbox mechanism itself; this package adds one new event type to it.

**Shared Utilities:** `@erp/logger`, `@erp/types` (for the new event type definition).

**Feature Flags:** not applicable.

**Multi-Tenant Rules:** event payload must carry `tenantId` for correct per-tenant template resolution.

**Security Rules:** not permission-gated (this is an unauthenticated, public-facing route by design) — security properties are enumeration-prevention and token-hash-only-storage, both already correctly implemented and must be preserved.

**Database State:** `passwordResetTokens` and `outbox_events` tables already exist; no migration needed.

**Testing Status:** no test currently exercises the delivery side (it doesn't exist yet); token generation/storage likely already has some test coverage — verify before assuming what needs new tests vs. already exists.

**Next Session Plan:** single session (Complexity S).

**Prompt for the Next Session:** "Implement `ERP-PLANNING/production-gap-prompts/002-Security/05-password-reset-email-delivery.md` (PG-017). Before starting, check how another cross-service notification trigger already works (e.g. grep for an existing outbox event type used to trigger notification-service, such as anything payroll or HR-alteration related) to confirm the exact outbox-event-shape convention to follow, then add `PASSWORD_RESET_REQUESTED` following that same shape. Verify the reset-confirmation frontend page exists before considering this fully done — the email is only useful if the link it contains leads somewhere real."
