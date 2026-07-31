// RBAC audit 2026-07-31 — permanent regression guard for the recurring "dead permission
// constant" bug class documented extensively in apps/tenant-service/src/rbac/role-defaults.ts's
// own history (10+ prior fixes, e.g. migrations 0066/0070/0076 and many inline "security audit"
// comments): a route requires a permission that no NAMED OPERATIONAL role holds, leaving it
// reachable only by OWNER/ADMIN/SUPER_ADMIN even though it's clearly meant for day-to-day use.
//
// Deliberately NOT the naive "granted by zero roles" check: OWNER/SUPER_ADMIN default to
// TENANT_SCOPED_PERMISSIONS (every permission except the 2 platform-only ones), so that check
// would almost never fire. This test instead checks whether at least one NAMED role (i.e. not
// OWNER/ADMIN/SUPER_ADMIN) holds each permission a real route requires — the actual shape of
// every historical bug in this class.
//
// This is intentionally a text scan (same convention as route-guard-coverage.test.ts and
// dead-permission-constants.test.ts), not a full TS/AST parse.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '../../../..');
const APPS_DIR = join(REPO_ROOT, 'apps');
const ROLE_DEFAULTS_PATH = join(REPO_ROOT, 'apps/tenant-service/src/rbac/role-defaults.ts');

const WILDCARD_ROLES = new Set(['OWNER', 'ADMIN', 'SUPER_ADMIN']);

// Permissions confirmed (2026-07-31 audit) to be legitimately senior/admin-tier by design —
// destructive actions, platform/tenant-lifecycle config, or core-engine config with no
// day-to-day operational role. Do not add to this list without a documented reason; a new
// entry here should read the same way as the ones already present.
const ADMIN_ONLY_BY_DESIGN = new Set([
  'API_KEY_MANAGE', // tenant-wide public-API credential issuance
  'BRANCH_MANAGE', // create/edit/delete branch master records
  'CRM_CAMPAIGN_APPROVE', // segregation of duties: creator (SALES_MANAGER) != approver, see role-defaults.ts
  'CRM_CAMPAIGN_SEND', // DLT/TRAI-compliance-sensitive bulk customer messaging, same reasoning as APPROVE
  'CUSTOMER_DELETE', // destructive; SALES_MANAGER/CASHIER use CUSTOMER_BLOCK for the operational equivalent
  'CUSTOMER_MERGE', // destructive/data-integrity-sensitive
  'DLQ_MANAGE', // platform-internal ops tooling (replay/discard dead letters)
  'FEATURE_FLAG_UPDATE',
  'FEATURE_FLAG_VIEW',
  'FINANCIAL_YEAR_CLOSE', // rare, high-stakes, irreversible accounting action
  'FINANCIAL_YEAR_OPEN',
  'IMPERSONATE_PORTAL_CUSTOMER',
  'IMPERSONATE_USER',
  'ITEM_DELETE', // destructive
  'NOTIFICATION_SEND', // raw system-level send API, not a business workflow action
  'NUMBER_SERIES_CONFIG', // one-time/rare document-numbering setup
  'OPENING_BALANCE_LOCK', // one-time tenant-onboarding action
  'ORG_SETTINGS_EDIT',
  'PLATFORM_TENANT_MANAGE', // cross-tenant, platform-operator only by design (see role-defaults.ts header)
  'PORTAL_ACCOUNT_MANAGE',
  'POSTING_MATRIX_UPDATE', // core accounting-engine configuration
  'POSTING_MATRIX_VIEW',
  'PROJECTION_MANAGE', // platform-internal ops tooling
  'SAGA_MANAGE',
  'SCHEMA_REGISTRY_MANAGE',
  'SSO_CONFIG_MANAGE',
  'SUPPLIER_DELETE', // destructive
]);

// Confirmed real gaps (2026-07-31 audit), deliberately deferred pending a product decision on
// which role — if any — should own these, since no existing named role (there is no
// PRODUCTION_MANAGER role) obviously owns either domain the way SALES_MANAGER obviously owned
// the CRM permissions fixed in the same audit pass. Do not silently expand this list further —
// each new entry should be a genuinely new deferred decision, not a place to dump future findings.
const DEFERRED_PENDING_PRODUCT_DECISION = new Set([
  'CONSIGNMENT_RECEIVE',
  'CONSIGNMENT_RETURN',
  'CONSIGNMENT_SETTLE',
  'CONSIGNMENT_VIEW',
  'JOB_WORK_CANCEL',
  'JOB_WORK_COMPLETE',
  'JOB_WORK_CREATE',
  'JOB_WORK_ISSUE_MATERIALS',
  'JOB_WORK_QUALITY_CHECK',
  'JOB_WORK_VIEW',
]);

