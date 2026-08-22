# 01 — Current Code Evidence

Everything in this phase's plan builds directly on the code below, verified against the actual repository on 2026-08-18 (not from memory or prior planning docs). A coding session should treat this file as the ground truth for "what exists today" and cross-check before assuming anything has changed.

## 1. `requirePermission` — the pattern `requireCapability` must mirror exactly

Not centralized in one file — each of 14 services has its own copy at `apps/<service>/src/middleware/authorize.ts`. Representative (11 of 14 services follow this exact shape), `apps/tenant-service/src/middleware/authorize.ts:1-16`:

```ts
import type { FastifyRequest, FastifyReply, preHandlerAsyncHookHandler } from 'fastify';
import { checkPermission } from '@erp/sdk';

export function requirePermission(permission: string): preHandlerAsyncHookHandler {
  return async function (request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const auth = (request as FastifyRequest & { auth?: { permissions: string[] } }).auth;
    const result = checkPermission(auth, permission);
    if (result === 'unauthenticated') {
      await reply.code(401).send({ error: { code: 'UNAUTHORIZED', message: 'Unauthenticated' } });
      return;
    }
    if (result === 'forbidden') {
      await reply
        .code(403)
        .send({ error: { code: 'FORBIDDEN', message: `Missing permission: ${permission}` } });
    }
  };
}
```

Pure decision logic, `packages/platform-sdk/src/auth.ts:68-74`:

```ts
export function checkPermission(
  auth: { permissions: string[] } | undefined,
  permission: string
): PermissionCheckResult {
  if (!auth) return 'unauthenticated';
  return auth.permissions.includes(permission) ? 'ok' : 'forbidden';
}
```

**Critical, non-obvious fact: `requirePermission` does NOT throw an error class.** It replies directly (`reply.code().send()`) and returns, bypassing `registerErrorHandler` entirely. `requireCapability` must follow this exact pattern for consistency — throwing a `BusinessError` instead would produce a different-shaped response (422 vs 401/403) and would be a silent deviation from the established convention. (One service, `apps/auth-service/src/middleware/authorize.ts:5-17`, uses a bare `{ error: string }` shape instead — a pre-existing inconsistency, not to be copied.)

`request.auth` is populated by each service's own `authenticate.ts` via Fastify module augmentation, e.g. `apps/tenant-service/src/middleware/authenticate.ts:4-8,20`:

```ts
declare module 'fastify' {
  interface FastifyRequest {
    auth: AuthPayload;
  }
}
// ...
request.auth = await verifyAccessToken(authHeader.slice(7));
```

## 2. Global error handler and error envelope

`packages/platform-sdk/src/error-handler.ts:35-98`, `registerErrorHandler(fastify, serviceName, logger)`:

```ts
if (error instanceof ERPError) {
  return reply.code(error.statusCode).send({
    error: { code: error.code, message: error.message, details: error.details },
  });
}
```

Envelope for every error path: `{ error: { code, message, details? } }`. `ERPError`/`BusinessError`, `packages/shared-types/src/errors.ts:1-11,39-43`:

```ts
export class ERPError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode: number = 500,
    public readonly details?: Record<string, unknown>
  ) {
    super(message);
    this.name = this.constructor.name;
  }
}
export class BusinessError extends ERPError {
  constructor(code: string, message: string, details?: Record<string, unknown>) {
    super(code, message, 422, details);
  }
}
```

`BusinessError` always carries **422**. `requirePermission`'s direct-reply pattern uses 401/403 instead — `requireCapability` follows `requirePermission`'s pattern (401/403 via direct reply), not `BusinessError`'s (422 via throw). See `11-api-contracts.md` for the exact contract.

There is also an unused-by-`requirePermission` `PermissionError` class (`packages/shared-types/src/errors.ts:33-37`, `code: 'PERMISSION_DENIED'`, statusCode 403) that exists but isn't actually thrown by the real guard — noted so a coding session doesn't mistake it for the live pattern.

## 3. `PlatformFeatureFlags` — exact current API

