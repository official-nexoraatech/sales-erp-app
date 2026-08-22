import type { FastifyInstance } from 'fastify';
import type { PlatformContextFactory } from '@erp/sdk';
import { tenantScopedHandler } from '@erp/sdk';
import { z } from 'zod';
import { NotFoundError, ValidationError } from '@erp/types';
import { PERMISSIONS } from '@erp/types';
import { authenticate } from '../middleware/authenticate.js';
import { requirePermission, requireAnyPermission } from '../middleware/authorize.js';
import { FieldVisitService } from '../domain/FieldVisitService.js';

// CRM-ROADMAP Phase 4, Feature 1 — Field Sales / Distributor CRM. ROUTE_MANAGE (distribution
// managers) gets tenant-wide route/visit visibility and route CRUD; FIELD_VISIT_MANAGE (a field
// rep) gets identity-scoped access to their own routes/visits only — this codebase has no
// manager-hierarchy concept, so ROUTE_MANAGE is deliberately all-or-nothing tenant-wide, same
// precedent as TERRITORY_MANAGE/QUOTA_MANAGE.
//
// CRM/O2C split — third migrated file (after dlt-template.routes.ts, territory.routes.ts).
// Verified zero code coupling to anything else in sales-service before moving.
//
// Phase 9 GUC-per-request rollout — migrated 2026-08-21. No external I/O — FieldVisitService has
// no fetch() calls. Post-hoc ctx.audit.log() calls are safe per caveat 4b.

const RouteCreateSchema = z.object({
  name: z.string().min(2).max(200),
  assignedTo: z.number().int().positive(),
  territoryId: z.number().int().positive().optional(),
  scheduledDate: z.string().datetime(),
});

const RouteUpdateSchema = z.object({
  version: z.number().int().min(0),
  status: z.enum(['PLANNED', 'IN_PROGRESS', 'COMPLETED']).optional(),
});

const StopsSchema = z.object({
  stops: z.array(
    z.object({ customerId: z.number().int().positive(), sequenceNumber: z.number().int().min(0) })
  ),
});

const VisitLogSchema = z.object({
  customerId: z.number().int().positive(),
  routeStopId: z.number().int().positive().optional(),
  checkInLat: z.number().min(-90).max(90).optional(),
  checkInLng: z.number().min(-180).max(180).optional(),
  notes: z.string().max(2000).optional(),
  // Client-generated idempotency key (OFFLINE-02/05 pattern) — required so a flaky-connection
  // retry from the frontend's offline write-queue can never double-log the same visit.
  clientOperationId: z.string().min(1).max(100),
});

const CheckOutSchema = z.object({
  checkOutLat: z.number().min(-90).max(90).optional(),
  checkOutLng: z.number().min(-180).max(180).optional(),
});

function canViewAll(permissions: string[]): boolean {
  return permissions.includes(PERMISSIONS.ROUTE_MANAGE);
}

