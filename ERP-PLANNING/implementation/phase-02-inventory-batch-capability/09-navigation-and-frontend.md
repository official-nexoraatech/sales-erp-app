# 09 — Navigation & Frontend

## 1. First real use of `capabilityKey` (Phase 1 shipped the field, zero consumers — `21-post-implementation-review.md` §5)

`apps/web-frontend/src/lib/navigation.ts`, `NAV_GROUPS` → `INVENTORY` group (the group containing `Items`, per existing structure): add one new leaf item:

```ts
{
  label: 'Near-Expiry Stock',
  path: '/inventory/near-expiry',
  icon: AlertTriangle,           // or repo's existing icon for warnings — confirm at implementation time
  permission: PERMISSIONS.BATCH_VIEW,
  capabilityKey: 'INVENTORY_BATCH',
}
```

`filterNavItem` already checks `capabilityKey` before `permission` (Phase 1, `navigation.ts:959`) — this item is hidden for any tenant without `INVENTORY_BATCH` in `enabledCapabilities`, regardless of whether the viewing user's role happens to grant `BATCH_VIEW` (the exact scenario Phase 1's mechanism exists to prevent — a role misconfiguration leaking a not-provisioned feature).

## 2. Item edit/create form — conditional section, not a new page

`fefoEnabled` toggle added to the existing item form (whichever component renders `ItemSchema`'s fields today — confirmed to exist per `apps/web-frontend/src/schemas/` conventions, exact file to be located at implementation time). The toggle's visibility is gated the same way the nav item is: `enabledCapabilities.has('INVENTORY_BATCH')` (read from `auth.store`'s `AuthUser.enabledCapabilities`, already populated end-to-end by Phase 1 — `store/auth.store.ts`, `20-implementation-report.md` §10) **and** `hasPermission(PERMISSIONS.BATCH_CONFIGURE)`. If the capability is off, the section doesn't render at all (not disabled-and-visible) — matches the brief's explicit UX distinction between "not part of your plan" (hidden) and "you don't have access" (visible-but-disabled would be the wrong signal here, since it's not a permission gap for most tenants, it's a plan gap).

## 3. Near-Expiry Stock page — new, small

A new page component consuming `GET /inventory/near-expiry-stock` (`07-api-contracts.md` §2) — a simple table (item, batch, expiry date, remaining qty), no new UI pattern needed (reuses the repo's existing table/pagination component, per every other list page in the codebase).

## 4. `pos-frontend` / `customer-portal`

Untouched — neither has any inventory-configuration or reporting surface today (confirmed by the same absence Phase 1's post-implementation review found for `pos-frontend`'s nav concept, `21-post-implementation-review.md` §5). No work needed, matches `08-navigation-model.md` §5's existing scope note.

## 5. What does NOT change

- `Layout.tsx`, `ERPCommandPalette.tsx` — zero change. Both already call `filterNavGroups` with `enabledCapabilities` (Phase 1) — a new `capabilityKey`-tagged nav item is picked up automatically by the existing, generic filtering logic. This is precisely `08-navigation-model.md` §4's "no new industry ever requires touching `Layout.tsx`" claim, now exercised for real for the first time.
- No other existing nav item gains a `capabilityKey` — `Items`, `GRNs`, `Stock Transfers` etc. stay ungated (Commerce Core, always-on), consistent with `16-phase-roadmap.md` Phase 4's explicit scope boundary.
