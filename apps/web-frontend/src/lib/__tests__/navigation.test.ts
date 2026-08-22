// ES-34 — post-login landing previously always navigated to /dashboard regardless of
// whether the user actually held DASHBOARD_VIEW, so low-permission users landed straight
// on an Access Denied screen. getFirstAccessiblePath() walks NAV_GROUPS in declaration
// order (that order is the configurable module priority) and returns the first leaf path
// the user can actually reach, drilling into parent items with children.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  NAV_GROUPS,
  getFirstAccessiblePath,
  filterNavGroups,
  type NavGroup,
  type NavItem,
} from '../navigation.js';
import { PERMISSIONS } from '../../constants/permissions.js';

function has(...granted: string[]) {
  return (permission: string): boolean => granted.includes(permission);
}

describe('getFirstAccessiblePath', () => {
  it('returns null when the user has no permissions at all', () => {
    expect(getFirstAccessiblePath(NAV_GROUPS, has())).toBeNull();
  });

  it('returns /dashboard when the user has DASHBOARD_VIEW (first group, first item)', () => {
    expect(getFirstAccessiblePath(NAV_GROUPS, has(PERMISSIONS.DASHBOARD_VIEW))).toBe('/dashboard');
  });

  it('skips earlier inaccessible groups and lands on the first item the user can reach', () => {
    expect(getFirstAccessiblePath(NAV_GROUPS, has(PERMISSIONS.CUSTOMER_VIEW))).toBe('/customers');
  });

  it('drills into a parent-with-children item to find the first accessible grandchild', () => {
    expect(getFirstAccessiblePath(NAV_GROUPS, has(PERMISSIONS.ORGANIZATION_VIEW))).toBe(
      '/settings/organization'
    );
  });

  it('skips a parent whose children are all inaccessible and moves to the next item', () => {
    // No Settings/Users permissions, but has CUSTOMER_VIEW (SALES & CRM group) — should
    // never return a /settings/* path.
    const path = getFirstAccessiblePath(NAV_GROUPS, has(PERMISSIONS.CUSTOMER_VIEW));
    expect(path).not.toMatch(/^\/settings/);
  });
});

describe('filterNavGroups', () => {
  it('drops parent groups entirely once every child is filtered out', () => {
    const filtered = filterNavGroups(NAV_GROUPS, has(PERMISSIONS.DASHBOARD_VIEW), new Set());
    expect(filtered.every((g) => g.items.length > 0)).toBe(true);
    expect(filtered.some((g) => g.groupLabel === 'ANALYTICS')).toBe(true);
    expect(filtered.some((g) => g.groupLabel === 'PURCHASE')).toBe(false);
  });

  it('leaves every untagged item unaffected regardless of enabledCapabilities contents, for a user without any capability-gated permission', () => {
    // Every real, currently-shipped item except Near-Expiry Stock (INVENTORY_BATCH) and
    // Payroll (HR_PAYROLL, Phase 3A) is untagged. A user who also lacks BATCH_VIEW/
    // PAYROLL_VIEW never sees either item either way, so an empty set and a populated,
    // unrelated set must still filter identically for them (08-frontend-navigation.md §8).
    const withEmpty = filterNavGroups(NAV_GROUPS, has(PERMISSIONS.DASHBOARD_VIEW), new Set());
    const withUnrelated = filterNavGroups(
      NAV_GROUPS,
      has(PERMISSIONS.DASHBOARD_VIEW),
      new Set(['SOME_UNRELATED_CAPABILITY'])
    );
    expect(withUnrelated).toEqual(withEmpty);
  });

  it('Phase 2B: shows Near-Expiry Stock only when INVENTORY_BATCH is enabled AND the user holds BATCH_VIEW', () => {
    const hasBatchView = has(PERMISSIONS.BATCH_VIEW);
    const findItem = (groups: NavGroup[]) =>
      groups
        .find((g) => g.groupLabel === 'INVENTORY')
        ?.items.find((i) => i.label === 'Inventory')
        ?.children?.find((c) => c.path === '/inventory/near-expiry');

    // Permission alone, capability off — still hidden.
    expect(findItem(filterNavGroups(NAV_GROUPS, hasBatchView, new Set()))).toBeUndefined();
    // Capability on, no permission — still hidden.
    expect(
      findItem(filterNavGroups(NAV_GROUPS, has(), new Set(['INVENTORY_BATCH'])))
    ).toBeUndefined();
    // Both present — visible.
    expect(
      findItem(filterNavGroups(NAV_GROUPS, hasBatchView, new Set(['INVENTORY_BATCH'])))
    ).toBeDefined();
  });

  it('Phase 3A: shows Payroll only when HR_PAYROLL is enabled AND the user holds PAYROLL_VIEW', () => {
    const hasPayrollView = has(PERMISSIONS.PAYROLL_VIEW);
    const findItem = (groups: NavGroup[]) =>
      groups
        .find((g) => g.groupLabel === 'HR & PAYROLL')
        ?.items.find((i) => i.label === 'HR')
        ?.children?.find((c) => c.path === '/hr/payroll');

    // Permission alone, capability off — still hidden.
    expect(findItem(filterNavGroups(NAV_GROUPS, hasPayrollView, new Set()))).toBeUndefined();
    // Capability on, no permission — still hidden.
    expect(findItem(filterNavGroups(NAV_GROUPS, has(), new Set(['HR_PAYROLL'])))).toBeUndefined();
    // Both present — visible.
    expect(
      findItem(filterNavGroups(NAV_GROUPS, hasPayrollView, new Set(['HR_PAYROLL'])))
    ).toBeDefined();
  });

  it('drops an item whose capabilityKey is not in enabledCapabilities, keeps it once present', () => {
    const DummyIcon = (() => null) as unknown as NavItem['icon'];
    const groups: NavGroup[] = [
      {
        groupLabel: 'TEST',
        items: [
          {
            label: 'Gated Item',
            path: '/test/gated',
            icon: DummyIcon,
            capabilityKey: 'HR_PAYROLL',
          },
        ],
      },
    ];
    expect(filterNavGroups(groups, has(), new Set())).toEqual([]);
    expect(filterNavGroups(groups, has(), new Set(['HR_PAYROLL']))).toEqual(groups);
  });
});

