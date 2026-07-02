import { describe, it, expect, vi } from 'vitest';
import { periodClosures } from '@erp/db';

// ─── Helpers ─────────────────────────────────────────────────────────────────

interface InsertedRow {
  tenantId: number;
  financialYearId: number;
  periodMonth: number;
  periodYear: number;
  startDate: string;
  endDate: string;
  status: string;
}

function makeMockDb(capturedRows: InsertedRow[], mockFy: unknown): object {
  const onConflictDoNothing = vi.fn().mockResolvedValue(undefined);
  return {
    raw: {
      update: vi.fn().mockReturnValue({
        set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }),
      }),
      insert: vi.fn().mockImplementation((table: unknown) => {
        if (table === periodClosures) {
          return {
            values: vi.fn().mockImplementation((rows: InsertedRow[]) => {
              capturedRows.push(...rows);
              return { onConflictDoNothing };
            }),
          };
        }
        return {
          values: vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue([mockFy]) }),
        };
      }),
    },
  };
}

const BASE_FY = {
  tenantId: 1,
  yearCode: 'FY2026-27',
  startDate: '2026-04-01',
  endDate: '2027-03-31',
  status: 'OPEN',
  isCurrent: false,
  createdBy: 1,
  createdAt: new Date(),
  closedAt: null,
  closedBy: null,
  closingEntriesJournalId: null,
  notes: null,
};

describe('FinancialYearService period seeding', () => {
  it('seeds exactly 12 period_closures rows for April 2026 – March 2027', async () => {
    const { FinancialYearService } = await import('../domain/FinancialYearService.js');
    const rows: InsertedRow[] = [];
    const mockDb = makeMockDb(rows, { ...BASE_FY, id: 42, isCurrent: true });

    await FinancialYearService.create(
      mockDb as never,
      1,
      1,
      { yearCode: 'FY2026-27', startDate: '2026-04-01', endDate: '2027-03-31', isCurrent: true }
    );

    expect(rows).toHaveLength(12);
  });

  it('generates correct start_date and end_date for each month (April 2026 – March 2027)', async () => {
    const { FinancialYearService } = await import('../domain/FinancialYearService.js');
    const rows: InsertedRow[] = [];
    const mockDb = makeMockDb(rows, { ...BASE_FY, id: 43 });

    await FinancialYearService.create(
      mockDb as never,
      1,
      1,
      { yearCode: 'FY2026-27', startDate: '2026-04-01', endDate: '2027-03-31' }
    );

    const expected: Array<{ month: number; year: number; start: string; end: string }> = [
      { month: 4,  year: 2026, start: '2026-04-01', end: '2026-04-30' },
      { month: 5,  year: 2026, start: '2026-05-01', end: '2026-05-31' },
      { month: 6,  year: 2026, start: '2026-06-01', end: '2026-06-30' },
      { month: 7,  year: 2026, start: '2026-07-01', end: '2026-07-31' },
      { month: 8,  year: 2026, start: '2026-08-01', end: '2026-08-31' },
      { month: 9,  year: 2026, start: '2026-09-01', end: '2026-09-30' },
      { month: 10, year: 2026, start: '2026-10-01', end: '2026-10-31' },
      { month: 11, year: 2026, start: '2026-11-01', end: '2026-11-30' },
      { month: 12, year: 2026, start: '2026-12-01', end: '2026-12-31' },
      { month: 1,  year: 2027, start: '2027-01-01', end: '2027-01-31' },
      { month: 2,  year: 2027, start: '2027-02-01', end: '2027-02-28' },
      { month: 3,  year: 2027, start: '2027-03-01', end: '2027-03-31' },
    ];

    expect(rows).toHaveLength(12);
    rows.forEach((row, i) => {
      const exp = expected[i];
      expect(row.periodMonth).toBe(exp?.month);
      expect(row.periodYear).toBe(exp?.year);
      expect(row.startDate).toBe(exp?.start);
      expect(row.endDate).toBe(exp?.end);
    });
  });

  it('all 12 seeded rows have status OPEN', async () => {
    const { FinancialYearService } = await import('../domain/FinancialYearService.js');
    const rows: InsertedRow[] = [];
    const mockDb = makeMockDb(rows, { ...BASE_FY, id: 44 });

    await FinancialYearService.create(
      mockDb as never,
      1,
      1,
      { yearCode: 'FY2026-27', startDate: '2026-04-01', endDate: '2027-03-31' }
    );

    expect(rows).toHaveLength(12);
    for (const row of rows) {
      expect(row.status).toBe('OPEN');
    }
  });
});
