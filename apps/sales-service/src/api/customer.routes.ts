import type { FastifyInstance } from 'fastify';
import { createHash, randomBytes } from 'crypto';
import argon2 from 'argon2';
import type { PlatformContextFactory } from '@erp/sdk';
import { tenantScopedHandler } from '@erp/sdk';
import {
  customers,
  customersHistory,
  customerCommunicationPreferences,
  crmAccounts,
  crmPortalAccounts,
  crmPortalPasswordTokens,
  crmPartnerAccounts,
  crmPartnerPasswordTokens,
} from '@erp/db';
import { and, eq, isNull, or, ilike, sql, getTableColumns } from 'drizzle-orm';
import { z } from 'zod';
import { BusinessError, NotFoundError, OptimisticLockError, ValidationError } from '@erp/types';
import { PERMISSIONS, OptionalGSTINSchema, OptionalPANSchema } from '@erp/types';
import { createLogger } from '@erp/logger';
import { authenticate } from '../middleware/authenticate.js';
import { requirePermission } from '../middleware/authorize.js';
import { CustomerCacheService } from '../domain/CustomerCacheService.js';
import { CustomerService } from '../domain/CustomerService.js';

const logger = createLogger({ serviceName: 'sales-service' });

const CustomerSchema = z.object({
  displayName: z.string().min(2).max(200),
  firstName: z.string().max(100).optional(),
  lastName: z.string().max(100).optional(),
  companyName: z.string().max(300).optional(),
  customerType: z.enum(['RETAIL', 'WHOLESALE', 'B2B', 'GOVERNMENT', 'EXPORT']).default('RETAIL'),
  gstin: OptionalGSTINSchema,
  pan: OptionalPANSchema,
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
  // CRM-ROADMAP Phase 1, Feature 1 (Contact & Account Hierarchy): optional link to a
  // crm_accounts row — existing callers that never send this are unaffected.
  accountId: z.number().int().positive().optional(),
  creditLimit: z.number().min(0).default(0),
  creditDays: z.number().int().min(0).default(0),
  creditLimitEnabled: z.boolean().default(false),
  openingBalance: z.number().min(0).default(0),
  openingBalanceType: z.enum(['DEBIT', 'CREDIT']).default('DEBIT'),
  priceListId: z.number().int().positive().optional(),
  notes: z.string().max(5000).optional(),
  tags: z.array(z.string()).default([]),
  customFields: z.record(z.unknown()).default({}),
  // CRM-ROADMAP Phase 3, Feature 5 (Multi-language Communication): BCP-47-ish tag, e.g. 'hi'/
  // 'ta'/'en'. Omitted means no preference — CampaignService.send() falls back to the campaign's
  // base messageTemplate for this customer.
  preferredLanguage: z.string().max(10).optional(),
  // OFFLINE-05: client-generated idempotency key, attached at offline-queue time — optional
  // so every other (non-offline) caller is unaffected, same convention as
  // POSSaleSchema.operationId in pos.routes.ts.
  operationId: z.string().uuid().optional(),
});

const CustomerUpdateSchema = CustomerSchema.extend({
  version: z.number().int().min(0),
});

const BlockSchema = z.object({
  reason: z.string().min(1).max(500),
});

const OptOutSchema = z.object({
  optOutSms: z.boolean().optional(),
  optOutWhatsapp: z.boolean().optional(),
  optOutEmail: z.boolean().optional(),
});

// CP-7 follow-up: granular consent model (customer_communication_preferences) — additive to,
// not a replacement for, the binary optOutSms/Whatsapp/Email flags above, which remain the
// enforced fast-path gate in every send path (CampaignService.resolveRecipients). This is a
// generic channel x category consent record; it has not been validated against India's DPDP
// Act/TRAI-specific requirements (e.g. TRAI's DLT consent-registration mechanics), which is a
// known, flagged limitation — see the Campaign Management Platform CP-7/CP-9 completion reports.
const PreferencesSchema = z.object({
  preferences: z
    .array(
      z.object({
        channel: z.enum(['SMS', 'WHATSAPP', 'EMAIL', 'IN_APP']),
        category: z.enum(['PROMOTIONAL', 'TRANSACTIONAL']),
        consented: z.boolean(),
      })
    )
    .min(1),
});

function simpleHash(value: string): string {
  // HMAC-like hash for search — in prod use ctx.encryption.searchHash()
  return createHash('sha256').update(value.toUpperCase()).digest('hex').substring(0, 64);
}

// ─── Customer Portal Account provisioning (CRM-ROADMAP Phase 3, Feature 2) ─────────────
const PortalAccountSchema = z.object({
  email: z.string().email().max(320),
});

// Longer than the staff password-reset token's 1hr (PASSWORD_RESET_TOKEN_TTL_MS default) —
// an invite email may sit unread for a while before the customer gets to it.
const PORTAL_INVITE_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;
const CUSTOMER_PORTAL_URL = process.env['CUSTOMER_PORTAL_URL'] ?? 'http://localhost:5176';