// PG-019 — AuditLogPage was fully built, permission-gated, and routed in App.tsx, but had zero
// entry in navigation.ts, making it unreachable from both the sidebar and the command palette
// (both read NAV_GROUPS). This walks App.tsx's source for every <Route> wrapped in a
// <PermissionRoute> and flags any whose path is absent from NAV_GROUPS, so this exact class of
// bug — a route that works but can't be found — can't silently recur.
describe('every permission-gated App.tsx route has a navigation.ts entry', () => {
  function flattenNavPaths(groups: NavGroup[]): Set<string> {
    const paths = new Set<string>();
    const walk = (items: NavItem[]) => {
      for (const item of items) {
        paths.add(item.path);
        if (item.children) walk(item.children);
      }
    };
    groups.forEach((g) => walk(g.items));
    return paths;
  }

  const testFileDir = path.dirname(fileURLToPath(import.meta.url));
  const appTsx = readFileSync(path.resolve(testFileDir, '../../App.tsx'), 'utf-8');
  const navPaths = flattenNavPaths(NAV_GROUPS);

  // Detail/create/edit sub-routes (":id", "/new") are reached by clicking through a list page,
  // not via the sidebar or command palette, so they're intentionally excluded here.
  const isDynamicOrActionRoute = (routePath: string): boolean => /:|\/new$/.test(routePath);

  // Pre-existing gaps found while building this guard (2026-07-10) — out of scope for PG-019,
  // which only covers admin/audit-logs and admin/security-audit-log. Listed explicitly so the
  // guard still catches *new* regressions without failing on debt that predates it.
  const KNOWN_PRE_EXISTING_GAPS = new Set([
    '/hr/holidays',
    '/reports/ar-aging',
    '/reports/ap-aging',
    '/reports/sales-analytics',
    '/reports/inventory-analytics',
    '/reports/hr-analytics',
    // Same class as the three above — reachable via ReportsPage's ANALYTICS_DASHBOARDS
    // cards, not the sidebar/command palette. Added alongside them, not a new regression.
    '/reports/purchase-analytics',
    // Purchase audit 2026-07-21: reachable via SuppliersPage's "Import" button, not the
    // sidebar — same pattern as the analytics-dashboard cards above.
    '/suppliers/import',
    // CRM-ROADMAP Phase 1, Feature 7: reachable via CrmAccountsPage's/LeadsKanbanPage's
    // "Import" button, not the sidebar — same pattern as the imports above.
    '/crm/accounts/import',
    '/crm/leads/import',
  ]);

  const routeRegex = /<Route\s+path="([^"]+)"\s+element=\{\s*<Page>\s*<PermissionRoute/g;
  const permissionRoutePaths = [...appTsx.matchAll(routeRegex)].map((m) => m[1]!);

  it('parsed a plausible number of permission-gated routes from App.tsx (regex sanity check)', () => {
    expect(permissionRoutePaths.length).toBeGreaterThan(50);
  });

  const checkedPaths = permissionRoutePaths.filter(
    (p) => !isDynamicOrActionRoute(p) && !KNOWN_PRE_EXISTING_GAPS.has(`/${p}`)
  );

  it.each(checkedPaths)('"%s" is reachable via a navigation.ts entry', (routePath) => {
    expect(navPaths.has(`/${routePath}`)).toBe(true);
  });
});
