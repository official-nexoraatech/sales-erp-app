# [PG-016] Frontend Permission Constants — Shared Import Instead of Hand-Mirror

> Template version 1.0. Every gap-prompt file in this tree must follow this exact section order. Do not add sections; do not omit sections that apply. If a section genuinely does not apply to this gap, write "Not applicable — <one-line reason>" instead of deleting it, so the structure stays diffable across files.

**Category:** Security
**Priority:** High
**Complexity:** S — mechanically small (swap an import), but requires resolving a real ESM/bundling question about consuming a backend-oriented package from a Vite frontend build
**Depends on:** PG-014 (retire/rename decisions there should land before or alongside this, so the mirror isn't immediately re-drifted)
**Blocks:** none
**Primary service(s)/package(s):** apps/web-frontend/src/constants/permissions.ts, packages/shared-types/src/permissions.ts, apps/web-frontend/vite.config.ts, apps/web-frontend/tsconfig.json

---

## Overview

- **Business objective:** `web-frontend`'s permission gating (`PermissionGate`, `usePermission()`, `PermissionRoute`, and the nav-to-permission map in `navigation.ts`) all key off `web-frontend/src/constants/permissions.ts` — confirmed, via direct read, to be a hand-written `PERMISSIONS` object (starting `ORGANIZATION_VIEW`, `ORGANIZATION_SETTINGS_VIEW`, `ORGANIZATION_SETTINGS_UPDATE`, `BRANCH_VIEW`, `BRANCH_CREATE`, ... — a manually typed-out copy) rather than an import of `packages/shared-types/src/permissions.ts`, which is the actual backend source of truth (~298 constants). Any time a constant is added, renamed, or removed on the backend (as PG-014 and PG-015 both do), the frontend copy silently goes stale unless someone remembers to hand-edit it too — a standing drift risk that has already contributed to at least one confirmed live bug (the frontend gates the Organization page on constants that, per PG-013, have no matching backend enforcement at all).
- **Current implementation:** `apps/web-frontend/src/constants/permissions.ts` is a plain, manually-maintained object literal — confirmed by direct read of its first 30 lines, which already shows constants (`ORGANIZATION_SETTINGS_UPDATE`, `BRANCH_CREATE`/`UPDATE`/`DELETE`, `USER_ACTIVATE`/`DEACTIVATE` if present further down) that PG-014 identifies as dead on the backend — meaning the frontend mirror is not just a maintenance burden but may already be actively out of sync with backend reality today.
- **Current architecture:** `packages/shared-types` is a workspace package (pnpm monorepo) already consumed by backend services directly. `web-frontend` is a Vite-built React SPA that has never imported it — presumably because `shared-types` may include Node-only or backend-oriented type dependencies that don't tree-shake cleanly into a browser bundle, or simply because no one wired the import when the frontend file was first created.
- **Current limitations:** this is the textbook definition of a "standing drift risk" the inventory doc calls it — not yet necessarily causing an active bug on its own (separate from the already-confirmed dead-constant issues), but structurally guaranteed to recur every time backend permissions change unless the mirror is eliminated.

## Existing Code Analysis

- **What already exists and should be reused:** `packages/shared-types/src/permissions.ts` itself, unchanged — it's already the canonical source of truth; this package doesn't change what it contains, only who imports it.
- **What should never be modified:** `PermissionGate`, `usePermission()`, `PermissionRoute`, `navigation.ts` — none of these need behavioral changes; they should keep referencing `PERMISSIONS.X` exactly as today, just from a different import source.
- **Prior related work:** none directly; this is a first pass, though PG-013 and PG-014 both surface concrete evidence that the current mirror approach has already caused real drift.

## Architecture

- **Resolve the ESM/bundling question first, before touching any consuming file:** run `apps/web-frontend`'s Vite build with a trial import of `@erp/types` (or whatever the workspace package name for `shared-types` resolves to — confirm exact package name in `packages/shared-types/package.json`) to see whether it tree-shakes cleanly into the browser bundle. `permissions.ts` itself should be a pure, dependency-free object literal — if the package's `index.ts` barrel re-exports other, heavier or Node-oriented modules (DB types, Zod schemas referencing server-only code) alongside it, importing the whole package could pull unwanted weight or break in a browser context. If that's the case, the fix is a targeted subpath import (e.g. `@erp/types/permissions` via the package's `exports` map, added if not already present) rather than importing the whole barrel.
- **Migration path:** once a clean import path is confirmed, replace the *contents* of `apps/web-frontend/src/constants/permissions.ts` with a thin re-export (`export { PERMISSIONS } from '@erp/types/permissions';` or equivalent) rather than deleting the file outright — this preserves every existing `import { PERMISSIONS } from '@/constants/permissions'` call site across the frontend without a mass find-and-replace, while eliminating the actual duplication.

## Database Changes

Not applicable.

## Backend

Not applicable — this is a frontend build-configuration and import-path change; `packages/shared-types` itself needs no change beyond possibly adding a subpath export if the whole-barrel import proves too heavy.

## Frontend

- `apps/web-frontend/src/constants/permissions.ts`: replace its body with a re-export from the shared package (see Architecture above) — every existing consumer (`PermissionGate`, `usePermission`, `navigation.ts`, every page-level `PermissionRoute`) keeps working unchanged since the export name and shape stay identical.
- `apps/web-frontend/vite.config.ts` / `tsconfig.json`: add whatever workspace-package resolution config is needed (check if other frontend imports from workspace packages already exist — e.g. `packages/design-tokens` is already consumed by web-frontend per recent branding work, so the monorepo-resolution pattern likely already exists and can be copied rather than invented).

