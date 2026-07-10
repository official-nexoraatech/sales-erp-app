/**
 * PG-046 — Reorder Auto-PO real GST rate lookup. Prior to this fix, every
 * auto-created reorder PO hardcoded 18% CGST+SGST on every line regardless of
 * the item's real GST rate or whether the purchase was interstate.
 */

import { describe, it, expect, vi } from 'vitest';

vi.mock('ulid', () => ({ ulid: () => 'TEST-ULID-01' }));

vi.mock('@erp/db', () => ({
  items: { id: 'id', tenantId: 'tenant_id' },
  suppliers: { id: 'id', tenantId: 'tenant_id' },
  purchaseOrders: { id: 'id' },
  purchaseOrderLines: {},
  projectionStockLevel: {},
  outboxEvents: {},
}));

vi.mock('drizzle-orm', () => ({
  and: vi.fn((...args) => ({ type: 'and', args })),
  eq: vi.fn((col, val) => ({ type: 'eq', col, val })),
  lte: vi.fn((col, val) => ({ type: 'lte', col, val })),
  inArray: vi.fn((col, val) => ({ type: 'inArray', col, val })),
  sql: vi.fn((s) => s),
}));

import { ReorderService } from '../domain/ReorderService.js';

function makeChain(script: unknown[]) {
  let i = 0;
  const next = () => Promise.resolve(script[i++]);
  const chainable: Record<string, unknown> = {};
  for (const m of ['select', 'from', 'where', 'insert', 'values', 'update', 'set']) {
    chainable[m] = vi.fn(() => chainable);
  }
  chainable['returning'] = vi.fn(() => next());
  (chainable as { then: unknown })['then'] = (resolve: (v: unknown) => void, reject: (e: unknown) => void) =>
    next().then(resolve, reject);
  return chainable;
}

function makeDb(script: unknown[]) {
  const chain = makeChain(script);
  return { ...chain, transaction: vi.fn((fn: (t: typeof chain) => Promise<unknown>) => fn(chain)), chain };
}

