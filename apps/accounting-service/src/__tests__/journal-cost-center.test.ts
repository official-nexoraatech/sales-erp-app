import { describe, it, expect, vi } from 'vitest';
import { journals, financialEntries } from '@erp/db';
import { JournalEngine } from '../domain/JournalEngine.js';

// PG-037 regression: financial_entries.cost_center_id must resolve to the explicit
// line override when given, else the posted-to account's default_cost_center_id,
// else NULL — and existing (no-cost-center) postings must be completely unaffected.

interface CapturedLine {
  accountId: number;
  costCenterId: number | null;
}

const FOUND_ACCOUNTS = [
  {
    id: 1,
    accountCode: '5200',
    name: 'Operating Expenses',
    isActive: true,
    defaultCostCenterId: 7,
  },
  { id: 2, accountCode: '1010', name: 'Cash / Bank', isActive: true, defaultCostCenterId: null },
];

function makeDb(capturedLines: CapturedLine[]) {
  return {
    raw: {
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(FOUND_ACCOUNTS) }),
      }),
    },
    transaction: vi.fn().mockImplementation(async (cb: (trx: unknown) => Promise<void>) => {
      const trx = {
        raw: {
          insert: vi.fn().mockImplementation((table: unknown) => {
            if (table === journals) {
              return {
                values: vi
                  .fn()
                  .mockReturnValue({ returning: vi.fn().mockResolvedValue([{ id: 99 }]) }),
              };
            }
            if (table === financialEntries) {
              return {
                values: vi
                  .fn()
                  .mockImplementation((row: { accountId: number; costCenterId: number | null }) => {
                    capturedLines.push({
                      accountId: row.accountId,
                      costCenterId: row.costCenterId,
                    });
                    return Promise.resolve(undefined);
                  }),
              };
            }
            throw new Error(`Unexpected insert table in test: ${String(table)}`);
          }),
        },
        insertIntoOutbox: vi.fn().mockResolvedValue(undefined),
      };
      return cb(trx);
    }),
  } as never;
}

describe('JournalEngine.post — cost center resolution', () => {
  it('regression: posting to an account with no defaultCostCenterId still posts with cost_center_id NULL', async () => {
    const capturedLines: CapturedLine[] = [];
    const db = makeDb(capturedLines);

    await JournalEngine.post(db, 1, 1, {
      description: 'Cash payment',
      lines: [
        { accountId: 2, debitAmount: 0, creditAmount: 500 },
        { accountId: 2, debitAmount: 500, creditAmount: 0 },
      ],
    });

    expect(capturedLines.every((l) => l.costCenterId === null)).toBe(true);
  });

  it('tags a line with the posted-to account defaultCostCenterId when no explicit override is given', async () => {
    const capturedLines: CapturedLine[] = [];
    const db = makeDb(capturedLines);

    await JournalEngine.post(db, 1, 1, {
      description: 'Expense approved',
      lines: [
        { accountId: 1, debitAmount: 1000, creditAmount: 0 },
        { accountId: 2, debitAmount: 0, creditAmount: 1000 },
      ],
    });

    const expenseLine = capturedLines.find((l) => l.accountId === 1)!;
    const cashLine = capturedLines.find((l) => l.accountId === 2)!;
    expect(expenseLine.costCenterId).toBe(7);
    expect(cashLine.costCenterId).toBeNull();
  });

  it('an explicit per-line costCenterId override wins over the account default', async () => {
    const capturedLines: CapturedLine[] = [];
    const db = makeDb(capturedLines);

    await JournalEngine.post(db, 1, 1, {
      description: 'Manual journal with override',
      lines: [
        { accountId: 1, debitAmount: 1000, creditAmount: 0, costCenterId: 42 },
        { accountId: 2, debitAmount: 0, creditAmount: 1000 },
      ],
    });

    const expenseLine = capturedLines.find((l) => l.accountId === 1)!;
    expect(expenseLine.costCenterId).toBe(42);
  });
});
