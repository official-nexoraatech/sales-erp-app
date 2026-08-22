// Default Chart of Accounts — seeded on tenant provisioning
// 42 accounts covering standard Indian retail CoA
import type { PlatformContext } from '@erp/sdk';
import { PlatformEventBus } from '@erp/sdk';
import { accounts } from '@erp/db';
import { eq } from 'drizzle-orm';

export interface DefaultAccount {
  accountCode: string;
  name: string;
  accountType: 'ASSET' | 'LIABILITY' | 'EQUITY' | 'INCOME' | 'EXPENSE' | 'CONTRA';
  accountSubType: string;
  normalBalance: 'DEBIT' | 'CREDIT';
  isBank?: boolean;
  isCash?: boolean;
  isSystem?: boolean;
  parentCode?: string;
}

export const DEFAULT_ACCOUNTS: DefaultAccount[] = [
  // ── ASSETS ──────────────────────────────────────────────────────────────
  {
    accountCode: '1000',
    name: 'Current Assets',
    accountType: 'ASSET',
    accountSubType: 'OTHER_CURRENT_ASSET',
    normalBalance: 'DEBIT',
    isSystem: true,
  },
  {
    accountCode: '1010',
    name: 'Cash in Hand',
    accountType: 'ASSET',
    accountSubType: 'CASH_AND_BANK',
    normalBalance: 'DEBIT',
    isCash: true,
    parentCode: '1000',
  },
  {
    accountCode: '1020',
    name: 'Petty Cash',
    accountType: 'ASSET',
    accountSubType: 'CASH_AND_BANK',
    normalBalance: 'DEBIT',
    isCash: true,
    parentCode: '1000',
  },
  {
    accountCode: '1030',
    name: 'Bank Account — Current',
    accountType: 'ASSET',
    accountSubType: 'CASH_AND_BANK',
    normalBalance: 'DEBIT',
    isBank: true,
    parentCode: '1000',
  },
  {
    accountCode: '1031',
    name: 'Bank Account — Savings',
    accountType: 'ASSET',
    accountSubType: 'CASH_AND_BANK',
    normalBalance: 'DEBIT',
    isBank: true,
    parentCode: '1000',
  },
  {
    accountCode: '1100',
    name: 'Accounts Receivable (Debtors)',
    accountType: 'ASSET',
    accountSubType: 'ACCOUNTS_RECEIVABLE',
    normalBalance: 'DEBIT',
    isSystem: true,
    parentCode: '1000',
  },
  {
    accountCode: '1110',
    name: 'Trade Debtors — Retail',
    accountType: 'ASSET',
    accountSubType: 'ACCOUNTS_RECEIVABLE',
    normalBalance: 'DEBIT',
    parentCode: '1100',
  },
  {
    accountCode: '1120',
    name: 'Trade Debtors — Wholesale',
    accountType: 'ASSET',
    accountSubType: 'ACCOUNTS_RECEIVABLE',
    normalBalance: 'DEBIT',
    parentCode: '1100',
  },
  {
    accountCode: '1200',
    name: 'Inventory',
    accountType: 'ASSET',
    accountSubType: 'INVENTORY',
    normalBalance: 'DEBIT',
    isSystem: true,
  },
  {
    accountCode: '1210',
    name: 'Cloth / Fabric Stock',
    accountType: 'ASSET',
    accountSubType: 'INVENTORY',
    normalBalance: 'DEBIT',
    parentCode: '1200',
  },
  {
    accountCode: '1220',
    name: 'Readymade Garments Stock',
    accountType: 'ASSET',
    accountSubType: 'INVENTORY',
    normalBalance: 'DEBIT',
    parentCode: '1200',
  },
  {
    accountCode: '1230',
    name: 'Accessories Stock',
    accountType: 'ASSET',
    accountSubType: 'INVENTORY',
    normalBalance: 'DEBIT',
    parentCode: '1200',
  },
  {
    accountCode: '1300',
    name: 'Other Current Assets',
    accountType: 'ASSET',
    accountSubType: 'OTHER_CURRENT_ASSET',
    normalBalance: 'DEBIT',
  },
  {
    accountCode: '1310',
    name: 'Prepaid Expenses',
    accountType: 'ASSET',
    accountSubType: 'OTHER_CURRENT_ASSET',
    normalBalance: 'DEBIT',
    parentCode: '1300',
  },
  {
    accountCode: '1320',
    name: 'GST Input Tax Credit',
    accountType: 'ASSET',
    accountSubType: 'OTHER_CURRENT_ASSET',
    normalBalance: 'DEBIT',
    parentCode: '1300',
  },
  {
    accountCode: '1321',
    name: 'CGST Input Credit',
    accountType: 'ASSET',
    accountSubType: 'OTHER_CURRENT_ASSET',
    normalBalance: 'DEBIT',
    parentCode: '1320',
  },
  {
    accountCode: '1322',
    name: 'SGST Input Credit',
    accountType: 'ASSET',
    accountSubType: 'OTHER_CURRENT_ASSET',
    normalBalance: 'DEBIT',
    parentCode: '1320',
  },
  {
    accountCode: '1323',
    name: 'IGST Input Credit',
    accountType: 'ASSET',
    accountSubType: 'OTHER_CURRENT_ASSET',
    normalBalance: 'DEBIT',
    parentCode: '1320',
  },
  {
    accountCode: '1330',
    name: 'RCM Tax Input Credit',
    accountType: 'ASSET',
    accountSubType: 'OTHER_CURRENT_ASSET',
    normalBalance: 'DEBIT',
    parentCode: '1300',
  },
  {
    accountCode: '1340',
    name: 'Employee Loans Receivable',
    accountType: 'ASSET',
    accountSubType: 'OTHER_CURRENT_ASSET',
    normalBalance: 'DEBIT',
    parentCode: '1300',
  },
  {
    accountCode: '1500',
    name: 'Fixed Assets',
    accountType: 'ASSET',
    accountSubType: 'FIXED_ASSET',
    normalBalance: 'DEBIT',
  },
  {
    accountCode: '1510',
    name: 'Furniture and Fixtures',
    accountType: 'ASSET',
    accountSubType: 'FIXED_ASSET',
    normalBalance: 'DEBIT',
    parentCode: '1500',
  },
  {
    accountCode: '1520',
    name: 'Computer Equipment',
    accountType: 'ASSET',
    accountSubType: 'FIXED_ASSET',
    normalBalance: 'DEBIT',
    parentCode: '1500',
  },
  {
    accountCode: '1530',
    name: 'Shop Interiors / Leasehold Improvements',
    accountType: 'ASSET',
    accountSubType: 'FIXED_ASSET',
    normalBalance: 'DEBIT',
    parentCode: '1500',
  },
  {
    accountCode: '1590',
    name: 'Accumulated Depreciation',
    accountType: 'CONTRA',
    accountSubType: 'ACCUMULATED_DEPRECIATION',
    normalBalance: 'CREDIT',
    parentCode: '1500',
  },

  // ── LIABILITIES ──────────────────────────────────────────────────────────
  {
    accountCode: '2000',
    name: 'Current Liabilities',
    accountType: 'LIABILITY',
    accountSubType: 'OTHER_CURRENT_LIABILITY',
    normalBalance: 'CREDIT',
    isSystem: true,
  },
  {
    accountCode: '2100',
    name: 'Accounts Payable (Creditors)',
    accountType: 'LIABILITY',
    accountSubType: 'ACCOUNTS_PAYABLE',
    normalBalance: 'CREDIT',
    isSystem: true,
    parentCode: '2000',
  },
  {
    accountCode: '2110',
    name: 'Trade Creditors — Suppliers',
    accountType: 'LIABILITY',
    accountSubType: 'ACCOUNTS_PAYABLE',
    normalBalance: 'CREDIT',
    parentCode: '2100',
  },
  {
    accountCode: '2200',
    name: 'GST Payable',
    accountType: 'LIABILITY',
    accountSubType: 'TAX_PAYABLE',
    normalBalance: 'CREDIT',
    parentCode: '2000',
  },
  {
    accountCode: '2210',
    name: 'CGST Payable',
    accountType: 'LIABILITY',
    accountSubType: 'TAX_PAYABLE',
    normalBalance: 'CREDIT',
    parentCode: '2200',
  },
  {
    accountCode: '2220',
    name: 'SGST Payable',
    accountType: 'LIABILITY',
    accountSubType: 'TAX_PAYABLE',
    normalBalance: 'CREDIT',
    parentCode: '2200',
  },
  {
    accountCode: '2230',
    name: 'IGST Payable',
    accountType: 'LIABILITY',
    accountSubType: 'TAX_PAYABLE',
    normalBalance: 'CREDIT',
    parentCode: '2200',
  },
  {
    accountCode: '2300',
    name: 'Other Current Liabilities',
    accountType: 'LIABILITY',
    accountSubType: 'OTHER_CURRENT_LIABILITY',
    normalBalance: 'CREDIT',
    parentCode: '2000',
  },
  {
    accountCode: '2310',
    name: 'Salary Payable',
    accountType: 'LIABILITY',
    accountSubType: 'OTHER_CURRENT_LIABILITY',
    normalBalance: 'CREDIT',
    parentCode: '2300',
  },
  {
    accountCode: '2320',
    name: 'Advance from Customers',
    accountType: 'LIABILITY',
    accountSubType: 'OTHER_CURRENT_LIABILITY',
    normalBalance: 'CREDIT',
    parentCode: '2300',
  },
  {
    accountCode: '2330',
    name: 'RCM Tax Payable',
    accountType: 'LIABILITY',
    accountSubType: 'OTHER_CURRENT_LIABILITY',
    normalBalance: 'CREDIT',
    parentCode: '2300',
  },
  {
    // Purchase audit 2026-07-21: TDSService.recordTDSEntry requires a real
    // tdsPayableAccountId — without a seeded default, every tenant had to hand-create this
    // account before TDS on supplier payments could ever be recorded, which combined with
    // no UI ever calling POST /tds/deduct meant the whole TDS feature was unreachable.
    accountCode: '2340',
    name: 'TDS Payable',
    accountType: 'LIABILITY',
    accountSubType: 'OTHER_CURRENT_LIABILITY',
    normalBalance: 'CREDIT',
    parentCode: '2300',
  },
  {
    // Business Rules Engine, Commission category — see accountCode 6120's comment above.
    accountCode: '2350',
    name: 'Commission Payable',
    accountType: 'LIABILITY',
    accountSubType: 'OTHER_CURRENT_LIABILITY',
    normalBalance: 'CREDIT',
    parentCode: '2300',
  },
  {
    accountCode: '2500',
    name: 'Long-term Liabilities',
    accountType: 'LIABILITY',
    accountSubType: 'LONG_TERM_LIABILITY',
    normalBalance: 'CREDIT',
  },
  {
    accountCode: '2510',
    name: 'Bank Loan',
    accountType: 'LIABILITY',
    accountSubType: 'LONG_TERM_LIABILITY',
    normalBalance: 'CREDIT',
    parentCode: '2500',
  },

  // ── EQUITY ────────────────────────────────────────────────────────────────
  {
    accountCode: '3000',
    name: "Owner's Equity / Capital",
    accountType: 'EQUITY',
    accountSubType: 'EQUITY',
    normalBalance: 'CREDIT',
    isSystem: true,
  },
  {
    accountCode: '3010',
    name: "Owner's Capital",
    accountType: 'EQUITY',
    accountSubType: 'EQUITY',
    normalBalance: 'CREDIT',
    parentCode: '3000',
  },
  {
    accountCode: '3020',
    name: 'Retained Earnings',
    accountType: 'EQUITY',
    accountSubType: 'RETAINED_EARNINGS',
    normalBalance: 'CREDIT',
    parentCode: '3000',
  },
  {
    accountCode: '3030',
    name: 'Owner Drawings',
    accountType: 'EQUITY',
    accountSubType: 'EQUITY',
    normalBalance: 'DEBIT',
    parentCode: '3000',
  },
  // Classified EQUITY (not INCOME) since its balance is temporary and always rolls into Retained Earnings (also EQUITY) at year-end close.
  {
    accountCode: '3900',
    name: 'Income Summary',
    accountType: 'EQUITY',
    accountSubType: 'INCOME_SUMMARY',
    normalBalance: 'CREDIT',
    isSystem: true,
    parentCode: '3000',
  },

  // ── INCOME ────────────────────────────────────────────────────────────────
  {
    accountCode: '4000',
    name: 'Sales Revenue',
    accountType: 'INCOME',
    accountSubType: 'SALES_REVENUE',
    normalBalance: 'CREDIT',
    isSystem: true,
  },
  {
    accountCode: '4010',
    name: 'Retail Sales',
    accountType: 'INCOME',
    accountSubType: 'SALES_REVENUE',
    normalBalance: 'CREDIT',
    parentCode: '4000',
  },
  {
    accountCode: '4020',
    name: 'Wholesale Sales',
    accountType: 'INCOME',
    accountSubType: 'SALES_REVENUE',
    normalBalance: 'CREDIT',
    parentCode: '4000',
  },
  {
    accountCode: '4030',
    name: 'Tailoring / Alteration Income',
    accountType: 'INCOME',
    accountSubType: 'SALES_REVENUE',
    normalBalance: 'CREDIT',
    parentCode: '4000',
  },
  {
    accountCode: '4100',
    name: 'Other Income',
    accountType: 'INCOME',
    accountSubType: 'OTHER_INCOME',
    normalBalance: 'CREDIT',
  },
  {
    accountCode: '4110',
    name: 'Interest Income',
    accountType: 'INCOME',
    accountSubType: 'OTHER_INCOME',
    normalBalance: 'CREDIT',
    parentCode: '4100',
  },
  {
    accountCode: '4120',
    name: 'Discount Received',
    accountType: 'INCOME',
    accountSubType: 'OTHER_INCOME',
    normalBalance: 'CREDIT',
    parentCode: '4100',
  },
  {
    accountCode: '4900',
    name: 'Sales Returns (Contra Revenue)',
    accountType: 'CONTRA',
    accountSubType: 'CONTRA_REVENUE',
    normalBalance: 'DEBIT',
  },

  // ── COST OF GOODS ─────────────────────────────────────────────────────────
  {
    accountCode: '5000',
    name: 'Cost of Goods Sold',
    accountType: 'EXPENSE',
    accountSubType: 'COST_OF_GOODS',
    normalBalance: 'DEBIT',
    isSystem: true,
  },
  {
    accountCode: '5010',
    name: 'Purchases — Cloth / Fabric',
    accountType: 'EXPENSE',
    accountSubType: 'COST_OF_GOODS',
    normalBalance: 'DEBIT',
    parentCode: '5000',
  },
  {
    accountCode: '5020',
    name: 'Purchases — Readymade Garments',
    accountType: 'EXPENSE',
    accountSubType: 'COST_OF_GOODS',
    normalBalance: 'DEBIT',
    parentCode: '5000',
  },
  {
    accountCode: '5030',
    name: 'Purchases — Accessories',
    accountType: 'EXPENSE',
    accountSubType: 'COST_OF_GOODS',
    normalBalance: 'DEBIT',
    parentCode: '5000',
  },
  {
    accountCode: '5040',
    name: 'Purchase Returns',
    accountType: 'EXPENSE',
    accountSubType: 'COST_OF_GOODS',
    normalBalance: 'CREDIT',
    parentCode: '5000',
  },
  {
    accountCode: '5050',
    name: 'Freight / Carriage Inward',
    accountType: 'EXPENSE',
    accountSubType: 'COST_OF_GOODS',
    normalBalance: 'DEBIT',
    parentCode: '5000',
  },

  // ── OPERATING EXPENSES ────────────────────────────────────────────────────
  {
    accountCode: '6000',
    name: 'Operating Expenses',
    accountType: 'EXPENSE',
    accountSubType: 'OPERATING_EXPENSE',
    normalBalance: 'DEBIT',
  },
  {
    accountCode: '6010',
    name: 'Salaries and Wages',
    accountType: 'EXPENSE',
    accountSubType: 'OPERATING_EXPENSE',
    normalBalance: 'DEBIT',
    parentCode: '6000',
  },
  {
    accountCode: '6020',
    name: 'Rent',
    accountType: 'EXPENSE',
    accountSubType: 'OPERATING_EXPENSE',
    normalBalance: 'DEBIT',
    parentCode: '6000',
  },
  {
    accountCode: '6030',
    name: 'Electricity',
    accountType: 'EXPENSE',
    accountSubType: 'OPERATING_EXPENSE',
    normalBalance: 'DEBIT',
    parentCode: '6000',
  },
  {
    accountCode: '6040',
    name: 'Telephone / Internet',
    accountType: 'EXPENSE',
    accountSubType: 'OPERATING_EXPENSE',
    normalBalance: 'DEBIT',
    parentCode: '6000',
  },
  {
    accountCode: '6050',
    name: 'Advertising and Marketing',
    accountType: 'EXPENSE',
    accountSubType: 'OPERATING_EXPENSE',
    normalBalance: 'DEBIT',
    parentCode: '6000',
  },
  {
    accountCode: '6060',
    name: 'Packing and Forwarding',
    accountType: 'EXPENSE',
    accountSubType: 'OPERATING_EXPENSE',
    normalBalance: 'DEBIT',
    parentCode: '6000',
  },
  {
    accountCode: '6070',
    name: 'Depreciation',
    accountType: 'EXPENSE',
    accountSubType: 'OPERATING_EXPENSE',
    normalBalance: 'DEBIT',
    parentCode: '6000',
  },
  {
    accountCode: '6080',
    name: 'Bank Charges',
    accountType: 'EXPENSE',
    accountSubType: 'OPERATING_EXPENSE',
    normalBalance: 'DEBIT',
    parentCode: '6000',
  },
  {
    accountCode: '6090',
    name: 'Miscellaneous Expenses',
    accountType: 'EXPENSE',
    accountSubType: 'OPERATING_EXPENSE',
    normalBalance: 'DEBIT',
    parentCode: '6000',
  },
  {
    accountCode: '6100',
    name: 'Discount Given',
    accountType: 'EXPENSE',
    accountSubType: 'OPERATING_EXPENSE',
    normalBalance: 'DEBIT',
    parentCode: '6000',
  },
  {
    accountCode: '6110',
    name: 'Stock Adjustment Loss',
    accountType: 'EXPENSE',
    accountSubType: 'OPERATING_EXPENSE',
    normalBalance: 'DEBIT',
    parentCode: '6000',
  },
  {
    // Business Rules Engine, Commission category: CommissionService.approve() requires this
    // account to exist before the first COMMISSION_APPROVED journal can post — same
    // "seeded default account, no manual setup step" reasoning as TDS Payable above.
    accountCode: '6120',
    name: 'Sales Commission Expense',
    accountType: 'EXPENSE',
    accountSubType: 'OPERATING_EXPENSE',
    normalBalance: 'DEBIT',
    parentCode: '6000',
  },

  // ── TAX EXPENSE ──────────────────────────────────────────────────────────
  {
    accountCode: '7000',
    name: 'Tax and Duties',
    accountType: 'EXPENSE',
    accountSubType: 'TAX_EXPENSE',
    normalBalance: 'DEBIT',
  },
  {
    accountCode: '7010',
    name: 'Income Tax',
    accountType: 'EXPENSE',
    accountSubType: 'TAX_EXPENSE',
    normalBalance: 'DEBIT',
    parentCode: '7000',
  },
];

