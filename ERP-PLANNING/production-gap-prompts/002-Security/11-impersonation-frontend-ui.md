# [PG-018] Impersonation Frontend UI

> Template version 1.0. Every gap-prompt file in this tree must follow this exact section order. Do not add sections; do not omit sections that apply. If a section genuinely does not apply to this gap, write "Not applicable — <one-line reason>" instead of deleting it, so the structure stays diffable across files.

**Category:** Security
**Priority:** High
**Complexity:** M — backend is fully done; the work is entirely a careful, sensitive-action UI (confirmation UX, session-distinguishing chrome, clean termination) plus wiring the already-existing API client function into an actual button
**Depends on:** none
**Blocks:** none
**Primary service(s)/package(s):** apps/auth-service/src/routes/impersonate.routes.ts (backend, already complete), apps/web-frontend/src/pages/admin (user-management area), apps/web-frontend/src/api/endpoints.ts

---

## Overview

- **Business objective:** admins occasionally need to see the app exactly as a specific user sees it — to debug a permission issue, reproduce a reported bug, or verify a support ticket. The backend already supports this fully: an admin can generate a time-boxed token carrying a target user's exact roles/permissions, fully audit-logged. But there is no button anywhere in the UI to trigger it — the only way to use this feature today is a direct, hand-crafted API call, which in practice means almost no admin ever uses a feature that could otherwise resolve support tickets faster and more safely (bypassing the alternative of an admin asking a user to share their screen or, worse, their password).
- **Current implementation:** confirmed by direct grep — `apps/auth-service/src/routes/impersonate.routes.ts` exists and its route is gated on `requirePermission(PERMISSIONS.IMPERSONATE_USER)` (line 21), issuing a 1-hour token. On the frontend, `impersonat` (case-insensitive) appears only in `apps/web-frontend/src/api/endpoints.ts` (an API client function exists, presumably `impersonateUser()` or similar — confirm exact export name at implementation time), `constants/permissions.ts` (the permission constant is mirrored, consistent with PG-016's broader mirror-file concern), and `SecurityAuditLogPage.tsx` (impersonation *events* are displayed there as audit-log entries — so admins can already see *that* an impersonation happened, just not *trigger* one). No button, page, or component calls the `endpoints.ts` function anywhere.
- **Current architecture:** the app's existing auth/session model (JWT + rotating refresh tokens, per-device session tracking) has no existing concept of "acting as another identity temporarily" in its frontend state — `AuthContext`/session storage would need a new, clearly-flagged state distinguishing "real session as Admin X" from "impersonating User Y, real identity Admin X, expires at T."
- **Current limitations:** a fully-audited, fully-permissioned, working backend capability sits completely unused because of a missing UI — the lowest-effort, highest-leverage item in this entire backlog in terms of "value unlocked per line of code," since zero backend work is needed.

## Existing Code Analysis

- **What already exists and should be reused:** the backend route and its audit logging (unchanged, do not modify); the `endpoints.ts` API client function (call it, don't reimplement it); `constants/permissions.ts`'s existing `IMPERSONATE_USER`-equivalent constant (verify exact name — likely already correctly mirrored given it shows up in the file); the existing per-user session list/revoke UI pattern already built for "Personal settings" (per `FEATURE_INVENTORY.md` §1: "own active-session list + per-session revoke") is a close analog for the kind of session-state UI this needs, and should be studied for conventions (how the app already represents "a session" in its UI) before building a new pattern.
- **What should never be modified:** the backend impersonation route, its audit logging, and its 1-hour token expiry — this package is frontend-only.
- **Prior related work:** none — `FEATURE_INVENTORY.md` §2/§8 documents this as never having had a frontend attempt.

## Architecture

- **Entry point:** a per-user "Impersonate" action, most naturally placed in the existing User Management page (wherever `ADMIN`/`OWNER` already manage users/roles) as a row-level action, gated on `PERMISSIONS.IMPERSONATE_USER` via the existing `PermissionGate` pattern — do not add a separate, undiscoverable page for this; it should live exactly where an admin is already looking at a specific user's record.
- **Confirmation UX:** given the sensitivity (acting with another user's exact permissions), require an explicit, named confirmation dialog (not a generic "are you sure?") stating the target user's name/role and the 1-hour expiry, matching the pattern this app already uses elsewhere for irreversible/sensitive actions (check how admin-initiated password reset — which already requires the admin's own password as re-auth per `FEATURE_INVENTORY.md` §2 — implements its confirmation flow, and consider whether impersonation should require the same re-auth-with-own-password step, since it is at least as sensitive an action).
- **Session state while impersonating:** on confirming, the frontend stores the impersonation token distinctly from the real session token (do not silently overwrite the admin's own stored JWT — the admin must be able to cleanly "stop impersonating" and return to their own session without re-logging-in). A persistent, unmissable banner (not a dismissible toast) should render across the entire app shell while impersonating, showing the target user's name and a live countdown to the 1-hour expiry, with a one-click "Stop impersonating" action that discards the impersonation token and restores the admin's original session token.
- **Auto-expiry handling:** when the 1-hour token expires mid-session, the frontend must detect the resulting `401` and cleanly fall back to the admin's real session (not force a full re-login) — reuse whatever token-expiry-handling convention the existing refresh-token flow already has, adapted for "fall back to stored real session" instead of "refresh."
- **Audit visibility:** no new audit-log work needed — `SecurityAuditLogPage.tsx` already surfaces impersonation start/end events; this package should confirm those events remain correctly populated once the UI makes impersonation actually get used (currently the events might exist correctly. but from zero real usage, an actual UI-driven impersonation is untested end-to-end).

## Database Changes

Not applicable — no schema change; the backend already persists everything needed.

## Backend

Not applicable — no backend change; this package is scoped entirely to the frontend consuming the existing, complete API.

## Frontend

- New component: an "Impersonate" row action + confirmation dialog on the user-management page (exact file to confirm — likely `apps/web-frontend/src/pages/admin/UsersPage.tsx` or similar), gated behind `PermissionGate` on `IMPERSONATE_USER`.
- New global-shell component: an impersonation banner (rendered in the app's root layout, always visible while an impersonation token is active) with target-user name, live countdown, and a "Stop impersonating" button.
- Auth-state changes: extend whatever session-storage mechanism (`AuthContext`, local/session storage keys) already exists to hold a distinct, clearly-named impersonation-token slot alongside (not replacing) the real session token, plus logic to restore the real session on stop/expiry.

## API Contract

- No new endpoints — reuses the existing impersonation-issue route and whatever "stop impersonating" semantics already exist server-side (verify: does the backend need to be told impersonation ended, e.g. to audit-log an explicit end event, or does the audit log simply record token issuance and rely on natural 1-hour expiry as the "end"? Read the actual route/audit-logging code to confirm before assuming a "stop" API call is needed — if the backend already logs "start" only and treats expiry as implicit "end," the frontend's "Stop impersonating" button may just need to discard the local token with no additional API call).

## Multi-Tenant Considerations

- Impersonation must remain within the same tenant as the admin's real session — confirm the backend route already enforces this (an admin should never be able to impersonate a user in a different tenant) before building the frontend; this is a backend invariant to verify, not something the frontend needs to separately enforce, but the UI (e.g. a user-picker, if one exists beyond the per-row action) should not present cross-tenant users as options in the first place.

## Integration

- Purely `web-frontend` calling `auth-service`'s existing route. No other service touched.

## Coding Standards

- Reuses `PermissionGate`, the existing `AuthContext`/session-storage pattern, and the existing sensitive-action confirmation-dialog convention (matching admin password-reset's re-auth-with-own-password pattern, if that's judged appropriate to mirror here) — introduces no new authentication mechanism, only new UI state for representing a temporary secondary session.

## Performance

Not applicable.

## Security

- This UI must make the impersonated state impossible to miss — a persistent banner, not a dismissible one, is a hard requirement, since the primary risk of impersonation tooling is an admin accidentally performing an action *as* the impersonated user without realizing they're still in that mode.
- Consider requiring the admin's own password as re-authentication before impersonation starts (mirroring the existing admin-password-reset precedent) — this is a judgment call to make explicitly, not silently skip, given how sensitive the capability is.
- No new permission constant needed — `IMPERSONATE_USER` already exists and is already correctly enforced server-side; this package must not weaken that by, e.g., letting the frontend infer eligibility without the backend's own check as the actual authority.

## Testing

- New frontend tests (Vitest + RTL, following the pattern established in `web-frontend`'s existing test infra): confirm the Impersonate action is hidden without `IMPERSONATE_USER`, confirm the confirmation dialog renders target-user details correctly, confirm the banner renders and correctly counts down, confirm "Stop impersonating" restores the original session token.
- Manual E2E repro: as an admin, impersonate a lower-privilege user, confirm the app now reflects that user's exact permission set (a page the admin could see is now hidden, matching the target user's role), stop impersonating, confirm the admin's own permissions are restored without re-login.

## Acceptance Criteria

- [ ] An "Impersonate" action is reachable from the user-management page, gated on `IMPERSONATE_USER`.
- [ ] Confirming impersonation shows the target user's name/role and expiry before proceeding.
- [ ] A persistent, non-dismissible banner shows while impersonating, with a live countdown and a working "Stop impersonating" action.
- [ ] Stopping impersonation (manually or via 1-hour expiry) cleanly restores the admin's original session without requiring re-login.
- [ ] `SecurityAuditLogPage.tsx` correctly shows the impersonation event after a real UI-driven impersonation session (verified, not assumed).

## Deliverables

- **Files to create:** the Impersonate confirmation dialog component, the global impersonation-banner component.
- **Files to modify:** the user-management page (add row action), `AuthContext`/session-storage logic (add distinct impersonation-token handling), the app's root layout (mount the banner).
- **Migrations:** none.
- **APIs added/changed:** none — reuses the existing backend route.
- **Events added/changed:** none.
- **Tests added:** frontend component/integration tests as described above.

---

## Context Preservation (for a fresh AI session with no prior history)

**Previous Work Summary:** the backend impersonation feature (`apps/auth-service/src/routes/impersonate.routes.ts`) is complete and audit-logged, gated on `PERMISSIONS.IMPERSONATE_USER`; a frontend API-client function already exists in `endpoints.ts`; nothing calls it — no button, page, or component anywhere.

**Current Objective:** build the frontend UI (entry point, confirmation, session-distinguishing banner, clean stop/expiry handling) to make this existing backend capability actually usable.

**Architecture Snapshot:** JWT + rotating refresh-token session model; existing "Personal settings → active session list + per-session revoke" UI is the closest existing analog for representing session state in this app's UI.

**Completed Components:** the entire backend capability, including audit logging.

**Pending Components:** none blocking — this is a self-contained frontend package.

**Known Constraints:** must not silently overwrite the admin's real session token; must make the impersonated state impossible to miss while active.

**Coding Standards:** `PermissionGate`, existing `AuthContext` conventions, existing sensitive-action confirmation-dialog pattern.

**Reusable Components:** the existing `endpoints.ts` impersonation API-client function; the existing session-list UI as a state-representation reference.

**APIs Already Available:** the impersonation-issue route — confirm whether a matching "end impersonation" API call exists or whether client-side token-discard is sufficient.

**Events Already Available:** not applicable — no new events; existing audit-log events already cover this.

**Shared Utilities:** `@erp/types` (for the `IMPERSONATE_USER` constant, once PG-016 lands the shared import).

**Feature Flags:** not applicable.

**Multi-Tenant Rules:** impersonation must stay within the admin's own tenant — verify this is already backend-enforced.

**Security Rules:** `IMPERSONATE_USER` gates the entry point; consider requiring re-auth-with-own-password before starting, matching the admin-password-reset precedent.

**Database State:** not applicable.

**Testing Status:** zero frontend tests exist for this (there's no UI yet); backend tests presumably already cover the route itself (verify, don't assume).

**Next Session Plan:** single session (Complexity M) is feasible; if split, session A builds the entry point + confirmation dialog, session B builds the banner + stop/expiry handling + tests.

**Prompt for the Next Session:** "Implement `ERP-PLANNING/production-gap-prompts/002-Security/11-impersonation-frontend-ui.md` (PG-018). Before starting, read `apps/auth-service/src/routes/impersonate.routes.ts` in full to confirm the exact token/response shape and whether an explicit 'end impersonation' API exists, and read `apps/web-frontend/src/api/endpoints.ts` to find the exact existing client function name to reuse rather than reimplement."
