import type { FastifyInstance } from 'fastify';
import type { PlatformContextFactory } from '@erp/sdk';
import { z } from 'zod';
import { ValidationError } from '@erp/types';
import { PERMISSIONS } from '@erp/types';
import { authenticate } from '../middleware/authenticate.js';
import { requirePermission } from '../middleware/authorize.js';
import { FixedAssetService } from '../domain/FixedAssetService.js';

type AuthedRequest = { auth: { tenantId: number; userId: number } };

const CreateAssetSchema = z.object({
  assetCode: z.string().min(1).max(30),
  assetName: z.string().min(1).max(300),
  assetCategory: z.string().min(1).max(100),
  purchaseDate: z.string().length(10),
  purchaseCost: z.number().positive(),
  salvageValue: z.number().min(0),
  usefulLifeMonths: z.number().int().positive(),
  depreciationMethod: z.enum(['SLM', 'WDV']),
  wdvRate: z.number().positive().optional(),
  assetAccountId: z.number().int().positive(),
  depreciationExpenseAccountId: z.number().int().positive(),
  accumulatedDepreciationAccountId: z.number().int().positive(),
  notes: z.string().max(500).optional(),
});

const UpdateAssetSchema = z.object({
  assetName: z.string().min(1).max(300).optional(),
  notes: z.string().max(500).optional(),
});

const DisposeSchema = z.object({
  disposalDate: z.string().length(10),
  disposalProceeds: z.number().min(0),
  gainLossAccountId: z.number().int().positive(),
});

const RunDepreciationSchema = z.object({
  periodMonth: z.number().int().min(1).max(12),
  periodYear: z.number().int().min(2000).max(2100),
});

