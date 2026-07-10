import type { FastifyInstance } from 'fastify';
import type { PlatformContextFactory } from '@erp/sdk';
import { PlatformEventBus } from '@erp/sdk';
import { openingBalances, openingBalancesWizard, customers, suppliers, accounts } from '@erp/db';
import { and, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { BusinessError, NotFoundError, ValidationError } from '@erp/types';
import { PERMISSIONS } from '@erp/types';
import { authenticate } from '../middleware/authenticate.js';
import { requirePermission } from '../middleware/authorize.js';
import { validateOpeningBalanceTrialBalance } from '../domain/OpeningBalanceValidator.js';

type AuthedRequest = { auth: { tenantId: number; userId: number } };

const CustomerBalanceRow = z.object({
  customerId: z.number().int().positive(),
  amount: z.number().min(0),
  balanceType: z.enum(['DEBIT', 'CREDIT']),
  asOfDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD'),
  notes: z.string().max(500).optional(),
});

const SupplierBalanceRow = z.object({
  supplierId: z.number().int().positive(),
  amount: z.number().min(0),
  balanceType: z.enum(['DEBIT', 'CREDIT']),
  asOfDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD'),
  notes: z.string().max(500).optional(),
});

const StockBalanceRow = z.object({
  itemId: z.number().int().positive(),
  variantId: z.number().int().positive().optional(),
  warehouseId: z.number().int().positive(),
  quantity: z.number().min(0),
  unitCost: z.number().min(0),
  asOfDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  notes: z.string().max(500).optional(),
});

const AccountBalanceRow = z.object({
  accountId: z.number().int().positive(),
  amount: z.number().min(0),
  balanceType: z.enum(['DEBIT', 'CREDIT']),
  asOfDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  notes: z.string().max(500).optional(),
});

const CashBankRow = z.object({
  accountId: z.number().int().positive(),
  amount: z.number().min(0),
  balanceType: z.enum(['DEBIT', 'CREDIT']).default('DEBIT'),
  asOfDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  notes: z.string().max(500).optional(),
});

export async function openingBalancesRoutes(
  fastify: FastifyInstance,
  ctxFactory: PlatformContextFactory
): Promise<void> {
  // ── GET /opening-balances/status ─────────────────────────────────────────
  fastify.get('/opening-balances/status', { preHandler: [authenticate, requirePermission(PERMISSIONS.OPENING_BALANCE_LOCK)] }, async (request, reply) => {
    const { tenantId, userId } = (request as unknown as AuthedRequest).auth;
    const ctx = ctxFactory.create({
      tenantId,
      userId,
      correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID(),
    });

    const [wizard] = await ctx.db.raw
      .select()
      .from(openingBalancesWizard)
      .where(eq(openingBalancesWizard.tenantId, tenantId));

    if (!wizard) {
      return reply.code(200).send({
        data: {
          status: 'NOT_STARTED',
          customersCompleted: false,
          suppliersCompleted: false,
          stockCompleted: false,
          accountsCompleted: false,
          cashBankCompleted: false,
          lockedAt: null,
        },
      });
    }

    return reply.code(200).send({ data: wizard });
  });

  // ── POST /opening-balances/customers (batch) ──────────────────────────────
  fastify.post('/opening-balances/customers', { preHandler: [authenticate, requirePermission(PERMISSIONS.OPENING_BALANCE_LOCK)] }, async (request, reply) => {
    const { tenantId, userId } = (request as unknown as AuthedRequest).auth;
    const ctx = ctxFactory.create({
      tenantId,
      userId,
      correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID(),
    });

    const [wizard] = await ctx.db.raw
      .select()
      .from(openingBalancesWizard)
      .where(eq(openingBalancesWizard.tenantId, tenantId));
    if (wizard?.status === 'LOCKED') {
      throw new BusinessError('OPENING_BALANCES_LOCKED', 'Opening balances have been locked and cannot be modified');
    }

    const body = z.array(CustomerBalanceRow).safeParse(request.body);
    if (!body.success) throw new ValidationError(body.error.errors.map((e) => e.message).join('; '));

    // Validate all customers exist
    for (const row of body.data) {
      const [cust] = await ctx.db.raw.select().from(customers).where(and(eq(customers.id, row.customerId), eq(customers.tenantId, tenantId)));
      if (!cust) throw new NotFoundError('Customer', row.customerId);
    }

    // Upsert opening balances
    await ctx.db.raw.delete(openingBalances).where(and(eq(openingBalances.tenantId, tenantId), eq(openingBalances.entityType, 'CUSTOMER')));

    if (body.data.length > 0) {
      await ctx.db.raw.insert(openingBalances).values(
        body.data.map((row) => ({
          tenantId,
          entityType: 'CUSTOMER' as const,
          entityId: row.customerId,
          amount: String(row.amount),
          balanceType: row.balanceType,
          asOfDate: row.asOfDate,
          notes: row.notes,
          createdBy: userId,
        }))
      );
    }

    // Update wizard state
    await ctx.db.raw
      .insert(openingBalancesWizard)
      .values({ tenantId, customersCompleted: true, createdBy: userId, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: [openingBalancesWizard.tenantId],
        set: { customersCompleted: true, updatedAt: new Date() },
      });

    await ctx.audit.log({ action: 'CREATE', entityType: 'opening_balance', metadata: { entitySubType: 'CUSTOMER', count: body.data.length } });

    return reply.code(200).send({ data: { message: 'Customer opening balances saved', count: body.data.length } });
  });

  // ── POST /opening-balances/suppliers (batch) ──────────────────────────────
  fastify.post('/opening-balances/suppliers', { preHandler: [authenticate, requirePermission(PERMISSIONS.OPENING_BALANCE_LOCK)] }, async (request, reply) => {
    const { tenantId, userId } = (request as unknown as AuthedRequest).auth;
    const ctx = ctxFactory.create({
      tenantId,
      userId,
      correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID(),
    });

    const [wizard] = await ctx.db.raw
      .select()
      .from(openingBalancesWizard)
      .where(eq(openingBalancesWizard.tenantId, tenantId));
    if (wizard?.status === 'LOCKED') {
      throw new BusinessError('OPENING_BALANCES_LOCKED', 'Opening balances have been locked and cannot be modified');
    }

    const body = z.array(SupplierBalanceRow).safeParse(request.body);
    if (!body.success) throw new ValidationError(body.error.errors.map((e) => e.message).join('; '));

    for (const row of body.data) {
      const [sup] = await ctx.db.raw.select().from(suppliers).where(and(eq(suppliers.id, row.supplierId), eq(suppliers.tenantId, tenantId)));
      if (!sup) throw new NotFoundError('Supplier', row.supplierId);
    }

    await ctx.db.raw.delete(openingBalances).where(and(eq(openingBalances.tenantId, tenantId), eq(openingBalances.entityType, 'SUPPLIER')));

    if (body.data.length > 0) {
      await ctx.db.raw.insert(openingBalances).values(
        body.data.map((row) => ({
          tenantId,
          entityType: 'SUPPLIER' as const,
          entityId: row.supplierId,
          amount: String(row.amount),
          balanceType: row.balanceType,
          asOfDate: row.asOfDate,
          notes: row.notes,
          createdBy: userId,
        }))
      );
    }

    await ctx.db.raw
      .insert(openingBalancesWizard)
      .values({ tenantId, suppliersCompleted: true, createdBy: userId, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: [openingBalancesWizard.tenantId],
        set: { suppliersCompleted: true, updatedAt: new Date() },
      });

    await ctx.audit.log({ action: 'CREATE', entityType: 'opening_balance', metadata: { entitySubType: 'SUPPLIER', count: body.data.length } });

    return reply.code(200).send({ data: { message: 'Supplier opening balances saved', count: body.data.length } });
  });

  // ── POST /opening-balances/stock (batch) ──────────────────────────────────
  fastify.post('/opening-balances/stock', { preHandler: [authenticate, requirePermission(PERMISSIONS.OPENING_BALANCE_LOCK)] }, async (request, reply) => {
    const { tenantId, userId } = (request as unknown as AuthedRequest).auth;
    const ctx = ctxFactory.create({
      tenantId,
      userId,
      correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID(),
    });

    const [wizard] = await ctx.db.raw
      .select()
      .from(openingBalancesWizard)
      .where(eq(openingBalancesWizard.tenantId, tenantId));
    if (wizard?.status === 'LOCKED') {
      throw new BusinessError('OPENING_BALANCES_LOCKED', 'Opening balances have been locked and cannot be modified');
    }

    const body = z.array(StockBalanceRow).safeParse(request.body);
    if (!body.success) throw new ValidationError(body.error.errors.map((e) => e.message).join('; '));

    await ctx.db.raw.delete(openingBalances).where(and(eq(openingBalances.tenantId, tenantId), eq(openingBalances.entityType, 'STOCK')));

    if (body.data.length > 0) {
      await ctx.db.raw.insert(openingBalances).values(
        body.data.map((row) => ({
          tenantId,
          entityType: 'STOCK' as const,
          entityId: row.itemId,
          amount: String(row.quantity * row.unitCost),
          balanceType: 'DEBIT' as const,
          asOfDate: row.asOfDate,
          quantity: String(row.quantity),
          unitCost: String(row.unitCost),
          warehouseId: row.warehouseId,
          notes: row.notes,
          createdBy: userId,
        }))
      );
    }

    await ctx.db.raw
      .insert(openingBalancesWizard)
      .values({ tenantId, stockCompleted: true, createdBy: userId, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: [openingBalancesWizard.tenantId],
        set: { stockCompleted: true, updatedAt: new Date() },
      });

    await ctx.audit.log({ action: 'CREATE', entityType: 'opening_balance', metadata: { entitySubType: 'STOCK', count: body.data.length } });

    return reply.code(200).send({ data: { message: 'Stock opening balances saved', count: body.data.length } });
  });

  // ── POST /opening-balances/accounts (batch) ────────────────────────────────
  fastify.post('/opening-balances/accounts', { preHandler: [authenticate, requirePermission(PERMISSIONS.OPENING_BALANCE_LOCK)] }, async (request, reply) => {
    const { tenantId, userId } = (request as unknown as AuthedRequest).auth;
    const ctx = ctxFactory.create({
      tenantId,
      userId,
      correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID(),
    });

    const [wizard] = await ctx.db.raw
      .select()
      .from(openingBalancesWizard)
      .where(eq(openingBalancesWizard.tenantId, tenantId));
    if (wizard?.status === 'LOCKED') {
      throw new BusinessError('OPENING_BALANCES_LOCKED', 'Opening balances have been locked and cannot be modified');
    }

    const body = z.array(AccountBalanceRow).safeParse(request.body);
    if (!body.success) throw new ValidationError(body.error.errors.map((e) => e.message).join('; '));

    for (const row of body.data) {
      const [acc] = await ctx.db.raw.select().from(accounts).where(and(eq(accounts.id, row.accountId), eq(accounts.tenantId, tenantId)));
      if (!acc) throw new NotFoundError('Account', row.accountId);
    }

    await ctx.db.raw.delete(openingBalances).where(and(eq(openingBalances.tenantId, tenantId), eq(openingBalances.entityType, 'ACCOUNT')));

    if (body.data.length > 0) {
      await ctx.db.raw.insert(openingBalances).values(
        body.data.map((row) => ({
          tenantId,
          entityType: 'ACCOUNT' as const,
          entityId: row.accountId,
          amount: String(row.amount),
          balanceType: row.balanceType,
          asOfDate: row.asOfDate,
          notes: row.notes,
          createdBy: userId,
        }))
      );
    }

    await ctx.db.raw
      .insert(openingBalancesWizard)
      .values({ tenantId, accountsCompleted: true, createdBy: userId, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: [openingBalancesWizard.tenantId],
        set: { accountsCompleted: true, updatedAt: new Date() },
      });

    await ctx.audit.log({ action: 'CREATE', entityType: 'opening_balance', metadata: { entitySubType: 'ACCOUNT', count: body.data.length } });

    return reply.code(200).send({ data: { message: 'Account opening balances saved', count: body.data.length } });
  });

  // ── POST /opening-balances/cash-bank ─────────────────────────────────────
  fastify.post('/opening-balances/cash-bank', { preHandler: [authenticate, requirePermission(PERMISSIONS.OPENING_BALANCE_LOCK)] }, async (request, reply) => {
    const { tenantId, userId } = (request as unknown as AuthedRequest).auth;
    const ctx = ctxFactory.create({
      tenantId,
      userId,
      correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID(),
    });

    const [wizard] = await ctx.db.raw
      .select()
      .from(openingBalancesWizard)
      .where(eq(openingBalancesWizard.tenantId, tenantId));
    if (wizard?.status === 'LOCKED') {
      throw new BusinessError('OPENING_BALANCES_LOCKED', 'Opening balances have been locked and cannot be modified');
    }

    const body = z.array(CashBankRow).safeParse(request.body);
    if (!body.success) throw new ValidationError(body.error.errors.map((e) => e.message).join('; '));

    await ctx.db.raw.delete(openingBalances).where(and(eq(openingBalances.tenantId, tenantId), eq(openingBalances.entityType, 'CASH_BANK')));

    if (body.data.length > 0) {
      await ctx.db.raw.insert(openingBalances).values(
        body.data.map((row) => ({
          tenantId,
          entityType: 'CASH_BANK' as const,
          entityId: row.accountId,
          amount: String(row.amount),
          balanceType: row.balanceType,
          asOfDate: row.asOfDate,
          notes: row.notes,
          createdBy: userId,
        }))
      );
    }

    await ctx.db.raw
      .insert(openingBalancesWizard)
      .values({ tenantId, cashBankCompleted: true, createdBy: userId, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: [openingBalancesWizard.tenantId],
        set: { cashBankCompleted: true, updatedAt: new Date() },
      });

    await ctx.audit.log({ action: 'CREATE', entityType: 'opening_balance', metadata: { entitySubType: 'CASH_BANK', count: body.data.length } });

    return reply.code(200).send({ data: { message: 'Cash/Bank opening balances saved', count: body.data.length } });
  });

  // ── POST /opening-balances/lock — Lock after trial balance check ──────────
  fastify.post('/opening-balances/lock', { preHandler: [authenticate, requirePermission(PERMISSIONS.OPENING_BALANCE_LOCK)] }, async (request, reply) => {
    const { tenantId, userId } = (request as unknown as AuthedRequest).auth;
    const ctx = ctxFactory.create({
      tenantId,
      userId,
      correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID(),
    });

    const [wizard] = await ctx.db.raw.select().from(openingBalancesWizard).where(eq(openingBalancesWizard.tenantId, tenantId));

    if (!wizard) throw new BusinessError('NO_OPENING_BALANCES', 'No opening balances found to lock');
    if (wizard.status === 'LOCKED') throw new BusinessError('ALREADY_LOCKED', 'Opening balances are already locked');

    // Full trial balance check against the openingBalances staging table (locking does
    // not post to financial_entries anywhere in this codebase, so there is nothing else
    // to reconcile against). Stock's debit total is included in the overall DR=CR sum
    // rather than excluded, and any Accounts-step account that duplicates a sub-ledger
    // category (Customers/Suppliers/Stock/CashBank) is rejected as a double-entry.
    const allBalances = await ctx.db.raw
      .select()
      .from(openingBalances)
      .where(eq(openingBalances.tenantId, tenantId));

    const accountEntityIds = [
      ...new Set(
        allBalances
          .filter((b) => b.entityType === 'ACCOUNT' && b.entityId != null)
          .map((b) => b.entityId as number)
      ),
    ];
    const accountSubTypes =
      accountEntityIds.length > 0
        ? await ctx.db.raw
            .select({ id: accounts.id, accountSubType: accounts.accountSubType })
            .from(accounts)
            .where(and(eq(accounts.tenantId, tenantId), inArray(accounts.id, accountEntityIds)))
        : [];

    const check = validateOpeningBalanceTrialBalance(allBalances, accountSubTypes);

    if (check.doubleEntryViolations.length > 0) {
      const subTypes = [...new Set(check.doubleEntryViolations.map((v) => v.accountSubType))];
      throw new BusinessError(
        'OPENING_BALANCE_DOUBLE_ENTRY',
        `The Accounts step includes account(s) already represented via the Customers/Suppliers/Stock/CashBank steps (${subTypes.join(', ')}). Remove them from the Accounts step to avoid double-counting.`,
        { violations: check.doubleEntryViolations }
      );
    }

    if (!check.balanced) {
      throw new BusinessError(
        'TRIAL_BALANCE_MISMATCH',
        `Trial balance does not balance. Debit total: ${check.totalDebit.toFixed(2)}, Credit total: ${check.totalCredit.toFixed(2)}, Difference: ${check.overallDifference.toFixed(2)}`,
        { ...check.breakdown, overallDifference: check.overallDifference }
      );
    }

    const { totalDebit, totalCredit } = check;
    const lockedAt = new Date().toISOString();

    // ES-24 [C6]: lock write + outbox publish must be one atomic commit.
    await ctx.db.transaction(async (trx) => {
      await trx.raw
        .update(openingBalancesWizard)
        .set({ status: 'LOCKED', lockedAt: new Date(), lockedBy: userId, updatedAt: new Date() })
        .where(eq(openingBalancesWizard.tenantId, tenantId));

      const eventBus = new PlatformEventBus(trx, tenantId, userId, ctx.tenant.correlationId);
      await eventBus.publishInTransaction('opening_balance', tenantId, 'OPENING_BALANCES_LOCKED', { tenantId, lockedAt, totalDebit, totalCredit });
    });
    await ctx.audit.log({
      action: 'UPDATE',
      entityType: 'opening_balance',
      metadata: { action: 'LOCK', totalDebit, totalCredit, lockedAt },
    });

    return reply.code(200).send({
      data: {
        message: 'Opening balances locked successfully',
        lockedAt,
        totalDebit,
        totalCredit,
      },
    });
  });
}
