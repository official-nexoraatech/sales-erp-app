import type { FastifyInstance } from 'fastify';
import type { PlatformContextFactory } from '@erp/sdk';
import { tenantScopedHandler } from '@erp/sdk';
import { z } from 'zod';
import { ValidationError } from '@erp/types';
import { PERMISSIONS } from '@erp/types';
import { authenticate } from '../middleware/authenticate.js';
import { requirePermission } from '../middleware/authorize.js';
import { GSTR9Engine } from '../domain/GSTR9Engine.js';

const FY_REGEX = /^\d{4}-\d{2}$/;

// Phase 9 GUC-per-request rollout — migrated 2026-08-21. No external I/O — GSTR9Engine has no
// fetch() calls.
export async function gstr9Routes(
  fastify: FastifyInstance,
  ctxFactory: PlatformContextFactory
): Promise<void> {
  // GET /gst/gstr9?year=2025-26
  fastify.get(
    '/gst/gstr9',
    {
      preHandler: [authenticate, requirePermission(PERMISSIONS.GSTR9_VIEW)],
    },
    tenantScopedHandler(ctxFactory, async (request, reply, ctx) => {
      const { tenantId } = ctx.tenant;

      const QuerySchema = z.object({
        year: z.string().regex(FY_REGEX, 'Financial year must be YYYY-YY, e.g. 2025-26'),
      });
      const q = QuerySchema.safeParse(request.query);
      if (!q.success) throw new ValidationError(q.error.errors.map((e) => e.message).join('; '));

      const result = await GSTR9Engine.generateGSTR9(ctx.db, tenantId, q.data.year);
      return reply.code(200).send({ data: result });
    })
  );

  // GET /gst/gstr9/export?year=2025-26&format=json
  fastify.get(
    '/gst/gstr9/export',
    {
      preHandler: [authenticate, requirePermission(PERMISSIONS.GSTR9_FILE)],
    },
    tenantScopedHandler(ctxFactory, async (request, reply, ctx) => {
      const { tenantId } = ctx.tenant;

      const QuerySchema = z.object({
        year: z.string().regex(FY_REGEX, 'Financial year must be YYYY-YY, e.g. 2025-26'),
        format: z.enum(['json']).default('json'),
      });
      const q = QuerySchema.safeParse(request.query);
      if (!q.success) throw new ValidationError(q.error.errors.map((e) => e.message).join('; '));

      const result = await GSTR9Engine.generateGSTR9(ctx.db, tenantId, q.data.year);

      await ctx.audit.log({
        action: 'GSTR9_EXPORTED',
        entityType: 'GSTR9',
        entityId: tenantId,
        after: { financialYear: q.data.year } as Record<string, unknown>,
      });

      return reply.code(200).send({
        data: {
          ...result,
          exportedAt: new Date().toISOString(),
        },
      });
    })
  );
}
