import { eq, and, sql } from 'drizzle-orm';
import {
  bankAccounts,
  bankStatements,
  bankReconciliationItems,
  financialEntries,
  journals,
} from '@erp/db';
import type { TenantScopedDatabase } from '@erp/sdk';
import { BusinessError, NotFoundError } from '@erp/types';

export interface BankStatementRow {
  date: string;
  description: string;
  debitAmount: number;
  creditAmount: number;
  referenceNumber?: string;
}

export class BankReconciliationService {
  static async createBankAccount(
    db: TenantScopedDatabase,
    tenantId: number,
    userId: number,
    data: {
      accountId: number;
      bankName: string;
      accountNumber?: string;
      ifscCode?: string;
      branchName?: string;
    }
  ): Promise<typeof bankAccounts.$inferSelect> {
    const [created] = await db.raw
      .insert(bankAccounts)
      .values({
        tenantId,
        accountId: data.accountId,
        bankName: data.bankName,
        accountNumber: data.accountNumber,
        ifscCode: data.ifscCode,
        branchName: data.branchName,
        isActive: true,
        createdBy: userId,
      } as typeof bankAccounts.$inferInsert)
      .returning();
    if (!created) throw new Error('Bank account insert failed');
    return created;
  }

  static async importStatement(
    db: TenantScopedDatabase,
    tenantId: number,
    userId: number,
    bankAccountId: number,
    rows: BankStatementRow[],
    openingBalance: number,
    closingBalance: number
  ): Promise<{ statementId: number; itemsImported: number }> {
    // Verify bank account belongs to tenant
    const [bankAcc] = await db.raw
      .select()
      .from(bankAccounts)
      .where(and(eq(bankAccounts.id, bankAccountId), eq(bankAccounts.tenantId, tenantId)));
    if (!bankAcc) throw new NotFoundError('BankAccount', bankAccountId);

    return db.transaction(async (trx) => {
      const [stmt] = await trx.raw
        .insert(bankStatements)
        .values({
          tenantId,
          bankAccountId,
          statementDate: rows[rows.length - 1]?.date ?? new Date().toISOString().substring(0, 10),
          openingBalance: String(openingBalance),
          closingBalance: String(closingBalance),
          status: 'IMPORTED',
          importedAt: new Date(),
          createdBy: userId,
        } as typeof bankStatements.$inferInsert)
        .returning();
      if (!stmt) throw new Error('Statement insert failed');

      for (const row of rows) {
        await trx.raw.insert(bankReconciliationItems).values({
          tenantId,
          bankAccountId,
          bankStatementId: stmt.id,
          itemType: 'BANK',
          transactionDate: row.date,
          description: row.description,
          debitAmount: String(row.debitAmount),
          creditAmount: String(row.creditAmount),
          referenceNumber: row.referenceNumber,
          status: 'UNMATCHED',
          createdBy: userId,
        } as typeof bankReconciliationItems.$inferInsert);
      }

      // Also pull unmatched BOOK entries (journal lines for this bank account)
      const bankAccountEntry = await trx.raw
        .select({ journalId: financialEntries.journalId })
        .from(financialEntries)
        .where(and(
          eq(financialEntries.tenantId, tenantId),
          eq(financialEntries.accountId, bankAcc.accountId),
          sql`${financialEntries.createdAt} >= ${new Date(rows[0]?.date ?? new Date())}`
        ));

      for (const entry of bankAccountEntry) {
        await trx.raw.insert(bankReconciliationItems).values({
          tenantId,
          bankAccountId,
          bankStatementId: stmt.id,
          itemType: 'BOOK',
          transactionDate: new Date().toISOString().substring(0, 10),
          description: `Journal ${entry.journalId}`,
          journalId: entry.journalId,
          debitAmount: '0',
          creditAmount: '0',
          status: 'UNMATCHED',
          createdBy: userId,
        } as typeof bankReconciliationItems.$inferInsert).onConflictDoNothing();
      }

      return { statementId: stmt.id, itemsImported: rows.length };
    });
  }

  static async getItems(
    db: TenantScopedDatabase,
    tenantId: number,
    bankAccountId: number
  ): Promise<typeof bankReconciliationItems.$inferSelect[]> {
    return db.raw
      .select()
      .from(bankReconciliationItems)
      .where(and(
        eq(bankReconciliationItems.tenantId, tenantId),
        eq(bankReconciliationItems.bankAccountId, bankAccountId)
      ));
  }

  static async matchItem(
    db: TenantScopedDatabase,
    tenantId: number,
    userId: number,
    itemId: number,
    matchedItemId: number
  ): Promise<void> {
    const [item] = await db.raw
      .select()
      .from(bankReconciliationItems)
      .where(and(eq(bankReconciliationItems.id, itemId), eq(bankReconciliationItems.tenantId, tenantId)));
    if (!item) throw new NotFoundError('ReconciliationItem', itemId);
    if (item.status !== 'UNMATCHED') {
      throw new BusinessError('ITEM_ALREADY_MATCHED', 'This item is already matched or cleared');
    }

    await db.transaction(async (trx) => {
      await trx.raw
        .update(bankReconciliationItems)
        .set({ status: 'MATCHED', matchedItemId })
        .where(eq(bankReconciliationItems.id, itemId));

      await trx.raw
        .update(bankReconciliationItems)
        .set({ status: 'MATCHED', matchedItemId: itemId })
        .where(and(eq(bankReconciliationItems.id, matchedItemId), eq(bankReconciliationItems.tenantId, tenantId)));
    });
  }

  static async getSummary(
    db: TenantScopedDatabase,
    tenantId: number,
    bankAccountId: number
  ): Promise<{
    totalBankItems: number;
    totalBookItems: number;
    matchedItems: number;
    unmatchedBankItems: number;
    unmatchedBookItems: number;
    isReconciled: boolean;
  }> {
    const items = await BankReconciliationService.getItems(db, tenantId, bankAccountId);
    const bankItems = items.filter((i) => i.itemType === 'BANK');
    const bookItems = items.filter((i) => i.itemType === 'BOOK');
    const matched = items.filter((i) => i.status === 'MATCHED').length;
    const unmatchedBank = bankItems.filter((i) => i.status === 'UNMATCHED').length;
    const unmatchedBook = bookItems.filter((i) => i.status === 'UNMATCHED').length;

    return {
      totalBankItems: bankItems.length,
      totalBookItems: bookItems.length,
      matchedItems: matched,
      unmatchedBankItems: unmatchedBank,
      unmatchedBookItems: unmatchedBook,
      isReconciled: unmatchedBank === 0 && unmatchedBook === 0,
    };
  }

  static async finalizeReconciliation(
    db: TenantScopedDatabase,
    tenantId: number,
    bankAccountId: number,
    statementId: number
  ): Promise<void> {
    const summary = await BankReconciliationService.getSummary(db, tenantId, bankAccountId);
    if (!summary.isReconciled) {
      throw new BusinessError(
        'RECONCILIATION_INCOMPLETE',
        `Cannot finalize: ${summary.unmatchedBankItems} bank items and ${summary.unmatchedBookItems} book items remain unmatched`
      );
    }

    await db.raw
      .update(bankStatements)
      .set({ status: 'FINALIZED' })
      .where(and(eq(bankStatements.id, statementId), eq(bankStatements.tenantId, tenantId)));
  }
}
