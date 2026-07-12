/**
 * PG-032 — computeValuationLine() unit-cost branching (GET /inventory/valuation).
 * Pure function, no DB/Fastify harness needed — see valuation.test.ts for the
 * ValuationService write-path (ledger→table) coverage.
 */
import { describe, it, expect } from 'vitest';
import { computeValuationLine, type ValuationRow } from '../api/valuation.routes.js';

function row(overrides: Partial<ValuationRow> = {}): ValuationRow {
  return {
    itemId: 1,
    costingMethod: 'WACC',
    availableQty: '200',
    waccCost: '50',
    currentStockValue: '10000',
    warehouseQty: '80',
    ...overrides,
  };
}

describe('computeValuationLine — no warehouseId (tenant-wide, unchanged)', () => {
  it('uses the overall ratio regardless of costing method, never flags estimated', () => {
    const line = computeValuationLine(row(), undefined, new Map(), new Map());
    expect(line).toEqual({ qty: 80, unitCost: 50, totalValue: 4000 });
    expect(line.estimated).toBeUndefined();
  });
});

describe('computeValuationLine — warehouseId + WACC', () => {
  it('uses the true per-warehouse cost when a row exists in inventory_warehouse_valuation', () => {
    const waccCostByItem = new Map([[1, 90]]); // this warehouse's own diverged cost
    const line = computeValuationLine(row(), 2, new Map(), waccCostByItem);
    expect(line.unitCost).toBe(90);
    expect(line.totalValue).toBe(7200); // 80 * 90
    expect(line.estimated).toBeUndefined();
  });

  it('falls back to the tenant-wide ratio with estimated:true when no per-warehouse row exists', () => {
    const line = computeValuationLine(row(), 2, new Map(), new Map());
    expect(line.unitCost).toBe(50); // overall ratio: 10000/200
    expect(line.estimated).toBe(true);
  });
});

describe('computeValuationLine — warehouseId + FIFO', () => {
  it('uses the true warehouse-weighted FIFO cost, which can differ from the tenant-wide average', () => {
    const fifoRow = row({
      costingMethod: 'FIFO',
      availableQty: '300',
      currentStockValue: '18000',
      waccCost: '60',
    });
    // tenant-wide ratio would be 18000/300 = 60; this warehouse's own layers average to 75
    const fifoCostByItem = new Map([[1, 75]]);
    const line = computeValuationLine(fifoRow, 1, fifoCostByItem, new Map());
    expect(line.unitCost).toBe(75);
    expect(line.unitCost).not.toBe(60);
    expect(line.estimated).toBeUndefined();
  });

  it('falls back to the tenant-wide ratio with estimated:true when this warehouse has no FIFO layers', () => {
    const fifoRow = row({
      costingMethod: 'FIFO',
      availableQty: '300',
      currentStockValue: '18000',
      waccCost: '60',
    });
    const line = computeValuationLine(fifoRow, 1, new Map(), new Map());
    expect(line.unitCost).toBe(60);
    expect(line.estimated).toBe(true);
  });
});
