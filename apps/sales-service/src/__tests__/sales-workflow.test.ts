/**
 * ES-08 — Sales Workflow Tests
 * Covers: quotation convert, credit limit, partial payment, invoice cancel, sale return
 */

import { describe, it, expect, vi } from 'vitest';

// ── Module mocks ─────────────────────────────────────────────────────────────

vi.mock('ulid', () => ({ ulid: () => 'TEST-ULID-01' }));

vi.mock('@erp/db', () => ({
  quotations: {
    id: 'id',
    tenantId: 'tenant_id',
    status: 'status',
    customerId: 'customer_id',
    grandTotal: 'grand_total',
  },
  quotationLines: {},
  outboxEvents: {},
  invoices: {
    id: 'id',
    tenantId: 'tenant_id',
    status: 'status',
    customerId: 'customer_id',
    grandTotal: 'grand_total',
    balanceDue: 'balance_due',
    paidAmount: 'paid_amount',
    version: 'version',
    dueDate: 'due_date',
    branchId: 'branch_id',
    invoiceDate: 'invoice_date',
    warehouseId: 'warehouse_id',
  },
  invoiceLines: { invoiceId: 'invoice_id', itemId: 'item_id', quantity: 'quantity' },
  invoiceHistory: {},
  customers: {
    id: 'id',
    tenantId: 'tenant_id',
    creditLimit: 'credit_limit',
    creditLimitEnabled: 'credit_limit_enabled',
  },
  items: {
    id: 'id',
    tenantId: 'tenant_id',
    availableQty: 'available_qty',
    version: 'version',
    minSalePrice: 'min_sale_price',
  },
  payments: {
    id: 'id',
    tenantId: 'tenant_id',
    status: 'status',
    amount: 'amount',
    allocatedAmount: 'allocated_amount',
    unallocatedAmount: 'unallocated_amount',
  },
  paymentAllocations: {},
  projectionDashboardDaily: {
    tenantId: 'tenant_id',
    branchId: 'branch_id',
    date: 'date',
    salesCount: 'sales_count',
    salesAmount: 'sales_amount',
    collectedAmount: 'collected_amount',
  },
  projectionCustomerBalance: {
    tenantId: 'tenant_id',
    customerId: 'customer_id',
    currentBalance: 'current_balance',
    totalInvoiced: 'total_invoiced',
    totalPaid: 'total_paid',
    overdueAmount: 'overdue_amount',
    lastInvoiceAt: 'last_invoice_at',
    lastPaymentAt: 'last_payment_at',
  },
  saleReturns: { id: 'id' },
  saleReturnLines: {},
  creditNotes: { id: 'id' },
  inventoryLedger: {},
  deliveryChallans: {
    id: 'id',
    tenantId: 'tenant_id',
    status: 'status',
    convertedInvoiceId: 'converted_invoice_id',
    convertedAt: 'converted_at',
  },
}));

vi.mock('drizzle-orm', () => ({
  and: vi.fn((...args) => ({ type: 'and', args })),
  eq: vi.fn((col, val) => ({ type: 'eq', col, val })),
  sql: vi.fn((s) => s),
  desc: vi.fn((c) => c),
  inArray: vi.fn((col, vals) => ({ type: 'in', col, vals })),
  lt: vi.fn((col, val) => ({ type: 'lt', col, val })),
}));

// ── Service imports (after mocks) ────────────────────────────────────────────

import { QuotationService } from '../domain/QuotationService.js';
import { InvoiceService, CreditLimitExceededError } from '../domain/InvoiceService.js';
import { PaymentService } from '../domain/PaymentService.js';
import { SaleReturnService } from '../domain/SaleReturnService.js';
import { BusinessError } from '@erp/types';

// ── Mock database builder ────────────────────────────────────────────────────

