import { sql } from 'drizzle-orm';
import type { TenantScopedDatabase } from '@erp/sdk';

// ─── Types ────────────────────────────────────────────────────────────────

export interface TrialBalanceLine {
  accountId: number;
  accountCode: string;
  accountName: string;
  accountType: string;
  openingBalance: number;
  openingBalanceType: 'DEBIT' | 'CREDIT';
  periodDebits: number;
  periodCredits: number;
  closingDebit: number;
  closingCredit: number;
}

export interface TrialBalanceReport {
  asOf: string;
  lines: TrialBalanceLine[];
  totalDebits: number;
  totalCredits: number;
  isBalanced: boolean;
  generatedAt: string;
}

export interface PLLine {
  accountId: number;
  accountCode: string;
  accountName: string;
  amount: number;
  previousAmount?: number;
}

export interface ProfitLossReport {
  from: string;
  to: string;
  revenue: PLLine[];
  totalRevenue: number;
  cogs: PLLine[];
  totalCogs: number;
  contraRevenue: PLLine[];
  totalContraRevenue: number;
  grossProfit: number;
  operatingExpenses: PLLine[];
  totalOperatingExpenses: number;
  operatingProfit: number;
  otherIncome: PLLine[];
  totalOtherIncome: number;
  financialCharges: PLLine[];
  totalFinancialCharges: number;
  netProfit: number;
  generatedAt: string;
}

export interface BalanceSheetSection {
  accountId: number;
  accountCode: string;
  accountName: string;
  accountSubType: string;
  balance: number;
}

export interface BalanceSheetReport {
  asOf: string;
  assets: BalanceSheetSection[];
  totalAssets: number;
  liabilities: BalanceSheetSection[];
  totalLiabilities: number;
  equity: BalanceSheetSection[];
  totalEquity: number;
  totalLiabilitiesAndEquity: number;
  isBalanced: boolean;
  generatedAt: string;
}

// PG-037: one line per cost center (plus an "Unassigned" bucket for postings with no
// cost center tag) — additive alongside getProfitLoss, not a replacement.
export interface PLByCostCenterLine {
  costCenterId: number | null;
  costCenterCode: string | null;
  costCenterName: string | null;
  revenue: number;
  cogs: number;
  operatingExpenses: number;
  otherExpenses: number;
  netProfit: number;
}

export interface ProfitLossByCostCenterReport {
  from: string;
  to: string;
  costCenterId?: number;
  lines: PLByCostCenterLine[];
  generatedAt: string;
}

export interface CashFlowReport {
  from: string;
  to: string;
  operatingActivities: Array<{ label: string; amount: number }>;
  netOperating: number;
  investingActivities: Array<{ label: string; amount: number }>;
  netInvesting: number;
  financingActivities: Array<{ label: string; amount: number }>;
  netFinancing: number;
  netCashMovement: number;
  openingCash: number;
  closingCash: number;
  generatedAt: string;
}

// ─── Report Engine ────────────────────────────────────────────────────────