function parseRoleGrants(source: string): Map<string, Set<string>> {
  const roleKeyPattern = /^ {2}([A-Z_]+):/gm;
  const roleKeyMatches = [...source.matchAll(roleKeyPattern)];
  const roleGrants = new Map<string, Set<string>>();

  for (let i = 0; i < roleKeyMatches.length; i++) {
    const role = roleKeyMatches[i]![1]!;
    if (WILDCARD_ROLES.has(role)) continue;
    const start = roleKeyMatches[i]!.index!;
    const end = roleKeyMatches[i + 1]?.index ?? source.length;
    const block = source.slice(start, end);
    const grants = new Set([...block.matchAll(/PERMISSIONS\.([A-Z0-9_]+)/g)].map((m) => m[1]!));
    roleGrants.set(role, grants);
  }
  return roleGrants;
}

interface RouteMatch {
  method: string;
  path: string;
  index: number;
}

function findRoutes(source: string): RouteMatch[] {
  const pattern = /fastify\.(get|post|put|patch|delete)(?:<[^>(]*>)?\(\s*['"`]([^'"`]+)['"`]/g;
  const matches: RouteMatch[] = [];
  let m: RegExpExecArray | null;
  while ((m = pattern.exec(source)) !== null) {
    matches.push({ method: m[1]!.toUpperCase(), path: m[2]!, index: m.index });
  }
  return matches;
}

function collectRouteFiles(dir: string, out: string[]): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (['node_modules', 'dist', '__tests__'].includes(entry.name)) continue;
      collectRouteFiles(full, out);
    } else if (entry.name.endsWith('.routes.ts')) {
      out.push(full);
    }
  }
}

describe('RBAC role/route coverage', () => {
  it('every route-required permission is held by at least one named operational role, an admin-only-by-design exception, or a documented deferred item', () => {
    const roleDefaultsSource = readFileSync(ROLE_DEFAULTS_PATH, 'utf8');
    const roleGrants = parseRoleGrants(roleDefaultsSource);

    const grantedByAnyNamedRole = new Set<string>();
    for (const grants of roleGrants.values()) {
      for (const perm of grants) grantedByAnyNamedRole.add(perm);
    }

    const routeFiles: string[] = [];
    for (const service of readdirSync(APPS_DIR, { withFileTypes: true })) {
      if (!service.isDirectory()) continue;
      const srcDir = join(APPS_DIR, service.name, 'src');
      try {
        collectRouteFiles(srcDir, routeFiles);
      } catch {
        // no src/ dir, skip
      }
    }
    expect(routeFiles.length).toBeGreaterThan(20); // sanity check the scan actually found the services

    const findings: string[] = [];
    for (const file of routeFiles) {
      const relPath = file.split(/[\\/]/).slice(-4).join('/');
      const source = readFileSync(file, 'utf8');
      const routes = findRoutes(source);

      for (let i = 0; i < routes.length; i++) {
        const route = routes[i]!;
        const blockEnd = routes[i + 1]?.index ?? source.length;
        const block = source.slice(route.index, blockEnd);

        const perms = new Set<string>();
        for (const m of block.matchAll(/requirePermission\(\s*PERMISSIONS\.([A-Z0-9_]+)/g)) {
          perms.add(m[1]!);
        }
        const anyMatch = block.match(/requireAnyPermission\(\s*\[([^\]]+)\]/);
        if (anyMatch) {
          for (const pm of anyMatch[1]!.matchAll(/PERMISSIONS\.([A-Z0-9_]+)/g)) perms.add(pm[1]!);
        }

        for (const perm of perms) {
          if (grantedByAnyNamedRole.has(perm)) continue;
          if (ADMIN_ONLY_BY_DESIGN.has(perm)) continue;
          if (DEFERRED_PENDING_PRODUCT_DECISION.has(perm)) continue;
          findings.push(`PERMISSIONS.${perm} <- ${relPath}: ${route.method} ${route.path}`);
        }
      }
    }

    expect(
      findings,
      `New route(s) require a permission no named operational role holds. Either add the ` +
        `permission to the correct role in role-defaults.ts (+ a backfill migration), or if ` +
        `this is intentionally senior-only/deferred, add it to ADMIN_ONLY_BY_DESIGN or ` +
        `DEFERRED_PENDING_PRODUCT_DECISION above with a one-line reason:\n${findings.join('\n')}`
    ).toEqual([]);
  });
});
