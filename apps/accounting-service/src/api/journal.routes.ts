import type { FastifyInstance } from 'fastify';
import type { PlatformContextFactory } from '@erp/sdk';
import { z } from 'zod';
import { eq, and, sql } from 'drizzle-orm';
import { journals, financialEntries, accounts } from '@erp/db';
import { NotFoundError, ValidationError } from '@erp/types';
import { PERMISSIONS } from '@erp/types';
import { authenticate } from '../middleware/authenticate.js';
import { requirePermission } from '../middleware/authorize.js';
import { JournalEngine } from '../domain/JournalEngine.js';

type AuthedRequest = { auth: { tenantId: number; userId: number } };

const ReverseJournalSchema = z.object({
  reason: z.string().max(500).optional(),
});

const ManualJournalSchema = z.object({
  description: z.string().min(1).max(500),
  referenceType: z.string().max(50).optional(),
  referenceId: z.number().int().positive().optional(),
  lines: z
    .array(
      z.object({
        accountId: z.number().int().positive(),
        debitAmount: z.number().min(0).default(0),
        creditAmount: z.number().min(0).default(0),
        description: z.string().max(300).optional(),
        narration: z.string().max(500).optional(),
      })
    )
    .min(2, 'A journal must have at least 2 lines'),
});

export async function journalRoutes(
  fastify: FastifyInstance,
  ctxFactory: PlatformContextFactory
): Promise<void> {
  // ── GET /journals — List journals for tenant ──────────────────────────────
  fastify.get(
    '/journals',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.JOURNAL_VIEW)] },
    async (request, reply) => {
      const { tenantId, userId } = (request as unknown as AuthedRequest).auth;
      const ctx = ctxFactory.create({ tenantId, userId, correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID() });
      const query = request.query as { page?: string; size?: string; referenceType?: string; referenceId?: string };
      const page = Math.max(0, parseInt(query.page ?? '0', 10));
      const size = Math.min(100, Math.max(1, parseInt(query.size ?? '20', 10)));

      const conditions = [eq(journals.tenantId, tenantId)];
      if (query.referenceType) {
        conditions.push(eq(journals.referenceType, query.referenceType));
      }
      if (query.referenceId) {
        conditions.push(eq(journals.referenceId, parseInt(query.referenceId, 10)));
      }

      const [countRow] = await ctx.db.raw
        .select({ count: sql<number>`COUNT(*)::INTEGER` })
        .from(journals)
        .where(and(...conditions));

      const rows = await ctx.db.raw
        .select()
        .from(journals)
        .where(and(...conditions))
        .limit(size)
        .offset(page * size);

      return reply.code(200).send({
        data: {
          content: rows,
          totalElements: countRow?.count ?? 0,
          page,
          size,
        },
      });
    }
  );

  // ── GET /journals/:id — Journal with all lines ────────────────────────────
  fastify.get<{ Params: { id: string } }>(
    '/journals/:id',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.JOURNAL_VIEW)] },
    async (request, reply) => {
      const { tenantId, userId } = (request as unknown as AuthedRequest).auth;
      const ctx = ctxFactory.create({ tenantId, userId, correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID() });
      const journalId = request.params.id;

      const [journal] = await ctx.db.raw
        .select()
        .from(journals)
        .where(and(eq(journals.journalId, journalId), eq(journals.tenantId, tenantId)));
      if (!journal) throw new NotFoundError('Journal', journalId);

      const lines = await ctx.db.raw
        .select({
          id: financialEntries.id,
          accountId: financialEntries.accountId,
          accountCode: accounts.accountCode,
          accountName: accounts.name,
          debitAmount: financialEntries.debitAmount,
          creditAmount: financialEntries.creditAmount,
          description: financialEntries.description,
          narration: financialEntries.narration,
        })
        .from(financialEntries)
        .innerJoin(accounts, and(eq(accounts.id, financialEntries.accountId), eq(accounts.tenantId, tenantId)))
        .where(and(eq(financialEntries.journalId, journalId), eq(financialEntries.tenantId, tenantId)));

      return reply.code(200).send({ data: { ...journal, lines } });
    }
  );

  // ── POST /journals — Manual journal entry ────────────────────────────────
  fastify.post(
    '/journals',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.JOURNAL_CREATE)] },
    async (request, reply) => {
      const { tenantId, userId } = (request as unknown as AuthedRequest).auth;
      const ctx = ctxFactory.create({ tenantId, userId, correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID() });

      const body = ManualJournalSchema.safeParse(request.body);
      if (!body.success) throw new ValidationError(body.error.errors.map((e) => e.message).join('; '));

      await JournalEngine.checkPeriodOpen(ctx.db, tenantId, new Date());

      const result = await JournalEngine.post(ctx.db, tenantId, userId, {
        description: body.data.description,
        ...(body.data.referenceType ? { referenceType: body.data.referenceType } : {}),
        ...(body.data.referenceId !== undefined ? { referenceId: body.data.referenceId } : {}),
        lines: body.data.lines.map((l) => ({
          accountId: l.accountId,
          debitAmount: l.debitAmount,
          creditAmount: l.creditAmount,
          ...(l.description ? { description: l.description } : {}),
          ...(l.narration ? { narration: l.narration } : {}),
        })),
      }, ctx.tenant.correlationId);

      await ctx.audit.log({
        action: 'CREATE',
        entityType: 'journal',
        metadata: { journalId: result.journalId },
      });

      // JournalEngine.post() already writes a JOURNAL_POSTED outbox event (with the correct
      // numeric aggregateId) inside its own transaction — no separate publish needed here.

      return reply.code(201).send({ data: result });
    }
  );

  // ── POST /journals/:id/reverse — Reverse a posted journal ────────────────
  fastify.post<{ Params: { id: string } }>(
    '/journals/:id/reverse',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.CANCEL_POSTED_JOURNAL)] },
    async (request, reply) => {
      const { tenantId, userId } = (request as unknown as AuthedRequest).auth;
      const ctx = ctxFactory.create({ tenantId, userId, correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID() });
      const journalId = request.params.id;
      const { reason } = ReverseJournalSchema.parse(request.body ?? {});

      const result = await JournalEngine.reverse(ctx.db, tenantId, userId, journalId, reason, ctx.tenant.correlationId);

      await ctx.audit.log({
        action: 'UPDATE',
        entityType: 'journal',
        metadata: { action: 'REVERSE', originalJournalId: journalId, reversalJournalId: result.journalId },
      });

      return reply.code(201).send({ data: result });
    }
  );

  // ── GET /accounts/:id/ledger — Account ledger with all transactions ───────
  fastify.get<{ Params: { id: string } }>(
    '/accounts/:id/ledger',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.LEDGER_VIEW)] },
    async (request, reply) => {
      const { tenantId, userId } = (request as unknown as AuthedRequest).auth;
      const ctx = ctxFactory.create({ tenantId, userId, correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID() });
      const accountId = parseInt(request.params.id, 10);
      const query = request.query as { fromDate?: string; toDate?: string; page?: string; size?: string };

      const [account] = await ctx.db.raw
        .select()
        .from(accounts)
        .where(and(eq(accounts.id, accountId), eq(accounts.tenantId, tenantId)));
      if (!account) throw new NotFoundError('Account', accountId);

      const fromDate = query.fromDate ?? new Date(new Date().getFullYear(), 3, 1).toISOString().substring(0, 10);
      const toDate = query.toDate ?? new Date().toISOString().substring(0, 10);
      const page = Math.max(0, parseInt(query.page ?? '0', 10));
      const size = Math.min(200, Math.max(1, parseInt(query.size ?? '50', 10)));

      // Compute running balance using window function
      const rows = await ctx.db.raw.execute(sql`
        SELECT
          fe.id,
          fe.journal_id AS "journalId",
          j.description,
          j.reference_type AS "referenceType",
          j.reference_id AS "referenceId",
          fe.debit_amount AS "debitAmount",
          fe.credit_amount AS "creditAmount",
          fe.created_at AS "transactionDate",
          SUM(fe.debit_amount - fe.credit_amount)
            OVER (ORDER BY fe.created_at, fe.id ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW)
            AS "runningBalance"
        FROM financial_entries fe
        JOIN journals j ON j.journal_id = fe.journal_id AND j.tenant_id = fe.tenant_id
        WHERE fe.tenant_id = ${tenantId}
          AND fe.account_id = ${accountId}
          AND fe.created_at >= ${fromDate}::DATE
          AND fe.created_at <= (${toDate}::DATE + INTERVAL '1 day')
        ORDER BY fe.created_at, fe.id
        LIMIT ${size} OFFSET ${page * size}
      `);

      const [totalRow] = await ctx.db.raw.execute(sql`
        SELECT COUNT(*)::INTEGER AS cnt FROM financial_entries
        WHERE tenant_id = ${tenantId}
          AND account_id = ${accountId}
          AND created_at >= ${fromDate}::DATE
          AND created_at <= (${toDate}::DATE + INTERVAL '1 day')
      `) as { cnt: number }[];

      return reply.code(200).send({
        data: {
          accountId,
          accountCode: account.accountCode,
          accountName: account.name,
          normalBalance: account.normalBalance,
          fromDate,
          toDate,
          transactions: rows,
          totalElements: totalRow?.cnt ?? 0,
          page,
          size,
        },
      });
    }
  );
}