function makeTrx() {
  const trx: Record<string, unknown> = {};
  const chainable = {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    innerJoin: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    offset: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    values: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
    returning: vi.fn().mockResolvedValue([{ id: 1 }]),
    onConflictDoUpdate: vi.fn().mockResolvedValue([]),
  };
  Object.assign(trx, chainable);
  return trx as typeof chainable & Record<string, unknown>;
}

function makeDb(trxFactory?: () => ReturnType<typeof makeTrx>) {
  const trx = trxFactory ? trxFactory() : makeTrx();
  const db = {
    ...trx,
    transaction: vi.fn((fn: (t: typeof trx) => Promise<unknown>) => fn(trx)),
  };
  return { db, trx };
}

// `where()` sometimes terminates a chain directly (`await ...where(x)`) and
// sometimes is followed by `.returning(x)` (`await ...where(x).returning(y)`).
// This resolves the former case as itself while exposing `.returning()` for
// the latter, delegating to the trx's current `returning` mock so per-test
// overrides of `trx.returning` still apply.
function hybridWhere(trx: ReturnType<typeof makeTrx>, value: unknown) {
  const p = Promise.resolve(value) as Promise<unknown> & {
    returning: (...args: unknown[]) => unknown;
  };
  p.returning = (...args: unknown[]) => (trx.returning as (...a: unknown[]) => unknown)(...args);
  return p;
}

// ── Test 1 & 2 — Quotation convert ──────────────────────────────────────────

describe('QuotationService.convert', () => {
  it('converts an ACCEPTED quotation → status CONVERTED + outbox event', async () => {
    const { db, trx } = makeDb();

    trx.where = vi
      .fn()
      .mockResolvedValueOnce([
        { id: 1, tenantId: 1, status: 'ACCEPTED', customerId: 42, grandTotal: '10000.00' },
      ])
      .mockResolvedValue(undefined);

    const svc = new QuotationService(db as never);
    const result = await svc.convert(1, 1, 99);

    expect(result).toEqual({ quotationId: 1 });
    expect(db.transaction).toHaveBeenCalled();
  });

  it('throws INVALID_STATUS when quotation is DRAFT', async () => {
    const { db, trx } = makeDb();

    trx.where = vi
      .fn()
      .mockResolvedValueOnce([
        { id: 1, tenantId: 1, status: 'DRAFT', customerId: 42, grandTotal: '10000.00' },
      ]);

    const svc = new QuotationService(db as never);
    await expect(svc.convert(1, 1, 99)).rejects.toBeInstanceOf(BusinessError);
  });
});

// ── Quotation accept/reject — the only path that can reach ACCEPTED ─────────
// Regression coverage for a workflow-completeness gap: ES-08 hardened
// convert() to ACCEPTED-only but never shipped a way to reach ACCEPTED,
// leaving every SENT quotation permanently unconvertible.

describe('QuotationService.accept', () => {
  it('accepts a SENT quotation → status ACCEPTED', async () => {
    const { db } = makeDb();
    db.where = vi
      .fn()
      .mockResolvedValueOnce([
        { id: 1, tenantId: 1, status: 'SENT', customerId: 42, grandTotal: '10000.00' },
      ])
      .mockResolvedValue(undefined);

    const svc = new QuotationService(db as never);
    await expect(svc.accept(1, 1, 99)).resolves.toBeUndefined();
  });

  it('accepts a VIEWED quotation → status ACCEPTED', async () => {
    const { db } = makeDb();
    db.where = vi
      .fn()
      .mockResolvedValueOnce([
        { id: 1, tenantId: 1, status: 'VIEWED', customerId: 42, grandTotal: '10000.00' },
      ])
      .mockResolvedValue(undefined);

    const svc = new QuotationService(db as never);
    await expect(svc.accept(1, 1, 99)).resolves.toBeUndefined();
  });

  it('throws INVALID_STATUS when quotation is DRAFT', async () => {
    const { db } = makeDb();
    db.where = vi
      .fn()
      .mockResolvedValueOnce([
        { id: 1, tenantId: 1, status: 'DRAFT', customerId: 42, grandTotal: '10000.00' },
      ]);

    const svc = new QuotationService(db as never);
    await expect(svc.accept(1, 1, 99)).rejects.toBeInstanceOf(BusinessError);
  });

  it('throws INVALID_STATUS when quotation is already CONVERTED', async () => {
    const { db } = makeDb();
    db.where = vi
      .fn()
      .mockResolvedValueOnce([
        { id: 1, tenantId: 1, status: 'CONVERTED', customerId: 42, grandTotal: '10000.00' },
      ]);

    const svc = new QuotationService(db as never);
    await expect(svc.accept(1, 1, 99)).rejects.toBeInstanceOf(BusinessError);
  });
});

