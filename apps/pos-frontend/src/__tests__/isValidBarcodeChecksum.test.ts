/**
 * No test existed for useBarcodeScanDetector.ts at all before this. isValidBarcodeChecksum()
 * is new — a garbled/partial scan (rather than "just not in our catalog") can be flagged with
 * a more specific message once it's already failed a lookup, for the subset of formats
 * (EAN-8/UPC-A/EAN-13) that carry a verifiable GS1 check digit.
 */
import { describe, it, expect } from 'vitest';
import { isValidBarcodeChecksum } from '../hooks/useBarcodeScanDetector.js';

describe('isValidBarcodeChecksum', () => {
  it('accepts a valid EAN-13 (Wikipedia reference value)', () => {
    expect(isValidBarcodeChecksum('4006381333931')).toBe(true);
  });

  it('rejects an EAN-13-length value with a wrong check digit', () => {
    expect(isValidBarcodeChecksum('4006381333939')).toBe(false);
  });

  it('accepts a valid UPC-A (12 digits)', () => {
    expect(isValidBarcodeChecksum('036000291452')).toBe(true);
  });

  it('rejects a UPC-A-length value with a wrong check digit', () => {
    expect(isValidBarcodeChecksum('036000291459')).toBe(false);
  });

  it('accepts a valid EAN-8', () => {
    expect(isValidBarcodeChecksum('96385074')).toBe(true);
  });

  it('rejects an EAN-8-length value with a wrong check digit', () => {
    expect(isValidBarcodeChecksum('96385079')).toBe(false);
  });

  it('treats a non-digit value as not applicable (valid) — e.g. a Code128 alphanumeric SKU', () => {
    expect(isValidBarcodeChecksum('ITEM-ABC123')).toBe(true);
  });

  it('treats a digit-only value of a non-barcode length as not applicable (valid) — e.g. an internal item code', () => {
    expect(isValidBarcodeChecksum('12345')).toBe(true);
  });
});