export class ReportsEngine {
  static async getTrialBalance(
    db: TenantScopedDatabase,
    tenantId: number,
    asOf: string,
    _branchId?: number
  ): Promise<TrialBalanceReport> {
    // A bare "YYYY-MM-DD" string parses as UTC MIDNIGHT (start of day) — used as an upper-bound
    // cutoff that excludes every transaction posted later that same day, i.e. virtually
    // everything, since real activity happens during business hours. getProfitLoss/getCashFlow
    // already correctly append end-of-day time to their `to` bound; this sibling never did,
    // so "Trial Balance as of today" (the default view, and the scheduler's daily snapshot job)
    // showed zero activity for the entire current day, every day. Reproduced live: 196 real
    // financial_entries rows for a tenant, 0 of them visible in any account's period totals.
    const asOfDate = asOf
      ? new Date(asOf.includes('T') ? asOf : `${asOf}T23:59:59.999Z`)
      : new Date();
    const asOfISO = asOfDate.toISOString();

    // Get all accounts with their period debits and credits
    const rows = (await db.raw.execute(sql`
      SELECT
        a.id             AS account_id,
        a.account_code,
        a.name           AS account_name,
        a.account_type,
        a.normal_balance,
        COALESCE(a.opening_balance, 0)::NUMERIC           AS opening_balance,
        a.opening_balance_type,
        COALESCE(SUM(fe.debit_amount), 0)::NUMERIC        AS period_debits,
        COALESCE(SUM(fe.credit_amount), 0)::NUMERIC       AS period_credits
      FROM accounts a
      LEFT JOIN financial_entries fe
        ON fe.account_id = a.id
       AND fe.tenant_id  = ${tenantId}
       AND fe.created_at <= ${asOfISO}
      WHERE a.tenant_id = ${tenantId}
        AND a.deleted_at IS NULL
        AND a.is_active   = true
      GROUP BY a.id, a.account_code, a.name, a.account_type, a.normal_balance,
               a.opening_balance, a.opening_balance_type
      ORDER BY a.account_code
    `)) as Array<{
      account_id: number;
      account_code: string;
      account_name: string;
      account_type: string;
      normal_balance: string;
      opening_balance: string;
      opening_balance_type: string;
      period_debits: string;
      period_credits: string;
    }>;

    const lines: TrialBalanceLine[] = rows.map((row) => {
      const openingBalance = Number(row.opening_balance);
      const openingType = (row.opening_balance_type ?? 'DEBIT') as 'DEBIT' | 'CREDIT';
      const openingDr = openingType === 'DEBIT' ? openingBalance : 0;
      const openingCr = openingType === 'CREDIT' ? openingBalance : 0;
      const periodDr = Number(row.period_debits);
      const periodCr = Number(row.period_credits);
      const totalDr = openingDr + periodDr;
      const totalCr = openingCr + periodCr;

      let closingDebit = 0;
      let closingCredit = 0;
      if (totalDr > totalCr) {
        closingDebit = totalDr - totalCr;
      } else {
        closingCredit = totalCr - totalDr;
      }

      return {
        accountId: row.account_id,
        accountCode: row.account_code,
        accountName: row.account_name,
        accountType: row.account_type,
        openingBalance,
        openingBalanceType: openingType,
        periodDebits: periodDr,
        periodCredits: periodCr,
        closingDebit,
        closingCredit,
      };
    });

    const totalDebits = lines.reduce((s, l) => s + l.closingDebit, 0);
    const totalCredits = lines.reduce((s, l) => s + l.closingCredit, 0);
    const isBalanced = Math.abs(totalDebits - totalCredits) <= 0.01;

    return {
      asOf: asOf ?? asOfISO.substring(0, 10),
      lines,
      totalDebits,
      totalCredits,
      isBalanced,
      generatedAt: new Date().toISOString(),
    };
  }

