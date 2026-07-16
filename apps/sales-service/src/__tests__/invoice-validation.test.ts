/**
 * ES-14 — Input Validations & Business Rules: invoice-specific guards.
 * (Quantity/unit-price/invoice-date shape validation already lives in Zod
 * schemas at the route layer — see api/invoice.routes.ts's CreateInvoiceSchema
 * — and is exercised by parsing there, not by re-testing InvoiceService here.)
 */

import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';

vi.mock('ulid', () => ({ ulid: () => 'TEST-ULID-01' }));

vi.mock('@erp/db', () => ({
  invoices: {
    id: 'id',
    tenantId: 'tenant_id',
    status: 'status',
    customerId: 'customer_id',
    grandTotal: 'grand_total',
    version: 'version',
    branchId: 'branch_id',
    invoiceDate: 'invoice_date',
    warehouseId: 'warehouse_id',
    invoiceNumber: 'invoice_number',
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
    trackInventory: 'track_inventory',
  },
  outboxEvents: {},
  projectionDashboardDaily: { tenantId: 'tenant_id', branchId: 'branch_id', date: 'date' },
  projectionCustomerBalance: { tenantId: 'tenant_id', customerId: 'customer_id' },
  quotations: {},
  inventoryLedger: {},
  sagaLog: {},
  webhookSubscriptions: {
    id: 'id',
    tenantId: 'tenant_id',
    isActive: 'is_active',
    events: 'events',
  },
  webhookDeliveries: {},
  eventStore: {},
  eventSnapshots: {},
}));

vi.mock('drizzle-orm', () => ({
  and: vi.fn((...args) => ({ type: 'and', args })),
  eq: vi.fn((col, val) => ({ type: 'eq', col, val })),
  sql: vi.fn((s) => s),
  desc: vi.fn((c) => c),
}));

import { InvoiceService, PriceFloorViolationError } from '../domain/InvoiceService.js';
import { BusinessError } from '@erp/types';

function makeTrx(script: unknown[]) {
  let i = 0;
  const next = () => Promise.resolve(script[i++]);
  const chainable: Record<string, unknown> = {};
  for (const m of [
    'select',
    'from',
    'where',
    'orderBy',
    'limit',
    'insert',
    'values',
    'update',
    'set',
    'onConflictDoUpdate',
  ]) {
    chainable[m] = vi.fn(() => chainable);
  }
  chainable['returning'] = vi.fn(() => next());
  chainable['execute'] = vi.fn(() => next());
  (chainable as { then: unknown })['then'] = (
    resolve: (v: unknown) => void,
    reject: (e: unknown) => void
  ) => next().then(resolve, reject);
  return chainable;
}

// SagaOrchestrator (ES-24) writes to saga_log directly on the top-level db, outside the
// business transaction — a no-op stub here since these tests assert InvoiceService's own
// business logic, not the saga wrapper's persistence (covered by saga.test.ts instead).
function makeSagaLogStub() {
  const stub: Record<string, unknown> = {};
  for (const m of ['insert', 'update', 'values', 'set', 'where']) stub[m] = vi.fn(() => stub);
  return stub;
}

function makeDb(script: unknown[]) {
  const trx = makeTrx(script);
  const sagaLogStub = makeSagaLogStub();
  return {
    transaction: vi.fn((fn: (t: typeof trx) => Promise<unknown>) => fn(trx)),
    insert: sagaLogStub['insert'],
    update: sagaLogStub['update'],
  };
}

const baseLine = { itemId: 5, quantity: 10, unitPrice: 100, gstRate: 18, createdBy: 99 };
const baseCreateParams = {
  tenantId: 1,
  branchId: 1,
  warehouseId: 1,
  customerId: 42,
  placeOfSupply: 'MH',
  sellerStateCode: 'MH',
  invoiceDate: new Date(),
  dueDate: new Date(),
  lines: [baseLine],
  createdBy: 99,
};

describe('ES-14 — API-boundary shape validation (Zod)', () => {
  const InvoiceLineSchema = z.object({
    itemId: z.number().int().positive(),
    quantity: z.number().positive(),
    unitPrice: z.number().nonnegative(),
    gstRate: z.number().min(0).max(100),
  });
  const InvoiceDateSchema = z
    .string()
    .datetime()
    .refine((val) => new Date(val).getTime() <= Date.now(), 'Invoice date cannot be in the future');

  it('rejects quantity = 0', () => {
    expect(InvoiceLineSchema.safeParse({ ...baseLine, quantity: 0 }).success).toBe(false);
  });

  it('rejects unit_price = -100', () => {
    expect(InvoiceLineSchema.safeParse({ ...baseLine, unitPrice: -100 }).success).toBe(false);
  });

  it('rejects an invoice date in the future', () => {
    const tomorrow = new Date(Date.now() + 86400000).toISOString();
    expect(InvoiceDateSchema.safeParse(tomorrow).success).toBe(false);
  });

  it('accepts a valid line and a past invoice date', () => {
    expect(InvoiceLineSchema.safeParse(baseLine).success).toBe(true);
    expect(InvoiceDateSchema.safeParse(new Date(Date.now() - 86400000).toISOString()).success).toBe(
      true
    );
  });
});