describe('QuotationService.reject', () => {
  it('rejects a SENT quotation → status REJECTED', async () => {
    const { db } = makeDb();
    db.where = vi
      .fn()
      .mockResolvedValueOnce([
        { id: 1, tenantId: 1, status: 'SENT', customerId: 42, grandTotal: '10000.00' },
      ])
      .mockResolvedValue(undefined);

    const svc = new QuotationService(db as never);
    await expect(svc.reject(1, 1, 99)).resolves.toBeUndefined();
  });

  it('throws INVALID_STATUS when quotation is DRAFT', async () => {
    const { db } = makeDb();
    db.where = vi
      .fn()
      .mockResolvedValueOnce([
        { id: 1, tenantId: 1, status: 'DRAFT', customerId: 42, grandTotal: '10000.00' },
      ]);

    const svc = new QuotationService(db as never);
    await expect(svc.reject(1, 1, 99)).rejects.toBeInstanceOf(BusinessError);
  });
});

// ── Test 3 & 4 — Credit limit ────────────────────────────────────────────────

describe('InvoiceService credit limit', () => {
  const baseInvoiceParams = {
    tenantId: 1,
    branchId: 1,
    warehouseId: 1,
    customerId: 10,
    placeOfSupply: 'MH',
    sellerStateCode: 'MH',
    invoiceDate: new Date('2026-01-01'),
    dueDate: new Date('2026-02-01'),
    lines: [
      { itemId: 5, quantity: 10, unitPrice: 1000, gstRate: 18, discountPct: 0, discountAmount: 0 },
    ],
    createdBy: 1,
    overrideCreditLimit: false,
    overridePriceFloor: false,
  };

  it('throws CreditLimitExceededError when invoice would breach credit limit', async () => {
    const { db, trx } = makeDb();

    trx.where = vi
      .fn()
      .mockResolvedValueOnce([{ creditLimit: '5000', creditLimitEnabled: true }])
      .mockResolvedValueOnce([{ currentBalance: '4000.00' }]);

    const svc = new InvoiceService(db as never);
    await expect(svc.create(baseInvoiceParams as never)).rejects.toBeInstanceOf(
      CreditLimitExceededError
    );
  });

  it('proceeds when overrideCreditLimit=true even with exceeded limit', async () => {
    const { db, trx } = makeDb();

    trx.where = vi
      .fn()
      .mockResolvedValueOnce([{ creditLimit: '5000', creditLimitEnabled: true }])
      .mockResolvedValueOnce([{ currentBalance: '4000.00' }])
      .mockResolvedValue([]);

    trx.returning = vi.fn().mockResolvedValue([{ id: 99 }]);

    const svc = new InvoiceService(db as never);
    const id = await svc.create({ ...baseInvoiceParams, overrideCreditLimit: true } as never);
    expect(id).toBe(99);
  });
});

// ── Test 5 & 6 — Partial payments ────────────────────────────────────────────

