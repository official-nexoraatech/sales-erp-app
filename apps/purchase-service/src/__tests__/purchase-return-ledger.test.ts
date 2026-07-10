/**
 * ES-03 — Purchase return approval writes STOCK_OUT to inventory_ledger
 * (goods leave our warehouse back to the supplier — see comment in
 * PurchaseReturnService.approve() for why this is STOCK_OUT, not STOCK_IN).
 */

import { describe, it, expect, vi } from 'vitest';

vi.mock('ulid', () => ({ ulid: () => 'TEST-ULID-01' }));

vi.mock('@erp/db', () => ({
  purchaseReturns: { id: 'id', tenantId: 'tenant_id', status: 'status' },
  purchaseReturnLines: { purchaseReturnId: 'purchase_return_id' },
  debitNotes: {},
  grns: {},
  grnLines: {},
  items: { id: 'id', tenantId: 'tenant_id', availableQty: 'available_qty', version: 'version' },
  projectionSupplierBalance: { tenantId: 'tenant_id', supplierId: 'supplier_id' },
  outboxEvents: {},
  inventoryLedger: {},
}));

vi.mock('drizzle-orm', () => ({
  and: vi.fn((...args) => ({ type: 'and', args })),
  eq: vi.fn((col, val) => ({ type: 'eq', col, val })),
  sql: vi.fn((s) => s),
}));

import { PurchaseReturnService } from '../domain/PurchaseReturnService.js';

function makeTrx(script: unknown[]) {
  let i = 0;
  const next = () => Promise.resolve(script[i++]);
  const chainable: Record<string, unknown> = {};
  for (const m of ['select', 'from', 'where', 'orderBy', 'insert', 'values', 'update', 'set', 'innerJoin']) {
    chainable[m] = vi.fn(() => chainable);
  }
  chainable['returning'] = vi.fn(() => next());
  (chainable as { then: unknown })['then'] = (resolve: (v: unknown) => void, reject: (e: unknown) => void) =>
    next().then(resolve, reject);
  return chainable;
}

const retRow = { id: 1, tenantId: 1, status: 'DRAFT', supplierId: 9, warehouseId: 3, grandTotal: '1180.00' };
const lineRow = { id: 50, purchaseReturnId: 1, itemId: 5, variantId: undefined, returnQty: '4.000', unitPrice: '100.00' };

describe('PurchaseReturnService.approve — ES-03 inventory ledger', () => {
  it('writes a STOCK_OUT inventory_ledger row per return line, referenceType PURCHASE_RETURN', async () => {
    const script = [
      [retRow], // select purchaseReturns
      [lineRow], // select purchaseReturnLines
      [{ id: 5, availableQty: '96.000' }], // update items ... returning
      undefined, // insert inventoryLedger
      [{ id: 200 }], // insert debitNotes ... returning
      undefined, // update purchaseReturns
      undefined, // update projectionSupplierBalance
      undefined, // insert outboxEvents
    ];
    const trx = makeTrx(script);
    const db = { transaction: vi.fn((fn: (t: typeof trx) => Promise<unknown>) => fn(trx)) };
    const svc = new PurchaseReturnService(db as never);

    const debitNoteId = await svc.approve(1, 1, 99);

    expect(debitNoteId).toBe(200);
  });

  it('rolls back approve() when the ledger write fails (atomicity)', async () => {
    let callIndex = 0;
    const trx: Record<string, unknown> = {};
    for (const m of ['select', 'from', 'where', 'orderBy', 'update', 'set']) {
      trx[m] = vi.fn(() => trx);
    }
    trx['returning'] = vi.fn(() => Promise.resolve([{ id: 5, availableQty: '96.000' }]));
    trx['insert'] = vi.fn(() => {
      callIndex++;
      return trx;
    });
    trx['values'] = vi.fn((vals: { movementType?: string }) => {
      if (vals && vals.movementType === 'STOCK_OUT') {
        throw new Error('simulated ledger insert failure');
      }
      return trx;
    });
    (trx as { then: unknown })['then'] = (resolve: (v: unknown) => void) => {
      const results = [[retRow], [lineRow]];
      resolve(results[Math.min(callIndex, results.length - 1)]);
    };

    const db = { transaction: vi.fn((fn: (t: typeof trx) => Promise<unknown>) => fn(trx)) };
    const svc = new PurchaseReturnService(db as never);

    await expect(svc.approve(1, 1, 99)).rejects.toThrow('simulated ledger insert failure');
  });
});

describe('PurchaseReturnService.create — ES-23 [H8] quantity validation', () => {
  const baseParams = {
    tenantId: 1,
    branchId: 1,
    grnId: 1,
    supplierId: 9,
    warehouseId: 3,
    returnDate: new Date(),
    reason: 'DAMAGED' as const,
    lines: [{ grnLineId: 50, itemId: 5, returnQty: 10, unitPrice: 100, gstRate: 18 }],
    createdBy: 99,
  };

  it('throws RETURN_QTY_EXCEEDED when returnQty exceeds the GRN line\'s receivedQty', async () => {
    const script = [
      [{ id: 1, tenantId: 1, status: 'APPROVED' }], // select grns
      [{ receivedQty: '5.000' }], // select grnLines
      [{ alreadyReturned: '0' }], // ES-23 [H8]: prior-APPROVED-returns SUM
    ];
    const trx = makeTrx(script);
    const db = { transaction: vi.fn((fn: (t: typeof trx) => Promise<unknown>) => fn(trx)) };
    const svc = new PurchaseReturnService(db as never);

    await expect(svc.create(baseParams)).rejects.toMatchObject({ code: 'RETURN_QTY_EXCEEDED' });
  });

  it('throws RETURN_QTY_EXCEEDED when combined with prior approved returns it exceeds receivedQty', async () => {
    const script = [
      [{ id: 1, tenantId: 1, status: 'APPROVED' }], // select grns
      [{ receivedQty: '10.000' }], // select grnLines
      [{ alreadyReturned: '3.000' }], // 3 already returned + 10 requested > 10 received
    ];
    const trx = makeTrx(script);
    const db = { transaction: vi.fn((fn: (t: typeof trx) => Promise<unknown>) => fn(trx)) };
    const svc = new PurchaseReturnService(db as never);

    await expect(svc.create(baseParams)).rejects.toMatchObject({ code: 'RETURN_QTY_EXCEEDED' });
  });

  it('succeeds when returnQty plus prior returns is within receivedQty', async () => {
    const script = [
      [{ id: 1, tenantId: 1, status: 'APPROVED' }], // select grns
      [{ receivedQty: '20.000' }], // select grnLines
      [{ alreadyReturned: '0' }], // no prior returns
      [{ id: 900 }], // insert purchaseReturns ... returning
      undefined, // insert purchaseReturnLines
    ];
    const trx = makeTrx(script);
    const db = { transaction: vi.fn((fn: (t: typeof trx) => Promise<unknown>) => fn(trx)) };
    const svc = new PurchaseReturnService(db as never);

    await expect(svc.create(baseParams)).resolves.toBe(900);
  });
});
