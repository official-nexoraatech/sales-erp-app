/**
 * OFFLINE-02 — Offline Sync Idempotency & Retry Hardening.
 * InvoiceService.create() must translate a unique-constraint conflict on
 * (tenantId, clientOperationId) into DuplicateOperationError instead of letting the raw
 * Postgres 23505 surface as an opaque 500 — this is what lets pos.routes.ts recognize a
 * retried offline-sale sync and return the original result instead of creating a duplicate.
 */

import { describe, it, expect, vi } from 'vitest';

vi.mock('ulid', () => ({ ulid: () => 'TEST-ULID-01' }));

vi.mock('@erp/db', () => ({
  invoices: { id: 'id', tenantId: 'tenant_id', status: 'status', customerId: 'customer_id', grandTotal: 'grand_total', version: 'version', branchId: 'branch_id', invoiceDate: 'invoice_date', warehouseId: 'warehouse_id', invoiceNumber: 'invoice_number', clientOperationId: 'client_operation_id' },
  invoiceLines: { invoiceId: 'invoice_id', itemId: 'item_id', quantity: 'quantity' },
  invoiceHistory: {},
  customers: { id: 'id', tenantId: 'tenant_id', creditLimit: 'credit_limit', creditLimitEnabled: 'credit_limit_enabled' },
  items: { id: 'id', tenantId: 'tenant_id', availableQty: 'available_qty', version: 'version', minSalePrice: 'min_sale_price', trackInventory: 'track_inventory' },
  outboxEvents: {},
  projectionDashboardDaily: { tenantId: 'tenant_id', branchId: 'branch_id', date: 'date' },
  projectionCustomerBalance: { tenantId: 'tenant_id', customerId: 'customer_id' },
  quotations: {},
  deliveryChallans: {},
  inventoryLedger: {},
  sagaLog: {},
}));

vi.mock('drizzle-orm', () => ({
  and: vi.fn((...args) => ({ type: 'and', args })),
  eq: vi.fn((col, val) => ({ type: 'eq', col, val })),
  sql: vi.fn((s) => s),
}));

import { InvoiceService, DuplicateOperationError, PriceFloorViolationError } from '../domain/InvoiceService.js';

// A unique-violation error shaped like what the `postgres` driver throws for a
// unique_violation (matches isUniqueViolation's expectations in InvoiceService.ts).
function uniqueViolation(constraintName: string) {
  return Object.assign(new Error('duplicate key value violates unique constraint'), {
    code: '23505',
    constraint_name: constraintName,
  });
}

/** Same scripted-response harness as invoice-validation.test.ts, extended so a script
 * entry can be a rejection (`{ __reject: err }`) to simulate the insert's own
 * `.returning()` throwing a unique-constraint violation. */
function makeTrx(script: unknown[]) {
  let i = 0;
  const next = () => {
    const entry = script[i++];
    if (entry && typeof entry === 'object' && '__reject' in (entry as Record<string, unknown>)) {
      return Promise.reject((entry as { __reject: unknown }).__reject);
    }
    return Promise.resolve(entry);
  };
  const chainable: Record<string, unknown> = {};
  for (const m of ['select', 'from', 'where', 'orderBy', 'insert', 'values', 'update', 'set', 'onConflictDoUpdate']) {
    chainable[m] = vi.fn(() => chainable);
  }
  chainable['returning'] = vi.fn(() => next());
  chainable['execute'] = vi.fn(() => next());
  (chainable as { then: unknown })['then'] = (resolve: (v: unknown) => void, reject: (e: unknown) => void) =>
    next().then(resolve, reject);
  return chainable;
}

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

const baseCreateParams = {
  tenantId: 1,
  branchId: 1,
  warehouseId: 1,
  customerId: 42,
  placeOfSupply: 'MH',
  sellerStateCode: 'MH',
  invoiceDate: new Date(),
  dueDate: new Date(),
  lines: [{ itemId: 5, quantity: 10, unitPrice: 200, gstRate: 18 }],
  createdBy: 99,
  overridePriceFloor: true,
};

