/**
 * Purchase audit 2026-07-21 gap-closure — Purchase Invoice (PO/GRN variance-check layer, NOT
 * full 3-way-match — see the module comment on PurchaseInvoiceService for why). Covers the
 * variance computation (the arithmetic that actually matters here) and the status guards.
 */

import { describe, it, expect, vi } from 'vitest';
import { BusinessError, NotFoundError } from '@erp/types';

vi.mock('@erp/db', () => ({
  purchaseInvoices: {
    id: 'id',
    tenantId: 'tenant_id',
    status: 'status',
    branchId: 'branch_id',
  },
  purchaseInvoiceLines: { invoiceId: 'invoice_id' },
  grns: { id: 'id', tenantId: 'tenant_id', status: 'status' },
  grnLines: { grnId: 'grn_id' },
}));

vi.mock('drizzle-orm', () => ({
  and: vi.fn((...args) => ({ type: 'and', args })),
  eq: vi.fn((col, val) => ({ type: 'eq', col, val })),
  desc: vi.fn((col) => ({ type: 'desc', col })),
  inArray: vi.fn((col, val) => ({ type: 'inArray', col, val })),
}));

import { PurchaseInvoiceService } from '../domain/PurchaseInvoiceService.js';

function makeDb(script: unknown[]) {
  let i = 0;
  const next = () => Promise.resolve(script[i++]);
  const chainable: Record<string, unknown> = {};
  for (const m of ['select', 'from', 'where', 'orderBy', 'insert', 'values', 'update', 'set']) {
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

const baseParams = {
  tenantId: 1,
  branchId: 1,
  supplierInvoiceNumber: 'SUP-INV-001',
  supplierId: 5,
  purchaseOrderId: 10,
  grnId: 20,
  invoiceDate: new Date(),
  createdBy: 9,
};

describe('PurchaseInvoiceService.create — variance computation', () => {
  it('flags status MATCHED and zero variance when invoice exactly matches the GRN', async () => {
    const grnRow = { id: 20, tenantId: 1, status: 'APPROVED' };
    const grnLineRow = { id: 100, itemId: 7, receivedQty: '10.000', grnRate: '50.00' };
    const db = makeDb([[grnRow], [grnLineRow], [{ id: 55 }], undefined]);
    const svc = new PurchaseInvoiceService(db as never);

    const id = await svc.create({
      ...baseParams,
      lines: [{ grnLineId: 100, invoicedQty: 10, invoicedRate: 50 }],
    });

    expect(id).toBe(55);
    const insertedInvoice = (db.values as ReturnType<typeof vi.fn>).mock.calls[0]![0] as {
      status: string;
      varianceAmount: string;
      grandTotal: string;
    };
    expect(insertedInvoice.status).toBe('MATCHED');
    expect(insertedInvoice.varianceAmount).toBe('0');
    expect(insertedInvoice.grandTotal).toBe('500');
  });

  it('flags status VARIANCE and computes the monetary variance when qty differs from the GRN', async () => {
    const grnRow = { id: 20, tenantId: 1, status: 'APPROVED' };
    // GRN received 10 @ ₹50 = ₹500; supplier invoiced 12 @ ₹50 = ₹600 → +₹100 variance
    const grnLineRow = { id: 100, itemId: 7, receivedQty: '10.000', grnRate: '50.00' };
    const db = makeDb([[grnRow], [grnLineRow], [{ id: 56 }], undefined]);
    const svc = new PurchaseInvoiceService(db as never);

    await svc.create({
      ...baseParams,
      lines: [{ grnLineId: 100, invoicedQty: 12, invoicedRate: 50 }],
    });

    const insertedInvoice = (db.values as ReturnType<typeof vi.fn>).mock.calls[0]![0] as {
      status: string;
      varianceAmount: string;
    };
    expect(insertedInvoice.status).toBe('VARIANCE');
    expect(insertedInvoice.varianceAmount).toBe('100');
  });

  it('flags status VARIANCE when the invoiced rate differs from the GRN rate', async () => {
    const grnRow = { id: 20, tenantId: 1, status: 'APPROVED' };
    // GRN received 10 @ ₹50 = ₹500; supplier invoiced 10 @ ₹55 = ₹550 → +₹50 variance
    const grnLineRow = { id: 100, itemId: 7, receivedQty: '10.000', grnRate: '50.00' };
    const db = makeDb([[grnRow], [grnLineRow], [{ id: 57 }], undefined]);
    const svc = new PurchaseInvoiceService(db as never);

    await svc.create({
      ...baseParams,
      lines: [{ grnLineId: 100, invoicedQty: 10, invoicedRate: 55 }],
    });

    const insertedInvoice = (db.values as ReturnType<typeof vi.fn>).mock.calls[0]![0] as {
      status: string;
      varianceAmount: string;
    };
    expect(insertedInvoice.status).toBe('VARIANCE');
    expect(insertedInvoice.varianceAmount).toBe('50');
  });

  it('rejects invoicing against a GRN that is not APPROVED', async () => {
    const grnRow = { id: 20, tenantId: 1, status: 'DRAFT' };
    const db = makeDb([[grnRow]]);
    const svc = new PurchaseInvoiceService(db as never);

    await expect(
      svc.create({ ...baseParams, lines: [{ grnLineId: 100, invoicedQty: 10, invoicedRate: 50 }] })
    ).rejects.toMatchObject({ code: 'INVALID_GRN_STATUS' });
  });

  it('throws NotFoundError for a non-existent GRN', async () => {
    const db = makeDb([[]]);
    const svc = new PurchaseInvoiceService(db as never);

    await expect(
      svc.create({ ...baseParams, lines: [{ grnLineId: 100, invoicedQty: 10, invoicedRate: 50 }] })
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('rejects a line referencing a grnLineId not on the GRN', async () => {
    const grnRow = { id: 20, tenantId: 1, status: 'APPROVED' };
    const grnLineRow = { id: 100, itemId: 7, receivedQty: '10.000', grnRate: '50.00' };
    const db = makeDb([[grnRow], [grnLineRow]]);
    const svc = new PurchaseInvoiceService(db as never);

    await expect(
      svc.create({ ...baseParams, lines: [{ grnLineId: 999, invoicedQty: 10, invoicedRate: 50 }] })
    ).rejects.toBeInstanceOf(BusinessError);
  });
});

describe('PurchaseInvoiceService.approve', () => {
  it('rejects approving an already-APPROVED invoice', async () => {
    const db = makeDb([[{ id: 1, tenantId: 1, status: 'APPROVED' }]]);
    const svc = new PurchaseInvoiceService(db as never);

    await expect(svc.approve(1, 1, 9)).rejects.toMatchObject({ code: 'ALREADY_APPROVED' });
  });

  it('throws NotFoundError for a non-existent invoice', async () => {
    const db = makeDb([[]]);
    const svc = new PurchaseInvoiceService(db as never);

    await expect(svc.approve(999, 1, 9)).rejects.toBeInstanceOf(NotFoundError);
  });
});
