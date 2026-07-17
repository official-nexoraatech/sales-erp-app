/**
 * ES-09 — Purchase Workflow & GRNI Completeness
 * Covers the gaps found not already implemented: PO approval re-entry guard,
 * GRN over-receipt validation, vendor credit limit enforcement + override,
 * PO amendment, partial-receive PO status transition, and supplier payment
 * allocation status transitions.
 */

import { describe, it, expect, vi } from 'vitest';
import { BusinessError, VendorCreditLimitExceededError } from '@erp/types';

vi.mock('ulid', () => ({ ulid: () => 'TEST-ULID-01' }));

vi.mock('@erp/db', () => ({
  purchaseOrders: { id: 'id', tenantId: 'tenant_id', status: 'status', supplierId: 'supplier_id' },
  purchaseOrderLines: { id: 'id', purchaseOrderId: 'purchase_order_id' },
  purchaseOrderHistory: {},
  purchaseOrderAmendments: {},
  suppliers: { id: 'id', tenantId: 'tenant_id' },
  projectionSupplierBalance: { tenantId: 'tenant_id', supplierId: 'supplier_id' },
  outboxEvents: {},
  grns: { id: 'id', tenantId: 'tenant_id' },
  grnLines: { grnId: 'grn_id' },
  grnHistory: {},
  items: { id: 'id', tenantId: 'tenant_id', availableQty: 'available_qty', version: 'version' },
  inventoryLedger: {},
  projectionStockLevel: {
    tenantId: 'tenant_id',
    itemId: 'item_id',
    warehouseId: 'warehouse_id',
    variantId: 'variant_id',
  },
  supplierPayments: { id: 'id', tenantId: 'tenant_id' },
  supplierPaymentAllocations: {},
}));

vi.mock('drizzle-orm', () => ({
  and: vi.fn((...args) => ({ type: 'and', args })),
  eq: vi.fn((col, val) => ({ type: 'eq', col, val })),
  sql: vi.fn((s) => s),
  desc: vi.fn((col) => ({ type: 'desc', col })),
  lt: vi.fn((col, val) => ({ type: 'lt', col, val })),
}));

import { PurchaseOrderService } from '../domain/PurchaseOrderService.js';
import { GRNService } from '../domain/GRNService.js';
import { SupplierPaymentService } from '../domain/SupplierPaymentService.js';

function makeTrx(script: unknown[]) {
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
    'onConflictDoUpdate',
    'for',
  ]) {
    chainable[m] = vi.fn(() => chainable);
  }
  chainable['returning'] = vi.fn(() => next());
  (chainable as { then: unknown })['then'] = (
    resolve: (v: unknown) => void,
    reject: (e: unknown) => void
  ) => next().then(resolve, reject);
  return chainable;
}

describe('PurchaseOrderService.approve — re-entry guard', () => {
  it('approves a SUBMITTED PO', async () => {
    const poRow = {
      id: 1,
      tenantId: 1,
      status: 'SUBMITTED',
      supplierId: 9,
      grandTotal: '10000.00',
    };
    const supplierRow = { creditLimit: '0', creditLimitEnabled: false };
    const script = [[poRow], [supplierRow], undefined, undefined, undefined];
    const trx = makeTrx(script);
    const db = { transaction: vi.fn((fn: (t: typeof trx) => Promise<unknown>) => fn(trx)) };
    const svc = new PurchaseOrderService(db as never);

    await expect(svc.approve(1, 1, 99, 'PO-0001')).resolves.toBeUndefined();
  });

  it('rejects approving a PO that is already APPROVED', async () => {
    const poRow = { id: 1, tenantId: 1, status: 'APPROVED', supplierId: 9, grandTotal: '10000.00' };
    const trx = makeTrx([[poRow]]);
    const db = { transaction: vi.fn((fn: (t: typeof trx) => Promise<unknown>) => fn(trx)) };
    const svc = new PurchaseOrderService(db as never);

    await expect(svc.approve(1, 1, 99, 'PO-0001')).rejects.toMatchObject({
      code: 'INVALID_STATUS',
    });
  });
});

describe('PurchaseOrderService.approve — vendor credit limit', () => {
  it('throws VENDOR_CREDIT_LIMIT_EXCEEDED when new balance would exceed the limit', async () => {
    const poRow = {
      id: 1,
      tenantId: 1,
      status: 'SUBMITTED',
      supplierId: 9,
      grandTotal: '50000.00',
    };
    const supplierRow = { creditLimit: '100000.00', creditLimitEnabled: true };
    const balanceRow = { currentBalance: '60000.00' };
    const trx = makeTrx([[poRow], [supplierRow], [balanceRow]]);
    const db = { transaction: vi.fn((fn: (t: typeof trx) => Promise<unknown>) => fn(trx)) };
    const svc = new PurchaseOrderService(db as never);

    await expect(svc.approve(1, 1, 99, 'PO-0001')).rejects.toThrow(VendorCreditLimitExceededError);
  });

  it('succeeds when overrideCreditLimit=true, bypassing the check entirely', async () => {
    const poRow = {
      id: 1,
      tenantId: 1,
      status: 'SUBMITTED',
      supplierId: 9,
      grandTotal: '999999.00',
    };
    const script = [[poRow], undefined, undefined, undefined];
    const trx = makeTrx(script);
    const db = { transaction: vi.fn((fn: (t: typeof trx) => Promise<unknown>) => fn(trx)) };
    const svc = new PurchaseOrderService(db as never);

    await expect(svc.approve(1, 1, 99, 'PO-0001', true)).resolves.toBeUndefined();
  });
});

