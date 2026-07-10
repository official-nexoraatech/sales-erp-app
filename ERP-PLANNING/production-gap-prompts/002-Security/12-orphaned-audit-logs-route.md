# [PG-019] Orphaned `admin/audit-logs` Route — Wire Into Nav

> Template version 1.0. Every gap-prompt file in this tree must follow this exact section order. Do not add sections; do not omit sections that apply. If a section genuinely does not apply to this gap, write "Not applicable — <one-line reason>" instead of deleting it, so the structure stays diffable across files.

**Category:** Security
**Priority:** High
**Complexity:** S — the page and route already exist and work; this is purely a nav-config and command-palette registration
**Depends on:** none
**Blocks:** none
**Primary service(s)/package(s):** apps/web-frontend/src/lib/navigation.ts, apps/web-frontend/src/App.tsx (already correct, reference only)

---

## Overview

- **Business objective:** the append-only audit log (before/after diffs, actor, IP) is one of this app's core compliance/security features — it's exactly the kind of thing an `AUDITOR`-role user or an admin investigating an incident needs to find quickly. Today it's fully built and fully permission-gated, but invisible in both the sidebar navigation and the global command palette — the only way to reach it is typing `/admin/audit-logs` directly into the browser's address bar, which almost no real user would ever think to do.
- **Current implementation:** confirmed by direct read of `apps/web-frontend/src/App.tsx:367`:
  ```tsx
  <Route path="admin/audit-logs" element={<Page><PermissionRoute permission={PERMISSIONS.VIEW_AUDIT_LOG} element={<AuditLogPage />} /></Page>} />
  ```
  The route is correctly registered and correctly permission-gated. Confirmed by grep of `apps/web-frontend/src/lib/navigation.ts` that no entry for `audit-logs` or `AuditLog` exists anywhere in that file — meaning the sidebar nav tree, which is also the source the global command palette's action-mode (`>` prefix) draws from per `FEATURE_INVENTORY.md` §1, has no knowledge of this page's existence.
- **Current architecture:** `navigation.ts` is the single nav-to-permission map that drives both the sidebar and the command palette (per §4.2 of the inventory) — a page missing from it is invisible in both surfaces simultaneously, which is exactly this page's situation. Its sibling, `admin/security-audit-log` (`SecurityAuditLogPage`, gated on the same `VIEW_AUDIT_LOG` permission per the same `App.tsx` region, lines 364/367), should be checked for whether *it* is correctly present in `navigation.ts` — if so, that's the exact template entry to copy for `audit-logs`; if it's also missing, this package should fix both in the same pass rather than leaving a second, newly-discovered instance of the same bug unaddressed.

## Existing Code Analysis