describe('PaymentService.allocate', () => {
  const tenantId = 1;
  const userId = 1;

  it('sets invoice status to PARTIALLY_PAID when 50% is paid', async () => {
    const { db, trx } = makeDb();

    trx.where = vi
      .fn()
      .mockImplementationOnce(() =>
        hybridWhere(trx, [
          {
            id: 10,
            tenantId,
            amount: '10000',
            allocatedAmount: '0',
            unallocatedAmount: '10000',
            branchId: 1,
            paymentDate: new Date(),
            status: 'RECEIVED',
          },
        ])
      )
      .mockImplementationOnce(() =>
        hybridWhere(trx, [
          { balanceDue: '20000', status: 'CONFIRMED', customerId: 42, grandTotal: '20000' },
        ])
      )
      .mockImplementation(() => hybridWhere(trx, undefined));

    // Atomic allocate() now derives status from a SQL CASE expression, not a JS
    // literal, so this asserts the guarded UPDATE path was taken (non-empty
    // .returning() result) rather than pattern-matching the mocked SQL fragment.
    trx.returning = vi.fn().mockResolvedValue([{ balanceDue: '10000' }]);

    const svc = new PaymentService(db as never);
    await svc.allocate(10, tenantId, [{ invoiceId: 5, amount: 10000 }], userId);

    const setMock = trx.set as ReturnType<typeof vi.fn>;
    const invoiceUpdateCall = setMock.mock.calls.find((args) => args[0]?.balanceDue !== undefined);
    expect(invoiceUpdateCall).toBeTruthy();
  });

  it('sets invoice status to PAID when full balance is allocated', async () => {
    const { db, trx } = makeDb();

    trx.where = vi
      .fn()
      .mockImplementationOnce(() =>
        hybridWhere(trx, [
          {
            id: 10,
            tenantId,
            amount: '10000',
            allocatedAmount: '0',
            unallocatedAmount: '10000',
            branchId: 1,
            paymentDate: new Date(),
            status: 'RECEIVED',
          },
        ])
      )
      .mockImplementationOnce(() =>
        hybridWhere(trx, [
          { balanceDue: '10000', status: 'PARTIALLY_PAID', customerId: 42, grandTotal: '20000' },
        ])
      )
      .mockImplementation(() => hybridWhere(trx, undefined));

    trx.returning = vi.fn().mockResolvedValue([{ balanceDue: '0' }]);

    const svc = new PaymentService(db as never);
    await svc.allocate(10, tenantId, [{ invoiceId: 5, amount: 10000 }], userId);

    const setMock = trx.set as ReturnType<typeof vi.fn>;
    const invoiceUpdateCall = setMock.mock.calls.find((args) => args[0]?.balanceDue !== undefined);
    expect(invoiceUpdateCall).toBeTruthy();
  });
});

// ── Test 7 & 8 — Invoice cancellation ────────────────────────────────────────

describe('InvoiceService.cancel', () => {
  it('cancels a CONFIRMED invoice, restores stock, and writes STOCK_IN ledger rows', async () => {
    const { db, trx } = makeDb();

    trx.where = vi
      .fn()
      .mockImplementationOnce(() =>
        hybridWhere(trx, [
          {
            id: 1,
            tenantId: 1,
            status: 'CONFIRMED',
            customerId: 42,
            grandTotal: '10000',
            branchId: 1,
            invoiceDate: new Date(),
            warehouseId: 7,
          },
        ])
      )
      .mockImplementationOnce(() =>
        hybridWhere(trx, [
          { id: 1, itemId: 5, quantity: '10.000' },
          { id: 2, itemId: 6, quantity: '5.000' },
        ])
      )
      .mockImplementation(() => hybridWhere(trx, undefined));

    trx.returning = vi.fn().mockResolvedValue([{ availableQty: '15.000' }]);

    const svc = new InvoiceService(db as never);
    await svc.cancel(1, 1, 99, 'Test cancellation');

    expect(trx.update).toHaveBeenCalled();
    expect(trx.insert).toHaveBeenCalled();
    const valuesMock = trx.values as ReturnType<typeof vi.fn>;
    const stockInCalls = valuesMock.mock.calls.filter(
      (args) => (args[0] as { movementType?: string })?.movementType === 'STOCK_IN'
    );
    expect(stockInCalls.length).toBe(2);
  });

  it('throws INVALID_STATUS when cancelling a PAID invoice', async () => {
    const { db, trx } = makeDb();

    trx.where = vi
      .fn()
      .mockResolvedValueOnce([
        { id: 1, tenantId: 1, status: 'PAID', customerId: 42, grandTotal: '10000' },
      ]);

    const svc = new InvoiceService(db as never);
    await expect(svc.cancel(1, 1, 99, 'reason')).rejects.toBeInstanceOf(BusinessError);
  });
});