  static async getProfitLoss(
    db: TenantScopedDatabase,
    tenantId: number,
    from: string,
    to: string,
    _branchId?: number
  ): Promise<ProfitLossReport> {
    const fromDate = new Date(from);
    const toDate = new Date(to + 'T23:59:59.999Z');

    const rows = (await db.raw.execute(sql`
      SELECT
        a.id             AS account_id,
        a.account_code,
        a.name           AS account_name,
        a.account_type,
        a.account_sub_type,
        COALESCE(SUM(fe.debit_amount), 0)::NUMERIC  AS total_debits,
        COALESCE(SUM(fe.credit_amount), 0)::NUMERIC AS total_credits
      FROM accounts a
      JOIN financial_entries fe
        ON fe.account_id = a.id
       AND fe.tenant_id  = ${tenantId}
       AND fe.created_at >= ${fromDate.toISOString()}
       AND fe.created_at <= ${toDate.toISOString()}
      WHERE a.tenant_id   = ${tenantId}
        AND a.account_type IN ('INCOME', 'EXPENSE', 'CONTRA')
        AND a.deleted_at IS NULL
      GROUP BY a.id, a.account_code, a.name, a.account_type, a.account_sub_type
      ORDER BY a.account_code
    `)) as Array<{
      account_id: number;
      account_code: string;
      account_name: string;
      account_type: string;
      account_sub_type: string | null;
      total_debits: string;
      total_credits: string;
    }>;

    const buildLine = (row: (typeof rows)[number]): PLLine => {
      const cr = Number(row.total_credits);
      const dr = Number(row.total_debits);
      // For income: net = credits - debits; For expense: net = debits - credits
      const isIncome = row.account_type === 'INCOME';
      return {
        accountId: row.account_id,
        accountCode: row.account_code,
        accountName: row.account_name,
        amount: isIncome ? cr - dr : dr - cr,
      };
    };

    const revenue = rows
      .filter((r) => r.account_type === 'INCOME' && r.account_sub_type === 'SALES_REVENUE')
      .map(buildLine);
    const otherIncome = rows
      .filter((r) => r.account_type === 'INCOME' && r.account_sub_type !== 'SALES_REVENUE')
      .map(buildLine);
    const cogs = rows.filter((r) => r.account_sub_type === 'COST_OF_GOODS').map(buildLine);
    const operatingExpenses = rows
      .filter((r) => r.account_type === 'EXPENSE' && r.account_sub_type === 'OPERATING_EXPENSE')
      .map(buildLine);
    const financialCharges = rows
      .filter((r) => r.account_type === 'EXPENSE' && r.account_sub_type === 'TAX_EXPENSE')
      .map(buildLine);
    const contraRevenue = rows.filter((r) => r.account_type === 'CONTRA').map(buildLine);

    const totalRevenue = revenue.reduce((s, l) => s + l.amount, 0);
    const totalOtherIncome = otherIncome.reduce((s, l) => s + l.amount, 0);
    const totalContraRevenue = contraRevenue.reduce((s, l) => s + l.amount, 0);
    const totalCogs = cogs.reduce((s, l) => s + l.amount, 0) + totalContraRevenue;
    const grossProfit = totalRevenue - totalCogs;
    const totalOperatingExpenses = operatingExpenses.reduce((s, l) => s + l.amount, 0);
    const operatingProfit = grossProfit - totalOperatingExpenses;
    const totalFinancialCharges = financialCharges.reduce((s, l) => s + l.amount, 0);
    const netProfit = operatingProfit + totalOtherIncome - totalFinancialCharges;

    return {
      from,
      to,
      revenue,
      totalRevenue,
      cogs,
      totalCogs,
      contraRevenue,
      totalContraRevenue,
      grossProfit,
      operatingExpenses,
      totalOperatingExpenses,
      operatingProfit,
      otherIncome,
      totalOtherIncome,
      financialCharges,
      totalFinancialCharges,
      netProfit,
      generatedAt: new Date().toISOString(),
    };
  }

  // PG-037: additive alongside getProfitLoss — a tenant with no cost centers configured
  // never calls this; getProfitLoss's own query/output is untouched by this method existing.
  static async getPnLByCostCenter(
    db: TenantScopedDatabase,
    tenantId: number,
    from: string,
    to: string,
    costCenterId?: number
  ): Promise<ProfitLossByCostCenterReport> {
    const fromDate = new Date(from);
    const toDate = new Date(to + 'T23:59:59.999Z');

    const rows = (await db.raw.execute(sql`
      SELECT
        fe.cost_center_id AS cost_center_id,
        cc.code           AS cost_center_code,
        cc.name           AS cost_center_name,
        a.account_type,
        a.account_sub_type,
        COALESCE(SUM(fe.debit_amount), 0)::NUMERIC  AS total_debits,
        COALESCE(SUM(fe.credit_amount), 0)::NUMERIC AS total_credits
      FROM accounts a
      JOIN financial_entries fe
        ON fe.account_id = a.id
       AND fe.tenant_id  = ${tenantId}
       AND fe.created_at >= ${fromDate.toISOString()}
       AND fe.created_at <= ${toDate.toISOString()}
      LEFT JOIN cost_centers cc
        ON cc.id = fe.cost_center_id
       AND cc.tenant_id = ${tenantId}
      WHERE a.tenant_id   = ${tenantId}
        AND a.account_type IN ('INCOME', 'EXPENSE', 'CONTRA')
        AND a.deleted_at IS NULL
        ${costCenterId !== undefined ? sql`AND fe.cost_center_id = ${costCenterId}` : sql``}
      GROUP BY fe.cost_center_id, cc.code, cc.name, a.account_type, a.account_sub_type
      ORDER BY fe.cost_center_id NULLS LAST
    `)) as Array<{
      cost_center_id: number | null;
      cost_center_code: string | null;
      cost_center_name: string | null;
      account_type: string;
      account_sub_type: string | null;
      total_debits: string;
      total_credits: string;
    }>;

    const buckets = new Map<number | null, PLByCostCenterLine>();
    for (const row of rows) {
      const key = row.cost_center_id;
      if (!buckets.has(key)) {
        buckets.set(key, {
          costCenterId: key,
          costCenterCode: row.cost_center_code,
          costCenterName: row.cost_center_name,
          revenue: 0,
          cogs: 0,
          operatingExpenses: 0,
          otherExpenses: 0,
          netProfit: 0,
        });
      }
      const bucket = buckets.get(key)!;
      const dr = Number(row.total_debits);
      const cr = Number(row.total_credits);

      if (row.account_type === 'INCOME') {
        bucket.revenue += cr - dr;
      } else if (row.account_sub_type === 'COST_OF_GOODS') {
        bucket.cogs += dr - cr;
      } else if (row.account_sub_type === 'OPERATING_EXPENSE') {
        bucket.operatingExpenses += dr - cr;
      } else if (row.account_type === 'EXPENSE' || row.account_type === 'CONTRA') {
        bucket.otherExpenses += dr - cr;
      }
    }

    const lines = Array.from(buckets.values()).map((b) => ({
      ...b,
      netProfit: b.revenue - b.cogs - b.operatingExpenses - b.otherExpenses,
    }));

    return {
      from,
      to,
      ...(costCenterId !== undefined ? { costCenterId } : {}),
      lines,
      generatedAt: new Date().toISOString(),
    };
  }