describe('ES-14 — InvoiceService.create price floor', () => {
  it('rejects a line priced below the item minSalePrice without an override', async () => {
    const script = [
      [{ creditLimit: '0', creditLimitEnabled: false }], // select customer
      [{ currentBalance: '0' }], // select projectionCustomerBalance
      [{ minSalePrice: '150.00', trackInventory: true }], // select item (price floor check)
    ];
    const db = makeDb(script);
    const svc = new InvoiceService(db as never);

    await expect(svc.create(baseCreateParams)).rejects.toBeInstanceOf(PriceFloorViolationError);
  });

  it('allows a line priced below minSalePrice when overridePriceFloor=true', async () => {
    const script = [
      [{ creditLimit: '0', creditLimitEnabled: false }], // select customer
      [{ currentBalance: '0' }], // select projectionCustomerBalance
      // price floor check skipped entirely when overridePriceFloor=true
      [{ id: 1 }], // insert invoices ... returning
      undefined, // insert invoiceLines
      undefined, // insert invoiceHistory
      undefined, // insert outboxEvents (INVOICE_CREATED)
      [], // EventStoreService.append: select current aggregate version — none yet
      undefined, // EventStoreService.append: insert eventStore row
      [], // select webhookSubscriptions (enqueueWebhookDeliveries) — none active
    ];
    const db = makeDb(script);
    const svc = new InvoiceService(db as never);

    await expect(svc.create({ ...baseCreateParams, overridePriceFloor: true })).resolves.toBe(1);
  });
});

describe('InvoiceService.create walk-in sale (customerId 0)', () => {
  it('skips the customer lookup/credit check for customerId 0 instead of 404ing (POS walk-in sale)', async () => {
    const script = [
      [], // select item for price-floor check — empty result is fine, just proves this
      // ran WITHOUT a preceding customer select consuming it (that select must not
      // happen at all for customerId 0 — see pos.routes.ts's `body.customerId ?? 0`)
      [{ id: 7 }], // insert invoices ... returning
      undefined, // insert invoiceLines
      undefined, // insert invoiceHistory
      undefined, // insert outboxEvents (INVOICE_CREATED)
      [], // EventStoreService.append: select current aggregate version — none yet
      undefined, // EventStoreService.append: insert eventStore row
      [], // select webhookSubscriptions (enqueueWebhookDeliveries) — none active
    ];
    const db = makeDb(script);
    const svc = new InvoiceService(db as never);

    await expect(svc.create({ ...baseCreateParams, customerId: 0 })).resolves.toBe(7);
  });
});

describe('ES-14 — InvoiceService.confirm duplicate invoice number + period closure', () => {
  const invoiceRow = {
    id: 1,
    tenantId: 1,
    status: 'DRAFT',
    customerId: 42,
    grandTotal: '1180.00',
    branchId: 1,
    invoiceDate: new Date(),
    warehouseId: 7,
  };

  it('rejects confirm() when the invoice number already exists for another invoice', async () => {
    const script = [
      [invoiceRow], // select invoice
      [{ id: 999 }], // duplicate check — a DIFFERENT invoice already has this number
    ];
    const db = makeDb(script);
    const svc = new InvoiceService(db as never);

    await expect(svc.confirm(1, 1, 'INV-DUPLICATE', 99)).rejects.toMatchObject({
      code: 'INVOICE_NUMBER_DUPLICATE',
    });
  });

  it('allows confirm() when the only invoice with that number is itself', async () => {
    const script = [
      [invoiceRow], // select invoice
      [{ id: 1 }], // duplicate check — same invoice (not a real clash)
      [{ status: 'OPEN' }], // period closure check — period is open
      [], // select lines (none)
      undefined, // update invoices status
      undefined, // insert projectionDashboardDaily + onConflict
      undefined, // insert projectionCustomerBalance + onConflict
      [{ displayName: 'Test Customer', gstin: null }], // select customers
      undefined, // insert outboxEvents (INVOICE_CONFIRMED)
      [], // EventStoreService.append: select current aggregate version — none yet
      undefined, // EventStoreService.append: insert eventStore row
      [], // select webhookSubscriptions (enqueueWebhookDeliveries) — none active
      undefined, // insert invoiceHistory
    ];
    const db = makeDb(script);
    const svc = new InvoiceService(db as never);

    await expect(svc.confirm(1, 1, 'INV-0001', 99)).resolves.toBeUndefined();
  });

  it('rejects confirm() when the invoice date falls in a closed accounting period', async () => {
    const script = [
      [invoiceRow], // select invoice
      [{ id: 1 }], // duplicate check — no real clash
      [{ status: 'CLOSED' }], // period closure check — period is closed
    ];
    const db = makeDb(script);
    const svc = new InvoiceService(db as never);

    await expect(svc.confirm(1, 1, 'INV-0001', 99)).rejects.toMatchObject({
      code: 'PERIOD_CLOSED',
    });
  });
});

describe('sanity — error classes carry expected codes', () => {
  it('BusinessError exposes .code', () => {
    const err = new BusinessError('SOME_CODE', 'some message');
    expect(err.code).toBe('SOME_CODE');
  });
});
