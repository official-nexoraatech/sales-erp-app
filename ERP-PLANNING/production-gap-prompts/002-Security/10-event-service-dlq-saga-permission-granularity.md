# [PG-015] event-service DLQ/SAGA Permission Granularity Fix

> Template version 1.0. Every gap-prompt file in this tree must follow this exact section order. Do not add sections; do not omit sections that apply. If a section genuinely does not apply to this gap, write "Not applicable — <one-line reason>" instead of deleting it, so the structure stays diffable across files.

**Category:** Security
**Priority:** High
**Complexity:** S — swap one constant for two more specific ones across a small, well-contained set of route files, plus a role-defaults grant decision
**Depends on:** PG-014 (same remediation shape — do this one right after, using the same backfill-migration discipline)
**Blocks:** none
**Primary service(s)/package(s):** apps/event-service/src/api/dlq.routes.ts, saga.routes.ts, performance.routes.ts, schema-registry.routes.ts, projections.routes.ts, event-store.routes.ts; apps/tenant-service/src/rbac/role-defaults.ts; apps/web-frontend/src/lib/navigation.ts

---

## Overview

- **Business objective:** `event-service`'s admin console (DLQ, Saga Monitor, Schema Registry, Projections, Event Store, Performance baselines) is where operators diagnose and fix distributed-systems failures. Today, every one of these routes is gated on the same broad `AUDIT_LOG_VIEW` permission, while `web-frontend`'s navigation config gates *visibility* of these same admin pages using dedicated, more specific constants (`DLQ_VIEW`, `SAGA_VIEW`, and presumably siblings for the other consoles). This means a role that's been granted `DLQ_VIEW` but not `AUDIT_LOG_VIEW` sees the DLQ page in the nav but every API call from it fails with `403` — and conversely, a role with `AUDIT_LOG_VIEW` but not `DLQ_VIEW` can't see the nav link but *can* still call the API directly. Both directions are broken in different ways.
- **Current implementation:** confirmed by direct grep across `apps/event-service/src/api/*.routes.ts` — every `preHandler: requirePermission(...)` call in `dlq.routes.ts` (5 routes), `performance.routes.ts` (3 routes), `schema-registry.routes.ts` (5 routes), `projections.routes.ts` (4 routes), `event-store.routes.ts` (2 routes), and `saga.routes.ts` (5 routes) uses `PERMISSIONS.AUDIT_LOG_VIEW` — there is no route in this service checking `DLQ_VIEW`, `SAGA_VIEW`, or any per-console equivalent, despite those constants existing in `packages/shared-types/src/permissions.ts` (confirmed) and being referenced by the frontend nav config, `App.tsx`, and web-frontend's mirrored `constants/permissions.ts` (all 4 confirmed via grep).
- **Current architecture:** `apps/tenant-service/src/rbac/role-defaults.ts` was checked for `DLQ_VIEW`/`SAGA_VIEW` grants — neither appears anywhere in that file, meaning no role (including OWNER/ADMIN by default seeding) is explicitly granted these constants today; if any role can currently reach these consoles, it's solely because it holds `AUDIT_LOG_VIEW`, which is the actual (undocumented) gate.
- **Current limitations:** this is the same *shape* of bug as PG-014 (dead constants vs. real enforcement) but distinguished here because the frontend has already committed to the granular constants existing and being real — so the correct fix is "make the backend match the frontend's existing assumption," not "decide whether granularity is worth building."

## Existing Code Analysis

