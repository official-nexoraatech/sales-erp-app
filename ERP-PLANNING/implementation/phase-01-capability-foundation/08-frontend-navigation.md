# 08 — Frontend / Navigation

Frontend filtering is explicitly **not security enforcement** — backend `requireCapability` (per-service) remains authoritative. This file's mechanism exists purely for UX (don't show a user a nav item / button for something their tenant can't use); a determined client can always ignore it, and the backend must reject the resulting request regardless. This is stated once here and assumed throughout.

## 1. Current mechanism, verified this session (corrects `21-capability-resolution-architecture.md`/`08-navigation-model.md`'s original assumption)

`apps/web-frontend/src/lib/navigation.ts:949-961` (`filterNavItem`) and `:978-990` (`filterNavGroups`) filter purely on `hasPermission`. **Permissions are decoded client-side from the raw JWT**, not fetched from a `/me`-style claims endpoint:

- Login: `apps/web-frontend/src/pages/auth/LoginPage.tsx:157-170` — `JSON.parse(atob(accessToken.split('.')[1]))` extracts `roles`/`permissions`, merged with a separate `authApi.me()` call (which fetches profile/branch fields only).
- Silent refresh: `apps/web-frontend/src/api/client.ts:89-118` re-decodes the same way on every token refresh, explicitly to avoid requiring logout/login for mid-session permission changes (comment at lines 98-100).
- Storage: `apps/web-frontend/src/store/auth.store.ts` (Zustand + `persist`), `hasPermission` (lines 61-65) reads `user.permissions.includes(...)`.

`Layout.tsx:53-57` calls `filterNavGroups(NAV_GROUPS, hasPermission)`, memoized on `user?.permissions`.

**310 call sites of `hasPermission()` across 139 files** in `apps/web-frontend/src` — any change to the shape of what `AuthUser`/`hasPermission` carry has very wide blast radius. This is why Phase 1 builds the mechanism without touching any real consumer yet.

## 2. DECIDED (2026-08-18) — `enabledCapabilities` is delivered via the existing authenticated-user bootstrap call, not the JWT

**Decision, approved by the architect**: the frontend consumes effective capability information from the **existing authenticated-user/session/bootstrap mechanism** — it does not independently reconstruct tenant capabilities from feature flags, entitlements, or billing state client-side, and capabilities are **not** added to the JWT merely for convenience.

Applied to actual code, this resolves to **Option B** (the two options considered are recorded below for traceability, not as an open choice):

**Chosen: extend the existing `authApi.me()` response.** `authApi.me()` is already called at login (`LoginPage.tsx:157-175`, confirmed 2026-08-18) as the established bootstrap call for profile/branch fields, independent of the JWT — this is "the most appropriate existing mechanism" per direct inspection of the frontend auth flow, since it's the one call already dedicated to fetching session-bootstrap data beyond what the JWT carries. Add `enabledCapabilities: string[]` to its response. **Backing service confirmed**: `GET /users/me`, `apps/auth-service/src/routes/users.ts:551`, verified 2026-08-18. Store the new field in `AuthUser` alongside `permissions`/`roles`. Does not touch JWT issuance/signing.

**Rejected: new JWT claim (`AccessTokenPayload.enabledCapabilities`).** Would require auth-service to read `feature_flags` at every token sign/refresh, bloat every JWT with entitlement-derived state, and — per the decision's explicit instruction — capabilities must not be added to the JWT merely for convenience. Recorded here only so a future session understands why this path wasn't taken.

**New dependency, confirmed acceptable**: implementing this in `auth-service` gives that service a new dependency on `feature_flags`/`PlatformFeatureFlags` it doesn't have today. This is the necessary, minimal cost of using the existing bootstrap mechanism rather than inventing a new one or coupling into the JWT — approved as part of this decision.

**Security framing (restated per the decision)**: this delivery mechanism is used exclusively for navigation filtering, route visibility, UX, and capability-aware messaging. It is explicitly **not a security boundary** — the backend's per-service `requireCapability()` check (`05-platform-sdk.md`) remains authoritative regardless of what the frontend has cached or displays.

