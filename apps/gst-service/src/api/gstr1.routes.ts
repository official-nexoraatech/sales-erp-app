/* global process */
import type { FastifyInstance } from 'fastify';
import type { PlatformContextFactory } from '@erp/sdk';
import { z } from 'zod';
import { timingSafeEqual } from 'node:crypto';
import { ValidationError, BusinessError } from '@erp/types';
import { PERMISSIONS } from '@erp/types';
import { authenticate } from '../middleware/authenticate.js';
import { requirePermission } from '../middleware/authorize.js';
import { Gstr1Service } from '../domain/Gstr1Service.js';
import { Gstr1ExcelFormatter } from '../domain/Gstr1ExcelFormatter.js';

type AuthedRequest = { auth: { tenantId: number; userId: number } };
const PERIOD_REGEX = /^\d{4}-\d{2}$/;

// Same x-internal-key convention as einvoice.routes.ts's /gst/einvoice/retry-pending.
function requireInternalKey(req: { headers: Record<string, string | string[] | undefined> }, reply: { code: (n: number) => { send: (b: unknown) => void } }): boolean {
  const key = req.headers['x-internal-key'];
  const expected = process.env['INTERNAL_API_KEY'];
  const keyBuffer = Buffer.from(typeof key === 'string' ? key : '');
  const expectedBuffer = Buffer.from(expected ?? '');
  const matches = !!expected && keyBuffer.length === expectedBuffer.length && timingSafeEqual(keyBuffer, expectedBuffer);
  if (!matches) {
    reply.code(401).send({ error: 'Unauthorized' });
    return false;
  }
  return true;
}

// Previous month's period (YYYY-MM) — GSTR-1 for month M is prepared/filed in month M+1.
function previousPeriod(): string {
  const now = new Date();
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

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

    const buf = Gstr1ExcelFormatter.toWorkbook(sections);
    return reply
      .header('Content-Type', Gstr1ExcelFormatter.getContentType())
      .header('Content-Disposition', `attachment; filename="${Gstr1ExcelFormatter.getFileName(q.data.period)}"`)
      .send(buf);
  });

  // POST /gst/gstr1/auto-prepare?tenantId=... — PG-026, scheduler-triggered
  fastify.post('/gst/gstr1/auto-prepare', {
    handler: async (request, reply) => {
      if (!requireInternalKey(request as never, reply as never)) return;
      const tenantId = parseInt((request.query as { tenantId?: string }).tenantId ?? '', 10);
      if (!tenantId) return reply.code(400).send({ error: { code: 'MISSING_TENANT_ID', message: 'tenantId query param required' } });

      const ctx = ctxFactory.create({ tenantId, userId: 0, correlationId: crypto.randomUUID() });
      const period = previousPeriod();
      const sections = await Gstr1Service.compute(ctx.db, tenantId, period);
      const validationErrors = Gstr1Service.validateBeforeExport(sections);
      const isExportReady = validationErrors.length === 0;

      await ctx.audit.log({
        action: 'GSTR1_AUTO_PREPARED',
        entityType: 'GSTR1',
        entityId: tenantId,
        after: { period, isExportReady, validationErrorCount: validationErrors.length } as Record<string, unknown>,
      });

      return reply.code(200).send({ data: { period, isExportReady, validationErrorCount: validationErrors.length } });
    },
  });
}
