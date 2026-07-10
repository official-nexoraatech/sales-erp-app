import type { FastifyInstance } from 'fastify';
import type { PlatformContextFactory } from '@erp/sdk';
import { z } from 'zod';
import { ValidationError, OptionalIFSCSchema, OptionalBankAccountSchema } from '@erp/types';
import { PERMISSIONS } from '@erp/types';
import { authenticate } from '../middleware/authenticate.js';
import { requirePermission } from '../middleware/authorize.js';
import { BankReconciliationService, type BankStatementRow } from '../domain/BankReconciliationService.js';

type AuthedRequest = { auth: { tenantId: number; userId: number } };

const CreateBankAccountSchema = z.object({
  accountId: z.number().int().positive(),
  bankName: z.string().min(1).max(200),
  accountNumber: OptionalBankAccountSchema,
  ifscCode: OptionalIFSCSchema,
  branchName: z.string().max(200).optional(),
});

const FinalizeReconciliationSchema = z.object({
  statementId: z.number().int().positive(),
});

const ImportStatementSchema = z.object({
  openingBalance: z.number(),
  closingBalance: z.number(),
  rows: z.array(
    z.object({
      date: z.string().length(10),
      description: z.string().min(1).max(500),
      debitAmount: z.number().min(0).default(0),
      creditAmount: z.number().min(0).default(0),
      referenceNumber: z.string().max(100).optional(),
    })
  ).min(1),
});

const MatchItemSchema = z.object({
  matchedItemId: z.number().int().positive(),
});

export async function bankRoutes(
  fastify: FastifyInstance,
  ctxFactory: PlatformContextFactory
): Promise<void> {
  // ── POST /bank-accounts ───────────────────────────────────────────────────
  fastify.post(
    '/bank-accounts',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.BANK_RECONCILIATION_DO)] },
    async (request, reply) => {
      const { tenantId, userId } = (request as unknown as AuthedRequest).auth;
      const ctx = ctxFactory.create({ tenantId, userId, correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID() });

      const body = CreateBankAccountSchema.safeParse(request.body);
      if (!body.success) throw new ValidationError(body.error.errors.map((e) => e.message).join('; '));

      const data = await BankReconciliationService.createBankAccount(ctx.db, tenantId, userId, {
        accountId: body.data.accountId,
        bankName: body.data.bankName,
        ...(body.data.accountNumber ? { accountNumber: body.data.accountNumber } : {}),
        ...(body.data.ifscCode ? { ifscCode: body.data.ifscCode } : {}),
        ...(body.data.branchName ? { branchName: body.data.branchName } : {}),
      });
      return reply.code(201).send({ data });
    }
  );

  // ── POST /bank-reconciliation/:accountId/import ───────────────────────────
  fastify.post<{ Params: { accountId: string } }>(
    '/bank-reconciliation/:accountId/import',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.BANK_RECONCILIATION_DO)] },
    async (request, reply) => {
      const { tenantId, userId } = (request as unknown as AuthedRequest).auth;
      const ctx = ctxFactory.create({ tenantId, userId, correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID() });
      const bankAccountId = parseInt(request.params.accountId, 10);

      const body = ImportStatementSchema.safeParse(request.body);
      if (!body.success) throw new ValidationError(body.error.errors.map((e) => e.message).join('; '));

      const result = await BankReconciliationService.importStatement(
        ctx.db,
        tenantId,
        userId,
        bankAccountId,
        body.data.rows as BankStatementRow[],
        body.data.openingBalance,
        body.data.closingBalance
      );

      return reply.code(201).send({ data: result });
    }
  );

  // ── GET /bank-reconciliation/:accountId/items ─────────────────────────────
  fastify.get<{ Params: { accountId: string } }>(
    '/bank-reconciliation/:accountId/items',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.BANK_RECONCILIATION_VIEW)] },
    async (request, reply) => {
      const { tenantId, userId } = (request as unknown as AuthedRequest).auth;
      const ctx = ctxFactory.create({ tenantId, userId, correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID() });
      const bankAccountId = parseInt(request.params.accountId, 10);

      const items = await BankReconciliationService.getItems(ctx.db, tenantId, bankAccountId);
      return reply.code(200).send({ data: { content: items, totalElements: items.length } });
    }
  );

  // ── POST /bank-reconciliation/:accountId/items/:itemId/match ─────────────
  fastify.post<{ Params: { accountId: string; itemId: string } }>(
    '/bank-reconciliation/:accountId/items/:itemId/match',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.BANK_RECONCILIATION_DO)] },
    async (request, reply) => {
      const { tenantId, userId } = (request as unknown as AuthedRequest).auth;
      const ctx = ctxFactory.create({ tenantId, userId, correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID() });
      const itemId = parseInt(request.params.itemId, 10);

      const body = MatchItemSchema.safeParse(request.body);
      if (!body.success) throw new ValidationError(body.error.errors.map((e) => e.message).join('; '));

      await BankReconciliationService.matchItem(ctx.db, tenantId, userId, itemId, body.data.matchedItemId);
      return reply.code(200).send({ data: { message: 'Items matched' } });
    }
  );

  // ── GET /bank-reconciliation/:accountId/summary ───────────────────────────
  fastify.get<{ Params: { accountId: string } }>(
    '/bank-reconciliation/:accountId/summary',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.BANK_RECONCILIATION_VIEW)] },
    async (request, reply) => {
      const { tenantId, userId } = (request as unknown as AuthedRequest).auth;
      const ctx = ctxFactory.create({ tenantId, userId, correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID() });
      const bankAccountId = parseInt(request.params.accountId, 10);

      const summary = await BankReconciliationService.getSummary(ctx.db, tenantId, bankAccountId);
      return reply.code(200).send({ data: summary });
    }
  );

  // ── POST /bank-reconciliation/:accountId/finalize ─────────────────────────
  fastify.post<{ Params: { accountId: string } }>(
    '/bank-reconciliation/:accountId/finalize',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.BANK_RECONCILIATION_DO)] },
    async (request, reply) => {
      const { tenantId, userId } = (request as unknown as AuthedRequest).auth;
      const ctx = ctxFactory.create({ tenantId, userId, correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID() });
      const bankAccountId = parseInt(request.params.accountId, 10);
      const { statementId } = FinalizeReconciliationSchema.parse(request.body);

      await BankReconciliationService.finalizeReconciliation(ctx.db, tenantId, bankAccountId, statementId);
      return reply.code(200).send({ data: { message: 'Reconciliation finalized' } });
    }
  );
}
