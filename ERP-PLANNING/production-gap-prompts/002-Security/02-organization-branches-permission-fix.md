# [PG-013] Fix `GET /organization` / `GET /branches` Missing Backend Permission Checks

> Template version 1.0. Every gap-prompt file in this tree must follow this exact section order. Do not add sections; do not omit sections that apply. If a section genuinely does not apply to this gap, write "Not applicable — <one-line reason>" instead of deleting it, so the structure stays diffable across files.

**Category:** Security
**Priority:** Critical
**Complexity:** S — a one-line `preHandler` fix per route once the correct caller-matrix is worked out; the actual work is figuring out who legitimately needs which fields
**Depends on:** none
**Blocks:** none
**Primary service(s)/package(s):** apps/tenant-service/src/api/organization.routes.ts, apps/tenant-service/src/api/branches.routes.ts (or equivalent), apps/pos-frontend (UPI QR caller)

---

## Overview

- **Business objective:** `GET /organization` currently returns the tenant's legal name, GSTIN, PAN, and **bank account details** (the same bank details used to generate the POS UPI QR code) to *any authenticated user of any role* — a cashier, a data officer, anyone with a valid JWT for the tenant. This is a live authorization bypass, not a theoretical one: the frontend hides the Organization Settings page from non-admins, but the API behind it has no matching check, so any logged-in user can call the endpoint directly and read bank account numbers today.
- **Current implementation:** confirmed directly in `apps/tenant-service/src/api/organization.routes.ts`:
  ```ts
  // GET /organization — line 69
  fastify.get('/organization', { preHandler: [authenticate] }, async (request, reply) => { ... });
  // PUT /organization — line 83
  fastify.put('/organization', { preHandler: [authenticate, requirePermission(PERMISSIONS.ORG_SETTINGS_EDIT)] }, async (request, reply) => { ... });
  ```
  The `PUT` (write) route correctly requires `ORG_SETTINGS_EDIT`. The `GET` (read) route only requires `authenticate` — no `requirePermission()` call at all. This is an asymmetric, clearly-unintentional gap: someone remembered to gate the write but not the read of the same sensitive record.
  A parallel `GET /branches` route has the same shape of gap (frontend hides branch management from non-admins; backend has no matching read-side check) — verify its exact file/line at implementation time (likely `apps/tenant-service/src/api/branches.routes.ts`, not yet confirmed in this pass).
- **Current architecture:** `web-frontend`'s nav config (`web-frontend/src/lib/navigation.ts`) gates the Organization Settings page behind an admin-level permission, and `OrganizationPage.tsx` is rendered inside a `PermissionRoute` — but that only controls whether the *page* renders; it does nothing to stop a direct `fetch`/`curl` call to the API.
- **Current limitations:** the specific fields exposed — GSTIN, PAN, and bank account number/IFSC — are precisely the kind of data whose over-broad exposure this repo's own security conventions (field-level AES encryption for PAN/bank data elsewhere, in hr-service) treat as sensitive. This endpoint currently has no equivalent protection.

## Existing Code Analysis

