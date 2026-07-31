// ES-35 — the architecture audit's root-cause finding was that route authorization is
// "opt-in per route, not enforced by the framework": nothing failed a build or test if a
// new route forgot its permission guard. ES-33 found four routes that had silently
// shipped exactly that way (gst-service's retry-pending endpoint, all of scheduler-service,
// two notification/search-service routes). This test is the framework-level backstop the
// audit recommended: it statically scans every service's business route files and fails
// if a route has no recognizable auth guard, so the next one doesn't ship silently either.
//
// This is intentionally a text scan, not a full TS/AST parse — good enough to catch the
// shape of bug this phase found, without taking on a heavier dependency for a repo-wide
// audit test. `KNOWN_EXCEPTIONS` documents every route this scan can't verify by pattern
// alone (health checks, and services where authorization is a query-time business rule,
// not a per-route guard) — anything not on that list must show a recognizable guard.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '../../../..');
const APPS_DIR = join(REPO_ROOT, 'apps');

// Files entirely exempt from the scan: internal/service-to-service routes (guarded by
// requireInternalKey, checked separately below) and non-business infra endpoints.
const EXEMPT_FILE_PATTERNS = [/internal\.routes\.ts$/, /health/i];

// path -> route paths inside it that are legitimately unguarded (documented, not silent).
// '*' means every route in the file is exempt.
const KNOWN_EXCEPTIONS: Record<string, string[]> = {
  // Personal-account/self-service routes: `authenticate` is applied via a scoped
  // plugin-level preHandler hook in main.ts (not per-route, so this scanner can't see it),
  // and every action operates on the caller's own account — no business permission needed.
  'auth-service/src/routes/mfa.routes.ts': ['*'],
  'auth-service/src/routes/sessions.routes.ts': ['*'],
  'auth-service/src/routes/impersonate.routes.ts': ['/admin/impersonate/end'],
  // CRM-ROADMAP Phase 3, Feature 2 (Self-Service Customer Portal): the portal's own
  // login/refresh/logout/set-password surface — same "this IS the auth surface, a customer has
  // no JWT yet to present" reasoning as the staff login.ts/refresh.ts/logout.ts/forgot-password.ts/
  // reset-password.ts files (which escape this scanner entirely for not ending in .routes.ts;
  // this file is named portal-auth.routes.ts so it's listed here explicitly instead).
  'auth-service/src/routes/portal-auth.routes.ts': [
    '/auth/portal/set-password',
    '/auth/portal/login',
    '/auth/portal/refresh',
    '/auth/portal/logout',
  ],
  // Self-service notification inbox/preferences — every route is scoped to the caller's
  // own userId (see ES-33 completion report); `NOTIFICATION_SEND` gates sending to others.
  'notification-service/src/api/notification.routes.ts': [
    '/notifications',
    '/notifications/:id/read',
    '/notifications/preferences',
    '/notifications/unread-count',
    '/notifications/stream',
  ],
  // Public token-based unsubscribe link (clicked from an email, no login) — authorized by
  // possessing the token itself, not a JWT.
  'report-service/src/api/analytics-reports.routes.ts': ['/api/v2/unsubscribe/:token'],
  // CRM-ROADMAP Phase 2, Feature 6 — same "authorized by possessing the token" reasoning as
  // the unsubscribe link above: a campaign recipient clicking a tracked link or loading an
  // email open-pixel isn't logged in.
  'sales-service/src/api/link-tracking.routes.ts': ['/c/:trackingToken', '/o/:trackingToken'],
  // Authenticate-only by design: any authenticated tenant user in a document-create flow
  // (invoice/PO/etc.) needs the next series number — this isn't a standalone admin action
  // like the sibling /config/number-series/* routes (which now require
  // NUMBER_SERIES_CONFIG), just a counter read scoped to the caller's own tenant.
  'report-service/src/api/report.routes.ts': ['/internal/number-series/:type/next'],
  // Record-level authorization: the approval engine scopes every query/action to the
  // caller's own userId as the assigned approver — there's no broader "view all approvals"
  // permission to check.
  'tenant-service/src/api/approval.routes.ts': ['*'],
  // Reference data — viewable by any authenticated tenant member (dropdowns, org display);
  // mutations on these same files already require BRANCH_MANAGE / ORG_SETTINGS_EDIT.
  'tenant-service/src/api/branch.routes.ts': ['/branches', '/branches/:id'],
  'tenant-service/src/api/organization.routes.ts': ['/organization'],
  // Template download — static CSV headers, not tenant/user data (see ES-33/34 research).
  'scheduler-service/src/api/import.routes.ts': ['/imports/templates/:entityType'],
  // Inventory module audit 2026-07-21: adding requireAnyPermission( to GUARD_MARKERS (this
  // scanner previously couldn't see that pattern at all, across the whole repo) surfaced
  // these six pre-existing, unrelated-to-inventory gaps in the scanner's coverage. Each
  // verified individually below — none are actual vulnerabilities, all are guard patterns
  // this per-route-block text scan structurally can't see.
  //
  // Whole-file `fastify.addHook('preHandler', authenticate)` (not a per-route preHandler) —
  // same shape as mfa.routes.ts/sessions.routes.ts above; every route scopes to the caller's
  // own DAP tour progress, no business permission needed.
  'event-service/src/api/dap.routes.ts': ['*'],
  // Self-service employee routes, all under /me/* — same shape as notification.routes.ts's
  // self-service exception above.
  'hr-service/src/api/employee-self-service.routes.ts': ['*'],
  // Public-facing provider webhook receivers — no JWT by design; each verifies the
  // provider's own cryptographic/shared-secret signature over the raw request body instead
  // (see the file's own header comment and the per-route verifySendGridSignature/
  // verifyMetaSignature/shared-secret checks).
  'notification-service/src/api/webhook.routes.ts': ['*'],
  // Outbound webhook-subscription CRUD is genuinely guarded by a named preHandler constant
  // (`WEBHOOK_MANAGE`, built from requirePermission(INTEGRATION_WEBHOOK_MANAGE) once and
  // reused per-route) — the scanner's per-route-block slice never contains the literal
  // `requirePermission(` text since it's declared outside every route's own block.
  'sales-service/src/api/integrations.routes.ts': ['*'],
  // Same named-preHandler-constant pattern as integrations.routes.ts above (`PLATFORM_CONTENT_ADMIN`,
  // built from requirePermission(PLATFORM_CONTENT_MANAGE) once and reused). /public/faqs itself
  // is intentionally public (unauthenticated FAQ list).
  'tenant-service/src/api/faq.routes.ts': ['*'],
  // Self-serve tenant signup — intentionally public (own IP-keyed rate limit, no tenant/auth
  // context exists yet to gate on), see the route's own header comment.
  'tenant-service/src/api/tenant.routes.ts': ['/public/signup'],
  // Public lead-capture form submission — intentionally public (own IP-keyed rate limit,
  // no tenant/auth context exists yet to gate on), same shape as /public/signup above.
  'tenant-service/src/api/demo-request.routes.ts': ['/public/demo-requests'],
  // CRM-ROADMAP Phase 1, Feature 2: the CRM equivalent of demo-request.routes.ts above —
  // public, rate-limited, honeypot-gated (see the route's own header comment and
  // 06-SECURITY-PLAN.md §2.1). Every other route in this file is authenticate + requirePermission
  // guarded as normal.
  'sales-service/src/api/lead.routes.ts': ['/leads/capture'],
  // CRM-ROADMAP Phase 2, Feature 4: a referral link click and code redemption both happen
  // before the referee is a logged-in anything — same public/rate-limited/honeypot shape as
  // lead.routes.ts's own capture route above.
  'sales-service/src/api/referral-public.routes.ts': ['/r/:code', '/referral/redeem'],
  // CRM-ROADMAP Phase 2, Feature 5: inbound provider webhooks — verified by provider signature
  // instead of a JWT/permission guard, same shape as every public route file above.
  'sales-service/src/api/inbound-webhooks.routes.ts': [
    '/webhooks/whatsapp',
    '/webhooks/email',
    '/webhooks/sms',
    // CRM-ROADMAP Phase 4, Feature 7: Twilio's own webhooks, verified by verifyTwilioSignature
    // (a different algorithm from the Meta/HMAC schemes above, but the same "provider signature
    // instead of a JWT/permission guard" shape).
    '/webhooks/twilio/voice',
    '/webhooks/twilio/status',
    '/webhooks/twilio/recording',
  ],
};

