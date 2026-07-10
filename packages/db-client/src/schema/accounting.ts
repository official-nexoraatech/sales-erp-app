import {
  bigserial,
  boolean,
  date,
  decimal,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
  varchar,
  jsonb,
} from 'drizzle-orm/pg-core';

// ─── Chart of Accounts ─────────────────────────────────────────────────────
export const accounts = pgTable(
  'accounts',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    tenantId: integer('tenant_id').notNull(),
    parentId: integer('parent_id'),
    accountCode: varchar('account_code', { length: 30 }).notNull(),
    name: varchar('name', { length: 300 }).notNull(),
    accountType: varchar('account_type', { length: 30 })
      .notNull()
      .$type<'ASSET' | 'LIABILITY' | 'EQUITY' | 'INCOME' | 'EXPENSE' | 'CONTRA'>(),
    accountSubType: varchar('account_sub_type', { length: 50 })
      .$type<
        | 'CASH_AND_BANK'
        | 'ACCOUNTS_RECEIVABLE'
        | 'INVENTORY'
        | 'FIXED_ASSET'
        | 'OTHER_CURRENT_ASSET'
        | 'ACCOUNTS_PAYABLE'
        | 'TAX_PAYABLE'
        | 'OTHER_CURRENT_LIABILITY'
        | 'LONG_TERM_LIABILITY'
        | 'EQUITY'
        | 'RETAINED_EARNINGS'
        | 'SALES_REVENUE'
        | 'OTHER_INCOME'
        | 'COST_OF_GOODS'
        | 'OPERATING_EXPENSE'
        | 'TAX_EXPENSE'
        | 'OTHER_EXPENSE'
        | 'CONTRA_REVENUE'
        | 'INCOME_SUMMARY'
      >(),
    normalBalance: varchar('normal_balance', { length: 10 })
      .notNull()
      .$type<'DEBIT' | 'CREDIT'>(),
    isBank: boolean('is_bank').notNull().default(false),
    isCash: boolean('is_cash').notNull().default(false),
    isSystem: boolean('is_system').notNull().default(false),
    openingBalance: decimal('opening_balance', { precision: 15, scale: 2 }).notNull().default('0'),
    openingBalanceType: varchar('opening_balance_type', { length: 10 })
      .notNull()
      .default('DEBIT')
      .$type<'DEBIT' | 'CREDIT'>(),
    openingBalanceDate: varchar('opening_balance_date', { length: 10 }),
    bankName: varchar('bank_name', { length: 200 }),
    bankAccountNo: varchar('bank_account_no', { length: 50 }),
    bankIfsc: varchar('bank_ifsc', { length: 20 }),
    bankBranch: varchar('bank_branch', { length: 200 }),
    description: text('description'),
    tags: jsonb('tags').$type<string[]>().default([]),
    isActive: boolean('is_active').notNull().default(true),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    deletedBy: integer('deleted_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    createdBy: integer('created_by').notNull(),
    version: integer('version').notNull().default(0),
  },
  (t) => [
    unique('accounts_tenant_code').on(t.tenantId, t.accountCode),
    index('idx_accounts_tenant').on(t.tenantId),
    index('idx_accounts_parent').on(t.parentId, t.tenantId),
    index('idx_accounts_type').on(t.accountType, t.tenantId),
  ]
);

// ─── Opening Balances (per module) ────────────────────────────────────────
export const openingBalances = pgTable(
  'opening_balances',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    tenantId: integer('tenant_id').notNull(),
    entityType: varchar('entity_type', { length: 20 })
      .notNull()
      .$type<'CUSTOMER' | 'SUPPLIER' | 'STOCK' | 'ACCOUNT' | 'CASH_BANK'>(),
    entityId: integer('entity_id'),
    amount: decimal('amount', { precision: 15, scale: 2 }).notNull().default('0'),
    balanceType: varchar('balance_type', { length: 10 })
      .notNull()
      .$type<'DEBIT' | 'CREDIT'>(),
    asOfDate: varchar('as_of_date', { length: 10 }).notNull(),
    notes: text('notes'),
    quantity: decimal('quantity', { precision: 15, scale: 3 }),
    unitCost: decimal('unit_cost', { precision: 15, scale: 2 }),
    warehouseId: integer('warehouse_id'),
    ledgerEntryId: integer('ledger_entry_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    createdBy: integer('created_by').notNull(),
  },
  (t) => [
    index('idx_opening_balances_tenant').on(t.tenantId, t.entityType),
    index('idx_opening_balances_entity').on(t.entityType, t.entityId, t.tenantId),
  ]
);