// Multi-vertical platform audit 2026-08-16, Phase 2: DEFAULT_ACCOUNTS' schema has zero
// cloth-specific columns — only these 7 rows (the sub-category breakdown under Inventory/COGS/
// Other Income) are actually cloth-flavored; everything else (cash/bank, receivables/payables,
// GST ledger accounts, fixed assets, payroll, TDS, standard P&L structure) is retail-generic
// and reused as-is for Grocery. Rather than duplicate the ~85 shared rows, GROCERY_DEFAULT_ACCOUNTS
// below is DEFAULT_ACCOUNTS with just these swapped out.
const CLOTH_ONLY_ACCOUNT_CODES = new Set(['1210', '1220', '1230', '4030', '5010', '5020', '5030']);

const GROCERY_VERTICAL_ACCOUNTS: DefaultAccount[] = [
  {
    accountCode: '1211',
    name: 'Perishables Stock',
    accountType: 'ASSET',
    accountSubType: 'INVENTORY',
    normalBalance: 'DEBIT',
    parentCode: '1200',
  },
  {
    accountCode: '1221',
    name: 'Packaged / FMCG Stock',
    accountType: 'ASSET',
    accountSubType: 'INVENTORY',
    normalBalance: 'DEBIT',
    parentCode: '1200',
  },
  {
    accountCode: '1231',
    name: 'Household & Personal Care Stock',
    accountType: 'ASSET',
    accountSubType: 'INVENTORY',
    normalBalance: 'DEBIT',
    parentCode: '1200',
  },
  {
    accountCode: '5011',
    name: 'Purchases — Perishables',
    accountType: 'EXPENSE',
    accountSubType: 'COST_OF_GOODS',
    normalBalance: 'DEBIT',
    parentCode: '5000',
  },
  {
    accountCode: '5021',
    name: 'Purchases — Packaged / FMCG Goods',
    accountType: 'EXPENSE',
    accountSubType: 'COST_OF_GOODS',
    normalBalance: 'DEBIT',
    parentCode: '5000',
  },
  {
    accountCode: '5031',
    name: 'Purchases — Household & Personal Care',
    accountType: 'EXPENSE',
    accountSubType: 'COST_OF_GOODS',
    normalBalance: 'DEBIT',
    parentCode: '5000',
  },
];

