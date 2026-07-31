import type { FastifyInstance } from 'fastify';
import { createHash } from 'crypto';
import type { PlatformContextFactory } from '@erp/sdk';
import { crmAccounts, crmAccountContacts } from '@erp/db';
import { and, eq, ilike, isNull, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { BusinessError, NotFoundError, OptimisticLockError, ValidationError } from '@erp/types';
import { PERMISSIONS, OptionalGSTINSchema } from '@erp/types';
import { authenticate } from '../middleware/authenticate.js';
import { requirePermission } from '../middleware/authorize.js';
import { AccountService } from '../domain/AccountService.js';

// CRM-ROADMAP Phase 1, Feature 1 — Contact & Account Hierarchy. `crm_accounts` models the
// company/entity a B2B customer belongs to; `customers` stays the transactional record.

const AddressSchema = z.object({
  line1: z.string().min(1),
  line2: z.string().optional(),
  city: z.string().min(1),
  state: z.string().min(1),
  stateCode: z.string().min(2).max(2),
  pincode: z.string().regex(/^\d{6}$/),
  country: z.string().default('India'),
});

const AccountSchema = z.object({
  name: z.string().min(2).max(300),
  accountType: z
    .enum(['B2B', 'WHOLESALE', 'DISTRIBUTOR', 'CORPORATE', 'INDIVIDUAL'])
    .default('INDIVIDUAL'),
  gstin: OptionalGSTINSchema,
  primaryPhone: z.string().max(20).optional(),
  primaryEmail: z.string().email().max(255).optional().or(z.literal('')),
  billingAddress: AddressSchema.optional(),
  notes: z.string().max(5000).optional(),
});

const AccountUpdateSchema = AccountSchema.extend({ version: z.number().int().min(0) });

const ContactSchema = z.object({
  name: z.string().min(1).max(200),
  role: z.enum(['BILLING', 'DECISION_MAKER', 'SHIPPING', 'PRIMARY', 'OTHER']).default('OTHER'),
  email: z.string().email().max(255).optional().or(z.literal('')),
  phone: z.string().max(20).optional(),
  isPrimary: z.boolean().default(false),
  notes: z.string().max(2000).optional(),
});

const MergeSchema = z.object({
  sourceId: z.number().int().positive(),
  targetId: z.number().int().positive(),
});

type AuthedRequest = { auth: { tenantId: number; userId: number } };

function simpleHash(value: string): string {
  // Mirrors customer.routes.ts's simpleHash — real impl uses PlatformContext.encryption.
  return createHash('sha256').update(value.toUpperCase()).digest('hex').substring(0, 64);
}

export async function accountRoutes(
  fastify: FastifyInstance,
  ctxFactory: PlatformContextFactory
): Promise<void> {
  // ── GET /accounts ──────────────────────────────────────────────────────────
  fastify.get(
    '/accounts',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.CRM_ACCOUNT_VIEW)] },
    async (request, reply) => {
      const { tenantId, userId } = (request as unknown as AuthedRequest).auth;
      const ctx = ctxFactory.create({
        tenantId,
        userId,
        correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID(),
      });
      const query = request.query as { page?: string; size?: string; search?: string };
      const page = Math.max(0, parseInt(query.page ?? '0', 10));
      const size = Math.min(100, parseInt(query.size ?? '20', 10));

      let whereClause = and(
        eq(crmAccounts.tenantId, tenantId),
        isNull(crmAccounts.mergedIntoAccountId)
      );
      if (query.search) {
        whereClause = and(
          whereClause,
          or(
            ilike(crmAccounts.name, `%${query.search}%`),
            ilike(crmAccounts.primaryPhone, `%${query.search}%`),
            ilike(crmAccounts.primaryEmail, `%${query.search}%`)
          )
        );
      }

      const rows = await ctx.db.raw
        .select()
        .from(crmAccounts)
        .where(whereClause)
        .limit(size)
        .offset(page * size);
      const [countRow] = await ctx.db.raw
        .select({ count: sql<number>`count(*)::int` })
        .from(crmAccounts)
        .where(whereClause);

      return reply.code(200).send({
        data: { content: rows, totalElements: countRow?.count ?? 0, page, size },
      });
    }
  );

  // ── GET /accounts/dedupe-check ─────────────────────────────────────────────
  // Debounced, indexed-lookup duplicate suggestion — called before submitting the create
  // form, not a full-scan fuzzy match at write time (07-PERFORMANCE-PLAN.md §2).
  fastify.get(
    '/accounts/dedupe-check',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.CRM_ACCOUNT_VIEW)] },
    async (request, reply) => {
      const { tenantId, userId } = (request as unknown as AuthedRequest).auth;
      const ctx = ctxFactory.create({
        tenantId,
        userId,
        correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID(),
      });
      const query = request.query as {
        name?: string;
        gstin?: string;
        phone?: string;
        email?: string;
      };
      const gstinHash = query.gstin ? simpleHash(query.gstin) : null;

      const candidates = await AccountService.findDuplicateCandidates(
        ctx.db.raw,
        tenantId,
        { name: query.name, gstin: query.gstin, phone: query.phone, email: query.email },
        gstinHash
      );

      return reply.code(200).send({ data: { content: candidates } });
    }
  );

  // ── GET /accounts/:id ───────────────────────────────────────────────────────
  fastify.get<{ Params: { id: string } }>(
    '/accounts/:id',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.CRM_ACCOUNT_VIEW)] },
    async (request, reply) => {
      const { tenantId, userId } = (request as unknown as AuthedRequest).auth;
      const ctx = ctxFactory.create({
        tenantId,
        userId,
        correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID(),
      });
      const id = parseInt(request.params.id, 10);
      const [account] = await ctx.db.raw
        .select()
        .from(crmAccounts)
        .where(and(eq(crmAccounts.id, id), eq(crmAccounts.tenantId, tenantId)));
      if (!account) throw new NotFoundError('CrmAccount', id);
      return reply.code(200).send({ data: account });
    }
  );

  // ── POST /accounts ──────────────────────────────────────────────────────────
  fastify.post(
    '/accounts',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.CRM_ACCOUNT_CREATE)] },
    async (request, reply) => {
      const { tenantId, userId } = (request as unknown as AuthedRequest).auth;
      const ctx = ctxFactory.create({
        tenantId,
        userId,
        correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID(),
      });
      const body = AccountSchema.safeParse(request.body);
      if (!body.success)
        throw new ValidationError(body.error.errors.map((e) => e.message).join('; '));

      const gstinHash = body.data.gstin ? simpleHash(body.data.gstin) : null;
      const candidates = await AccountService.findDuplicateCandidates(
        ctx.db.raw,
        tenantId,
        {
          name: body.data.name,
          gstin: body.data.gstin,
          phone: body.data.primaryPhone,
          email: body.data.primaryEmail,
        },
        gstinHash
      );

      const [created] = await ctx.db.raw
        .insert(crmAccounts)
        .values({
          tenantId,
          createdBy: userId,
          name: body.data.name,
          accountType: body.data.accountType,
          gstin: body.data.gstin || null,
          gstinHash,
          primaryPhone: body.data.primaryPhone,
          primaryEmail: body.data.primaryEmail || undefined,
          billingAddress: body.data.billingAddress,
          notes: body.data.notes,
        } as unknown as typeof crmAccounts.$inferInsert)
        .returning();
      if (!created) throw new Error('Account creation failed unexpectedly');

      await ctx.audit.log({
        action: 'CREATE',
        entityType: 'crm_account',
        entityId: created.id,
        after: created as unknown as Record<string, unknown>,
      });
      await ctx.events.publish(
        'crm_account',
        created.id,
        'CRM_ACCOUNT_CREATED',
        created as unknown as Record<string, unknown>
      );

      return reply.code(201).send({
        data: created,
        // Suggested, never auto-merged — the caller decides whether to link/merge.
        duplicateSuggestions: candidates,
      });
    }
  );

  // ── PUT /accounts/:id ────────────────────────────────────────────────────────
  fastify.put<{ Params: { id: string } }>(
    '/accounts/:id',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.CRM_ACCOUNT_UPDATE)] },
    async (request, reply) => {
      const { tenantId, userId } = (request as unknown as AuthedRequest).auth;
      const ctx = ctxFactory.create({
        tenantId,
        userId,
        correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID(),
      });
      const id = parseInt(request.params.id, 10);
      const body = AccountUpdateSchema.safeParse(request.body);
      if (!body.success)
        throw new ValidationError(body.error.errors.map((e) => e.message).join('; '));

      const [existing] = await ctx.db.raw
        .select()
        .from(crmAccounts)
        .where(and(eq(crmAccounts.id, id), eq(crmAccounts.tenantId, tenantId)));
      if (!existing) throw new NotFoundError('CrmAccount', id);

      const gstinHash = body.data.gstin ? simpleHash(body.data.gstin) : null;
      const [updated] = await ctx.db.raw
        .update(crmAccounts)
        .set({
          name: body.data.name,
          accountType: body.data.accountType,
          gstin: body.data.gstin || null,
          gstinHash,
          primaryPhone: body.data.primaryPhone,
          primaryEmail: body.data.primaryEmail || undefined,
          billingAddress: body.data.billingAddress,
          notes: body.data.notes,
          updatedAt: new Date(),
          version: existing.version + 1,
        } as unknown as Partial<typeof crmAccounts.$inferInsert>)
        .where(
          and(
            eq(crmAccounts.id, id),
            eq(crmAccounts.tenantId, tenantId),
            eq(crmAccounts.version, body.data.version)
          )
        )
        .returning();
      if (!updated) throw new OptimisticLockError('CrmAccount');

      await ctx.audit.log({
        action: 'UPDATE',
        entityType: 'crm_account',
        entityId: id,
        before: existing as unknown as Record<string, unknown>,
        after: updated as unknown as Record<string, unknown>,
      });
      await ctx.events.publish(
        'crm_account',
        id,
        'CRM_ACCOUNT_UPDATED',
        updated as unknown as Record<string, unknown>
      );

      return reply.code(200).send({ data: updated });
    }
  );

  // ── POST /accounts/for-customer/:customerId — get-or-create implicit account ──
  fastify.post<{ Params: { customerId: string } }>(
    '/accounts/for-customer/:customerId',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.CRM_ACCOUNT_CREATE)] },
    async (request, reply) => {
      const { tenantId, userId } = (request as unknown as AuthedRequest).auth;
      const ctx = ctxFactory.create({
        tenantId,
        userId,
        correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID(),
      });
      const customerId = parseInt(request.params.customerId, 10);

      const account = await AccountService.getOrCreateForCustomer(
        ctx.db.raw,
        tenantId,
        userId,
        customerId
      );

      await ctx.audit.log({
        action: 'CREATE',
        entityType: 'crm_account',
        entityId: account.id,
        after: account as unknown as Record<string, unknown>,
        metadata: { implicitForCustomerId: customerId },
      });

      return reply.code(200).send({ data: account });
    }
  );

  // ── POST /accounts/merge ─────────────────────────────────────────────────────
  fastify.post(
    '/accounts/merge',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.CRM_ACCOUNT_MERGE)] },
    async (request, reply) => {
      const { tenantId, userId } = (request as unknown as AuthedRequest).auth;
      const ctx = ctxFactory.create({
        tenantId,
        userId,
        correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID(),
      });
      const body = MergeSchema.safeParse(request.body);
      if (!body.success)
        throw new ValidationError(body.error.errors.map((e) => e.message).join('; '));

      let result: { contactsMoved: number; customersMoved: number } | undefined;
      await ctx.db.transaction(async (trx) => {
        result = await AccountService.merge(
          trx.raw,
          tenantId,
          body.data.sourceId,
          body.data.targetId
        );
      });
      if (!result) throw new Error('Account merge failed unexpectedly');

      await ctx.audit.log({
        action: 'UPDATE',
        entityType: 'crm_account',
        entityId: body.data.sourceId,
        metadata: { mergedIntoAccountId: body.data.targetId, ...result },
      });
      await ctx.events.publish('crm_account', body.data.sourceId, 'CRM_ACCOUNT_MERGED', {
        sourceId: body.data.sourceId,
        targetId: body.data.targetId,
        ...result,
      });

      return reply.code(200).send({
        data: {
          message: 'Accounts merged',
          sourceId: body.data.sourceId,
          targetId: body.data.targetId,
          ...result,
        },
      });
    }
  );

  // ── Account Contacts ─────────────────────────────────────────────────────────
  fastify.get<{ Params: { id: string } }>(
    '/accounts/:id/contacts',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.CRM_ACCOUNT_VIEW)] },
    async (request, reply) => {
      const { tenantId, userId } = (request as unknown as AuthedRequest).auth;
      const ctx = ctxFactory.create({
        tenantId,
        userId,
        correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID(),
      });
      const accountId = parseInt(request.params.id, 10);
      const rows = await ctx.db.raw
        .select()
        .from(crmAccountContacts)
        .where(
          and(
            eq(crmAccountContacts.accountId, accountId),
            eq(crmAccountContacts.tenantId, tenantId)
          )
        )
        .orderBy(sql`${crmAccountContacts.isPrimary} DESC, ${crmAccountContacts.createdAt} ASC`);
      return reply.code(200).send({ data: { content: rows, totalElements: rows.length } });
    }
  );

  fastify.post<{ Params: { id: string } }>(
    '/accounts/:id/contacts',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.CRM_ACCOUNT_UPDATE)] },
    async (request, reply) => {
      const { tenantId, userId } = (request as unknown as AuthedRequest).auth;
      const ctx = ctxFactory.create({
        tenantId,
        userId,
        correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID(),
      });
      const accountId = parseInt(request.params.id, 10);

      const [account] = await ctx.db.raw
        .select({ id: crmAccounts.id })
        .from(crmAccounts)
        .where(and(eq(crmAccounts.id, accountId), eq(crmAccounts.tenantId, tenantId)));
      if (!account) throw new NotFoundError('CrmAccount', accountId);

      const body = ContactSchema.safeParse(request.body);
      if (!body.success)
        throw new ValidationError(body.error.errors.map((e) => e.message).join('; '));

      const [created] = await ctx.db.transaction(async (trx) => {
        // Only one contact can be primary at a time — clear any existing primary first.
        if (body.data.isPrimary) {
          await trx.raw
            .update(crmAccountContacts)
            .set({ isPrimary: false, updatedAt: new Date() })
            .where(
              and(
                eq(crmAccountContacts.accountId, accountId),
                eq(crmAccountContacts.tenantId, tenantId)
              )
            );
        }
        return trx.raw
          .insert(crmAccountContacts)
          .values({
            tenantId,
            accountId,
            name: body.data.name,
            role: body.data.role,
            email: body.data.email || undefined,
            phone: body.data.phone,
            isPrimary: body.data.isPrimary,
            notes: body.data.notes,
            createdBy: userId,
          })
          .returning();
      });
      if (!created) throw new Error('Account contact creation failed unexpectedly');

      await ctx.audit.log({
        action: 'CREATE',
        entityType: 'crm_account_contact',
        entityId: created.id,
        after: created as unknown as Record<string, unknown>,
      });

      return reply.code(201).send({ data: created });
    }
  );

  fastify.put<{ Params: { id: string; contactId: string } }>(
    '/accounts/:id/contacts/:contactId',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.CRM_ACCOUNT_UPDATE)] },
    async (request, reply) => {
      const { tenantId, userId } = (request as unknown as AuthedRequest).auth;
      const ctx = ctxFactory.create({
        tenantId,
        userId,
        correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID(),
      });
      const accountId = parseInt(request.params.id, 10);
      const contactId = parseInt(request.params.contactId, 10);

      const [existing] = await ctx.db.raw
        .select()
        .from(crmAccountContacts)
        .where(
          and(
            eq(crmAccountContacts.id, contactId),
            eq(crmAccountContacts.accountId, accountId),
            eq(crmAccountContacts.tenantId, tenantId)
          )
        );
      if (!existing) throw new NotFoundError('CrmAccountContact', contactId);

      const body = ContactSchema.safeParse(request.body);
      if (!body.success)
        throw new ValidationError(body.error.errors.map((e) => e.message).join('; '));

      const [updated] = await ctx.db.transaction(async (trx) => {
        if (body.data.isPrimary) {
          await trx.raw
            .update(crmAccountContacts)
            .set({ isPrimary: false, updatedAt: new Date() })
            .where(
              and(
                eq(crmAccountContacts.accountId, accountId),
                eq(crmAccountContacts.tenantId, tenantId)
              )
            );
        }
        return trx.raw
          .update(crmAccountContacts)
          .set({
            name: body.data.name,
            role: body.data.role,
            email: body.data.email || undefined,
            phone: body.data.phone,
            isPrimary: body.data.isPrimary,
            notes: body.data.notes,
            updatedAt: new Date(),
            version: existing.version + 1,
          })
          .where(eq(crmAccountContacts.id, contactId))
          .returning();
      });

      return reply.code(200).send({ data: updated });
    }
  );

  fastify.delete<{ Params: { id: string; contactId: string } }>(
    '/accounts/:id/contacts/:contactId',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.CRM_ACCOUNT_UPDATE)] },
    async (request, reply) => {
      const { tenantId, userId } = (request as unknown as AuthedRequest).auth;
      const ctx = ctxFactory.create({
        tenantId,
        userId,
        correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID(),
      });
      const accountId = parseInt(request.params.id, 10);
      const contactId = parseInt(request.params.contactId, 10);

      const [existing] = await ctx.db.raw
        .select()
        .from(crmAccountContacts)
        .where(
          and(
            eq(crmAccountContacts.id, contactId),
            eq(crmAccountContacts.accountId, accountId),
            eq(crmAccountContacts.tenantId, tenantId)
          )
        );
      if (!existing) throw new NotFoundError('CrmAccountContact', contactId);
      if (existing.isPrimary) {
        throw new BusinessError(
          'CANNOT_DELETE_PRIMARY_CONTACT',
          'Make another contact primary before deleting this one'
        );
      }

      await ctx.db.raw.delete(crmAccountContacts).where(eq(crmAccountContacts.id, contactId));
      return reply.code(200).send({ data: { message: 'Contact deleted', id: contactId } });
    }
  );
}