export async function fixedAssetsRoutes(
  fastify: FastifyInstance,
  ctxFactory: PlatformContextFactory
): Promise<void> {
  // ── POST /fixed-assets ────────────────────────────────────────────────────
  fastify.post(
    '/fixed-assets',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.FIXED_ASSET_CREATE)] },
    async (request, reply) => {
      const { tenantId, userId } = (request as unknown as AuthedRequest).auth;
      const ctx = ctxFactory.create({ tenantId, userId, correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID() });

      const body = CreateAssetSchema.safeParse(request.body);
      if (!body.success) throw new ValidationError(body.error.errors.map((e) => e.message).join('; '));

      const asset = await FixedAssetService.create(ctx.db, tenantId, userId, {
        assetCode: body.data.assetCode,
        assetName: body.data.assetName,
        assetCategory: body.data.assetCategory,
        purchaseDate: body.data.purchaseDate,
        purchaseCost: body.data.purchaseCost,
        salvageValue: body.data.salvageValue,
        usefulLifeMonths: body.data.usefulLifeMonths,
        depreciationMethod: body.data.depreciationMethod,
        assetAccountId: body.data.assetAccountId,
        depreciationExpenseAccountId: body.data.depreciationExpenseAccountId,
        accumulatedDepreciationAccountId: body.data.accumulatedDepreciationAccountId,
        ...(body.data.wdvRate !== undefined ? { wdvRate: body.data.wdvRate } : {}),
        ...(body.data.notes ? { notes: body.data.notes } : {}),
      });
      return reply.code(201).send({ data: asset });
    }
  );

  // ── GET /fixed-assets ─────────────────────────────────────────────────────
  fastify.get(
    '/fixed-assets',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.FIXED_ASSET_VIEW)] },
    async (request, reply) => {
      const { tenantId, userId } = (request as unknown as AuthedRequest).auth;
      const ctx = ctxFactory.create({ tenantId, userId, correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID() });
      const assets = await FixedAssetService.list(ctx.db, tenantId);
      return reply.code(200).send({ data: { content: assets, totalElements: assets.length } });
    }
  );

  // ── GET /fixed-assets/:id ─────────────────────────────────────────────────
  fastify.get<{ Params: { id: string } }>(
    '/fixed-assets/:id',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.FIXED_ASSET_VIEW)] },
    async (request, reply) => {
      const { tenantId, userId } = (request as unknown as AuthedRequest).auth;
      const ctx = ctxFactory.create({ tenantId, userId, correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID() });
      const asset = await FixedAssetService.getById(ctx.db, tenantId, parseInt(request.params.id, 10));
      return reply.code(200).send({ data: asset });
    }
  );

  // ── PUT /fixed-assets/:id ─────────────────────────────────────────────────
  fastify.put<{ Params: { id: string } }>(
    '/fixed-assets/:id',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.FIXED_ASSET_UPDATE)] },
    async (request, reply) => {
      const { tenantId, userId } = (request as unknown as AuthedRequest).auth;
      const ctx = ctxFactory.create({ tenantId, userId, correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID() });
      const id = parseInt(request.params.id, 10);

      const body = UpdateAssetSchema.safeParse(request.body);
      if (!body.success) throw new ValidationError(body.error.errors.map((e) => e.message).join('; '));

      const asset = await FixedAssetService.update(ctx.db, tenantId, id, {
        ...(body.data.assetName ? { assetName: body.data.assetName } : {}),
        ...(body.data.notes ? { notes: body.data.notes } : {}),
      });
      return reply.code(200).send({ data: asset });
    }
  );

  // ── GET /fixed-assets/:id/depreciation-schedule ───────────────────────────
  fastify.get<{ Params: { id: string } }>(
    '/fixed-assets/:id/depreciation-schedule',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.FIXED_ASSET_VIEW)] },
    async (request, reply) => {
      const { tenantId, userId } = (request as unknown as AuthedRequest).auth;
      const ctx = ctxFactory.create({ tenantId, userId, correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID() });
      const id = parseInt(request.params.id, 10);
      const schedule = await FixedAssetService.getDepreciationSchedule(ctx.db, tenantId, id);
      return reply.code(200).send({ data: { content: schedule, totalElements: schedule.length } });
    }
  );

  // ── POST /fixed-assets/:id/dispose ────────────────────────────────────────
  fastify.post<{ Params: { id: string } }>(
    '/fixed-assets/:id/dispose',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.FIXED_ASSET_DISPOSE)] },
    async (request, reply) => {
      const { tenantId, userId } = (request as unknown as AuthedRequest).auth;
      const ctx = ctxFactory.create({ tenantId, userId, correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID() });
      const id = parseInt(request.params.id, 10);

      const body = DisposeSchema.safeParse(request.body);
      if (!body.success) throw new ValidationError(body.error.errors.map((e) => e.message).join('; '));

      const result = await FixedAssetService.dispose(
        ctx.db,
        tenantId,
        userId,
        id,
        body.data.disposalDate,
        body.data.disposalProceeds,
        body.data.gainLossAccountId
      );

      await ctx.audit.log({
        action: 'UPDATE',
        entityType: 'fixed_asset',
        entityId: id,
        metadata: { action: 'DISPOSE', ...result },
      });

      return reply.code(200).send({ data: result });
    }
  );

  // ── POST /fixed-assets/depreciation/run ───────────────────────────────────
  fastify.post(
    '/fixed-assets/depreciation/run',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.FIXED_ASSET_UPDATE)] },
    async (request, reply) => {
      const { tenantId, userId } = (request as unknown as AuthedRequest).auth;
      const ctx = ctxFactory.create({ tenantId, userId, correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID() });

      const body = RunDepreciationSchema.safeParse(request.body);
      if (!body.success) throw new ValidationError(body.error.errors.map((e) => e.message).join('; '));

      const result = await FixedAssetService.runMonthlyDepreciationBatch(
        ctx.db,
        tenantId,
        userId,
        body.data.periodMonth,
        body.data.periodYear
      );

      return reply.code(200).send({ data: result });
    }
  );
}