function sha256Hex(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

function generateSecureToken(bytes = 32): string {
  return randomBytes(bytes).toString('hex');
}

// Fire-and-forget, same pattern as InvoiceNotificationService — a notification-service outage
// must never block provisioning. Uses send-raw-internal (pre-rendered body), same as that
// service's other customer-facing notices, rather than send-internal's DB-backed eventType
// template lookup, which would need a default template seeded for every tenant first.
//
// Deliberately NOT awaited by its caller (fire-and-forget, matches the pre-existing behavior
// this function already had before the GUC-per-request migration) — the route returns and its
// wrapping transaction commits without waiting on this fetch(), so it does not hold a connection
// open for the notification round trip.
function sendPortalInviteEmail(input: {
  tenantId: number;
  customerName: string;
  email: string;
  setPasswordLink: string;
}): void {
  const notificationUrl = process.env['NOTIFICATION_SERVICE_URL'] ?? 'http://localhost:3014';
  const internalKey = process.env['INTERNAL_API_KEY'] ?? '';
  const body = `Hi ${input.customerName}, you've been invited to your customer portal account. Set your password here: ${input.setPasswordLink}`;

  fetch(`${notificationUrl}/notifications/send-raw-internal`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-internal-key': internalKey },
    body: JSON.stringify({
      tenantId: input.tenantId,
      eventType: 'PORTAL_ACCOUNT_INVITE',
      channel: 'EMAIL',
      recipientEmail: input.email,
      subject: 'Your customer portal account',
      body,
    }),
  }).catch((err: unknown) => {
    logger.warn(
      { err, email: input.email },
      'Portal account invite email delivery failed (non-fatal)'
    );
  });
}

// ─── Partner Portal Account provisioning (CRM-ROADMAP Phase 4, Feature 6) ──────────────
// Same shape as the Customer Portal provisioning above, for the PARTNER auth scope.
const PartnerAccountSchema = z.object({
  email: z.string().email().max(320),
});

const PARTNER_INVITE_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;
const PARTNER_PORTAL_URL = process.env['PARTNER_PORTAL_URL'] ?? 'http://localhost:5177';

// Mirrors sendPortalInviteEmail exactly — fire-and-forget, same reasoning.
function sendPartnerInviteEmail(input: {
  tenantId: number;
  customerName: string;
  email: string;
  setPasswordLink: string;
}): void {
  const notificationUrl = process.env['NOTIFICATION_SERVICE_URL'] ?? 'http://localhost:3014';
  const internalKey = process.env['INTERNAL_API_KEY'] ?? '';
  const body = `Hi ${input.customerName}, you've been invited to your partner account. Set your password here: ${input.setPasswordLink}`;

  fetch(`${notificationUrl}/notifications/send-raw-internal`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-internal-key': internalKey },
    body: JSON.stringify({
      tenantId: input.tenantId,
      eventType: 'PARTNER_ACCOUNT_INVITE',
      channel: 'EMAIL',
      recipientEmail: input.email,
      subject: 'Your partner account',
      body,
    }),
  }).catch((err: unknown) => {
    logger.warn(
      { err, email: input.email },
      'Partner account invite email delivery failed (non-fatal)'
    );
  });
}

