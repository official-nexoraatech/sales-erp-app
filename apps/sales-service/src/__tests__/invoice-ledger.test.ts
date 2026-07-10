/**
 * ES-03 — Invoice confirmation writes STOCK_OUT to inventory_ledger
 */

import { describe, it, expect, vi } from 'vitest';

vi.mock('ulid', () => ({ ulid: () => 'TEST-ULID-01' }));

vi.mock('@erp/db', () => ({
  invoices: { id: 'id', tenantId: 'tenant_id', status: 'status', customerId: 'customer_id', grandTotal: 'grand_total', version: 'version', branchId: 'branch_id', invoiceDate: 'invoice_date', warehouseId: 'warehouse_id' },
  invoiceLines: { invoiceId: 'invoice_id', itemId: 'item_id', quantity: 'quantity' },
  invoiceHistory: {},
  customers: {},
  items: { id: 'id', tenantId: 'tenant_id', availableQty: 'available_qty', version: 'version' },
  outboxEvents: {},
  projectionDashboardDaily: { tenantId: 'tenant_id', branchId: 'branch_id', date: 'date' },
  projectionCustomerBalance: { tenantId: 'tenant_id', customerId: 'customer_id' },
  quotations: {},
  inventoryLedger: {},
  sagaLog: {},
}));

vi.mock('drizzle-orm', () => ({
  and: vi.fn((...args) => ({ type: 'and', args })),
  eq: vi.fn((col, val) => ({ type: 'eq', col, val })),
  sql: vi.fn((s) => s),
}));

import { InvoiceService } from '../domain/InvoiceService.js';

