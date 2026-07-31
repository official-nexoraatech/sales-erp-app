/**
 * Audit finding 2026-07-23: JournalEngine (the core double-entry validation) had no direct
 * unit test at all — every consumer test mocks JournalEngine.post/reverse entirely, so the
 * actual balance-check and period-closed logic was only ever exercised indirectly. These cover
 * the validation guards that run before any DB write (so no DB mocking is needed for them) plus
 * checkPeriodOpen's closed/open branches.
 */

import { describe, it, expect, vi } from 'vitest';

vi.mock('drizzle-orm', () => ({
  eq: (col: string, val: unknown) => ({ type: 'eq', col, val }),
  and: (...args: unknown[]) => ({ type: 'and', args }),
  sql: Object.assign(
    (strings: TemplateStringsArray, ...values: unknown[]) => ({ strings, values }),
    {
      raw: (s: string) => s,
    }
  ),
}));

vi.mock('@erp/db', () => ({
  accounts: {
    id: 'id',
    tenantId: 'tenantId',
    accountCode: 'accountCode',
    name: 'name',
    isActive: 'isActive',
    defaultCostCenterId: 'defaultCostCenterId',
  },
  financialEntries: {},
  journals: { id: 'id' },
}));

vi.mock('@erp/sdk', () => ({
  PlatformEventBus: class {
    publishInTransaction = vi.fn().mockResolvedValue(undefined);
  },
}));

describe('JournalEngine.post — balance validation', () => {
  it('throws JOURNAL_INSUFFICIENT_LINES for a single-line entry, before touching the database', async () => {
    const { JournalEngine } = await import('../domain/JournalEngine.js');

    await expect(
      JournalEngine.post(
        {} as never, // never reached — the guard fires before any db call
        1,
        7,
        {
          description: 'Bad entry',
          lines: [{ accountId: 1, debitAmount: 100, creditAmount: 0 }],
        }
      )
    ).rejects.toThrow('at least 2 lines');
  });

  it('throws JOURNAL_UNBALANCED when SUM(debit) != SUM(credit), before touching the database', async () => {
    const { JournalEngine } = await import('../domain/JournalEngine.js');

    await expect(
      JournalEngine.post({} as never, 1, 7, {
        description: 'Unbalanced entry',
        lines: [
          { accountId: 1, debitAmount: 100, creditAmount: 0 },
          { accountId: 2, debitAmount: 0, creditAmount: 90 },
        ],
      })
    ).rejects.toThrow('unbalanced');
  });

  it('does not throw the balance guard for a correctly balanced 2-line entry (fails later, on account lookup, proving the guard itself passed)', async () => {
    const { JournalEngine } = await import('../domain/JournalEngine.js');

    const db = {
      raw: {
        select: () => ({ from: () => ({ where: () => Promise.resolve([]) }) }),
      },
    };

    // Balanced amounts pass the DR=CR guard; it then throws NotFoundError('Account', ...)
    // because the mocked accounts lookup returns no rows — proving JOURNAL_UNBALANCED did NOT
    // fire for this input, without needing to mock the full insert/transaction path.
    await expect(
      JournalEngine.post(db as never, 1, 7, {
        description: 'Balanced entry',
        lines: [
          { accountId: 1, debitAmount: 100, creditAmount: 0 },
          { accountId: 2, debitAmount: 0, creditAmount: 100 },
        ],
      })
    ).rejects.not.toThrow('unbalanced');
  });
});

describe('JournalEngine.checkPeriodOpen', () => {
  it('throws when the period is CLOSED', async () => {
    const { JournalEngine } = await import('../domain/JournalEngine.js');
    const execute = vi.fn().mockResolvedValue([{ status: 'CLOSED' }]);
    const db = { raw: { execute } };

    await expect(
      JournalEngine.checkPeriodOpen(db as never, 1, new Date('2026-03-15'))
    ).rejects.toThrow();
  });

  it('resolves without throwing when no period_closures row exists for that month', async () => {
    const { JournalEngine } = await import('../domain/JournalEngine.js');
    const execute = vi.fn().mockResolvedValue([]);
    const db = { raw: { execute } };

    await expect(
      JournalEngine.checkPeriodOpen(db as never, 1, new Date('2026-03-15'))
    ).resolves.toBeUndefined();
  });

  it('resolves without throwing when the period exists but is OPEN', async () => {
    const { JournalEngine } = await import('../domain/JournalEngine.js');
    const execute = vi.fn().mockResolvedValue([{ status: 'OPEN' }]);
    const db = { raw: { execute } };

    await expect(
      JournalEngine.checkPeriodOpen(db as never, 1, new Date('2026-03-15'))
    ).resolves.toBeUndefined();
  });
});