- **What already exists and should be reused:** `requirePermission(PERMISSIONS.ORG_SETTINGS_EDIT)` — the exact permission constant already used correctly on the `PUT` route. A parallel `ORGANIZATION_VIEW`-shaped constant should be checked for existence in `packages/shared-types/src/permissions.ts` before inventing a new one (the web-frontend's mirrored `constants/permissions.ts` shows `ORGANIZATION_VIEW`/`ORGANIZATION_SETTINGS_VIEW` already defined — confirm these are the intended read-side constants and that they aren't already another instance of the "dead constant" problem tracked in PG-014 before wiring them in, since if they're dead too, fixing this gap and PG-014 should be coordinated, not done twice).
- **What should never be modified:** the `PUT /organization` route's existing `ORG_SETTINGS_EDIT` check — leave it exactly as is. Do not change the response shape of `GET /organization` beyond adding the permission check (unless the caller-matrix work below concludes a narrower response is also needed).
- **Prior related work:** `FEATURE_INVENTORY.md` §4.3/§8 is the only place this has been documented as of 2026-07-08; no phase-completion report has addressed it yet, meaning no prior session attempted and abandoned a fix — this is a clean first pass.

## Architecture

- **The real design question this package must resolve before just adding a permission check:** does anything *legitimately* need organization/branch data without holding an admin-level permission? Two known candidates:
  1. **POS UPI QR generation** — pos-frontend needs the tenant's bank account/UPI VPA to render a payment QR code at checkout, and checkout is a cashier-role action, not an admin one. If cashiers lose access to `GET /organization` entirely, POS UPI checkout breaks.
  2. **Branch selection during login/branch-picker flows** (see PG-051, POS branch-picker UI) — any authenticated user plausibly needs to see the *names* of branches they have access to, without needing full branch-management permissions.
- **Resolution:** split by field sensitivity, not by blanket-gating the whole endpoint:
  - Add a **narrow, low-privilege-safe** endpoint (or a response-shape branch on the existing endpoint, keyed off the caller's permission level) that returns only what's needed for legitimate cross-role use — e.g. a `GET /organization/payment-info` (or a field subset returned to any authenticated user: UPI VPA / bank display name only, never full account number/IFSC/PAN/GSTIN) for the POS UPI use case, and a `GET /branches/summary` (id + name only) for branch-picker use cases.
  - Gate the **full** `GET /organization` (legal name, GSTIN, PAN, full bank details) and **full** `GET /branches` (with GSTIN-per-branch, addresses, etc.) behind `requirePermission(PERMISSIONS.ORGANIZATION_VIEW)` / an equivalent branch-view permission — matching the same admin-level gate the frontend nav already uses.
  - This avoids the trap of either (a) leaving the leak in place because a legitimate caller needs *something* from the endpoint, or (b) breaking POS checkout by locking the whole endpoint down without providing the narrow path cashiers actually need.

## Database Changes

Not applicable — no schema change; this is a route-authorization fix plus, if the narrow-endpoint approach is taken, a new route reading the same existing table with a smaller `select()` projection.

## Backend

- `apps/tenant-service/src/api/organization.routes.ts`: add `requirePermission(PERMISSIONS.ORGANIZATION_VIEW)` (confirm exact constant name — coordinate with PG-014 if it turns out to be a currently-dead constant) to the existing `GET /organization` preHandler array. Add a new `GET /organization/payment-info` route (or equivalent name) with `preHandler: [authenticate]` only, returning a narrow projection (`select({ upiVpa: ..., bankDisplayName: ... })` — never the full row) for POS/checkout use.
- `apps/tenant-service/src/api/branches.routes.ts` (confirm actual filename): same pattern — full `GET /branches` gated on a branch-view permission; a narrow `GET /branches/summary` (id, name, isHeadOffice only) left at `authenticate`-only for branch-picker use cases.
- **Validation, authorization, audit logging:** since this endpoint returns PAN/bank data, add an audit-log read event (`ORGANIZATION_SETTINGS_VIEWED`) on the full endpoint, consistent with this repo's existing before/after-diff audit logging pattern for other sensitive-data reads, if such read-auditing precedent exists elsewhere (check whether any other "view sensitive PII" route in this codebase already audit-logs reads, not just writes — hr-service's PAN/bank routes are the closest analog to check).

## Frontend

- `apps/pos-frontend`: change its UPI-QR-generation code path to call the new narrow `payment-info` endpoint instead of the full `GET /organization` (find its current call site first — likely in a checkout/payment component).
- `web-frontend`: no change needed if `OrganizationPage.tsx` already calls the full endpoint and the calling user already holds the admin permission the nav gate implies — but verify the nav-gate permission constant matches exactly what's now enforced server-side (this is the whole point of the fix: frontend gate and backend gate must agree).
- Branch-picker UI (PG-051) should call the new narrow `branches/summary` endpoint rather than the full one.

## API Contract

- `GET /organization` → now requires `ORGANIZATION_VIEW` (or equivalent); `403` for callers without it.
- `GET /organization/payment-info` (new) → `200 { data: { upiVpa: string | null, bankDisplayName: string | null } }`, `authenticate`-only.
- `GET /branches` → now requires a branch-view permission; `403` without it.
- `GET /branches/summary` (new) → `200 { data: [{ id, name, isHeadOffice }] }`, `authenticate`-only.

## Multi-Tenant Considerations

- All queries remain `tenant_id`-scoped exactly as today — this fix is purely about *who within the tenant* can read *which fields*, not about cross-tenant isolation (which was never the issue here).

## Integration

- **pos-frontend** is the one real cross-role consumer that must not regress — confirm its exact current call site before changing anything, so the migration to the narrow endpoint is a like-for-like swap, not a guess.
- **web-frontend**'s `OrganizationPage.tsx` and branch-management pages are unaffected beyond confirming their permission constants line up with the newly-enforced backend checks.

## Coding Standards

- Reuses the exact `requirePermission()` pattern already correctly used on the sibling `PUT` routes in the same file — no new authorization mechanism introduced.

## Performance

Not applicable — no meaningful performance impact; the narrow endpoints are cheaper (smaller projections) than the full ones they replace for their specific callers.

## Security

- This is the primary deliverable: closes a live, exploitable-today data-exposure bug (any authenticated user, any role, can read GSTIN/PAN/bank details via direct API call). OWASP API3:2023 (Broken Object Property Level Authorization) is the precise category — the fix pattern (narrow projection for low-privilege callers, full projection behind a real permission check) is the textbook remediation for that category.
- Add the read-audit-log event as described above so future access to this sensitive record is traceable, matching the append-only audit logging already used for other sensitive mutations in this codebase.

## Testing

- New tests in `apps/tenant-service/src/__tests__/`: a non-admin authenticated user gets `403` on full `GET /organization` and `GET /branches`; an admin gets `200` with full data; any authenticated user (cashier-role token) gets `200` with only the narrow field set from `GET /organization/payment-info` and `GET /branches/summary`.
- Regression test confirming `pos-frontend`'s checkout flow still successfully renders a UPI QR after the endpoint swap (integration or E2E, not just unit).

## Acceptance Criteria

- [ ] `GET /organization` returns `403` for an authenticated user without `ORGANIZATION_VIEW` (or the equivalent, correctly-enforced constant).
- [ ] `GET /branches` returns `403` for an authenticated user without the equivalent branch-view permission.
- [ ] A new narrow endpoint exists for POS UPI-QR generation that any authenticated user can call, returning only UPI VPA / bank display name — never full account number, IFSC, PAN, or GSTIN.
- [ ] A new narrow endpoint exists for branch-picker use cases returning only id/name/isHeadOffice.
- [ ] pos-frontend's UPI checkout flow still works end-to-end after switching to the narrow endpoint.
- [ ] The frontend's nav-gate permission constant for Organization Settings matches exactly what the backend now enforces.

## Deliverables

- **Files to create:** none new beyond the added route handlers inside existing route files (or a small new `payment-info.routes.ts` / addition to `branches.routes.ts` if cleaner — implementer's call, keep it minimal).
- **Files to modify:** `apps/tenant-service/src/api/organization.routes.ts`, `apps/tenant-service/src/api/branches.routes.ts` (confirm filename), `apps/pos-frontend`'s UPI-QR call site, branch-picker call site (if PG-051 has already landed by the time this is implemented — otherwise just leave the narrow endpoint ready for it).
- **Migrations:** none.
- **APIs added/changed:** `GET /organization` (add permission check), `GET /organization/payment-info` (new), `GET /branches` (add permission check), `GET /branches/summary` (new).
- **Events added/changed:** optionally one new audit-log read-event type if read-auditing is added.
- **Tests added:** permission-boundary tests for both full and narrow endpoints per above.

---

## Context Preservation (for a fresh AI session with no prior history)

**Previous Work Summary:** `PUT /organization` already correctly enforces `ORG_SETTINGS_EDIT`; `GET /organization` (confirmed at `apps/tenant-service/src/api/organization.routes.ts:69`) has never had a matching read-side permission check — this is confirmed by direct code read, not just the inventory doc's claim. `GET /branches` has the same shape of gap per the inventory (file/line not yet directly confirmed — verify at implementation time).

**Current Objective:** add the missing permission check to both full-data reads, while adding narrow, low-privilege-safe sibling endpoints so legitimate cross-role callers (POS UPI QR, branch-picker) don't regress.

**Architecture Snapshot:** tenant-service owns organization settings and branches; `requirePermission()` is the standard preHandler pattern; the frontend nav-gate and backend permission check must agree — that agreement is the actual fix, not just "add any check."

**Completed Components:** the write-side (`PUT /organization`) permission check, already correct and the pattern to copy.

**Pending Components:** PG-051 (POS branch-picker UI) is a natural consumer of the new `branches/summary` endpoint but is not required to land first — this package should ship the endpoint regardless of PG-051's status.

**Known Constraints:** must not break the one confirmed legitimate low-privilege caller (POS UPI-QR generation) — verify its exact current call site before changing the full endpoint's gating, so the swap is proven end-to-end, not assumed.

**Coding Standards:** `requirePermission()` preHandler pattern, exactly as already used on the sibling `PUT` route in the same file.

**Reusable Components:** `requirePermission`, `PERMISSIONS.ORG_SETTINGS_EDIT` (as the model for whatever read-side constant is used).

**APIs Already Available:** the existing `GET /organization` and `GET /branches` full-data routes (being fixed, not replaced).

**Events Already Available:** not applicable, unless read-auditing is added.

**Shared Utilities:** `@erp/logger`, existing audit-log helper if read-auditing is added.

**Feature Flags:** not applicable.

**Multi-Tenant Rules:** unaffected — `tenant_id` scoping on these queries is already correct; this fix is about intra-tenant role authorization only.

**Security Rules:** `ORGANIZATION_VIEW` (or equivalent, confirm exact constant) for full `GET /organization`; an equivalent branch-view constant for full `GET /branches`; the new narrow endpoints are `authenticate`-only by design.

**Database State:** no migration; same `organizationSettings`/branches tables, narrower `select()` projections for the new endpoints.

**Testing Status:** zero tests currently exercise this permission boundary (it doesn't exist yet) — new tests are the primary verification this gap is actually closed.

**Next Session Plan:** single session (Complexity S) — confirm `branches.routes.ts`'s exact current state first (not yet read in this pass), then implement both routes' fixes and the two narrow endpoints together, since they share the same design pattern.

**Prompt for the Next Session:** "Implement `ERP-PLANNING/production-gap-prompts/002-Security/02-organization-branches-permission-fix.md` (PG-013). This is a live, exploitable-today data-exposure bug — treat it with urgency. Start by reading `apps/tenant-service/src/api/organization.routes.ts` (already confirmed: line 69 `GET /organization` has no `requirePermission` call) and finding the exact equivalent `GET /branches` route/file (not yet confirmed in this pass), then find pos-frontend's current UPI-QR call site before changing anything, so the narrow-endpoint migration doesn't break checkout."
