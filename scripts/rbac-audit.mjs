#!/usr/bin/env node
// One-time (re-runnable) audit: cross-checks apps/tenant-service/src/rbac/role-defaults.ts
// grants against real requirePermission()/requireAnyPermission() route guards across every
// apps/*/src/api/*.routes.ts file.
//
// Why this check (and not a naive "granted by zero roles" check): OWNER/SUPER_ADMIN default
// to virtually every tenant-scoped permission (TENANT_SCOPED_PERMISSIONS = all PERMISSIONS
// minus the 2 platform-only ones), so "granted by zero roles" would almost never fire for a
// real bug — OWNER always has it. The actual recurring historical bug (documented inline in
// role-defaults.ts across ~10 prior "security audit" fixes) is: a NAMED OPERATIONAL role
// (SALES_MANAGER, CASHIER, PURCHASE_MANAGER, ACCOUNTANT, INVENTORY_MANAGER, HR_MANAGER,
// STAFF, ACCOUNTANT_SUPERVISOR, AUDITOR, DATA_OFFICER) is missing a permission its own
// day-to-day routes require, leaving a route reachable only by OWNER/ADMIN/SUPER_ADMIN even
// though it's clearly meant for operational use. That's what category (a) below detects.
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..');
const APPS_DIR = join(REPO_ROOT, 'apps');
const ROLE_DEFAULTS_PATH = join(REPO_ROOT, 'apps/tenant-service/src/rbac/role-defaults.ts');
const PERMISSIONS_PATH = join(REPO_ROOT, 'packages/shared-types/src/permissions.ts');

const WILDCARD_ROLES = new Set(['OWNER', 'ADMIN', 'SUPER_ADMIN']);

// ── 1. Load the full permission constant list ──────────────────────────────
const permissionsSource = readFileSync(PERMISSIONS_PATH, 'utf8');
const allPermissions = new Set(
  [...permissionsSource.matchAll(/^\s{2}([A-Z0-9_]+):\s*'[A-Z0-9_]+',?\s*$/gm)].map((m) => m[1])
);

// ── 2. Parse role-defaults.ts into { role -> Set<permission> } for named roles ─
const roleDefaultsSource = readFileSync(ROLE_DEFAULTS_PATH, 'utf8');
const roleKeyPattern = /^ {2}([A-Z_]+):/gm;
const roleKeyMatches = [...roleDefaultsSource.matchAll(roleKeyPattern)];

const roleGrants = new Map(); // role -> Set<permission>
for (let i = 0; i < roleKeyMatches.length; i++) {
  const role = roleKeyMatches[i][1];
  if (WILDCARD_ROLES.has(role)) continue;
  const start = roleKeyMatches[i].index;
  const end = roleKeyMatches[i + 1]?.index ?? roleDefaultsSource.length;
  const block = roleDefaultsSource.slice(start, end);
  const grants = new Set([...block.matchAll(/PERMISSIONS\.([A-Z0-9_]+)/g)].map((m) => m[1]));
  roleGrants.set(role, grants);
}

const permissionGrantedByNamedRoles = new Map(); // permission -> Set<role>
for (const [role, grants] of roleGrants) {
  for (const perm of grants) {
    if (!permissionGrantedByNamedRoles.has(perm))
      permissionGrantedByNamedRoles.set(perm, new Set());
    permissionGrantedByNamedRoles.get(perm).add(role);
  }
}

// ── 3. Scan every routes.ts file for requirePermission/requireAnyPermission calls ──
function findRoutes(source) {
  const pattern = /fastify\.(get|post|put|patch|delete)(?:<[^>(]*>)?\(\s*['"`]([^'"`]+)['"`]/g;
  const matches = [];
  let m;
  while ((m = pattern.exec(source)) !== null) {
    matches.push({ method: m[1].toUpperCase(), path: m[2], index: m.index });
  }
  return matches;
}

function collectRouteFiles(dir, out) {
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

const routeFiles = [];
for (const service of readdirSync(APPS_DIR, { withFileTypes: true })) {
  if (!service.isDirectory()) continue;
  const srcDir = join(APPS_DIR, service.name, 'src');
  try {
    collectRouteFiles(srcDir, routeFiles);
  } catch {
    // no src/ dir, skip
  }
}

const routePermissions = new Map(); // permission -> Set<"service: METHOD path">
for (const file of routeFiles) {
  const relPath = file.split(/[\\/]/).slice(-4).join('/');
  const source = readFileSync(file, 'utf8');
  const routes = findRoutes(source);

  for (let i = 0; i < routes.length; i++) {
    const route = routes[i];
    const blockEnd = routes[i + 1]?.index ?? source.length;
    const block = source.slice(route.index, blockEnd);

    // requirePermission(PERMISSIONS.X)
    for (const m of block.matchAll(/requirePermission\(\s*PERMISSIONS\.([A-Z0-9_]+)/g)) {
      const perm = m[1];
      if (!routePermissions.has(perm)) routePermissions.set(perm, new Set());
      routePermissions.get(perm).add(`${relPath}: ${route.method} ${route.path}`);
    }
    // requireAnyPermission([PERMISSIONS.X, PERMISSIONS.Y])
    const anyMatch = block.match(/requireAnyPermission\(\s*\[([^\]]+)\]/);
    if (anyMatch) {
      for (const pm of anyMatch[1].matchAll(/PERMISSIONS\.([A-Z0-9_]+)/g)) {
        const perm = pm[1];
        if (!routePermissions.has(perm)) routePermissions.set(perm, new Set());
        routePermissions.get(perm).add(`${relPath}: ${route.method} ${route.path} (any-of)`);
      }
    }
  }
}

// ── 4. Category (a): high-confidence — checked by a route, granted by NO named role ──
const highConfidence = [];
for (const [perm, routes] of [...routePermissions.entries()].sort()) {
  const grantors = permissionGrantedByNamedRoles.get(perm);
  if (!grantors || grantors.size === 0) {
    highConfidence.push({
      permission: perm,
      routes: [...routes],
      existsInPermissions: allPermissions.has(perm),
    });
  }
}

// ── 5. Category (b): review-only — granted by ≥1 named role, checked by ZERO routes ──
const reviewOnly = [];
for (const [perm, grantors] of [...permissionGrantedByNamedRoles.entries()].sort()) {
  if (!routePermissions.has(perm)) {
    reviewOnly.push({ permission: perm, grantedBy: [...grantors] });
  }
}

// ── Report ───────────────────────────────────────────────────────────────
console.log(
  `Scanned ${routeFiles.length} route files, ${roleGrants.size} named roles, ${allPermissions.size} total permission constants.\n`
);

console.log(
  `\n=== CATEGORY (a) — HIGH CONFIDENCE: route requires a permission no named operational role holds (${highConfidence.length} found) ===`
);
for (const f of highConfidence) {
  console.log(
    `\n  PERMISSIONS.${f.permission}  ${f.existsInPermissions ? '' : '[!! NOT DEFINED IN permissions.ts — likely typo !!]'}`
  );
  for (const r of f.routes) console.log(`    - ${r}`);
}

console.log(
  `\n\n=== CATEGORY (b) — REVIEW ONLY: granted to a named role but no route requirePermission/requireAnyPermission call found (${reviewOnly.length} found) ===`
);
console.log(
  '  (caveat: may be checked via a different guard, e.g. hasPermission()/assertPermission() inline — verify before treating as dead)'
);
for (const f of reviewOnly) {
  console.log(`  PERMISSIONS.${f.permission}  <- granted by: ${f.grantedBy.join(', ')}`);
}
