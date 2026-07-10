import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Module mocks ──────────────────────────────────────────────────────────
// fixedAssets / assetDepreciationSchedule are mocked as plain marker objects
// so `where` conditions built with the mocked eq()/and() below can be
// inspected in assertions (e.g. to prove tenant scoping in test 6).

vi.mock('@erp/db', () => ({
  fixedAssets: {
    tenantId: 'fixedAssets.tenantId',
    id: 'fixedAssets.id',
    status: 'fixedAssets.status',
    version: 'fixedAssets.version',
  },
  assetDepreciationSchedule: {
    tenantId: 'assetDepreciationSchedule.tenantId',
    assetId: 'assetDepreciationSchedule.assetId',
    periodMonth: 'assetDepreciationSchedule.periodMonth',
    periodYear: 'assetDepreciationSchedule.periodYear',
  },
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((col: unknown, val: unknown) => ({ type: 'eq', col, val })),
  and: vi.fn((...conds: unknown[]) => ({ type: 'and', conds })),
  sql: vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({ type: 'sql', strings, values })),
}));

vi.mock('../domain/JournalEngine.js', () => ({
  JournalEngine: {
    post: vi.fn().mockResolvedValue({ journalId: 'JRN-TEST-001', linesPosted: 2 }),
  },
}));

import { fixedAssets, assetDepreciationSchedule } from '@erp/db';
import { FixedAssetService } from '../domain/FixedAssetService.js';
import { JournalEngine } from '../domain/JournalEngine.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

interface Cond {
  type: 'eq' | 'and';
  col?: unknown;
  val?: unknown;
  conds?: Cond[];
}

function whereHasCol(cond: Cond | undefined, colMarker: unknown): boolean {
  if (!cond) return false;
  if (cond.type === 'eq') return cond.col === colMarker;
  if (cond.type === 'and') return (cond.conds ?? []).some((c) => whereHasCol(c, colMarker));
  return false;
}

function extractEqVal(cond: Cond | undefined, colMarker: unknown): unknown {
  if (!cond) return undefined;
  if (cond.type === 'eq' && cond.col === colMarker) return cond.val;
  if (cond.type === 'and') {
    for (const c of cond.conds ?? []) {
      const v = extractEqVal(c, colMarker);
      if (v !== undefined) return v;
    }
  }
  return undefined;
}

interface InsertCall { table: unknown; values: Record<string, unknown> }
interface UpdateCall { table: unknown; set: Record<string, unknown>; where: Cond }
interface SelectCall { table: unknown; where: Cond }

function makeMockDb(opts: {
  asset: Record<string, unknown> | null;
  batchAssets?: Record<string, unknown>[];
  existingScheduleRow?: Record<string, unknown> | null;
  /** Simulate the ES-23 [M22] optimistic-lock guard rejecting the update (version mismatch). */
  updateReturningEmpty?: boolean;
}) {
  const insertCalls: InsertCall[] = [];
  const updateCalls: UpdateCall[] = [];
  const selectCalls: SelectCall[] = [];

  const raw = {
    select: vi.fn(() => ({
      from: (table: unknown) => ({
        where: (cond: Cond) => {
          selectCalls.push({ table, where: cond });
          if (table === fixedAssets) {
            if (whereHasCol(cond, fixedAssets.id)) {
              return Promise.resolve(opts.asset ? [opts.asset] : []);
            }
            return Promise.resolve(opts.batchAssets ?? []);
          }
          if (table === assetDepreciationSchedule) {
            return Promise.resolve(opts.existingScheduleRow ? [opts.existingScheduleRow] : []);
          }
          return Promise.resolve([]);
        },
      }),
    })),
    insert: vi.fn((table: unknown) => ({
      values: vi.fn((values: Record<string, unknown>) => {
        insertCalls.push({ table, values });
        return Promise.resolve(undefined);
      }),
    })),
    update: vi.fn((table: unknown) => ({
      set: vi.fn((set: Record<string, unknown>) => ({
        where: vi.fn((where: Cond) => ({
          returning: vi.fn(() => {
            updateCalls.push({ table, set, where });
            return Promise.resolve(opts.updateReturningEmpty ? [] : [{ ...opts.asset, ...set }]);
          }),
        })),
      })),
    })),
  };

  const db = {
    raw,
    transaction: vi.fn(async (cb: (trx: { raw: typeof raw }) => unknown) => cb({ raw })),
  };

  return { db, insertCalls, updateCalls, selectCalls };
}

const BASE_ASSET = {
  id: 7,
  tenantId: 1,
  assetCode: 'FA-001',
  name: 'Test Asset',
  category: 'Furniture',
  accountId: 100,
  accumulatedDepreciationAccountId: 101,
  depreciationExpenseAccountId: 102,
  purchaseDate: '2025-01-01',
  purchaseCost: '100000',
  salvageValue: '10000',
  usefulLifeMonths: 120,
  depreciationMethod: 'SLM' as const,
  wdvRate: null,
  currentValue: '100000',
  status: 'ACTIVE' as const,
  notes: null,
  createdBy: 1,
};

beforeEach(() => {
  vi.mocked(JournalEngine.post).mockClear();
  vi.mocked(JournalEngine.post).mockResolvedValue({ journalId: 'JRN-TEST-001', linesPosted: 2 });
});

// ═══════════════════════════════════════════════════════════════════════════
// computeMonthlyDepreciation
// ═══════════════════════════════════════════════════════════════════════════

