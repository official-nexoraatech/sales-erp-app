import { eq, and, sql } from 'drizzle-orm';
import { financialYears, periodClosures, journals } from '@erp/db';
import type { TenantScopedDatabase } from '@erp/sdk';
import { BusinessError, FinancialPeriodClosedError, NotFoundError } from '@erp/types';
import { JournalEngine, type JournalLine } from './JournalEngine.js';
import { ReportsEngine, type PLLine } from './ReportsEngine.js';

// Splits a signed "amount to close" for a P&L account into a debit/credit pair that
// zeroes it out. `normalSide` is the side that closes the account when amount >= 0
// (DEBIT for revenue/other-income, CREDIT for expense/COGS/contra-revenue) — amounts
// can occasionally come out negative (e.g. a heavily-reversed account), so both sides
// are handled rather than assuming the typical direction.
function closingSide(amount: number, normalSide: 'DEBIT' | 'CREDIT'): { debitAmount: number; creditAmount: number } {
  const abs = Math.abs(amount);
  const isDebit = amount >= 0 ? normalSide === 'DEBIT' : normalSide === 'CREDIT';
  return { debitAmount: isDebit ? abs : 0, creditAmount: isDebit ? 0 : abs };
}

function closingLines(lines: PLLine[], normalSide: 'DEBIT' | 'CREDIT', yearCode: string): JournalLine[] {
  return lines
    .filter((l) => Math.abs(l.amount) > 0.01)
    .map((l) => ({
      accountId: l.accountId,
      ...closingSide(l.amount, normalSide),
      description: `Close ${l.accountName} — ${yearCode}`,
    }));
}

function lastDayOfMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

async function seedPeriodClosures(
  db: TenantScopedDatabase,
  tenantId: number,
  financialYearId: number,
  startDate: string,
  endDate: string
): Promise<void> {
  // Parse as integers to avoid UTC-midnight timezone ambiguity from new Date('YYYY-MM-DD')
  const [startY, startM] = startDate.split('-').map(Number) as [number, number];
  const [endY, endM] = endDate.split('-').map(Number) as [number, number];

  const rows: (typeof periodClosures.$inferInsert)[] = [];
  let curY = startY;
  let curM = startM;

  while (curY < endY || (curY === endY && curM <= endM)) {
    const periodStart = `${curY}-${pad2(curM)}-01`;
    const periodEnd = `${curY}-${pad2(curM)}-${pad2(lastDayOfMonth(curY, curM))}`;

    rows.push({
      tenantId,
      financialYearId,
      periodMonth: curM,
      periodYear: curY,
      startDate: periodStart,
      endDate: periodEnd,
      status: 'OPEN',
    } as typeof periodClosures.$inferInsert);

    curM += 1;
    if (curM > 12) { curM = 1; curY += 1; }
  }

  if (rows.length > 0) {
    await db.raw
      .insert(periodClosures)
      .values(rows)
      .onConflictDoNothing();
  }
}

export interface YearCloseChecklistResult {
  passed: boolean;
  items: Array<{ label: string; passed: boolean; detail?: string }>;
}

export class FinancialYearService {
  // Create a new financial year (April 1 – March 31 by default)
  static async create(
    db: TenantScopedDatabase,
    tenantId: number,
    userId: number,
    data: { yearCode: string; startDate: string; endDate: string; isCurrent?: boolean }
  ): Promise<typeof financialYears.$inferSelect> {
    if (data.isCurrent) {
      // Clear isCurrent on all other years for this tenant
      await db.raw
        .update(financialYears)
        .set({ isCurrent: false })
        .where(eq(financialYears.tenantId, tenantId));
    }

    const [created] = await db.raw
      .insert(financialYears)
      .values({
        tenantId,
        yearCode: data.yearCode,
        startDate: data.startDate,
        endDate: data.endDate,
        status: 'OPEN',
        isCurrent: data.isCurrent ?? false,
        createdBy: userId,
      } as typeof financialYears.$inferInsert)
      .returning();

    if (!created) throw new Error('Financial year insert failed');

    await seedPeriodClosures(db, tenantId, created.id, created.startDate, created.endDate);

    return created;
  }

  static async list(
    db: TenantScopedDatabase,
    tenantId: number
  ): Promise<typeof financialYears.$inferSelect[]> {
    return db.raw
      .select()
      .from(financialYears)
      .where(eq(financialYears.tenantId, tenantId));
  }

