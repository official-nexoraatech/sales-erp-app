import type { FastifyInstance } from 'fastify';
import type { PlatformContextFactory } from '@erp/sdk';
import { tenantScopedHandler } from '@erp/sdk';
import { z } from 'zod';
import { ValidationError } from '@erp/types';
import { PERMISSIONS } from '@erp/types';
import { authenticate } from '../middleware/authenticate.js';
import { requirePermission } from '../middleware/authorize.js';
import { GstLedgerService } from '../domain/GstLedgerService.js';

const PERIOD_REGEX = /^\d{4}-\d{2}$/;

// Phase 9 GUC-per-request rollout — migrated 2026-08-21. No external I/O —
// GstLedgerService has no fetch() calls.
export async function rcmRoutes(
  fastify: FastifyInstance,
  ctxFactory: PlatformContextFactory
): Promise<void> {
  // GET /gst/rcm-register?period=2025-06 — all RCM (reverse-charge) transactions for a period
  fastify.get(
    '/gst/rcm-register',
    {
      preHandler: [authenticate, requirePermission(PERMISSIONS.GST_VIEW)],
    },
    tenantScopedHandler(ctxFactory, async (request, reply, ctx) => {
      const { tenantId } = ctx.tenant;

      const QuerySchema = z.object({
        period: z.string().regex(PERIOD_REGEX, 'Period must be YYYY-MM'),
      });
      const q = QuerySchema.safeParse(request.query);
      if (!q.success) throw new ValidationError(q.error.errors.map((e) => e.message).join('; '));

      const entries = await GstLedgerService.getRcmRegister(ctx.db, tenantId, q.data.period);
      return reply
        .code(200)
        .send({ data: { content: entries, totalElements: entries.length, period: q.data.period } });
    })
  );
}
