import type { FastifyInstance } from 'fastify';
import type { PlatformContextFactory } from '@erp/sdk';
import { gstRates, hsnMaster } from '@erp/db';
import { and, eq, ilike } from 'drizzle-orm';
import { z } from 'zod';
import { NotFoundError, ValidationError } from '@erp/types';
import { PERMISSIONS } from '@erp/types';
import { GSTCalculator } from '../domain/GSTCalculator.js';
import { authenticate } from '../middleware/authenticate.js';
import { requirePermission } from '../middleware/authorize.js';

const VALID_GST_RATES = [0, 5, 12, 18, 28] as const;
const HSN_REGEX = /^\d{4,8}$/;

type AuthedRequest = { auth: { tenantId: number; userId: number } };

export async function gstRoutes(
  fastify: FastifyInstance,
  ctxFactory: PlatformContextFactory
): Promise<void> {
  // ── GET /gst/rates ────────────────────────────────────────────────────────
  fastify.get('/gst/rates', { preHandler: [authenticate, requirePermission(PERMISSIONS.GST_VIEW)] }, async (request, reply) => {
    const { tenantId, userId } = (request as unknown as AuthedRequest).auth;
    const ctx = ctxFactory.create({
      tenantId,
      userId,
      correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID(),
    });
    const rows = await ctx.db.raw.select().from(gstRates).where(eq(gstRates.tenantId, tenantId));
    return reply.code(200).send({ data: { content: rows, totalElements: rows.length } });
  });

  // ── PUT /gst/rates/:id ────────────────────────────────────────────────────
  fastify.put<{ Params: { id: string } }>('/gst/rates/:id', { preHandler: [authenticate, requirePermission(PERMISSIONS.GST_VIEW)] }, async (request, reply) => {
    const { tenantId, userId } = (request as unknown as AuthedRequest).auth;
    const ctx = ctxFactory.create({
      tenantId,
      userId,
      correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID(),
    });
    const id = parseInt(request.params.id, 10);
    const RateUpdateSchema = z.object({
      description: z.string().min(2).max(200),
      isActive: z.boolean().optional(),
    });
    const body = RateUpdateSchema.safeParse(request.body);
    if (!body.success) throw new ValidationError(body.error.errors.map((e) => e.message).join('; '));

    const [existing] = await ctx.db.raw.select().from(gstRates).where(and(eq(gstRates.id, id), eq(gstRates.tenantId, tenantId)));
    if (!existing) throw new NotFoundError('GST rate', id);

    const [updated] = await ctx.db.raw
      .update(gstRates)
      .set({ ...body.data, updatedAt: new Date(), version: existing.version + 1 })
      .where(eq(gstRates.id, id))
      .returning();

    return reply.code(200).send({ data: updated });
  });

  // ── POST /gst/validate-hsn — Validate HSN and return GST rate ────────────
  fastify.post('/gst/validate-hsn', { preHandler: [authenticate, requirePermission(PERMISSIONS.GST_VIEW)] }, async (request, reply) => {
    const { tenantId, userId } = (request as unknown as AuthedRequest).auth;
    const ctx = ctxFactory.create({
      tenantId,
      userId,
      correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID(),
    });
    const body = request.body as { hsnCode?: string };
    const hsnCode = (body.hsnCode ?? '').trim();

    if (!HSN_REGEX.test(hsnCode)) {
      return reply.code(422).send({
        error: { code: 'INVALID_HSN', message: 'HSN code must be 4-8 digits' },
      });
    }

    const [hsn] = await ctx.db.raw
      .select()
      .from(hsnMaster)
      .where(and(eq(hsnMaster.hsnCode, hsnCode), eq(hsnMaster.isActive, true)));

    if (!hsn) {
      return reply.code(422).send({
        error: { code: 'INVALID_HSN', message: `HSN code ${hsnCode} not found in master list` },
      });
    }

    return reply.code(200).send({
      data: {
        hsnCode: hsn.hsnCode,
        description: hsn.description,
        gstRate: hsn.gstRate,
        cessRate: hsn.cessRate,
        chapter: hsn.chapter,
      },
    });
  });

  // ── GET /gst/hsn/search — HSN lookup widget ───────────────────────────────
  fastify.get('/gst/hsn/search', { preHandler: [authenticate, requirePermission(PERMISSIONS.GST_VIEW)] }, async (request, reply) => {
    const { tenantId, userId } = (request as unknown as AuthedRequest).auth;
    const ctx = ctxFactory.create({
      tenantId,
      userId,
      correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID(),
    });
    const query = request.query as { q?: string };
    const search = (query.q ?? '').trim();
    if (search.length < 2) {
      return reply.code(200).send({ data: { content: [], totalElements: 0 } });
    }

    const rows = await ctx.db.raw
      .select()
      .from(hsnMaster)
      .where(and(ilike(hsnMaster.description, `%${search}%`), eq(hsnMaster.isActive, true)))
      .limit(20);

    return reply.code(200).send({ data: { content: rows, totalElements: rows.length } });
  });

  // ── POST /gst/compute — Compute GST breakdown ─────────────────────────────
  fastify.post('/gst/compute', { preHandler: [authenticate, requirePermission(PERMISSIONS.GST_COMPUTE)] }, async (request, reply) => {
    const ComputeSchema = z.object({
      taxableAmount: z.number().min(0),
      gstRate: z.number().refine((v) => (VALID_GST_RATES as readonly number[]).includes(v), {
        message: 'GST rate must be 0, 5, 12, 18 or 28',
      }),
      cessRate: z.number().min(0).max(100).default(0),
      isInterstate: z.boolean().default(false),
    });
    const body = ComputeSchema.safeParse(request.body);
    if (!body.success) throw new ValidationError(body.error.errors.map((e) => e.message).join('; '));
    const result = GSTCalculator.compute(body.data);
    return reply.code(200).send({ data: result });
  });

  // ── POST /gst/seed-rates — Seed default rates for a new tenant ────────────
  // Called internally by TenantProvisioner
  fastify.post('/gst/seed-rates', { preHandler: [authenticate, requirePermission(PERMISSIONS.GST_VIEW)] }, async (request, reply) => {
    const { tenantId, userId } = (request as unknown as AuthedRequest).auth;
    const ctx = ctxFactory.create({
      tenantId,
      userId,
      correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID(),
    });

    const defaultRates = [
      { rate: '0', description: 'Nil rated / Exempt' },
      { rate: '5', description: '5% GST (e.g., cotton, silk fabric)' },
      { rate: '12', description: '12% GST (e.g., man-made fibre fabric)' },
      { rate: '18', description: '18% GST (standard rate)' },
      { rate: '28', description: '28% GST (luxury goods / cess items)' },
    ];

    await ctx.db.raw.insert(gstRates).values(
      defaultRates.map((r) => ({ tenantId, createdBy: userId, ...r }))
    ).onConflictDoNothing();

    return reply.code(200).send({ data: { message: 'GST rates seeded', count: defaultRates.length } });
  });
}
