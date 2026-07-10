import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('@erp/db', () => {
  const mockTable = new Proxy({}, { get: (_t, prop) => ({ columnName: String(prop) }) });
  return {
    customers: mockTable,
    suppliers: mockTable,
    items: mockTable,
    invoices: mockTable,
    payments: mockTable,
    inventoryLedger: mockTable,
    projectionStockLevel: mockTable,
    employees: mockTable,
    warehouses: mockTable,
    departments: mockTable,
    designations: mockTable,
  };
});

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((a: unknown, b: unknown) => ({ type: 'eq', a, b })),
  and: vi.fn((...args: unknown[]) => ({ type: 'and', args })),
  gte: vi.fn((a: unknown, b: unknown) => ({ type: 'gte', a, b })),
  lte: vi.fn((a: unknown, b: unknown) => ({ type: 'lte', a, b })),
  isNull: vi.fn((a: unknown) => ({ type: 'isNull', a })),
}));

import { gte, lte, eq } from 'drizzle-orm';
import { ExportEngine, ENTITY_COLUMNS, type ExportEntity } from '../domain/ExportEngine.js';

function makeChain(rows: unknown[]) {
  const chain: {
    from: ReturnType<typeof vi.fn>;
    leftJoin: ReturnType<typeof vi.fn>;
    where: ReturnType<typeof vi.fn>;
    limit: ReturnType<typeof vi.fn>;
  } = {
    from: vi.fn(() => chain),
    leftJoin: vi.fn(() => chain),
    where: vi.fn(() => chain),
    limit: vi.fn(() => Promise.resolve(rows)),
  };
  return chain;
}

function makeDb(rows: unknown[] = []) {
  const chain = makeChain(rows);
  return { select: vi.fn(() => chain), chain };
}

afterEach(() => {
  vi.clearAllMocks();
});

describe('ENTITY_COLUMNS', () => {
  const entities: ExportEntity[] = ['customer', 'supplier', 'item', 'invoice', 'payment', 'ledger', 'stock', 'employee'];

  it('defines a non-empty column set for all 8 entity types', () => {
    for (const entity of entities) {
      expect(ENTITY_COLUMNS[entity].length).toBeGreaterThan(0);
    }
  });

  it('excludes payroll PII columns from the employee export', () => {
    const keys = ENTITY_COLUMNS.employee.map((c) => c.key);
    expect(keys).not.toContain('panEncrypted');
    expect(keys).not.toContain('bankAccountNoEncrypted');
    expect(keys).not.toContain('aadhaarLast4');
  });
});

describe('ExportEngine.query', () => {
  it('returns tenant-scoped customer rows shaped by ENTITY_COLUMNS', async () => {
    const db = makeDb([{ displayName: 'Raj Textiles' }]);
    const engine = new ExportEngine(db as never);
    const result = await engine.query(1, 'customer');

    expect(db.select).toHaveBeenCalled();
    expect(result.columns).toBe(ENTITY_COLUMNS.customer);
    expect(result.rows).toEqual([{ displayName: 'Raj Textiles' }]);
    expect(result.totalRows).toBe(1);
  });

  it('excludes soft-deleted customers via isNull(deletedAt)', async () => {
    const db = makeDb([]);
    const engine = new ExportEngine(db as never);
    await engine.query(1, 'customer');

    expect(db.chain.where).toHaveBeenCalled();
  });

  it('joins customers for invoice export to resolve customerName', async () => {
    const db = makeDb([]);
    const engine = new ExportEngine(db as never);
    await engine.query(1, 'invoice');

    expect(db.chain.leftJoin).toHaveBeenCalledTimes(1);
  });

  it('applies dateFrom/dateTo/status filters to invoice queries', async () => {
    const db = makeDb([]);
    const engine = new ExportEngine(db as never);
    await engine.query(1, 'invoice', { dateFrom: '2026-01-01', dateTo: '2026-01-31', status: 'PAID' });

    expect(gte).toHaveBeenCalledWith(expect.anything(), new Date('2026-01-01'));
    expect(lte).toHaveBeenCalledWith(expect.anything(), new Date('2026-01-31'));
    expect(eq).toHaveBeenCalledWith(expect.anything(), 'PAID');
  });

  it('joins items and warehouses (2 joins) for ledger export and applies warehouseId filter', async () => {
    const db = makeDb([]);
    const engine = new ExportEngine(db as never);
    await engine.query(1, 'ledger', { warehouseId: 3 });

    expect(db.chain.leftJoin).toHaveBeenCalledTimes(2);
    expect(eq).toHaveBeenCalledWith(expect.anything(), 3);
  });

  it('joins items and warehouses (2 joins) for stock export', async () => {
    const db = makeDb([{ itemName: 'Blue Fabric', availableQty: '10' }]);
    const engine = new ExportEngine(db as never);
    const result = await engine.query(1, 'stock');

    expect(db.chain.leftJoin).toHaveBeenCalledTimes(2);
    expect(result.totalRows).toBe(1);
  });

  it('joins departments and designations (2 joins) for employee export and excludes deleted rows', async () => {
    const db = makeDb([]);
    const engine = new ExportEngine(db as never);
    await engine.query(1, 'employee');

    expect(db.chain.leftJoin).toHaveBeenCalledTimes(2);
  });

  it('ignores malformed filter values instead of throwing', async () => {
    const db = makeDb([]);
    const engine = new ExportEngine(db as never);
    await expect(
      engine.query(1, 'payment', { dateFrom: 123, status: { nested: true } } as unknown as Record<string, unknown>)
    ).resolves.toMatchObject({ totalRows: 0 });
  });
});
