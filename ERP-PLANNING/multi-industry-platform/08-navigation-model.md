# 08 — Navigation Model

## 1. Current mechanism (kept)

`apps/web-frontend/src/lib/navigation.ts` — static `NAV_GROUPS`, `filterNavItem`/`filterNavGroups`, consumed by `Layout.tsx`. Confirmed small (1024 lines), static, frontend-owned, and correctly so — no evidence justifies a backend navigation service (brief §7, `01-current-state.md` §5).

## 2. What changes

`filterNavItem` gains a second predicate, evaluated before the existing permission check:

```ts
// existing:
function filterNavItem(item: NavItem, hasPermission: (p: Permission) => boolean): NavItem | null { ... }

// target (additive parameter, same recursive shape):
function filterNavItem(
  item: NavItem,
  hasPermission: (p: Permission) => boolean,
  enabledModules: Set<string>          // NEW
): NavItem | null {
  if (item.moduleCode && !enabledModules.has(item.moduleCode)) return null;  // NEW check
  // ...existing permission-based filtering, unchanged
}
```

`NavItem`/`NavGroup` gain one new optional field, `moduleCode?: string`, set only on the handful of groups that map to a gateable module (HR & PAYROLL → `hr`, a future hospitality group → `hospitality-rooms`). Groups that are always-on Commerce Core (Sales, Inventory, Accounting) get no `moduleCode` and are unaffected — this is why the check is `if (item.moduleCode && ...)`, not a blanket requirement, so existing nav entries need zero changes unless their module is genuinely optional.

## 3. Where `enabledModules` comes from

Computed server-side (§5/§6 of `05-module-capability-model.md`), delivered to the frontend alongside `permissions[]` in whatever the current session/auth-context payload is (confirmed pattern: permissions already ride in the JWT or a `/me`-style endpoint the frontend already calls once per session — extend that same payload, don't add a second round-trip).

## 4. Explicitly avoided anti-pattern

The brief (§7) warns against `if hotel... if hospital...` conditionals scattered through unrelated components. The `moduleCode` field keeps all such branching centralized in one filter function operating on declarative metadata — no new industry ever requires touching `Layout.tsx` or any component beyond adding its nav group's `moduleCode` and the module's `MODULE_REGISTRY` entry.

## 5. pos-frontend / customer-portal

Both have their own, much smaller nav/routing surfaces. Same pattern applies if/when they need module-awareness (POS itself is arguably always "the module" for `pos-frontend` — no internal module gating expected there today; customer-portal's CRM-adjacent features could use the same `moduleCode` check if a future business type needs to hide/show portal sections).
