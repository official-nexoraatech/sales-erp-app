import { describe, it, expect } from 'vitest';
import {
  GSTINSchema,
  PANSchema,
  PincodeSchema,
  IFSCSchema,
  BankAccountSchema,
  UANSchema,
  HSNSchema,
} from '../validators.js';

describe('GSTINSchema', () => {
  it('accepts a valid GSTIN', () => {
    expect(GSTINSchema.safeParse('27AAPFU0939F1ZV').success).toBe(true);
  });

  it('rejects an invalid GSTIN with "Invalid GSTIN format"', () => {
    const result = GSTINSchema.safeParse('INVALID123');
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.message).toBe('Invalid GSTIN format');
  });
});

describe('PANSchema', () => {
  it('accepts a valid PAN', () => {
    expect(PANSchema.safeParse('ABCDE1234F').success).toBe(true);
  });

  it('rejects a malformed PAN', () => {
    expect(PANSchema.safeParse('1234ABCDEF').success).toBe(false);
  });
});

describe('IFSCSchema', () => {
  it('accepts a valid IFSC code', () => {
    expect(IFSCSchema.safeParse('HDFC0001234').success).toBe(true);
  });

  it('rejects an invalid IFSC code (wrong format)', () => {
    expect(IFSCSchema.safeParse('HDFC01234').success).toBe(false);
  });
});

describe('PincodeSchema', () => {
  it('accepts a valid 6-digit pincode', () => {
    expect(PincodeSchema.safeParse('400001').success).toBe(true);
  });

  it('rejects a pincode starting with 0', () => {
    expect(PincodeSchema.safeParse('012345').success).toBe(false);
  });
});

describe('BankAccountSchema', () => {
  it('accepts a 9-18 digit account number', () => {
    expect(BankAccountSchema.safeParse('123456789').success).toBe(true);
  });

  it('rejects an account number shorter than 9 digits', () => {
    expect(BankAccountSchema.safeParse('12345').success).toBe(false);
  });
});

describe('UANSchema', () => {
  it('accepts a 12-digit UAN', () => {
    expect(UANSchema.safeParse('123456789012').success).toBe(true);
  });

  it('rejects a UAN that is not 12 digits', () => {
    expect(UANSchema.safeParse('12345').success).toBe(false);
  });
});

describe('HSNSchema', () => {
  it.each(['1234', '123456', '12345678'])('accepts a %s-digit HSN code', (hsn) => {
    expect(HSNSchema.safeParse(hsn).success).toBe(true);
  });

  it.each(['123', '12345', '1234567'])('rejects a %s-digit HSN code (not 4, 6, or 8)', (hsn) => {
    expect(HSNSchema.safeParse(hsn).success).toBe(false);
  });
});
