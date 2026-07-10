/**
 * ES-11 — e-Way Bill (EWB) generation
 * Test 8: invoice total < ₹50,000 → EWB generation throws (threshold not met)
 * Test 9: invoice total > ₹50,000 → EWB number stored on the einvoice_data record
 *
 * Note: the pre-existing error code for test 8 is 'EWB_THRESHOLD_NOT_MET' (this
 * codebase's actual implementation), not the prompt's 'EWB_NOT_REQUIRED' — same
 * behavior, different code name; asserted against the real implementation.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { BusinessError } from '@erp/types';

type Cond = { type: 'and'; args: Cond[] } | { type: 'eq'; col: string; val: unknown };

vi.mock('drizzle-orm', () => ({
  and: (...args: Cond[]) => ({ type: 'and', args }),
  eq: (col: string, val: unknown) => ({ type: 'eq', col, val }),
  lte: () => ({ type: 'eq', col: '__unused__', val: undefined }),
}));

vi.mock('@erp/db', () => ({
  einvoiceData: {
    id: 'id',
    tenantId: 'tenantId',
    invoiceId: 'invoiceId',
  },
}));

function evalCond(cond: Cond, row: Record<string, unknown>): boolean {
  if (cond.type === 'and') return cond.args.every((c) => evalCond(c, row));
  if (cond.type === 'eq') return row[cond.col] === cond.val;
  return true;
}

function makeFakeDb(seed: Record<string, unknown>[]) {
  const rows = [...seed];
  const db = {
    raw: {
      select: () => ({
        from: () => ({
          where: (cond: Cond) => Promise.resolve(rows.filter((r) => evalCond(cond, r))),
        }),
      }),
      update: () => ({
        set: (patch: Record<string, unknown>) => ({
          where: (cond: Cond) => {
            rows.forEach((r, i) => {
              if (evalCond(cond, r)) rows[i] = { ...r, ...patch };
            });
            return Promise.resolve();
          },
        }),
      }),
    },
    rows,
    // ES-28 [M16-b]: EwayBillService.generate now writes its outbox event in the
    // same transaction as the state-transition update — the fake needs both.
    transaction: (fn: (trx: typeof db) => Promise<unknown>) => fn(db),
    insertIntoOutbox: () => Promise.resolve(),
  };
  return db;
}

function basePayload(totalValue: number) {
  return {
    supplyType: 'O' as const,
    subSupplyType: '1',
    docType: 'INV' as const,
    docNo: 'INV-2026-001',
    docDate: '01/07/2026',
    fromGstin: '27AAAAA0000A1Z5',
    fromTrdName: 'Acme Textiles',
    fromAddr1: 'Plot 12',
    fromPlace: 'Mumbai',
    fromPincode: 400001,
    fromStateCode: 27,
    toGstin: '27BBBBB0000B1Z6',
    toTrdName: 'Buyer Co',
    toAddr1: '45 MG Road',
    toPlace: 'Mumbai',
    toPincode: 400002,
    toStateCode: 27,
    totalValue,
    cgstValue: 0,
    sgstValue: 0,
    igstValue: 0,
    cessValue: 0,
    transMode: '1' as const,
    itemList: [
      {
        productName: 'Cotton Shirt',
        hsnCode: '6205',
        quantity: 10,
        qtyUnit: 'PCS',
        cgstRate: 9,
        sgstRate: 9,
        igstRate: 0,
        taxableAmount: totalValue,
      },
    ],
  };
}

describe('EwayBillService.generate', () => {
  beforeEach(() => {
    process.env['NIC_API_KEY'] = 'test-key';
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('8. invoice total ≤ ₹50,000 → EWB generation throws EWB_THRESHOLD_NOT_MET', async () => {
    const { EwayBillService } = await import('../domain/EwayBillService.js');
    const db = makeFakeDb([]);

    await expect(
      EwayBillService.generate(db as never, 1, 42, 101, basePayload(50000))
    ).rejects.toMatchObject({ code: 'EWB_THRESHOLD_NOT_MET' } as Partial<BusinessError>);
  });

  it('9. invoice total > ₹50,000 → EWB number stored on the invoice record', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        response: { ewayBillNo: 'EWB123456789012', ewayBillDate: '01/07/2026', validUpto: '03/07/2026' },
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const { EwayBillService } = await import('../domain/EwayBillService.js');
    const db = makeFakeDb([{ id: 1, tenantId: 1, invoiceId: 101 }]);

    const result = await EwayBillService.generate(db as never, 1, 42, 101, basePayload(75000));

    expect(result.ewbNumber).toBe('EWB123456789012');
    expect(db.rows[0]['ewbNumber']).toBe('EWB123456789012');
  });
});