describe('OFFLINE-02 — InvoiceService.create() idempotency-key dedup', () => {
  it('translates a unique-violation on invoices_tenant_client_operation_id into DuplicateOperationError', async () => {
    const script = [
      [{ creditLimit: '0', creditLimitEnabled: false }], // select customer
      [{ currentBalance: '0' }], // select projectionCustomerBalance
      // price floor check skipped (overridePriceFloor: true)
      { __reject: uniqueViolation('invoices_tenant_client_operation_id') }, // insert invoices ... returning
    ];
    const db = makeDb(script);
    const svc = new InvoiceService(db as never);

    const err = await svc.create({ ...baseCreateParams, clientOperationId: 'op-123' }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(DuplicateOperationError);
    expect((err as DuplicateOperationError).operationId).toBe('op-123');
    expect((err as DuplicateOperationError).statusCode).toBe(409);
  });

  it('does not swallow a unique-violation on an unrelated constraint', async () => {
    const script = [
      [{ creditLimit: '0', creditLimitEnabled: false }],
      [{ currentBalance: '0' }],
      { __reject: uniqueViolation('some_other_constraint') },
    ];
    const db = makeDb(script);
    const svc = new InvoiceService(db as never);

    const err = await svc.create({ ...baseCreateParams, clientOperationId: 'op-123' }).catch((e: unknown) => e);
    expect(err).not.toBeInstanceOf(DuplicateOperationError);
  });

  it('does not swallow a non-conflict error', async () => {
    const script = [
      [{ creditLimit: '0', creditLimitEnabled: false }],
      [{ currentBalance: '0' }],
      { __reject: new Error('connection lost') },
    ];
    const db = makeDb(script);
    const svc = new InvoiceService(db as never);

    await expect(svc.create({ ...baseCreateParams, clientOperationId: 'op-123' })).rejects.toThrow('connection lost');
  });

  it('writes clientOperationId into the invoice insert when provided', async () => {
    const script = [
      [{ creditLimit: '0', creditLimitEnabled: false }],
      [{ currentBalance: '0' }],
      [{ id: 1 }], // insert invoices ... returning
      undefined, // insert invoiceLines
      undefined, // insert invoiceHistory
    ];
    const db = makeDb(script);
    const svc = new InvoiceService(db as never);

    await expect(svc.create({ ...baseCreateParams, clientOperationId: 'op-abc' })).resolves.toBe(1);
  });

  it('two different operationIds each succeed independently (no cross-request interference)', async () => {
    const scriptA = [
      [{ creditLimit: '0', creditLimitEnabled: false }],
      [{ currentBalance: '0' }],
      [{ id: 10 }],
      undefined,
      undefined,
    ];
    const scriptB = [
      [{ creditLimit: '0', creditLimitEnabled: false }],
      [{ currentBalance: '0' }],
      [{ id: 11 }],
      undefined,
      undefined,
    ];
    const svcA = new InvoiceService(makeDb(scriptA) as never);
    const svcB = new InvoiceService(makeDb(scriptB) as never);

    const [idA, idB] = await Promise.all([
      svcA.create({ ...baseCreateParams, clientOperationId: 'op-A' }),
      svcB.create({ ...baseCreateParams, clientOperationId: 'op-B' }),
    ]);
    expect(idA).toBe(10);
    expect(idB).toBe(11);
  });

  it('still rejects a price-floor violation when no clientOperationId is supplied (backward compatible)', async () => {
    const script = [
      [{ creditLimit: '0', creditLimitEnabled: false }],
      [{ currentBalance: '0' }],
      [{ minSalePrice: '500.00', trackInventory: true }], // price floor check runs (no override)
    ];
    const db = makeDb(script);
    const svc = new InvoiceService(db as never);

    await expect(
      svc.create({ ...baseCreateParams, overridePriceFloor: false })
    ).rejects.toBeInstanceOf(PriceFloorViolationError);
  });
});
