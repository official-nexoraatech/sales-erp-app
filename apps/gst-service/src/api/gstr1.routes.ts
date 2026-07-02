import type { FastifyInstance } from 'fastify';
import type { PlatformContextFactory } from '@erp/sdk';
import { z } from 'zod';
import { ValidationError, BusinessError } from '@erp/types';
import { PERMISSIONS } from '@erp/types';
import { authenticate } from '../middleware/authenticate.js';
import { requirePermission } from '../middleware/authorize.js';
import { Gstr1Service } from '../domain/Gstr1Service.js';

type AuthedRequest = { auth: { tenantId: number; userId: number } };
const PERIOD_REGEX = /^\d{4}-\d{2}$/;

export async function gstr1Routes(
  fastify: FastifyInstance,
  ctxFactory: PlatformContextFactory
): Promise<void> {
  // GET /gst/gstr1?period=2025-06
  fastify.get('/gst/gstr1', {
    preHandler: [authenticate, requirePermission(PERMISSIONS.GSTR1_VIEW)],
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

    const sections = await Gstr1Service.compute(ctx.db, tenantId, q.data.period);
    const validationErrors = Gstr1Service.validateBeforeExport(sections);

    return reply.code(200).send({
      data: {
        period: q.data.period,
        sections,
        validationErrors,
        isExportReady: validationErrors.length === 0,
      },
    });
  });

  // POST /gst/gstr1/export?period=2025-06&format=JSON|EXCEL
  fastify.post('/gst/gstr1/export', {
    preHandler: [authenticate, requirePermission(PERMISSIONS.GSTR1_FILE)],
  }, async (request, reply) => {
    const { tenantId, userId } = (request as unknown as AuthedRequest).auth;
    const ctx = ctxFactory.create({
      tenantId, userId,
      correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID(),
    });

    const QuerySchema = z.object({
      period: z.string().regex(PERIOD_REGEX, 'Period must be YYYY-MM'),
      format: z.enum(['JSON', 'EXCEL']).default('JSON'),
    });
    const q = QuerySchema.safeParse(request.query);
    if (!q.success) throw new ValidationError(q.error.errors.map((e) => e.message).join('; '));

    const BodySchema = z.object({ gstin: z.string().length(15, 'GSTIN must be 15 characters') }).optional();
    const body = BodySchema.safeParse(request.body);
    if (!body.success) throw new ValidationError(body.error.errors.map((e) => e.message).join('; '));

    const sections = await Gstr1Service.compute(ctx.db, tenantId, q.data.period);
    const validationErrors = Gstr1Service.validateBeforeExport(sections);
    if (validationErrors.length > 0) {
      throw new BusinessError('GSTR1_VALIDATION_FAILED', 'GSTR-1 validation failed before export', { errors: validationErrors });
    }

    // Convert YYYY-MM to MMYYYY for NIC format
    const [year, month] = q.data.period.split('-');
    const nicPeriod = `${month ?? ''}${year ?? ''}`;
    const gstin = body.data?.gstin ?? '';
    const nicJson = Gstr1Service.toNicJson(gstin, nicPeriod, sections);

    await ctx.audit.log({
      action: 'GSTR1_EXPORTED',
      entityType: 'GSTR1',
      entityId: tenantId,
      after: { period: q.data.period, format: q.data.format } as Record<string, unknown>,
    });

    if (q.data.format === 'JSON') {
      return reply.code(200).send({
        data: {
          period: q.data.period,
          format: 'JSON',
          nicJson,
          exportedAt: new Date().toISOString(),
        },
      });
    }

    // Excel format — return JSON representation of what would be in Excel
    // (actual Excel generation requires a spreadsheet library; returning structured data for now)
    return reply.code(200).send({
      data: {
        period: q.data.period,
        format: 'EXCEL_DATA',
        sheets: {
          B2B: sections.b2b,
          B2CS: sections.b2cs,
          CDNR: sections.cdnr,
          HSN: sections.hsn.data,
          DOC: sections.doc,
        },
        exportedAt: new Date().toISOString(),
      },
    });
  });
}
