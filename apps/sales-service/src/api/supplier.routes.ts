import type { FastifyInstance } from 'fastify';
import type { PlatformContextFactory } from '@erp/sdk';
import { suppliers, suppliersHistory } from '@erp/db';
import { and, eq, isNull, or, ilike, sql } from 'drizzle-orm';
import { z } from 'zod';
import { NotFoundError, OptimisticLockError, ValidationError } from '@erp/types';
import { PERMISSIONS, OptionalGSTINSchema, OptionalPANSchema, OptionalIFSCSchema, OptionalBankAccountSchema } from '@erp/types';
import { createHash } from 'crypto';
import { authenticate } from '../middleware/authenticate.js';
import { requirePermission } from '../middleware/authorize.js';

const SupplierSchema = z.object({
  displayName: z.string().min(2).max(200),
  companyName: z.string().max(300).optional(),
  contactPerson: z.string().max(200).optional(),
  supplierType: z.enum(['DOMESTIC', 'IMPORT', 'MANUFACTURER', 'AGENT']).default('DOMESTIC'),
  gstin: OptionalGSTINSchema,
  pan: OptionalPANSchema,
  phone: z.string().min(10).max(20),
  altPhone: z.string().max(20).optional(),
  email: z.string().email().max(255).optional().or(z.literal('')),
  billingAddress: z
    .object({
      line1: z.string().min(1),
      line2: z.string().optional(),
      city: z.string().min(1),
      state: z.string().min(1),
      stateCode: z.string().min(2).max(2),
      pincode: z.string().regex(/^[1-9][0-9]{5}$/, 'Invalid pincode'),
      country: z.string().default('India'),
    })
    .optional(),
  // Bank — encrypted before storage; simplified here
  bankAccountNo: OptionalBankAccountSchema,
  bankName: z.string().max(200).optional(),
  bankIfsc: OptionalIFSCSchema,
  bankBranch: z.string().max(200).optional(),
  branchId: z.number().int().positive(),
  creditDays: z.number().int().min(0).default(0),
  openingBalance: z.number().min(0).default(0),
  openingBalanceType: z.enum(['DEBIT', 'CREDIT']).default('CREDIT'),
  notes: z.string().max(5000).optional(),
  tags: z.array(z.string()).default([]),
});

const SupplierUpdateSchema = SupplierSchema.extend({
  version: z.number().int().min(0),
});

type AuthedRequest = { auth: { tenantId: number; userId: number } };

