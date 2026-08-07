/**
 * Business Rules Engine wiring: InvoiceService.create()'s credit-limit decision now runs
 * through RuleEngine.evaluate() (SALE/SALE_CREATE) instead of a hardcoded conditional — a
 * tenant can deactivate/edit the seeded "Block sale above credit limit" system rule via the
 * Rules UI/API without a code change. isOverCreditLimit is still computed here (not by the
 * generic condition evaluator, which can't compare two data fields against each other).
 */

import { describe, it, expect, vi } from 'vitest';

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
  numberSeriesConfig: {
    tenantId: 'tenant_id',
    seriesType: 'series_type',
    financialYear: 'financial_year',
    currentSeq: 'current_seq',
  },
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
  sql: vi.fn((s) => s),
  desc: vi.fn((c) => c),
  inArray: vi.fn((col, vals) => ({ type: 'inArray', col, vals })),
}));

import { InvoiceService, CreditLimitExceededError } from '../domain/InvoiceService.js';

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
    'onConflictDoNothing',
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

const seededBlockRule = {
  id: 1,
  name: 'Block sale above credit limit',
  entityType: 'SALE',
  eventType: 'SALE_CREATE',
  conditionOperator: 'AND',
  conditions: [{ field: 'isOverCreditLimit', operator: 'EQUALS', value: true }],
  actions: [{ type: 'BLOCK', message: 'Customer has exceeded credit limit.' }],
  priority: 1,
  isActive: true,
};

const baseCreateParams = {
  tenantId: 1,
  branchId: 1,
  warehouseId: 1,
  customerId: 42,
  placeOfSupply: 'MH',
  sellerStateCode: 'MH',
  invoiceDate: new Date(),
  dueDate: new Date(),
  lines: [{ itemId: 5, quantity: 1, unitPrice: 6000, gstRate: 18 }], // grandTotal 7080, under the 50000 approval threshold
  createdBy: 99,
  overridePriceFloor: true,
};

describe('InvoiceService.create — credit limit via RuleEngine', () => {
  it('blocks when over limit and the seeded system rule is active', async () => {
    const script = [
      [{ creditLimit: '5000', creditLimitEnabled: true }], // select customer
      [{ currentBalance: '4000.00' }], // select projectionCustomerBalance
      [seededBlockRule], // RuleEngine.evaluate(): select businessRules — active match
    ];
    const db = makeDb(script);
    const svc = new InvoiceService(db as never);

    await expect(svc.create(baseCreateParams)).rejects.toBeInstanceOf(CreditLimitExceededError);
  });

  it('does NOT block when over limit but the tenant has deactivated the system rule', async () => {
    const script = [
      [{ creditLimit: '5000', creditLimitEnabled: true }], // select customer
      [{ currentBalance: '4000.00' }], // select projectionCustomerBalance
      [], // RuleEngine.evaluate(): select businessRules WHERE isActive=true — none (deactivated)
      // price floor check skipped entirely (overridePriceFloor: true) — no script entry consumed
      [{ id: 1 }], // insert invoices ... returning
      undefined, // insert invoiceLines
      undefined, // insert invoiceHistory
      [], // WorkflowEngine.trigger(): select workflowDefinitions — grandTotal under threshold, no-op
      undefined, // insert outboxEvents (INVOICE_CREATED)
      [], // EventStoreService.append: select current aggregate version
      undefined, // EventStoreService.append: insert eventStore row
      [], // select webhookSubscriptions — none active
    ];
    const db = makeDb(script);
    const svc = new InvoiceService(db as never);

    await expect(svc.create(baseCreateParams)).resolves.toBe(1);
  });

  it('does not evaluate any rule when the customer has credit-limit checking disabled (unchanged behavior)', async () => {
    const script = [
      [{ creditLimit: '5000', creditLimitEnabled: false }], // select customer — disabled
      [{ currentBalance: '9999999.00' }], // select projectionCustomerBalance — would be way over if checked
      // no businessRules select — the `if (customer.creditLimitEnabled && ...)` guard short-circuits
      [{ id: 2 }], // insert invoices ... returning
      undefined, // insert invoiceLines
      undefined, // insert invoiceHistory
      [], // WorkflowEngine.trigger(): no match, no-op
      undefined, // insert outboxEvents (INVOICE_CREATED)
      [], // EventStoreService.append: select current aggregate version
      undefined, // EventStoreService.append: insert eventStore row
      [], // select webhookSubscriptions — none active
    ];
    const db = makeDb(script);
    const svc = new InvoiceService(db as never);

    await expect(svc.create(baseCreateParams)).resolves.toBe(2);
  });
});
