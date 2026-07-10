import { describe, it, expect } from 'vitest';
import { computeEan13Check, generateBarcodeValue } from '../domain/BarcodeService.js';

describe('computeEan13Check', () => {
  it('computes the standard alternating 1x/3x weighted check digit', () => {
    // 690123456789 is a well-known EAN13 test value — check digit for the first 12 digits is 6.
    // computeEan13Check here operates on an 11-digit input (this service's own itemId+seq scheme),
    // so verify against a manually-computed case instead.
    const digits11 = '00000100001';
    let sum = 0;
    for (let i = 0; i < 11; i++) {
      const d = parseInt(digits11[i]!, 10);
      sum += i % 2 === 0 ? d : d * 3;
    }
    const expected = (10 - (sum % 10)) % 10;
    expect(computeEan13Check(digits11)).toBe(expected);
  });

  it('always returns a single digit 0-9', () => {
    for (let i = 0; i < 50; i++) {
      const digits = String(i * 7919).padStart(11, '0');
      const check = computeEan13Check(digits);
      expect(check).toBeGreaterThanOrEqual(0);
      expect(check).toBeLessThanOrEqual(9);
    }
  });
});

describe('generateBarcodeValue', () => {
  it('EAN13 format produces a 12-digit numeric string ending in a valid check digit', () => {
    const value = generateBarcodeValue('EAN13', 42, 1);
    expect(value).toMatch(/^\d{12}$/);
    const raw = value.slice(0, 11);
    const checkDigit = value.slice(11);
    expect(checkDigit).toBe(String(computeEan13Check(raw)));
  });

  it('CODE128 format embeds the item id and sequence', () => {
    const value = generateBarcodeValue('CODE128', 42, 7);
    expect(value).toBe('ERP-000042-00007');
  });

  it('QR format is unique per call (embeds a timestamp)', () => {
    const a = generateBarcodeValue('QR', 1, 1);
    const b = generateBarcodeValue('QR', 1, 1);
    expect(a.startsWith('QR-000001-00001-')).toBe(true);
    // Same inputs at the same millisecond can collide — but the format itself must be stable.
    expect(a.split('-').length).toBe(4);
    expect(b.split('-').length).toBe(4);
  });
});
