import type { FastifyInstance } from 'fastify';
import type { PlatformContextFactory } from '@erp/sdk';
import { z } from 'zod';
import { ValidationError } from '@erp/types';
import { PERMISSIONS } from '@erp/types';
import { authenticate } from '../middleware/authenticate.js';
import { requirePermission } from '../middleware/authorize.js';
import { EInvoiceService } from '../domain/EInvoiceService.js';
import type { NicEInvoicePayload } from '../domain/EInvoiceService.js';

type AuthedRequest = { auth: { tenantId: number; userId: number } };

const NicItemSchema = z.object({
  SlNo: z.string(),
  PrdDesc: z.string(),
  IsServc: z.enum(['Y', 'N']),
  HsnCd: z.string().regex(/^\d{4,8}$/, 'HSN code must be 4-8 digits'),
  Qty: z.number().min(0),
  Unit: z.string(),
  UnitPrice: z.number().min(0),
  TotAmt: z.number().min(0),
  AssAmt: z.number().min(0),
  GstRt: z.number().min(0),
  IgstAmt: z.number().min(0),
  CgstAmt: z.number().min(0),
  SgstAmt: z.number().min(0),
  TotItemVal: z.number().min(0),
  Discount: z.number().optional(),
  CesRt: z.number().optional(),
  CesAmt: z.number().optional(),
});

const NicSellerBuyerSchema = z.object({
  Gstin: z.string().length(15),
  LglNm: z.string().max(100),
  TrdNm: z.string().optional(),
  Addr1: z.string().max(100),
  Addr2: z.string().optional(),
  Loc: z.string().max(50),
  Pin: z.number().int(),
  Stcd: z.string().max(2),
  Pos: z.string().optional(),
  Ph: z.string().optional(),
  Em: z.string().optional(),
});

const GenerateIrnSchema = z.object({
  invoiceId: z.number().int().positive(),
  payload: z.object({
    Version: z.string(),
    TranDtls: z.object({
      TaxSch: z.string(),
      SupTyp: z.string(),
      RegRev: z.enum(['Y', 'N']),
    }),
    DocDtls: z.object({
      Typ: z.enum(['INV', 'CRN', 'DBN']),
      No: z.string().max(16),
      Dt: z.string(),
    }),
    SellerDtls: NicSellerBuyerSchema,
    BuyerDtls: NicSellerBuyerSchema,
    ItemList: z.array(NicItemSchema).min(1),
    ValDtls: z.object({
      AssVal: z.number(),
      CgstVal: z.number(),
      SgstVal: z.number(),
      IgstVal: z.number(),
      CesVal: z.number(),
      TotInvVal: z.number(),
      Discount: z.number().optional(),
      RndOffAmt: z.number().optional(),
    }),
  }),
});

const CancelIrnSchema = z.object({
  reason: z.string().min(1).max(200),
  remark: z.string().max(500).optional(),
});

export async function einvoiceRoutes(
  fastify: FastifyInstance,
  ctxFactory: PlatformContextFactory
): Promise<void> {
  // POST /gst/einvoice/generate/:invoiceId
  fastify.post<{ Params: { invoiceId: string } }>('/gst/einvoice/generate/:invoiceId', {
    preHandler: [authenticate, requirePermission(PERMISSIONS.EINVOICE_GENERATE)],
  }, async (request, reply) => {
    const { tenantId, userId } = (request as unknown as AuthedRequest).auth;
    const ctx = ctxFactory.create({
      tenantId, userId,
      correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID(),
    });

    const invoiceId = parseInt(request.params.invoiceId, 10);
    if (isNaN(invoiceId)) throw new ValidationError('Invalid invoiceId');

    const body = GenerateIrnSchema.safeParse(request.body);
    if (!body.success) throw new ValidationError(body.error.errors.map((e) => e.message).join('; '));

    const irnResponse = await EInvoiceService.generateIrn(
      ctx.db,
      tenantId,
      userId,
      invoiceId,
      body.data.payload as unknown as NicEInvoicePayload
    );

    await ctx.audit.log({
      action: 'EINVOICE_IRN_GENERATED',
      entityType: 'INVOICE',
      entityId: invoiceId,
      after: { irn: irnResponse.Irn, ackNumber: irnResponse.AckNo } as Record<string, unknown>,
    });

    return reply.code(200).send({ data: irnResponse });
  });

  // POST /gst/einvoice/cancel/:invoiceId
  fastify.post<{ Params: { invoiceId: string } }>('/gst/einvoice/cancel/:invoiceId', {
    preHandler: [authenticate, requirePermission(PERMISSIONS.EINVOICE_CANCEL)],
  }, async (request, reply) => {
    const { tenantId, userId } = (request as unknown as AuthedRequest).auth;
    const ctx = ctxFactory.create({
      tenantId, userId,
      correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID(),
    });

    const invoiceId = parseInt(request.params.invoiceId, 10);
    if (isNaN(invoiceId)) throw new ValidationError('Invalid invoiceId');

    const body = CancelIrnSchema.safeParse(request.body);
    if (!body.success) throw new ValidationError(body.error.errors.map((e) => e.message).join('; '));

    await EInvoiceService.cancelIrn(ctx.db, tenantId, invoiceId, body.data.reason, body.data.remark);

    await ctx.audit.log({
      action: 'EINVOICE_IRN_CANCELLED',
      entityType: 'INVOICE',
      entityId: invoiceId,
      after: { reason: body.data.reason } as Record<string, unknown>,
    });

    return reply.code(200).send({ data: { message: 'IRN cancelled at NIC successfully' } });
  });

  // POST /gst/einvoice/retry-pending — internal scheduler endpoint
  fastify.post('/gst/einvoice/retry-pending', {
    config: { internalOnly: true },
  }, async (_request, reply) => {
    // Retry all PENDING_IRN records across all tenants (scheduler-triggered)
    // tenantId=0 is a sentinel for "system/all tenants" — EInvoiceService handles the query without tenant scoping
    const result = await EInvoiceService.retryPendingIrns();
    return reply.code(200).send({ data: result });
  });

  // GET /gst/einvoice/status/:invoiceId
  fastify.get<{ Params: { invoiceId: string } }>('/gst/einvoice/status/:invoiceId', {
    preHandler: [authenticate, requirePermission(PERMISSIONS.GST_VIEW)],
  }, async (request, reply) => {
    const { tenantId, userId } = (request as unknown as AuthedRequest).auth;
    const ctx = ctxFactory.create({
      tenantId, userId,
      correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID(),
    });

    const invoiceId = parseInt(request.params.invoiceId, 10);
    if (isNaN(invoiceId)) throw new ValidationError('Invalid invoiceId');

    const status = await EInvoiceService.getStatus(ctx.db, tenantId, invoiceId);
    return reply.code(200).send({ data: status });
  });
}
