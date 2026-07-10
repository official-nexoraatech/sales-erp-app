/**
 * PG-039 — GstReturnTrackerService's manual-adjustment persistence for GSTR-3B's
 * import-of-goods/import-of-services IGST override (no schema field exists to compute these
 * from gst_ledger, so a user enters the real figure before filing — see Gstr3bService).
 */

import { describe, it, expect, vi } from 'vitest';

vi.mock('@erp/db', () => ({
  gstReturnFilings: {
    id: 'id',
    tenantId: 'tenantId',
    returnType: 'returnType',
    period: 'period',
    manualAdjustments: 'manualAdjustments',
  },
}));

vi.mock('drizzle-orm', () => ({
  and: (...args: unknown[]) => ({ type: 'and', args }),
  eq: (col: string, val: unknown) => ({ type: 'eq', col, val }),
}));

function makeChainableDb(finalResult: unknown) {
  const chainable: Record<string, unknown> = {};
  for (const m of ['select', 'from', 'where', 'orderBy', 'insert', 'values', 'update', 'set']) {
    chainable[m] = vi.fn(() => chainable);
  }
  chainable['onConflictDoUpdate'] = vi.fn(() => Promise.resolve(finalResult));
  (chainable as { then: unknown })['then'] = (resolve: (v: unknown) => void) =>
    Promise.resolve(finalResult).then(resolve);
  return { raw: chainable, chainable };
}

describe('GstReturnTrackerService — GSTR-3B manual adjustments', () => {
  it('getGstr3bManualAdjustments returns null when no filing row exists for the period', async () => {
    const { GstReturnTrackerService } = await import('../domain/GstReturnTrackerService.js');
    const { raw } = makeChainableDb([]);

    const result = await GstReturnTrackerService.getGstr3bManualAdjustments(
      { raw } as never,
      1,
      '2025-06'
    );

    expect(result).toBeNull();
  });

  it('getGstr3bManualAdjustments returns the saved adjustment when a row exists', async () => {
    const { GstReturnTrackerService } = await import('../domain/GstReturnTrackerService.js');
    const saved = { importOfGoodsIgst: 5000, enteredBy: 7, enteredAt: '2025-07-01T00:00:00.000Z' };
    const { raw } = makeChainableDb([{ manualAdjustments: saved }]);

    const result = await GstReturnTrackerService.getGstr3bManualAdjustments(
      { raw } as never,
      1,
      '2025-06'
    );

    expect(result).toEqual(saved);
  });

  it('saveGstr3bManualAdjustments upserts the gst_return_filings row keyed on tenant/type/period', async () => {
    const { GstReturnTrackerService } = await import('../domain/GstReturnTrackerService.js');
    const { raw, chainable } = makeChainableDb(undefined);

    await GstReturnTrackerService.saveGstr3bManualAdjustments(
      { raw } as never,
      1,
      7,
      '2025-06',
      { importOfGoodsIgst: 5000 }
    );

    expect(chainable['insert']).toHaveBeenCalled();
    const valuesCall = (chainable['values'] as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as Record<string, unknown>;
    expect(valuesCall['tenantId']).toBe(1);
    expect(valuesCall['returnType']).toBe('GSTR3B');
    expect(valuesCall['period']).toBe('2025-06');
    const insertedAdjustments = valuesCall['manualAdjustments'] as Record<string, unknown>;
    expect(insertedAdjustments['importOfGoodsIgst']).toBe(5000);
    expect(insertedAdjustments['enteredBy']).toBe(7);
    expect(typeof insertedAdjustments['enteredAt']).toBe('string');

    const conflictCall = (chainable['onConflictDoUpdate'] as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as {
      target: string[];
      set: Record<string, unknown>;
    };
    expect(conflictCall.target).toEqual(['tenantId', 'returnType', 'period']);
    expect(conflictCall.set['manualAdjustments']).toEqual(insertedAdjustments);
  });
});
