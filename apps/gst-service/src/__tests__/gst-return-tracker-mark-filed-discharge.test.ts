/**
 * PG-040 — GstReturnTrackerService.markFiled() persists real GSTR-3B discharge data
 * (Gstr3bService.deriveDischargeData output) into gst_return_filings.filingData the
 * moment a filing transitions to FILED/LATE_FILED — see Gstr3bService for the source
 * computation and GSTR9Engine for how GSTR-9 Table 9 later sums these per-period figures.
 */

import { describe, it, expect, vi } from 'vitest';

vi.mock('@erp/db', () => ({
  gstReturnFilings: {
    id: 'id',
    tenantId: 'tenantId',
    returnType: 'returnType',
    period: 'period',
    dueDate: 'dueDate',
    status: 'status',
    filingData: 'filingData',
  },
}));

vi.mock('drizzle-orm', () => ({
  and: (...args: unknown[]) => ({ type: 'and', args }),
  eq: (col: string, val: unknown) => ({ type: 'eq', col, val }),
}));

function makeChainableDb(finalResult: unknown) {
  const chainable: Record<string, unknown> = {};
  for (const m of ['select', 'from', 'where', 'update', 'set']) {
    chainable[m] = vi.fn(() => chainable);
  }
  (chainable as { then: unknown })['then'] = (resolve: (v: unknown) => void) =>
    Promise.resolve(finalResult).then(resolve);
  return { raw: chainable, chainable };
}

describe('GstReturnTrackerService.markFiled — discharge data persistence (PG-040)', () => {
  it('marking a GSTR3B period filed with dischargeData populates filingData', async () => {
    const { GstReturnTrackerService } = await import('../domain/GstReturnTrackerService.js');
    const { raw, chainable } = makeChainableDb([{ dueDate: '2099-01-20' }]);

    const dischargeData = {
      cashRequired: { igst: 100, cgst: 50, sgst: 50 },
      itcUtilized: { igst: 10, cgst: 5, sgst: 5 },
    };

    await GstReturnTrackerService.markFiled({ raw } as never, 1, 7, 'GSTR3B', '2025-06', undefined, dischargeData);

    const setCall = (chainable['set'] as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as Record<string, unknown>;
    expect(setCall['filingData']).toMatchObject(dischargeData);
    expect(typeof (setCall['filingData'] as Record<string, unknown>)['filedAt']).toBe('string');
  });

  it('marking a GSTR1 period filed (no dischargeData concept) leaves filingData untouched', async () => {
    const { GstReturnTrackerService } = await import('../domain/GstReturnTrackerService.js');
    const { raw, chainable } = makeChainableDb([{ dueDate: '2099-01-11' }]);

    await GstReturnTrackerService.markFiled({ raw } as never, 1, 7, 'GSTR1', '2025-06');

    const setCall = (chainable['set'] as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as Record<string, unknown>;
    expect(setCall['filingData']).toBeUndefined();
  });

  it('marking a GSTR3B period filed without dischargeData leaves filingData untouched', async () => {
    const { GstReturnTrackerService } = await import('../domain/GstReturnTrackerService.js');
    const { raw, chainable } = makeChainableDb([{ dueDate: '2099-01-20' }]);

    await GstReturnTrackerService.markFiled({ raw } as never, 1, 7, 'GSTR3B', '2025-06');

    const setCall = (chainable['set'] as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as Record<string, unknown>;
    expect(setCall['filingData']).toBeUndefined();
  });
});
