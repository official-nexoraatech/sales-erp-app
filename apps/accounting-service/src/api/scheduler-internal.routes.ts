/* global process, fetch, crypto */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { PlatformContextFactory } from '@erp/sdk';
import { bankAccounts, tenants, trialBalanceSnapshots } from '@erp/db';
import { and, eq } from 'drizzle-orm';
import { timingSafeEqual } from 'node:crypto';
import { ReportsEngine } from '../domain/ReportsEngine.js';
import { BankReconciliationService } from '../domain/BankReconciliationService.js';

async function checkInternalKey(req: FastifyRequest, reply: FastifyReply): Promise<boolean> {
  const key = req.headers['x-internal-key'];
  const expected = process.env['INTERNAL_API_KEY'];
  const keyBuffer = Buffer.from(typeof key === 'string' ? key : '');
  const expectedBuffer = Buffer.from(expected ?? '');
  const matches =
    !!expected &&
    keyBuffer.length === expectedBuffer.length &&
    timingSafeEqual(keyBuffer, expectedBuffer);
  if (!matches) {
    await reply.code(401).send({ error: { code: 'UNAUTHENTICATED', message: 'Invalid internal API key' } });
  }
  return matches;
}

// PG-026: internal (x-internal-key-guarded) endpoints called by scheduler-service's
// tenantScoped cron jobs — see apps/scheduler-service/src/jobs/system-jobs.ts's
// accounting.trial-balance.snapshot / accounting.bank-reconciliation-reminder.
export async function schedulerInternalRoutes(
  fastify: FastifyInstance,
  ctxFactory: PlatformContextFactory
): Promise<void> {
  // ── POST /internal/reports/trial-balance-snapshot?tenantId=... ───────────
  fastify.post('/internal/reports/trial-balance-snapshot', { preHandler: checkInternalKey }, async (request, reply) => {
    const tenantId = parseInt((request.query as { tenantId?: string }).tenantId ?? '', 10);
    if (!tenantId) return reply.code(400).send({ error: { code: 'MISSING_TENANT_ID', message: 'tenantId query param required' } });

    const ctx = ctxFactory.create({ tenantId, userId: 0, correlationId: crypto.randomUUID() });
    const asOfDate = new Date().toISOString().slice(0, 10);
    const tb = await ReportsEngine.getTrialBalance(ctx.db, tenantId, asOfDate);

    await ctx.db.raw
      .insert(trialBalanceSnapshots)
      .values({
        tenantId,
        asOfDate,
        totalDebit: tb.totalDebits.toFixed(2),
        totalCredit: tb.totalCredits.toFixed(2),
        isBalanced: tb.isBalanced,
        accountCount: tb.lines.length,
      })
      .onConflictDoUpdate({
        target: [trialBalanceSnapshots.tenantId, trialBalanceSnapshots.asOfDate],
        set: { totalDebit: tb.totalDebits.toFixed(2), totalCredit: tb.totalCredits.toFixed(2), isBalanced: tb.isBalanced, accountCount: tb.lines.length },
      });

    return reply.code(200).send({ data: { asOfDate, totalDebit: tb.totalDebits, totalCredit: tb.totalCredits, isBalanced: tb.isBalanced, accountCount: tb.lines.length } });
  });

  // ── POST /internal/bank-reconciliation/reminder?tenantId=... ─────────────
  fastify.post('/internal/bank-reconciliation/reminder', { preHandler: checkInternalKey }, async (request, reply) => {
    const tenantId = parseInt((request.query as { tenantId?: string }).tenantId ?? '', 10);
    if (!tenantId) return reply.code(400).send({ error: { code: 'MISSING_TENANT_ID', message: 'tenantId query param required' } });

    const ctx = ctxFactory.create({ tenantId, userId: 0, correlationId: crypto.randomUUID() });
    const accounts = await ctx.db.raw
      .select()
      .from(bankAccounts)
      .where(and(eq(bankAccounts.tenantId, tenantId), eq(bankAccounts.isActive, true)));

    let unreconciledAccounts = 0;
    let totalUnmatched = 0;
    for (const account of accounts) {
      const summary = await BankReconciliationService.getSummary(ctx.db, tenantId, account.id);
      if (!summary.isReconciled) {
        unreconciledAccounts += 1;
        totalUnmatched += summary.unmatchedBankItems + summary.unmatchedBookItems;
      }
    }

    if (unreconciledAccounts > 0) {
      const [tenant] = await ctx.db.raw.select({ contactEmail: tenants.contactEmail }).from(tenants).where(eq(tenants.id, tenantId));
      if (tenant?.contactEmail) {
        const notificationUrl = process.env['NOTIFICATION_SERVICE_URL'] ?? 'http://localhost:3014';
        const apiKey = process.env['INTERNAL_API_KEY'] ?? '';
        try {
          await fetch(`${notificationUrl}/notifications/send-raw-internal`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-internal-key': apiKey },
            body: JSON.stringify({
              tenantId,
              eventType: 'BANK_RECONCILIATION_REMINDER',
              channel: 'EMAIL',
              recipientEmail: tenant.contactEmail,
              subject: 'Weekly bank reconciliation reminder',
              body: `${unreconciledAccounts} bank account(s) have ${totalUnmatched} unmatched item(s) pending reconciliation.`,
            }),
          });
        } catch {
          // best-effort — the response below still reports the real counts either way
        }
      }
    }

    return reply.code(200).send({ data: { accountsChecked: accounts.length, unreconciledAccounts, totalUnmatched } });
  });
}
