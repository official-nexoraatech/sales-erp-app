import { describe, it, expect } from 'vitest';
import { DEFAULT_ACCOUNTS, GROCERY_DEFAULT_ACCOUNTS } from '../domain/default-accounts.js';

const CLOTH_ONLY_CODES = ['1210', '1220', '1230', '4030', '5010', '5020', '5030'];

describe('GROCERY_DEFAULT_ACCOUNTS', () => {
  it('excludes every cloth-specific account code', () => {
    const codes = new Set(GROCERY_DEFAULT_ACCOUNTS.map((a) => a.accountCode));
    for (const clothCode of CLOTH_ONLY_CODES) {
      expect(codes.has(clothCode)).toBe(false);
    }
  });

  it('includes the grocery-specific sub-accounts', () => {
    const codes = new Set(GROCERY_DEFAULT_ACCOUNTS.map((a) => a.accountCode));
    for (const groceryCode of ['1211', '1221', '1231', '5011', '5021', '5031']) {
      expect(codes.has(groceryCode)).toBe(true);
    }
  });

  it('keeps every generic (non-cloth) account shared with DEFAULT_ACCOUNTS', () => {
    const groceryCodes = new Set(GROCERY_DEFAULT_ACCOUNTS.map((a) => a.accountCode));
    const genericClothAccounts = DEFAULT_ACCOUNTS.filter(
      (a) => !CLOTH_ONLY_CODES.includes(a.accountCode)
    );
    for (const acc of genericClothAccounts) {
      expect(groceryCodes.has(acc.accountCode)).toBe(true);
    }
  });

  it('has no duplicate account codes', () => {
    const seen = new Map<string, number>();
    GROCERY_DEFAULT_ACCOUNTS.forEach((a) =>
      seen.set(a.accountCode, (seen.get(a.accountCode) ?? 0) + 1)
    );
    const duplicates = [...seen.entries()].filter(([, count]) => count > 1);
    expect(duplicates).toEqual([]);
  });

  // Same class of bug as the PostingMatrixService account-code audit finding (Phase 0) — a
  // child account whose parentCode doesn't resolve to any root account in the same seed list
  // would silently insert with a dangling reference (seedDefaultAccounts looks parentId up
  // from codeToId, built only from rows in this same accountList).
  it('every child account parentCode resolves to a root account within the same list', () => {
    const codes = new Set(GROCERY_DEFAULT_ACCOUNTS.map((a) => a.accountCode));
    const dangling = GROCERY_DEFAULT_ACCOUNTS.filter(
      (a) => a.parentCode && !codes.has(a.parentCode)
    );
    expect(dangling).toEqual([]);
  });
});
