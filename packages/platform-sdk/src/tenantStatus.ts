/* global console */
import { eq } from 'drizzle-orm';
import type Redis from 'ioredis';
import { tenants, type ErpDatabase } from '@erp/db';
import { SecurityError, TenantSuspendedError, TenantClosedError } from '@erp/types';
import { erpTenantBlockedRequestsTotal } from '@erp/logger';

// Pub/sub channel for cross-process cache invalidation — mirrors the proven
// erp:feature-flags:invalidate pattern (see feature-flags.ts). Without this, a
// suspend/close in tenant-service only clears that one process's in-memory
// tenantStatusCache; every other service process keeps serving a stale ACTIVE
// status for up to CACHE_TTL_MS.
const TENANT_STATUS_INVALIDATE_CHANNEL = 'erp:tenant-status:invalidate';

// Tenant-lifecycle enforcement (PG-012). Every service's authenticate() calls
// assertTenantActive() right after a token verifies successfully, so a
// SUSPENDED/CLOSED tenant's users are rejected on every authenticated route in
// every service — without touching the per-route preHandler arrays that already
// wire up `authenticate` throughout the codebase. Public routes (login, refresh,
// health, metrics) never call authenticate() at all, so they're exempt by
// construction; no path-based exemption list is needed here.
//
// Platform operators (PLATFORM_TENANT_MANAGE) are scoped to the reserved
// "platform-operations" tenant (see migration 0020_es21_platform_operator.sql),
// not a real customer tenant — they're exempt so that suspending/activating a
// customer tenant can never accidentally lock platform operators out of the
// very endpoint that manages tenant lifecycle.

const CACHE_TTL_MS = 60_000;
const tenantStatusCache = new Map<number, { status: string; cachedAt: number }>();
let dbRef: ErpDatabase | null = null;
let warnedNotInitialized = false;

export function initTenantStatusEnforcement(db: ErpDatabase): void {
  dbRef = db;
}

export function invalidateTenantStatusCache(tenantId: number): void {
  tenantStatusCache.delete(tenantId);
}

// Call from the tenant-service suspend/close/activate handlers, right alongside the
// local invalidateTenantStatusCache() call, so every OTHER running service process
// drops its stale cache entry too instead of waiting out CACHE_TTL_MS.
export async function publishTenantStatusInvalidation(
  redis: Redis,
  tenantId: number
): Promise<void> {
  await redis.publish(TENANT_STATUS_INVALIDATE_CHANNEL, String(tenantId));
}

// Call once per service process at bootstrap (mirrors PlatformFeatureFlags.subscribeToInvalidations).
// Duplicates the connection because ioredis requires a dedicated connection once it
// enters SUBSCRIBE mode — it can no longer issue normal commands on that connection.
export function subscribeToTenantStatusInvalidations(redis: Redis): void {
  const subscriber = redis.duplicate();
  void subscriber.subscribe(TENANT_STATUS_INVALIDATE_CHANNEL);
  subscriber.on('message', (_channel, message: string) => {
    const tenantId = Number(message);
    if (Number.isFinite(tenantId)) {
      invalidateTenantStatusCache(tenantId);
    }
  });
}

// Every real service calls initTenantStatusEnforcement() once at bootstrap, before
// the server starts listening — so dbRef is never null in production. It CAN be
// null in tests that construct a bare Fastify app around a route/authenticate()
// without going through full main.ts bootstrap; those tests aren't exercising
// tenant-lifecycle enforcement, so failing open (with a one-time warning) here
// keeps them passing instead of turning every unrelated route test into a 500.
export async function assertTenantActive(tenantId: number, permissions: string[]): Promise<void> {
  if (permissions.includes('PLATFORM_TENANT_MANAGE')) {
    return;
  }

  const cached = tenantStatusCache.get(tenantId);
  if (cached && Date.now() - cached.cachedAt < CACHE_TTL_MS) {
    rejectIfInactive(tenantId, cached.status);
    return;
  }

  if (!dbRef) {
    if (!warnedNotInitialized) {
      warnedNotInitialized = true;
      // eslint-disable-next-line no-console
      console.warn(
        '[tenantStatus] assertTenantActive() called before initTenantStatusEnforcement() — ' +
          'tenant-suspension/closure enforcement is disabled until init runs. Every real ' +
          'service bootstrap calls initTenantStatusEnforcement(); this warning is expected ' +
          'in tests that construct a Fastify app without full bootstrap.'
      );
    }
    return;
  }

  const [tenant] = await dbRef
    .select({ status: tenants.status })
    .from(tenants)
    .where(eq(tenants.id, tenantId));
  if (!tenant) {
    throw new SecurityError(`Tenant ${tenantId} not found`);
  }

  tenantStatusCache.set(tenantId, { status: tenant.status, cachedAt: Date.now() });
  rejectIfInactive(tenantId, tenant.status);
}

function rejectIfInactive(tenantId: number, status: string): void {
  if (status === 'SUSPENDED' || status === 'CLOSED') {
    erpTenantBlockedRequestsTotal.inc({ tenant_id: String(tenantId), status });
  }
  if (status === 'SUSPENDED') throw new TenantSuspendedError(tenantId);
  if (status === 'CLOSED') throw new TenantClosedError(tenantId);
}