// ─── Opening Balances Wizard State ────────────────────────────────────────
export const openingBalancesWizard = pgTable(
  'opening_balances_wizard',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    tenantId: integer('tenant_id').notNull(),
    status: varchar('status', { length: 20 })
      .notNull()
      .default('IN_PROGRESS')
      .$type<'IN_PROGRESS' | 'LOCKED'>(),
    customersCompleted: boolean('customers_completed').notNull().default(false),
    suppliersCompleted: boolean('suppliers_completed').notNull().default(false),
    stockCompleted: boolean('stock_completed').notNull().default(false),
    accountsCompleted: boolean('accounts_completed').notNull().default(false),
    cashBankCompleted: boolean('cash_bank_completed').notNull().default(false),
    lockedAt: timestamp('locked_at', { withTimezone: true }),
    lockedBy: integer('locked_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    createdBy: integer('created_by').notNull(),
  },
  (t) => [
    unique('opening_balances_wizard_tenant').on(t.tenantId),
    index('idx_ob_wizard_tenant').on(t.tenantId),
  ]
);

// ─── Journals (Double-Entry Header) ───────────────────────────────────────
// Each journal groups the DR + CR lines that make one accounting event
export const journals = pgTable(
  'journals',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    tenantId: integer('tenant_id').notNull(),
    journalId: varchar('journal_id', { length: 26 }).notNull(),
    description: varchar('description', { length: 500 }),
    referenceType: varchar('reference_type', { length: 50 }),
    referenceId: integer('reference_id'),
    reversalOf: varchar('reversal_of', { length: 26 }),
    reversedBy: varchar('reversed_by', { length: 26 }),
    isReversal: boolean('is_reversal').notNull().default(false),
    status: varchar('status', { length: 20 })
      .notNull()
      .default('POSTED')
      .$type<'POSTED' | 'REVERSED'>(),
    postedAt: timestamp('posted_at', { withTimezone: true }).defaultNow().notNull(),
    financialYearId: integer('financial_year_id'),
    periodMonth: integer('period_month'),
    periodYear: integer('period_year'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    createdBy: integer('created_by').notNull(),
  },
  (t) => [
    unique('journals_tenant_journal_id').on(t.tenantId, t.journalId),
    index('idx_journals_tenant').on(t.tenantId, t.postedAt),
    index('idx_journals_reference').on(t.referenceType, t.referenceId, t.tenantId),
    index('idx_journals_reversal_of').on(t.reversalOf),
  ]
);

// ─── Financial Entries (Double-Entry Lines — Append Only) ─────────────────
// NOTE: In production this table is PARTITIONED BY RANGE(created_at).
// Partitions created via migration SQL (not Drizzle schema) due to DDL complexity.
// Trigger validate_journal_balance (DEFERRED) enforces DR = CR per journal_id.
export const financialEntries = pgTable(
  'financial_entries',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    tenantId: integer('tenant_id').notNull(),
    journalId: varchar('journal_id', { length: 26 }).notNull(),
    accountId: integer('account_id').notNull(),
    accountCode: varchar('account_code', { length: 30 }).notNull(),
    accountName: varchar('account_name', { length: 300 }).notNull(),
    debitAmount: decimal('debit_amount', { precision: 15, scale: 2 }).notNull().default('0'),
    creditAmount: decimal('credit_amount', { precision: 15, scale: 2 }).notNull().default('0'),
    description: varchar('description', { length: 500 }),
    referenceType: varchar('reference_type', { length: 50 }),
    referenceId: integer('reference_id'),
    narration: text('narration'),
    createdBy: integer('created_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index('idx_financial_entries_journal').on(t.journalId, t.tenantId),
    index('idx_financial_entries_account').on(t.accountId, t.tenantId, t.createdAt),
    index('idx_financial_entries_tenant_date').on(t.tenantId, t.createdAt),
  ]
);

