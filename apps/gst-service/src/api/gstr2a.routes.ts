import type { FastifyInstance } from 'fastify';
import type { PlatformContextFactory } from '@erp/sdk';
import { z } from 'zod';
import { ValidationError } from '@erp/types';
import { PERMISSIONS } from '@erp/types';
import { authenticate } from '../middleware/authenticate.js';
import { requirePermission } from '../middleware/authorize.js';
import { Gstr2aService, type Gstr2aRow } from '../domain/Gstr2aService.js';

type AuthedRequest = { auth: { tenantId: number; userId: number } };
const PERIOD_REGEX = /^\d{4}-\d{2}$/;

const Gstr2aRowSchema = z.object({
  supplierGstin: z.string().length(15),
  supplierName: z.string().optional(),
  invoiceNumber: z.string().min(1).max(100),
  invoiceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  taxableAmount: z.number().min(0),
  cgstAmount: z.number().min(0),
  sgstAmount: z.number().min(0),
  igstAmount: z.number().min(0),
  cessAmount: z.number().min(0).optional(),
  placeOfSupply: z.string().length(2).optional(),
});

export async function gstr2aRoutes(
  fastify: FastifyInstance,
  ctxFactory: PlatformContextFactory
): Promise<void> {
  // POST /gst/gstr2a/import
  fastify.post('/gst/gstr2a/import', {
    preHandler: [authenticate, requirePermission(PERMISSIONS.GSTR2A_RECONCILE)],
  }, async (request, reply) => {
    const { tenantId, userId } = (request as unknown as AuthedRequest).auth;
    const ctx = ctxFactory.create({
      tenantId, userId,
      correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID(),
    });

    const BodySchema = z.object({
      period: z.string().regex(PERIOD_REGEX, 'Period must be YYYY-MM'),
      entries: z.array(Gstr2aRowSchema).min(1, 'At least one entry required'),
    });

    const body = BodySchema.safeParse(request.body);
    if (!body.success) throw new ValidationError(body.error.errors.map((e) => e.message).join('; '));

    const result = await Gstr2aService.importGstr2a(ctx.db, tenantId, body.data.period, body.data.entries as unknown as Gstr2aRow[]);

    await ctx.audit.log({
      action: 'GSTR2A_IMPORTED',
      entityType: 'GSTR2A',
      entityId: tenantId,
      after: result as unknown as Record<string, unknown>,
    });

    return reply.code(200).send({ data: result });
  });

  // GET /gst/gstr2a/reconciliation?period=2025-06
  fastify.get('/gst/gstr2a/reconciliation', {
    preHandler: [authenticate, requirePermission(PERMISSIONS.GSTR2A_RECONCILE)],
  }, async (request, reply) => {
    const { tenantId, userId } = (request as unknown as AuthedRequest).auth;
    const ctx = ctxFactory.create({
      tenantId, userId,
      correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID(),
    });

    const QuerySchema = z.object({
      period: z.string().regex(PERIOD_REGEX, 'Period must be YYYY-MM'),
    });
    const q = QuerySchema.safeParse(request.query);
    if (!q.success) throw new ValidationError(q.error.errors.map((e) => e.message).join('; '));

    const result = await Gstr2aService.getReconciliation(ctx.db, tenantId, q.data.period);

    return reply.code(200).send({
      data: {
        period: q.data.period,
        summary: result.summary,
        gstr2aEntries: result.gstr2aEntries,
        booksOnlyEntries: result.booksOnlyEntries,
        actions: {
          BOOKS_ONLY: 'Contact supplier to file GSTR-1',
          AMOUNT_MISMATCH: 'Raise debit note or amend GRN',
          GSTR2A_ONLY: 'Check if GRN was missed in books',
        },
      },
    });
  });
}
