import type { FastifyInstance } from 'fastify';
import type { PlatformContextFactory } from '@erp/sdk';
import { customers, customersHistory } from '@erp/db';
import { and, eq, isNull, or, ilike } from 'drizzle-orm';
import { z } from 'zod';
import { BusinessError, NotFoundError, OptimisticLockError, ValidationError } from '@erp/types';
import { PERMISSIONS } from '@erp/types';
import { authenticate } from '../middleware/authenticate.js';
import { requirePermission } from '../middleware/authorize.js';

const GSTIN_REGEX = /^\d{2}[A-Z]{5}\d{4}[A-Z]{1}[A-Z\d]{1}[Z]{1}[A-Z\d]{1}$/;

const CustomerSchema = z.object({
  displayName: z.string().min(2).max(200),
  firstName: z.string().max(100).optional(),
  lastName: z.string().max(100).optional(),
  companyName: z.string().max(300).optional(),
  customerType: z.enum(['RETAIL', 'WHOLESALE', 'B2B', 'GOVERNMENT', 'EXPORT']).default('RETAIL'),
  gstin: z
    .string()
    .regex(GSTIN_REGEX, 'Invalid GSTIN format')
    .optional()
    .or(z.literal('')),
  pan: z
    .string()
    .regex(/^[A-Z]{5}\d{4}[A-Z]{1}$/, 'Invalid PAN format')
    .optional()
    .or(z.literal('')),
  phone: z.string().min(10).max(20),
  altPhone: z.string().max(20).optional(),
  email: z.string().email().max(255).optional().or(z.literal('')),
  dateOfBirth: z.string().max(10).optional(),
  anniversary: z.string().max(10).optional(),
  gender: z.enum(['MALE', 'FEMALE', 'OTHER']).optional(),
  billingAddress: z
    .object({
      line1: z.string().min(1),
      line2: z.string().optional(),
      city: z.string().min(1),
      state: z.string().min(1),
      stateCode: z.string().min(2).max(2),
      pincode: z.string().regex(/^\d{6}$/),
      country: z.string().default('India'),
    })
    .optional(),
  shippingAddress: z
    .object({
      line1: z.string().min(1),
      line2: z.string().optional(),
      city: z.string().min(1),
      state: z.string().min(1),
      stateCode: z.string().min(2).max(2),
      pincode: z.string().regex(/^\d{6}$/),
      country: z.string().default('India'),
    })
    .optional(),
  branchId: z.number().int().positive(),
  creditLimit: z.number().min(0).default(0),
  creditDays: z.number().int().min(0).default(0),
  creditLimitEnabled: z.boolean().default(false),
  openingBalance: z.number().min(0).default(0),
  openingBalanceType: z.enum(['DEBIT', 'CREDIT']).default('DEBIT'),
  priceListId: z.number().int().positive().optional(),
  notes: z.string().max(5000).optional(),
  tags: z.array(z.string()).default([]),
  customFields: z.record(z.unknown()).default({}),
});

const CustomerUpdateSchema = CustomerSchema.extend({
  version: z.number().int().min(0),
});

type AuthedRequest = { auth: { tenantId: number; userId: number } };

function simpleHash(value: string): string {
  // HMAC-like hash for search — in prod use ctx.encryption.searchHash()
  const crypto = require('crypto') as typeof import('crypto');
  return crypto.createHash('sha256').update(value.toUpperCase()).digest('hex').substring(0, 64);
}