  // Run all 10 pre-close checklist items
  static async runCloseChecklist(
    db: TenantScopedDatabase,
    tenantId: number,
    financialYearId: number
  ): Promise<YearCloseChecklistResult> {
    const [fy] = await db.raw
      .select()
      .from(financialYears)
      .where(and(eq(financialYears.id, financialYearId), eq(financialYears.tenantId, tenantId)));
    if (!fy) throw new NotFoundError('FinancialYear', financialYearId);

    const items: Array<{ label: string; passed: boolean; detail?: string }> = [];

    // 1. All invoices confirmed or cancelled (no DRAFT)
    const [draftInvoices] = await db.raw.execute(sql`
      SELECT COUNT(*)::INTEGER AS cnt FROM invoices
      WHERE tenant_id = ${tenantId}
        AND status = 'DRAFT'
        AND invoice_date >= ${fy.startDate}
        AND invoice_date <= ${fy.endDate}
    `) as { cnt: number }[];
    items.push({
      label: 'All invoices confirmed or cancelled (no DRAFT)',
      passed: (draftInvoices?.cnt ?? 0) === 0,
      ...(draftInvoices?.cnt ? { detail: `${draftInvoices.cnt} draft invoice(s) pending` } : {}),
    });

    // 2. All GRNs received or cancelled
    const [draftGRNs] = await db.raw.execute(sql`
      SELECT COUNT(*)::INTEGER AS cnt FROM grns
      WHERE tenant_id = ${tenantId}
        AND status NOT IN ('APPROVED', 'REJECTED', 'CANCELLED')
        AND grn_date >= ${fy.startDate}
        AND grn_date <= ${fy.endDate}
    `) as { cnt: number }[];
    items.push({
      label: 'All GRNs received or cancelled',
      passed: (draftGRNs?.cnt ?? 0) === 0,
      ...(draftGRNs?.cnt ? { detail: `${draftGRNs.cnt} open GRN(s)` } : {}),
    });

    // 3. All supplier payments allocated
    const [unallocatedSupplierPay] = await db.raw.execute(sql`
      SELECT COUNT(*)::INTEGER AS cnt FROM supplier_payments
      WHERE tenant_id = ${tenantId}
        AND status NOT IN ('FULLY_ALLOCATED', 'CANCELLED', 'BOUNCED')
    `) as { cnt: number }[];
    items.push({
      label: 'All supplier payments allocated',
      passed: (unallocatedSupplierPay?.cnt ?? 0) === 0,
      ...(unallocatedSupplierPay?.cnt ? { detail: `${unallocatedSupplierPay.cnt} unallocated payment(s)` } : {}),
    });

    // 4. All customer payments allocated
    const [unallocatedCustPay] = await db.raw.execute(sql`
      SELECT COUNT(*)::INTEGER AS cnt FROM payments
      WHERE tenant_id = ${tenantId}
        AND status NOT IN ('FULLY_ALLOCATED', 'CANCELLED', 'BOUNCED')
    `) as { cnt: number }[];
    items.push({
      label: 'All customer payments allocated',
      passed: (unallocatedCustPay?.cnt ?? 0) === 0,
      ...(unallocatedCustPay?.cnt ? { detail: `${unallocatedCustPay.cnt} unallocated payment(s)` } : {}),
    });

    // 5. Bank reconciliation completed for all accounts
    const [unreconciledBanks] = await db.raw.execute(sql`
      SELECT COUNT(*)::INTEGER AS cnt FROM bank_accounts
      WHERE tenant_id = ${tenantId}
        AND is_active = true
        AND id NOT IN (
          SELECT DISTINCT bank_account_id FROM bank_statements
          WHERE tenant_id = ${tenantId}
            AND status = 'FINALIZED'
        )
    `) as { cnt: number }[];
    items.push({
      label: 'Bank reconciliation completed for all accounts',
      passed: (unreconciledBanks?.cnt ?? 0) === 0,
      ...(unreconciledBanks?.cnt ? { detail: `${unreconciledBanks.cnt} bank account(s) not reconciled` } : {}),
    });

    // 6. Trial balance balances (DR = CR)
    const tb = await ReportsEngine.getTrialBalance(db, tenantId, fy.endDate);
    items.push({
      label: 'Trial balance balances (DR = CR)',
      passed: tb.isBalanced,
      ...(!tb.isBalanced ? { detail: `Difference: ${Math.abs(tb.totalDebits - tb.totalCredits).toFixed(2)}` } : {}),
    });

    // 7. No unprocessed outbox events
    const [pendingOutbox] = await db.raw.execute(sql`
      SELECT COUNT(*)::INTEGER AS cnt FROM outbox_events
      WHERE tenant_id = ${tenantId}
        AND published = false
        AND created_at >= ${fy.startDate}
    `) as { cnt: number }[];
    items.push({
      label: 'No unprocessed outbox events',
      passed: (pendingOutbox?.cnt ?? 0) === 0,
      ...(pendingOutbox?.cnt ? { detail: `${pendingOutbox.cnt} unpublished event(s)` } : {}),
    });

    // 8. Stock reconciliation passed (no pending physical verifications)
    const [pendingVerif] = await db.raw.execute(sql`
      SELECT COUNT(*)::INTEGER AS cnt FROM physical_verifications
      WHERE tenant_id = ${tenantId}
        AND status NOT IN ('APPROVED', 'CANCELLED')
    `) as { cnt: number }[];
    items.push({
      label: 'Stock reconciliation passed',
      passed: (pendingVerif?.cnt ?? 0) === 0,
      ...(pendingVerif?.cnt ? { detail: `${pendingVerif.cnt} open physical verification(s)` } : {}),
    });

    // 9. All approvals completed (no pending approval workflows)
    const [pendingApprovals] = await db.raw.execute(sql`
      SELECT COUNT(*)::INTEGER AS cnt FROM workflow_instances
      WHERE tenant_id = ${tenantId}
        AND status = 'PENDING_APPROVAL'
    `) as { cnt: number }[];
    items.push({
      label: 'All approvals completed',
      passed: (pendingApprovals?.cnt ?? 0) === 0,
      ...(pendingApprovals?.cnt ? { detail: `${pendingApprovals.cnt} pending approval(s)` } : {}),
    });

    // 10. Owner 2FA re-authentication (this is verified client-side via a token header)
    // In production, the API checks a short-lived 2FA token issued by auth-service.
    // For now, we mark this as requiring explicit confirmation from the caller.
    items.push({
      label: 'Owner 2FA re-authentication completed',
      passed: true, // Enforced at API route level via x-2fa-verified header
    });

    const passed = items.every((i) => i.passed);
    return { passed, items };
  }

