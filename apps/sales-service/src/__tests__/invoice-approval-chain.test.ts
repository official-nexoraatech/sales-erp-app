/**
 * Enterprise approval chain: WorkflowEngine's seeded "Sale Invoice — High Value Approval"
 * system definition is now actually triggered by InvoiceService.create() and enforced by
 * InvoiceService.confirm() — previously seeded at tenant provisioning but never wired to
 * anything (see plan addendum on the WorkflowEngine discovery).
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
    definitionId: 'definition_id',
    entityType: 'entity_type',
    entityId: 'entity_id',
    status: 'status',
    currentNodeId: 'current_node_id',
    correlationId: 'correlation_id',
    triggeredByUserId: 'triggered_by_user_id',
    triggerPayload: 'trigger_payload',
    expiresAt: 'expires_at',
    createdAt: 'created_at',
  },
  workflowApprovals: {},
  roles: { id: 'id', tenantId: 'tenant_id', name: 'name' },
  userRoles: { userId: 'user_id', roleId: 'role_id', tenantId: 'tenant_id' },
  users: { id: 'id', isActive: 'is_active' },
}));

vi.mock('drizzle-orm', () => ({
  and: vi.fn((...args) => ({ type: 'and', args })),
  eq: vi.fn((col, val) => ({ type: 'eq', col, val })),
  sql: vi.fn((s) => s),
  desc: vi.fn((c) => c),
  inArray: vi.fn((col, vals) => ({ type: 'inArray', col, vals })),
}));

import { InvoiceService } from '../domain/InvoiceService.js';

function makeTrx(script: unknown[]) {
  let i = 0;
  const next = () => Promise.resolve(script[i++]);
  const chainable: Record<string, unknown> = {};
  for (const m of [
    'select',
    'from',
    'innerJoin',
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

const baseLine = { itemId: 5, quantity: 1, unitPrice: 60000, gstRate: 18 };
const baseCreateParams = {
  tenantId: 1,
  branchId: 1,
  warehouseId: 1,
  customerId: 0, // walk-in — skips customer/credit-limit lookups, keeps the script focused
  placeOfSupply: 'MH',
  sellerStateCode: 'MH',
  invoiceDate: new Date(),
  dueDate: new Date(),
  lines: [baseLine],
  createdBy: 99,
};

describe('InvoiceService.create — WorkflowEngine trigger for high-value invoices', () => {
  it('creates a PENDING workflow instance when an active "Sale Invoice — High Value Approval" definition matches', async () => {
    const script = [
      [], // select item for price-floor check — none (skip)
      [{ id: 1 }], // insert invoices ... returning
      undefined, // insert invoiceLines
      undefined, // insert invoiceHistory
      // WorkflowEngine.trigger():
      [
        {
          id: 10,
          triggerEvent: 'INVOICE_CREATE',
          conditionExpr: { field: 'grandTotal', operator: 'GT', value: 50000 },
          nodes: [
            {
              id: 'node_1',
              name: 'Sales Manager Approval',
              type: 'APPROVAL',
              approverType: 'ROLE',
              approverRef: 'SALES_MANAGER',
            },
          ],
          timeoutHours: 24,
        },
      ], // select workflowDefinitions — one active match
      [{ id: 500 }], // insert workflowInstances ... returning
      [{ id: 20 }], // select roles (SALES_MANAGER)
      [{ userId: 7 }], // select userRoles join users (eligible approvers)
      undefined, // insert workflowApprovals (one row for userId 7)
      undefined, // insert outboxEvents (INVOICE_CREATED)
      [], // EventStoreService.append: select current aggregate version
      undefined, // EventStoreService.append: insert eventStore row
      [], // select webhookSubscriptions — none active
    ];
    const db = makeDb(script);
    const svc = new InvoiceService(db as never);

    await expect(svc.create(baseCreateParams)).resolves.toBe(1);
  });

  it('does not create a workflow instance when no active definition matches the trigger event (unchanged behavior)', async () => {
    const script = [
      [], // select item for price-floor check
      [{ id: 2 }], // insert invoices ... returning
      undefined, // insert invoiceLines
      undefined, // insert invoiceHistory
      [], // WorkflowEngine.trigger(): select workflowDefinitions — no match, no-op
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

describe('InvoiceService.confirm — blocked by a pending/rejected approval instance', () => {
  const invoiceRow = {
    id: 1,
    tenantId: 1,
    status: 'DRAFT',
    customerId: 0,
    grandTotal: '60000.00',
    branchId: 1,
    invoiceDate: new Date(),
    warehouseId: 7,
  };

  it('rejects confirm() with APPROVAL_PENDING while the triggered instance is still PENDING', async () => {
    const script = [
      [invoiceRow], // select invoice
      [{ status: 'PENDING' }], // WorkflowEngine approval-gate: blocking instance found
    ];
    const db = makeDb(script);
    const svc = new InvoiceService(db as never);

    await expect(svc.confirm(1, 1, 99)).rejects.toMatchObject({ code: 'APPROVAL_PENDING' });
  });

  it('rejects confirm() with APPROVAL_REJECTED when the instance was rejected during approval', async () => {
    const script = [
      [invoiceRow], // select invoice
      [{ status: 'REJECTED' }], // WorkflowEngine approval-gate: rejected instance found
    ];
    const db = makeDb(script);
    const svc = new InvoiceService(db as never);

    await expect(svc.confirm(1, 1, 99)).rejects.toMatchObject({ code: 'APPROVAL_REJECTED' });
  });

  it('allows confirm() to proceed once the instance is APPROVED (not PENDING/REJECTED, so out of scope for the block query)', async () => {
    const numberSeriesScript = [
      [{ currentSeq: 0, formatTemplate: 'INV/{FY-SHORT}/{SEQ:5}' }],
      [{ currentSeq: 1, formatTemplate: 'INV/{FY-SHORT}/{SEQ:5}' }],
    ];
    const script = [
      [invoiceRow], // select invoice
      [], // WorkflowEngine approval-gate: no PENDING/REJECTED row — the instance is APPROVED,
      // which inArray(['PENDING','REJECTED']) correctly excludes
      ...numberSeriesScript,
      [{ status: 'OPEN' }], // period closure check
      [], // select lines (none)
      undefined, // update invoices status
      undefined, // insert projectionDashboardDaily + onConflict
      undefined, // insert projectionCustomerBalance + onConflict
      [{ displayName: 'Walk-in', gstin: null }], // select customers
      undefined, // insert outboxEvents (INVOICE_CONFIRMED)
      [], // EventStoreService.append: select current aggregate version
      undefined, // EventStoreService.append: insert eventStore row
      [], // select webhookSubscriptions — none active
      undefined, // insert invoiceHistory
    ];
    const db = makeDb(script);
    const svc = new InvoiceService(db as never);

    await expect(svc.confirm(1, 1, 99)).resolves.toMatch(/^INV\/\d{2}-\d{2}\/00001$/);
  });
});
