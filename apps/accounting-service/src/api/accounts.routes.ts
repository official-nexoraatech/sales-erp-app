import type { FastifyInstance } from 'fastify';
import type { PlatformContextFactory } from '@erp/sdk';
import { PlatformEventBus } from '@erp/sdk';
import { accounts, financialEntries } from '@erp/db';
import { and, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { BusinessError, NotFoundError, OptimisticLockError, ValidationError } from '@erp/types';
import { PERMISSIONS, OptionalIFSCSchema, OptionalBankAccountSchema } from '@erp/types';
import { authenticate } from '../middleware/authenticate.js';
import { requirePermission } from '../middleware/authorize.js';

const AccountSchema = z.object({
  accountCode: z.string().min(1).max(30),
  name: z.string().min(2).max(300),
  accountType: z.enum(['ASSET', 'LIABILITY', 'EQUITY', 'INCOME', 'EXPENSE', 'CONTRA']),
  accountSubType: z.string().max(50).optional(),
  normalBalance: z.enum(['DEBIT', 'CREDIT']),
  parentId: z.number().int().positive().optional(),
  isBank: z.boolean().default(false),
  isCash: z.boolean().default(false),
  defaultCostCenterId: z.number().int().positive().optional(),
  openingBalance: z.number().min(0).default(0),
  openingBalanceType: z.enum(['DEBIT', 'CREDIT']).default('DEBIT'),
  openingBalanceDate: z.string().max(10).optional(),
  bankName: z.string().max(200).optional(),
  bankAccountNo: OptionalBankAccountSchema,
  bankIfsc: OptionalIFSCSchema,
  bankBranch: z.string().max(200).optional(),
  description: z.string().max(2000).optional(),
  isActive: z.boolean().default(true),
});

const AccountUpdateSchema = AccountSchema.extend({
  version: z.number().int().min(0),
});

type AuthedRequest = { auth: { tenantId: number; userId: number } };

export async function accountRoutes(
  fastify: FastifyInstance,
  ctxFactory: PlatformContextFactory
): Promise<void> {
  // ── GET /accounts — Full chart of accounts ──────────────────────────────
  fastify.get(
    '/accounts',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.ACCOUNT_VIEW)] },
    async (request, reply) => {
      const { tenantId, userId } = (request as unknown as AuthedRequest).auth;
      const ctx = ctxFactory.create({
        tenantId,
        userId,
        correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID(),
      });
      const rows = await ctx.db.raw
        .select()
        .from(accounts)
        .where(and(eq(accounts.tenantId, tenantId), isNull(accounts.deletedAt)));
      return reply.code(200).send({ data: { content: rows, totalElements: rows.length } });
    }
  );

  // ── GET /accounts/tree — Hierarchical tree for account picker ───────────
  fastify.get(
    '/accounts/tree',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.ACCOUNT_VIEW)] },
    async (request, reply) => {
      const { tenantId, userId } = (request as unknown as AuthedRequest).auth;
      const ctx = ctxFactory.create({
        tenantId,
        userId,
        correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID(),
      });
      const rows = await ctx.db.raw
        .select()
        .from(accounts)
        .where(and(eq(accounts.tenantId, tenantId), isNull(accounts.deletedAt)));

      // Build tree in-memory
      type AccountNode = (typeof rows)[number] & { children: AccountNode[] };
      const nodeMap = new Map<number, AccountNode>();
      const roots: AccountNode[] = [];

      rows.forEach((row) => nodeMap.set(row.id, { ...row, children: [] }));
      rows.forEach((row) => {
        const node = nodeMap.get(row.id)!;
        if (row.parentId && nodeMap.has(row.parentId)) {
          nodeMap.get(row.parentId)!.children.push(node);
        } else {
          roots.push(node);
        }
      });

      return reply.code(200).send({ data: roots });
    }
  );

  // ── GET /accounts/:id ───────────────────────────────────────────────────
  fastify.get<{ Params: { id: string } }>(
    '/accounts/:id',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.ACCOUNT_VIEW)] },
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
        .from(accounts)
        .where(
          and(eq(accounts.id, id), eq(accounts.tenantId, tenantId), isNull(accounts.deletedAt))
        );
      if (!account) throw new NotFoundError('Account', id);
      return reply.code(200).send({ data: account });
    }
  );

  // ── POST /accounts ──────────────────────────────────────────────────────
  fastify.post(
    '/accounts',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.ACCOUNT_CREATE)] },
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

      // ES-24 [C6]: insert + outbox publish must be one atomic commit — if the process
      // dies between them, neither happens (safe) instead of the account existing with
      // its event permanently lost (the old two-step, non-transactional way).
      const created = await ctx.db.transaction(async (trx) => {
        const [row] = await trx.raw
          .insert(accounts)
          .values({
            tenantId,
            createdBy: userId,
            ...body.data,
            openingBalance: String(body.data.openingBalance),
          } as unknown as typeof accounts.$inferInsert)
          .returning();
        if (!row) throw new Error('Account insert failed unexpectedly');

        const eventBus = new PlatformEventBus(trx, tenantId, userId, ctx.tenant.correlationId);
        await eventBus.publishInTransaction(
          'account',
          row.id,
          'ACCOUNT_CREATED',
          row as unknown as Record<string, unknown>
        );
        return row;
      });

      await ctx.audit.log({
        action: 'CREATE',
        entityType: 'account',
        entityId: created.id,
        after: created as unknown as Record<string, unknown>,
      });

      return reply.code(201).send({ data: created });
    }
  );

  // ── PUT /accounts/:id ───────────────────────────────────────────────────
  fastify.put<{ Params: { id: string } }>(
    '/accounts/:id',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.ACCOUNT_UPDATE)] },
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
        .from(accounts)
        .where(
          and(eq(accounts.id, id), eq(accounts.tenantId, tenantId), isNull(accounts.deletedAt))
        );
      if (!existing) throw new NotFoundError('Account', id);
      if (existing.isSystem) {
        throw new BusinessError(
          'CANNOT_MODIFY_SYSTEM_ACCOUNT',
          'System accounts cannot be modified directly'
        );
      }

      const updated = await ctx.db.transaction(async (trx) => {
        const result = await trx.raw
          .update(accounts)
          .set({
            ...body.data,
            openingBalance: String(body.data.openingBalance),
            updatedAt: new Date(),
            version: existing.version + 1,
          } as unknown as Partial<typeof accounts.$inferInsert>)
          .where(
            and(
              eq(accounts.id, id),
              eq(accounts.tenantId, tenantId),
              eq(accounts.version, body.data.version)
            )
          )
          .returning();

        const row = result[0];
        if (!row) {
          throw new OptimisticLockError('Account');
        }

        const eventBus = new PlatformEventBus(trx, tenantId, userId, ctx.tenant.correlationId);
        await eventBus.publishInTransaction(
          'account',
          row.id,
          'ACCOUNT_UPDATED',
          row as unknown as Record<string, unknown>
        );
        return row;
      });

      await ctx.audit.log({
        action: 'UPDATE',
        entityType: 'account',
        entityId: id,
        before: existing as unknown as Record<string, unknown>,
        after: updated as unknown as Record<string, unknown>,
      });

      return reply.code(200).send({ data: updated });
    }
  );

  // ── DELETE /accounts/:id — Cannot delete accounts with transactions ────
  fastify.delete<{ Params: { id: string } }>(
    '/accounts/:id',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.ACCOUNT_UPDATE)] },
    async (request, reply) => {
      const { tenantId, userId } = (request as unknown as AuthedRequest).auth;
      const ctx = ctxFactory.create({
        tenantId,
        userId,
        correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID(),
      });
      const id = parseInt(request.params.id, 10);
      const [existing] = await ctx.db.raw
        .select()
        .from(accounts)
        .where(
          and(eq(accounts.id, id), eq(accounts.tenantId, tenantId), isNull(accounts.deletedAt))
        );
      if (!existing) throw new NotFoundError('Account', id);
      if (existing.isSystem) {
        throw new BusinessError(
          'CANNOT_DELETE_SYSTEM_ACCOUNT',
          'System accounts cannot be deleted'
        );
      }

      // ES-24 [H11]: reject deletion if the account has any posted financial entries —
      // soft-deleting it would silently drop one side of a balanced journal from
      // Trial Balance/P&L/Balance Sheet.
      const [hasEntries] = await ctx.db.raw
        .select({ id: financialEntries.id })
        .from(financialEntries)
        .where(and(eq(financialEntries.accountId, id), eq(financialEntries.tenantId, tenantId)))
        .limit(1);
      if (hasEntries) {
        throw new BusinessError(
          'ACCOUNT_HAS_TRANSACTIONS',
          'Cannot delete an account that has posted financial entries'
        );
      }

      // ES-24 [M23]: missing tenantId predicate — every other mutation in this file has it.
      await ctx.db.raw
        .update(accounts)
        .set({ deletedAt: new Date(), deletedBy: userId, isActive: false })
        .where(and(eq(accounts.id, id), eq(accounts.tenantId, tenantId)));

      await ctx.audit.log({
        action: 'DELETE',
        entityType: 'account',
        entityId: id,
        before: existing,
      });
      await ctx.events.publish('account', id, 'ACCOUNT_DELETED', { id });

      return reply.code(200).send({ data: { message: 'Account deleted', id } });
    }
  );

  // ── POST /accounts/seed — Seed default CoA for tenant (internal) ────────
  fastify.post(
    '/accounts/seed',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.ACCOUNT_CREATE)] },
    async (request, reply) => {
      const { tenantId, userId } = (request as unknown as AuthedRequest).auth;
      const ctx = ctxFactory.create({
        tenantId,
        userId,
        correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID(),
      });
      const { DEFAULT_ACCOUNTS } = await import('../domain/default-accounts.js');

      // ES-24 [C6]: the whole seed (both insert passes) + its outbox publish now commit
      // atomically — previously the publish was a separate, non-transactional call after
      // all the inserts had already committed.
      await ctx.db.transaction(async (trx) => {
        // First pass: insert root accounts (no parentCode)
        const codeToId = new Map<string, number>();

        const rootAccounts = DEFAULT_ACCOUNTS.filter((a) => !a.parentCode);
        for (const acc of rootAccounts) {
          const [inserted] = await trx.raw
            .insert(accounts)
            .values({
              tenantId,
              createdBy: userId,
              accountCode: acc.accountCode,
              name: acc.name,
              accountType: acc.accountType,
              accountSubType: acc.accountSubType,
              normalBalance: acc.normalBalance,
              isBank: acc.isBank ?? false,
              isCash: acc.isCash ?? false,
              isSystem: acc.isSystem ?? false,
              openingBalance: '0',
            } as unknown as typeof accounts.$inferInsert)
            .onConflictDoNothing()
            .returning();
          if (inserted) codeToId.set(acc.accountCode, inserted.id);
        }

        // Reload to get IDs for already-existing accounts
        const existingRows = await trx.raw
          .select()
          .from(accounts)
          .where(eq(accounts.tenantId, tenantId));
        existingRows.forEach((r) => {
          if (r.accountCode) codeToId.set(r.accountCode, r.id);
        });

        // Second pass: child accounts
        const childAccounts = DEFAULT_ACCOUNTS.filter((a) => a.parentCode);
        for (const acc of childAccounts) {
          const parentId = acc.parentCode ? codeToId.get(acc.parentCode) : undefined;
          const [inserted] = await trx.raw
            .insert(accounts)
            .values({
              tenantId,
              createdBy: userId,
              accountCode: acc.accountCode,
              name: acc.name,
              accountType: acc.accountType,
              accountSubType: acc.accountSubType,
              normalBalance: acc.normalBalance,
              isBank: acc.isBank ?? false,
              isCash: acc.isCash ?? false,
              isSystem: acc.isSystem ?? false,
              parentId: parentId ?? undefined,
              openingBalance: '0',
            } as unknown as typeof accounts.$inferInsert)
            .onConflictDoNothing()
            .returning();
          if (inserted) codeToId.set(acc.accountCode, inserted.id);
        }

        const eventBus = new PlatformEventBus(trx, tenantId, userId, ctx.tenant.correlationId);
        await eventBus.publishInTransaction('account', tenantId, 'CHART_OF_ACCOUNTS_SEEDED', {
          tenantId,
          count: DEFAULT_ACCOUNTS.length,
        });
      });

      await ctx.audit.log({
        action: 'CREATE',
        entityType: 'account',
        metadata: { action: 'SEED_COA', count: DEFAULT_ACCOUNTS.length },
      });

      return reply.code(200).send({
        data: { message: 'Chart of accounts seeded', count: DEFAULT_ACCOUNTS.length },
      });
    }
  );
}