## API Contract

Not applicable.

## Multi-Tenant Considerations

Not applicable — this is a build-time/import-time change with no runtime tenant behavior.

## Integration

- Purely `web-frontend` ↔ `packages/shared-types`. No other service or frontend (`pos-frontend`) is in scope for this package unless `pos-frontend` has the same hand-mirror problem — check `apps/pos-frontend/src` for an equivalent `constants/permissions.ts` file at implementation time; if it exists, decide whether to fix it in this same package (cheap, same pattern) or flag it as a fast-follow.

## Coding Standards

- Eliminates a duplicate implementation (the hand-mirror) in favor of importing the existing canonical source — directly matches this backlog's "avoid duplicate implementations" cross-cutting rule. Uses whatever workspace-package-import convention `design-tokens` already established for web-frontend, rather than inventing a new one.

## Performance

- Negligible — `permissions.ts` is a small object literal either way; bundle-size impact of importing the shared package (vs. the current inline copy) should be verified to be near-zero via a build-size check, not assumed.

## Security

- Directly closes the "standing drift risk" the inventory names explicitly — once this lands, any future backend permission change (rename, addition, removal, including PG-014's and PG-015's own changes) is automatically reflected in the frontend with zero extra maintenance step, removing an entire class of frontend/backend authorization-gate mismatch at its root cause rather than fixing instances of it one at a time.

## Testing

- A build-time check: confirm `pnpm --filter @erp/web-frontend build` succeeds and the resulting bundle actually contains the correct permission constants (a simple smoke test — build, then grep the built output for a known constant name, or better, a Vitest test importing `constants/permissions.ts` and asserting it re-exports the exact same object reference/values as `packages/shared-types`).
- Manual repro: after the change, temporarily rename a constant only in `packages/shared-types`, confirm the frontend's TypeScript build fails at every now-stale reference (proving the shared-import actually catches drift at compile time — the entire point of this fix) instead of silently building a mismatched app.

## Acceptance Criteria

- [ ] `apps/web-frontend/src/constants/permissions.ts` re-exports from `packages/shared-types` rather than containing an independently maintained object literal.
- [ ] Every existing frontend consumer of `PERMISSIONS` continues to work unchanged (no call-site edits needed).
- [ ] `pnpm --filter @erp/web-frontend build` succeeds with no bundle-size regression beyond a negligible amount.
- [ ] Renaming or removing a constant in `packages/shared-types` now causes a frontend TypeScript compile error at every affected call site, proving drift is now caught at build time.

## Deliverables

- **Files to modify:** `apps/web-frontend/src/constants/permissions.ts` (body replaced with re-export), `apps/web-frontend/vite.config.ts` and/or `tsconfig.json` (if new resolution config is needed), possibly `packages/shared-types/package.json` (add a subpath `exports` entry if a targeted import is needed instead of the full barrel).
- **Migrations:** none.
- **APIs added/changed:** none.
- **Events added/changed:** none.
- **Tests added:** a Vitest re-export-correctness test; a manual/CI build-size sanity check.

---

## Context Preservation (for a fresh AI session with no prior history)

**Previous Work Summary:** `apps/web-frontend/src/constants/permissions.ts` is confirmed (by direct read) to be a hand-maintained object literal, not an import from `packages/shared-types/src/permissions.ts` — the actual backend source of truth for ~298 permission constants. This has already contributed to at least one confirmed live drift instance (PG-013's organization/branches permission gap involves frontend constants that don't match backend enforcement).

**Current Objective:** replace the hand-mirror with a re-export from the shared package, after confirming a clean ESM/bundling path for a Vite frontend to consume a workspace package originally built for backend services.

**Architecture Snapshot:** pnpm monorepo; `packages/shared-types` already consumed directly by all backend services; `packages/design-tokens` is already consumed by `web-frontend` (recent tenant-branding work), so a workspace-package-into-Vite-frontend pattern likely already exists to copy.

**Completed Components:** the canonical `packages/shared-types/src/permissions.ts` itself — unchanged by this package.

**Pending Components:** whether `pos-frontend` has the same hand-mirror problem is unconfirmed — check and decide scope at implementation time.

**Known Constraints:** must not require a call-site edit across every frontend file that imports `PERMISSIONS` — the re-export approach exists specifically to avoid that.

**Coding Standards:** reuse whatever workspace-import convention `design-tokens` already established for `web-frontend`.

**Reusable Components:** `packages/shared-types/src/permissions.ts` itself; the `design-tokens`-into-`web-frontend` import pattern as a template.

**APIs Already Available:** not applicable.

**Events Already Available:** not applicable.

**Shared Utilities:** `@erp/types`.

**Feature Flags:** not applicable.

**Multi-Tenant Rules:** not applicable.

**Security Rules:** not applicable directly — this package is what *enables* PG-013/PG-014/PG-015's fixes to stay correct on the frontend over time, rather than being a security fix itself.

**Database State:** not applicable.

**Testing Status:** no test currently guards against frontend/backend permission-constant drift — the new re-export test is the first one.

**Next Session Plan:** single session (Complexity S).

**Prompt for the Next Session:** "Implement `ERP-PLANNING/production-gap-prompts/002-Security/04-frontend-permission-constants-shared-import.md` (PG-016). Start by confirming whether `packages/design-tokens` is already imported into `apps/web-frontend` and how (check `vite.config.ts`/`tsconfig.json` for the resolution config) — reuse that exact pattern for `packages/shared-types` rather than inventing a new one. Then check whether `apps/pos-frontend` has an equivalent hand-mirrored permissions file and decide whether to fix it in the same pass."