  static async getBalanceSheet(
    db: TenantScopedDatabase,
    tenantId: number,
    asOf: string,
    _branchId?: number
  ): Promise<BalanceSheetReport> {
    // Same bare-date-parses-as-midnight bug as getTrialBalance — see that function's comment.
    const asOfDate = asOf
      ? new Date(asOf.includes('T') ? asOf : `${asOf}T23:59:59.999Z`)
      : new Date();

    const rows = (await db.raw.execute(sql`
      SELECT
        a.id             AS account_id,
        a.account_code,
        a.name           AS account_name,
        a.account_type,
        a.account_sub_type,
        a.normal_balance,
        COALESCE(a.opening_balance, 0)::NUMERIC          AS opening_balance,
        a.opening_balance_type,
        COALESCE(SUM(fe.debit_amount), 0)::NUMERIC       AS period_debits,
        COALESCE(SUM(fe.credit_amount), 0)::NUMERIC      AS period_credits
      FROM accounts a
      LEFT JOIN financial_entries fe
        ON fe.account_id = a.id
       AND fe.tenant_id  = ${tenantId}
       AND fe.created_at <= ${asOfDate.toISOString()}
      WHERE a.tenant_id   = ${tenantId}
        AND a.account_type IN ('ASSET', 'LIABILITY', 'EQUITY')
        AND a.deleted_at IS NULL
        AND a.is_active   = true
      GROUP BY a.id, a.account_code, a.name, a.account_type, a.account_sub_type,
               a.normal_balance, a.opening_balance, a.opening_balance_type
      ORDER BY a.account_type, a.account_code
    `)) as Array<{
      account_id: number;
      account_code: string;
      account_name: string;
      account_type: string;
      account_sub_type: string | null;
      normal_balance: string;
      opening_balance: string;
      opening_balance_type: string;
      period_debits: string;
      period_credits: string;
    }>;

    const calcBalance = (row: (typeof rows)[number]): number => {
      const ob = Number(row.opening_balance);
      const obType = row.opening_balance_type ?? 'DEBIT';
      const obDr = obType === 'DEBIT' ? ob : 0;
      const obCr = obType === 'CREDIT' ? ob : 0;
      const dr = obDr + Number(row.period_debits);
      const cr = obCr + Number(row.period_credits);
      // Positive = debit balance for assets/expenses, credit balance for liabilities/equity/income
      return row.normal_balance === 'DEBIT' ? dr - cr : cr - dr;
    };

    const toSection = (row: (typeof rows)[number]): BalanceSheetSection => ({
      accountId: row.account_id,
      accountCode: row.account_code,
      accountName: row.account_name,
      accountSubType: row.account_sub_type ?? '',
      balance: calcBalance(row),
    });

    const assets = rows.filter((r) => r.account_type === 'ASSET').map(toSection);
    const liabilities = rows.filter((r) => r.account_type === 'LIABILITY').map(toSection);
    const equity = rows.filter((r) => r.account_type === 'EQUITY').map(toSection);

    // Revenue/expense accounts only roll into Retained Earnings via a formal year-end close
    // (FinancialYearService.close()) — during an open year (i.e. always, until that runs), the
    // raw trial balance is structurally guaranteed to be off by exactly the current period's
    // unclosed net profit/loss, since that P&L has nowhere to live in the balance sheet yet.
    // Every real accounting package computes a "Current Year Earnings" equity line on the fly
    // for this exact reason — without it, "Balance Sheet as of today" would show isBalanced:
    // false for literally every tenant with any P&L activity since their last formal close,
    // which for a small business is effectively always. Confirmed live: -831,688.79 unexplained
    // imbalance exactly matching this period's unclosed net loss.
    const [openFy] = (await db.raw.execute(sql`
      SELECT start_date FROM financial_years
      WHERE tenant_id = ${tenantId} AND status != 'CLOSED' AND start_date <= ${asOfDate.toISOString().substring(0, 10)}
      ORDER BY start_date DESC LIMIT 1
    `)) as Array<{ start_date: string }>;

    let equityWithCurrentEarnings = equity;
    if (openFy) {
      const pl = await ReportsEngine.getProfitLoss(
        db,
        tenantId,
        openFy.start_date,
        asOfDate.toISOString().substring(0, 10)
      );
      if (Math.abs(pl.netProfit) > 0.01) {
        equityWithCurrentEarnings = [
          ...equity,
          {
            accountId: 0,
            accountCode: '3090',
            accountName: 'Current Year Earnings',
            accountSubType: 'RETAINED_EARNINGS',
            balance: pl.netProfit,
          },
        ];
      }
    }

    const totalAssets = assets.reduce((s, l) => s + l.balance, 0);
    const totalLiabilities = liabilities.reduce((s, l) => s + l.balance, 0);
    const totalEquity = equityWithCurrentEarnings.reduce((s, l) => s + l.balance, 0);
    const totalLiabilitiesAndEquity = totalLiabilities + totalEquity;
    const isBalanced = Math.abs(totalAssets - totalLiabilitiesAndEquity) <= 0.01;

    if (!isBalanced) {
      // Alert but do not throw — report the imbalance so finance can investigate
    }

    return {
      asOf: asOf ?? asOfDate.toISOString().substring(0, 10),
      assets,
      totalAssets,
      liabilities,
      totalLiabilities,
      equity: equityWithCurrentEarnings,
      totalEquity,
      totalLiabilitiesAndEquity,
      isBalanced,
      generatedAt: new Date().toISOString(),
    };
  }