// ─── Posting Matrix (event-type → debit/credit account mapping) ───────────
export const postingMatrix = pgTable(
  'posting_matrix',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    tenantId: integer('tenant_id').notNull(),
    eventType: varchar('event_type', { length: 100 }).notNull(),
    lineLabel: varchar('line_label', { length: 100 }),
    debitAccountCode: varchar('debit_account_code', { length: 30 }).notNull(),
    creditAccountCode: varchar('credit_account_code', { length: 30 }).notNull(),
    description: varchar('description', { length: 500 }),
    sortOrder: integer('sort_order').notNull().default(0),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    createdBy: integer('created_by').notNull(),
  },
  (t) => [
    index('idx_posting_matrix_tenant_event').on(t.tenantId, t.eventType),
  ]
);

// ─── Financial Years ───────────────────────────────────────────────────────
export const financialYears = pgTable(
  'financial_years',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    tenantId: integer('tenant_id').notNull(),
    yearCode: varchar('year_code', { length: 20 }).notNull(),
    startDate: date('start_date').notNull(),
    endDate: date('end_date').notNull(),
    status: varchar('status', { length: 20 })
      .notNull()
      .default('OPEN')
      .$type<'OPEN' | 'CLOSING' | 'CLOSED'>(),
    isCurrent: boolean('is_current').notNull().default(false),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    closedBy: integer('closed_by'),
    closingEntriesJournalId: varchar('closing_entries_journal_id', { length: 26 }),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    createdBy: integer('created_by').notNull(),
  },
  (t) => [
    unique('financial_years_tenant_code').on(t.tenantId, t.yearCode),
    index('idx_financial_years_tenant').on(t.tenantId, t.status),
  ]
);

// ─── Period Closures (month-level lock) ────────────────────────────────────
export const periodClosures = pgTable(
  'period_closures',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    tenantId: integer('tenant_id').notNull(),
    financialYearId: integer('financial_year_id').notNull(),
    periodMonth: integer('period_month').notNull(),
    periodYear: integer('period_year').notNull(),
    startDate: date('start_date'),
    endDate: date('end_date'),
    status: varchar('status', { length: 20 })
      .notNull()
      .default('OPEN')
      .$type<'OPEN' | 'CLOSED'>(),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    closedBy: integer('closed_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    unique('period_closures_unique').on(t.tenantId, t.financialYearId, t.periodMonth, t.periodYear),
    index('idx_period_closures_tenant').on(t.tenantId, t.financialYearId),
  ]
);

// ─── Bank Accounts ─────────────────────────────────────────────────────────
export const bankAccounts = pgTable(
  'bank_accounts',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    tenantId: integer('tenant_id').notNull(),
    accountId: integer('account_id').notNull(),
    bankName: varchar('bank_name', { length: 200 }).notNull(),
    accountNumber: varchar('account_number', { length: 50 }),
    ifscCode: varchar('ifsc_code', { length: 20 }),
    branchName: varchar('branch_name', { length: 200 }),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    createdBy: integer('created_by').notNull(),
  },
  (t) => [
    index('idx_bank_accounts_tenant').on(t.tenantId),
  ]
);

// ─── Bank Statements ───────────────────────────────────────────────────────
export const bankStatements = pgTable(
  'bank_statements',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    tenantId: integer('tenant_id').notNull(),
    bankAccountId: integer('bank_account_id').notNull(),
    statementDate: date('statement_date').notNull(),
    openingBalance: decimal('opening_balance', { precision: 15, scale: 2 }).notNull().default('0'),
    closingBalance: decimal('closing_balance', { precision: 15, scale: 2 }).notNull().default('0'),
    filePath: varchar('file_path', { length: 500 }),
    status: varchar('status', { length: 20 })
      .notNull()
      .default('IMPORTED')
      .$type<'IMPORTED' | 'RECONCILED' | 'FINALIZED'>(),
    importedAt: timestamp('imported_at', { withTimezone: true }).defaultNow().notNull(),
    createdBy: integer('created_by').notNull(),
  },
  (t) => [
    index('idx_bank_statements_account').on(t.bankAccountId, t.tenantId),
  ]
);

