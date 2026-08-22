import type { FastifyInstance } from 'fastify';
import type { PlatformContextFactory } from '@erp/sdk';
import { tenantScopedHandler } from '@erp/sdk';
import { z } from 'zod';
import { PERMISSIONS, ValidationError } from '@erp/types';
import { authenticate } from '../middleware/authenticate.js';
import { requirePermission } from '../middleware/authorize.js';
import { JourneyService, type JourneyStepInput } from '../domain/JourneyService.js';

// CRM-ROADMAP Phase 2, Feature 2 — a BRANCH step's two outcomes are themselves short nested
// step lists (see JourneyService.ts's own doc comment), so this schema has to be recursive.
const JourneyStepSchema: z.ZodType<JourneyStepInput> = z.lazy(() =>
  z.object({
    stepType: z.enum(['DELAY', 'ACTION', 'BRANCH']),
    delayDays: z.number().int().min(1).optional(),
    channel: z.enum(['SMS', 'WHATSAPP', 'EMAIL', 'IN_APP']).optional(),
    messageTemplate: z.string().min(1).max(2000).optional(),
    branchConditionType: z.enum(['MADE_PURCHASE']).optional(),
    branchWithinDays: z.number().int().min(1).optional(),
    truePath: z.array(JourneyStepSchema).optional(),
    falsePath: z.array(JourneyStepSchema).optional(),
  })
);

const JourneyCreateSchema = z.object({
  name: z.string().min(2).max(200),
  segmentId: z.number().int().optional(),
  steps: z.array(JourneyStepSchema).min(1),
});

const EnrollSchema = z.object({
  customerId: z.number().int(),
});

// Phase 9 GUC-per-request rollout — migrated 2026-08-21. No external I/O — JourneyService has no
// fetch() calls (the actual send-action step runs from a scheduler job elsewhere). Post-hoc
// ctx.audit.log()/ctx.events.publish() calls are safe per caveat 4b.
export async function journeyRoutes(
  fastify: FastifyInstance,
  ctxFactory: PlatformContextFactory
): Promise<void> {
  fastify.get(
    '/journeys',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.JOURNEY_VIEW)] },
    tenantScopedHandler(ctxFactory, async (request, reply, ctx) => {
      const rows = await JourneyService.listJourneys(ctx.db.raw, ctx.tenant.tenantId);
      return reply.send({ data: { content: rows, totalElements: rows.length } });
    })
  );

  fastify.post(
    '/journeys',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.JOURNEY_CREATE)] },
    tenantScopedHandler(ctxFactory, async (request, reply, ctx) => {
      const body = JourneyCreateSchema.safeParse(request.body);
      if (!body.success)
        throw new ValidationError(body.error.errors.map((e) => e.message).join('; '));

      const journey = await JourneyService.create(
        ctx.db.raw,
        ctx.tenant.tenantId,
        ctx.tenant.userId,
        body.data
      );
      await ctx.audit.log({
        action: 'CREATE',
        entityType: 'crm_journey',
        entityId: journey.id,
        after: journey as unknown as Record<string, unknown>,
      });
      return reply.code(201).send({ data: journey });
    })
  );

  fastify.get(
    '/journeys/:id',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.JOURNEY_VIEW)] },
    tenantScopedHandler(ctxFactory, async (request, reply, ctx) => {
      const { id: idParam } = request.params as { id: string };
      const journeyId = parseInt(idParam, 10);
      const journey = await JourneyService.getJourney(ctx.db.raw, ctx.tenant.tenantId, journeyId);
      const steps = await JourneyService.getStepsTree(ctx.db.raw, ctx.tenant.tenantId, journeyId);
      const funnel = await JourneyService.getFunnelStats(
        ctx.db.raw,
        ctx.tenant.tenantId,
        journeyId
      );
      return reply.send({ data: { ...journey, steps, funnel } });
    })
  );

  // Preview-affected-count safeguard — must be checkable before publish, not just after
  // (roadmap's own explicit rollback/risk requirement for this feature).
  fastify.get(
    '/journeys/:id/affected-count',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.JOURNEY_VIEW)] },
    tenantScopedHandler(ctxFactory, async (request, reply, ctx) => {
      const { id: idParam } = request.params as { id: string };
      const journeyId = parseInt(idParam, 10);
      const journey = await JourneyService.getJourney(ctx.db.raw, ctx.tenant.tenantId, journeyId);
      if (!journey.segmentId) return reply.send({ data: { count: null } });
      const count = await JourneyService.previewAffectedCount(
        ctx.db.raw,
        ctx.tenant.tenantId,
        journey.segmentId
      );
      return reply.send({ data: { count } });
    })
  );

  fastify.post(
    '/journeys/:id/publish',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.JOURNEY_PUBLISH)] },
    tenantScopedHandler(ctxFactory, async (request, reply, ctx) => {
      const { id: idParam } = request.params as { id: string };
      const journeyId = parseInt(idParam, 10);
      const updated = await JourneyService.publish(ctx.db.raw, ctx.tenant.tenantId, journeyId);
      await ctx.audit.log({
        action: 'UPDATE',
        entityType: 'crm_journey',
        entityId: journeyId,
        after: updated as unknown as Record<string, unknown>,
      });
      await ctx.events.publish(
        'crm_journey',
        journeyId,
        'JOURNEY_PUBLISHED',
        updated as unknown as Record<string, unknown>
      );
      return reply.send({ data: updated });
    })
  );

  fastify.delete(
    '/journeys/:id',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.JOURNEY_DELETE)] },
    tenantScopedHandler(ctxFactory, async (request, reply, ctx) => {
      const { id: idParam } = request.params as { id: string };
      const journeyId = parseInt(idParam, 10);
      await JourneyService.archive(ctx.db.raw, ctx.tenant.tenantId, journeyId);
      await ctx.audit.log({ action: 'DELETE', entityType: 'crm_journey', entityId: journeyId });
      return reply.code(204).send();
    })
  );

  fastify.get(
    '/journeys/:id/enrollments',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.JOURNEY_VIEW)] },
    tenantScopedHandler(ctxFactory, async (request, reply, ctx) => {
      const { id: idParam } = request.params as { id: string };
      const journeyId = parseInt(idParam, 10);
      const rows = await JourneyService.listEnrollments(ctx.db.raw, ctx.tenant.tenantId, journeyId);
      return reply.send({ data: { content: rows, totalElements: rows.length } });
    })
  );

  // Manual, single-customer enrollment — the segment-driven path (evaluateDueEnrollments'
  // enrollNewMatches) covers bulk auto-enrollment; this covers a rep adding one specific
  // customer regardless of segment membership.
  fastify.post(
    '/journeys/:id/enrollments',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.JOURNEY_CREATE)] },
    tenantScopedHandler(ctxFactory, async (request, reply, ctx) => {
      const { id: idParam } = request.params as { id: string };
      const journeyId = parseInt(idParam, 10);
      const body = EnrollSchema.safeParse(request.body);
      if (!body.success)
        throw new ValidationError(body.error.errors.map((e) => e.message).join('; '));

      const enrollment = await JourneyService.enrollCustomer(
        ctx.db.raw,
        ctx.tenant.tenantId,
        journeyId,
        body.data.customerId
      );
      await ctx.events.publish(
        'crm_journey_enrollment',
        enrollment.id,
        'JOURNEY_STEP_ENTERED',
        enrollment as unknown as Record<string, unknown>
      );
      return reply.code(201).send({ data: enrollment });
    })
  );
}
