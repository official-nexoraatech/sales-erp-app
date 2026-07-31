/**
 * Purchase audit 2026-07-21 gap-closure — RFQ / Supplier Quotation. Covers grandTotal
 * computation and the status guards (can't quote a CLOSED/CANCELLED RFQ, can't re-select an
 * already-SELECTED quotation), mirroring the mock-db pattern used by purchase-workflow.test.ts.
 */

import { describe, it, expect, vi } from 'vitest';
import { BusinessError, NotFoundError } from '@erp/types';

vi.mock('@erp/db', () => ({
  rfqs: { id: 'id', tenantId: 'tenant_id', status: 'status', branchId: 'branch_id' },
  rfqLines: { rfqId: 'rfq_id', itemId: 'item_id' },
  rfqSuppliers: { rfqId: 'rfq_id', supplierId: 'supplier_id' },
  supplierQuotations: { id: 'id', tenantId: 'tenant_id', status: 'status', rfqId: 'rfq_id' },
  supplierQuotationLines: { quotationId: 'quotation_id' },
  items: { id: 'id', name: 'name' },
  suppliers: { id: 'id', displayName: 'display_name' },
  purchaseOrders: {},
  purchaseOrderLines: {},
  purchaseOrderHistory: {},
  purchaseOrderAmendments: {},
  projectionSupplierBalance: {},
  outboxEvents: {},
  organizationSettings: {},
}));

vi.mock('drizzle-orm', () => ({
  and: vi.fn((...args) => ({ type: 'and', args })),
  eq: vi.fn((col, val) => ({ type: 'eq', col, val })),
  inArray: vi.fn((col, val) => ({ type: 'inArray', col, val })),
  desc: vi.fn((col) => ({ type: 'desc', col })),
  getTableColumns: vi.fn(() => ({})),
}));

import { RfqService } from '../domain/RfqService.js';

function makeDb(script: unknown[]) {
  let i = 0;
  const next = () => Promise.resolve(script[i++]);
  const chainable: Record<string, unknown> = {};
  for (const m of [
    'select',
    'from',
    'where',
    'orderBy',
    'insert',
    'values',
    'update',
    'set',
    'leftJoin',
  ]) {
    chainable[m] = vi.fn(() => chainable);
  }
  chainable['returning'] = vi.fn(() => next());
  (chainable as { then: unknown })['then'] = (
    resolve: (v: unknown) => void,
    reject: (e: unknown) => void
  ) => next().then(resolve, reject);
  chainable['transaction'] = vi.fn((fn: (t: typeof chainable) => Promise<unknown>) =>
    fn(chainable)
  );
  return chainable;
}

describe('RfqService.recordQuotation', () => {
  it('computes grandTotal as sum(qty * unitPrice) across lines', async () => {
    const db = makeDb([
      [{ id: 1, tenantId: 1, status: 'SENT' }],
      [{ id: 77 }],
      undefined,
      undefined,
    ]);
    const svc = new RfqService(db as never);

    const id = await svc.recordQuotation({
      tenantId: 1,
      rfqId: 1,
      supplierId: 5,
      lines: [
        { rfqLineId: 1, itemId: 1, qty: 10, unitPrice: 20 },
        { rfqLineId: 2, itemId: 2, qty: 3, unitPrice: 15 },
      ],
      createdBy: 9,
    });

    expect(id).toBe(77);
    const insertedValues = (db.values as ReturnType<typeof vi.fn>).mock.calls[0]![0] as {
      grandTotal: string;
    };
    expect(insertedValues.grandTotal).toBe(String(10 * 20 + 3 * 15));
  });

  it('rejects recording a quotation against a CLOSED RFQ', async () => {
    const db = makeDb([[{ id: 1, tenantId: 1, status: 'CLOSED' }]]);
    const svc = new RfqService(db as never);

    await expect(
      svc.recordQuotation({
        tenantId: 1,
        rfqId: 1,
        supplierId: 5,
        lines: [{ rfqLineId: 1, itemId: 1, qty: 1, unitPrice: 1 }],
        createdBy: 9,
      })
    ).rejects.toMatchObject({ code: 'INVALID_STATUS' });
  });

  it('rejects recording a quotation against a CANCELLED RFQ', async () => {
    const db = makeDb([[{ id: 1, tenantId: 1, status: 'CANCELLED' }]]);
    const svc = new RfqService(db as never);

    await expect(
      svc.recordQuotation({
        tenantId: 1,
        rfqId: 1,
        supplierId: 5,
        lines: [{ rfqLineId: 1, itemId: 1, qty: 1, unitPrice: 1 }],
        createdBy: 9,
      })
    ).rejects.toBeInstanceOf(BusinessError);
  });

  it('throws NotFoundError for a non-existent RFQ', async () => {
    const db = makeDb([[]]);
    const svc = new RfqService(db as never);

    await expect(
      svc.recordQuotation({
        tenantId: 1,
        rfqId: 999,
        supplierId: 5,
        lines: [{ rfqLineId: 1, itemId: 1, qty: 1, unitPrice: 1 }],
        createdBy: 9,
      })
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('RfqService.selectQuotation', () => {
  it('rejects re-selecting an already-SELECTED quotation', async () => {
    const db = makeDb([[{ id: 1, tenantId: 1, rfqId: 1, supplierId: 5, status: 'SELECTED' }]]);
    const svc = new RfqService(db as never);

    await expect(
      svc.selectQuotation(1, 1, 9, {
        branchId: 1,
        warehouseId: 1,
        poDate: new Date(),
        placeOfSupply: '27',
      })
    ).rejects.toMatchObject({ code: 'ALREADY_SELECTED' });
  });

  it('rejects selecting a quotation with no lines', async () => {
    const db = makeDb([[{ id: 1, tenantId: 1, rfqId: 1, supplierId: 5, status: 'SUBMITTED' }], []]);
    const svc = new RfqService(db as never);

    await expect(
      svc.selectQuotation(1, 1, 9, {
        branchId: 1,
        warehouseId: 1,
        poDate: new Date(),
        placeOfSupply: '27',
      })
    ).rejects.toMatchObject({ code: 'QUOTATION_EMPTY' });
  });
});
