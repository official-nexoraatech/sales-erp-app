import type { FastifyInstance } from 'fastify';
import type { PlatformContextFactory } from '@erp/sdk';
import { tenantScopedHandler } from '@erp/sdk';
import { PERMISSIONS } from '@erp/types';
import { authenticate } from '../middleware/authenticate.js';
import { requirePermission } from '../middleware/authorize.js';
import { HealthScoringService } from '../domain/HealthScoringService.js';

// CRM/O2C split — moved from sales-service/src/api/crm.routes.ts's M9.2 block. Only
// segmentCounts moved with this route; the compute job that populates customers.healthSegment
// stays in sales-service (see domain/HealthScoringService.ts's header comment).
//
// Phase 9 GUC-per-request rollout — migrated 2026-08-21. No external I/O.
export async function healthScoringRoutes(
  fastify: FastifyInstance,
  ctxFactory: PlatformContextFactory
): Promise<void> {
  fastify.get(
    '/crm/segments/health',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.CRM_VIEW)] },
    tenantScopedHandler(ctxFactory, async (request, reply, ctx) => {
      const counts = await HealthScoringService.segmentCounts(ctx.db.raw, ctx.tenant.tenantId);
      return reply.code(200).send({ data: counts });
    })
  );
}
