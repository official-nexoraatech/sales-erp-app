import type { FastifyRequest, FastifyReply, FastifyPluginCallback } from 'fastify';
import type { ErpDatabase } from '@erp/db';
import { tenants } from '@erp/db';
import { eq } from 'drizzle-orm';
import { TenantSuspendedError, SecurityError } from '@erp/types';

declare module 'fastify' {
  interface FastifyRequest {
    tenantId: number;
    tenantStatus: string;
  }
}

// Cached tenant status — keyed by tenantId, value is { status, cachedAt }
const tenantStatusCache = new Map<number, { status: string; cachedAt: number }>();
const CACHE_TTL_MS = 60_000; // 60 seconds

export function createTenantContextMiddleware(
  db: ErpDatabase
): FastifyPluginCallback {
  return (fastify, _opts, done) => {
    fastify.addHook('preHandler', async (request: FastifyRequest, reply: FastifyReply) => {
      // Skip tenant check for health endpoint and admin provisioning endpoints
      if (
        request.url === '/health' ||
        request.url === '/metrics' ||
        request.url.startsWith('/admin/tenants')
      ) {
        return;
      }

      // Extract tenantId from JWT payload (auth middleware must run first)
      const auth = (request as FastifyRequest & { auth?: { tenantId: number; permissions: string[] } }).auth;
      if (!auth?.tenantId) {
        throw new SecurityError('Missing tenant context — authenticate first');
      }

      const tenantId = auth.tenantId;

      // Check cache first
      const cached = tenantStatusCache.get(tenantId);
      if (cached && Date.now() - cached.cachedAt < CACHE_TTL_MS) {
        if (cached.status === 'SUSPENDED') {
          throw new TenantSuspendedError(tenantId);
        }
        if (cached.status === 'CLOSED') {
          await reply.code(410).send({ error: { code: 'TENANT_CLOSED', message: 'This account is closed' } });
          return;
        }
        request.tenantId = tenantId;
        request.tenantStatus = cached.status;
        return;
      }

      // Cache miss — query DB
      const [tenant] = await db.select({ id: tenants.id, status: tenants.status }).from(tenants).where(eq(tenants.id, tenantId));

      if (!tenant) {
        throw new SecurityError(`Tenant ${tenantId} not found`);
      }

      // Warm the cache
      tenantStatusCache.set(tenantId, { status: tenant.status, cachedAt: Date.now() });

      if (tenant.status === 'SUSPENDED') {
        throw new TenantSuspendedError(tenantId);
      }
      if (tenant.status === 'CLOSED') {
        await reply.code(410).send({ error: { code: 'TENANT_CLOSED', message: 'This account is closed' } });
        return;
      }

      request.tenantId = tenantId;
      request.tenantStatus = tenant.status;
    });

    done();
  };
}

// Exported for other services to use
export function invalidateTenantStatusCache(tenantId: number): void {
  tenantStatusCache.delete(tenantId);
}
