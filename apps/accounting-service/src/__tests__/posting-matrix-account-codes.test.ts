/**
 * Grocery-expansion audit finding 2026-08-16 (Critical): DEFAULT_POSTING_RULES referenced
 * account codes that don't exist in DEFAULT_ACCOUNTS (e.g. Accounts Payable coded '2010' in
 * the rules vs seeded as '2100'; Inventory coded '1310' vs that code actually being "Prepaid
 * Expenses"). PostingMatrixService.buildJournalEntry silently skips any line whose code doesn't
 * resolve, so on a freshly-seeded tenant GRN approval, supplier payments, purchase returns,
 * expense postings, and payroll postings could post malformed or incomplete journals. None of
 * the existing consumer tests caught this because they mock buildJournalEntry entirely. This
 * test guards the raw code cross-reference so a stale posting rule fails CI instead of silently
 * dropping journal lines in production.
 */

import { describe, it, expect } from 'vitest';
import { DEFAULT_ACCOUNTS } from '../domain/default-accounts.js';
import { DEFAULT_POSTING_RULES, GST_ACCOUNT_CODES } from '../domain/PostingMatrixService.js';

describe('PostingMatrixService default rules reference real seeded accounts', () => {
  const seededCodes = new Set(DEFAULT_ACCOUNTS.map((a) => a.accountCode));

  it('every debitCode/creditCode in DEFAULT_POSTING_RULES exists in DEFAULT_ACCOUNTS', () => {
    const missing: string[] = [];

    for (const [eventType, rules] of Object.entries(DEFAULT_POSTING_RULES)) {
      for (const rule of rules) {
        if (!seededCodes.has(rule.debitCode)) {
          missing.push(`${eventType}: debitCode '${rule.debitCode}' not in DEFAULT_ACCOUNTS`);
        }
        if (!seededCodes.has(rule.creditCode)) {
          missing.push(`${eventType}: creditCode '${rule.creditCode}' not in DEFAULT_ACCOUNTS`);
        }
      }
    }

    expect(missing).toEqual([]);
  });

  it('every GST_ACCOUNT_CODES value exists in DEFAULT_ACCOUNTS', () => {
    const missing = Object.entries(GST_ACCOUNT_CODES)
      .filter(([, code]) => !seededCodes.has(code))
      .map(([name, code]) => `${name}: '${code}' not in DEFAULT_ACCOUNTS`);

    expect(missing).toEqual([]);
  });
});
