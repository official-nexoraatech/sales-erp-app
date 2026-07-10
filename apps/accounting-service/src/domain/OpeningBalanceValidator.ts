// PG-035: full trial-balance validation for the Opening Balance Wizard lock step.
//
// Scope note: locking the wizard does NOT post to `financial_entries` anywhere in
// this codebase today (confirmed by grep — only an OPENING_BALANCES_LOCKED event is
// published, with no consumer that journals it). So this check reconciles only the
// `openingBalances` staging table against itself; it does not read financial_entries.
//
// Recommended interpretation (per PG-035): Customers/Suppliers/Stock/CashBank rows are
// authoritative sub-ledger detail. The Accounts step must not also carry a GL account
// whose accountSubType is one of the sub-ledger-covered types below, since that would
// double-count the same balance.

export interface OpeningBalanceRow {
  entityType: 'CUSTOMER' | 'SUPPLIER' | 'STOCK' | 'ACCOUNT' | 'CASH_BANK';
  entityId: number | null;
  amount: string;
  balanceType: 'DEBIT' | 'CREDIT';
}

export interface AccountSubTypeLookup {
  id: number;
  accountSubType: string | null;
}

export interface CategoryBreakdown {
  debit: number;
  credit: number;
}

export interface DoubleEntryViolation {
  accountId: number;
  accountSubType: string;
  amount: number;
}

export interface TrialBalanceValidationResult {
  balanced: boolean;
  totalDebit: number;
  totalCredit: number;
  overallDifference: number;
  breakdown: {
    customers: CategoryBreakdown;
    suppliers: CategoryBreakdown;
    stock: CategoryBreakdown;
    accounts: CategoryBreakdown;
    cashBank: CategoryBreakdown;
  };
  doubleEntryViolations: DoubleEntryViolation[];
}

const SUB_LEDGER_COVERED_SUBTYPES = new Set(['ACCOUNTS_RECEIVABLE', 'ACCOUNTS_PAYABLE', 'CASH_AND_BANK', 'INVENTORY']);

export function validateOpeningBalanceTrialBalance(
  balances: OpeningBalanceRow[],
  accountSubTypes: AccountSubTypeLookup[]
): TrialBalanceValidationResult {
  const subTypeByAccountId = new Map(accountSubTypes.map((a) => [a.id, a.accountSubType]));

  const breakdown = {
    customers: { debit: 0, credit: 0 },
    suppliers: { debit: 0, credit: 0 },
    stock: { debit: 0, credit: 0 },
    accounts: { debit: 0, credit: 0 },
    cashBank: { debit: 0, credit: 0 },
  };
  const doubleEntryViolations: DoubleEntryViolation[] = [];

  for (const b of balances) {
    const amt = parseFloat(b.amount);
    const category =
      b.entityType === 'CUSTOMER'
        ? breakdown.customers
        : b.entityType === 'SUPPLIER'
          ? breakdown.suppliers
          : b.entityType === 'STOCK'
            ? breakdown.stock
            : b.entityType === 'CASH_BANK'
              ? breakdown.cashBank
              : breakdown.accounts;

    if (b.balanceType === 'DEBIT') category.debit += amt;
    else category.credit += amt;

    if (b.entityType === 'ACCOUNT' && b.entityId != null) {
      const subType = subTypeByAccountId.get(b.entityId);
      if (subType && SUB_LEDGER_COVERED_SUBTYPES.has(subType)) {
        doubleEntryViolations.push({ accountId: b.entityId, accountSubType: subType, amount: amt });
      }
    }
  }

  const totalDebit =
    breakdown.customers.debit + breakdown.suppliers.debit + breakdown.stock.debit + breakdown.accounts.debit + breakdown.cashBank.debit;
  const totalCredit =
    breakdown.customers.credit + breakdown.suppliers.credit + breakdown.stock.credit + breakdown.accounts.credit + breakdown.cashBank.credit;
  const overallDifference = Math.abs(totalDebit - totalCredit);

  return {
    balanced: overallDifference <= 0.01,
    totalDebit,
    totalCredit,
    overallDifference,
    breakdown,
    doubleEntryViolations,
  };
}
