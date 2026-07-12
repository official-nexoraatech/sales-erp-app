import { ulid } from 'ulid';
import { eq, and, sql } from 'drizzle-orm';
import { accounts, financialEntries, journals } from '@erp/db';
import type { TenantScopedDatabase } from '@erp/sdk';
import { PlatformEventBus } from '@erp/sdk';
import { BusinessError, FinancialPeriodClosedError, NotFoundError } from '@erp/types';

export interface JournalLine {
  accountId: number;
  debitAmount: number;
  creditAmount: number;
  description?: string;
  narration?: string;
  // PG-037: explicit override. When omitted, resolved from the posted-to account's
  // defaultCostCenterId at insert time (see post() below) — additive, defaults to null.
  costCenterId?: number;
}

export interface JournalEntry {
  journalId?: string;
  description: string;
  referenceType?: string;
  referenceId?: number;
  lines: JournalLine[];
}

export interface PostedJournal {
  journalId: string;
  linesPosted: number;
}

export class JournalEngine {
  // Post a balanced journal entry.
  // Validates: ≥2 lines, sum(DR) = sum(CR), all accounts exist+active.
  // The DB trigger validate_journal_balance (DEFERRED) provides a final safety net.
  static async post(
    db: TenantScopedDatabase,
    tenantId: number,
    userId: number,
    entry: JournalEntry,
    correlationId?: string
  ): Promise<PostedJournal> {
    const journalId = entry.journalId ?? ulid();

    if (entry.lines.length < 2) {
      throw new BusinessError(
        'JOURNAL_INSUFFICIENT_LINES',
        'A journal entry requires at least 2 lines'
      );
    }

    const totalDr = entry.lines.reduce((sum, l) => sum + l.debitAmount, 0);
    const totalCr = entry.lines.reduce((sum, l) => sum + l.creditAmount, 0);

    if (Math.abs(totalDr - totalCr) > 0.01) {
      throw new BusinessError(
        'JOURNAL_UNBALANCED',
        `Journal is unbalanced: SUM(DR)=${totalDr.toFixed(2)} ≠ SUM(CR)=${totalCr.toFixed(2)}`
      );
    }

    // Verify all account IDs exist and are active for this tenant
    const accountIds = [...new Set(entry.lines.map((l) => l.accountId))];
    const foundAccounts = await db.raw
      .select({
        id: accounts.id,
        accountCode: accounts.accountCode,
        name: accounts.name,
        isActive: accounts.isActive,
        defaultCostCenterId: accounts.defaultCostCenterId,
      })
      .from(accounts)
      .where(and(eq(accounts.tenantId, tenantId)));

    const accountMap = new Map(foundAccounts.map((a) => [a.id, a]));

    for (const id of accountIds) {
      const acc = accountMap.get(id);
      if (!acc) throw new NotFoundError('Account', id);
      if (!acc.isActive) {
        throw new BusinessError(
          'ACCOUNT_INACTIVE',
          `Account ${id} is inactive and cannot receive postings`
        );
      }
    }

    const now = new Date();
    const periodMonth = now.getMonth() + 1;
    const periodYear = now.getFullYear();

    await db.transaction(async (trx) => {
      // Insert journal header
      const [journalRow] = await trx.raw
        .insert(journals)
        .values({
          tenantId,
          journalId,
          description: entry.description,
          referenceType: entry.referenceType,
          referenceId: entry.referenceId,
          isReversal: false,
          status: 'POSTED',
          postedAt: now,
          periodMonth,
          periodYear,
          createdBy: userId,
          createdAt: now,
        } as typeof journals.$inferInsert)
        .returning({ id: journals.id });

      // Insert all lines within the same transaction
      // The DEFERRED trigger validate_journal_balance fires at TX commit
      for (const line of entry.lines) {
        const acc = accountMap.get(line.accountId)!;
        // PG-037: explicit line override, else the posted-to account's default, else NULL.
        const costCenterId = line.costCenterId ?? acc.defaultCostCenterId ?? null;
        await trx.raw.insert(financialEntries).values({
          tenantId,
          journalId,
          accountId: line.accountId,
          accountCode: acc.accountCode,
          accountName: acc.name,
          debitAmount: String(line.debitAmount),
          creditAmount: String(line.creditAmount),
          description: line.description ?? entry.description,
          referenceType: entry.referenceType,
          referenceId: entry.referenceId,
          narration: line.narration,
          costCenterId,
          createdBy: userId,
          createdAt: now,
        } as typeof financialEntries.$inferInsert);
      }

      // ES-24 [M15]: publish JOURNAL_POSTED in the same transaction as the write.
      // aggregateId must be the journals table's numeric surrogate PK (outbox_events.
      // aggregate_id is an integer column) — journalId itself is a ulid business key,
      // carried in the payload for consumers instead.
      const eventBus = new PlatformEventBus(trx, tenantId, userId, correlationId ?? ulid());
      await eventBus.publishInTransaction('journal', journalRow!.id, 'JOURNAL_POSTED', {
        journalId,
        description: entry.description,
        referenceType: entry.referenceType,
        referenceId: entry.referenceId,
        totalDebit: totalDr,
        totalCredit: totalCr,
        linesPosted: entry.lines.length,
      });
    });

    return { journalId, linesPosted: entry.lines.length };
  }

