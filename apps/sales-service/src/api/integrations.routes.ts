// Outbound webhook subscription management — generalized from the CP-8 campaign-only
// subsystem (see apps/sales-service/src/domain/WebhookService.ts) to cover any business
// event a tenant wants to subscribe an external system to.
import type { FastifyInstance } from 'fastify';
import type { PlatformContextFactory } from '@erp/sdk';
import { tenantScopedHandler } from '@erp/sdk';
import { randomBytes } from 'node:crypto';
import { webhookSubscriptions } from '@erp/db';
import { and, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { NotFoundError, ValidationError, PERMISSIONS } from '@erp/types';
import { authenticate } from '../middleware/authenticate.js';
import { requirePermission } from '../middleware/authorize.js';

const WEBHOOK_EVENT_TYPES = [
  'CAMPAIGN_SENT',
  'CAMPAIGN_CANCELLED',
  'INVOICE_CREATED',
  'INVOICE_CONFIRMED',
  'PAYMENT_RECEIVED',
] as const;

const WebhookSubscriptionSchema = z.object({
  targetUrl: z.string().url(),
  events: z.array(z.enum(WEBHOOK_EVENT_TYPES)).min(1),
  isActive: z.boolean().default(true),
});

// Phase 9 GUC-per-request rollout — migrated 2026-08-21. This file only manages webhook
// *subscriptions* (CRUD on webhookSubscriptions) — no external I/O of its own; the actual
// outbound webhook dispatch (fetch() to the subscriber's targetUrl) lives elsewhere
// (WebhookDispatchService), not in this route file. Post-hoc ctx.audit.log() calls are safe per
// caveat 4b.
export async function integrationsRoutes(
  fastify: FastifyInstance,
  ctxFactory: PlatformContextFactory
): Promise<void> {
  const WEBHOOK_MANAGE: [typeof authenticate, ReturnType<typeof requirePermission>] = [
    authenticate,
    requirePermission(PERMISSIONS.INTEGRATION_WEBHOOK_MANAGE),
  ];

  fastify.get(
    '/integrations/webhook-subscriptions',
    { preHandler: WEBHOOK_MANAGE },
    tenantScopedHandler(ctxFactory, async (request, reply, ctx) => {
      const rows = await ctx.db.raw
        .select({
          id: webhookSubscriptions.id,
          targetUrl: webhookSubscriptions.targetUrl,
          events: webhookSubscriptions.events,
          isActive: webhookSubscriptions.isActive,
          createdAt: webhookSubscriptions.createdAt,
          // secret is deliberately never returned after creation — same principle as an API key,
          // shown once at creation time only.
        })
        .from(webhookSubscriptions)
        .where(eq(webhookSubscriptions.tenantId, ctx.tenant.tenantId))
        .orderBy(sql`created_at DESC`);
      return reply.code(200).send({ data: { content: rows, totalElements: rows.length } });
    })
  );

  fastify.post(
    '/integrations/webhook-subscriptions',
    { preHandler: WEBHOOK_MANAGE },
    tenantScopedHandler(ctxFactory, async (request, reply, ctx) => {
      const body = WebhookSubscriptionSchema.safeParse(request.body);
      if (!body.success)
        throw new ValidationError(body.error.errors.map((e) => e.message).join('; '));

      const secret = randomBytes(32).toString('hex');
      const [created] = await ctx.db.raw
        .insert(webhookSubscriptions)
        .values({
          tenantId: ctx.tenant.tenantId,
          targetUrl: body.data.targetUrl,
          events: body.data.events,
          isActive: body.data.isActive,
          secret,
          createdBy: ctx.tenant.userId,
        })
        .returning();
      if (!created) throw new Error('Webhook subscription creation failed unexpectedly');

      await ctx.audit.log({
        action: 'CREATE',
        entityType: 'webhook_subscription',
        entityId: created.id,
      });

      // The secret is only ever returned in this create response — the caller must store it now.
      return reply.code(201).send({ data: created });
    })
  );

  fastify.put(
    '/integrations/webhook-subscriptions/:id',
    { preHandler: WEBHOOK_MANAGE },
    tenantScopedHandler(ctxFactory, async (request, reply, ctx) => {
      const { id: idParam } = request.params as { id: string };
      const id = parseInt(idParam, 10);

      const body = WebhookSubscriptionSchema.partial().safeParse(request.body);
      if (!body.success)
        throw new ValidationError(body.error.errors.map((e) => e.message).join('; '));

      const [existing] = await ctx.db.raw
        .select({ id: webhookSubscriptions.id })
        .from(webhookSubscriptions)
        .where(
          and(
            eq(webhookSubscriptions.id, id),
            eq(webhookSubscriptions.tenantId, ctx.tenant.tenantId)
          )
        );
      if (!existing) throw new NotFoundError('Webhook subscription', id);

      const [updated] = await ctx.db.raw
        .update(webhookSubscriptions)
        .set({ ...body.data, updatedAt: new Date() })
        .where(eq(webhookSubscriptions.id, id))
        .returning();
      if (!updated) throw new Error('Webhook subscription update failed unexpectedly');

      await ctx.audit.log({
        action: 'UPDATE',
        entityType: 'webhook_subscription',
        entityId: id,
      });
      return reply.code(200).send({ data: updated });
    })
  );

  fastify.delete(
    '/integrations/webhook-subscriptions/:id',
    { preHandler: WEBHOOK_MANAGE },
    tenantScopedHandler(ctxFactory, async (request, reply, ctx) => {
      const { id: idParam } = request.params as { id: string };
      const id = parseInt(idParam, 10);

      const [existing] = await ctx.db.raw
        .select({ id: webhookSubscriptions.id })
        .from(webhookSubscriptions)
        .where(
          and(
            eq(webhookSubscriptions.id, id),
            eq(webhookSubscriptions.tenantId, ctx.tenant.tenantId)
          )
        );
      if (!existing) throw new NotFoundError('Webhook subscription', id);

      await ctx.db.raw.delete(webhookSubscriptions).where(eq(webhookSubscriptions.id, id));

      await ctx.audit.log({
        action: 'DELETE',
        entityType: 'webhook_subscription',
        entityId: id,
      });
      return reply.code(204).send();
    })
  );
}
