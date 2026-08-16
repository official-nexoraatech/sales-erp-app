import { describe, it, expect } from 'vitest';
import { toBaseUnitQty, fromBaseUnitQty } from '../index.js';

describe('toBaseUnitQty / fromBaseUnitQty', () => {
  it('converts a purchase-unit quantity to base units using the conversion factor', () => {
    // 2 cases of 24 pieces each = 48 pieces
    expect(toBaseUnitQty(2, 24)).toBe(48);
  });

  it('converts a base-unit quantity back to purchase units', () => {
    expect(fromBaseUnitQty(48, 24)).toBe(2);
  });

  it('is a no-op when no conversion factor is configured (undefined/null/0/negative)', () => {
    expect(toBaseUnitQty(5, undefined)).toBe(5);
    expect(toBaseUnitQty(5, null)).toBe(5);
    expect(toBaseUnitQty(5, 0)).toBe(5);
    expect(toBaseUnitQty(5, -1)).toBe(5);
    expect(fromBaseUnitQty(5, undefined)).toBe(5);
    expect(fromBaseUnitQty(5, 0)).toBe(5);
  });

  it('rounds to 3 decimal places, matching the schema precision for quantity columns', () => {
    expect(toBaseUnitQty(1, 0.333)).toBe(0.333);
    expect(toBaseUnitQty(1 / 3, 1)).toBe(0.333);
  });
});