export async function supplierRoutes(
  fastify: FastifyInstance,
  ctxFactory: PlatformContextFactory
): Promise<void> {
  // ── GET /suppliers ─────────────────────────────────────────────────────────
  fastify.get('/suppliers', { preHandler: [authenticate, requirePermission(PERMISSIONS.SUPPLIER_VIEW)] }, async (request, reply) => {
    const { tenantId, userId } = (request as unknown as AuthedRequest).auth;
    const ctx = ctxFactory.create({
      tenantId,
      userId,
      correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID(),
    });
    const query = request.query as { page?: string; size?: string; search?: string; status?: string };

    const page = Math.max(0, parseInt(query.page ?? '0', 10));
    const size = Math.min(100, parseInt(query.size ?? '20', 10));

    let whereClause = and(eq(suppliers.tenantId, tenantId), isNull(suppliers.deletedAt));
    if (query.status) {
      whereClause = and(whereClause, eq(suppliers.status, query.status as 'ACTIVE' | 'INACTIVE' | 'BLACKLISTED'));
    }
    if (query.search) {
      whereClause = and(
        whereClause,
        or(
          ilike(suppliers.displayName, `%${query.search}%`),
          ilike(suppliers.phone, `%${query.search}%`),
          ilike(suppliers.gstin, `%${query.search}%`)
        )
      );
    }

    const rows = await ctx.db.raw.select().from(suppliers).where(whereClause).limit(size).offset(page * size);
    const [countRow] = await ctx.db.raw.select({ count: sql<number>`count(*)::int` }).from(suppliers).where(whereClause);
    return reply.code(200).send({ data: { content: rows, totalElements: countRow?.count ?? 0, page, size } });
  });

  // ── GET /suppliers/:id ─────────────────────────────────────────────────────
  fastify.get<{ Params: { id: string } }>('/suppliers/:id', { preHandler: [authenticate, requirePermission(PERMISSIONS.SUPPLIER_VIEW)] }, async (request, reply) => {
    const { tenantId, userId } = (request as unknown as AuthedRequest).auth;
    const ctx = ctxFactory.create({
      tenantId,
      userId,
      correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID(),
    });
    const id = parseInt(request.params.id, 10);
    const [supplier] = await ctx.db.raw
      .select()
      .from(suppliers)
      .where(and(eq(suppliers.id, id), eq(suppliers.tenantId, tenantId), isNull(suppliers.deletedAt)));
    if (!supplier) throw new NotFoundError('Supplier', id);
    return reply.code(200).send({ data: supplier });
  });

  // ── GET /suppliers/:id/statement ──────────────────────────────────────────
  fastify.get<{ Params: { id: string } }>('/suppliers/:id/statement', { preHandler: [authenticate, requirePermission(PERMISSIONS.SUPPLIER_VIEW)] }, async (request, reply) => {
    const { tenantId, userId } = (request as unknown as AuthedRequest).auth;
    const ctx = ctxFactory.create({
      tenantId,
      userId,
      correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID(),
    });
    const id = parseInt(request.params.id, 10);
    const [supplier] = await ctx.db.raw
      .select()
      .from(suppliers)
      .where(and(eq(suppliers.id, id), eq(suppliers.tenantId, tenantId), isNull(suppliers.deletedAt)));
    if (!supplier) throw new NotFoundError('Supplier', id);
    return reply.code(200).send({
      data: {
        supplierId: id,
        supplierName: supplier.displayName,
        openingBalance: supplier.openingBalance,
        transactions: [],
        closingBalance: supplier.openingBalance,
      },
    });
  });

  // ── GET /suppliers/:id/outstanding ────────────────────────────────────────
  fastify.get<{ Params: { id: string } }>('/suppliers/:id/outstanding', { preHandler: [authenticate, requirePermission(PERMISSIONS.SUPPLIER_VIEW)] }, async (request, reply) => {
    const { tenantId, userId } = (request as unknown as AuthedRequest).auth;
    const ctx = ctxFactory.create({
      tenantId,
      userId,
      correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID(),
    });
    const id = parseInt(request.params.id, 10);
    const [supplier] = await ctx.db.raw
      .select()
      .from(suppliers)
      .where(and(eq(suppliers.id, id), eq(suppliers.tenantId, tenantId), isNull(suppliers.deletedAt)));
    if (!supplier) throw new NotFoundError('Supplier', id);
    return reply.code(200).send({
      data: { supplierId: id, outstandingAmount: supplier.openingBalance, bills: [] },
    });
  });

  // ── POST /suppliers ────────────────────────────────────────────────────────
  fastify.post('/suppliers', { preHandler: [authenticate, requirePermission(PERMISSIONS.SUPPLIER_CREATE)] }, async (request, reply) => {
    const { tenantId, userId } = (request as unknown as AuthedRequest).auth;
    const ctx = ctxFactory.create({
      tenantId,
      userId,
      correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID(),
    });

    const body = SupplierSchema.safeParse(request.body);
    if (!body.success) throw new ValidationError(body.error.errors.map((e) => e.message).join('; '));

    const supplierCode = `SUP${Date.now()}`;
    // Encrypt bank account (simplified: SHA-256 hash for search)
    const bankAccountNoHash = body.data.bankAccountNo
      ? createHash('sha256').update(body.data.bankAccountNo).digest('hex').substring(0, 64)
      : null;

    const [created] = await ctx.db.raw
      .insert(suppliers)
      .values({
        tenantId,
        createdBy: userId,
        supplierCode,
        ...body.data,
        bankAccountNo: body.data.bankAccountNo || null,
        bankAccountNoHash,
        openingBalance: String(body.data.openingBalance),
      } as unknown as typeof suppliers.$inferInsert)
      .returning();

    if (!created) throw new Error('Supplier creation failed unexpectedly');
    await ctx.events.publish('supplier', created.id, 'SUPPLIER_CREATED', created as unknown as Record<string, unknown>);
    await ctx.audit.log({ action: 'CREATE', entityType: 'supplier', entityId: created.id, after: created as unknown as Record<string, unknown> });

    return reply.code(201).send({ data: created });
  });

  // ── PUT /suppliers/:id ────────────────────────────────────────────────────
  fastify.put<{ Params: { id: string } }>('/suppliers/:id', { preHandler: [authenticate, requirePermission(PERMISSIONS.SUPPLIER_EDIT)] }, async (request, reply) => {
    const { tenantId, userId } = (request as unknown as AuthedRequest).auth;
    const ctx = ctxFactory.create({
      tenantId,
      userId,
      correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID(),
    });
    const id = parseInt(request.params.id, 10);

    const body = SupplierUpdateSchema.safeParse(request.body);
    if (!body.success) throw new ValidationError(body.error.errors.map((e) => e.message).join('; '));

    const [existing] = await ctx.db.raw
      .select()
      .from(suppliers)
      .where(and(eq(suppliers.id, id), eq(suppliers.tenantId, tenantId), isNull(suppliers.deletedAt)));

    if (!existing) throw new NotFoundError('Supplier', id);

    const bankAccountNoHash = body.data.bankAccountNo
      ? createHash('sha256').update(body.data.bankAccountNo).digest('hex').substring(0, 64)
      : null;

    let updated: typeof suppliers.$inferSelect | undefined;
    await ctx.db.transaction(async (trx) => {
      await trx.raw.insert(suppliersHistory).values({
        supplierId: id,
        tenantId,
        changedBy: userId,
        changedAt: new Date(),
        previousData: existing as unknown as Record<string, unknown>,
        changeType: 'UPDATE',
      });

      const [row] = await trx.raw
        .update(suppliers)
        .set({
          ...body.data,
          bankAccountNo: body.data.bankAccountNo || null,
          bankAccountNoHash,
          openingBalance: String(body.data.openingBalance),
          updatedAt: new Date(),
          version: existing.version + 1,
        } as unknown as Partial<typeof suppliers.$inferInsert>)
        .where(and(
          eq(suppliers.id, id),
          eq(suppliers.tenantId, tenantId),
          eq(suppliers.version, body.data.version)
        ))
        .returning();

      if (!row) throw new OptimisticLockError('Supplier');
      updated = row;
    });

    await ctx.events.publish('supplier', id, 'SUPPLIER_UPDATED', updated as unknown as Record<string, unknown>);
    await ctx.audit.log({ action: 'UPDATE', entityType: 'supplier', entityId: id, before: existing as unknown as Record<string, unknown>, after: updated as unknown as Record<string, unknown> });

    return reply.code(200).send({ data: updated });
  });

  // ── DELETE /suppliers/:id ─────────────────────────────────────────────────
  fastify.delete<{ Params: { id: string } }>('/suppliers/:id', { preHandler: [authenticate, requirePermission(PERMISSIONS.SUPPLIER_DELETE)] }, async (request, reply) => {
    const { tenantId, userId } = (request as unknown as AuthedRequest).auth;
    const ctx = ctxFactory.create({
      tenantId,
      userId,
      correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID(),
    });
    const id = parseInt(request.params.id, 10);

    const [existing] = await ctx.db.raw
      .select()
      .from(suppliers)
      .where(and(eq(suppliers.id, id), eq(suppliers.tenantId, tenantId), isNull(suppliers.deletedAt)));

    if (!existing) throw new NotFoundError('Supplier', id);

    await ctx.db.raw
      .update(suppliers)
      .set({ deletedAt: new Date(), deletedBy: userId, status: 'INACTIVE' })
      .where(eq(suppliers.id, id));

    await ctx.events.publish('supplier', id, 'SUPPLIER_DELETED', { id });
    await ctx.audit.log({ action: 'DELETE', entityType: 'supplier', entityId: id, before: existing });

    return reply.code(200).send({ data: { message: 'Supplier deleted', id } });
  });

  fastify.post('/suppliers/import', { preHandler: [authenticate, requirePermission(PERMISSIONS.SUPPLIER_CREATE)] }, async (_request, reply) => {
    return reply.code(202).send({
      data: { message: 'Use POST /imports/upload with entityType=SUPPLIER via scheduler-service' },
    });
  });

  fastify.get('/suppliers/export', { preHandler: [authenticate, requirePermission(PERMISSIONS.SUPPLIER_VIEW)] }, async (_request, reply) => {
    return reply.code(202).send({
      data: { message: 'Use POST /exports/generate with entityType=SUPPLIER via scheduler-service' },
    });
  });
}