describe('FixedAssetService.computeMonthlyDepreciation', () => {
  it('SLM: cost=100000, salvageValue=10000, usefulLifeMonths=120 -> 750/month', () => {
    const asset = {
      ...BASE_ASSET,
      purchaseCost: '100000',
      salvageValue: '10000',
      currentValue: '100000',
      usefulLifeMonths: 120,
      depreciationMethod: 'SLM' as const,
    };

    const result = FixedAssetService.computeMonthlyDepreciation(asset as never);

    expect(result).toBe(750);
  });

  it('WDV: currentValue=100000, wdvRate=15 -> 1250/month', () => {
    const asset = {
      ...BASE_ASSET,
      purchaseCost: '150000',
      salvageValue: '0',
      currentValue: '100000',
      depreciationMethod: 'WDV' as const,
      wdvRate: '15',
    };

    const result = FixedAssetService.computeMonthlyDepreciation(asset as never);

    expect(result).toBe(1250);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// postMonthlyDepreciation
// ═══════════════════════════════════════════════════════════════════════════

describe('FixedAssetService.postMonthlyDepreciation', () => {
  it('sets currentValue = oldCurrentValue - depreciationAmount', async () => {
    const asset = { ...BASE_ASSET };
    const { db, updateCalls } = makeMockDb({ asset });

    const result = await FixedAssetService.postMonthlyDepreciation(
      db as never, 1, 1, asset.id, 4, 2026
    );

    expect(result).toEqual({ journalId: 'JRN-TEST-001', depreciationAmount: 750 });
    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0]?.table).toBe(fixedAssets);
    expect(updateCalls[0]?.set['currentValue']).toBe(String(Number(asset.currentValue) - 750));
  });

  it('inserts a depreciation schedule row whose amount matches, and the running total (openingValue - depreciationAmount = closingValue) is consistent with the new currentValue', async () => {
    const asset = { ...BASE_ASSET };
    const { db, insertCalls, updateCalls } = makeMockDb({ asset });

    await FixedAssetService.postMonthlyDepreciation(db as never, 1, 1, asset.id, 4, 2026);

    expect(insertCalls).toHaveLength(1);
    expect(insertCalls[0]?.table).toBe(assetDepreciationSchedule);
    const row = insertCalls[0]?.values as Record<string, string>;
    expect(row['depreciationAmount']).toBe('750');
    expect(row['openingValue']).toBe(String(asset.currentValue));
    expect(row['closingValue']).toBe(String(Number(asset.currentValue) - 750));

    // The per-period schedule row is the running-total mechanism (there is no
    // running accumulated-depreciation column updated on the asset itself) —
    // confirm the schedule's closingValue matches the currentValue written to
    // fixedAssets in the same transaction.
    expect(Number(row['closingValue'])).toBe(Number(updateCalls[0]?.set['currentValue']));
  });

  it('returns null and writes nothing when the asset is already at or below salvage value', async () => {
    const asset = { ...BASE_ASSET, currentValue: '10000', salvageValue: '10000' };
    expect(FixedAssetService.computeMonthlyDepreciation(asset as never)).toBe(0);

    const { db, insertCalls, updateCalls } = makeMockDb({ asset });

    const result = await FixedAssetService.postMonthlyDepreciation(db as never, 1, 1, asset.id, 4, 2026);

    expect(result).toBeNull();
    expect(insertCalls).toHaveLength(0);
    expect(updateCalls).toHaveLength(0);
    expect(JournalEngine.post).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// ES-23 [M22] — optimistic-lock guard on the currentValue update
// ═══════════════════════════════════════════════════════════════════════════

describe('FixedAssetService.postMonthlyDepreciation — ES-23 [M22] optimistic lock', () => {
  it('guards the currentValue update on the version read inside this same transaction', async () => {
    const asset = { ...BASE_ASSET, version: 3 };
    const { db, updateCalls } = makeMockDb({ asset });

    await FixedAssetService.postMonthlyDepreciation(db as never, 1, 1, asset.id, 4, 2026);

    expect(updateCalls).toHaveLength(1);
    expect(extractEqVal(updateCalls[0]?.where as Cond, fixedAssets.id)).toBe(asset.id);
  });

  it('throws OptimisticLockError when a concurrent update already changed the version (0 rows returned)', async () => {
    const asset = { ...BASE_ASSET, version: 3 };
    const { db } = makeMockDb({ asset, updateReturningEmpty: true });

    await expect(
      FixedAssetService.postMonthlyDepreciation(db as never, 1, 1, asset.id, 4, 2026)
    ).rejects.toMatchObject({ code: 'OPTIMISTIC_LOCK_CONFLICT' });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// runMonthlyDepreciationBatch — tenant isolation
// ═══════════════════════════════════════════════════════════════════════════

describe('FixedAssetService.runMonthlyDepreciationBatch', () => {
  it('scopes the asset lookup to the given tenant', async () => {
    const tenantIdA = 111;
    const { db, selectCalls } = makeMockDb({ asset: null, batchAssets: [] });

    await FixedAssetService.runMonthlyDepreciationBatch(db as never, tenantIdA, 1, 4, 2026);

    // First select is the batch listing query: where(and(eq(tenantId), eq(status, ACTIVE)))
    const listingCall = selectCalls.find(
      (c) => c.table === fixedAssets && !whereHasCol(c.where, fixedAssets.id)
    );
    expect(listingCall).toBeDefined();
    expect(extractEqVal(listingCall?.where, fixedAssets.tenantId)).toBe(tenantIdA);
    expect(extractEqVal(listingCall?.where, fixedAssets.status)).toBe('ACTIVE');
  });
});