const GUARD_MARKERS = [
  'requirePermission(',
  'requireAnyPermission(',
  'requireInternalKey(',
  'PLATFORM_ADMIN',
  'hasPermission(request',
  'hasPermission(req',
  '.permissions.includes(', // dynamic per-report/per-record permission checks
  'timingSafeEqual(', // inline internal-key checks not using the shared requireInternalKey helper
  'checkInternalKey', // report-service's locally-named equivalent of requireInternalKey
  'assertPermission(', // purchase-service attachment.routes.ts: entityType (and so the required
  // permission) is only known partway through the handler, so it calls @erp/sdk's checkPermission
  // via a local assertPermission() wrapper instead of a static requirePermission() preHandler.
  'requirePortalAuth', // CRM-ROADMAP Phase 3, Feature 2 (Self-Service Customer Portal):
  // sales-service/src/api/portal.routes.ts's customer-facing routes gate on a CUSTOMER-role JWT
  // via this preHandler instead of requirePermission/authenticate — a genuinely new guard
  // pattern (present in coverage, not KNOWN_EXCEPTIONS, per this feature's own roadmap DoD).
  // No trailing '(' unlike requirePermission( — this one is referenced bare (`[requirePortalAuth]`),
  // never invoked with arguments.
  'requirePublicApiScope(', // CRM-ROADMAP Phase 4, Feature 8 (Public CRM API & BI Export):
  // sales-service/src/api/public-api.routes.ts's routes gate on a per-tenant API key (via the
  // `x-api-key` header) instead of a staff JWT — a third auth mechanism, same "genuinely new
  // guard pattern, present in coverage not KNOWN_EXCEPTIONS" precedent as requirePortalAuth above.
];

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
      if (entry.name === 'api') collectRouteFiles(full, out);
      else if (entry.name === 'src') collectRouteFiles(full, out);
      else if (['node_modules', 'dist', '__tests__'].includes(entry.name)) continue;
      else collectRouteFiles(full, out);
    } else if (entry.name.endsWith('.routes.ts')) {
      out.push(full);
    }
  }
}