// Phase 9 GUC-per-request rollout — migrated 2026-08-21. sendPortalInviteEmail() is
// fire-and-forget (not awaited) so POST /customers/:id/portal-account is safe to migrate — no
// held-open transaction across the notification round trip. Post-hoc ctx.audit.log()/
// ctx.events.publish()/cache invalidation calls are safe per caveat 4b. ctx.db.transaction()
// calls (PUT /customers/:id, block, unblock) become savepoints of the outer transaction.
export async function customerRoutes(
  fastify: FastifyInstance,
  ctxFactory: PlatformContextFactory
): Promise<void> {
  const customerCache = new CustomerCacheService();

  // ── GET /customers ─────────────────────────────────────────────────────────
  fastify.get(
    '/customers',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.CUSTOMER_VIEW)] },
    tenantScopedHandler(ctxFactory, async (request, reply, ctx) => {
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

      let whereClause = and(
        eq(customers.tenantId, ctx.tenant.tenantId),
        isNull(customers.deletedAt)
      );
      if (query.customerType) {
        whereClause = and(
          whereClause,
          eq(
            customers.customerType,
            query.customerType as 'RETAIL' | 'WHOLESALE' | 'B2B' | 'GOVERNMENT' | 'EXPORT'
          )
        );
      }
      if (query.status) {
        whereClause = and(
          whereClause,
          eq(customers.status, query.status as 'ACTIVE' | 'INACTIVE' | 'BLOCKED')
        );
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

      // CRM-ROADMAP Phase 1, Feature 1: left-joined account name so the list can show
      // account-level grouping without an N+1 lookup per row.
      const rows = await ctx.db.raw
        .select({ ...getTableColumns(customers), accountName: crmAccounts.name })
        .from(customers)
        .leftJoin(crmAccounts, eq(customers.accountId, crmAccounts.id))
        .where(whereClause)
        .limit(size)
        .offset(page * size);

      const [countRow] = await ctx.db.raw
        .select({ count: sql<number>`count(*)::int` })
        .from(customers)
        .where(whereClause);

      return reply.code(200).send({
        data: { content: rows, totalElements: countRow?.count ?? 0, page, size },
      });
    })
  );

  // ── GET /customers/:id ─────────────────────────────────────────────────────
  fastify.get(
    '/customers/:id',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.CUSTOMER_VIEW)] },
    tenantScopedHandler(ctxFactory, async (request, reply, ctx) => {
      const { id: idParam } = request.params as { id: string };
      const id = parseInt(idParam, 10);

      let customer = await customerCache.getCustomer(ctx.cache, id);
      if (!customer) {
        const [row] = await ctx.db.raw
          .select()
          .from(customers)
          .where(
            and(
              eq(customers.id, id),
              eq(customers.tenantId, ctx.tenant.tenantId),
              isNull(customers.deletedAt)
            )
          );

        if (!row) throw new NotFoundError('Customer', id);
        customer = row;
        await customerCache.setCustomer(ctx.cache, customer);
      }
      return reply.code(200).send({ data: customer });
    })
  );

  // ── GET /customers/:id/statement ──────────────────────────────────────────
  fastify.get(
    '/customers/:id/statement',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.CUSTOMER_VIEW)] },
    tenantScopedHandler(ctxFactory, async (request, reply, ctx) => {
      const { id: idParam } = request.params as { id: string };
      const id = parseInt(idParam, 10);
      const [customer] = await ctx.db.raw
        .select()
        .from(customers)
        .where(
          and(
            eq(customers.id, id),
            eq(customers.tenantId, ctx.tenant.tenantId),
            isNull(customers.deletedAt)
          )
        );
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
    })
  );

  // ── GET /customers/:id/outstanding ───────────────────────────────────────
  fastify.get(
    '/customers/:id/outstanding',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.CUSTOMER_VIEW)] },
    tenantScopedHandler(ctxFactory, async (request, reply, ctx) => {
      const { id: idParam } = request.params as { id: string };
      const id = parseInt(idParam, 10);
      const [customer] = await ctx.db.raw
        .select()
        .from(customers)
        .where(
          and(
            eq(customers.id, id),
            eq(customers.tenantId, ctx.tenant.tenantId),
            isNull(customers.deletedAt)
          )
        );
      if (!customer) throw new NotFoundError('Customer', id);
      return reply.code(200).send({
        data: {
          customerId: id,
          outstandingAmount: customer.openingBalance,
          overdueAmount: '0',
          invoices: [],
        },
      });
    })
  );

  // ── GET /customers/:id/activity — 360° activity timeline (M9.1) ──────────
  // Aggregates invoices, payments, returns, alterations, loyalty txns and interactions
  // into one chronological feed. Cached in Redis for 60s per (customer, page, size).
  fastify.get(
    '/customers/:id/activity',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.CUSTOMER_VIEW)] },
    tenantScopedHandler(ctxFactory, async (request, reply, ctx) => {
      const { id: idParam } = request.params as { id: string };
      const id = parseInt(idParam, 10);
      const query = request.query as { page?: string; size?: string };
      const page = Math.max(0, parseInt(query.page ?? '0', 10));
      const size = Math.min(100, parseInt(query.size ?? '20', 10));

      const [customer] = await ctx.db.raw
        .select()
        .from(customers)
        .where(
          and(
            eq(customers.id, id),
            eq(customers.tenantId, ctx.tenant.tenantId),
            isNull(customers.deletedAt)
          )
        );
      if (!customer) throw new NotFoundError('Customer', id);

      const cacheKey = `crm:activity:${id}:${page}:${size}`;
      const cached = await ctx.cache.getJson<{ items: unknown[]; total: number }>(cacheKey);
      if (cached) {
        return reply
          .code(200)
          .send({ data: { customerId: id, page, size, ...cached, _cache: 'HIT' } });
      }

      const { ActivityTimelineService } = await import('../domain/ActivityTimelineService.js');
      const { items, total } = await ActivityTimelineService.build(
        ctx.db.raw,
        ctx.tenant.tenantId,
        id,
        page,
        size
      );
      await ctx.cache.setJson(cacheKey, { items, total }, 60);

      return reply
        .code(200)
        .send({ data: { customerId: id, page, size, items, total, _cache: 'MISS' } });
    })
  );

  // ── POST /customers ────────────────────────────────────────────────────────
  fastify.post(
    '/customers',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.CUSTOMER_CREATE)] },
    tenantScopedHandler(ctxFactory, async (request, reply, ctx) => {
      const body = CustomerSchema.safeParse(request.body);
      if (!body.success)
        throw new ValidationError(body.error.errors.map((e) => e.message).join('; '));

      const { created, warnings, alreadyExisted } = await CustomerService.create(ctx.db.raw, {
        tenantId: ctx.tenant.tenantId,
        createdBy: ctx.tenant.userId,
        ...body.data,
      });
      if (alreadyExisted) return reply.code(200).send({ data: created, warnings: [] });

      await ctx.events.publish(
        'customer',
        created.id,
        'CUSTOMER_CREATED',
        created as unknown as Record<string, unknown>
      );
      await ctx.audit.log({
        action: 'CREATE',
        entityType: 'customer',
        entityId: created.id,
        after: created as unknown as Record<string, unknown>,
      });

      return reply.code(201).send({ data: created, warnings });
    })
  );

  // ── PUT /customers/:id ────────────────────────────────────────────────────
  fastify.put(
    '/customers/:id',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.CUSTOMER_EDIT)] },
    tenantScopedHandler(ctxFactory, async (request, reply, ctx) => {
      const { id: idParam } = request.params as { id: string };
      const id = parseInt(idParam, 10);

      const body = CustomerUpdateSchema.safeParse(request.body);
      if (!body.success)
        throw new ValidationError(body.error.errors.map((e) => e.message).join('; '));

      const [existing] = await ctx.db.raw
        .select()
        .from(customers)
        .where(
          and(
            eq(customers.id, id),
            eq(customers.tenantId, ctx.tenant.tenantId),
            isNull(customers.deletedAt)
          )
        );

      if (!existing) throw new NotFoundError('Customer', id);

      const gstinHash = body.data.gstin ? simpleHash(body.data.gstin) : null;
      const panHash = body.data.pan ? simpleHash(body.data.pan) : null;

      let updated: typeof customers.$inferSelect | undefined;
      await ctx.db.transaction(async (trx) => {
        await trx.raw.insert(customersHistory).values({
          customerId: id,
          tenantId: ctx.tenant.tenantId,
          changedBy: ctx.tenant.userId,
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
          .where(
            and(
              eq(customers.id, id),
              eq(customers.tenantId, ctx.tenant.tenantId),
              eq(customers.version, body.data.version)
            )
          )
          .returning();

        if (!row) throw new OptimisticLockError('Customer');
        updated = row;
      });

      await customerCache.invalidateCustomer(ctx.cache, id);
      await ctx.events.publish(
        'customer',
        id,
        'CUSTOMER_UPDATED',
        updated as unknown as Record<string, unknown>
      );
      const changedFields = Object.keys(body.data).filter(
        (key) =>
          (existing as Record<string, unknown>)[key] !== (body.data as Record<string, unknown>)[key]
      );
      await ctx.audit.log({
        action: 'UPDATE',
        entityType: 'customer',
        entityId: id,
        before: existing as unknown as Record<string, unknown>,
        after: updated as unknown as Record<string, unknown>,
        changedFields,
        actorEmail: request.auth.email,
        ipAddress: request.ip,
      });

      return reply.code(200).send({ data: updated });
    })
  );

  // ── PATCH /customers/:id/opt-out — Communication channel opt-out (ES-18) ─
  fastify.patch(
    '/customers/:id/opt-out',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.CUSTOMER_EDIT)] },
    tenantScopedHandler(ctxFactory, async (request, reply, ctx) => {
      const { id: idParam } = request.params as { id: string };
      const id = parseInt(idParam, 10);

      const body = OptOutSchema.safeParse(request.body);
      if (!body.success)
        throw new ValidationError(body.error.errors.map((e) => e.message).join('; '));

      const [existing] = await ctx.db.raw
        .select()
        .from(customers)
        .where(
          and(
            eq(customers.id, id),
            eq(customers.tenantId, ctx.tenant.tenantId),
            isNull(customers.deletedAt)
          )
        );
      if (!existing) throw new NotFoundError('Customer', id);

      const [updated] = await ctx.db.raw
        .update(customers)
        .set({
          ...(body.data.optOutSms !== undefined ? { optOutSms: body.data.optOutSms } : {}),
          ...(body.data.optOutWhatsapp !== undefined
            ? { optOutWhatsapp: body.data.optOutWhatsapp }
            : {}),
          ...(body.data.optOutEmail !== undefined ? { optOutEmail: body.data.optOutEmail } : {}),
          updatedAt: new Date(),
        })
        .where(and(eq(customers.id, id), eq(customers.tenantId, ctx.tenant.tenantId)))
        .returning();
      if (!updated) throw new Error('Opt-out update failed unexpectedly');

      await customerCache.invalidateCustomer(ctx.cache, id);
      await ctx.audit.log({
        action: 'UPDATE',
        entityType: 'customer',
        entityId: id,
        before: {
          optOutSms: existing.optOutSms,
          optOutWhatsapp: existing.optOutWhatsapp,
          optOutEmail: existing.optOutEmail,
        },
        after: {
          optOutSms: updated.optOutSms,
          optOutWhatsapp: updated.optOutWhatsapp,
          optOutEmail: updated.optOutEmail,
        },
      });

      return reply.code(200).send({ data: updated });
    })
  );

  // ── POST /customers/:id/block — H-3 fix: customers.status='BLOCKED' was schema-valid
  // (blockedReason/blockedAt/blockedBy columns, customers_history changeType) but no route
  // ever set it, and CUSTOMER_BLOCK was a dead permission constant. ──────────────────────
  fastify.post(
    '/customers/:id/block',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.CUSTOMER_BLOCK)] },
    tenantScopedHandler(ctxFactory, async (request, reply, ctx) => {
      const { id: idParam } = request.params as { id: string };
      const id = parseInt(idParam, 10);

      const body = BlockSchema.safeParse(request.body);
      if (!body.success)
        throw new ValidationError(body.error.errors.map((e) => e.message).join('; '));

      const [existing] = await ctx.db.raw
        .select()
        .from(customers)
        .where(
          and(
            eq(customers.id, id),
            eq(customers.tenantId, ctx.tenant.tenantId),
            isNull(customers.deletedAt)
          )
        );
      if (!existing) throw new NotFoundError('Customer', id);
      if (existing.status === 'BLOCKED')
        throw new BusinessError('ALREADY_BLOCKED', 'Customer is already blocked');

      let updated: typeof customers.$inferSelect | undefined;
      await ctx.db.transaction(async (trx) => {
        await trx.raw.insert(customersHistory).values({
          customerId: id,
          tenantId: ctx.tenant.tenantId,
          changedBy: ctx.tenant.userId,
          changedAt: new Date(),
          previousData: existing as unknown as Record<string, unknown>,
          changeType: 'BLOCK',
        });

        const [row] = await trx.raw
          .update(customers)
          .set({
            status: 'BLOCKED',
            blockedReason: body.data.reason,
            blockedAt: new Date(),
            blockedBy: ctx.tenant.userId,
            updatedAt: new Date(),
            version: existing.version + 1,
          })
          .where(and(eq(customers.id, id), eq(customers.tenantId, ctx.tenant.tenantId)))
          .returning();
        updated = row;
      });
      if (!updated) throw new Error('Customer block failed unexpectedly');

      await customerCache.invalidateCustomer(ctx.cache, id);
      await ctx.events.publish(
        'customer',
        id,
        'CUSTOMER_UPDATED',
        updated as unknown as Record<string, unknown>
      );
      await ctx.audit.log({
        action: 'UPDATE',
        entityType: 'customer',
        entityId: id,
        before: { status: existing.status },
        after: { status: updated.status, blockedReason: updated.blockedReason },
        changedFields: ['status', 'blockedReason', 'blockedAt', 'blockedBy'],
        actorEmail: request.auth.email,
        ipAddress: request.ip,
      });

      return reply.code(200).send({ data: updated });
    })
  );

  // ── POST /customers/:id/unblock ───────────────────────────────────────────
  fastify.post(
    '/customers/:id/unblock',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.CUSTOMER_BLOCK)] },
    tenantScopedHandler(ctxFactory, async (request, reply, ctx) => {
      const { id: idParam } = request.params as { id: string };
      const id = parseInt(idParam, 10);

      const [existing] = await ctx.db.raw
        .select()
        .from(customers)
        .where(
          and(
            eq(customers.id, id),
            eq(customers.tenantId, ctx.tenant.tenantId),
            isNull(customers.deletedAt)
          )
        );
      if (!existing) throw new NotFoundError('Customer', id);
      if (existing.status !== 'BLOCKED')
        throw new BusinessError('NOT_BLOCKED', 'Customer is not currently blocked');

      let updated: typeof customers.$inferSelect | undefined;
      await ctx.db.transaction(async (trx) => {
        await trx.raw.insert(customersHistory).values({
          customerId: id,
          tenantId: ctx.tenant.tenantId,
          changedBy: ctx.tenant.userId,
          changedAt: new Date(),
          previousData: existing as unknown as Record<string, unknown>,
          changeType: 'UNBLOCK',
        });

        const [row] = await trx.raw
          .update(customers)
          .set({
            status: 'ACTIVE',
            blockedReason: null,
            blockedAt: null,
            blockedBy: null,
            updatedAt: new Date(),
            version: existing.version + 1,
          })
          .where(and(eq(customers.id, id), eq(customers.tenantId, ctx.tenant.tenantId)))
          .returning();
        updated = row;
      });
      if (!updated) throw new Error('Customer unblock failed unexpectedly');

      await customerCache.invalidateCustomer(ctx.cache, id);
      await ctx.events.publish(
        'customer',
        id,
        'CUSTOMER_UPDATED',
        updated as unknown as Record<string, unknown>
      );
      await ctx.audit.log({
        action: 'UPDATE',
        entityType: 'customer',
        entityId: id,
        before: { status: existing.status },
        after: { status: updated.status },
        changedFields: ['status', 'blockedReason', 'blockedAt', 'blockedBy'],
        actorEmail: request.auth.email,
        ipAddress: request.ip,
      });

      return reply.code(200).send({ data: updated });
    })
  );

  // ── GET /customers/:id/preferences — Granular consent (channel x category) ─
  fastify.get(
    '/customers/:id/preferences',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.CUSTOMER_VIEW)] },
    tenantScopedHandler(ctxFactory, async (request, reply, ctx) => {
      const { id: idParam } = request.params as { id: string };
      const id = parseInt(idParam, 10);

      const [existing] = await ctx.db.raw
        .select({ id: customers.id })
        .from(customers)
        .where(
          and(
            eq(customers.id, id),
            eq(customers.tenantId, ctx.tenant.tenantId),
            isNull(customers.deletedAt)
          )
        );
      if (!existing) throw new NotFoundError('Customer', id);

      const rows = await ctx.db.raw
        .select()
        .from(customerCommunicationPreferences)
        .where(
          and(
            eq(customerCommunicationPreferences.customerId, id),
            eq(customerCommunicationPreferences.tenantId, ctx.tenant.tenantId)
          )
        );

      return reply.code(200).send({ data: { content: rows, totalElements: rows.length } });
    })
  );

  // ── PUT /customers/:id/preferences — Upsert one or more preference rows ────
  fastify.put(
    '/customers/:id/preferences',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.CUSTOMER_EDIT)] },
    tenantScopedHandler(ctxFactory, async (request, reply, ctx) => {
      const { id: idParam } = request.params as { id: string };
      const id = parseInt(idParam, 10);

      const body = PreferencesSchema.safeParse(request.body);
      if (!body.success)
        throw new ValidationError(body.error.errors.map((e) => e.message).join('; '));

      const [existingCustomer] = await ctx.db.raw
        .select({ id: customers.id })
        .from(customers)
        .where(
          and(
            eq(customers.id, id),
            eq(customers.tenantId, ctx.tenant.tenantId),
            isNull(customers.deletedAt)
          )
        );
      if (!existingCustomer) throw new NotFoundError('Customer', id);

      const saved = await Promise.all(
        body.data.preferences.map(async (pref) => {
          const [row] = await ctx.db.raw
            .insert(customerCommunicationPreferences)
            .values({
              tenantId: ctx.tenant.tenantId,
              customerId: id,
              channel: pref.channel,
              category: pref.category,
              consented: pref.consented,
              consentSource: 'ADMIN_UPDATE',
              consentRecordedAt: new Date(),
              updatedAt: new Date(),
            })
            .onConflictDoUpdate({
              target: [
                customerCommunicationPreferences.tenantId,
                customerCommunicationPreferences.customerId,
                customerCommunicationPreferences.channel,
                customerCommunicationPreferences.category,
              ],
              set: {
                consented: pref.consented,
                consentSource: 'ADMIN_UPDATE',
                consentRecordedAt: new Date(),
                updatedAt: new Date(),
              },
            })
            .returning();
          return row;
        })
      );

      await ctx.audit.log({
        action: 'UPDATE',
        entityType: 'customer_communication_preferences',
        entityId: id,
        after: { preferences: body.data.preferences },
      });

      return reply.code(200).send({ data: { content: saved, totalElements: saved.length } });
    })
  );

  // ── DELETE /customers/:id — Soft delete ──────────────────────────────────
  fastify.delete(
    '/customers/:id',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.CUSTOMER_DELETE)] },
    tenantScopedHandler(ctxFactory, async (request, reply, ctx) => {
      const { id: idParam } = request.params as { id: string };
      const id = parseInt(idParam, 10);

      const [existing] = await ctx.db.raw
        .select()
        .from(customers)
        .where(
          and(
            eq(customers.id, id),
            eq(customers.tenantId, ctx.tenant.tenantId),
            isNull(customers.deletedAt)
          )
        );

      if (!existing) throw new NotFoundError('Customer', id);
      // TODO Phase 5: block if customer has outstanding balance

      await ctx.db.raw
        .update(customers)
        .set({ deletedAt: new Date(), deletedBy: ctx.tenant.userId, status: 'INACTIVE' })
        .where(eq(customers.id, id));

      await customerCache.invalidateCustomer(ctx.cache, id);
      await ctx.events.publish('customer', id, 'CUSTOMER_DELETED', { id });
      await ctx.audit.log({
        action: 'DELETE',
        entityType: 'customer',
        entityId: id,
        before: existing,
      });

      return reply.code(200).send({ data: { message: 'Customer deleted', id } });
    })
  );

  // ── POST /customers/merge — MDG ───────────────────────────────────────────
  fastify.post(
    '/customers/merge',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.CUSTOMER_MERGE)] },
    tenantScopedHandler(ctxFactory, async (request, reply, ctx) => {
      const MergeSchema = z.object({
        sourceId: z.number().int().positive(),
        targetId: z.number().int().positive(),
        keepFields: z.enum(['SOURCE', 'TARGET']).default('TARGET'),
      });
      const body = MergeSchema.safeParse(request.body);
      if (!body.success)
        throw new ValidationError(body.error.errors.map((e) => e.message).join('; '));
      if (body.data.sourceId === body.data.targetId) {
        throw new BusinessError('SAME_CUSTOMER', 'Source and target cannot be the same customer');
      }

      const [source] = await ctx.db.raw
        .select()
        .from(customers)
        .where(
          and(
            eq(customers.id, body.data.sourceId),
            eq(customers.tenantId, ctx.tenant.tenantId),
            isNull(customers.deletedAt)
          )
        );
      const [target] = await ctx.db.raw
        .select()
        .from(customers)
        .where(
          and(
            eq(customers.id, body.data.targetId),
            eq(customers.tenantId, ctx.tenant.tenantId),
            isNull(customers.deletedAt)
          )
        );

      if (!source) throw new NotFoundError('Customer', body.data.sourceId);
      if (!target) throw new NotFoundError('Customer', body.data.targetId);

      // Archive source before merge
      await ctx.db.raw.insert(customersHistory).values({
        customerId: body.data.sourceId,
        tenantId: ctx.tenant.tenantId,
        changedBy: ctx.tenant.userId,
        previousData: source as unknown as Record<string, unknown>,
        changeType: 'UPDATE',
      });

      // Soft-delete source (all transactions Phase 5+ will re-point to target)
      await ctx.db.raw
        .update(customers)
        .set({ deletedAt: new Date(), deletedBy: ctx.tenant.userId, status: 'INACTIVE' })
        .where(eq(customers.id, body.data.sourceId));

      await ctx.audit.log({
        action: 'DELETE',
        entityType: 'customer',
        entityId: body.data.sourceId,
        before: source,
        metadata: { mergedIntoId: body.data.targetId },
      });

      await customerCache.invalidateCustomer(ctx.cache, body.data.sourceId);

      return reply.code(200).send({
        data: {
          message: 'Customers merged',
          sourceId: body.data.sourceId,
          targetId: body.data.targetId,
        },
      });
    })
  );

  // ── POST /customers/import — Bulk import ─────────────────────────────────
  fastify.post(
    '/customers/import',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.CUSTOMER_CREATE)] },
    async (_request, reply) => {
      // Delegates to Scheduler Service ImportEngine (Phase 1)
      return reply.code(202).send({
        data: {
          message: 'Use POST /imports/upload with entityType=CUSTOMER via scheduler-service',
        },
      });
    }
  );

  // ── GET /customers/export ─────────────────────────────────────────────────
  fastify.get(
    '/customers/export',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.EXPORT_CUSTOMER_DATA)] },
    async (_request, reply) => {
      return reply.code(202).send({
        data: {
          message: 'Use POST /exports/generate with entityType=CUSTOMER via scheduler-service',
        },
      });
    }
  );

  // ── POST /customers/:id/portal-account — staff-provisioned invite ────────
  // CRM-ROADMAP Phase 3, Feature 2 (Self-Service Customer Portal): a customer never
  // self-registers. Idempotent — calling again for a customer that already has an account
  // just re-sends a fresh invite (e.g. the first email bounced), it does not error.
  fastify.post(
    '/customers/:id/portal-account',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.PORTAL_ACCOUNT_MANAGE)] },
    tenantScopedHandler(ctxFactory, async (request, reply, ctx) => {
      const { id: idParam } = request.params as { id: string };
      const id = parseInt(idParam, 10);

      const body = PortalAccountSchema.safeParse(request.body);
      if (!body.success)
        throw new ValidationError(body.error.errors.map((e) => e.message).join('; '));

      const [customer] = await ctx.db.raw
        .select()
        .from(customers)
        .where(
          and(
            eq(customers.id, id),
            eq(customers.tenantId, ctx.tenant.tenantId),
            isNull(customers.deletedAt)
          )
        );
      if (!customer) throw new NotFoundError('Customer', id);

      let [account] = await ctx.db.raw
        .select()
        .from(crmPortalAccounts)
        .where(
          and(
            eq(crmPortalAccounts.customerId, id),
            eq(crmPortalAccounts.tenantId, ctx.tenant.tenantId)
          )
        );

      if (!account) {
        // Unusable until set-password succeeds — never given out, so it never matches any
        // password a real caller could supply. Avoids a nullable passwordHash column just to
        // represent "invited but hasn't set a password yet".
        const placeholderHash = await argon2.hash(generateSecureToken(32), {
          type: argon2.argon2id,
        });
        [account] = await ctx.db.raw
          .insert(crmPortalAccounts)
          .values({
            tenantId: ctx.tenant.tenantId,
            customerId: id,
            email: body.data.email,
            passwordHash: placeholderHash,
            isActive: true,
            mustResetPassword: true,
          })
          .returning();
      } else {
        [account] = await ctx.db.raw
          .update(crmPortalAccounts)
          .set({ email: body.data.email, updatedAt: new Date() })
          .where(eq(crmPortalAccounts.id, account.id))
          .returning();
      }
      if (!account) throw new Error('Portal account provisioning failed unexpectedly');

      const plainToken = generateSecureToken(32);
      const tokenHash = sha256Hex(plainToken);
      const expiresAt = new Date(Date.now() + PORTAL_INVITE_TOKEN_TTL_MS);

      await ctx.db.raw.insert(crmPortalPasswordTokens).values({
        portalAccountId: account.id,
        tenantId: ctx.tenant.tenantId,
        tokenHash,
        expiresAt,
      });

      const setPasswordLink = `${CUSTOMER_PORTAL_URL}/set-password?token=${plainToken}`;
      sendPortalInviteEmail({
        tenantId: ctx.tenant.tenantId,
        customerName: customer.displayName,
        email: body.data.email,
        setPasswordLink,
      });

      await ctx.audit.log({
        action: 'CREATE',
        entityType: 'crm_portal_account',
        entityId: account.id,
        after: { customerId: id, email: account.email, isActive: account.isActive },
      });

      return reply.code(201).send({
        data: { id: account.id, customerId: id, email: account.email, isActive: account.isActive },
      });
    })
  );

  // ── POST /customers/:id/partner-account — staff-provisioned invite ──────
  // CRM-ROADMAP Phase 4, Feature 6 (Partner/Channel Portal): mirrors the portal-account route
  // above exactly, for the PARTNER auth scope. Unlike that route, this one enforces the one
  // place "partner-ness" is actually checked — provisioning is rejected for a RETAIL customer,
  // since a partner is defined as an existing WHOLESALE/B2B customers row (no dedicated
  // distributor entity — see partner.routes.ts's header comment).
  fastify.post(
    '/customers/:id/partner-account',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.PARTNER_ACCOUNT_MANAGE)] },
    tenantScopedHandler(ctxFactory, async (request, reply, ctx) => {
      const { id: idParam } = request.params as { id: string };
      const id = parseInt(idParam, 10);

      const body = PartnerAccountSchema.safeParse(request.body);
      if (!body.success)
        throw new ValidationError(body.error.errors.map((e) => e.message).join('; '));

      const [customer] = await ctx.db.raw
        .select()
        .from(customers)
        .where(
          and(
            eq(customers.id, id),
            eq(customers.tenantId, ctx.tenant.tenantId),
            isNull(customers.deletedAt)
          )
        );
      if (!customer) throw new NotFoundError('Customer', id);
      if (!['WHOLESALE', 'B2B'].includes(customer.customerType)) {
        throw new ValidationError(
          `Customer ${id} is typed ${customer.customerType} — only WHOLESALE/B2B customers can have a partner account`
        );
      }

      let [account] = await ctx.db.raw
        .select()
        .from(crmPartnerAccounts)
        .where(
          and(
            eq(crmPartnerAccounts.customerId, id),
            eq(crmPartnerAccounts.tenantId, ctx.tenant.tenantId)
          )
        );

      if (!account) {
        const placeholderHash = await argon2.hash(generateSecureToken(32), {
          type: argon2.argon2id,
        });
        [account] = await ctx.db.raw
          .insert(crmPartnerAccounts)
          .values({
            tenantId: ctx.tenant.tenantId,
            customerId: id,
            email: body.data.email,
            passwordHash: placeholderHash,
            isActive: true,
            mustResetPassword: true,
          })
          .returning();
      } else {
        [account] = await ctx.db.raw
          .update(crmPartnerAccounts)
          .set({ email: body.data.email, updatedAt: new Date() })
          .where(eq(crmPartnerAccounts.id, account.id))
          .returning();
      }
      if (!account) throw new Error('Partner account provisioning failed unexpectedly');

      const plainToken = generateSecureToken(32);
      const tokenHash = sha256Hex(plainToken);
      const expiresAt = new Date(Date.now() + PARTNER_INVITE_TOKEN_TTL_MS);

      await ctx.db.raw.insert(crmPartnerPasswordTokens).values({
        partnerAccountId: account.id,
        tenantId: ctx.tenant.tenantId,
        tokenHash,
        expiresAt,
      });

      const setPasswordLink = `${PARTNER_PORTAL_URL}/set-password?token=${plainToken}`;
      sendPartnerInviteEmail({
        tenantId: ctx.tenant.tenantId,
        customerName: customer.displayName,
        email: body.data.email,
        setPasswordLink,
      });

      await ctx.audit.log({
        action: 'CREATE',
        entityType: 'crm_partner_account',
        entityId: account.id,
        after: { customerId: id, email: account.email, isActive: account.isActive },
      });

      return reply.code(201).send({
        data: { id: account.id, customerId: id, email: account.email, isActive: account.isActive },
      });
    })
  );
}