// ─── Bank Reconciliation Items ─────────────────────────────────────────────
export const bankReconciliationItems = pgTable(
  'bank_reconciliation_items',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    tenantId: integer('tenant_id').notNull(),
    bankAccountId: integer('bank_account_id').notNull(),
    bankStatementId: integer('bank_statement_id'),
    itemType: varchar('item_type', { length: 10 })
      .notNull()
      .$type<'BANK' | 'BOOK'>(),
    transactionDate: date('transaction_date').notNull(),
    description: varchar('description', { length: 500 }),
    debitAmount: decimal('debit_amount', { precision: 15, scale: 2 }).notNull().default('0'),
    creditAmount: decimal('credit_amount', { precision: 15, scale: 2 }).notNull().default('0'),
    referenceNumber: varchar('reference_number', { length: 100 }),
    status: varchar('status', { length: 20 })
      .notNull()
      .default('UNMATCHED')
      .$type<'UNMATCHED' | 'MATCHED' | 'CLEARED'>(),
    matchedItemId: integer('matched_item_id'),
    journalId: varchar('journal_id', { length: 26 }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    createdBy: integer('created_by').notNull(),
  },
  (t) => [
    index('idx_bank_recon_account').on(t.bankAccountId, t.tenantId),
    index('idx_bank_recon_status').on(t.status, t.bankAccountId),
  ]
);

// ─── Fixed Assets ──────────────────────────────────────────────────────────
export const fixedAssets = pgTable(
  'fixed_assets',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    tenantId: integer('tenant_id').notNull(),
    assetCode: varchar('asset_code', { length: 30 }).notNull(),
    name: varchar('name', { length: 300 }).notNull(),
    category: varchar('category', { length: 100 }),
    accountId: integer('account_id').notNull(),
    accumulatedDepreciationAccountId: integer('accumulated_depreciation_account_id'),
    depreciationExpenseAccountId: integer('depreciation_expense_account_id'),
    purchaseDate: date('purchase_date').notNull(),
    purchaseCost: decimal('purchase_cost', { precision: 15, scale: 2 }).notNull(),
    salvageValue: decimal('salvage_value', { precision: 15, scale: 2 }).notNull().default('0'),
    usefulLifeMonths: integer('useful_life_months').notNull(),
    depreciationMethod: varchar('depreciation_method', { length: 10 })
      .notNull()
      .default('SLM')
      .$type<'SLM' | 'WDV'>(),
    wdvRate: decimal('wdv_rate', { precision: 5, scale: 2 }),
    currentValue: decimal('current_value', { precision: 15, scale: 2 }).notNull(),
    accumulatedDepreciation: decimal('accumulated_depreciation', { precision: 15, scale: 2 })
      .notNull()
      .default('0'),
    disposalDate: date('disposal_date'),
    disposalType: varchar('disposal_type', { length: 20 }).$type<'SALE' | 'SCRAP'>(),
    disposalAmount: decimal('disposal_amount', { precision: 15, scale: 2 }),
    disposalJournalId: varchar('disposal_journal_id', { length: 26 }),
    status: varchar('status', { length: 20 })
      .notNull()
      .default('ACTIVE')
      .$type<'ACTIVE' | 'DISPOSED'>(),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    createdBy: integer('created_by').notNull(),
    version: integer('version').notNull().default(0),
  },
  (t) => [
    unique('fixed_assets_tenant_code').on(t.tenantId, t.assetCode),
    index('idx_fixed_assets_tenant').on(t.tenantId, t.status),
  ]
);

// ─── Asset Depreciation Schedule ───────────────────────────────────────────
export const assetDepreciationSchedule = pgTable(
  'asset_depreciation_schedule',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    tenantId: integer('tenant_id').notNull(),
    assetId: integer('asset_id').notNull(),
    periodMonth: integer('period_month').notNull(),
    periodYear: integer('period_year').notNull(),
    openingValue: decimal('opening_value', { precision: 15, scale: 2 }).notNull(),
    depreciationAmount: decimal('depreciation_amount', { precision: 15, scale: 2 }).notNull(),
    closingValue: decimal('closing_value', { precision: 15, scale: 2 }).notNull(),
    journalId: varchar('journal_id', { length: 26 }),
    postedAt: timestamp('posted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    unique('asset_depreciation_unique').on(t.tenantId, t.assetId, t.periodMonth, t.periodYear),
    index('idx_asset_depr_asset').on(t.assetId, t.tenantId),
  ]
);

