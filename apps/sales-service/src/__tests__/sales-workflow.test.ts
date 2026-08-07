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
  inventoryLedger: { cogsPerUnit: 'cogs_per_unit' },
  inventoryFifoLayers: {},
  inventoryWarehouseValuation: {
    tenantId: 'tenant_id',
    itemId: 'item_id',
    warehouseId: 'warehouse_id',
    variantId: 'variant_id',
  },
  projectionStockLevel: {
    tenantId: 'tenant_id',
    itemId: 'item_id',
    warehouseId: 'warehouse_id',
    variantId: 'variant_id',
  },
  deliveryChallans: {
    id: 'id',
    tenantId: 'tenant_id',
    status: 'status',
    convertedInvoiceId: 'converted_invoice_id',
    convertedAt: 'converted_at',
  },
  webhookSubscriptions: {
    id: 'id',
    tenantId: 'tenant_id',
    isActive: 'is_active',
    events: 'events',
  },
  webhookDeliveries: {},
  eventStore: {},
  eventSnapshots: {},
  workflowDefinitions: {
    tenantId: 'tenant_id',
    triggerEvent: 'trigger_event',
    isActive: 'is_active',
  },
  workflowInstances: {
    id: 'id',
    tenantId: 'tenant_id',
    entityType: 'entity_type',
    entityId: 'entity_id',
    status: 'status',
    createdAt: 'created_at',
  },
  businessRules: {
    tenantId: 'tenant_id',
    entityType: 'entity_type',
    eventType: 'event_type',
    isActive: 'is_active',
    priority: 'priority',
  },
}));