- **What already exists and should be reused:** the granular constants themselves (`DLQ_VIEW`, `SAGA_VIEW`, and whatever siblings exist for schema-registry/projections/event-store/performance — enumerate the full set in `packages/shared-types/src/permissions.ts` at implementation time, since only two were named in the source audit) are already defined and already referenced by the frontend — no new constants need inventing.
- **What should never be modified:** `AUDIT_LOG_VIEW`'s own actual use case (the real audit-log viewing pages, `SecurityAuditLogPage.tsx`/`AuditLogPage.tsx`) is unaffected by this change — this package only touches event-service's admin-console routes, not the audit-log pages themselves.
- **Prior related work:** none — this is the first pass at this specific mismatch (distinct from PG-014's broader dead-constant sweep, even though the remediation mechanics are shared).

## Architecture

- **Per-console mapping** (verify each console's exact permission constant name at implementation time; do not assume symmetric naming without checking):
  | Console | Route file | Current check | Should check |
  |---|---|---|---|
  | Dead Letter Queue | `dlq.routes.ts` (5 routes) | `AUDIT_LOG_VIEW` | `DLQ_VIEW` (view) / a distinct `DLQ_REPLAY` or similar for the mutating replay routes — verify whether the frontend nav distinguishes view-vs-replay permission or uses one constant for both) |
  | Saga Monitor | `saga.routes.ts` (5 routes) | `AUDIT_LOG_VIEW` | `SAGA_VIEW` (view) / a distinct retry/compensate-mutation constant if one exists |
  | Schema Registry | `schema-registry.routes.ts` (5 routes) | `AUDIT_LOG_VIEW` | its own constant — name to be confirmed |
  | Projections | `projections.routes.ts` (4 routes) | `AUDIT_LOG_VIEW` | its own constant — name to be confirmed |
  | Event Store | `event-store.routes.ts` (2 routes) | `AUDIT_LOG_VIEW` | its own constant — name to be confirmed |
  | Performance baselines | `performance.routes.ts` (3 routes) | `AUDIT_LOG_VIEW` | its own constant — name to be confirmed |
- If any of these consoles turns out to have NO dedicated constant defined at all (only `DLQ_VIEW`/`SAGA_VIEW` were confirmed to exist in this pass), the correct move is to add one (matching the naming convention of the two confirmed ones) rather than leaving that specific console on the `AUDIT_LOG_VIEW` catch-all — for consistency across the whole admin console, not because `AUDIT_LOG_VIEW` is wrong in isolation.
- **Role-defaults grant decision:** since no role currently holds `DLQ_VIEW`/`SAGA_VIEW` (confirmed absent from `role-defaults.ts`), simply swapping the backend check without a role-defaults update would lock every existing role — including OWNER/ADMIN — out of these consoles entirely. The role-defaults migration must grant the new granular constants to at least the same roles that currently hold `AUDIT_LOG_VIEW` (as a safe default matching current effective access), then the tenant/product owner can later choose to narrow specific roles' access via the now-real granular constants.

## Database Changes

- One role-defaults backfill migration (same pattern as PG-014 and the 2026-07-05 precedent): for each existing tenant, grant the newly-enforced granular constants (`DLQ_VIEW`, `SAGA_VIEW`, and any newly-added siblings) to every role that currently holds `AUDIT_LOG_VIEW`, so no existing user loses access to consoles they can reach today.

## Backend

- In each of the 6 route files listed above, replace `requirePermission(PERMISSIONS.AUDIT_LOG_VIEW)` with the correct per-console constant on each route's `preHandler`. For any mutating route (DLQ replay, saga retry/compensate, projection rebuild-trigger), consider whether view and mutate should be distinct constants (matching how `ORG_SETTINGS_EDIT` is distinct from a view-level constant elsewhere in this codebase) — check whether the frontend nav/command-palette already distinguishes these before deciding to split further than the frontend already assumes.

## Frontend

- No change needed if the frontend's existing constant usage in `navigation.ts` already correctly names the granular constants — this package's job is making the backend match what the frontend already assumes. Verify web-frontend's `constants/permissions.ts` mirror (see PG-016) has the exact same constant names as the canonical `packages/shared-types` file, so the two sides can't drift on naming even after this fix.

## API Contract

- No new endpoints; existing event-service admin routes change their `403` boundary from `AUDIT_LOG_VIEW` to the correct granular constant per console.

## Multi-Tenant Considerations

- Same as PG-014 — the role-defaults backfill must run per-tenant since roles are tenant-scoped, seeded at provisioning.

## Integration

- Isolated to `event-service` (backend) and `tenant-service` (role-defaults migration) — `web-frontend`'s nav/command-palette already expect this to be true, so no frontend code change is anticipated, only verification.

## Coding Standards

- Same `requirePermission()` preHandler pattern already used identically across all 24 routes in these 6 files — purely a constant swap, no new authorization mechanism.

## Performance

Not applicable.

## Security

- Currently, granting a role `DLQ_VIEW` (intending to let it see only the DLQ console) actually grants nothing at the API layer — that role can't call any DLQ route unless it separately holds the much broader `AUDIT_LOG_VIEW`, which likely also grants access to the *actual* audit log and every other admin console in this list. This means today's only way to make these consoles usable for a role is to over-grant `AUDIT_LOG_VIEW`, which is broader than the tenant likely intends. Fixing this lets tenants grant operators access to (say) the Saga Monitor without also granting them the full security audit log.

## Testing

- New/updated tests in `apps/event-service/src/__tests__/`: for each of the 6 route files, a role with only the new granular constant (not `AUDIT_LOG_VIEW`) succeeds; a role with only `AUDIT_LOG_VIEW` (not the granular constant) now gets `403` — this is the behavior-change assertion that proves the fix actually changed enforcement, not just refactored constant names.

## Acceptance Criteria

- [ ] All 24 routes across the 6 event-service admin-console route files check their console-specific permission constant, not `AUDIT_LOG_VIEW`.
- [ ] Every console has a real, defined permission constant (adding new ones for any console that currently has none, matching `DLQ_VIEW`/`SAGA_VIEW`'s naming convention).
- [ ] A role-defaults backfill migration grants the new constants to every role that currently holds `AUDIT_LOG_VIEW`, so no existing tenant user loses console access.
- [ ] web-frontend's nav config and its permission-constants mirror reference the exact same constant names now enforced server-side.

## Deliverables

- **Files to modify:** `apps/event-service/src/api/dlq.routes.ts`, `saga.routes.ts`, `performance.routes.ts`, `schema-registry.routes.ts`, `projections.routes.ts`, `event-store.routes.ts`; `apps/tenant-service/src/rbac/role-defaults.ts`.
- **Migrations:** one role-defaults backfill migration.
- **APIs added/changed:** 24 existing routes' permission gate changes from `AUDIT_LOG_VIEW` to console-specific constants.
- **Events added/changed:** none.
- **Tests added:** per-console permission-boundary tests as described above.

---

## Context Preservation (for a fresh AI session with no prior history)

**Previous Work Summary:** confirmed by direct grep that all 24 admin-console routes across 6 files in `apps/event-service/src/api/` check `PERMISSIONS.AUDIT_LOG_VIEW`, while `DLQ_VIEW`/`SAGA_VIEW` constants exist and are already used by the frontend nav config — a live frontend/backend permission-granularity mismatch, distinct from but the same shape as PG-014.

**Current Objective:** swap each route's permission check to its console-specific constant (adding new ones where none yet exist), with a role-defaults backfill so no existing tenant user loses access.

**Architecture Snapshot:** `requirePermission()` preHandler pattern; `event-service` hosts 6 distinct admin consoles (DLQ, Saga, Schema Registry, Projections, Event Store, Performance); role-defaults seeded per-tenant from `apps/tenant-service/src/rbac/role-defaults.ts`.

**Completed Components:** PG-014's remediation pattern (backfill-migration discipline) — reuse it here.

**Pending Components:** none — this package is self-contained once PG-014's pattern is established.

**Known Constraints:** no role currently holds `DLQ_VIEW`/`SAGA_VIEW` per `role-defaults.ts` — the backfill migration is not optional, it's required for this fix to not be a regression.

**Coding Standards:** identical `requirePermission()` pattern already used in all 24 routes — pure constant swap.

**Reusable Components:** the existing `requirePermission()` middleware; the `DLQ_VIEW`/`SAGA_VIEW` constants already defined.

**APIs Already Available:** all 24 routes already exist and work — only their permission gate changes.

**Events Already Available:** not applicable.

**Shared Utilities:** `@erp/types`.

**Feature Flags:** not applicable.

**Multi-Tenant Rules:** role-defaults backfill runs per-tenant.

**Security Rules:** each console gets its own constant instead of sharing `AUDIT_LOG_VIEW`.

**Database State:** one new role-defaults backfill migration.

**Testing Status:** no test currently distinguishes `AUDIT_LOG_VIEW`-holder access from granular-constant-holder access for these consoles — new tests are the proof this fix changed real behavior.

**Next Session Plan:** single session (Complexity S).

**Prompt for the Next Session:** "Implement `ERP-PLANNING/production-gap-prompts/002-Security/10-event-service-dlq-saga-permission-granularity.md` (PG-015), right after or alongside PG-014 since they share the same backfill-migration discipline. Before starting, enumerate the full set of per-console permission constants in `packages/shared-types/src/permissions.ts` — only `DLQ_VIEW`/`SAGA_VIEW` were confirmed to exist in the research pass that produced this file; the other 4 consoles' constants need to be found or created."