describe('PurchaseOrderService.amend', () => {
  it('creates an amendment record on an APPROVED PO', async () => {
    const poRow = { id: 1, tenantId: 1, status: 'APPROVED', supplierId: 9 };
    const script = [[poRow], undefined, undefined, undefined, undefined];
    const trx = makeTrx(script);
    const db = { transaction: vi.fn((fn: (t: typeof trx) => Promise<unknown>) => fn(trx)) };
    const svc = new PurchaseOrderService(db as never);

    await expect(
      svc.amend(1, 1, 99, { expectedDeliveryDate: '2026-08-01' }, 'Supplier requested delay')
    ).resolves.toBeUndefined();
  });

  it('rejects amending a PO that is not APPROVED', async () => {
    const poRow = { id: 1, tenantId: 1, status: 'DRAFT', supplierId: 9 };
    const trx = makeTrx([[poRow]]);
    const db = { transaction: vi.fn((fn: (t: typeof trx) => Promise<unknown>) => fn(trx)) };
    const svc = new PurchaseOrderService(db as never);

    await expect(svc.amend(1, 1, 99, {}, 'reason')).rejects.toMatchObject({
      code: 'INVALID_STATUS',
    });
  });
});

describe('GRNService.create — over-receipt guard', () => {
  it('throws PURCHASE_QTY_MISMATCH when received qty exceeds remaining PO qty', async () => {
    const poRow = {
      id: 1,
      tenantId: 1,
      status: 'APPROVED',
      sellerStateCode: 'MH',
      placeOfSupply: 'MH',
    };
    const supplierRow = { isRegistered: true };
    const poLineRow = {
      id: 5,
      purchaseOrderId: 1,
      orderedQty: '10.000',
      receivedQty: '8.000',
      unitPrice: '100.00',
    };
    const trx = makeTrx([[poRow], [supplierRow], [poLineRow]]);
    const db = { transaction: vi.fn((fn: (t: typeof trx) => Promise<unknown>) => fn(trx)) };
    const svc = new GRNService(db as never);

    await expect(
      svc.create({
        tenantId: 1,
        branchId: 1,
        warehouseId: 1,
        purchaseOrderId: 1,
        supplierId: 9,
        grnDate: new Date(),
        lines: [
          {
            purchaseOrderLineId: 5,
            itemId: 5,
            receivedQty: 5,
            grnRate: 100,
            gstRate: 18,
          },
        ],
        createdBy: 99,
      })
    ).rejects.toMatchObject({ code: 'PURCHASE_QTY_MISMATCH' });
  });
});

describe('GRNService.approve — partial receive updates PO status', () => {
  it('sets PO status to PARTIALLY_RECEIVED when some lines remain outstanding', async () => {
    const grnRow = {
      id: 1,
      tenantId: 1,
      status: 'DRAFT',
      purchaseOrderId: 1,
      supplierId: 9,
      warehouseId: 3,
      grandTotal: '5000.00',
    };
    const lineRow = {
      id: 50,
      grnId: 1,
      purchaseOrderLineId: 5,
      itemId: 7,
      variantId: undefined,
      receivedQty: '5.000',
      warehouseId: undefined,
      grnRate: '100.00',
    };
    const poRow = { id: 1, tenantId: 1, purchaseOrderId: 1, grandTotal: '5000.00' };
    const allPoLines = [
      { id: 5, orderedQty: '10.000', receivedQty: '10.000' }, // fully received
      { id: 6, orderedQty: '20.000', receivedQty: '5.000' }, // still outstanding
    ];
    const script = [
      [grnRow], // select grns
      [lineRow], // select grnLines
      [{ id: 7, availableQty: '48.000' }], // update items ... returning
      [{ id: 1 }], // insert inventoryLedger ... returning
      [{ costingMethod: 'WACC', currentStockValue: '0' }], // ES-13: ValuationService item lookup
      undefined, // ES-13: ValuationService update items.current_stock_value
      undefined, // insert projectionStockLevel onConflictDoUpdate
      [{ id: 5 }], // update purchaseOrderLines ... returning (ES-23 [M1] ceiling-guarded increment)
      [poRow], // select purchaseOrders
      allPoLines, // select purchaseOrderLines (allPOLines)
      undefined, // update purchaseOrders
      undefined, // update grns
      undefined, // insert projectionSupplierBalance onConflictDoUpdate
      [{ displayName: 'Test Supplier', gstin: '27AAAAA0000A1Z5' }], // select suppliers
      undefined, // insert outboxEvents (GRN_APPROVED)
      undefined, // insert grnHistory
    ];
    const trx = makeTrx(script);
    const db = { transaction: vi.fn((fn: (t: typeof trx) => Promise<unknown>) => fn(trx)) };
    const svc = new GRNService(db as never);

    await svc.approve(1, 1, 99, 'GRN-0001');

    const setCalls = (trx['set'] as { mock: { calls: unknown[][] } }).mock.calls;
    const poStatusUpdate = setCalls.find(
      (args) => (args[0] as { status?: string }).status === 'PARTIALLY_RECEIVED'
    );
    expect(poStatusUpdate).toBeDefined();
  });
});

