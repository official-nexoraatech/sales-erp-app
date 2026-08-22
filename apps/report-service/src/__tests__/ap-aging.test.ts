import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('drizzle-orm', () => ({
  sql: vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({ strings, values })),
}));

import { ReportEngine } from '../domain/ReportEngine.js';

const TENANT_A = 1;
const TENANT_B = 2;
const AS_OF = '2026-07-01';

// withTenantConnection wraps every ReportEngine.generate() call in a transaction that first
// issues its own `SELECT set_config(...)` GUC-setting query via the same trx.execute() the real
// report query uses — so the trx object's execute intercepts and swallows that one call (never
// forwarding it to the tracked `executeMock` below), keeping db.execute.mock.calls exactly as it
// was pre-migration: one entry per real report query, in the same order.
function makeDb(rows: unknown[] = []) {
  const executeMock = vi.fn().mockResolvedValue(rows);
  const trx = {
    execute: (query: unknown) => {
      const text = (query as { strings?: string[] } | undefined)?.strings?.join('') ?? '';
      if (text.includes('set_config')) return Promise.resolve([]);
      return executeMock(query);
    },
  };
  return {
    execute: executeMock,
    transaction: (cb: (t: unknown) => unknown) => cb(trx),
  };
}

describe('AP Aging — unit tests (ES-05)', () => {
  let db: ReturnType<typeof makeDb>;
  let engine: ReportEngine;

  beforeEach(() => {
    db = makeDb([]);
    engine = new ReportEngine(db as never);
  });

  it('calls db.execute with asOf date in SQL values', async () => {
    await engine.generate('ap-aging', TENANT_A, { asOfDate: AS_OF });

    expect(db.execute).toHaveBeenCalledOnce();
    const [sqlArg] = db.execute.mock.calls[0]!;
    const values: unknown[] = (sqlArg as { values: unknown[] }).values ?? [];
    expect(values).toContain(AS_OF);
  });

  it('defaults asOf to today when not provided', async () => {
    const today = new Date().toISOString().slice(0, 10);
    await engine.generate('ap-aging', TENANT_A, {});

    const [sqlArg] = db.execute.mock.calls[0]!;
    const values: unknown[] = (sqlArg as { values: unknown[] }).values ?? [];
    expect(values).toContain(today);
  });

  it('returns mapped rows with camelCase keys', async () => {
    db = makeDb([
      {
        supplier_name: 'Fabric Mills Ltd',
        days0to30: '50000',
        days31to60: '20000',
        days61to90: '10000',
        days90plus: '5000',
        total_outstanding: '85000',
      },
    ]);
    engine = new ReportEngine(db as never);

    const result = await engine.generate('ap-aging', TENANT_A, { asOfDate: AS_OF });

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]!['supplierName']).toBe('Fabric Mills Ltd');
    expect(result.rows[0]!['totalOutstanding']).toBe('85000');
  });

  it('returns empty rows when no outstanding payables', async () => {
    const result = await engine.generate('ap-aging', TENANT_A, { asOfDate: AS_OF });
    expect(result.rows).toHaveLength(0);
    expect(result.totalRows).toBe(0);
  });

  it('tenant isolation: query contains TENANT_A and not TENANT_B', async () => {
    await engine.generate('ap-aging', TENANT_A, { asOfDate: AS_OF });

    const [sqlArg] = db.execute.mock.calls[0]!;
    const values: unknown[] = (sqlArg as { values: unknown[] }).values ?? [];
    expect(values).toContain(TENANT_A);
    expect(values).not.toContain(TENANT_B);
  });

  it('passes supplierId to SQL when provided', async () => {
    await engine.generate('ap-aging', TENANT_A, { asOfDate: AS_OF, supplierId: '7' });

    const [sqlArg] = db.execute.mock.calls[0]!;
    const values: unknown[] = (sqlArg as { values: unknown[] }).values ?? [];
    expect(values).toContain('7');
  });
});
