/**
 * ES-10 — RCM (Reverse Charge Mechanism) detection on GRN creation.
 * Test 4 of the ES-10 GST test suite (the other 6 live in
 * apps/gst-service/src/__tests__/gst-engine.test.ts — see completion report).
 */

import { describe, it, expect, vi } from 'vitest';

vi.mock('ulid', () => ({ ulid: () => 'TEST-ULID-01' }));

vi.mock('@erp/db', () => ({
  grns: { id: 'id' },
  grnLines: {},
  grnHistory: {},
  purchaseOrders: { id: 'id', tenantId: 'tenant_id' },
  purchaseOrderLines: { id: 'id', purchaseOrderId: 'purchase_order_id' },
  items: {},
  suppliers: { id: 'id', tenantId: 'tenant_id' },
  outboxEvents: {},
  projectionSupplierBalance: {},
  inventoryLedger: {},
}));

vi.mock('drizzle-orm', () => ({
  and: vi.fn((...args) => ({ type: 'and', args })),
  eq: vi.fn((col, val) => ({ type: 'eq', col, val })),
  sql: vi.fn((s) => s),
}));

import { GRNService } from '../domain/GRNService.js';

function makeTrx(script: unknown[]) {
  let i = 0;
  const next = () => Promise.resolve(script[i++]);
  const chainable: Record<string, unknown> = {};
  for (const m of ['select', 'from', 'where', 'orderBy', 'insert', 'values', 'update', 'set', 'for']) {
    chainable[m] = vi.fn(() => chainable);
  }
  chainable['returning'] = vi.fn(() => next());
  (chainable as { then: unknown })['then'] = (resolve: (v: unknown) => void, reject: (e: unknown) => void) =>
    next().then(resolve, reject);
  return chainable;
}

describe('GRNService.create — RCM detection', () => {
  it('4. unregistered supplier → rcmApplicable = true, grandTotal excludes GST', async () => {
    const poRow = { id: 1, tenantId: 1, status: 'APPROVED', sellerStateCode: 'MH', placeOfSupply: 'MH' };
    const supplierRow = { isRegistered: false };
    const poLineRow = { id: 10, purchaseOrderId: 1, orderedQty: '10', receivedQty: '0', unitPrice: '100' };

    const script = [
      [poRow],       // select purchaseOrders
      [supplierRow], // select suppliers
      [poLineRow],   // select purchaseOrderLines
      [{ id: 501 }], // insert grns .returning()
      undefined,     // insert grnLines
      undefined,     // insert grnHistory
    ];
    const trx = makeTrx(script);
    const db = { transaction: vi.fn((fn: (t: typeof trx) => Promise<unknown>) => fn(trx)) };
    const svc = new GRNService(db as never);

    const grnId = await svc.create({
      tenantId: 1,
      branchId: 1,
      warehouseId: 1,
      purchaseOrderId: 1,
      supplierId: 9,
      grnDate: new Date('2025-06-15'),
      lines: [
        { purchaseOrderLineId: 10, itemId: 5, receivedQty: 10, grnRate: 100, gstRate: 18 },
      ],
      createdBy: 1,
    });

    expect(grnId).toBe(501);

    const insertedGrn = (trx.values as unknown as { mock: { calls: unknown[][] } }).mock.calls[0]?.[0] as Record<string, unknown>;
    expect(insertedGrn.rcmApplicable).toBe(true);
    // taxable = 100 * 10 = 1000; CGST/SGST would be 90 each but must NOT be
    // charged to an unregistered supplier — grandTotal is taxable-only.
    expect(insertedGrn.taxableAmount).toBe('1000');
    expect(insertedGrn.cgstAmount).toBe('90');
    expect(insertedGrn.sgstAmount).toBe('90');
    expect(insertedGrn.grandTotal).toBe('1000');
  });
});