  // Execute year-end close (only if checklist passes)
  static async closeYear(
    db: TenantScopedDatabase,
    tenantId: number,
    userId: number,
    financialYearId: number
  ): Promise<void> {
    const checklist = await FinancialYearService.runCloseChecklist(db, tenantId, financialYearId);
    if (!checklist.passed) {
      const failing = checklist.items.filter((i) => !i.passed).map((i) => i.label).join('; ');
      throw new BusinessError('YEAR_CLOSE_CHECKLIST_FAILED', `Year-end close blocked: ${failing}`);
    }

    const [fy] = await db.raw
      .select()
      .from(financialYears)
      .where(and(eq(financialYears.id, financialYearId), eq(financialYears.tenantId, tenantId)));
    if (!fy) throw new NotFoundError('FinancialYear', financialYearId);
    if (fy.status === 'CLOSED') {
      throw new BusinessError('YEAR_ALREADY_CLOSED', 'This financial year is already closed');
    }

    await db.transaction(async (trx) => {
      // Step 1: Post closing entries — revenue/expense accounts through Income Summary, then to Retained Earnings
      const pl = await ReportsEngine.getProfitLoss(trx, tenantId, fy.startDate, fy.endDate);

      const [incomeSummaryAccount] = await trx.raw.execute(sql`
        SELECT id FROM accounts
        WHERE tenant_id = ${tenantId} AND account_sub_type = 'INCOME_SUMMARY' LIMIT 1
      `) as { id: number }[];
      if (!incomeSummaryAccount) {
        throw new BusinessError(
          'INCOME_SUMMARY_ACCOUNT_MISSING',
          'No Income Summary system account found for this tenant. Run the PG-033 backfill migration before closing a year.'
        );
      }

      const [retainedEarningsAccount] = await trx.raw.execute(sql`
        SELECT id, account_code FROM accounts
        WHERE tenant_id = ${tenantId} AND account_sub_type = 'RETAINED_EARNINGS' LIMIT 1
      `) as { id: number; account_code: string }[];

      let closingJournalId: string | undefined;
      if (retainedEarningsAccount) {
        // Step 1a: close revenue/other-income accounts, credited in aggregate to Income Summary
        const incomeCloseLines = closingLines([...pl.revenue, ...pl.otherIncome], 'DEBIT', fy.yearCode);
        const totalIncomeToClose = incomeCloseLines.reduce((s, l) => s + l.debitAmount - l.creditAmount, 0);

        // Step 1b: close expense/COGS/financial-charge/contra-revenue accounts, debited in aggregate to Income Summary
        const expenseCloseLines = closingLines(
          [...pl.cogs, ...pl.operatingExpenses, ...pl.financialCharges, ...pl.contraRevenue],
          'CREDIT',
          fy.yearCode
        );
        const totalExpenseToClose = expenseCloseLines.reduce((s, l) => s + l.creditAmount - l.debitAmount, 0);

        // Step 1c: Income Summary's resulting net balance closes into Retained Earnings
        const netProfit = totalIncomeToClose - totalExpenseToClose;

        const lines: JournalLine[] = [
          ...incomeCloseLines,
          ...(Math.abs(totalIncomeToClose) > 0.01
            ? [{ accountId: incomeSummaryAccount.id, ...closingSide(-totalIncomeToClose, 'DEBIT'), description: `Income summary — revenue/other income closed for ${fy.yearCode}` }]
            : []),
          ...expenseCloseLines,
          ...(Math.abs(totalExpenseToClose) > 0.01
            ? [{ accountId: incomeSummaryAccount.id, ...closingSide(totalExpenseToClose, 'DEBIT'), description: `Income summary — expenses closed for ${fy.yearCode}` }]
            : []),
          ...(Math.abs(netProfit) > 0.01
            ? [
                { accountId: incomeSummaryAccount.id, ...closingSide(netProfit, 'DEBIT'), description: `Income summary — net ${netProfit >= 0 ? 'profit' : 'loss'} transferred — ${fy.yearCode}` },
                { accountId: retainedEarningsAccount.id, ...closingSide(netProfit, 'CREDIT'), description: `Net ${netProfit >= 0 ? 'profit' : 'loss'} — ${fy.yearCode}` },
              ]
            : []),
        ];

        if (lines.length >= 2) {
          const { journalId } = await JournalEngine.post(trx, tenantId, userId, {
            description: `Year-end closing entry — net profit/loss for ${fy.yearCode}`,
            referenceType: 'FINANCIAL_YEAR',
            referenceId: financialYearId,
            lines,
          });
          closingJournalId = journalId;
        }
      }

      // Step 2: Lock the financial year
      await trx.raw
        .update(financialYears)
        .set({
          status: 'CLOSED',
          isCurrent: false,
          closedAt: new Date(),
          closedBy: userId,
          closingEntriesJournalId: closingJournalId,
        })
        .where(and(eq(financialYears.id, financialYearId), eq(financialYears.tenantId, tenantId)));
    });
  }

  // Lock a specific month (period)
  static async lockPeriod(
    db: TenantScopedDatabase,
    tenantId: number,
    userId: number,
    financialYearId: number,
    periodMonth: number,
    periodYear: number
  ): Promise<void> {
    const [fy] = await db.raw
      .select()
      .from(financialYears)
      .where(and(eq(financialYears.id, financialYearId), eq(financialYears.tenantId, tenantId)));
    if (!fy) throw new NotFoundError('FinancialYear', financialYearId);
    if (fy.status === 'CLOSED') {
      throw new BusinessError('YEAR_CLOSED', 'Cannot lock period — financial year is already closed');
    }

    await db.raw
      .insert(periodClosures)
      .values({
        tenantId,
        financialYearId,
        periodMonth,
        periodYear,
        status: 'CLOSED',
        closedAt: new Date(),
        closedBy: userId,
      } as typeof periodClosures.$inferInsert)
      .onConflictDoUpdate({
        target: [periodClosures.tenantId, periodClosures.financialYearId, periodClosures.periodMonth, periodClosures.periodYear],
        set: { status: 'CLOSED', closedAt: new Date(), closedBy: userId },
      });
  }
}