  static async getCashFlow(
    db: TenantScopedDatabase,
    tenantId: number,
    from: string,
    to: string
  ): Promise<CashFlowReport> {
    const fromDate = new Date(from);
    const toDate = new Date(to + 'T23:59:59.999Z');

    // Classify each cash movement by the account_sub_type of its counter-account
    // in the same journal (dominant/first non-cash counter-line, per journal_id).
    // Cash-to-cash transfers (counter is also CASH_AND_BANK) fall through to Operating.
    const classifiedRows = (await db.raw.execute(sql`
      SELECT
        (fe.debit_amount - fe.credit_amount)::NUMERIC AS net_amount,
        counter.account_sub_type AS counter_sub_type
      FROM accounts a
      JOIN financial_entries fe
        ON fe.account_id = a.id
       AND fe.tenant_id  = ${tenantId}
       AND fe.created_at >= ${fromDate.toISOString()}
       AND fe.created_at <= ${toDate.toISOString()}
      LEFT JOIN LATERAL (
        SELECT ca.account_sub_type
        FROM financial_entries fe2
        JOIN accounts ca
          ON ca.id = fe2.account_id
         AND ca.tenant_id = ${tenantId}
        WHERE fe2.journal_id = fe.journal_id
          AND fe2.tenant_id  = ${tenantId}
          AND fe2.id        != fe.id
          AND ca.account_sub_type IS DISTINCT FROM 'CASH_AND_BANK'
        ORDER BY fe2.id ASC
        LIMIT 1
      ) counter ON true
      WHERE a.tenant_id      = ${tenantId}
        AND a.account_sub_type = 'CASH_AND_BANK'
        AND a.deleted_at IS NULL
    `)) as Array<{ net_amount: string; counter_sub_type: string | null }>;

    // Opening cash balance
    const openingRows = (await db.raw.execute(sql`
      SELECT
        COALESCE(SUM(CASE WHEN fe.debit_amount > 0 THEN fe.debit_amount ELSE 0 END), 0)::NUMERIC
          - COALESCE(SUM(CASE WHEN fe.credit_amount > 0 THEN fe.credit_amount ELSE 0 END), 0)::NUMERIC
          + COALESCE(SUM(CASE WHEN a.opening_balance_type = 'DEBIT' THEN a.opening_balance ELSE -a.opening_balance END), 0)::NUMERIC
          AS balance
      FROM accounts a
      LEFT JOIN financial_entries fe
        ON fe.account_id = a.id
       AND fe.tenant_id  = ${tenantId}
       AND fe.created_at < ${fromDate.toISOString()}
      WHERE a.tenant_id      = ${tenantId}
        AND a.account_sub_type = 'CASH_AND_BANK'
        AND a.deleted_at IS NULL
    `)) as Array<{ balance: string }>;

    const openingCash = Number(openingRows[0]?.balance ?? 0);

    // Direct method, bucketed by counter-account classification:
    //   FIXED_ASSET / ACCUMULATED_DEPRECIATION counter → Investing
    //   LONG_TERM_LIABILITY / EQUITY counter           → Financing
    //   everything else (incl. cash-to-cash transfers) → Operating
    let operatingIn = 0;
    let operatingOut = 0;
    const investingBuckets = new Map<string, number>();
    const financingBuckets = new Map<string, number>();

    for (const row of classifiedRows) {
      const amount = Number(row.net_amount);
      const counterSubType = row.counter_sub_type;

      if (counterSubType === 'FIXED_ASSET' || counterSubType === 'ACCUMULATED_DEPRECIATION') {
        const label =
          amount >= 0 ? 'Proceeds from disposal of fixed assets' : 'Purchase of fixed assets';
        investingBuckets.set(label, (investingBuckets.get(label) ?? 0) + amount);
      } else if (counterSubType === 'LONG_TERM_LIABILITY') {
        const label = amount >= 0 ? 'Bank loan received' : 'Bank loan repaid';
        financingBuckets.set(label, (financingBuckets.get(label) ?? 0) + amount);
      } else if (counterSubType === 'EQUITY') {
        const label = amount >= 0 ? "Owner's capital introduced" : "Owner's drawings";
        financingBuckets.set(label, (financingBuckets.get(label) ?? 0) + amount);
      } else if (amount >= 0) {
        operatingIn += amount;
      } else {
        operatingOut += amount;
      }
    }

    const operatingActivities = [
      { label: 'Cash received from customers', amount: operatingIn },
      { label: 'Cash paid to suppliers', amount: operatingOut },
    ];
    const netOperating = operatingIn + operatingOut;

    const investingActivities = Array.from(investingBuckets, ([label, amount]) => ({
      label,
      amount,
    }));
    const netInvesting = investingActivities.reduce((s, l) => s + l.amount, 0);

    const financingActivities = Array.from(financingBuckets, ([label, amount]) => ({
      label,
      amount,
    }));
    const netFinancing = financingActivities.reduce((s, l) => s + l.amount, 0);

    const netCashMovement = netOperating + netInvesting + netFinancing;
    const closingCash = openingCash + netCashMovement;

    return {
      from,
      to,
      operatingActivities,
      netOperating,
      investingActivities,
      netInvesting,
      financingActivities,
      netFinancing,
      netCashMovement,
      openingCash,
      closingCash,
      generatedAt: new Date().toISOString(),
    };
  }
}
