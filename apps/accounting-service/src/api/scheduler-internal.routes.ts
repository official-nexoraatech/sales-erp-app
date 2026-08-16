/* global process, fetch, crypto */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { PlatformContextFactory } from '@erp/sdk';
import { bankAccounts, tenants, trialBalanceSnapshots, financialYears } from '@erp/db';
import { and, eq } from 'drizzle-orm';
import { timingSafeEqual } from 'node:crypto';
import { ReportsEngine } from '../domain/ReportsEngine.js';
import { BankReconciliationService } from '../domain/BankReconciliationService.js';
import { seedDefaultAccounts } from '../domain/default-accounts.js';
import { FixedAssetService } from '../domain/FixedAssetService.js';
import { FinancialYearService } from '../domain/FinancialYearService.js';

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
    await reply
      .code(401)
      .send({ error: { code: 'UNAUTHENTICATED', message: 'Invalid internal API key' } });
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
  fastify.post(
    '/internal/reports/trial-balance-snapshot',
    { preHandler: checkInternalKey },
    async (request, reply) => {
      const tenantId = parseInt((request.query as { tenantId?: string }).tenantId ?? '', 10);
      if (!tenantId)
        return reply
          .code(400)
          .send({ error: { code: 'MISSING_TENANT_ID', message: 'tenantId query param required' } });

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
          set: {
            totalDebit: tb.totalDebits.toFixed(2),
            totalCredit: tb.totalCredits.toFixed(2),
            isBalanced: tb.isBalanced,
            accountCount: tb.lines.length,
          },
        });

      return reply.code(200).send({
        data: {
          asOfDate,
          totalDebit: tb.totalDebits,
          totalCredit: tb.totalCredits,
          isBalanced: tb.isBalanced,
          accountCount: tb.lines.length,
        },
      });
    }
  );

  // ── POST /internal/bank-reconciliation/reminder?tenantId=... ─────────────
  fastify.post(
    '/internal/bank-reconciliation/reminder',
    { preHandler: checkInternalKey },
    async (request, reply) => {
      const tenantId = parseInt((request.query as { tenantId?: string }).tenantId ?? '', 10);
      if (!tenantId)
        return reply
          .code(400)
          .send({ error: { code: 'MISSING_TENANT_ID', message: 'tenantId query param required' } });

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
        const [tenant] = await ctx.db.raw
          .select({ contactEmail: tenants.contactEmail })
          .from(tenants)
          .where(eq(tenants.id, tenantId));
        if (tenant?.contactEmail) {
          const notificationUrl =
            process.env['NOTIFICATION_SERVICE_URL'] ?? 'http://localhost:3014';
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

      return reply
        .code(200)
        .send({ data: { accountsChecked: accounts.length, unreconciledAccounts, totalUnmatched } });
    }
  );

  // ── POST /internal/fixed-assets/depreciation/run?tenantId=... ────────────
  // Audit finding 2026-07-23: FixedAssetService.runMonthlyDepreciationBatch was only reachable
  // via the authenticated user-facing route (fixed-assets.routes.ts) — no scheduler job called
  // it, so depreciation silently never ran unless someone manually clicked "Run Depreciation"
  // every month. Mirrors the trial-balance-snapshot job above (tenantScoped monthly cron calling
  // this internal endpoint). runMonthlyDepreciationBatch is itself idempotent per (asset, month,
  // year) — see its own guard — so a re-run or a slightly-late run is safe.
  fastify.post(
    '/internal/fixed-assets/depreciation/run',
    { preHandler: checkInternalKey },
    async (request, reply) => {
      const tenantId = parseInt((request.query as { tenantId?: string }).tenantId ?? '', 10);
      if (!tenantId)
        return reply
          .code(400)
          .send({ error: { code: 'MISSING_TENANT_ID', message: 'tenantId query param required' } });

      const ctx = ctxFactory.create({ tenantId, userId: 0, correlationId: crypto.randomUUID() });
      const now = new Date();
      const result = await FixedAssetService.runMonthlyDepreciationBatch(
        ctx.db,
        tenantId,
        0,
        now.getUTCMonth() + 1,
        now.getUTCFullYear()
      );

      return reply.code(200).send({ data: result });
    }
  );

  // ── POST /internal/accounts/seed?tenantId=... ─────────────────────────────
  // Found in live QA 2026-07-17: TenantProvisioner's 10 provisioning steps never seeded a
  // Chart of Accounts for any tenant — every journal post silently failed with
  // JOURNAL_INSUFFICIENT_LINES until someone manually found and clicked "Seed Default
  // Accounts" on the Chart of Accounts page. Called from TenantProvisioner now; see
  // migration 0073 for the existing-tenant backfill.
  fastify.post(
    '/internal/accounts/seed',
    { preHandler: checkInternalKey },
    async (request, reply) => {
      const query = request.query as { tenantId?: string; vertical?: string };
      const tenantId = parseInt(query.tenantId ?? '', 10);
      if (!tenantId)
        return reply
          .code(400)
          .send({ error: { code: 'MISSING_TENANT_ID', message: 'tenantId query param required' } });

      const ctx = ctxFactory.create({ tenantId, userId: 0, correlationId: crypto.randomUUID() });
      const vertical = query.vertical === 'GROCERY' ? 'GROCERY' : 'CLOTH_RETAIL';
      const count = await seedDefaultAccounts(ctx, tenantId, 0, vertical);

      return reply.code(200).send({ data: { message: 'Chart of accounts seeded', count } });
    }
  );

  // ── POST /internal/financial-years/seed?tenantId=... ─────────────────────
  // Product audit 2026-07-31 (Phase 1, Step 7): documented since 2026-07-13 as a manual
  // go-live blocker — TenantProvisioner never created a Financial Year for any tenant, so
  // every new tenant's Balance Sheet/Trial Balance showed meaningless figures until someone
  // remembered to create one by hand via Settings. Creates the FY containing today's date
  // (April 1 – March 31, the Indian FY convention this codebase already assumes elsewhere —
  // see report-service's NumberSeriesEngine.getCurrentFinancialYear()), marked isCurrent.
  // Idempotent like /internal/accounts/seed above — a re-run for a tenant that already has a
  // financial year is a safe no-op, not a duplicate.
  fastify.post(
    '/internal/financial-years/seed',
    { preHandler: checkInternalKey },
    async (request, reply) => {
      const tenantId = parseInt((request.query as { tenantId?: string }).tenantId ?? '', 10);
      if (!tenantId)
        return reply
          .code(400)
          .send({ error: { code: 'MISSING_TENANT_ID', message: 'tenantId query param required' } });

      const ctx = ctxFactory.create({ tenantId, userId: 0, correlationId: crypto.randomUUID() });

      const [existing] = await ctx.db.raw
        .select({ id: financialYears.id })
        .from(financialYears)
        .where(eq(financialYears.tenantId, tenantId))
        .limit(1);
      if (existing) {
        return reply.code(200).send({
          data: { message: 'Tenant already has a financial year — no-op', created: false },
        });
      }

      const now = new Date();
      const month = now.getUTCMonth() + 1;
      const calendarYear = now.getUTCFullYear();
      const startYear = month >= 4 ? calendarYear : calendarYear - 1;
      const endYear = startYear + 1;

      const created = await FinancialYearService.create(ctx.db, tenantId, 0, {
        yearCode: `FY${startYear}-${String(endYear).slice(2)}`,
        startDate: `${startYear}-04-01`,
        endDate: `${endYear}-03-31`,
        isCurrent: true,
      });

      return reply.code(200).send({
        data: { message: 'First financial year created', created: true, financialYear: created },
      });
    }
  );
}
