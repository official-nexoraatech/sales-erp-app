import type { FastifyInstance } from 'fastify';
import type { PlatformContextFactory } from '@erp/sdk';
import { tourProgress, tourEvents } from '@erp/db';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { authenticate } from '../middleware/authenticate.js';

const ProgressUpsertSchema = z.object({
  tourVersion: z.number().int().min(1),
  status: z.enum(['in_progress', 'completed', 'skipped']),
  currentStepId: z.string().min(1).max(100).optional(),
});

const EventSchema = z.object({
  tourId: z.string().min(1).max(100),
  tourVersion: z.number().int().min(1),
  stepId: z.string().min(1).max(100).optional(),
  eventType: z.enum([
    'tour_started',
    'step_viewed',
    'step_completed',
    'tour_completed',
    'tour_skipped',
    'tour_abandoned',
  ]),
  metadata: z.record(z.unknown()).optional(),
});

// Digital Adoption Platform (DAP-1): per-user tour progress + interaction analytics.
// See ERP-PLANNING/DAP-Planning/01_ARCHITECTURE.md §5-6 and ADR-3. No dedicated PERMISSIONS.*
// gate — every authenticated user tracks only their own progress/events (never another
// user's, enforced by always deriving tenantId/userId from the verified token, never from
// the request body), the same way any user can open the Help panel without a permission
// check. The admin-facing aggregate summary endpoint is DAP-2 (ADR-7), not this file.
export async function dapRoutes(
  fastify: FastifyInstance,
  ctxFactory: PlatformContextFactory
): Promise<void> {
  fastify.addHook('preHandler', authenticate);

  // GET /dap/progress — every tour this user has started/completed/skipped, for resume-on-load.
  fastify.get('/dap/progress', async (request, reply) => {
    const ctx = ctxFactory.create({
      tenantId: request.auth.tenantId,
      userId: request.auth.userId,
      correlationId: (request.headers['x-correlation-id'] as string) ?? 'system',
    });
    const db = ctx.db.raw;

    const rows = await db
      .select()
      .from(tourProgress)
      .where(
        and(
          eq(tourProgress.tenantId, request.auth.tenantId),
          eq(tourProgress.userId, request.auth.userId ?? 0)
        )
      );

    return reply.code(200).send({ data: rows });
  });

  // PUT /dap/progress/:tourId — upsert this user's progress on one tour.
  fastify.put<{ Params: { tourId: string } }>('/dap/progress/:tourId', async (request, reply) => {
    const parsed = ProgressUpsertSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid progress payload',
          details: parsed.error.flatten(),
        },
      });
    }

    const { tourId } = request.params;
    const { tourVersion, status, currentStepId } = parsed.data;
    const tenantId = request.auth.tenantId;
    const userId = request.auth.userId ?? 0;
    const ctx = ctxFactory.create({
      tenantId,
      userId,
      correlationId: (request.headers['x-correlation-id'] as string) ?? 'system',
    });
    const db = ctx.db.raw;
    const now = new Date();

    await db
      .insert(tourProgress)
      .values({
        tenantId,
        userId,
        tourId,
        tourVersion,
        status,
        currentStepId: currentStepId ?? null,
        completedAt: status === 'completed' ? now : null,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [tourProgress.tenantId, tourProgress.userId, tourProgress.tourId],
        set: {
          tourVersion,
          status,
          currentStepId: currentStepId ?? null,
          completedAt: status === 'completed' ? now : null,
          updatedAt: now,
        },
      });

    return reply.code(200).send({ data: { tourId, status } });
  });

  // POST /dap/events — one interaction-analytics event (tour_started/step_viewed/etc.).
  fastify.post('/dap/events', async (request, reply) => {
    const parsed = EventSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid event payload',
          details: parsed.error.flatten(),
        },
      });
    }

    const { tourId, tourVersion, stepId, eventType, metadata } = parsed.data;
    const tenantId = request.auth.tenantId;
    const userId = request.auth.userId ?? 0;
    const ctx = ctxFactory.create({
      tenantId,
      userId,
      correlationId: (request.headers['x-correlation-id'] as string) ?? 'system',
    });
    const db = ctx.db.raw;

    await db.insert(tourEvents).values({
      tenantId,
      userId,
      tourId,
      tourVersion,
      stepId: stepId ?? null,
      eventType,
      metadata: metadata ?? {},
    });

    return reply.code(201).send({ data: { recorded: true } });
  });
}