- **What already exists and should be reused:** `AuditLogPage.tsx` itself (no changes needed — it renders correctly, per the route registration); the exact `PERMISSIONS.VIEW_AUDIT_LOG` constant already used correctly in `App.tsx` (reuse the identical constant in the nav entry, so the sidebar-visibility gate and the route's actual access-control gate can never drift apart).
- **What should never be modified:** `AuditLogPage.tsx`'s implementation, the route registration in `App.tsx`, and the `VIEW_AUDIT_LOG` permission constant itself.
- **Prior related work:** none — `FEATURE_INVENTORY.md` §4.3/§8 is the first documentation of this specific gap.

## Architecture

- No architectural change — `navigation.ts` is a data structure (nav-tree entries with `{ path, label, icon, permission }`-shaped items, confirm exact shape by reading a neighboring entry, e.g. `admin/security-audit-log`'s or `admin/feature-flags`'s entry if present) that both the sidebar renderer and the command palette's action-mode consume. Adding one correctly-shaped entry for `admin/audit-logs` closes the gap in both surfaces simultaneously, by construction — this is precisely why the bug manifested in two places (sidebar AND command palette) from a single root cause, and why the fix is similarly a single change.
- **Where in the nav tree:** place it alongside its sibling `admin/security-audit-log` (both are "Security & Audit"-category admin pages per `FEATURE_INVENTORY.md` §2) so the two related audit surfaces are discoverable next to each other, matching how a user would expect to find them.

## Database Changes

Not applicable.

## Backend

Not applicable — this is a pure frontend nav-configuration gap; the backend route/permission enforcement behind `AuditLogPage` is already correct.

## Frontend

- `apps/web-frontend/src/lib/navigation.ts`: add one nav entry for `admin/audit-logs` → `AuditLogPage`, gated on `PERMISSIONS.VIEW_AUDIT_LOG`, positioned near `admin/security-audit-log`'s existing entry (or, if that entry is *also* missing, add both together and flag this as a slightly larger-than-expected fix in the Deliverables).

## API Contract

Not applicable.

## Multi-Tenant Considerations

Not applicable beyond what's already correctly handled by the existing route/permission gate.

## Integration

- Purely internal to `web-frontend`'s own nav configuration — no other service or frontend touched.

## Coding Standards

- Uses the exact existing nav-entry shape and permission-constant reference already established for every other admin page in `navigation.ts` — no new pattern.

## Performance

Not applicable.

## Security

- This is a discoverability fix, not an access-control fix — the page was already correctly permission-gated; the risk being closed is the opposite of over-exposure: a legitimately-permitted user (an `AUDITOR` role, or an admin) currently can't find a feature they're entitled to use, which pushes them toward slower or less-safe alternatives (asking a developer to query the DB directly, for instance) to get the same information.

## Testing

- A frontend test (or a simple grep-based CI check) confirming every `<Route>` with a `PermissionRoute` wrapper in `App.tsx` has a corresponding entry in `navigation.ts` — this is the actual regression guard, since this exact bug (route exists, nav entry doesn't) could recur for any future page unless something structurally checks for it.

## Acceptance Criteria

- [ ] `admin/audit-logs` appears in the sidebar nav for any user holding `VIEW_AUDIT_LOG`.
- [ ] `admin/audit-logs` is reachable via the global command palette's action-mode.
- [ ] `admin/security-audit-log`'s nav presence is verified (and fixed if also missing) in the same pass.
- [ ] A CI check (or test) flags any future `App.tsx` route lacking a `navigation.ts` entry, so this exact class of bug can't silently recur.

## Deliverables

- **Files to modify:** `apps/web-frontend/src/lib/navigation.ts`.
- **Files to create:** the CI/test regression guard (exact location depends on existing frontend test conventions — check for a `navigation.test.ts` or similar first).
- **Migrations:** none.
- **APIs added/changed:** none.
- **Events added/changed:** none.
- **Tests added:** the route-vs-nav-entry regression guard described above.

---

## Context Preservation (for a fresh AI session with no prior history)

**Previous Work Summary:** `admin/audit-logs` is fully implemented and correctly permission-gated in `App.tsx` (confirmed at line 367) but has zero entry in `apps/web-frontend/src/lib/navigation.ts` (confirmed via grep), making it invisible in both the sidebar and the command palette, which both draw from that single file.

**Current Objective:** add the missing nav entry (and check/fix its sibling `admin/security-audit-log` if it turns out to have the same gap), plus a regression guard so this class of bug can't silently recur for future pages.

**Architecture Snapshot:** `navigation.ts` is the single source both the sidebar renderer and the command palette's action-mode consume — one correctly-shaped entry fixes both surfaces at once.

**Completed Components:** the page itself, its route, its permission gate — all already correct and untouched by this package.

**Pending Components:** none blocking.

**Known Constraints:** must reuse the exact `PERMISSIONS.VIEW_AUDIT_LOG` constant already used in `App.tsx`, so the two gates (nav visibility, route access) can never independently drift.

**Coding Standards:** exact existing nav-entry shape used by every other admin page.

**Reusable Components:** `navigation.ts`'s existing entry structure — copy a sibling admin-page entry as the template.

**APIs Already Available:** not applicable.

**Events Already Available:** not applicable.

**Shared Utilities:** not applicable.

**Feature Flags:** not applicable.

**Multi-Tenant Rules:** not applicable.

**Security Rules:** `VIEW_AUDIT_LOG` — already correctly defined and enforced; this package only adds a matching nav-visibility gate.

**Database State:** not applicable.

**Testing Status:** no test currently checks route-vs-nav-entry correspondence — the new guard is the first one.

**Next Session Plan:** single session (Complexity S).

**Prompt for the Next Session:** "Implement `ERP-PLANNING/production-gap-prompts/002-Security/12-orphaned-audit-logs-route.md` (PG-019). Before starting, grep `apps/web-frontend/src/lib/navigation.ts` for `security-audit-log` to see its existing entry shape (use it as the template) and to confirm whether it's present or has the same gap as `audit-logs` — if both are missing, fix both in one change."