export async function customerRoutes(
  fastify: FastifyInstance,
  ctxFactory: PlatformContextFactory
): Promise<void> {
  // ── GET /customers ─────────────────────────────────────────────────────────
  fastify.get('/customers', { preHandler: [authenticate, requirePermission(PERMISSIONS.CUSTOMER_VIEW)] }, async (request, reply) => {
    const { tenantId, userId } = (request as unknown as AuthedRequest).auth;
    const ctx = ctxFactory.create({
      tenantId,
      userId,
      correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID(),
    });
    const query = request.query as {
      page?: string;
      size?: string;
      search?: string;
      customerType?: string;
      status?: string;
      city?: string;
    };

    const page = Math.max(0, parseInt(query.page ?? '0', 10));
    const size = Math.min(100, parseInt(query.size ?? '20', 10));

    let whereClause = and(eq(customers.tenantId, tenantId), isNull(customers.deletedAt));
    if (query.customerType) {
      whereClause = and(whereClause, eq(customers.customerType, query.customerType as 'RETAIL' | 'WHOLESALE' | 'B2B' | 'GOVERNMENT' | 'EXPORT'));
    }
    if (query.status) {
      whereClause = and(whereClause, eq(customers.status, query.status as 'ACTIVE' | 'INACTIVE' | 'BLOCKED'));
    }
    if (query.search) {
      whereClause = and(
        whereClause,
        or(
          ilike(customers.displayName, `%${query.search}%`),
          ilike(customers.phone, `%${query.search}%`),
          ilike(customers.email, `%${query.search}%`),
          ilike(customers.customerCode, `%${query.search}%`)
        )
      );
    }

    const rows = await ctx.db.raw
      .select()
      .from(customers)
      .where(whereClause)
      .limit(size)
      .offset(page * size);

    return reply.code(200).send({
      data: { content: rows, totalElements: rows.length, page, size },
    });
  });

  // ── GET /customers/:id ─────────────────────────────────────────────────────
  fastify.get<{ Params: { id: string } }>('/customers/:id', { preHandler: [authenticate, requirePermission(PERMISSIONS.CUSTOMER_VIEW)] }, async (request, reply) => {
    const { tenantId, userId } = (request as unknown as AuthedRequest).auth;
    const ctx = ctxFactory.create({
      tenantId,
      userId,
      correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID(),
    });
    const id = parseInt(request.params.id, 10);

    const [customer] = await ctx.db.raw
      .select()
      .from(customers)
      .where(and(eq(customers.id, id), eq(customers.tenantId, tenantId), isNull(customers.deletedAt)));

    if (!customer) throw new NotFoundError('Customer', id);
    return reply.code(200).send({ data: customer });
  });

  // ── GET /customers/:id/statement ──────────────────────────────────────────
  fastify.get<{ Params: { id: string } }>('/customers/:id/statement', { preHandler: [authenticate, requirePermission(PERMISSIONS.CUSTOMER_VIEW)] }, async (request, reply) => {
    const { tenantId, userId } = (request as unknown as AuthedRequest).auth;
    const ctx = ctxFactory.create({
      tenantId,
      userId,
      correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID(),
    });
    const id = parseInt(request.params.id, 10);
    const [customer] = await ctx.db.raw
      .select()
      .from(customers)
      .where(and(eq(customers.id, id), eq(customers.tenantId, tenantId), isNull(customers.deletedAt)));
    if (!customer) throw new NotFoundError('Customer', id);
    // Phase 5 will supply real invoice + payment data
    return reply.code(200).send({
      data: {
        customerId: id,
        customerName: customer.displayName,
        openingBalance: customer.openingBalance,
        transactions: [],
        closingBalance: customer.openingBalance,
        _projection: { isStale: true, lagMs: 0 },
      },
    });
  });

  // ── GET /customers/:id/outstanding ───────────────────────────────────────
  fastify.get<{ Params: { id: string } }>('/customers/:id/outstanding', { preHandler: [authenticate, requirePermission(PERMISSIONS.CUSTOMER_VIEW)] }, async (request, reply) => {
    const { tenantId, userId } = (request as unknown as AuthedRequest).auth;
    const ctx = ctxFactory.create({
      tenantId,
      userId,
      correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID(),
    });
    const id = parseInt(request.params.id, 10);
    const [customer] = await ctx.db.raw
      .select()
      .from(customers)
      .where(and(eq(customers.id, id), eq(customers.tenantId, tenantId), isNull(customers.deletedAt)));
    if (!customer) throw new NotFoundError('Customer', id);
    return reply.code(200).send({
      data: {
        customerId: id,
        outstandingAmount: customer.openingBalance,
        overdueAmount: '0',
        invoices: [],
      },
    });
  });

  // ── GET /customers/:id/activity — 360° activity timeline (M9.1) ──────────
  // Aggregates invoices, payments, returns, alterations, loyalty txns and interactions
  // into one chronological feed. Cached in Redis for 60s per (customer, page, size).
  fastify.get<{ Params: { id: string } }>('/customers/:id/activity', { preHandler: [authenticate, requirePermission(PERMISSIONS.CUSTOMER_VIEW)] }, async (request, reply) => {
    const { tenantId, userId } = (request as unknown as AuthedRequest).auth;
    const ctx = ctxFactory.create({
      tenantId,
      userId,
      correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID(),
    });
    const id = parseInt(request.params.id, 10);
    const query = request.query as { page?: string; size?: string };
    const page = Math.max(0, parseInt(query.page ?? '0', 10));
    const size = Math.min(100, parseInt(query.size ?? '20', 10));

    const [customer] = await ctx.db.raw
      .select()
      .from(customers)
      .where(and(eq(customers.id, id), eq(customers.tenantId, tenantId), isNull(customers.deletedAt)));
    if (!customer) throw new NotFoundError('Customer', id);

    const cacheKey = `crm:activity:${id}:${page}:${size}`;
    const cached = await ctx.cache.getJson<{ items: unknown[]; total: number }>(cacheKey);
    if (cached) {
      return reply.code(200).send({ data: { customerId: id, page, size, ...cached, _cache: 'HIT' } });
    }

    const { ActivityTimelineService } = await import('../domain/ActivityTimelineService.js');
    const { items, total } = await ActivityTimelineService.build(ctx.db.raw, tenantId, id, page, size);
    await ctx.cache.setJson(cacheKey, { items, total }, 60);

    return reply.code(200).send({ data: { customerId: id, page, size, items, total, _cache: 'MISS' } });
  });

  // ── POST /customers ────────────────────────────────────────────────────────
  fastify.post('/customers', { preHandler: [authenticate, requirePermission(PERMISSIONS.CUSTOMER_CREATE)] }, async (request, reply) => {
    const { tenantId, userId } = (request as unknown as AuthedRequest).auth;
    const ctx = ctxFactory.create({
      tenantId,
      userId,
      correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID(),
    });

    const body = CustomerSchema.safeParse(request.body);
    if (!body.success) throw new ValidationError(body.error.errors.map((e) => e.message).join('; '));

    // Duplicate detection — warn on same mobile
    const [dup] = await ctx.db.raw
      .select()
      .from(customers)
      .where(and(eq(customers.phone, body.data.phone), eq(customers.tenantId, tenantId), isNull(customers.deletedAt)));

    const warnings: string[] = [];
    if (dup) {
      warnings.push(`Another customer with phone ${body.data.phone} already exists (id: ${dup.id})`);
    }

    // Encrypt GSTIN/PAN (simplified: store plaintext here; real impl uses PlatformContext.encryption)
    const gstinHash = body.data.gstin ? simpleHash(body.data.gstin) : null;
    const panHash = body.data.pan ? simpleHash(body.data.pan) : null;

    // Auto-generate customer code
    const customerCode = `CUST${Date.now()}`;

    const [created] = await ctx.db.raw
      .insert(customers)
      .values({
        tenantId,
        createdBy: userId,
        customerCode,
        ...body.data,
        gstin: body.data.gstin || null,
        gstinHash,
        pan: body.data.pan || null,
        panHash,
        creditLimit: String(body.data.creditLimit),
        openingBalance: String(body.data.openingBalance),
      } as unknown as typeof customers.$inferInsert)
      .returning();

    if (!created) throw new Error('Customer creation failed unexpectedly');
    await ctx.events.publish('customer', created.id, 'CUSTOMER_CREATED', created as unknown as Record<string, unknown>);
    await ctx.audit.log({ action: 'CREATE', entityType: 'customer', entityId: created.id, after: created as unknown as Record<string, unknown> });

    return reply.code(201).send({ data: created, warnings });
  });

  // ── PUT /customers/:id ────────────────────────────────────────────────────
  fastify.put<{ Params: { id: string } }>('/customers/:id', { preHandler: [authenticate, requirePermission(PERMISSIONS.CUSTOMER_EDIT)] }, async (request, reply) => {
    const { tenantId, userId } = (request as unknown as AuthedRequest).auth;
    const ctx = ctxFactory.create({
      tenantId,
      userId,
      correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID(),
    });
    const id = parseInt(request.params.id, 10);

    const body = CustomerUpdateSchema.safeParse(request.body);
    if (!body.success) throw new ValidationError(body.error.errors.map((e) => e.message).join('; '));

    const [existing] = await ctx.db.raw
      .select()
      .from(customers)
      .where(and(eq(customers.id, id), eq(customers.tenantId, tenantId), isNull(customers.deletedAt)));

    if (!existing) throw new NotFoundError('Customer', id);

    const gstinHash = body.data.gstin ? simpleHash(body.data.gstin) : null;
    const panHash = body.data.pan ? simpleHash(body.data.pan) : null;

    let updated: typeof customers.$inferSelect | undefined;
    await ctx.db.transaction(async (trx) => {
      await trx.raw.insert(customersHistory).values({
        customerId: id,
        tenantId,
        changedBy: userId,
        changedAt: new Date(),
        previousData: existing as unknown as Record<string, unknown>,
        changeType: 'UPDATE',
      });

      const [row] = await trx.raw
        .update(customers)
        .set({
          ...body.data,
          gstin: body.data.gstin || null,
          gstinHash,
          pan: body.data.pan || null,
          panHash,
          creditLimit: String(body.data.creditLimit),
          openingBalance: String(body.data.openingBalance),
          updatedAt: new Date(),
          version: existing.version + 1,
        } as unknown as Partial<typeof customers.$inferInsert>)
        .where(and(
          eq(customers.id, id),
          eq(customers.tenantId, tenantId),
          eq(customers.version, body.data.version)
        ))
        .returning();

      if (!row) throw new OptimisticLockError('Customer');
      updated = row;
    });

    await ctx.events.publish('customer', id, 'CUSTOMER_UPDATED', updated as unknown as Record<string, unknown>);
    await ctx.audit.log({ action: 'UPDATE', entityType: 'customer', entityId: id, before: existing as unknown as Record<string, unknown>, after: updated as unknown as Record<string, unknown> });

    return reply.code(200).send({ data: updated });
  });

  // ── DELETE /customers/:id — Soft delete ──────────────────────────────────
  fastify.delete<{ Params: { id: string } }>('/customers/:id', { preHandler: [authenticate, requirePermission(PERMISSIONS.CUSTOMER_DELETE)] }, async (request, reply) => {
    const { tenantId, userId } = (request as unknown as AuthedRequest).auth;
    const ctx = ctxFactory.create({
      tenantId,
      userId,
      correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID(),
    });
    const id = parseInt(request.params.id, 10);

    const [existing] = await ctx.db.raw
      .select()
      .from(customers)
      .where(and(eq(customers.id, id), eq(customers.tenantId, tenantId), isNull(customers.deletedAt)));

    if (!existing) throw new NotFoundError('Customer', id);
    // TODO Phase 5: block if customer has outstanding balance

    await ctx.db.raw
      .update(customers)
      .set({ deletedAt: new Date(), deletedBy: userId, status: 'INACTIVE' })
      .where(eq(customers.id, id));

    await ctx.events.publish('customer', id, 'CUSTOMER_DELETED', { id });
    await ctx.audit.log({ action: 'DELETE', entityType: 'customer', entityId: id, before: existing });

    return reply.code(200).send({ data: { message: 'Customer deleted', id } });
  });

  // ── POST /customers/merge — MDG ───────────────────────────────────────────
  fastify.post('/customers/merge', { preHandler: [authenticate, requirePermission(PERMISSIONS.CUSTOMER_MERGE)] }, async (request, reply) => {
    const { tenantId, userId } = (request as unknown as AuthedRequest).auth;
    const ctx = ctxFactory.create({
      tenantId,
      userId,
      correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID(),
    });
    const MergeSchema = z.object({
      sourceId: z.number().int().positive(),
      targetId: z.number().int().positive(),
      keepFields: z.enum(['SOURCE', 'TARGET']).default('TARGET'),
    });
    const body = MergeSchema.safeParse(request.body);
    if (!body.success) throw new ValidationError(body.error.errors.map((e) => e.message).join('; '));
    if (body.data.sourceId === body.data.targetId) {
      throw new BusinessError('SAME_CUSTOMER', 'Source and target cannot be the same customer');
    }

    const [source] = await ctx.db.raw
      .select()
      .from(customers)
      .where(and(eq(customers.id, body.data.sourceId), eq(customers.tenantId, tenantId), isNull(customers.deletedAt)));
    const [target] = await ctx.db.raw
      .select()
      .from(customers)
      .where(and(eq(customers.id, body.data.targetId), eq(customers.tenantId, tenantId), isNull(customers.deletedAt)));

    if (!source) throw new NotFoundError('Customer', body.data.sourceId);
    if (!target) throw new NotFoundError('Customer', body.data.targetId);

    // Archive source before merge
    await ctx.db.raw.insert(customersHistory).values({
      customerId: body.data.sourceId,
      tenantId,
      changedBy: userId,
      previousData: source as unknown as Record<string, unknown>,
      changeType: 'UPDATE',
    });

    // Soft-delete source (all transactions Phase 5+ will re-point to target)
    await ctx.db.raw
      .update(customers)
      .set({ deletedAt: new Date(), deletedBy: userId, status: 'INACTIVE' })
      .where(eq(customers.id, body.data.sourceId));

    await ctx.audit.log({
      action: 'DELETE',
      entityType: 'customer',
      entityId: body.data.sourceId,
      before: source,
      metadata: { mergedIntoId: body.data.targetId },
    });

    return reply.code(200).send({
      data: { message: 'Customers merged', sourceId: body.data.sourceId, targetId: body.data.targetId },
    });
  });

  // ── POST /customers/import — Bulk import ─────────────────────────────────
  fastify.post('/customers/import', { preHandler: [authenticate, requirePermission(PERMISSIONS.CUSTOMER_CREATE)] }, async (_request, reply) => {
    // Delegates to Scheduler Service ImportEngine (Phase 1)
    return reply.code(202).send({
      data: { message: 'Use POST /imports/upload with entityType=CUSTOMER via scheduler-service' },
    });
  });

  // ── GET /customers/export ─────────────────────────────────────────────────
  fastify.get('/customers/export', { preHandler: [authenticate, requirePermission(PERMISSIONS.EXPORT_CUSTOMER_DATA)] }, async (_request, reply) => {
    return reply.code(202).send({
      data: { message: 'Use POST /exports/generate with entityType=CUSTOMER via scheduler-service' },
    });
  });
}