// STOCK_ADJUSTMENT_LOSS (spoilage/shrinkage/expiry write-offs) already posts to the generic
// '6110' Stock Adjustment Loss account (see PostingMatrixService.DEFAULT_POSTING_RULES) —
// no grocery-specific write-off account is needed.
export const GROCERY_DEFAULT_ACCOUNTS: DefaultAccount[] = [
  ...DEFAULT_ACCOUNTS.filter((a) => !CLOTH_ONLY_ACCOUNT_CODES.has(a.accountCode)),
  ...GROCERY_VERTICAL_ACCOUNTS,
];

// Extracted from accounts.routes.ts's POST /accounts/seed so the same seeding logic can also
// run from tenant-service's provisioning flow (via an internal-key-guarded route — see
// scheduler-internal.routes.ts's /internal/accounts/seed) instead of only ever being
// reachable by a real, authenticated user clicking a button after the fact. Found in live QA
// 2026-07-17: TenantProvisioner's 10 steps never seeded a Chart of Accounts for any tenant —
// self-serve signup and platform-admin tenant creation both left every new tenant financially
// non-functional (every journal post silently failed with JOURNAL_INSUFFICIENT_LINES) until
// someone manually found and clicked "Seed Default Accounts".
export async function seedDefaultAccounts(
  ctx: PlatformContext,
  tenantId: number,
  userId: number,
  vertical: 'CLOTH_RETAIL' | 'GROCERY' | 'DISTRIBUTION' | 'MANUFACTURING' = 'CLOTH_RETAIL'
): Promise<number> {
  // Distribution vertical, Phase A: no Distribution-specific accounts needed (a non-perishable
  // resale business from a COA standpoint, same as CLOTH_RETAIL) — reuses DEFAULT_ACCOUNTS,
  // per ERP-PLANNING/DISTRIBUTION-ROADMAP/02-domain-model-and-gaps.md §3. An explicit case, not
  // a fallthrough default, so a future 4th vertical can't silently inherit this by accident.
  // Manufacturing vertical, Phase A (BOM): same reasoning — no manufacturing-specific COA is in
  // scope yet, so it also reuses DEFAULT_ACCOUNTS, explicitly (not via the ternary's default arm).
  const accountList = vertical === 'GROCERY' ? GROCERY_DEFAULT_ACCOUNTS : DEFAULT_ACCOUNTS;
  await ctx.db.transaction(async (trx) => {
    const codeToId = new Map<string, number>();

    const rootAccounts = accountList.filter((a) => !a.parentCode);
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

    const existingRows = await trx.raw
      .select()
      .from(accounts)
      .where(eq(accounts.tenantId, tenantId));
    existingRows.forEach((r) => {
      if (r.accountCode) codeToId.set(r.accountCode, r.id);
    });

    const childAccounts = accountList.filter((a) => a.parentCode);
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
      count: accountList.length,
    });
  });

  return accountList.length;
}
