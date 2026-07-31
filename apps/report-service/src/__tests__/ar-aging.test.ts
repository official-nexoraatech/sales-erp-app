import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('drizzle-orm', () => ({
  sql: vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({ strings, values })),
}));

import { ReportEngine } from '../domain/ReportEngine.js';

const TENANT_A = 1;
const TENANT_B = 2;
const AS_OF = '2026-07-01';

function makeDb(rows: unknown[] = []) {
  return { execute: vi.fn().mockResolvedValue(rows) };
}

describe('AR Aging — unit tests (ES-05)', () => {
  let db: ReturnType<typeof makeDb>;
  let engine: ReportEngine;

  beforeEach(() => {
    db = makeDb([]);
    engine = new ReportEngine(db as never);
  });

  it('calls db.execute with asOf date in SQL values', async () => {
    await engine.generate('ar-aging', TENANT_A, { asOfDate: AS_OF });

    expect(db.execute).toHaveBeenCalledOnce();
    const [sqlArg] = db.execute.mock.calls[0]!;
    const values: unknown[] = (sqlArg as { values: unknown[] }).values ?? [];
    expect(values).toContain(AS_OF);
  });

  it('defaults asOf to today when not provided', async () => {
    const today = new Date().toISOString().slice(0, 10);
    await engine.generate('ar-aging', TENANT_A, {});

    const [sqlArg] = db.execute.mock.calls[0]!;
    const values: unknown[] = (sqlArg as { values: unknown[] }).values ?? [];
    expect(values).toContain(today);
  });

  it('returns mapped rows with camelCase keys', async () => {
    db = makeDb([
      {
        customer_name: 'ACME Corp',
        days0to30: '10000',
        days31to60: '5000',
        days61to90: '0',
        days90plus: '2000',
        total_outstanding: '17000',
      },
    ]);
    engine = new ReportEngine(db as never);

    const result = await engine.generate('ar-aging', TENANT_A, { asOfDate: AS_OF });

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]!['customerName']).toBe('ACME Corp');
    expect(result.rows[0]!['totalOutstanding']).toBe('17000');
  });

  it('returns empty rows when no outstanding invoices', async () => {
    const result = await engine.generate('ar-aging', TENANT_A, { asOfDate: AS_OF });
    expect(result.rows).toHaveLength(0);
    expect(result.totalRows).toBe(0);
  });

  it('tenant isolation: query contains TENANT_A and not TENANT_B', async () => {
    await engine.generate('ar-aging', TENANT_A, { asOfDate: AS_OF });

    const [sqlArg] = db.execute.mock.calls[0]!;
    const values: unknown[] = (sqlArg as { values: unknown[] }).values ?? [];
    expect(values).toContain(TENANT_A);
    expect(values).not.toContain(TENANT_B);
  });

  it('passes branchId to SQL when provided', async () => {
    await engine.generate('ar-aging', TENANT_A, { asOfDate: AS_OF, branchId: '5' });

    const [sqlArg] = db.execute.mock.calls[0]!;
    const values: unknown[] = (sqlArg as { values: unknown[] }).values ?? [];
    expect(values).toContain('5');
  });

  // M-12 fix: this report used to bucket by invoice_date ("how old is the invoice") while
  // outstanding-receivables bucketed by due_date ("how overdue is it") — same tenant, two
  // different "days overdue" answers. Aligned to due_date (the standard AR-ageing convention).
  it('buckets days0to30/31to60/61to90/90plus by due_date, matching outstanding-receivables', async () => {
    await engine.generate('ar-aging', TENANT_A, { asOfDate: AS_OF });

    const [sqlArg] = db.execute.mock.calls[0]!;
    const sqlText = (sqlArg as { strings: TemplateStringsArray }).strings.join('');
    // Every bucket CASE expression must key off due_date now, not invoice_date.
    expect(sqlText.match(/i\.due_date::date\) BETWEEN|i\.due_date::date\) >/g)).toHaveLength(4);
    expect(sqlText).not.toMatch(/i\.invoice_date::date\) (BETWEEN|>)/);
  });
});