export async function fieldVisitRoutes(
  fastify: FastifyInstance,
  ctxFactory: PlatformContextFactory
): Promise<void> {
  fastify.post(
    '/visit-routes',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.ROUTE_MANAGE)] },
    tenantScopedHandler(ctxFactory, async (request, reply, ctx) => {
      const body = RouteCreateSchema.safeParse(request.body);
      if (!body.success)
        throw new ValidationError(body.error.errors.map((e) => e.message).join('; '));

      const created = await FieldVisitService.createRoute(
        ctx.db.raw,
        ctx.tenant.tenantId,
        ctx.tenant.userId,
        {
          name: body.data.name,
          assignedTo: body.data.assignedTo,
          territoryId: body.data.territoryId,
          scheduledDate: new Date(body.data.scheduledDate),
        }
      );

      await ctx.audit.log({
        action: 'CREATE',
        entityType: 'crm_visit_route',
        entityId: created.id,
        after: created as unknown as Record<string, unknown>,
      });
      return reply.code(201).send({ data: created });
    })
  );

  fastify.get(
    '/visit-routes',
    {
      preHandler: [
        authenticate,
        requireAnyPermission([PERMISSIONS.ROUTE_MANAGE, PERMISSIONS.FIELD_VISIT_MANAGE]),
      ],
    },
    tenantScopedHandler(ctxFactory, async (request, reply, ctx) => {
      const { permissions } = request.auth;
      const rows = await FieldVisitService.listRoutes(ctx.db.raw, ctx.tenant.tenantId, {
        canViewAll: canViewAll(permissions),
        callerId: ctx.tenant.userId,
      });
      return reply.code(200).send({ data: { content: rows, totalElements: rows.length } });
    })
  );

  fastify.put(
    '/visit-routes/:id',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.ROUTE_MANAGE)] },
    tenantScopedHandler(ctxFactory, async (request, reply, ctx) => {
      const { id: idParam } = request.params as { id: string };
      const id = parseInt(idParam, 10);
      const body = RouteUpdateSchema.safeParse(request.body);
      if (!body.success)
        throw new ValidationError(body.error.errors.map((e) => e.message).join('; '));

      const updated = await FieldVisitService.updateRoute(
        ctx.db.raw,
        ctx.tenant.tenantId,
        id,
        body.data
      );
      return reply.code(200).send({ data: updated });
    })
  );

  fastify.put(
    '/visit-routes/:id/stops',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.ROUTE_MANAGE)] },
    tenantScopedHandler(ctxFactory, async (request, reply, ctx) => {
      const { id: idParam } = request.params as { id: string };
      const id = parseInt(idParam, 10);
      const body = StopsSchema.safeParse(request.body);
      if (!body.success)
        throw new ValidationError(body.error.errors.map((e) => e.message).join('; '));

      await FieldVisitService.setStops(ctx.db.raw, ctx.tenant.tenantId, id, body.data.stops);
      return reply
        .code(200)
        .send({ data: { message: 'Stops updated', count: body.data.stops.length } });
    })
  );

  fastify.get(
    '/visit-routes/:id/progress',
    {
      preHandler: [
        authenticate,
        requireAnyPermission([PERMISSIONS.ROUTE_MANAGE, PERMISSIONS.FIELD_VISIT_MANAGE]),
      ],
    },
    tenantScopedHandler(ctxFactory, async (request, reply, ctx) => {
      const { permissions } = request.auth;
      const { id: idParam } = request.params as { id: string };
      const id = parseInt(idParam, 10);
      const progress = await FieldVisitService.getRouteProgress(
        ctx.db.raw,
        ctx.tenant.tenantId,
        id
      );

      if (!canViewAll(permissions) && progress.route.assignedTo !== ctx.tenant.userId) {
        throw new NotFoundError('VisitRoute', id);
      }
      return reply.code(200).send({ data: progress });
    })
  );

  fastify.post(
    '/field-visits',
    {
      preHandler: [
        authenticate,
        requireAnyPermission([PERMISSIONS.FIELD_VISIT_MANAGE, PERMISSIONS.ROUTE_MANAGE]),
      ],
    },
    tenantScopedHandler(ctxFactory, async (request, reply, ctx) => {
      const body = VisitLogSchema.safeParse(request.body);
      if (!body.success)
        throw new ValidationError(body.error.errors.map((e) => e.message).join('; '));

      // repUserId is always the authenticated caller — never trusted from the request body,
      // so one rep can never log a visit under another rep's identity.
      const { visit, alreadyExisted } = await FieldVisitService.logVisit(
        ctx.db.raw,
        ctx.tenant.tenantId,
        ctx.tenant.userId,
        body.data
      );

      if (!alreadyExisted) {
        await ctx.audit.log({
          action: 'CREATE',
          entityType: 'crm_field_visit',
          entityId: visit.id,
          after: visit as unknown as Record<string, unknown>,
        });
      }
      return reply.code(alreadyExisted ? 200 : 201).send({ data: visit, alreadyExisted });
    })
  );

  fastify.put(
    '/field-visits/:id/checkout',
    {
      preHandler: [
        authenticate,
        requireAnyPermission([PERMISSIONS.FIELD_VISIT_MANAGE, PERMISSIONS.ROUTE_MANAGE]),
      ],
    },
    tenantScopedHandler(ctxFactory, async (request, reply, ctx) => {
      const { id: idParam } = request.params as { id: string };
      const id = parseInt(idParam, 10);
      const body = CheckOutSchema.safeParse(request.body);
      if (!body.success)
        throw new ValidationError(body.error.errors.map((e) => e.message).join('; '));

      const updated = await FieldVisitService.checkOut(
        ctx.db.raw,
        ctx.tenant.tenantId,
        ctx.tenant.userId,
        id,
        body.data
      );
      return reply.code(200).send({ data: updated });
    })
  );

  fastify.get(
    '/field-visits',
    {
      preHandler: [
        authenticate,
        requireAnyPermission([PERMISSIONS.FIELD_VISIT_MANAGE, PERMISSIONS.ROUTE_MANAGE]),
      ],
    },
    tenantScopedHandler(ctxFactory, async (request, reply, ctx) => {
      const { permissions } = request.auth;
      const query = request.query as { repUserId?: string; dateFrom?: string; dateTo?: string };
      const rows = await FieldVisitService.listVisits(
        ctx.db.raw,
        ctx.tenant.tenantId,
        { canViewAll: canViewAll(permissions), callerId: ctx.tenant.userId },
        {
          ...(query.repUserId ? { repUserId: parseInt(query.repUserId, 10) } : {}),
          ...(query.dateFrom ? { dateFrom: new Date(query.dateFrom) } : {}),
          ...(query.dateTo ? { dateTo: new Date(query.dateTo) } : {}),
        }
      );
      return reply.code(200).send({ data: { content: rows, totalElements: rows.length } });
    })
  );
}