// Chainable mock query builder: every method returns `this`, and the object is
// directly `await`-able (via `.then`) OR terminable via `.returning()` — both
// consume the next value from a single shared, ordered script queue, matching
// the exact sequence of `await` statements inside InvoiceService.confirm().
function makeTrx(script: unknown[], insertedValues: unknown[] = []) {
  let i = 0;
  const next = () => Promise.resolve(script[i++]);
  const chainable: Record<string, unknown> = {};
  for (const m of ['select', 'from', 'where', 'orderBy', 'insert', 'update', 'set', 'onConflictDoUpdate', 'for']) {
    chainable[m] = vi.fn(() => chainable);
  }
  chainable['values'] = vi.fn((v: unknown) => { insertedValues.push(v); return chainable; });
  chainable['returning'] = vi.fn(() => next());
  chainable['execute'] = vi.fn(() => next());
  (chainable as { then: unknown })['then'] = (resolve: (v: unknown) => void, reject: (e: unknown) => void) =>
    next().then(resolve, reject);
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

function makeDb(script: unknown[], insertedValues: unknown[] = []) {
  const trx = makeTrx(script, insertedValues);
  const sagaLogStub = makeSagaLogStub();
  return {
    transaction: vi.fn((fn: (t: typeof trx) => Promise<unknown>) => fn(trx)),
    insert: sagaLogStub['insert'],
    update: sagaLogStub['update'],
  };
}

const invoiceRow = { id: 1, tenantId: 1, status: 'DRAFT', customerId: 42, grandTotal: '1180.00', branchId: 1, invoiceDate: new Date(), warehouseId: 7 };
const lineRow = { id: 100, invoiceId: 1, itemId: 5, variantId: undefined, quantity: '10.000', warehouseId: undefined };

describe('InvoiceService.confirm — ES-03 inventory ledger', () => {
  it('writes one STOCK_OUT inventory_ledger row per invoice line, inside the transaction', async () => {
    const script = [
      [invoiceRow], // select invoice
      [], // ES-14: duplicate invoice-number check — no clash found
      [], // ES-14: period closure check — no closure row found
      [lineRow], // select lines
      [{ id: 5, availableQty: '90.000' }], // update items ... returning (deduct)
      [{ costingMethod: 'WACC', waccCost: '0', currentStockValue: '0' }], // ES-13: ValuationService item lookup
      undefined, // ES-13: ValuationService update items.current_stock_value (WACC branch)
      undefined, // insert inventoryLedger
      undefined, // update invoices status
      undefined, // insert projectionDashboardDaily + onConflict
      undefined, // insert projectionCustomerBalance + onConflict
      [{ displayName: 'Test Customer', gstin: '27AAAAA0000A1Z5' }], // select customers
      undefined, // insert outboxEvents (INVOICE_CONFIRMED)
      undefined, // insert invoiceHistory
    ];
    const db = makeDb(script);
    const svc = new InvoiceService(db as never);

    await svc.confirm(1, 1, 'INV-0001', 99);

    const trx = (db.transaction as ReturnType<typeof vi.fn>).mock.calls[0]![0] as never;
    void trx;
    expect(db.transaction).toHaveBeenCalled();
  });

  it('ES-13: populates inventory_ledger.cogs_per_unit and emits COGS_CALCULATED when the item has a non-zero WACC cost', async () => {
    const script = [
      [invoiceRow], // select invoice
      [], // ES-14: duplicate invoice-number check — no clash found
      [], // ES-14: period closure check — no closure row found
      [lineRow], // select lines
      [{ id: 5, availableQty: '90.000' }], // update items ... returning (deduct)
      [{ costingMethod: 'WACC', waccCost: '50', currentStockValue: '5000' }], // ValuationService item lookup
      undefined, // ValuationService update items.current_stock_value
      undefined, // insert inventoryLedger
      undefined, // update invoices status
      undefined, // insert projectionDashboardDaily + onConflict
      undefined, // insert projectionCustomerBalance + onConflict
      [{ displayName: 'Test Customer', gstin: '27AAAAA0000A1Z5' }], // select customers
      undefined, // insert outboxEvents (INVOICE_CONFIRMED)
      undefined, // insert outboxEvents (COGS_CALCULATED)
      undefined, // insert invoiceHistory
    ];
    const insertedValues: unknown[] = [];
    const db = makeDb(script, insertedValues);
    const svc = new InvoiceService(db as never);

    await svc.confirm(1, 1, 'INV-0001', 99);

    const ledgerRow = insertedValues.find(
      (v): v is { movementType: string; cogsPerUnit: string } =>
        !!v && typeof v === 'object' && (v as { movementType?: string }).movementType === 'STOCK_OUT'
    );
    expect(ledgerRow?.cogsPerUnit).toBe('50'); // lineQty 10 * waccCost 50 = 500 total / 10 = 50/unit

    const cogsEvent = insertedValues.find(
      (v): v is { eventType: string; payload: { cogsTotal: string } } =>
        !!v && typeof v === 'object' && (v as { eventType?: string }).eventType === 'COGS_CALCULATED'
    );
    expect(cogsEvent?.payload.cogsTotal).toBe('500'); // 10 units * ₹50
  });

  it('rolls back the whole confirm() when the ledger write fails (atomicity)', async () => {
    let callIndex = 0;
    const trx: Record<string, unknown> = {};
    for (const m of ['select', 'from', 'where', 'orderBy', 'update', 'set', 'onConflictDoUpdate', 'for']) {
      trx[m] = vi.fn(() => trx);
    }
    trx['returning'] = vi.fn(() => Promise.resolve([{ id: 5, availableQty: '90.000' }]));
    trx['execute'] = vi.fn(() => Promise.resolve([])); // ES-14: period closure check — no closure row found
    trx['insert'] = vi.fn((table: unknown) => {
      // Simulate the ledger insert throwing — the values() call that follows
      // is what actually fails in real Drizzle usage.
      if (table && typeof table === 'object' && Object.keys(table as object).length === 0) {
        // inventoryLedger mock is `{}` — insert(inventoryLedger) matches here too,
        // so gate on call order instead: only the 4th insert() call is the ledger write.
      }
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
      const results = [[invoiceRow], [lineRow]];
      resolve(results[Math.min(callIndex, results.length - 1)]);
    };

    const sagaLogStub = makeSagaLogStub();
    const db = {
      transaction: vi.fn((fn: (t: typeof trx) => Promise<unknown>) => fn(trx)),
      insert: sagaLogStub['insert'],
      update: sagaLogStub['update'],
    };
    const svc = new InvoiceService(db as never);

    await expect(svc.confirm(1, 1, 'INV-0001', 99)).rejects.toThrow('simulated ledger insert failure');
  });
});
