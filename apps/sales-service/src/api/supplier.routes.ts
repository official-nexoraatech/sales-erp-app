import type { FastifyInstance } from 'fastify';
import type { PlatformContextFactory } from '@erp/sdk';
import { tenantScopedHandler } from '@erp/sdk';
import { suppliers, suppliersHistory, supplierContacts } from '@erp/db';
import { and, eq, isNull, or, ilike, sql } from 'drizzle-orm';
import { z } from 'zod';
import { NotFoundError, OptimisticLockError, ValidationError } from '@erp/types';
import {
  PERMISSIONS,
  OptionalGSTINSchema,
  OptionalPANSchema,
  OptionalIFSCSchema,
  OptionalBankAccountSchema,
} from '@erp/types';
import { createHash } from 'crypto';
import { authenticate } from '../middleware/authenticate.js';
import { requirePermission } from '../middleware/authorize.js';

const SupplierSchema = z.object({
  displayName: z.string().min(2).max(200),
  companyName: z.string().max(300).optional(),
  contactPerson: z.string().max(200).optional(),
  supplierType: z.enum(['DOMESTIC', 'IMPORT', 'MANUFACTURER', 'AGENT']).default('DOMESTIC'),
  gstin: OptionalGSTINSchema,
  // GST-registered status — drives RCM self-assessment on GRNs from this supplier
  // (see apps/purchase-service/src/domain/GRNService.ts). Previously missing from this
  // schema entirely, so it was silently stripped from every create/update request and the
  // DB column stayed at its `true` default forever, making RCM impossible to trigger.
  isRegistered: z.boolean().default(true),
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
  // Was entirely absent from this schema — the DB column and PO-approval enforcement
  // (apps/purchase-service/src/domain/PurchaseOrderService.ts) both existed, but with no
  // way to set a non-zero limit through create/update, every supplier's credit limit
  // stayed at its 0/disabled default forever, making the enforcement code unreachable.
  creditLimit: z.number().min(0).default(0),
  creditLimitEnabled: z.boolean().default(false),
  openingBalance: z.number().min(0).default(0),
  openingBalanceType: z.enum(['DEBIT', 'CREDIT']).default('CREDIT'),
  // Was entirely absent — the DB column/enum (incl. BLACKLISTED) and suppliersHistory's
  // 'BLOCK' changeType both existed, but with no way to set status via create/update, the
  // only API path that ever touched it was DELETE (which force-sets INACTIVE). A supplier
  // could never be blacklisted, and a delete-then-recreate was the only way back to ACTIVE.
  status: z.enum(['ACTIVE', 'INACTIVE', 'BLACKLISTED']).default('ACTIVE'),
  notes: z.string().max(5000).optional(),
  tags: z.array(z.string()).default([]),
  // Purchase audit 2026-07-21 gap-fix: manual vendor rating, persisted per supplier — see
  // packages/db-client/src/schema/master.ts's rating column comment.
  rating: z.number().min(1).max(5).optional(),
  ratingNotes: z.string().max(2000).optional(),
});

const SupplierUpdateSchema = SupplierSchema.extend({
  version: z.number().int().min(0),
});

const SupplierContactSchema = z.object({
  name: z.string().min(1).max(200),
  designation: z.string().max(100).optional(),
  phone: z.string().max(20).optional(),
  email: z.string().email().max(255).optional().or(z.literal('')),
  isPrimary: z.boolean().default(false),
  notes: z.string().max(2000).optional(),
});

