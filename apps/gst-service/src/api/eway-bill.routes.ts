import type { FastifyInstance } from 'fastify';
import type { PlatformContextFactory } from '@erp/sdk';
import { z } from 'zod';
import { ValidationError } from '@erp/types';
import { PERMISSIONS } from '@erp/types';
import { authenticate } from '../middleware/authenticate.js';
import { requirePermission } from '../middleware/authorize.js';
import { EwayBillService } from '../domain/EwayBillService.js';
import type { EwayBillPayload } from '../domain/EwayBillService.js';

type AuthedRequest = { auth: { tenantId: number; userId: number } };

const ItemSchema = z.object({
  productName: z.string().min(1),
  hsnCode: z.string().regex(/^\d{4,8}$/),
  quantity: z.number().min(0),
  qtyUnit: z.string(),
  cgstRate: z.number().min(0),
  sgstRate: z.number().min(0),
  igstRate: z.number().min(0),
  cessRate: z.number().optional(),
  taxableAmount: z.number().min(0),
  productDesc: z.string().optional(),
});

const GenerateEwbSchema = z.object({
  invoiceId: z.number().int().positive(),
  payload: z.object({
    supplyType: z.enum(['O', 'I']),
    subSupplyType: z.string(),
    docType: z.enum(['INV', 'BIL', 'BOE', 'CNT', 'CHL', 'OTH']),
    docNo: z.string().max(16),
    docDate: z.string(),
    fromGstin: z.string().length(15),
    fromTrdName: z.string(),
    fromAddr1: z.string(),
    fromAddr2: z.string().optional(),
    fromPlace: z.string(),
    fromPincode: z.number().int(),
    fromStateCode: z.number().int(),
    toGstin: z.string().length(15),
    toTrdName: z.string(),
    toAddr1: z.string(),
    toAddr2: z.string().optional(),
    toPlace: z.string(),
    toPincode: z.number().int(),
    toStateCode: z.number().int(),
    totalValue: z.number().min(0),
    cgstValue: z.number().min(0),
    sgstValue: z.number().min(0),
    igstValue: z.number().min(0),
    cessValue: z.number().min(0),
    transMode: z.enum(['1', '2', '3', '4']),
    vehicleNo: z.string().optional(),
    vehicleType: z.enum(['R', 'O']).optional(),
    transporterGstin: z.string().optional(),
    transporterName: z.string().optional(),
    transDocNo: z.string().optional(),
    itemList: z.array(ItemSchema).min(1),
  }),
});

export async function ewayBillRoutes(
  fastify: FastifyInstance,
  ctxFactory: PlatformContextFactory
): Promise<void> {
  // POST /gst/eway-bill/generate
  fastify.post('/gst/eway-bill/generate', {
    preHandler: [authenticate, requirePermission(PERMISSIONS.EWAY_BILL_GENERATE)],
  }, async (request, reply) => {
    const { tenantId, userId } = (request as unknown as AuthedRequest).auth;
    const ctx = ctxFactory.create({
      tenantId, userId,
      correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID(),
    });

    const body = GenerateEwbSchema.safeParse(request.body);
    if (!body.success) throw new ValidationError(body.error.errors.map((e) => e.message).join('; '));

    const result = await EwayBillService.generate(
      ctx.db,
      tenantId,
      userId,
      body.data.invoiceId,
      body.data.payload as EwayBillPayload,
      ctx.tenant.correlationId
    );

    // ES-28 [M16-b]: EWAY_BILL_GENERATED is now published inside the same
    // transaction as the state-transition write (see EwayBillService.generate).
    await ctx.audit.log({
      action: 'EWAY_BILL_GENERATED',
      entityType: 'INVOICE',
      entityId: body.data.invoiceId,
      after: result as unknown as Record<string, unknown>,
    });

    return reply.code(200).send({ data: result });
  });

  // GET /gst/eway-bill/expiring-soon
  fastify.get('/gst/eway-bill/expiring-soon', {
    preHandler: [authenticate, requirePermission(PERMISSIONS.GST_VIEW)],
  }, async (request, reply) => {
    const { tenantId, userId } = (request as unknown as AuthedRequest).auth;
    const ctx = ctxFactory.create({
      tenantId, userId,
      correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID(),
    });

    const expiring = await EwayBillService.getExpiringSoon(ctx.db, tenantId);
    return reply.code(200).send({ data: { content: expiring, totalElements: expiring.length } });
  });
}