// ─── TDS Entries ───────────────────────────────────────────────────────────
export const tdsEntries = pgTable(
  'tds_entries',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    tenantId: integer('tenant_id').notNull(),
    supplierId: integer('supplier_id').notNull(),
    paymentId: integer('payment_id').notNull(),
    tdsSection: varchar('tds_section', { length: 10 })
      .notNull()
      .$type<'194C' | '194H' | '194J'>(),
    taxableAmount: decimal('taxable_amount', { precision: 15, scale: 2 }).notNull(),
    tdsRate: decimal('tds_rate', { precision: 5, scale: 2 }).notNull(),
    tdsAmount: decimal('tds_amount', { precision: 15, scale: 2 }).notNull(),
    periodMonth: integer('period_month').notNull(),
    periodYear: integer('period_year').notNull(),
    depositStatus: varchar('deposit_status', { length: 20 })
      .notNull()
      .default('PENDING')
      .$type<'PENDING' | 'DEPOSITED'>(),
    depositedAt: timestamp('deposited_at', { withTimezone: true }),
    depositedBy: integer('deposited_by'),
    journalId: varchar('journal_id', { length: 26 }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    createdBy: integer('created_by').notNull(),
  },
  (t) => [
    index('idx_tds_entries_tenant').on(t.tenantId, t.periodYear, t.periodMonth),
    index('idx_tds_entries_supplier').on(t.supplierId, t.tenantId),
  ]
);

// ─── TDS Certificates ──────────────────────────────────────────────────────
export const tdsCertificates = pgTable(
  'tds_certificates',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    tenantId: integer('tenant_id').notNull(),
    supplierId: integer('supplier_id').notNull(),
    certificateNumber: varchar('certificate_number', { length: 50 }),
    periodQuarter: integer('period_quarter').notNull(),
    periodYear: integer('period_year').notNull(),
    totalTaxableAmount: decimal('total_taxable_amount', { precision: 15, scale: 2 }).notNull(),
    totalTdsAmount: decimal('total_tds_amount', { precision: 15, scale: 2 }).notNull(),
    tdsSection: varchar('tds_section', { length: 10 })
      .notNull()
      .$type<'194C' | '194H' | '194J'>(),
    formType: varchar('form_type', { length: 10 }).notNull().default('16A'),
    generatedAt: timestamp('generated_at', { withTimezone: true }),
    generatedBy: integer('generated_by'),
    filePath: varchar('file_path', { length: 500 }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    unique('tds_certificates_unique').on(t.tenantId, t.supplierId, t.periodQuarter, t.periodYear, t.tdsSection),
    index('idx_tds_certificates_tenant').on(t.tenantId, t.periodYear),
  ]
);

// ─── Trial Balance Snapshots (PG-026 — daily persisted snapshot) ──────────
export const trialBalanceSnapshots = pgTable(
  'trial_balance_snapshots',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    tenantId: integer('tenant_id').notNull(),
    asOfDate: date('as_of_date').notNull(),
    totalDebit: decimal('total_debit', { precision: 15, scale: 2 }).notNull(),
    totalCredit: decimal('total_credit', { precision: 15, scale: 2 }).notNull(),
    isBalanced: boolean('is_balanced').notNull(),
    accountCount: integer('account_count').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    unique('trial_balance_snapshots_tenant_date').on(t.tenantId, t.asOfDate),
    index('idx_trial_balance_snapshots_tenant').on(t.tenantId, t.asOfDate),
  ]
);

// ─── Type Exports ──────────────────────────────────────────────────────────
export type Account = typeof accounts.$inferSelect;
export type NewAccount = typeof accounts.$inferInsert;
export type OpeningBalance = typeof openingBalances.$inferSelect;
export type NewOpeningBalance = typeof openingBalances.$inferInsert;
export type OpeningBalancesWizard = typeof openingBalancesWizard.$inferSelect;
export type Journal = typeof journals.$inferSelect;
export type NewJournal = typeof journals.$inferInsert;
export type FinancialEntry = typeof financialEntries.$inferSelect;
export type NewFinancialEntry = typeof financialEntries.$inferInsert;
export type PostingMatrix = typeof postingMatrix.$inferSelect;
export type FinancialYear = typeof financialYears.$inferSelect;
export type PeriodClosure = typeof periodClosures.$inferSelect;
export type BankAccount = typeof bankAccounts.$inferSelect;
export type BankStatement = typeof bankStatements.$inferSelect;
export type BankReconciliationItem = typeof bankReconciliationItems.$inferSelect;
export type FixedAsset = typeof fixedAssets.$inferSelect;
export type AssetDepreciationSchedule = typeof assetDepreciationSchedule.$inferSelect;
export type TDSEntry = typeof tdsEntries.$inferSelect;
export type TDSCertificate = typeof tdsCertificates.$inferSelect;
export type TrialBalanceSnapshot = typeof trialBalanceSnapshots.$inferSelect;
