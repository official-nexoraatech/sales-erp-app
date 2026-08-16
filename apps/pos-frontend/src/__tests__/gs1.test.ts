import { describe, it, expect } from 'vitest';
import { parseGs1VariableWeightBarcode } from '../gs1.js';

describe('parseGs1VariableWeightBarcode', () => {
  it('decodes a valid variable-weight barcode into item code and weight in kg', () => {
    // '2' flag + itemCode '12345' + weight '001250' (grams) + valid check digit '3'
    const result = parseGs1VariableWeightBarcode('2123450012503');
    expect(result).toEqual({ itemCode: '12345', weightKg: 1.25 });
  });

  it('decodes a second valid barcode (different item code and weight)', () => {
    const result = parseGs1VariableWeightBarcode('2999990005004');
    expect(result).toEqual({ itemCode: '99999', weightKg: 0.5 });
  });

  it('returns null for a barcode with an invalid check digit', () => {
    // Same digits as the first valid case, wrong final digit
    expect(parseGs1VariableWeightBarcode('2123450012509')).toBeNull();
  });

  it('returns null for a barcode not starting with the "2" flag', () => {
    // A standard EAN-13 product barcode should never be misinterpreted as variable-weight
    expect(parseGs1VariableWeightBarcode('8901234567890')).toBeNull();
  });

  it('returns null for a barcode of the wrong length', () => {
    expect(parseGs1VariableWeightBarcode('212345001250')).toBeNull(); // 12 digits
    expect(parseGs1VariableWeightBarcode('21234500125033')).toBeNull(); // 14 digits
  });

  it('returns null for a non-numeric value', () => {
    expect(parseGs1VariableWeightBarcode('2ABC45001250X')).toBeNull();
  });

  it('returns null for a zero-weight barcode (garbled/mis-scaled read)', () => {
    // '2' + '12345' + '000000' + valid check digit for that body
    const body = '212345000000';
    // Compute the check digit the same way gs1CheckDigitValid does, inline, to keep this
    // test's fixture honest about what "valid checksum but zero weight" actually looks like.
    const nums = body.split('').map(Number).reverse();
    const sum = nums.reduce((acc, d, i) => acc + d * (i % 2 === 0 ? 3 : 1), 0);
    const check = (10 - (sum % 10)) % 10;
    expect(parseGs1VariableWeightBarcode(body + check)).toBeNull();
  });
});