describe('GRNService.approve — ES-23 [M1] over-receipt ceiling guard', () => {
  it('throws PURCHASE_QTY_MISMATCH when the guarded increment finds the ceiling already exceeded (e.g. a concurrently-approved sibling GRN)', async () => {
    const grnRow = {
      id: 1,
      tenantId: 1,
      status: 'DRAFT',
      purchaseOrderId: 1,
      supplierId: 9,
      warehouseId: 3,
      grandTotal: '5000.00',
    };
    const lineRow = {
      id: 50,
      grnId: 1,
      purchaseOrderLineId: 5,
      itemId: 7,
      variantId: undefined,
      receivedQty: '5.000',
      warehouseId: undefined,
      grnRate: '100.00',
    };
    const script = [
      [grnRow], // select grns
      [lineRow], // select grnLines
      [{ id: 7, availableQty: '48.000' }], // update items ... returning
      [{ id: 1 }], // insert inventoryLedger ... returning
      [{ costingMethod: 'WACC', currentStockValue: '0' }], // ES-13: ValuationService item lookup
      undefined, // ES-13: ValuationService update items.current_stock_value
      undefined, // insert projectionStockLevel onConflictDoUpdate
      [], // update purchaseOrderLines ... returning → empty = ceiling guard failed (over-receipt)
    ];
    const trx = makeTrx(script);
    const db = { transaction: vi.fn((fn: (t: typeof trx) => Promise<unknown>) => fn(trx)) };
    const svc = new GRNService(db as never);

    await expect(svc.approve(1, 1, 99, 'GRN-0001')).rejects.toMatchObject({
      code: 'PURCHASE_QTY_MISMATCH',
    });
  });
});

describe('SupplierPaymentService.allocate — status transitions', () => {
  it('marks payment FULLY_ALLOCATED when the full unallocated amount is used', async () => {
    const paymentRow = { id: 1, tenantId: 1, allocatedAmount: '0', unallocatedAmount: '5000.00' };
    const grnRow = { id: 10, tenantId: 1, status: 'APPROVED' };
    const trx = makeTrx([[paymentRow], [grnRow], undefined, undefined]);
    const db = { transaction: vi.fn((fn: (t: typeof trx) => Promise<unknown>) => fn(trx)) };
    const svc = new SupplierPaymentService(db as never);

    await svc.allocate(1, 1, [{ grnId: 10, amount: 5000 }], 99);

    const setCalls = (trx['set'] as { mock: { calls: unknown[][] } }).mock.calls;
    const statusUpdate = setCalls.find(
      (args) => (args[0] as { status?: string }).status === 'FULLY_ALLOCATED'
    );
    expect(statusUpdate).toBeDefined();
  });

  it('marks payment PARTIALLY_ALLOCATED when less than the full amount is used', async () => {
    const paymentRow = { id: 1, tenantId: 1, allocatedAmount: '0', unallocatedAmount: '5000.00' };
    const grnRow = { id: 10, tenantId: 1, status: 'APPROVED' };
    const trx = makeTrx([[paymentRow], [grnRow], undefined, undefined]);
    const db = { transaction: vi.fn((fn: (t: typeof trx) => Promise<unknown>) => fn(trx)) };
    const svc = new SupplierPaymentService(db as never);

    await svc.allocate(1, 1, [{ grnId: 10, amount: 2000 }], 99);

    const setCalls = (trx['set'] as { mock: { calls: unknown[][] } }).mock.calls;
    const statusUpdate = setCalls.find(
      (args) => (args[0] as { status?: string }).status === 'PARTIALLY_ALLOCATED'
    );
    expect(statusUpdate).toBeDefined();
  });
});

describe('sanity — error classes carry expected codes', () => {
  it('BusinessError and VendorCreditLimitExceededError expose .code', () => {
    const e1 = new BusinessError('PURCHASE_QTY_MISMATCH', 'x');
    const e2 = new VendorCreditLimitExceededError(9, 100000, 110000);
    expect(e1.code).toBe('PURCHASE_QTY_MISMATCH');
    expect(e2.code).toBe('VENDOR_CREDIT_LIMIT_EXCEEDED');
  });
});
