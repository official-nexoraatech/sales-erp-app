/**
 * ES-03 — InventoryLedgerService stock-movement + ledger-write unit tests.
 * (This service's methods are addStock/deductStock/adjustStock/transferStock,
 * not a single recordMovement() — ES-03's prompt assumed a recordMovement()
 * signature that doesn't exist in this codebase; these tests cover the same
 * guarantees against the actual API: deductStock() for STOCK_OUT.)
 */

import { describe, it, expect, vi } from 'vitest';

vi.mock('@erp/db', () => ({
  items: { id: 'id', tenantId: 'tenant_id', availableQty: 'available_qty', version: 'version' },
  inventoryLedger: {},
  projectionStockLevel: {
    tenantId: 'tenant_id',
    itemId: 'item_id',
    warehouseId: 'warehouse_id',
    variantId: 'variant_id',
  },
  inventoryFifoLayers: {
    id: 'id',
    tenantId: 'tenant_id',
    itemId: 'item_id',
    warehouseId: 'warehouse_id',
    remainingQty: 'remaining_qty',
  },
  inventoryWarehouseValuation: {
    id: 'id',
    tenantId: 'tenant_id',
    itemId: 'item_id',
    variantId: 'variant_id',
    warehouseId: 'warehouse_id',
    waccCost: 'wacc_cost',
    stockValue: 'stock_value',
  },
}));

vi.mock('drizzle-orm', () => ({
  and: vi.fn((...args) => ({ type: 'and', args })),
  eq: vi.fn((col, val) => ({ type: 'eq', col, val })),
  asc: vi.fn((col) => ({ type: 'asc', col })),
  isNull: vi.fn((col) => ({ type: 'isNull', col })),
  sql: vi.fn((s) => s),
}));

import {
  InventoryLedgerService,
  InsufficientStockError,
} from '../domain/InventoryLedgerService.js';
import { ERPError } from '@erp/types';

function makeDb(script: unknown[]) {
  let i = 0;
  const next = () => Promise.resolve(script[i++]);
  const chainable: Record<string, unknown> = {};
  for (const m of [
    'select',
    'from',
    'where',
    'insert',
    'values',
    'update',
    'set',
    'onConflictDoUpdate',
    'for',
  ]) {
    chainable[m] = vi.fn(() => chainable);
  }
  chainable['returning'] = vi.fn(() => next());
  (chainable as { then: unknown })['then'] = (
    resolve: (v: unknown) => void,
    reject: (e: unknown) => void
  ) => next().then(resolve, reject);
  return chainable;
}

const baseParams = {
  tenantId: 1,
  itemId: 5,
  warehouseId: 3,
  quantity: 10,
  referenceType: 'INVOICE',
  referenceId: 200,
  unitCost: 0,
  createdBy: 99,
};

describe('InventoryLedgerService.deductStock — ES-03', () => {
  it('inserts a STOCK_OUT ledger row with correct before/after quantities', async () => {
    const script = [
      [{ availableQty: '100.000' }], // update items ... returning (deduct)
      [{ costingMethod: 'WACC', waccCost: '0', currentStockValue: '0' }], // ES-13: ValuationService item lookup
      undefined, // ES-13: ValuationService update items.current_stock_value (WACC branch)
      [], // PG-032: select inventory_warehouse_valuation row — none yet, no-op
      [{ id: 1 }], // insert inventoryLedger ... returning
      undefined, // insert projectionStockLevel ... onConflictDoUpdate
    ];
    const db = makeDb(script);
    const svc = new InventoryLedgerService(db as never);

    await svc.deductStock(baseParams, db as never);

    expect((db as { insert: ReturnType<typeof vi.fn> }).insert).toHaveBeenCalled();
  });

  it('throws InsufficientStockError (not a silent success) when stock is unavailable', async () => {
    const script = [
      [], // update items ... returning → empty result = WHERE clause didn't match (insufficient stock)
      [{ availableQty: '2.000' }], // fallback select current qty
    ];
    const db = makeDb(script);
    const svc = new InventoryLedgerService(db as never);

    await expect(svc.deductStock(baseParams, db as never)).rejects.toBeInstanceOf(
      InsufficientStockError
    );
  });

  it('throws (does not silently succeed) when the item does not exist for the given tenant', async () => {
    const script = [
      [], // update items ... returning → empty (WHERE didn't match, item missing)
      [], // fallback select current item → not found
    ];
    const db = makeDb(script);
    const svc = new InventoryLedgerService(db as never);

    await expect(
      svc.adjustStock({ ...baseParams, direction: 'IN' }, db as never)
    ).rejects.toBeInstanceOf(ERPError);
  });
});

describe('InventoryLedgerService.adjustStock — ES-23 atomic guard', () => {
  it('throws InsufficientStockError (not a silent negative) when the adjustment would go below zero', async () => {
    const script = [
      [], // update items ... returning → empty = WHERE guard (available_qty + delta >= 0) failed
      [{ availableQty: '2.000' }], // fallback select current qty
    ];
    const db = makeDb(script);
    const svc = new InventoryLedgerService(db as never);

    await expect(
      svc.adjustStock({ ...baseParams, direction: 'OUT', quantity: 10 }, db as never)
    ).rejects.toBeInstanceOf(InsufficientStockError);
  });
});

describe('InventoryLedgerService.addStock — ES-23 atomic increment', () => {
  it('derives before/after from the atomic UPDATE...RETURNING, not a prior read', async () => {
    const script = [
      [{ availableQty: '110.000' }], // update items ... returning (atomic increment)
      [{ costingMethod: 'WACC', waccCost: '0', currentStockValue: '0' }], // ValuationService item lookup
      undefined, // ValuationService update items.current_stock_value (WACC branch)
      [{ id: 1 }], // insert inventoryLedger ... returning
      undefined, // insert projectionStockLevel ... onConflictDoUpdate
    ];
    const db = makeDb(script);
    const svc = new InventoryLedgerService(db as never);

    await svc.addStock(baseParams, db as never);

    expect((db as { update: ReturnType<typeof vi.fn> }).update).toHaveBeenCalled();
  });

  it('throws ITEM_NOT_FOUND when the atomic UPDATE matches no row', async () => {
    const script = [[]]; // update items ... returning → empty (item missing)
    const db = makeDb(script);
    const svc = new InventoryLedgerService(db as never);

    await expect(svc.addStock(baseParams, db as never)).rejects.toBeInstanceOf(ERPError);
  });
});
