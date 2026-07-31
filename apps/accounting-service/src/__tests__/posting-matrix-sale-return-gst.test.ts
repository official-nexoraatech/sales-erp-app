/**
 * C-3 fix: PostingMatrixService.buildJournalEntry had no GST-split branch for
 * SALE_RETURN_APPROVED at all — the full tax-inclusive grandTotal booked entirely against
 * Sales-Returns (4900) / AR (1120), so CGST/SGST/IGST Payable were never credited down on a
 * sale return, permanently overstating GST-payable liability. This mirrors the existing
 * INVOICE_CONFIRMED GST-split block, flipped.
 */

import { describe, it, expect, vi } from 'vitest';

vi.mock('drizzle-orm', () => ({
  eq: (col: string, val: unknown) => ({ type: 'eq', col, val }),
  and: (...args: unknown[]) => ({ type: 'and', args }),
}));

vi.mock('@erp/db', () => ({
  accounts: { id: 'id', tenantId: 'tenantId', accountCode: 'accountCode' },
  postingMatrix: { tenantId: 'tenantId', eventType: 'eventType', isActive: 'isActive' },
}));

// First select() call = tenant-specific posting-matrix lookup (empty = fall back to
// DEFAULT_POSTING_RULES); second = the chart-of-accounts lookup.
function makeDb(accountRows: { id: number; accountCode: string }[]) {
  let call = 0;
  return {
    raw: {
      select: () => {
        call += 1;
        const rows = call === 1 ? [] : accountRows;
        return { from: () => ({ where: () => Promise.resolve(rows) }) };
      },
    },
  };
}

describe('PostingMatrixService.buildJournalEntry — SALE_RETURN_APPROVED GST reversal', () => {
  it('reverses CGST/SGST payable and books only the taxable amount to Sales Returns for an intrastate return', async () => {
    const { PostingMatrixService } = await import('../domain/PostingMatrixService.js');
    const db = makeDb([
      { id: 1, accountCode: '4900' }, // Sales Returns
      { id: 2, accountCode: '1120' }, // Accounts Receivable
      { id: 3, accountCode: '2210' }, // CGST Payable
      { id: 4, accountCode: '2220' }, // SGST Payable
    ]);

    const entry = await PostingMatrixService.buildJournalEntry(db as never, 1, {
      eventType: 'SALE_RETURN_APPROVED',
      description: 'Sale return R-1 approved',
      referenceType: 'SALE_RETURN',
      referenceId: 1,
      amount: 1050,
      taxableAmount: 1000,
      cgstAmount: 25,
      sgstAmount: 25,
      igstAmount: 0,
      isInterstate: false,
    });

    const totalDr = entry.lines.reduce((s, l) => s + l.debitAmount, 0);
    const totalCr = entry.lines.reduce((s, l) => s + l.creditAmount, 0);
    expect(totalDr).toBe(totalCr);
    expect(totalDr).toBe(1050); // balanced and equal to the full tax-inclusive return amount

    const salesReturnLine = entry.lines.find((l) => l.accountId === 1);
    const cgstLine = entry.lines.find((l) => l.accountId === 3);
    const sgstLine = entry.lines.find((l) => l.accountId === 4);
    const arCredit = entry.lines
      .filter((l) => l.accountId === 2)
      .reduce((s, l) => s + l.creditAmount, 0);

    expect(salesReturnLine).toMatchObject({ debitAmount: 1000, creditAmount: 0 });
    expect(cgstLine).toMatchObject({ debitAmount: 25, creditAmount: 0 });
    expect(sgstLine).toMatchObject({ debitAmount: 25, creditAmount: 0 });
    expect(arCredit).toBe(1050); // customer's receivable reduced by the full return amount
  });

  it('reverses IGST payable for an interstate return', async () => {
    const { PostingMatrixService } = await import('../domain/PostingMatrixService.js');
    const db = makeDb([
      { id: 1, accountCode: '4900' },
      { id: 2, accountCode: '1120' },
      { id: 5, accountCode: '2230' }, // IGST Payable
    ]);

    const entry = await PostingMatrixService.buildJournalEntry(db as never, 1, {
      eventType: 'SALE_RETURN_APPROVED',
      description: 'Sale return R-2 approved',
      referenceType: 'SALE_RETURN',
      referenceId: 2,
      amount: 1050,
      taxableAmount: 1000,
      cgstAmount: 0,
      sgstAmount: 0,
      igstAmount: 50,
      isInterstate: true,
    });

    const totalDr = entry.lines.reduce((s, l) => s + l.debitAmount, 0);
    const totalCr = entry.lines.reduce((s, l) => s + l.creditAmount, 0);
    expect(totalDr).toBe(totalCr);
    expect(totalDr).toBe(1050);

    const igstLine = entry.lines.find((l) => l.accountId === 5);
    const arCredit = entry.lines
      .filter((l) => l.accountId === 2)
      .reduce((s, l) => s + l.creditAmount, 0);

    expect(igstLine).toMatchObject({ debitAmount: 50, creditAmount: 0 });
    expect(arCredit).toBe(1050);
  });

  it('falls back to booking the full grandTotal against Sales Returns/AR with no GST lines when the payload carries no tax breakdown (defensive — matches pre-fix behavior rather than crashing)', async () => {
    const { PostingMatrixService } = await import('../domain/PostingMatrixService.js');
    const db = makeDb([
      { id: 1, accountCode: '4900' },
      { id: 2, accountCode: '1120' },
    ]);

    const entry = await PostingMatrixService.buildJournalEntry(db as never, 1, {
      eventType: 'SALE_RETURN_APPROVED',
      description: 'Sale return R-3 approved',
      referenceType: 'SALE_RETURN',
      referenceId: 3,
      amount: 1050,
    });

    expect(entry.lines).toHaveLength(2);
    expect(entry.lines.reduce((s, l) => s + l.debitAmount, 0)).toBe(1050);
  });
});