  // Create a reversal journal — all DR/CR flipped, linked via reversal_of
  static async reverse(
    db: TenantScopedDatabase,
    tenantId: number,
    userId: number,
    originalJournalId: string,
    reason?: string,
    correlationId?: string
  ): Promise<PostedJournal> {
    // Load original journal
    const [originalJournal] = await db.raw
      .select()
      .from(journals)
      .where(and(eq(journals.tenantId, tenantId), eq(journals.journalId, originalJournalId)));

    if (!originalJournal) throw new NotFoundError('Journal', originalJournalId);
    if (originalJournal.status === 'REVERSED') {
      throw new BusinessError(
        'JOURNAL_ALREADY_REVERSED',
        `Journal ${originalJournalId} is already reversed`
      );
    }

    // Load original entries
    const originalEntries = await db.raw
      .select()
      .from(financialEntries)
      .where(
        and(
          eq(financialEntries.tenantId, tenantId),
          eq(financialEntries.journalId, originalJournalId)
        )
      );

    if (originalEntries.length === 0) {
      throw new BusinessError(
        'JOURNAL_NO_ENTRIES',
        `Journal ${originalJournalId} has no entries to reverse`
      );
    }

    const reversalJournalId = ulid();
    const now = new Date();
    const periodMonth = now.getMonth() + 1;
    const periodYear = now.getFullYear();

    await db.transaction(async (trx) => {
      // Insert reversal journal header
      const [reversalRow] = await trx.raw
        .insert(journals)
        .values({
          tenantId,
          journalId: reversalJournalId,
          description: reason ?? `Reversal of journal ${originalJournalId}`,
          referenceType: originalJournal.referenceType,
          referenceId: originalJournal.referenceId,
          reversalOf: originalJournalId,
          isReversal: true,
          status: 'POSTED',
          postedAt: now,
          periodMonth,
          periodYear,
          createdBy: userId,
          createdAt: now,
        } as typeof journals.$inferInsert)
        .returning({ id: journals.id });

      // Flip DR/CR for each line
      for (const entry of originalEntries) {
        await trx.raw.insert(financialEntries).values({
          tenantId,
          journalId: reversalJournalId,
          accountId: entry.accountId,
          accountCode: entry.accountCode,
          accountName: entry.accountName,
          // Swap DR and CR exactly
          debitAmount: entry.creditAmount,
          creditAmount: entry.debitAmount,
          description: `[Reversal] ${entry.description ?? ''}`.trim(),
          referenceType: entry.referenceType,
          referenceId: entry.referenceId,
          narration: entry.narration,
          costCenterId: entry.costCenterId,
          createdBy: userId,
          createdAt: now,
        } as typeof financialEntries.$inferInsert);
      }

      // Mark original journal as reversed
      await trx.raw
        .update(journals)
        .set({ status: 'REVERSED', reversedBy: reversalJournalId })
        .where(and(eq(journals.tenantId, tenantId), eq(journals.journalId, originalJournalId)));

      // ES-24 [M15]: publish JOURNAL_REVERSED in the same transaction as the write.
      const eventBus = new PlatformEventBus(trx, tenantId, userId, correlationId ?? ulid());
      await eventBus.publishInTransaction('journal', reversalRow!.id, 'JOURNAL_REVERSED', {
        journalId: reversalJournalId,
        originalJournalId,
        reason: reason ?? null,
        linesPosted: originalEntries.length,
      });
    });

    return { journalId: reversalJournalId, linesPosted: originalEntries.length };
  }

  // Check if the accounting period is open for posting
  static async checkPeriodOpen(
    db: TenantScopedDatabase,
    tenantId: number,
    postingDate: Date
  ): Promise<void> {
    const month = postingDate.getMonth() + 1;
    const year = postingDate.getFullYear();
    const periodLabel = `${year}-${String(month).padStart(2, '0')}`;

    const [closure] = (await db.raw.execute(
      sql`SELECT status FROM period_closures
          WHERE tenant_id = ${tenantId}
            AND period_month = ${month}
            AND period_year = ${year}
          LIMIT 1`
    )) as { status: string }[];

    if (closure?.status === 'CLOSED') {
      throw new FinancialPeriodClosedError(periodLabel);
    }
  }
}