**Recommendation: Option B.** Reasoning: (1) it doesn't require auth-service to take on a new infrastructure dependency (`feature_flags`/`PlatformFeatureFlags`) it doesn't have today; (2) it doesn't grow the JWT, which is already carried on every single request; (3) `authApi.me()` is already the established place for "extra profile-ish data fetched once at login," so this is additive to an existing pattern rather than a new one; (4) it keeps authentication (who are you) and entitlement (what can you do) as separately-evolvable concerns, consistent with `multi-industry-platform/06-entitlement-model.md`'s explicit three-way distinction. **This is a recommendation for approval, not a decision made unilaterally by this plan** — flagged per the governing prompt's explicit instruction.

## 3. Navigation filtering design (built, not yet applied to real `NAV_GROUPS` entries)

`NavItem`/`NavGroup` (`navigation.ts:89-101`) gain one new optional field:

```ts
export interface NavItem {
  label: string;
  path: string;
  icon: LucideIcon;
  children?: NavItem[];
  permission?: Permission;
  capabilityKey?: string; // NEW, optional — only set on items whose whole capability can be tenant-absent
}
```

`filterNavItem` gains a second parameter and an additional check, ordered before the existing permission check (capability is the coarser gate):

```ts
export function filterNavItem(
  item: NavItem,
  hasPermission: (permission: string) => boolean,
  enabledCapabilities: Set<string> // NEW param
): NavItem | null {
  if (item.capabilityKey && !enabledCapabilities.has(item.capabilityKey)) return null; // NEW
  if (item.children) {
    const children = item.children
      .map((child) => filterNavItem(child, hasPermission, enabledCapabilities))
      .filter((child): child is NavItem => child !== null);
    return children.length > 0 ? { ...item, children } : null;
  }
  if (item.permission && !hasPermission(item.permission)) return null;
  return item;
}
```

`filterNavGroups` threads the same new parameter through identically. **No existing `NAV_GROUPS` entry is tagged with `capabilityKey` in this phase** — the parameter is additive and optional, so every existing nav item is completely unaffected (`if (item.capabilityKey && ...)` short-circuits to `false` for every current item, since none has the field set).

## 4. Loading state

`enabledCapabilities` arrives alongside the rest of `AuthUser` at login/refresh (Option B) — no separate loading state beyond what already exists for the login flow itself. No new "capabilities loading" spinner needed since nothing consumes it yet in this phase.

## 5. Error state

If `authApi.me()`'s new field is missing/malformed (e.g. older cached response format during a rolling deploy), `filterNavItem` must treat an absent/empty `enabledCapabilities` set the same as "no capabilities enabled" (fail-closed, consistent with `04-capability-resolution.md` §5) — but since no real nav item uses `capabilityKey` yet in this phase, this has zero visible effect until a future phase tags real items.

## 6. Caching

`enabledCapabilities` persists in the same Zustand `persist` store as the rest of `AuthUser` (`auth.store.ts`), sharing its existing persistence/exclusion rules (tokens are excluded from persistence, `partialize`, lines 116-120 — `enabledCapabilities` should be persisted alongside `permissions`/`roles`, not excluded, since it's equally safe to cache client-side and needed across page reloads).

## 7. Tenant switching / role switching behavior

Verified this session: **no tenant-switching UI exists** in web-frontend. Impersonation exists (admin swaps to another _user_, same tenant in every observed case) — `startImpersonation`/`stopImpersonation` (`auth.store.ts:66-99`) already swap `user`/`accessToken`; Option B's `enabledCapabilities` would be re-fetched as part of whatever `authApi.me()` call already happens during that swap (if any — verify the exact impersonation flow calls `me()` again; if it doesn't today, that's a pre-existing gap unrelated to this phase, not introduced by it).

## 8. Backward compatibility

Fully preserved by construction — `capabilityKey` is optional and unused by any current nav item; `filterNavItem`'s new parameter is additive; existing callers of the old 2-argument signature would break at compile time (TypeScript), which is the correct behavior forcing `Layout.tsx`'s one call site to be updated deliberately, not silently miscompiled.

## 9. `pos-frontend`

Does not share `navigation.ts` — has its own `apps/pos-frontend/src/auth.ts` with an independent `hasPermission()` reading JWT claims from `localStorage`. Out of scope for this phase (no nav-group concept exists there to extend — it's a single-screen app gating individual buttons ad hoc). If POS-specific capability gating is needed later, it follows the same `enabledCapabilities` delivery mechanism (Option B, extended to whatever POS's equivalent of `me()` is) but is not designed here.