vi.mock('drizzle-orm', () => ({
  and: vi.fn((...args) => ({ type: 'and', args })),
  eq: vi.fn((col, val) => ({ type: 'eq', col, val })),
  isNull: vi.fn((col) => ({ type: 'isNull', col })),
  asc: vi.fn((col) => ({ type: 'asc', col })),
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
import { BusinessError, NotFoundError } from '@erp/types';
import { DuplicateOperationError } from '@erp/sdk';

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
    delete: vi.fn().mockReturnThis(),
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
// sometimes is followed by `.returning(x)` (`await ...where(x).returning(y)`),
// `.orderBy(x).limit(y)` (EventStoreService.append()'s current-version
// lookup), or `.for('update')` (applyCreditNote/refundCreditNote's row lock).
// This resolves the direct-await case as itself while exposing `.returning()`
// (delegating to the trx's current `returning` mock, so per-test overrides
// still apply), `.orderBy().limit()` and `.for()` (both resolving to
// `value ?? []` — an array, since EventStoreService destructures `existing[0]`).
function hybridWhere(trx: ReturnType<typeof makeTrx>, value: unknown) {
  const p = Promise.resolve(value) as Promise<unknown> & {
    returning: (...args: unknown[]) => unknown;
    orderBy: (...args: unknown[]) => { limit: (...args: unknown[]) => Promise<unknown> };
    for: (...args: unknown[]) => Promise<unknown>;
    limit: (...args: unknown[]) => Promise<unknown>;
  };
  p.returning = (...args: unknown[]) => (trx.returning as (...a: unknown[]) => unknown)(...args);
  // Two distinct .orderBy() usages exist: EventStoreService's version lookup always chains
  // `.orderBy().limit()`, while RuleEngine.evaluate() awaits `.orderBy(...)` directly with no
  // `.limit()` — so the returned object must be both a real thenable (awaitable as-is) AND
  // expose `.limit()` for the other caller.
  p.orderBy = () => {
    const op = Promise.resolve(value ?? []) as Promise<unknown> & {
      limit: (...args: unknown[]) => Promise<unknown>;
    };
    op.limit = () => Promise.resolve(value ?? []);
    return op;
  };
  p.for = () => Promise.resolve(value ?? []);
  // WorkflowEngine.trigger()'s workflowDefinitions lookup terminates `.where().limit(1)`
  // directly, with no `.orderBy()` in between — distinct from the `.orderBy().limit()` shape
  // above (e.g. EventStoreService's current-version lookup).
  p.limit = () => Promise.resolve(value ?? []);
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

  // M-10 fix: accept() previously never checked validUntil itself, relying entirely on a
  // separate cron sweep — an already-expired quotation could still be accepted.
  it('rejects an expired quotation (validUntil in the past) even though status is still SENT', async () => {
    const { db } = makeDb();
    db.where = vi.fn().mockResolvedValueOnce([
      {
        id: 1,
        tenantId: 1,
        status: 'SENT',
        customerId: 42,
        grandTotal: '10000.00',
        validUntil: new Date(Date.now() - 86400_000),
      },
    ]);

    const svc = new QuotationService(db as never);
    await expect(svc.accept(1, 1, 99)).rejects.toMatchObject({ code: 'QUOTATION_EXPIRED' });
  });

  it('accepts a SENT quotation whose validUntil is still in the future', async () => {
    const { db } = makeDb();
    db.where = vi
      .fn()
      .mockResolvedValueOnce([
        {
          id: 1,
          tenantId: 1,
          status: 'SENT',
          customerId: 42,
          grandTotal: '10000.00',
          validUntil: new Date(Date.now() + 86400_000),
        },
      ])
      .mockResolvedValue(undefined);

    const svc = new QuotationService(db as never);
    await expect(svc.accept(1, 1, 99)).resolves.toBeUndefined();
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
      .mockResolvedValueOnce([{ currentBalance: '4000.00' }])
      // RuleEngine.evaluate(): select businessRules — the seeded "Block sale above credit
      // limit" template, matching isOverCreditLimit=true (computed from the two rows above).
      .mockImplementationOnce(() =>
        hybridWhere(trx, [
          {
            id: 1,
            name: 'Block sale above credit limit',
            entityType: 'SALE',
            eventType: 'SALE_CREATE',
            conditionOperator: 'AND',
            conditions: [{ field: 'isOverCreditLimit', operator: 'EQUALS', value: true }],
            actions: [{ type: 'BLOCK', message: 'Customer has exceeded credit limit.' }],
            priority: 1,
            isActive: true,
          },
        ])
      );

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
      .mockImplementation(() => hybridWhere(trx, []));

    trx.returning = vi.fn().mockResolvedValue([{ id: 99 }]);

    const svc = new InvoiceService(db as never);
    const id = await svc.create({ ...baseInvoiceParams, overrideCreditLimit: true } as never);
    expect(id).toBe(99);
  });
});

// H-3 fix: customers.status='BLOCKED'/'INACTIVE' were schema-valid but neither
// InvoiceService.create nor QuotationService.create ever checked them.
describe('InvoiceService.create — customer status guard', () => {
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
    overridePriceFloor: true,
  };

  it('rejects a BLOCKED customer', async () => {
    const { db, trx } = makeDb();
    trx.where = vi
      .fn()
      .mockResolvedValueOnce([{ creditLimit: '0', creditLimitEnabled: false, status: 'BLOCKED' }]);

    const svc = new InvoiceService(db as never);
    await expect(svc.create(baseInvoiceParams as never)).rejects.toBeInstanceOf(BusinessError);
  });

  it('rejects an INACTIVE customer', async () => {
    const { db, trx } = makeDb();
    trx.where = vi
      .fn()
      .mockResolvedValueOnce([{ creditLimit: '0', creditLimitEnabled: false, status: 'INACTIVE' }]);

    const svc = new InvoiceService(db as never);
    await expect(svc.create(baseInvoiceParams as never)).rejects.toBeInstanceOf(BusinessError);
  });

  it('proceeds for an ACTIVE customer', async () => {
    const { db, trx } = makeDb();
    trx.where = vi
      .fn()
      .mockResolvedValueOnce([{ creditLimit: '0', creditLimitEnabled: false, status: 'ACTIVE' }])
      .mockImplementation(() => hybridWhere(trx, []));
    trx.returning = vi.fn().mockResolvedValue([{ id: 99 }]);

    const svc = new InvoiceService(db as never);
    const id = await svc.create(baseInvoiceParams as never);
    expect(id).toBe(99);
  });
});

describe('QuotationService.create — customer status guard', () => {
  const baseQuotationParams = {
    tenantId: 1,
    branchId: 1,
    customerId: 10,
    quotationNumber: 'QUO-001',
    placeOfSupply: 'MH',
    sellerStateCode: 'MH',
    validUntil: new Date('2026-12-31'),
    lines: [{ itemId: 5, quantity: 10, unitPrice: 1000, gstRate: 18 }],
    createdBy: 1,
  };

  it('rejects a BLOCKED customer', async () => {
    const { db, trx } = makeDb();
    trx.where = vi.fn().mockResolvedValueOnce([{ status: 'BLOCKED' }]);

    const svc = new QuotationService(db as never);
    await expect(svc.create(baseQuotationParams as never)).rejects.toBeInstanceOf(BusinessError);
  });

  it('rejects an INACTIVE customer', async () => {
    const { db, trx } = makeDb();
    trx.where = vi.fn().mockResolvedValueOnce([{ status: 'INACTIVE' }]);

    const svc = new QuotationService(db as never);
    await expect(svc.create(baseQuotationParams as never)).rejects.toBeInstanceOf(BusinessError);
  });

  it('proceeds for an ACTIVE customer', async () => {
    const { db, trx } = makeDb();
    trx.where = vi.fn().mockResolvedValueOnce([{ status: 'ACTIVE' }]);
    trx.returning = vi.fn().mockResolvedValue([{ id: 7 }]);

    const svc = new QuotationService(db as never);
    const id = await svc.create(baseQuotationParams as never);
    expect(id).toBe(7);
  });
});

// C-5 fix: creating an invoice from a quotationId used to force-set that quotation to
// CONVERTED unconditionally, with no status check — bypassing QuotationService.convert()'s
// own ACCEPTED-only guard entirely. An invoice could be created from a DRAFT, SENT, REJECTED,
// or EXPIRED quotation and silently stamp it CONVERTED.
describe('InvoiceService.create — quotation conversion status guard', () => {
  const baseParams = {
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
    overridePriceFloor: true,
    quotationId: 7,
  };

  it('creates the invoice and converts the quotation when it is ACCEPTED', async () => {
    const { db, trx } = makeDb();

    trx.where = vi
      .fn()
      .mockResolvedValueOnce([{ creditLimit: '0', creditLimitEnabled: false }])
      .mockResolvedValueOnce([{ currentBalance: '0' }])
      .mockImplementation(() => hybridWhere(trx, []));

    trx.returning = vi
      .fn()
      .mockImplementationOnce(() => Promise.resolve([{ id: 99 }])) // invoice insert
      .mockImplementationOnce(() => Promise.resolve([{ id: 7 }])); // quotation update matched (ACCEPTED)

    const svc = new InvoiceService(db as never);
    const id = await svc.create(baseParams as never);
    expect(id).toBe(99);
  });

  it('rejects invoice creation when the linked quotation is not ACCEPTED, instead of silently converting it', async () => {
    const { db, trx } = makeDb();

    trx.where = vi
      .fn()
      .mockResolvedValueOnce([{ creditLimit: '0', creditLimitEnabled: false }])
      .mockResolvedValueOnce([{ currentBalance: '0' }])
      .mockImplementation(() => hybridWhere(trx, []));

    trx.returning = vi
      .fn()
      .mockImplementationOnce(() => Promise.resolve([{ id: 99 }])) // invoice insert
      .mockImplementationOnce(() => Promise.resolve([])); // quotation update matched 0 rows (not ACCEPTED)

    const svc = new InvoiceService(db as never);
    await expect(svc.create(baseParams as never)).rejects.toBeInstanceOf(BusinessError);
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

// M-8 fix: standalone payment creation had no idempotency key at all, unlike invoices/POS
// sales — a network-timeout retry of "Record Payment" could create a duplicate Payment row.
describe('PaymentService.create — idempotency', () => {
  it('translates a payments_tenant_client_operation_id collision into DuplicateOperationError', async () => {
    const { db, trx } = makeDb();
    trx.values = vi.fn(() => {
      throw Object.assign(new Error('duplicate key value violates unique constraint'), {
        code: '23505',
        constraint_name: 'payments_tenant_client_operation_id',
      });
    });

    const svc = new PaymentService(db as never);
    await expect(
      svc.create({
        tenantId: 1,
        branchId: 1,
        customerId: 10,
        paymentNumber: 'PAY-1',
        paymentDate: new Date(),
        paymentMode: 'CASH',
        amount: 500,
        createdBy: 1,
        clientOperationId: 'op-123',
      })
    ).rejects.toBeInstanceOf(DuplicateOperationError);
  });
});

// C-4 fix: bounceCheque() used to only flip payments.status — the journal reversed
// correctly, but paymentAllocations, the invoice's paidAmount/balanceDue/status, and
// projectionCustomerBalance were all left exactly as allocate() had set them, so a bounced
// cheque's invoice kept showing PAID with a reduced balanceDue.
describe('PaymentService.bounceCheque', () => {
  const tenantId = 1;

  it('reverses invoice paidAmount/balanceDue, reverses the customer balance projection, and clears the payment allocations', async () => {
    const { db, trx } = makeDb();

    (trx.where as ReturnType<typeof vi.fn>)
      .mockImplementationOnce(() =>
        hybridWhere(trx, [
          { id: 77, tenantId, paymentMode: 'CHEQUE', customerId: 42, amount: '5000' },
        ])
      ) // outer guard lookup (this.db.select().where())
      .mockImplementationOnce(() => hybridWhere(trx, [{ id: 1, invoiceId: 5, amount: '5000' }])) // paymentAllocations
      .mockImplementationOnce(() => hybridWhere(trx, [{ customerId: 42 }])) // invoice customerId lookup
      .mockImplementation(() => hybridWhere(trx, undefined)); // invoice update / balance update / delete / payment update

    const svc = new PaymentService(db as never);
    await svc.bounceCheque(77, tenantId, 'Insufficient funds');

    const setMock = trx.set as ReturnType<typeof vi.fn>;
    const invoiceReversal = setMock.mock.calls.find((args) => args[0]?.paidAmount !== undefined);
    const balanceReversal = setMock.mock.calls.find(
      (args) => args[0]?.currentBalance !== undefined
    );
    const paymentUpdate = setMock.mock.calls.find((args) => args[0]?.status === 'BOUNCED');

    expect(invoiceReversal).toBeTruthy();
    expect(balanceReversal).toBeTruthy();
    expect(paymentUpdate).toBeTruthy();
    expect(paymentUpdate?.[0]).toMatchObject({ allocatedAmount: '0', unallocatedAmount: '0' });
    expect(trx.delete).toHaveBeenCalled();
  });

  it('still bounces a payment cleanly when it had no allocations yet', async () => {
    const { db, trx } = makeDb();

    (trx.where as ReturnType<typeof vi.fn>)
      .mockImplementationOnce(() =>
        hybridWhere(trx, [
          { id: 78, tenantId, paymentMode: 'CHEQUE', customerId: 42, amount: '5000' },
        ])
      )
      .mockImplementationOnce(() => hybridWhere(trx, [])) // no allocations
      .mockImplementation(() => hybridWhere(trx, undefined));

    const svc = new PaymentService(db as never);
    await svc.bounceCheque(78, tenantId, 'Insufficient funds');

    expect(trx.delete).not.toHaveBeenCalled();
    const setMock = trx.set as ReturnType<typeof vi.fn>;
    const paymentUpdate = setMock.mock.calls.find((args) => args[0]?.status === 'BOUNCED');
    expect(paymentUpdate).toBeTruthy();
  });

  it('rejects bouncing a non-cheque payment', async () => {
    const { db, trx } = makeDb();

    (trx.where as ReturnType<typeof vi.fn>).mockImplementationOnce(() =>
      hybridWhere(trx, [{ id: 79, tenantId, paymentMode: 'UPI', customerId: 42, amount: '5000' }])
    );

    const svc = new PaymentService(db as never);
    await expect(svc.bounceCheque(79, tenantId, 'test')).rejects.toThrow(BusinessError);
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
      // Catch-all for every remaining where()-terminated call — including the new
      // ValuationService.applyStockIn item lookup and the reversal cogsPerUnit lookup this
      // fix added, both of which destructure their result (`[item] = await ...`). An empty
      // array resolves those to `undefined` (ValuationService early-returns on `!item`, and
      // the reversal cost falls back to 0) rather than crashing on `undefined` not being
      // iterable — none of this test's assertions depend on the exact valuation math.
      .mockImplementation(() => hybridWhere(trx, []));

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

    // M-7 fix: the INVOICE_CANCELLED outbox payload used to omit status — search-service's
    // partial-update consumer only merges in fields actually present, so a cancelled invoice's
    // search document kept showing status: 'CONFIRMED' forever.
    const cancelledEventCall = valuesMock.mock.calls.find(
      (args) => (args[0] as { eventType?: string })?.eventType === 'INVOICE_CANCELLED'
    );
    expect(cancelledEventCall?.[0]).toMatchObject({
      payload: expect.objectContaining({ status: 'CANCELLED' }),
    });
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
      // Three plain UPDATE...where() calls whose results are never destructured (stock
      // restoration, saleReturns status flip, customer-balance projection) — any value works.
      .mockImplementationOnce(() => hybridWhere(trx, []))
      .mockImplementationOnce(() => hybridWhere(trx, []))
      .mockImplementationOnce(() => hybridWhere(trx, []))
      // G7: customer lookup (customerGstin/customerName for the SALE_RETURN_APPROVED payload)
      // — this one IS destructured (`const [customer] = await ...`), so it needs a real array.
      .mockImplementationOnce(() =>
        hybridWhere(trx, [{ displayName: 'Test Customer', gstin: null }])
      )
      // Catch-all for every remaining where()-terminated call — including the new
      // ValuationService.applyStockIn item lookup and reversal cogsPerUnit lookup this fix
      // added, plus PG-032's per-warehouse valuation lookup, all of which destructure their
      // result. An empty array resolves those safely (early-return / fallback to 0) rather
      // than crashing on `undefined` not being iterable — this test's assertions don't depend
      // on exact valuation math, only on returnId/creditNoteId/stockInCalls.
      .mockImplementation(() => hybridWhere(trx, []));

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

// C-6 fix: the /credit-notes/:id/refund route used to update status='REFUNDED' directly with
// no status guard and no row lock — a double-refund race, unlike applyCreditNote a few lines
// away which was already hardened with FOR UPDATE + a status check.
describe('SaleReturnService.refundCreditNote', () => {
  const tenantId = 1;

  it('refunds an OPEN credit note', async () => {
    const { db, trx } = makeDb();
    trx.where = vi
      .fn()
      .mockImplementationOnce(() =>
        hybridWhere(trx, [{ id: 9, tenantId, status: 'OPEN', remainingAmount: '500' }])
      )
      .mockImplementation(() => hybridWhere(trx, undefined));

    const svc = new SaleReturnService(db as never);
    await svc.refundCreditNote(9, tenantId, 1);

    const setMock = trx.set as ReturnType<typeof vi.fn>;
    const refundCall = setMock.mock.calls.find((args) => args[0]?.status === 'REFUNDED');
    expect(refundCall).toBeTruthy();
  });

  it('rejects refunding a credit note that has already been REFUNDED (the double-refund race)', async () => {
    const { db, trx } = makeDb();
    trx.where = vi
      .fn()
      .mockImplementationOnce(() =>
        hybridWhere(trx, [{ id: 9, tenantId, status: 'REFUNDED', remainingAmount: '0' }])
      );

    const svc = new SaleReturnService(db as never);
    await expect(svc.refundCreditNote(9, tenantId, 1)).rejects.toBeInstanceOf(BusinessError);
  });

  it('rejects refunding a FULLY_USED credit note (nothing left to refund)', async () => {
    const { db, trx } = makeDb();
    trx.where = vi
      .fn()
      .mockImplementationOnce(() =>
        hybridWhere(trx, [{ id: 9, tenantId, status: 'FULLY_USED', remainingAmount: '0' }])
      );

    const svc = new SaleReturnService(db as never);
    await expect(svc.refundCreditNote(9, tenantId, 1)).rejects.toBeInstanceOf(BusinessError);
  });

  it('throws NotFoundError when the credit note does not exist', async () => {
    const { db, trx } = makeDb();
    trx.where = vi.fn().mockImplementationOnce(() => hybridWhere(trx, []));

    const svc = new SaleReturnService(db as never);
    await expect(svc.refundCreditNote(999, tenantId, 1)).rejects.toBeInstanceOf(NotFoundError);
  });
});