describe('ReorderService.createPOsFromReorder — real GST rate lookup', () => {
  it('a 12% GST item bought intrastate splits CGST/SGST 6/6, not the old flat 9/9', async () => {
    const script = [
      [{ id: 1, gstRate: '12', hsnCode: '61091000', cessRate: '0' }], // items lookup
      [{ id: 9, billingAddress: { stateCode: 'MH' } }],               // suppliers lookup
      [{ id: 501 }],                                                  // insert purchaseOrders .returning()
      undefined,                                                      // insert purchaseOrderLines
      undefined,                                                      // insert outboxEvents
    ];
    const db = makeDb(script);
    const svc = new ReorderService(db as never);

    const poIds = await svc.createPOsFromReorder({
      tenantId: 1,
      branchId: 1,
      warehouseId: 1,
      placeOfSupply: 'MH',
      items: [{ itemId: 1, supplierId: 9, quantity: 10, unitPrice: 100 }],
      createdBy: 1,
    });

    expect(poIds).toEqual([501]);
    const lineValues = (db.chain.values as unknown as { mock: { calls: unknown[][] } }).mock.calls[1]?.[0] as Record<
      string,
      unknown
    >;
    expect(lineValues.gstRate).toBe('12');
    expect(lineValues.cgstRate).toBe('6');
    expect(lineValues.sgstRate).toBe('6');
    expect(lineValues.igstRate).toBe('0');
    expect(lineValues.cgstAmount).toBe('60');
    expect(lineValues.sgstAmount).toBe('60');
    expect(lineValues.lineTotal).toBe('1120');
    expect(lineValues.hsnCode).toBe('61091000');
  });

  it('an interstate reorder (supplier state differs from placeOfSupply) charges 100% IGST, zero CGST/SGST', async () => {
    const script = [
      [{ id: 1, gstRate: '12', hsnCode: '61091000', cessRate: '0' }],
      [{ id: 9, billingAddress: { stateCode: 'GJ' } }], // supplier in Gujarat
      [{ id: 502 }],
      undefined,
      undefined,
    ];
    const db = makeDb(script);
    const svc = new ReorderService(db as never);

    await svc.createPOsFromReorder({
      tenantId: 1,
      branchId: 1,
      warehouseId: 1,
      placeOfSupply: 'MH', // buyer in Maharashtra
      items: [{ itemId: 1, supplierId: 9, quantity: 10, unitPrice: 100 }],
      createdBy: 1,
    });

    const lineValues = (db.chain.values as unknown as { mock: { calls: unknown[][] } }).mock.calls[1]?.[0] as Record<
      string,
      unknown
    >;
    expect(lineValues.cgstAmount).toBe('0');
    expect(lineValues.sgstAmount).toBe('0');
    expect(lineValues.igstRate).toBe('12');
    expect(lineValues.igstAmount).toBe('120');

    const poValues = (db.chain.values as unknown as { mock: { calls: unknown[][] } }).mock.calls[0]?.[0] as Record<
      string,
      unknown
    >;
    expect(poValues.sellerStateCode).toBe('GJ');
    expect(poValues.grandTotal).toBe('1120');
  });

  it('a non-zero cess rate is carried through into the line total', async () => {
    const script = [
      [{ id: 1, gstRate: '28', hsnCode: '87120010', cessRate: '5' }],
      [{ id: 9, billingAddress: { stateCode: 'MH' } }],
      [{ id: 503 }],
      undefined,
      undefined,
    ];
    const db = makeDb(script);
    const svc = new ReorderService(db as never);

    await svc.createPOsFromReorder({
      tenantId: 1,
      branchId: 1,
      warehouseId: 1,
      placeOfSupply: 'MH',
      items: [{ itemId: 1, supplierId: 9, quantity: 10, unitPrice: 100 }],
      createdBy: 1,
    });

    // taxable 1000; CGST/SGST 14% each = 140+140; cess 5% = 50 -> lineTotal 1330.
    const lineValues = (db.chain.values as unknown as { mock: { calls: unknown[][] } }).mock.calls[1]?.[0] as Record<
      string,
      unknown
    >;
    expect(lineValues.lineTotal).toBe('1330');
  });

  it('regression: an 18%-GST intrastate item still produces cgstRate 9 / sgstRate 9 / igstRate 0', async () => {
    const script = [
      [{ id: 1, gstRate: '18', hsnCode: '52081100', cessRate: '0' }],
      [{ id: 9, billingAddress: { stateCode: 'MH' } }],
      [{ id: 504 }],
      undefined,
      undefined,
    ];
    const db = makeDb(script);
    const svc = new ReorderService(db as never);

    await svc.createPOsFromReorder({
      tenantId: 1,
      branchId: 1,
      warehouseId: 1,
      placeOfSupply: 'MH',
      items: [{ itemId: 1, supplierId: 9, quantity: 10, unitPrice: 100 }],
      createdBy: 1,
    });

    const lineValues = (db.chain.values as unknown as { mock: { calls: unknown[][] } }).mock.calls[1]?.[0] as Record<
      string,
      unknown
    >;
    expect(lineValues.cgstRate).toBe('9');
    expect(lineValues.sgstRate).toBe('9');
    expect(lineValues.igstRate).toBe('0');
    expect(lineValues.lineTotal).toBe('1180');
  });

  it('falls back to placeOfSupply (assumes intrastate) when the supplier master has no state on file', async () => {
    const script = [
      [{ id: 1, gstRate: '18', hsnCode: '52081100', cessRate: '0' }],
      [{ id: 9, billingAddress: null }], // no state on file
      [{ id: 505 }],
      undefined,
      undefined,
    ];
    const db = makeDb(script);
    const svc = new ReorderService(db as never);

    await svc.createPOsFromReorder({
      tenantId: 1,
      branchId: 1,
      warehouseId: 1,
      placeOfSupply: 'MH',
      items: [{ itemId: 1, supplierId: 9, quantity: 10, unitPrice: 100 }],
      createdBy: 1,
    });

    const poValues = (db.chain.values as unknown as { mock: { calls: unknown[][] } }).mock.calls[0]?.[0] as Record<
      string,
      unknown
    >;
    expect(poValues.sellerStateCode).toBe('MH');
    const lineValues = (db.chain.values as unknown as { mock: { calls: unknown[][] } }).mock.calls[1]?.[0] as Record<
      string,
      unknown
    >;
    expect(lineValues.cgstRate).toBe('9');
    expect(lineValues.igstRate).toBe('0');
  });
});
