import type { FastifyInstance } from 'fastify';
import type { PlatformContextFactory } from '@erp/sdk';
import { tenantScopedHandler } from '@erp/sdk';
import { z } from 'zod';
import { ValidationError } from '@erp/types';
import { PERMISSIONS } from '@erp/types';
import { authenticate } from '../middleware/authenticate.js';
import { requirePermission } from '../middleware/authorize.js';
import { TDSService, type TDSCategory } from '../domain/TDSService.js';

const RecordTDSSchema = z.object({
  supplierId: z.number().int().positive(),
  paymentId: z.number().int().positive(),
  grossAmount: z.number().positive(),
  category: z.enum([
    '194C_INDIVIDUAL',
    '194C_COMPANY',
    '194H',
    '194J_PROFESSIONAL',
    '194J_TECHNICAL',
  ]),
  tdsPayableAccountId: z.number().int().positive(),
  expenseAccountId: z.number().int().positive(),
  periodMonth: z.number().int().min(1).max(12),
  periodYear: z.number().int().min(2000).max(2100),
});

const GenerateCertSchema = z.object({
  supplierId: z.number().int().positive(),
  periodYear: z.number().int().min(2000).max(2100),
  periodQuarter: z.number().int().min(1).max(4),
  certificateNumber: z.string().min(1).max(50),
});

// Phase 9 GUC-per-request rollout — migrated 2026-08-21. No post-hoc side effects, no external
// I/O (TDSService is pure DB + certificate-document generation).
export async function tdsRoutes(
  fastify: FastifyInstance,
  ctxFactory: PlatformContextFactory
): Promise<void> {
  // ── GET /tds/liability — TDS liability for a period ───────────────────────
  fastify.get(
    '/tds/liability',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.TDS_VIEW)] },
    tenantScopedHandler(ctxFactory, async (request, reply, ctx) => {
      const query = request.query as { periodMonth?: string; periodYear?: string };
      const now = new Date();
      const periodMonth = parseInt(query.periodMonth ?? String(now.getMonth() + 1), 10);
      const periodYear = parseInt(query.periodYear ?? String(now.getFullYear()), 10);

      const data = await TDSService.getTDSLiability(
        ctx.db,
        ctx.tenant.tenantId,
        periodMonth,
        periodYear
      );
      return reply.code(200).send({ data });
    })
  );

  // ── POST /tds/deduct — Record a TDS deduction ─────────────────────────────
  fastify.post(
    '/tds/deduct',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.TDS_MANAGE)] },
    tenantScopedHandler(ctxFactory, async (request, reply, ctx) => {
      const body = RecordTDSSchema.safeParse(request.body);
      if (!body.success)
        throw new ValidationError(body.error.errors.map((e) => e.message).join('; '));

      const result = await TDSService.recordTDSEntry(
        ctx.db,
        ctx.tenant.tenantId,
        ctx.tenant.userId,
        {
          ...body.data,
          category: body.data.category as TDSCategory,
        }
      );

      return reply.code(201).send({ data: result });
    })
  );

  // ── POST /tds/certificates — Generate Form 16A ────────────────────────────
  fastify.post(
    '/tds/certificates',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.TDS_MANAGE)] },
    tenantScopedHandler(ctxFactory, async (request, reply, ctx) => {
      const body = GenerateCertSchema.safeParse(request.body);
      if (!body.success)
        throw new ValidationError(body.error.errors.map((e) => e.message).join('; '));

      const cert = await TDSService.generateCertificate(
        ctx.db,
        ctx.tenant.tenantId,
        ctx.tenant.userId,
        body.data.supplierId,
        body.data.periodYear,
        body.data.periodQuarter as 1 | 2 | 3 | 4,
        body.data.certificateNumber
      );

      return reply.code(201).send({ data: cert });
    })
  );

  // ── GET /tds/certificates/:supplierId ─────────────────────────────────────
  fastify.get<{ Params: { supplierId: string } }>(
    '/tds/certificates/:supplierId',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.TDS_VIEW)] },
    tenantScopedHandler(ctxFactory, async (request, reply, ctx) => {
      const { supplierId: supplierIdParam } = request.params as { supplierId: string };
      const supplierId = parseInt(supplierIdParam, 10);

      const certs = await TDSService.getCertificates(ctx.db, ctx.tenant.tenantId, supplierId);
      return reply.code(200).send({ data: { content: certs, totalElements: certs.length } });
    })
  );

  // ── GET /tds/26q — Quarterly 26Q return data ──────────────────────────────
  fastify.get(
    '/tds/26q',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.TDS_VIEW)] },
    tenantScopedHandler(ctxFactory, async (request, reply, ctx) => {
      const query = request.query as { year?: string; quarter?: string };

      const year = parseInt(query.year ?? String(new Date().getFullYear()), 10);
      const quarter = parseInt(query.quarter ?? '1', 10) as 1 | 2 | 3 | 4;
      if (![1, 2, 3, 4].includes(quarter))
        throw new ValidationError('quarter must be 1, 2, 3, or 4');

      const data = await TDSService.get26QData(ctx.db, ctx.tenant.tenantId, year, quarter);
      return reply.code(200).send({ data });
    })
  );
}
