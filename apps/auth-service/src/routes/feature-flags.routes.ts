import type { FastifyInstance } from 'fastify';
import type Redis from 'ioredis';
import { z } from 'zod';
import { eq, and, isNull, or } from 'drizzle-orm';
import { featureFlags } from '@erp/db';
import type { ErpDatabase } from '@erp/db';
import { PERMISSIONS } from '@erp/types';
import { TenantScopedDatabase, TenantScopedCache, PlatformFeatureFlags } from '@erp/sdk';
import { requirePermission } from '../middleware/authorize.js';

const UpdateFlagSchema = z.object({
  enabled: z.boolean(),
  config: z.record(z.unknown()).optional(),
});

export async function featureFlagsRoutes(fastify: FastifyInstance, db: ErpDatabase, redis: Redis): Promise<void> {
  // ── GET /admin/feature-flags — list all flags for tenant (global default + tenant override) ──
  fastify.get('/admin/feature-flags', {
    preHandler: [requirePermission(PERMISSIONS.FEATURE_FLAG_VIEW)],
    handler: async (request, reply) => {
      const { tenantId } = request.auth;
      const rows = await db
        .select()
        .from(featureFlags)
        .where(or(isNull(featureFlags.tenantId), eq(featureFlags.tenantId, tenantId)));

      const merged = new Map<string, { flagKey: string; enabled: boolean; config: unknown; isOverride: boolean }>();
      for (const row of rows) {
        if (row.tenantId === null) {
          merged.set(row.flagKey, { flagKey: row.flagKey, enabled: row.enabled, config: row.config, isOverride: false });
        }
      }
      for (const row of rows) {
        if (row.tenantId === tenantId) {
          merged.set(row.flagKey, { flagKey: row.flagKey, enabled: row.enabled, config: row.config, isOverride: true });
        }
      }

      return reply.code(200).send({ data: Array.from(merged.values()) });
    },
  });

  // ── PUT /admin/feature-flags/:name — set a tenant-specific override, invalidate cache ──
  fastify.put<{ Params: { name: string } }>('/admin/feature-flags/:name', {
    preHandler: [requirePermission(PERMISSIONS.FEATURE_FLAG_UPDATE)],
    handler: async (request, reply) => {
      const body = UpdateFlagSchema.safeParse(request.body);
      if (!body.success) return reply.code(400).send({ error: 'Invalid body' });

      const { tenantId } = request.auth;
      const flagKey = request.params.name;

      const [existing] = await db
        .select()
        .from(featureFlags)
        .where(and(eq(featureFlags.tenantId, tenantId), eq(featureFlags.flagKey, flagKey)));

      if (existing) {
        await db
          .update(featureFlags)
          .set({ enabled: body.data.enabled, config: body.data.config ?? existing.config, updatedAt: new Date() })
          .where(eq(featureFlags.id, existing.id));
      } else {
        await db.insert(featureFlags).values({
          tenantId,
          flagKey,
          enabled: body.data.enabled,
          config: body.data.config ?? null,
        });
      }

      const tsDb = new TenantScopedDatabase(tenantId, db);
      const tsCache = new TenantScopedCache(redis, tenantId);
      const flags = new PlatformFeatureFlags(tsDb, tsCache, tenantId);
      await flags.invalidate(flagKey);

      return reply.code(200).send({ data: { flagKey, enabled: body.data.enabled } });
    },
  });
}
