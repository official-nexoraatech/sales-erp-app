# [PG-014] RBAC Dead Permission Constants Remediation

> Template version 1.0. Every gap-prompt file in this tree must follow this exact section order. Do not add sections; do not omit sections that apply. If a section genuinely does not apply to this gap, write "Not applicable — <one-line reason>" instead of deleting it, so the structure stays diffable across files.

**Category:** Security
**Priority:** Critical
**Complexity:** M — no single fix; a per-constant decision (wire it up vs. formally retire it) across ~15 dead constants, each needing its own route audit
**Depends on:** none
**Blocks:** PG-015 (event-service DLQ/SAGA permission fix is the same remediation shape, do together or immediately after)
**Primary service(s)/package(s):** packages/shared-types/src/permissions.ts, apps/tenant-service/src/rbac/role-defaults.ts, and every service whose routes should (but don't) check these constants

---

## Overview

- **Business objective:** ~298 permission constants exist so that admins can grant/withhold fine-grained capabilities per role. For at least 15 of them, granting or withholding the constant does *nothing* — the routes that should check it actually check a different, broader constant instead. This means any tenant admin who configures a custom role believing they've restricted (say) branch creation to a specific role is wrong: the real gate is the broader `BRANCH_MANAGE`, which that role may or may not also hold. This is a silent mismatch between the permission model's documented granularity and its actual enforcement.
- **Current implementation:** confirmed directly in `packages/shared-types/src/permissions.ts` — these constants are defined but (per `FEATURE_INVENTORY.md` §4.3, cross-checked against the constants file) never referenced in any `requirePermission()` call in real routes:
  - `ORGANIZATION_UPDATE` (line 4), `ORGANIZATION_SETTINGS_UPDATE` (line 6) — real writes use `ORG_SETTINGS_EDIT` (line 327) instead.
  - `BRANCH_CREATE` / `BRANCH_UPDATE` / `BRANCH_DELETE` / `BRANCH_ASSIGN_USER` (lines 10-13) — real routes use one catch-all `BRANCH_MANAGE` (line 328) instead.
  - `BRANCH_SCOPE_BYPASS` (line 17) — a planned record-level bypass feature, never implemented anywhere; granted to no role.
  - `USER_ACTIVATE` / `USER_DEACTIVATE` / `USER_RESET_PASSWORD` (lines 30-32) — superseded by the single `USER_MANAGE` (line 330).
  - `APPROVAL_VIEW` / `APPROVAL_APPROVE` / `APPROVAL_REJECT` (lines 262-264) — approvals are actually scoped by `approverId = caller` in the route logic itself, not by a permission check at all.
  - `WORKFLOW_CONFIG` (line 265), `CONFIG_VIEW` / `CONFIG_UPDATE` (lines 313-314) — no route anywhere checks these.
- **Current architecture:** the frontend's nav-to-permission map (`web-frontend/src/lib/navigation.ts`) and its hand-mirrored `web-frontend/src/constants/permissions.ts` (see PG-016) both list `ORGANIZATION_VIEW`/`ORGANIZATION_SETTINGS_VIEW` as real-looking constants for gating UI — some of these frontend-side constants may reference the dead backend ones, compounding the confusion (verify at implementation time which frontend gates reference dead vs. live constants).
- **Current limitations:** this is not a hypothetical drift risk — it is a present, confirmed mismatch between the documented 298-constant permission surface and the actual enforcement surface, which is the kind of gap that erodes trust in the whole RBAC model once a customer or auditor notices one instance of it.

## Existing Code Analysis

- **What already exists and should be reused:** the real, currently-enforced substitute for each dead constant (`ORG_SETTINGS_EDIT`, `BRANCH_MANAGE`, `USER_MANAGE`, the `approverId`-based scoping pattern) — these are working, tested enforcement points. The fix, in most cases, is deciding whether to retire the dead constant (accepting the coarser real-world granularity) rather than assuming finer granularity must be built.
- **What should never be modified:** the currently-working coarse permission checks (`ORG_SETTINGS_EDIT`, `BRANCH_MANAGE`, `USER_MANAGE`) must keep working exactly as today for any constant this package decides to retire rather than wire up — don't remove enforcement while removing the dead constant.
- **Prior related work:** project memory (`rbac_dead_permission_constant_pattern.md`) notes a 2026-07-05 fix pass already closed this same category of bug for `PAYMENT_IN_*`/sales-returns constants plus a backfill migration 0025 — that prior fix is the template for how to do this safely (identify dead constant → identify real substitute currently enforced → decide granular-split vs. retire → if granular, add a role-defaults backfill migration so existing tenants' roles don't suddenly lose access they had under the coarse grant). Read that prior fix's actual diff/migration before starting this package, to follow the same safe pattern instead of reinventing the remediation approach.

## Architecture

- **Per-constant decision framework** (apply to each of the ~15 dead constants individually — do not batch-decide):
  1. **Is there a real, current product need for finer granularity than the existing coarse constant provides?** E.g., does any tenant actually want a role that can create branches but not delete them? If genuinely yes → wire the dead constant into the specific route it should gate, and add a role-defaults backfill migration granting it to whichever existing roles held the coarse permission (so no tenant silently loses access).
  2. **If no real need exists** → formally delete the dead constant from `permissions.ts`, remove it from any frontend mirror/nav references, and document the coarse constant as canonical for that capability.
  3. **`APPROVAL_VIEW`/`APPROVAL_APPROVE`/`APPROVAL_REJECT`** are a special case: the actual model (approver sees only their own pending items, scoped by `approverId = caller`) is arguably *more* secure than a permission-constant-gated model would be (it can't be granted to the wrong person by role misconfiguration). Recommendation: retire these three constants and document the `approverId`-scoping pattern as the intentional, permanent design for approvals — this is not a gap to "fix" by adding a redundant permission check on top of already-correct scoping.
  4. **`WORKFLOW_CONFIG`/`CONFIG_VIEW`/`CONFIG_UPDATE`** — determine if these were meant for a settings/config surface that was descoped or renamed (check `ES-*` phase-completion docs for any mention) before deciding retire vs. wire-up.
  5. **`BRANCH_SCOPE_BYPASS`** — confirm it really has zero implementation surface (not just zero role grants) before retiring; if the record-level-bypass *feature* itself is still wanted for a future phase, keep the constant but document it explicitly as "reserved, not yet implemented" rather than leaving it silently dead and indistinguishable from the others.

## Database Changes

- For any constant that gets wired up (granular split), add a role-defaults backfill migration (following the exact precedent of migration 0025 per project memory) that grants the new granular constant to every existing role that currently effectively has that capability via the coarse constant — so no tenant's existing roles lose functionality on deploy.
- For any constant that gets retired, no migration needed (removing an unused, never-granted constant has no data impact) — but confirm via a query that zero `role_permissions` rows reference it before deleting, as a safety check.

## Backend

- Per wired-up constant: add the `requirePermission()` check to the specific route(s) that should enforce it (e.g. if `BRANCH_CREATE`/`UPDATE`/`DELETE` are split out, `apps/tenant-service/src/api/branches.routes.ts`'s three mutating routes each get their own specific check instead of all three checking `BRANCH_MANAGE`).
- Per retired constant: delete from `packages/shared-types/src/permissions.ts`, delete any role-defaults grants referencing it, delete any frontend references (coordinate with PG-016).
- Add a CI-enforced lint/test rule (a small script, or a Vitest test in `packages/shared-types`) that fails the build if any exported permission constant has zero `requirePermission()` call-sites across the whole `apps/` tree — this is the actual regression guard so this exact class of bug (constant defined, never enforced) can't silently reappear after this remediation.

## Frontend

- Coordinate with PG-016: any frontend nav-gate or `constants/permissions.ts` entry referencing a constant this package retires must be updated in the same change (or the frontend will reference a permission the backend no longer recognizes at all, which is a different, cosmetic form of drift).

## API Contract

- No new endpoints. Existing routes for `branches`, `organization`, `users` may gain more granular `403` boundaries where a coarse constant is split into finer ones.

## Multi-Tenant Considerations

- The role-defaults backfill migration (for any wired-up constant) must apply per-tenant, since roles are tenant-scoped custom records seeded from `role-defaults.ts` at provisioning time — existing tenants' already-materialized role-permission rows need the backfill; new tenants provisioned after this change get the correct grants directly from the updated `role-defaults.ts`, no backfill needed for them.

## Integration

- Primarily `tenant-service` (branches, org settings, user management) and `packages/shared-types` (the constants file itself). `event-service`'s DLQ_VIEW/SAGA_VIEW mismatch is the same category of bug but is tracked separately as PG-015 since it's a slightly different shape (both constants already exist and are already used by the frontend nav — the fix there is "make the backend check the granular constant," not "decide whether to retire it," since the frontend already assumes granularity exists).

## Coding Standards

- Follows the exact remediation pattern already proven in the 2026-07-05 `PAYMENT_IN_*`/sales-returns fix (per project memory) — identify dead constant, identify real substitute, decide wire-up-vs-retire per constant, backfill migration if wiring up. No new RBAC mechanism introduced.

## Performance

Not applicable — permission checks are in-memory constant comparisons; no measurable performance impact either way.

## Security

- This is itself a security-hardening package: closes the gap between "what an admin believes they've configured" and "what's actually enforced." The `APPROVAL_VIEW`/`APPROVE`/`REJECT` case specifically should be documented (not silently fixed) since the current `approverId`-scoping is arguably already correct and safe — retiring those three dead constants removes a misleading appearance of finer control without changing actual security posture.
- Any newly-wired granular constant must ship with its role-defaults backfill in the same change — shipping the check without the backfill would be a regression (existing tenants suddenly losing access), which is itself a production incident risk, not just a cleanup nicety.

## Testing

- New test in `packages/shared-types/src/__tests__/` (or wherever this package's tests live): assert every exported `PERMISSIONS` constant has at least one `requirePermission(PERMISSIONS.X)` call-site somewhere under `apps/*/src` (a grep-based test, not a full static-analysis tool) — this is the CI regression guard described above.
- Per-constant: if wired up, a route-level test confirming the new, narrower check actually gates the specific route; if retired, a test confirming existing coarse-permission behavior is unchanged.

## Acceptance Criteria

- [ ] Every one of the ~15 dead constants identified above has an explicit, documented decision (wired-up-with-backfill, or formally retired) — no constant is left in an undecided, silently-dead state.
- [ ] Any wired-up constant has a corresponding role-defaults backfill migration so no existing tenant role loses functionality.
- [ ] Any retired constant is removed from `permissions.ts`, `role-defaults.ts` grants (if any), and any frontend reference (coordinated with PG-016).
- [ ] A CI-enforced test fails the build if any future permission constant is defined with zero real enforcement call-sites.
- [ ] `APPROVAL_VIEW`/`APPROVE`/`REJECT`'s `approverId`-scoping design is explicitly documented as intentional (not silently left ambiguous).

## Deliverables

- **Files to create:** the CI regression-guard test (exact location depends on existing `packages/shared-types` test conventions — check for a `__tests__` directory there first).
- **Files to modify:** `packages/shared-types/src/permissions.ts`, `apps/tenant-service/src/rbac/role-defaults.ts`, `apps/tenant-service/src/api/branches.routes.ts` / `organization.routes.ts` / user-management routes (for any wired-up constants), `web-frontend/src/constants/permissions.ts` and `web-frontend/src/lib/navigation.ts` (coordinate with PG-016 for any retired constants referenced there).
- **Migrations:** one role-defaults backfill migration per wired-up constant (or one combined migration covering all of them, if the implementer judges that cleaner — matches the precedent of migration 0025).
- **APIs added/changed:** existing branch/organization/user routes may gain finer-grained `403` boundaries.
- **Events added/changed:** none.
- **Tests added:** the CI regression-guard test, plus per-constant route tests for anything wired up.

---

## Context Preservation (for a fresh AI session with no prior history)

**Previous Work Summary:** a 2026-07-05 fix pass already remediated this exact class of bug for `PAYMENT_IN_*`/sales-returns constants (backfill migration 0025) — that fix is the template. The ~15 constants listed here (organization, branch, user, approval, workflow/config) are a separate, still-open instance of the same underlying pattern, confirmed present as of `FEATURE_INVENTORY.md` (2026-07-08).

**Current Objective:** for each dead constant, decide wire-up-with-backfill vs. formal-retirement, execute that decision, and add a CI regression guard so a defined-but-unenforced permission constant can't silently ship again.

**Architecture Snapshot:** `requirePermission()` preHandler is the sole enforcement mechanism; permission constants live in `packages/shared-types/src/permissions.ts`; role-to-permission grants are seeded per-tenant from `apps/tenant-service/src/rbac/role-defaults.ts` at provisioning and are also queryable/editable per-tenant thereafter (custom roles).

**Completed Components:** the 2026-07-05 `PAYMENT_IN_*` fix (reference, not reusable code, but the reusable *pattern*).

**Pending Components:** PG-015 (event-service DLQ_VIEW/SAGA_VIEW) is the same bug shape but should be done as its own package since the frontend there already assumes granularity — coordinate timing but don't merge the two packages.

**Known Constraints:** any wire-up decision must ship with a backfill migration in the same change, or existing tenants regress. Retirement decisions must confirm zero `role_permissions` rows reference the constant before deleting.

**Coding Standards:** exact same remediation pattern as the 2026-07-05 fix — no new RBAC mechanism.

**Reusable Components:** `requirePermission()`, the existing coarse constants (`ORG_SETTINGS_EDIT`, `BRANCH_MANAGE`, `USER_MANAGE`) as the fallback/canonical enforcement points for anything retired.

**APIs Already Available:** not applicable — no new endpoints, only refined checks on existing ones.

**Events Already Available:** not applicable.

**Shared Utilities:** `@erp/types` (source of the permission constants), `@erp/logger`.

**Feature Flags:** not applicable.

**Multi-Tenant Rules:** role-defaults backfill must run per-tenant for any wired-up constant.

**Security Rules:** this package's entire content IS the security rule remediation — see per-constant decisions above.

**Database State:** depends on how many constants are wired up vs. retired — at minimum, one new migration for backfill grants.

**Testing Status:** zero tests currently verify permission-constant-to-enforcement correspondence — the new CI regression guard is the first such test.

**Next Session Plan:** single session is feasible for the audit-and-decide phase; if wire-up decisions turn out to require substantial route refactoring (e.g. splitting `BRANCH_MANAGE` into four routes cleanly), split execution into a second session per capability area (organization, branch, user, approval/workflow).

**Prompt for the Next Session:** "Implement `ERP-PLANNING/production-gap-prompts/002-Security/03-rbac-dead-permission-constants.md` (PG-014). Before starting, re-read `ERP-PLANNING/reports/FEATURE_INVENTORY.md` §4.3 and re-grep `packages/shared-types/src/permissions.ts` plus every `requirePermission(` call-site under `apps/*/src` to confirm which constants are still actually dead — concurrent work may have already fixed some since this file was authored. Also read the 2026-07-05 `PAYMENT_IN_*` fix commit/migration as your template before deciding wire-up vs. retire for each remaining constant."
