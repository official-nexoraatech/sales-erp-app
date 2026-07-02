import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@erp/db', () => {
  const mockTable = new Proxy({}, {
    get: (_t, prop) => ({ columnName: String(prop) }),
  });
  return {
    numberSeriesConfig: mockTable,
    createDatabaseClient: vi.fn(),
  };
});

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((_a: unknown, _b: unknown) => '__eq__'),
  and: vi.fn((..._args: unknown[]) => '__and__'),
  sql: vi.fn((s: string) => s),
}));

import { NumberSeriesEngine } from '../domain/NumberSeriesEngine.js';

// Returns a thenable with .limit() — handles both `await where(...)` and `where(...).limit(n)` patterns
function makeSelect(rows: unknown[]) {
  const thenableWhere = Object.assign(Promise.resolve(rows), {
    limit: vi.fn().mockResolvedValue(rows),
  });
  return {
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({ where: vi.fn().mockReturnValue(thenableWhere) }),
    }),
  };
}

function makeFullDb(rows: Record<string, unknown>[] = []) {
  const thenableWhere = Object.assign(Promise.resolve(rows), {
    limit: vi.fn().mockResolvedValue(rows),
  });
  const returningRows = Object.assign(Promise.resolve(rows), {
    limit: vi.fn().mockResolvedValue(rows),
  });
  return {
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({ where: vi.fn().mockReturnValue(thenableWhere) }),
    }),
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockReturnValue({ onConflictDoNothing: vi.fn().mockResolvedValue(undefined) }),
    }),
    update: vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({ returning: vi.fn().mockReturnValue(returningRows) }),
      }),
    }),
  };
}

describe('NumberSeriesEngine', () => {
  describe('preview — format output', () => {
    it('returns INV/YY-YY/NNNNN format for SALE_INVOICE with custom template', async () => {
      const db = makeFullDb([{ currentSeq: 4, formatTemplate: 'INV/{FY-SHORT}/{SEQ:5}' }]);
      const engine = new NumberSeriesEngine(db as never);
      const result = await engine.preview(1, 'SALE_INVOICE');
      // seq should be 4+1=5, padded to 5 digits
      expect(result).toMatch(/^INV\/\d{2}-\d{2}\/00005$/);
    });

    it('zero-pads sequence correctly for seq=42', async () => {
      const db = makeFullDb([{ currentSeq: 41, formatTemplate: 'INV/{FY-SHORT}/{SEQ:5}' }]);
      const engine = new NumberSeriesEngine(db as never);
      const result = await engine.preview(1, 'SALE_INVOICE');
      expect(result).toContain('00042');
    });

    it('handles no padding when template uses {SEQ}', async () => {
      const db = makeFullDb([{ currentSeq: 122, formatTemplate: 'REC/{SEQ}' }]);
      const engine = new NumberSeriesEngine(db as never);
      const result = await engine.preview(1, 'PAYMENT_IN');
      expect(result).toBe('REC/123');
    });

    it('uses default format when no config row exists', async () => {
      const db = makeFullDb([]); // no config row → falls back to DEFAULT_FORMATS
      const engine = new NumberSeriesEngine(db as never);
      const result = await engine.preview(1, 'PURCHASE_ORDER');
      // DEFAULT_FORMATS for PURCHASE_ORDER is 'PO/{FY-SHORT}/{SEQ:5}'
      expect(result).toMatch(/^PO\/\d{2}-\d{2}\/00001$/);
    });
  });

  describe('preview — financial year detection', () => {
    beforeEach(() => { vi.useFakeTimers(); });
    afterEach(() => { vi.useRealTimers(); });

    it('uses previous FY when in January', async () => {
      vi.setSystemTime(new Date('2026-01-15T10:00:00Z'));
      const db = makeFullDb([{ currentSeq: 0, formatTemplate: '{FY-SHORT}/{SEQ:1}' }]);
      const engine = new NumberSeriesEngine(db as never);
      const result = await engine.preview(1, 'SALE_INVOICE');
      expect(result.startsWith('25-26')).toBe(true);
    });

    it('uses current FY when in May', async () => {
      vi.setSystemTime(new Date('2026-05-01T10:00:00Z'));
      const db = makeFullDb([{ currentSeq: 0, formatTemplate: '{FY-SHORT}/{SEQ:1}' }]);
      const engine = new NumberSeriesEngine(db as never);
      const result = await engine.preview(1, 'SALE_INVOICE');
      expect(result.startsWith('26-27')).toBe(true);
    });

    it('switches FY on April 1', async () => {
      vi.setSystemTime(new Date('2026-04-01T00:00:00Z'));
      const db = makeFullDb([{ currentSeq: 0, formatTemplate: '{FY-SHORT}/{SEQ:1}' }]);
      const engine = new NumberSeriesEngine(db as never);
      const result = await engine.preview(1, 'SALE_INVOICE');
      expect(result.startsWith('26-27')).toBe(true);
    });
  });

  describe('preview — DB is not mutated', () => {
    it('does not call update', async () => {
      const db = makeFullDb([{ currentSeq: 10, formatTemplate: 'INV/{FY-SHORT}/{SEQ:5}' }]);
      const engine = new NumberSeriesEngine(db as never);
      await engine.preview(1, 'SALE_INVOICE');
      expect(db.update).not.toHaveBeenCalled();
    });

    it('does not call insert', async () => {
      const db = makeFullDb([{ currentSeq: 3, formatTemplate: 'INV/{FY-SHORT}/{SEQ:5}' }]);
      const engine = new NumberSeriesEngine(db as never);
      await engine.preview(1, 'SALE_INVOICE');
      expect(db.insert).not.toHaveBeenCalled();
    });
  });
});
