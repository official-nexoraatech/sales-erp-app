import type { FastifyInstance } from 'fastify';
import type { PlatformContextFactory } from '@erp/sdk';
import { tenantScopedHandler } from '@erp/sdk';
import { z } from 'zod';
import { PERMISSIONS } from '@erp/types';
import { authenticate } from '../middleware/authenticate.js';
import { requirePermission } from '../middleware/authorize.js';
import { MRPService } from '../domain/MRPService.js';

const DemandLineSchema = z.object({
  itemId: z.number().int().positive(),
  variantId: z.number().int().positive().optional(),
  requiredQty: z.number().positive(),
});

const RunMRPSchema = z.object({
  demandLines: z.array(DemandLineSchema).min(1),
  warehouseId: z.number().int().positive().optional(),
});

const RequisitionLineSchema = z.object({
  itemId: z.number().int().positive(),
  qty: z.number().positive(),
  unitId: z.number().int().positive().optional(),
  estimatedUnitPrice: z.number().nonnegative().optional(),
});

const CreateRequisitionSchema = z.object({
  branchId: z.number().int().positive(),
  lines: z.array(RequisitionLineSchema).min(1),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']).optional(),
  requiredByDate: z.coerce.date().optional(),
});

// Manufacturing vertical — MRP, built with tenantScopedHandler from day one, same pattern as
// routing.routes.ts/bom.routes.ts.
export async function mrpRoutes(
  fastify: FastifyInstance,
  ctxFactory: PlatformContextFactory
): Promise<void> {
  fastify.addHook('preHandler', authenticate);

  fastify.post('/mrp/run', {
    preHandler: requirePermission(PERMISSIONS.MRP_VIEW),
    handler: tenantScopedHandler(ctxFactory, async (req, reply, ctx) => {
      const body = RunMRPSchema.parse(req.body);
      const svc = new MRPService(ctx.db.raw);
      const result = await svc.computeRequirements(
        ctx.tenant.tenantId,
        body.demandLines,
        body.warehouseId
      );
      return reply.send({ data: result });
    }),
  });

  fastify.post('/mrp/requisitions', {
    preHandler: requirePermission(PERMISSIONS.MRP_CREATE_REQUISITION),
    handler: tenantScopedHandler(ctxFactory, async (req, reply, ctx) => {
      const body = CreateRequisitionSchema.parse(req.body);
      const svc = new MRPService(ctx.db.raw);
      const id = await svc.createRequisitionFromShortages({
        tenantId: ctx.tenant.tenantId,
        branchId: body.branchId,
        lines: body.lines,
        priority: body.priority,
        requiredByDate: body.requiredByDate,
        requestedBy: ctx.tenant.userId,
      });
      return reply.code(201).send({ data: { id } });
    }),
  });
}