// Phase 9 GUC-per-request rollout — migrated 2026-08-21. No external I/O anywhere in this file —
// pure CRUD. ctx.db.transaction() calls (PUT /suppliers/:id, contact create/update) become
// savepoints of the outer transaction once wrapped, same as everywhere else in this rollout.
export async function supplierRoutes(
  fastify: FastifyInstance,
  ctxFactory: PlatformContextFactory
): Promise<void> {
  // ── GET /suppliers ─────────────────────────────────────────────────────────
  fastify.get(
    '/suppliers',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.SUPPLIER_VIEW)] },
    tenantScopedHandler(ctxFactory, async (request, reply, ctx) => {
      const query = request.query as {
        page?: string;
        size?: string;
        search?: string;
        status?: string;
      };

      const page = Math.max(0, parseInt(query.page ?? '0', 10));
      const size = Math.min(100, parseInt(query.size ?? '20', 10));

      let whereClause = and(
        eq(suppliers.tenantId, ctx.tenant.tenantId),
        isNull(suppliers.deletedAt)
      );
      if (query.status) {
        whereClause = and(
          whereClause,
          eq(suppliers.status, query.status as 'ACTIVE' | 'INACTIVE' | 'BLACKLISTED')
        );
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

      const rows = await ctx.db.raw
        .select()
        .from(suppliers)
        .where(whereClause)
        .limit(size)
        .offset(page * size);
      const [countRow] = await ctx.db.raw
        .select({ count: sql<number>`count(*)::int` })
        .from(suppliers)
        .where(whereClause);
      return reply
        .code(200)
        .send({ data: { content: rows, totalElements: countRow?.count ?? 0, page, size } });
    })
  );

  // ── GET /suppliers/:id ─────────────────────────────────────────────────────
  fastify.get(
    '/suppliers/:id',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.SUPPLIER_VIEW)] },
    tenantScopedHandler(ctxFactory, async (request, reply, ctx) => {
      const { id: idParam } = request.params as { id: string };
      const id = parseInt(idParam, 10);
      const [supplier] = await ctx.db.raw
        .select()
        .from(suppliers)
        .where(
          and(
            eq(suppliers.id, id),
            eq(suppliers.tenantId, ctx.tenant.tenantId),
            isNull(suppliers.deletedAt)
          )
        );
      if (!supplier) throw new NotFoundError('Supplier', id);
      return reply.code(200).send({ data: supplier });
    })
  );

  // ── GET /suppliers/:id/statement ──────────────────────────────────────────
  fastify.get(
    '/suppliers/:id/statement',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.SUPPLIER_VIEW)] },
    tenantScopedHandler(ctxFactory, async (request, reply, ctx) => {
      const { id: idParam } = request.params as { id: string };
      const id = parseInt(idParam, 10);
      const [supplier] = await ctx.db.raw
        .select()
        .from(suppliers)
        .where(
          and(
            eq(suppliers.id, id),
            eq(suppliers.tenantId, ctx.tenant.tenantId),
            isNull(suppliers.deletedAt)
          )
        );
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
    })
  );

  // ── GET /suppliers/:id/outstanding ────────────────────────────────────────
  fastify.get(
    '/suppliers/:id/outstanding',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.SUPPLIER_VIEW)] },
    tenantScopedHandler(ctxFactory, async (request, reply, ctx) => {
      const { id: idParam } = request.params as { id: string };
      const id = parseInt(idParam, 10);
      const [supplier] = await ctx.db.raw
        .select()
        .from(suppliers)
        .where(
          and(
            eq(suppliers.id, id),
            eq(suppliers.tenantId, ctx.tenant.tenantId),
            isNull(suppliers.deletedAt)
          )
        );
      if (!supplier) throw new NotFoundError('Supplier', id);
      return reply.code(200).send({
        data: { supplierId: id, outstandingAmount: supplier.openingBalance, bills: [] },
      });
    })
  );

  // ── POST /suppliers ────────────────────────────────────────────────────────
  fastify.post(
    '/suppliers',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.SUPPLIER_CREATE)] },
    tenantScopedHandler(ctxFactory, async (request, reply, ctx) => {
      const body = SupplierSchema.safeParse(request.body);
      if (!body.success)
        throw new ValidationError(body.error.errors.map((e) => e.message).join('; '));

      const supplierCode = `SUP${Date.now()}`;
      // Encrypt bank account (simplified: SHA-256 hash for search)
      const bankAccountNoHash = body.data.bankAccountNo
        ? createHash('sha256').update(body.data.bankAccountNo).digest('hex').substring(0, 64)
        : null;

      const [created] = await ctx.db.raw
        .insert(suppliers)
        .values({
          tenantId: ctx.tenant.tenantId,
          createdBy: ctx.tenant.userId,
          supplierCode,
          ...body.data,
          bankAccountNo: body.data.bankAccountNo || null,
          bankAccountNoHash,
          openingBalance: String(body.data.openingBalance),
          creditLimit: String(body.data.creditLimit),
          rating: body.data.rating !== undefined ? String(body.data.rating) : null,
        } as unknown as typeof suppliers.$inferInsert)
        .returning();

      if (!created) throw new Error('Supplier creation failed unexpectedly');
      await ctx.events.publish(
        'supplier',
        created.id,
        'SUPPLIER_CREATED',
        created as unknown as Record<string, unknown>
      );
      await ctx.audit.log({
        action: 'CREATE',
        entityType: 'supplier',
        entityId: created.id,
        after: created as unknown as Record<string, unknown>,
      });

      return reply.code(201).send({ data: created });
    })
  );

  // ── PUT /suppliers/:id ────────────────────────────────────────────────────
  fastify.put(
    '/suppliers/:id',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.SUPPLIER_EDIT)] },
    tenantScopedHandler(ctxFactory, async (request, reply, ctx) => {
      const { id: idParam } = request.params as { id: string };
      const id = parseInt(idParam, 10);

      const body = SupplierUpdateSchema.safeParse(request.body);
      if (!body.success)
        throw new ValidationError(body.error.errors.map((e) => e.message).join('; '));

      const [existing] = await ctx.db.raw
        .select()
        .from(suppliers)
        .where(
          and(
            eq(suppliers.id, id),
            eq(suppliers.tenantId, ctx.tenant.tenantId),
            isNull(suppliers.deletedAt)
          )
        );

      if (!existing) throw new NotFoundError('Supplier', id);

      const bankAccountNoHash = body.data.bankAccountNo
        ? createHash('sha256').update(body.data.bankAccountNo).digest('hex').substring(0, 64)
        : null;

      let updated: typeof suppliers.$inferSelect | undefined;
      await ctx.db.transaction(async (trx) => {
        await trx.raw.insert(suppliersHistory).values({
          supplierId: id,
          tenantId: ctx.tenant.tenantId,
          changedBy: ctx.tenant.userId,
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
            creditLimit: String(body.data.creditLimit),
            rating: body.data.rating !== undefined ? String(body.data.rating) : null,
            updatedAt: new Date(),
            version: existing.version + 1,
          } as unknown as Partial<typeof suppliers.$inferInsert>)
          .where(
            and(
              eq(suppliers.id, id),
              eq(suppliers.tenantId, ctx.tenant.tenantId),
              eq(suppliers.version, body.data.version)
            )
          )
          .returning();

        if (!row) throw new OptimisticLockError('Supplier');
        updated = row;
      });

      await ctx.events.publish(
        'supplier',
        id,
        'SUPPLIER_UPDATED',
        updated as unknown as Record<string, unknown>
      );
      await ctx.audit.log({
        action: 'UPDATE',
        entityType: 'supplier',
        entityId: id,
        before: existing as unknown as Record<string, unknown>,
        after: updated as unknown as Record<string, unknown>,
      });

      return reply.code(200).send({ data: updated });
    })
  );

  // ── DELETE /suppliers/:id ─────────────────────────────────────────────────
  fastify.delete(
    '/suppliers/:id',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.SUPPLIER_DELETE)] },
    tenantScopedHandler(ctxFactory, async (request, reply, ctx) => {
      const { id: idParam } = request.params as { id: string };
      const id = parseInt(idParam, 10);

      const [existing] = await ctx.db.raw
        .select()
        .from(suppliers)
        .where(
          and(
            eq(suppliers.id, id),
            eq(suppliers.tenantId, ctx.tenant.tenantId),
            isNull(suppliers.deletedAt)
          )
        );

      if (!existing) throw new NotFoundError('Supplier', id);

      await ctx.db.raw
        .update(suppliers)
        .set({ deletedAt: new Date(), deletedBy: ctx.tenant.userId, status: 'INACTIVE' })
        .where(eq(suppliers.id, id));

      await ctx.events.publish('supplier', id, 'SUPPLIER_DELETED', { id });
      await ctx.audit.log({
        action: 'DELETE',
        entityType: 'supplier',
        entityId: id,
        before: existing,
      });

      return reply.code(200).send({ data: { message: 'Supplier deleted', id } });
    })
  );

  // ── Supplier Contacts (purchase-module enhancement 2026-07-21) ────────────
  // A supplier only ever had one free-text `contactPerson` field — no way to record more
  // than one real point of contact (e.g. a sales rep vs an accounts/finance contact).
  fastify.get(
    '/suppliers/:id/contacts',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.SUPPLIER_VIEW)] },
    tenantScopedHandler(ctxFactory, async (request, reply, ctx) => {
      const { id: idParam } = request.params as { id: string };
      const supplierId = parseInt(idParam, 10);
      const rows = await ctx.db.raw
        .select()
        .from(supplierContacts)
        .where(
          and(
            eq(supplierContacts.supplierId, supplierId),
            eq(supplierContacts.tenantId, ctx.tenant.tenantId)
          )
        )
        .orderBy(sql`${supplierContacts.isPrimary} DESC, ${supplierContacts.createdAt} ASC`);
      return reply.code(200).send({ data: { content: rows, totalElements: rows.length } });
    })
  );

  fastify.post(
    '/suppliers/:id/contacts',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.SUPPLIER_EDIT)] },
    tenantScopedHandler(ctxFactory, async (request, reply, ctx) => {
      const { id: idParam } = request.params as { id: string };
      const supplierId = parseInt(idParam, 10);

      const [supplier] = await ctx.db.raw
        .select({ id: suppliers.id })
        .from(suppliers)
        .where(
          and(
            eq(suppliers.id, supplierId),
            eq(suppliers.tenantId, ctx.tenant.tenantId),
            isNull(suppliers.deletedAt)
          )
        );
      if (!supplier) throw new NotFoundError('Supplier', supplierId);

      const body = SupplierContactSchema.safeParse(request.body);
      if (!body.success)
        throw new ValidationError(body.error.errors.map((e) => e.message).join('; '));

      const [created] = await ctx.db.transaction(async (trx) => {
        // Only one contact can be primary at a time — clear any existing primary first.
        if (body.data.isPrimary) {
          await trx.raw
            .update(supplierContacts)
            .set({ isPrimary: false, updatedAt: new Date() })
            .where(
              and(
                eq(supplierContacts.supplierId, supplierId),
                eq(supplierContacts.tenantId, ctx.tenant.tenantId)
              )
            );
        }
        return trx.raw
          .insert(supplierContacts)
          .values({
            tenantId: ctx.tenant.tenantId,
            supplierId,
            name: body.data.name,
            designation: body.data.designation,
            phone: body.data.phone,
            email: body.data.email || undefined,
            isPrimary: body.data.isPrimary,
            notes: body.data.notes,
            createdBy: ctx.tenant.userId,
          })
          .returning();
      });

      if (!created) throw new Error('Supplier contact creation failed unexpectedly');
      return reply.code(201).send({ data: created });
    })
  );

  fastify.put(
    '/suppliers/:id/contacts/:contactId',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.SUPPLIER_EDIT)] },
    tenantScopedHandler(ctxFactory, async (request, reply, ctx) => {
      const { id: idParam, contactId: contactIdParam } = request.params as {
        id: string;
        contactId: string;
      };
      const supplierId = parseInt(idParam, 10);
      const contactId = parseInt(contactIdParam, 10);

      const [existing] = await ctx.db.raw
        .select()
        .from(supplierContacts)
        .where(
          and(
            eq(supplierContacts.id, contactId),
            eq(supplierContacts.supplierId, supplierId),
            eq(supplierContacts.tenantId, ctx.tenant.tenantId)
          )
        );
      if (!existing) throw new NotFoundError('SupplierContact', contactId);

      const body = SupplierContactSchema.safeParse(request.body);
      if (!body.success)
        throw new ValidationError(body.error.errors.map((e) => e.message).join('; '));

      const [updated] = await ctx.db.transaction(async (trx) => {
        if (body.data.isPrimary) {
          await trx.raw
            .update(supplierContacts)
            .set({ isPrimary: false, updatedAt: new Date() })
            .where(
              and(
                eq(supplierContacts.supplierId, supplierId),
                eq(supplierContacts.tenantId, ctx.tenant.tenantId)
              )
            );
        }
        return trx.raw
          .update(supplierContacts)
          .set({
            name: body.data.name,
            designation: body.data.designation,
            phone: body.data.phone,
            email: body.data.email || undefined,
            isPrimary: body.data.isPrimary,
            notes: body.data.notes,
            updatedAt: new Date(),
          })
          .where(eq(supplierContacts.id, contactId))
          .returning();
      });

      return reply.code(200).send({ data: updated });
    })
  );

  fastify.delete(
    '/suppliers/:id/contacts/:contactId',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.SUPPLIER_EDIT)] },
    tenantScopedHandler(ctxFactory, async (request, reply, ctx) => {
      const { id: idParam, contactId: contactIdParam } = request.params as {
        id: string;
        contactId: string;
      };
      const supplierId = parseInt(idParam, 10);
      const contactId = parseInt(contactIdParam, 10);

      const [existing] = await ctx.db.raw
        .select()
        .from(supplierContacts)
        .where(
          and(
            eq(supplierContacts.id, contactId),
            eq(supplierContacts.supplierId, supplierId),
            eq(supplierContacts.tenantId, ctx.tenant.tenantId)
          )
        );
      if (!existing) throw new NotFoundError('SupplierContact', contactId);

      await ctx.db.raw.delete(supplierContacts).where(eq(supplierContacts.id, contactId));
      return reply.code(200).send({ data: { message: 'Contact deleted', id: contactId } });
    })
  );

  fastify.post(
    '/suppliers/import',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.SUPPLIER_CREATE)] },
    async (_request, reply) => {
      return reply.code(202).send({
        data: {
          message: 'Use POST /imports/upload with entityType=SUPPLIER via scheduler-service',
        },
      });
    }
  );

  fastify.get(
    '/suppliers/export',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.SUPPLIER_VIEW)] },
    async (_request, reply) => {
      return reply.code(202).send({
        data: {
          message: 'Use POST /exports/generate with entityType=SUPPLIER via scheduler-service',
        },
      });
    }
  );
}
