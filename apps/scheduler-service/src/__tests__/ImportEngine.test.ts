import { describe, it, expect, vi } from 'vitest';

vi.mock('@erp/db', () => {
  const mockTable = new Proxy({}, {
    get: (_t, prop) => ({ columnName: String(prop) }),
  });
  return {
    importJobs: mockTable,
    exportJobs: mockTable,
    createDatabaseClient: vi.fn(),
  };
});

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((_a: unknown, _b: unknown) => '__eq__'),
  and: vi.fn((..._args: unknown[]) => '__and__'),
  desc: vi.fn((_a: unknown) => '__desc__'),
}));

import { ImportEngine } from '../domain/ImportEngine.js';

function makeWhereResult(rows: unknown[]) {
  return Object.assign(Promise.resolve(rows), {
    limit: vi.fn().mockResolvedValue(rows),
  });
}

function makeDb(jobRows: unknown[] = []) {
  return {
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({ where: vi.fn().mockReturnValue(makeWhereResult(jobRows)) }),
    }),
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockReturnValue({ onConflictDoNothing: vi.fn().mockResolvedValue(undefined) }),
    }),
    update: vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }),
    }),
  };
}

describe('ImportEngine.getTemplate', () => {
  const engine = new ImportEngine({} as never);

  it('returns customer CSV header', () => {
    const t = engine.getTemplate('customer');
    expect(t).toContain('name');
    expect(t).toContain('phone');
    expect(t).toContain('gstin');
  });

  it('returns item CSV header', () => {
    const t = engine.getTemplate('item');
    expect(t).toContain('sku');
    expect(t).toContain('salePrice');
    expect(t).toContain('taxRate');
  });

  it('returns opening-stock CSV header', () => {
    const t = engine.getTemplate('opening-stock');
    expect(t).toContain('warehouseCode');
    expect(t).toContain('quantity');
  });
});

describe('ImportEngine.createJob', () => {
  it('throws when CSV has no data rows', async () => {
    const engine = new ImportEngine(makeDb() as never);
    await expect(engine.createJob(1, 1, 'customer', 'name,phone\n', 'test.csv')).rejects.toThrow('no data rows');
  });

  it('throws when CSV exceeds 10000 rows', async () => {
    const rows = Array.from({ length: 10_001 }, (_, i) => `Customer${i},9999999999`).join('\n');
    const csv = `name,phone\n${rows}`;
    const engine = new ImportEngine(makeDb() as never);
    await expect(engine.createJob(1, 1, 'customer', csv, 'big.csv')).rejects.toThrow('Max 10,000 rows');
  });

  it('creates job and returns a ULID string', async () => {
    const csv = 'name,phone\nRaj Textiles,9876543210\nShree Fabrics,8765432109';
    const db = makeDb();
    const engine = new ImportEngine(db as never);
    const jobId = await engine.createJob(1, 1, 'customer', csv, 'customers.csv');
    expect(typeof jobId).toBe('string');
    expect(jobId.length).toBeGreaterThan(0);
    expect(db.insert).toHaveBeenCalled();
  });
});

describe('ImportEngine.validate', () => {
  it('validates valid customer rows without errors', async () => {
    const job = {
      id: 'job-1', tenantId: 1, entityType: 'customer', status: 'MAPPED',
      rawData: [
        { name: 'Raj Textiles', phone: '9876543210', creditLimit: '10000' },
      ],
      columnMapping: [
        { sourceColumn: 'name', targetField: 'name' },
        { sourceColumn: 'phone', targetField: 'phone' },
        { sourceColumn: 'creditLimit', targetField: 'creditLimit', transform: 'NUMBER' as const },
      ],
    };
    const engine = new ImportEngine(makeDb([job]) as never);
    const result = await engine.validate(1, 'job-1');
    expect(result.validRows).toBe(1);
    expect(result.errors).toHaveLength(0);
  });

  it('catches invalid phone format and reports error', async () => {
    const job = {
      id: 'job-1', tenantId: 1, entityType: 'customer', status: 'MAPPED',
      rawData: [
        { name: 'Raj Textiles', phone: '9876543210' },     // valid
        { name: 'Bad Customer', phone: 'not-a-phone' },    // invalid phone
      ],
      columnMapping: [
        { sourceColumn: 'name', targetField: 'name' },
        { sourceColumn: 'phone', targetField: 'phone' },
      ],
    };
    const engine = new ImportEngine(makeDb([job]) as never);
    const result = await engine.validate(1, 'job-1');
    expect(result.validRows).toBe(1);
    expect(result.errors.length).toBeGreaterThan(0);
    const phoneError = result.errors.find((e) => e.field === 'phone');
    expect(phoneError).toBeDefined();
    expect(phoneError?.row).toBe(3); // row 3 = CSV line 3 (1 header + 2 data)
  });

  it('validates item rows with proper types', async () => {
    const job = {
      id: 'job-2', tenantId: 1, entityType: 'item', status: 'MAPPED',
      rawData: [
        { name: 'Blue Fabric', sku: 'FAB-001', salePrice: '250', purchasePrice: '200', taxRate: '5', unit: 'Meter' },
      ],
      columnMapping: [
        { sourceColumn: 'name', targetField: 'name' },
        { sourceColumn: 'sku', targetField: 'sku' },
        { sourceColumn: 'salePrice', targetField: 'salePrice', transform: 'NUMBER' as const },
        { sourceColumn: 'purchasePrice', targetField: 'purchasePrice', transform: 'NUMBER' as const },
        { sourceColumn: 'taxRate', targetField: 'taxRate', transform: 'NUMBER' as const },
        { sourceColumn: 'unit', targetField: 'unit' },
      ],
    };
    const engine = new ImportEngine(makeDb([job]) as never);
    const result = await engine.validate(1, 'job-2');
    expect(result.validRows).toBe(1);
    expect(result.errors).toHaveLength(0);
  });
});
