import { describe, it, expect } from 'vitest';
import { HSN_SEED_DATA } from '../domain/hsn-seed.js';

describe('HSN_SEED_DATA integrity', () => {
  // hsn_master has a UNIQUE constraint on hsnCode (see packages/db-client/src/schema/gst.ts) —
  // the seed insert uses onConflictDoNothing(), so a duplicate within this list wouldn't error,
  // it would just silently drop the second row's (possibly different) gstRate/description.
  it('has no duplicate hsnCode values', () => {
    const seen = new Map<string, number>();
    HSN_SEED_DATA.forEach((row) => seen.set(row.hsnCode, (seen.get(row.hsnCode) ?? 0) + 1));
    const duplicates = [...seen.entries()].filter(([, count]) => count > 1).map(([code]) => code);
    expect(duplicates).toEqual([]);
  });

  it('every row has a non-empty description and a valid-looking GST rate', () => {
    for (const row of HSN_SEED_DATA) {
      expect(row.description.length).toBeGreaterThan(0);
      const rate = parseFloat(row.gstRate);
      expect(Number.isFinite(rate)).toBe(true);
      expect(rate).toBeGreaterThanOrEqual(0);
      expect(rate).toBeLessThanOrEqual(28);
    }
  });

  // Multi-vertical platform audit 2026-08-16, Phase 2: confirms grocery/FMCG chapters (04, 07,
  // 08, 09, 10, 11, 15, 17, 19, 20, 21, 22, 25, 33, 34) were actually added, not just planned.
  it('includes grocery/FMCG chapters alongside the existing textile chapters', () => {
    const chapters = new Set(HSN_SEED_DATA.map((r) => r.chapter));
    for (const groceryChapter of ['04', '10', '15', '17', '22']) {
      expect(chapters.has(groceryChapter)).toBe(true);
    }
    for (const textileChapter of ['50', '52', '61', '62']) {
      expect(chapters.has(textileChapter)).toBe(true);
    }
  });
});