describe('route-guard coverage', () => {
  it('every business route in apps/*/src/api/*.routes.ts has a recognizable auth guard', () => {
    const routeFiles: string[] = [];
    for (const service of readdirSync(APPS_DIR, { withFileTypes: true })) {
      if (!service.isDirectory()) continue;
      const srcDir = join(APPS_DIR, service.name, 'src');
      try {
        collectRouteFiles(srcDir, routeFiles);
      } catch {
        // service has no src/ (shouldn't happen, but don't fail the whole scan on it)
      }
    }

    expect(routeFiles.length).toBeGreaterThan(20); // sanity check the scan actually found the services

    const unguarded: string[] = [];

    for (const file of routeFiles) {
      const relPath = file.split(/[\\/]/).slice(-4).join('/'); // apps/<service>/src/api/<file>
      const shortKey = relPath.replace(/^apps\//, ''); // <service>/src/api/<file>
      if (EXEMPT_FILE_PATTERNS.some((p) => p.test(file))) continue;

      const source = readFileSync(file, 'utf8');
      const routes = findRoutes(source);
      const exceptions = KNOWN_EXCEPTIONS[shortKey] ?? [];
      if (exceptions.includes('*')) continue;

      for (let i = 0; i < routes.length; i++) {
        const route = routes[i]!;
        if (exceptions.includes(route.path)) continue;

        const blockEnd = routes[i + 1]?.index ?? source.length;
        const block = source.slice(route.index, blockEnd);
        const guarded = GUARD_MARKERS.some((marker) => block.includes(marker));
        if (!guarded) {
          unguarded.push(`${shortKey}: ${route.method} ${route.path}`);
        }
      }
    }

    expect(
      unguarded,
      `Unguarded routes found (add a permission guard, or a documented exception in KNOWN_EXCEPTIONS if this is intentional):\n${unguarded.join('\n')}`
    ).toEqual([]);
  });
});
