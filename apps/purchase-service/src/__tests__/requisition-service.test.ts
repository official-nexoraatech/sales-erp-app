/**
 * Purchase audit 2026-07-21 gap-closure — Purchase Requisition. Covers the state-machine
 * guards (Draft->Submit->Approve/Reject->Convert) and the estimatedTotal computation, mirroring
 * the mock-db pattern used by purchase-workflow.test.ts.
 */

import { describe, it, expect, vi } from 'vitest';
import { BusinessError, NotFoundError } from '@erp/types';

vi.mock('@erp/db', () => ({
  purchaseRequisitions: {
    id: 'id',
    tenantId: 'tenant_id',
    status: 'status',
    branchId: 'branch_id',
    version: 'version',
  },
  purchaseRequisitionLines: { requisitionId: 'requisition_id' },
  items: { id: 'id', name: 'name' },
  purchaseOrders: {},
  purchaseOrderLines: {},
  purchaseOrderHistory: {},
  purchaseOrderAmendments: {},
  suppliers: { id: 'id', tenantId: 'tenant_id' },
  projectionSupplierBalance: {},
  outboxEvents: {},
  organizationSettings: {},
}));

vi.mock('drizzle-orm', () => ({
  and: vi.fn((...args) => ({ type: 'and', args })),
  eq: vi.fn((col, val) => ({ type: 'eq', col, val })),
  inArray: vi.fn((col, val) => ({ type: 'inArray', col, val })),
  desc: vi.fn((col) => ({ type: 'desc', col })),
  sql: vi.fn((s) => s),
  getTableColumns: vi.fn(() => ({})),
}));

import { RequisitionService } from '../domain/RequisitionService.js';

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

describe('RequisitionService.create', () => {
  it('computes estimatedTotal as sum(requestedQty * estimatedUnitPrice) across lines', async () => {
    const db = makeDb([[{ id: 42 }], undefined]);
    const svc = new RequisitionService(db as never);

    const id = await svc.create({
      tenantId: 1,
      branchId: 1,
      lines: [
        { itemId: 1, requestedQty: 10, estimatedUnitPrice: 50 },
        { itemId: 2, requestedQty: 2, estimatedUnitPrice: 25 },
      ],
      requestedBy: 9,
    });

    expect(id).toBe(42);
    const insertedValues = (db.values as ReturnType<typeof vi.fn>).mock.calls[0]![0] as {
      estimatedTotal: string;
    };
    expect(insertedValues.estimatedTotal).toBe(String(10 * 50 + 2 * 25));
  });
});

describe('RequisitionService — status-transition guards', () => {
  it('rejects submitting a non-DRAFT requisition', async () => {
    const db = makeDb([[{ id: 1, tenantId: 1, status: 'SUBMITTED' }]]);
    const svc = new RequisitionService(db as never);

    await expect(svc.submit(1, 1, 9)).rejects.toMatchObject({ code: 'INVALID_STATUS' });
  });

  it('rejects approving a non-SUBMITTED requisition', async () => {
    const db = makeDb([[{ id: 1, tenantId: 1, status: 'DRAFT' }]]);
    const svc = new RequisitionService(db as never);

    await expect(svc.approve(1, 1, 9)).rejects.toMatchObject({ code: 'INVALID_STATUS' });
  });

  it('rejects rejecting a non-SUBMITTED requisition', async () => {
    const db = makeDb([[{ id: 1, tenantId: 1, status: 'APPROVED' }]]);
    const svc = new RequisitionService(db as never);

    await expect(svc.reject(1, 1, 9, 'not needed')).rejects.toMatchObject({
      code: 'INVALID_STATUS',
    });
  });

  it('throws NotFoundError when the requisition does not exist', async () => {
    const db = makeDb([[]]);
    const svc = new RequisitionService(db as never);

    await expect(svc.submit(999, 1, 9)).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('RequisitionService.convertToPO', () => {
  it('rejects converting a non-APPROVED requisition', async () => {
    const db = makeDb([[{ id: 1, tenantId: 1, status: 'SUBMITTED' }]]);
    const svc = new RequisitionService(db as never);

    await expect(
      svc.convertToPO(1, 1, 9, {
        supplierId: 5,
        branchId: 1,
        warehouseId: 1,
        poDate: new Date(),
        placeOfSupply: '27',
        lineOverrides: [],
      })
    ).rejects.toMatchObject({ code: 'INVALID_STATUS' });
  });

  it('rejects when a line override is missing for a requisition item', async () => {
    const db = makeDb([
      [{ id: 1, tenantId: 1, status: 'APPROVED' }],
      [{ id: 1, requisitionId: 1, itemId: 7, requestedQty: '5', unitId: null }],
    ]);
    const svc = new RequisitionService(db as never);

    await expect(
      svc.convertToPO(1, 1, 9, {
        supplierId: 5,
        branchId: 1,
        warehouseId: 1,
        poDate: new Date(),
        placeOfSupply: '27',
        lineOverrides: [], // no override for item 7
      })
    ).rejects.toBeInstanceOf(BusinessError);
  });

  it('rejects converting a requisition with no lines', async () => {
    const db = makeDb([[{ id: 1, tenantId: 1, status: 'APPROVED' }], []]);
    const svc = new RequisitionService(db as never);

    await expect(
      svc.convertToPO(1, 1, 9, {
        supplierId: 5,
        branchId: 1,
        warehouseId: 1,
        poDate: new Date(),
        placeOfSupply: '27',
        lineOverrides: [],
      })
    ).rejects.toMatchObject({ code: 'REQUISITION_EMPTY' });
  });
});
