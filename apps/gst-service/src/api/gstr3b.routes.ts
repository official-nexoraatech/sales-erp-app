/* global process, fetch */
import type { FastifyInstance } from 'fastify';
import type { PlatformContextFactory } from '@erp/sdk';
import { tenantScopedHandler, withTenantConnection } from '@erp/sdk';
import { z } from 'zod';
import { timingSafeEqual } from 'node:crypto';
import { tenants } from '@erp/db';
import { eq } from 'drizzle-orm';
import { ValidationError } from '@erp/types';
import { PERMISSIONS } from '@erp/types';
import { authenticate } from '../middleware/authenticate.js';
import { requirePermission } from '../middleware/authorize.js';
import { Gstr3bService } from '../domain/Gstr3bService.js';
import { GstReturnTrackerService } from '../domain/GstReturnTrackerService.js';

const ManualAdjustmentsSchema = z.object({
  importOfGoodsIgst: z.number().nonnegative().optional(),
  importOfServicesIgst: z.number().nonnegative().optional(),
});

const PERIOD_REGEX = /^\d{4}-\d{2}$/;

function requireInternalKey(
  req: { headers: Record<string, string | string[] | undefined> },
  reply: { code: (n: number) => { send: (b: unknown) => void } }
): boolean {
  const key = req.headers['x-internal-key'];
  const expected = process.env['INTERNAL_API_KEY'];
  const keyBuffer = Buffer.from(typeof key === 'string' ? key : '');
  const expectedBuffer = Buffer.from(expected ?? '');
  const matches =
    !!expected &&
    keyBuffer.length === expectedBuffer.length &&
    timingSafeEqual(keyBuffer, expectedBuffer);
  if (!matches) {
    reply.code(401).send({ error: 'Unauthorized' });
    return false;
  }
  return true;
}

function previousPeriod(): string {
  const now = new Date();
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

// Phase 9 GUC-per-request rollout — migrated 2026-08-21. GET/export routes have no external
// I/O (neither Gstr3bService nor GstReturnTrackerService has fetch() calls). The reminder
// route's notification fetch() runs strictly after its DB read completes, so only the read
// is wrapped (caveat 4b/5b shape).
export async function gstr3bRoutes(
  fastify: FastifyInstance,
  ctxFactory: PlatformContextFactory
): Promise<void> {
  // GET /gst/gstr3b?period=2025-06
  fastify.get(
    '/gst/gstr3b',
    {
      preHandler: [authenticate, requirePermission(PERMISSIONS.GSTR3B_VIEW)],
    },
    tenantScopedHandler(ctxFactory, async (request, reply, ctx) => {
      const { tenantId } = ctx.tenant;

      const QuerySchema = z.object({
        period: z.string().regex(PERIOD_REGEX, 'Period must be YYYY-MM'),
      });
      const q = QuerySchema.safeParse(request.query);
      if (!q.success) throw new ValidationError(q.error.errors.map((e) => e.message).join('; '));

      const manualAdjustments = await GstReturnTrackerService.getGstr3bManualAdjustments(
        ctx.db,
        tenantId,
        q.data.period
      );
      const result = await Gstr3bService.compute(
        ctx.db,
        tenantId,
        q.data.period,
        manualAdjustments ?? undefined
      );
      return reply.code(200).send({ data: result });
    })
  );

  // POST /gst/gstr3b/export?period=2025-06
  fastify.post(
    '/gst/gstr3b/export',
    {
      preHandler: [authenticate, requirePermission(PERMISSIONS.GSTR3B_FILE)],
    },
    tenantScopedHandler(ctxFactory, async (request, reply, ctx) => {
      const { tenantId, userId } = ctx.tenant;

      const QuerySchema = z.object({
        period: z.string().regex(PERIOD_REGEX, 'Period must be YYYY-MM'),
      });
      const q = QuerySchema.safeParse(request.query);
      if (!q.success) throw new ValidationError(q.error.errors.map((e) => e.message).join('; '));

      const BodySchema = z.object({
        manualAdjustments: ManualAdjustmentsSchema.optional(),
      });
      const body = BodySchema.safeParse(request.body ?? {});
      if (!body.success)
        throw new ValidationError(body.error.errors.map((e) => e.message).join('; '));

      if (body.data.manualAdjustments) {
        await GstReturnTrackerService.saveGstr3bManualAdjustments(
          ctx.db,
          tenantId,
          userId,
          q.data.period,
          body.data.manualAdjustments
        );
      }

      const manualAdjustments =
        body.data.manualAdjustments ??
        (await GstReturnTrackerService.getGstr3bManualAdjustments(
          ctx.db,
          tenantId,
          q.data.period
        )) ??
        undefined;
      const result = await Gstr3bService.compute(
        ctx.db,
        tenantId,
        q.data.period,
        manualAdjustments
      );

      await ctx.audit.log({
        action: 'GSTR3B_EXPORTED',
        entityType: 'GSTR3B',
        entityId: tenantId,
        after: {
          period: q.data.period,
          manualAdjustmentsApplied: !!body.data.manualAdjustments,
          manualAdjustments: body.data.manualAdjustments ?? null,
        } as Record<string, unknown>,
      });

      return reply.code(200).send({
        data: {
          ...result,
          exportedAt: new Date().toISOString(),
        },
      });
    })
  );

  // POST /gst/gstr3b/reminder?tenantId=... — PG-026, scheduler-triggered
  // No filed/status flag exists in Gstr3bService's output or schema, so this is an
  // unconditional monthly reminder (same shape as platform.dr-drill-reminder).
  fastify.post('/gst/gstr3b/reminder', {
    handler: async (request, reply) => {
      if (!requireInternalKey(request as never, reply as never)) return;
      const tenantId = parseInt((request.query as { tenantId?: string }).tenantId ?? '', 10);
      if (!tenantId)
        return reply
          .code(400)
          .send({ error: { code: 'MISSING_TENANT_ID', message: 'tenantId query param required' } });

      const contactEmail = await withTenantConnection(ctxFactory.rawDb, tenantId, async (db) => {
        const [tenant] = await db
          .select({ contactEmail: tenants.contactEmail })
          .from(tenants)
          .where(eq(tenants.id, tenantId));
        return tenant?.contactEmail ?? null;
      });

      let sent = false;
      const period = previousPeriod();
      if (contactEmail) {
        const notificationUrl = process.env['NOTIFICATION_SERVICE_URL'] ?? 'http://localhost:3014';
        const apiKey = process.env['INTERNAL_API_KEY'] ?? '';
        try {
          await fetch(`${notificationUrl}/notifications/send-raw-internal`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-internal-key': apiKey },
            body: JSON.stringify({
              tenantId,
              eventType: 'GSTR3B_FILING_REMINDER',
              channel: 'EMAIL',
              recipientEmail: contactEmail,
              subject: `GSTR-3B filing due for ${period}`,
              body: `GSTR-3B for period ${period} is due to be filed by the 20th. Prepare and file it from GST > GSTR-3B.`,
            }),
          });
          sent = true;
        } catch {
          // best-effort
        }
      }

      return reply.code(200).send({ data: { period, sent } });
    },
  });
}
