/**
 * PG-008 — projection rebuild jobs recompute each projection wholesale from its
 * source-of-truth tables and overwrite (not increment) the projection row.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('@erp/db', () => ({
  projectionStockLevel: {
    tenantId: 'tenant_id',
    itemId: 'item_id',
    warehouseId: 'warehouse_id',
    variantId: 'variant_id',
  },
  projectionCustomerBalance: { tenantId: 'tenant_id', customerId: 'customer_id' },
  projectionSupplierBalance: { tenantId: 'tenant_id', supplierId: 'supplier_id' },
  projectionDashboardDaily: { tenantId: 'tenant_id', branchId: 'branch_id', date: 'date' },
  projectionMetadata: { projectionName: 'projection_name' },
}));

vi.mock('drizzle-orm', () => ({
  sql: vi.fn((strings: unknown, ...values: unknown[]) => ({ strings, values })),
  eq: vi.fn((col: unknown, val: unknown) => ({ type: 'eq', col, val })),
}));

import {
  registerProjectionRebuildJobs,
  PROJECTION_QUEUE_NAMES,
} from '../jobs/projectionRebuildJobs.js';

type JobHandler = (job: unknown, tenantId?: number) => Promise<void>;

function buildFakeRegistry() {
  const handlers = new Map<string, JobHandler>();
  const configs = new Map<string, { manualOnly?: boolean; tenantScoped: boolean }>();
  return {
    handlers,
    configs,
    register: vi.fn(
      (
        name: string,
        config: { manualOnly?: boolean; tenantScoped: boolean },
        handler: JobHandler
      ) => {
        handlers.set(name, handler);
        configs.set(name, config);
      }
    ),
  };
}

function buildFakeDb(executeResults: unknown[]) {
  let executeIndex = 0;
  const insertValues: Array<Record<string, unknown>> = [];
  const onConflictSets: Array<Record<string, unknown>> = [];
  const updateSets: Array<Record<string, unknown>> = [];

  return {
    execute: vi.fn(() => Promise.resolve(executeResults[executeIndex++] ?? [])),
    insert: vi.fn(() => ({
      values: vi.fn((values: Record<string, unknown>) => {
        insertValues.push(values);
        return {
          onConflictDoUpdate: vi.fn(({ set }: { set: Record<string, unknown> }) => {
            onConflictSets.push(set);
            return Promise.resolve();
          }),
        };
      }),
    })),
    update: vi.fn(() => ({
      set: vi.fn((patch: Record<string, unknown>) => {
        updateSets.push(patch);
        return { where: vi.fn(() => Promise.resolve()) };
      }),
    })),
    insertValues,
    onConflictSets,
    updateSets,
  };
}

afterEach(() => {
  vi.clearAllMocks();
});

describe('registerProjectionRebuildJobs', () => {
  it('registers all four projections as manualOnly, tenantScoped jobs', () => {
    const registry = buildFakeRegistry();
    registerProjectionRebuildJobs(registry as never, {} as never);

    expect(registry.handlers.size).toBe(4);
    for (const queueName of Object.values(PROJECTION_QUEUE_NAMES)) {
      expect(registry.handlers.has(queueName)).toBe(true);
      const config = registry.configs.get(queueName)!;
      expect(config.manualOnly).toBe(true);
      expect(config.tenantScoped).toBe(true);
    }
  });

  it('skips the run entirely when triggered without a tenantId', async () => {
    const registry = buildFakeRegistry();
    const db = buildFakeDb([]);
    registerProjectionRebuildJobs(registry as never, db as never);

    const handler = registry.handlers.get(PROJECTION_QUEUE_NAMES['projection_stock_level']!)!;
    await handler({}, undefined);

    expect(db.execute).not.toHaveBeenCalled();
    expect(db.update).not.toHaveBeenCalled();
  });

  it('rebuilds projection_stock_level: availableQty is ledger sum minus active reservations, overwritten not incremented', async () => {
    const registry = buildFakeRegistry();
    const db = buildFakeDb([
      [{ item_id: 5, warehouse_id: 3, variant_id: null, ledger_sum: '100', reserved_sum: '20' }],
    ]);
    registerProjectionRebuildJobs(registry as never, db as never);

    const handler = registry.handlers.get(PROJECTION_QUEUE_NAMES['projection_stock_level']!)!;
    await handler({}, 1);

    expect(db.onConflictSets).toHaveLength(1);
    expect(db.onConflictSets[0]).toMatchObject({ availableQty: '80', reservedQty: '20' });
    expect(db.updateSets).toContainEqual(expect.objectContaining({ status: 'UP_TO_DATE' }));
  });

  it('rebuilds projection_customer_balance: currentBalance = invoiced - paid - returns, overwritten not incremented', async () => {
    const registry = buildFakeRegistry();
    // db.execute() returns raw postgres.js wire-format strings for timestamp columns, not
    // Date instances — using a string here (not `new Date(...)`) is what actually caught the
    // 2026-07-17 "value.toISOString is not a function" bug; a Date-object mock would have hidden it.
    const db = buildFakeDb([
      [
        {
          customer_id: 7,
          total_invoiced: '500',
          total_paid: '200',
          total_returned: '50',
          last_invoice_at: '2026-01-01 00:00:00+00',
          last_payment_at: '2026-01-02 00:00:00+00',
        },
      ],
    ]);
    registerProjectionRebuildJobs(registry as never, db as never);

    const handler = registry.handlers.get(PROJECTION_QUEUE_NAMES['projection_customer_balance']!)!;
    await handler({}, 1);

    expect(db.onConflictSets).toHaveLength(1);
    expect(db.onConflictSets[0]).toMatchObject({
      currentBalance: '250',
      totalInvoiced: '500',
      totalPaid: '200',
      overdueAmount: '0',
    });
    expect(db.onConflictSets[0]!['lastInvoiceAt']).toBeInstanceOf(Date);
    expect(db.onConflictSets[0]!['lastPaymentAt']).toBeInstanceOf(Date);
  });

  it('rebuilds projection_supplier_balance: currentBalance = purchased - paid - returns, overwritten not incremented', async () => {
    const registry = buildFakeRegistry();
    const db = buildFakeDb([
      [
        {
          supplier_id: 9,
          total_purchased: '1000',
          total_paid: '400',
          total_returned: '100',
          last_grn_at: '2026-01-01 00:00:00+00',
          last_payment_at: '2026-01-02 00:00:00+00',
        },
      ],
    ]);
    registerProjectionRebuildJobs(registry as never, db as never);

    const handler = registry.handlers.get(PROJECTION_QUEUE_NAMES['projection_supplier_balance']!)!;
    await handler({}, 1);

    expect(db.onConflictSets).toHaveLength(1);
    expect(db.onConflictSets[0]).toMatchObject({
      currentBalance: '500',
      totalPurchased: '1000',
      totalPaid: '400',
      totalReturns: '100',
      overdueAmount: '0',
    });
    expect(db.onConflictSets[0]!['lastGrnAt']).toBeInstanceOf(Date);
    expect(db.onConflictSets[0]!['lastPaymentAt']).toBeInstanceOf(Date);
  });

  it('rebuilds projection_dashboard_daily from invoices/payments/returns for the trailing window', async () => {
    const registry = buildFakeRegistry();
    const db = buildFakeDb([
      [
        {
          branch_id: 2,
          date_key: '2026-07-01 00:00:00+00',
          sales_count: '10',
          sales_amount: '5000',
          collected_amount: '3000',
          return_count: '2',
          return_amount: '150',
        },
      ],
    ]);
    registerProjectionRebuildJobs(registry as never, db as never);

    const handler = registry.handlers.get(PROJECTION_QUEUE_NAMES['projection_dashboard_daily']!)!;
    await handler({}, 1);

    expect(db.onConflictSets).toHaveLength(1);
    expect(db.onConflictSets[0]).toMatchObject({
      salesCount: 10,
      salesAmount: '5000',
      collectedAmount: '3000',
      returnCount: 2,
      returnAmount: '150',
    });
    expect(db.insertValues[0]!['date']).toBeInstanceOf(Date);
  });

  it('marks projectionMetadata ERROR with a message and rethrows on a forced recompute failure', async () => {
    const registry = buildFakeRegistry();
    const db = buildFakeDb([]);
    db.execute.mockRejectedValueOnce(new Error('connection terminated'));
    registerProjectionRebuildJobs(registry as never, db as never);

    const handler = registry.handlers.get(PROJECTION_QUEUE_NAMES['projection_stock_level']!)!;

    await expect(handler({}, 1)).rejects.toThrow('connection terminated');
    expect(db.updateSets).toContainEqual(
      expect.objectContaining({ status: 'ERROR', errorMessage: 'connection terminated' })
    );
  });
});