`packages/platform-sdk/src/feature-flags.ts` (132 lines, full file):

```ts
// Constructor, L33-40
constructor(
  private readonly db: TenantScopedDatabase,
  private readonly cache: TenantScopedCache,
  private readonly tenantId: number,
  sharedL1Cache?: FeatureFlagL1Cache
) {
  this.l1 = sharedL1Cache ?? new Map();
}

// L42-45
async isEnabled(flagKey: string): Promise<boolean> {
  const { enabled } = await this.getValue(flagKey);
  return enabled;
}

// L47-68 — lookup order: L1 (in-memory, 30s TTL) -> L2 (Redis, 300s TTL) -> DB -> backfill
async getValue(flagKey: string): Promise<FeatureFlagValue> { /* ... */ }

// L70-100 — reads feature_flags WHERE tenant_id = this.tenantId OR tenant_id IS NULL,
// picks tenantSpecific ?? globalDefault, missing flag => { enabled: false }
private async fetchFromDb(flagKey: string): Promise<FeatureFlagValue> { /* ... */ }

// L113-117 — clears L2 (Redis), clears local L1, publishes to erp:feature-flags:invalidate
async invalidate(flagKey: string): Promise<void> { /* ... */ }

// L120-130 — static, subscribes a shared L1 cache to cross-process invalidation
static subscribeToInvalidations(redis: import('ioredis').default, l1Cache: FeatureFlagL1Cache): void { /* ... */ }
```

`isEnabled(flagKey)` is the correct method for `requireCapability` to call — it's the thin boolean wrapper already built for exactly this purpose.

## 4. How `db`/`cache` actually reach a preHandler — NOT Fastify decorators

**Important correction to `21-capability-resolution-architecture.md` §3's original sketch**, which wrote `new PlatformFeatureFlags(request.db, request.cache, request.auth.tenantId)`. Verified: **no `request.db` or `fastify.redis`/`request.cache` decorator exists anywhere in this codebase.** The real, proven pattern is closure params threaded from service bootstrap into route-registration functions, e.g. `apps/auth-service/src/routes/feature-flags.routes.ts:16,72-75`:

```ts
export async function featureFlagsRoutes(fastify: FastifyInstance, db: ErpDatabase, redis: Redis) {
  // ...
  const tsDb = new TenantScopedDatabase(tenantId, db);
  const tsCache = new TenantScopedCache(redis, tenantId);
  const flags = new PlatformFeatureFlags(tsDb, tsCache, tenantId);
  await flags.invalidate(flagKey);
}
```

`tenantId` there comes from `request.auth.tenantId` (available after `authenticate` runs); `db`/`redis` are plain params passed in when the service's bootstrap (`server.ts`/`main.ts`) registers the route plugin. `requireCapability`'s factory must accept `db`/`redis` the same way — see `05-platform-sdk.md`.

There is also a second, richer pattern — `PlatformContext` (`packages/platform-sdk/src/context.ts:82-96`) already builds a per-request `PlatformFeatureFlags` instance as `this.features`, for services that construct a `PlatformContext`. **Which pattern a given service already uses (raw closure params vs. `PlatformContext`) must be checked per-service before Phase 2 wires real routes** — out of scope for this phase (see `06-service-enforcement.md` §4).

## 5. `PLATFORM_ADMIN` preHandler composition pattern

`apps/tenant-service/src/api/tenant.routes.ts:19-22`:

```ts
const PLATFORM_ADMIN: [typeof authenticate, ReturnType<typeof requirePermission>] = [
  authenticate,
  requirePermission(PERMISSIONS.PLATFORM_TENANT_MANAGE),
];
```

Used as `{ preHandler: PLATFORM_ADMIN }`. A future capability-gated route composes identically: `[authenticate, requireCapability('HR_PAYROLL', db, redis), requirePermission(PERMISSIONS.HR_VIEW)]` — capability check ordered before permission check (cheaper failure, clearer error), per `21-capability-resolution-architecture.md` §3.

## 6. Route-level authz test pattern to mirror

`apps/tenant-service/src/__tests__/tenant-admin-authz.test.ts`:

- RSA keypair via `generateKeyPairSync`, `process.env['JWT_PUBLIC_KEY']` set in `beforeAll` (lines 45-53).
- `signToken({ sub, tenantId, permissions })` — real signed JWT via `jose`'s `SignJWT`, issuer `'erp-auth-service'` (lines 55-73).
- `makeFakeDb()` — stub Drizzle-like object with `select/update/insert` (lines 81-107).
- `buildApp(db)` — `Fastify({ logger: false })` + real route registration (lines 113-117).
- Representative case (lines 130-143):

```ts
it('2. GET /admin/tenants with a valid token lacking PLATFORM_TENANT_MANAGE → 403', async () => {
  const { db } = makeFakeDb();
  const app = await buildApp(db);
  const token = await signToken({ sub: '1', tenantId: 1, permissions: ['INVOICE_VIEW'] });
  const res = await app.inject({
    method: 'GET',
    url: '/admin/tenants',
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(res.statusCode).toBe(403);
  await app.close();
});
```

## 7. `feature_flags` table — exact current schema

`packages/db-client/src/schema/index.ts:90-105`:

```ts
export const featureFlags = pgTable(
  'feature_flags',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    tenantId: integer('tenant_id'), // nullable — null row = global default
    flagKey: varchar('flag_key', { length: 200 }).notNull(),
    enabled: boolean('enabled').notNull().default(false),
    config: jsonb('config'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    unique('feature_flags_tenant_key').on(t.tenantId, t.flagKey),
    index('idx_feature_flags_tenant').on(t.tenantId, t.flagKey),
  ]
);
```

## 8. Confirmed real, currently-seeded flag keys usable as Phase 1's 2 proof capabilities

`hr.payroll.enabled` (seeded per-tenant in `TenantProvisioner.ts` provisioning step 8, per prior discovery pass) and `pos.enabled` (seeded as a global default in `packages/db-client/migrations/0022_es28_seed_feature_flag_defaults.sql`). Both are real, both have existing tenants with real rows — not hypothetical.

## 9. Confirmed: nothing named `requireCapability`/`CapabilityGuard`/`CAPABILITY_REGISTRY` exists yet

Repo-wide case-insensitive grep found zero matches in `packages/platform-sdk` or anywhere else in application code (only prose mentions inside `ERP-PLANNING/multi-industry-platform/*.md`). This phase is additive against a clean slate — nothing to migrate or conflict with.

## 10b. Addendum (found during pre-implementation gate review, 2026-08-18) — `TenantScopedDatabase` escape hatches

`packages/platform-sdk/src/database.ts` has two methods that bypass its own tenant-scoping guarantees entirely: `get raw(): ErpDatabase` (lines 16-18, returns the unscoped underlying Drizzle instance) and `async execute(query: SQL): Promise<unknown>` (lines 79-81, runs caller-supplied raw SQL with no tenant filter). **This phase's `capability-guard.ts` must never use either** — `isCapabilityEnabled` only ever calls `PlatformFeatureFlags.isEnabled()`, which itself uses `TenantScopedDatabase`'s properly-scoped query path (confirmed: `fetchFromDb` reads `feature_flags WHERE tenant_id = X OR tenant_id IS NULL`, a query shape that legitimately needs to combine a tenant-scoped and a global row in one call — pre-existing, reviewed, and safe; not something this phase touches or needs to replicate). Flagged here only so a future coding session doesn't reach for `.raw`/`.execute` out of convenience when extending the capability guard later — those two methods exist for legitimate cross-tenant/admin use elsewhere in the codebase, not for capability-checking code.

## 10. `packages/platform-sdk/src/index.ts` — export surface this phase adds to

Currently exports `PlatformFeatureFlags` (from `feature-flags.ts`) and `checkPermission`/`getBranchScope` (from `auth.ts`) among others (`index.ts:29-30` per prior discovery). `requireCapability` and `CAPABILITY_REGISTRY` (or wherever it's re-exported from) are new named exports added to this same barrel file — see `17-file-level-change-plan.md`.
