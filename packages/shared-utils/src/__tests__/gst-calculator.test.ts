import { describe, it, expect } from 'vitest';
import { GSTCalculator, splitGstTax } from '../index.js';

// 2026-07-31 audit: this is the FIRST direct unit test coverage of GST line-discount/tax
// calculation anywhere in this codebase — previously duplicated independently across
// sales-service, purchase-service, and production-service with zero dedicated tests in any of
// them (only exercised indirectly through domain-service tests). Consolidated here into
// @erp/utils as the one shared implementation all four services now call.

describe('GSTCalculator.computeLine', () => {
  const baseInput = {
    unitPrice: 1000,
    quantity: 2,
    discountPct: 0,
    discountAmount: 0,
    gstRate: 18,
    sellerStateCode: '27',
    placeOfSupply: '27',
  };

  it('computes a flat-discount-only line correctly (intrastate, CGST+SGST split)', () => {
    const result = GSTCalculator.computeLine({ ...baseInput, discountAmount: 200 });
    expect(result.subtotal).toBe(2000);
    expect(result.discountAmount).toBe(200);
    expect(result.taxableAmount).toBe(1800);
    expect(result.cgstRate).toBe(9);
    expect(result.sgstRate).toBe(9);
    expect(result.igstRate).toBe(0);
    expect(result.cgstAmount).toBe(162);
    expect(result.sgstAmount).toBe(162);
    expect(result.lineTotal).toBe(2124);
  });

  it('computes a percentage-discount-only line correctly', () => {
    const result = GSTCalculator.computeLine({ ...baseInput, discountPct: 10 });
    expect(result.subtotal).toBe(2000);
    expect(result.discountAmount).toBe(200); // 10% of 2000
    expect(result.taxableAmount).toBe(1800);
  });

  it('falls back to the flat amount when both fields are non-zero (upstream validation is expected to have already rejected this — this documents the calculator’s own fallback behavior, not a policy choice)', () => {
    const result = GSTCalculator.computeLine({
      ...baseInput,
      discountAmount: 300,
      discountPct: 10,
    });
    expect(result.discountAmount).toBe(300);
  });

  it('computes zero discount correctly', () => {
    const result = GSTCalculator.computeLine(baseInput);
    expect(result.discountAmount).toBe(0);
    expect(result.taxableAmount).toBe(2000);
  });

  it('splits IGST (not CGST/SGST) for an interstate line', () => {
    const result = GSTCalculator.computeLine({ ...baseInput, placeOfSupply: '09' });
    expect(result.cgstAmount).toBe(0);
    expect(result.sgstAmount).toBe(0);
    expect(result.igstRate).toBe(18);
    expect(result.igstAmount).toBe(360); // 18% of 2000 (no discount in this case)
  });

  it('applies CESS on top of the GST split', () => {
    const result = GSTCalculator.computeLine({ ...baseInput, cessRate: 5 });
    expect(result.cessRate).toBe(5);
    expect(result.cessAmount).toBe(100); // 5% of 2000
    expect(result.lineTotal).toBe(2000 + 180 + 180 + 100); // taxable + cgst + sgst + cess
  });
});

describe('GSTCalculator.sumTotals', () => {
  it('sums multiple computed lines into totals', () => {
    const line1 = GSTCalculator.computeLine({
      unitPrice: 1000,
      quantity: 1,
      discountPct: 0,
      discountAmount: 0,
      gstRate: 18,
      sellerStateCode: '27',
      placeOfSupply: '27',
    });
    const line2 = GSTCalculator.computeLine({
      unitPrice: 500,
      quantity: 2,
      discountPct: 10,
      discountAmount: 0,
      gstRate: 12,
      sellerStateCode: '27',
      placeOfSupply: '27',
    });
    const totals = GSTCalculator.sumTotals([line1, line2]);
    expect(totals.subtotal).toBe(1000 + 1000);
    expect(totals.taxableAmount).toBe(1000 + 900); // line2: 1000 - 10% = 900
    expect(totals.grandTotal).toBeCloseTo(
      totals.taxableAmount +
        totals.cgstAmount +
        totals.sgstAmount +
        totals.igstAmount +
        totals.cessAmount,
      2
    );
  });

  it('returns all-zero totals for an empty line list', () => {
    const totals = GSTCalculator.sumTotals([]);
    expect(totals).toEqual({
      subtotal: 0,
      discountAmount: 0,
      taxableAmount: 0,
      cgstAmount: 0,
      sgstAmount: 0,
      igstAmount: 0,
      cessAmount: 0,
      grandTotal: 0,
    });
  });
});

describe('splitGstTax (shared primitive used by GSTCalculator and gst-service RCM self-assessment)', () => {
  it('splits intrastate tax into equal CGST/SGST halves', () => {
    const result = splitGstTax({ taxableAmount: 10000, gstRate: 18, isInterstate: false });
    expect(result.cgstAmount).toBe(900);
    expect(result.sgstAmount).toBe(900);
    expect(result.igstAmount).toBe(0);
    expect(result.totalGst).toBe(1800);
  });

  it('routes interstate tax entirely to IGST', () => {
    const result = splitGstTax({ taxableAmount: 10000, gstRate: 18, isInterstate: true });
    expect(result.cgstAmount).toBe(0);
    expect(result.sgstAmount).toBe(0);
    expect(result.igstAmount).toBe(1800);
    expect(result.totalGst).toBe(1800);
  });

  it('defaults cess to zero when omitted', () => {
    const result = splitGstTax({ taxableAmount: 10000, gstRate: 18, isInterstate: false });
    expect(result.cessRate).toBe(0);
    expect(result.cessAmount).toBe(0);
  });
});
