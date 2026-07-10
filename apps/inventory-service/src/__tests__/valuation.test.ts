/**
 * ES-13 — FIFO / WACC costing unit tests (ValuationService).
 */

import { describe, it, expect, vi } from 'vitest';

vi.mock('@erp/db', () => ({
  items: { id: 'id', tenantId: 'tenant_id', costingMethod: 'costing_method', waccCost: 'wacc_cost', currentStockValue: 'current_stock_value' },
  inventoryFifoLayers: { id: 'id', tenantId: 'tenant_id', itemId: 'item_id', warehouseId: 'warehouse_id', remainingQty: 'remaining_qty' },
}));

vi.mock('drizzle-orm', () => ({
  and: vi.fn((...args) => ({ type: 'and', args })),
  eq: vi.fn((col, val) => ({ type: 'eq', col, val })),
  asc: vi.fn((col) => ({ type: 'asc', col })),
  sql: vi.fn((strings: TemplateStringsArray, ...vals: unknown[]) => ({ type: 'sql', strings, vals })),
}));

import { ValuationService } from '../domain/ValuationService.js';
import { StockInsufficientForCostingError } from '@erp/types';

function makeDb(script: unknown[]) {
  let i = 0;
  const next = () => Promise.resolve(script[i++]);
  const setCalls: unknown[] = [];
  const insertValueCalls: unknown[] = [];
  const chainable: Record<string, unknown> = {};
  for (const m of ['select', 'from', 'where', 'update', 'insert', 'orderBy', 'for']) {
    chainable[m] = vi.fn(() => chainable);
  }
  chainable['set'] = vi.fn((v: unknown) => { setCalls.push(v); return chainable; });
  chainable['values'] = vi.fn((v: unknown) => { insertValueCalls.push(v); return chainable; });
  (chainable as { then: unknown })['then'] = (resolve: (v: unknown) => void, reject: (e: unknown) => void) =>
    next().then(resolve, reject);
  return { db: chainable as never, setCalls, insertValueCalls };
}

describe('ValuationService — WACC', () => {
  it('receive 100u @ ₹50 → WACC = ₹50; receive 100 more @ ₹60 → WACC = ₹55', async () => {
    const first = makeDb([
      [{ costingMethod: 'WACC', currentStockValue: '0' }], // select item
      undefined, // update items
    ]);
    await ValuationService.applyStockIn(first.db, {
      tenantId: 1, itemId: 5, warehouseId: 1, quantity: 100, unitCost: 50,
      qtyBeforeStockIn: 0, sourceLedgerId: 1,
    });
    expect(first.setCalls[0]).toMatchObject({ waccCost: '50', currentStockValue: '5000' });

    const second = makeDb([
      [{ costingMethod: 'WACC', currentStockValue: '5000' }], // select item (after first receipt)
      undefined, // update items
    ]);
    await ValuationService.applyStockIn(second.db, {
      tenantId: 1, itemId: 5, warehouseId: 1, quantity: 100, unitCost: 60,
      qtyBeforeStockIn: 100, sourceLedgerId: 2,
    });
    expect(second.setCalls[0]).toMatchObject({ waccCost: '55', currentStockValue: '11000' });
  });

  it('STOCK_OUT uses the item wacc_cost as the per-unit COGS', async () => {
    const { db, setCalls } = makeDb([
      [{ costingMethod: 'WACC', waccCost: '55', currentStockValue: '11000' }], // select item
      undefined, // update items.current_stock_value
    ]);
    const cogs = await ValuationService.consumeForStockOut(db, { tenantId: 1, itemId: 5, warehouseId: 1, quantity: 50 });
    expect(cogs).toBe(2750); // 50 * 55
    expect(setCalls[0]).toMatchObject({ currentStockValue: '8250' }); // 11000 - 2750
  });
});

describe('ValuationService — FIFO', () => {
  it('creates a cost layer with the received quantity and unit cost on STOCK_IN', async () => {
    const { db, insertValueCalls } = makeDb([
      [{ costingMethod: 'FIFO', currentStockValue: '0' }], // select item
      undefined, // update items (WACC bookkeeping also runs for FIFO items)
      undefined, // insert inventory_fifo_layers
    ]);
    await ValuationService.applyStockIn(db, {
      tenantId: 1, itemId: 7, warehouseId: 1, quantity: 100, unitCost: 50,
      qtyBeforeStockIn: 0, sourceLedgerId: 10,
    });
    expect(insertValueCalls[0]).toMatchObject({ originalQty: '100', remainingQty: '100', unitCost: '50', sourceLedgerId: 10 });
  });

  it('sells 150u from layers A(100u@₹50) + B(100u@₹60) → COGS = ₹8000, layer B left with 50u@₹60', async () => {
    const layers = [
      { id: 1, remainingQty: '100.000', unitCost: '50.00' },
      { id: 2, remainingQty: '100.000', unitCost: '60.00' },
    ];
    const { db, setCalls } = makeDb([
      [{ costingMethod: 'FIFO', waccCost: '55', currentStockValue: '11000' }], // select item
      layers, // select layers ordered by received_at asc
      undefined, // update layer A remaining_qty
      undefined, // update layer B remaining_qty
      [{ currentStockValue: '11000' }], // re-select item for currentStockValue
      undefined, // update items.current_stock_value
    ]);

    const cogs = await ValuationService.consumeForStockOut(db, { tenantId: 1, itemId: 7, warehouseId: 1, quantity: 150 });

    expect(cogs).toBe(8000); // 100*50 + 50*60
    expect(setCalls[0]).toMatchObject({ remainingQty: '0' }); // layer A fully consumed
    expect(setCalls[1]).toMatchObject({ remainingQty: '50' }); // layer B: 100 - 50 consumed
    expect(setCalls[2]).toMatchObject({ currentStockValue: '3000' }); // 11000 - 8000
  });

  it('throws STOCK_INSUFFICIENT when layers cannot cover the requested quantity', async () => {
    const layers = [{ id: 1, remainingQty: '50.000', unitCost: '50.00' }];
    const { db } = makeDb([
      [{ costingMethod: 'FIFO', waccCost: '50', currentStockValue: '2500' }], // select item
      layers, // select layers
      undefined, // update layer A remaining_qty (consumed to 0)
    ]);

    await expect(
      ValuationService.consumeForStockOut(db, { tenantId: 1, itemId: 7, warehouseId: 1, quantity: 100 })
    ).rejects.toBeInstanceOf(StockInsufficientForCostingError);
  });
});