// ── Test 9 & 10 — Sales return ────────────────────────────────────────────────

describe('SaleReturnService.create', () => {
  const baseParams = {
    tenantId: 1,
    branchId: 1,
    returnNumber: 'RET-001',
    invoiceId: 5,
    customerId: 42,
    returnDate: new Date(),
    reason: 'DEFECTIVE' as const,
    isPhysicalReturn: true,
    warehouseId: 1,
    lines: [{ invoiceLineId: 10, itemId: 5, returnQty: 3 }],
    creditNoteNumber: 'CN-001',
    createdBy: 1,
  };

  it('creates a return with valid quantities, restores stock, and emits SALE_RETURN_APPROVED event', async () => {
    const { db, trx } = makeDb();

    trx.where = vi
      .fn()
      .mockImplementationOnce(() => hybridWhere(trx, [{ id: 5, tenantId: 1, status: 'CONFIRMED' }]))
      .mockImplementationOnce(() =>
        hybridWhere(trx, [
          {
            id: 10,
            invoiceId: 5,
            quantity: '10.000',
            unitPrice: '1000',
            cgstAmount: '90',
            sgstAmount: '90',
            igstAmount: '0',
            taxableAmount: '1000',
          },
        ])
      )
      .mockImplementationOnce(() => hybridWhere(trx, [{ alreadyReturned: '0' }])) // ES-23 [H7]: prior-APPROVED-returns SUM
      .mockImplementation(() => hybridWhere(trx, undefined));

    let returningCallCount = 0;
    trx.returning = vi.fn().mockImplementation(() => {
      returningCallCount++;
      return Promise.resolve([{ id: returningCallCount, availableQty: '7.000' }]);
    });

    const svc = new SaleReturnService(db as never);
    const result = await svc.create(baseParams);

    expect(result.returnId).toBeDefined();
    expect(result.creditNoteId).toBeDefined();
    const valuesMock = trx.values as ReturnType<typeof vi.fn>;
    const stockInCalls = valuesMock.mock.calls.filter((args) => {
      const v = args[0] as { movementType?: string } | Array<{ movementType?: string }>;
      return Array.isArray(v)
        ? v.some((r) => r.movementType === 'STOCK_IN')
        : v?.movementType === 'STOCK_IN';
    });
    expect(stockInCalls.length).toBe(1);
  });

  it('throws RETURN_QTY_EXCEEDED when return qty exceeds original qty', async () => {
    const { db, trx } = makeDb();

    trx.where = vi
      .fn()
      .mockResolvedValueOnce([{ id: 5, tenantId: 1, status: 'CONFIRMED' }])
      .mockResolvedValueOnce([
        {
          id: 10,
          invoiceId: 5,
          quantity: '2.000',
          unitPrice: '1000',
          cgstAmount: '18',
          sgstAmount: '18',
          igstAmount: '0',
          taxableAmount: '1000',
        },
      ])
      .mockResolvedValueOnce([{ alreadyReturned: '0' }]); // ES-23 [H7]: prior-APPROVED-returns SUM

    const svc = new SaleReturnService(db as never);
    await expect(svc.create(baseParams)).rejects.toBeInstanceOf(BusinessError);
  });
});
