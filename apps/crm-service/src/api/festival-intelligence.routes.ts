import type { FastifyInstance } from 'fastify';
import type { PlatformContextFactory } from '@erp/sdk';
import { tenantScopedHandler } from '@erp/sdk';
import { z } from 'zod';
import { PERMISSIONS, ValidationError } from '@erp/types';
import { authenticate } from '../middleware/authenticate.js';
import { requirePermission } from '../middleware/authorize.js';
import { FestivalIntelligenceService } from '../domain/FestivalIntelligenceService.js';

// CRM/O2C split — moved verbatim from sales-service/src/api/crm.routes.ts's Festival
// Intelligence AI (suggestion review) block. The businessSeasons table this touches (via
// approve()) is also directly managed by a separate CRUD staying in sales-service's
// crm.routes.ts — same shared-table pattern already used for customers/branches, not a blocker.
//
// Phase 9 GUC-per-request rollout — migrated 2026-08-21. No external I/O. Post-hoc
// ctx.audit.log() calls are safe per caveat 4b.
export async function festivalIntelligenceRoutes(
  fastify: FastifyInstance,
  ctxFactory: PlatformContextFactory
): Promise<void> {
  fastify.get(
    '/crm/festival-suggestions',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.CRM_SEASON_VIEW)] },
    tenantScopedHandler(ctxFactory, async (request, reply, ctx) => {
      const query = request.query as {
        status?: 'PENDING' | 'APPROVED' | 'REJECTED' | 'INSUFFICIENT_DATA';
      };
      const rows = await FestivalIntelligenceService.list(ctx.db.raw, ctx.tenant.tenantId, {
        status: query.status,
      });
      return reply.code(200).send({ data: { content: rows, totalElements: rows.length } });
    })
  );

  const ApproveSuggestionSchema = z.object({
    name: z.string().min(2).max(200),
    startDate: z.string().optional(),
    endDate: z.string().optional(),
    stockMultiplier: z.number().positive().optional(),
    loyaltyMultiplier: z.number().positive().optional(),
  });

  fastify.post(
    '/crm/festival-suggestions/:id/approve',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.CRM_SEASON_MANAGE)] },
    tenantScopedHandler(ctxFactory, async (request, reply, ctx) => {
      const { id: idParam } = request.params as { id: string };
      const id = parseInt(idParam, 10);

      const body = ApproveSuggestionSchema.safeParse(request.body);
      if (!body.success)
        throw new ValidationError(body.error.errors.map((e) => e.message).join('; '));

      const result = await FestivalIntelligenceService.approve(
        ctx.db.raw,
        ctx.tenant.tenantId,
        ctx.tenant.userId,
        id,
        {
          name: body.data.name,
          startDate: body.data.startDate ? new Date(body.data.startDate) : undefined,
          endDate: body.data.endDate ? new Date(body.data.endDate) : undefined,
          stockMultiplier: body.data.stockMultiplier,
          loyaltyMultiplier: body.data.loyaltyMultiplier,
        }
      );

      await ctx.audit.log({
        action: 'UPDATE',
        entityType: 'crm_festival_suggestion',
        entityId: id,
        after: { status: 'APPROVED', createdSeasonId: result.seasonId } as unknown as Record<
          string,
          unknown
        >,
      });
      return reply.code(200).send({ data: result });
    })
  );

  fastify.post(
    '/crm/festival-suggestions/:id/reject',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.CRM_SEASON_MANAGE)] },
    tenantScopedHandler(ctxFactory, async (request, reply, ctx) => {
      const { id: idParam } = request.params as { id: string };
      const id = parseInt(idParam, 10);

      const updated = await FestivalIntelligenceService.reject(
        ctx.db.raw,
        ctx.tenant.tenantId,
        ctx.tenant.userId,
        id
      );

      await ctx.audit.log({
        action: 'UPDATE',
        entityType: 'crm_festival_suggestion',
        entityId: id,
        after: { status: 'REJECTED' } as unknown as Record<string, unknown>,
      });
      return reply.code(200).send({ data: updated });
    })
  );
}
