// C-7 fix: gap-free, FY-scoped sequential invoice numbering. Mirrors report-service's
// NumberSeriesEngine (same number_series_config table, same FY/format logic) so a tenant sees
// one continuous sequence regardless of which service touched it — this copy exists only so
// sales-service can call it with its OWN transaction handle (ES-03: everything
// confirmInTransaction touches must roll back together).

import { describe, it, expect, vi } from 'vitest';

vi.mock('drizzle-orm', () => ({
  and: (...args: unknown[]) => ({ type: 'and', args }),
  eq: (col: unknown, val: unknown) => ({ type: 'eq', col, val }),
  sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({ strings, values }),
}));

vi.mock('@erp/db', () => ({
  numberSeriesConfig: {
    tenantId: 'tenantId',
    seriesType: 'seriesType',
    financialYear: 'financialYear',
    currentSeq: 'currentSeq',
  },
}));

function makeDb(existingRows: Record<string, unknown>[], updatedRows: Record<string, unknown>[]) {
  const insertValues = vi.fn();
  let selectCallCount = 0;
  return {
    db: {
      select: () => {
        selectCallCount += 1;
        return { from: () => ({ where: () => Promise.resolve(existingRows) }) };
      },
      insert: () => ({
        values: (v: unknown) => {
          insertValues(v);
          return { onConflictDoNothing: () => Promise.resolve(undefined) };
        },
      }),
      update: () => ({
        set: () => ({ where: () => ({ returning: () => Promise.resolve(updatedRows) }) }),
      }),
    },
    insertValues,
    getSelectCallCount: () => selectCallCount,
  };
}

describe('NumberSeriesEngine.next', () => {
  it('formats INV/{FY-SHORT}/{SEQ:5} from the incremented sequence when a config row already exists', async () => {
    const { NumberSeriesEngine } = await import('../domain/NumberSeriesEngine.js');
    const { db, insertValues } = makeDb(
      [{ currentSeq: 4, formatTemplate: 'INV/{FY-SHORT}/{SEQ:5}' }],
      [{ currentSeq: 5, formatTemplate: 'INV/{FY-SHORT}/{SEQ:5}' }]
    );

    const result = await new NumberSeriesEngine(db as never).next(1, 'INVOICE');

    expect(insertValues).not.toHaveBeenCalled(); // config already existed — no seed insert
    expect(result).toMatch(/^INV\/\d{2}-\d{2}\/00005$/);
  });

  it('seeds a new config row (currentSeq starting at 0) on first use for a tenant/FY, then returns seq 1', async () => {
    const { NumberSeriesEngine } = await import('../domain/NumberSeriesEngine.js');
    const { db, insertValues } = makeDb(
      [],
      [{ currentSeq: 1, formatTemplate: 'INV/{FY-SHORT}/{SEQ:5}' }]
    );

    const result = await new NumberSeriesEngine(db as never).next(1, 'INVOICE');

    expect(insertValues).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 1, seriesType: 'INVOICE', currentSeq: 0 })
    );
    expect(result).toMatch(/^INV\/\d{2}-\d{2}\/00001$/);
  });

  it('throws NUMBER_SERIES_ERROR if the atomic update somehow returns no row', async () => {
    const { NumberSeriesEngine } = await import('../domain/NumberSeriesEngine.js');
    const { db } = makeDb([{ currentSeq: 1, formatTemplate: 'INV/{FY-SHORT}/{SEQ:5}' }], []);

    await expect(new NumberSeriesEngine(db as never).next(1, 'INVOICE')).rejects.toMatchObject({
      code: 'NUMBER_SERIES_ERROR',
    });
  });
});
