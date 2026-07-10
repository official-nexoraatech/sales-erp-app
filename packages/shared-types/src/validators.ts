import { z } from 'zod';

// ES-14: shared regex/Zod validators for Indian statutory identifiers — moved
// here to de-duplicate the same patterns that were copy-pasted per-route
// (customer/supplier/organization/branch/employee routes).

export const GSTIN_REGEX = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;
export const PAN_REGEX = /^[A-Z]{5}[0-9]{4}[A-Z]{1}$/;
export const PINCODE_REGEX = /^[1-9][0-9]{5}$/;
export const IFSC_REGEX = /^[A-Z]{4}0[A-Z0-9]{6}$/;
export const BANK_ACCOUNT_REGEX = /^[0-9]{9,18}$/;
export const UAN_REGEX = /^[0-9]{12}$/;
export const HSN_REGEX = /^[0-9]{4}([0-9]{2}([0-9]{2})?)?$/;

export const GSTINSchema = z.string().regex(GSTIN_REGEX, 'Invalid GSTIN format');
export const PANSchema = z.string().regex(PAN_REGEX, 'Invalid PAN format');
export const PincodeSchema = z.string().regex(PINCODE_REGEX, 'Invalid pincode');
export const IFSCSchema = z.string().regex(IFSC_REGEX, 'Invalid IFSC code');
export const BankAccountSchema = z.string().regex(BANK_ACCOUNT_REGEX, 'Invalid bank account number');
export const UANSchema = z.string().regex(UAN_REGEX, 'Invalid UAN (must be 12 digits)');
export const HSNSchema = z.string().regex(HSN_REGEX, 'Invalid HSN code (4, 6, or 8 digits)');
export const PositiveIntSchema = z.number().int().min(1, 'Must be at least 1');

// Convenience variants matching the "optional field, but validate format if
// provided" pattern already used across customer/supplier/organization forms.
export const OptionalGSTINSchema = GSTINSchema.optional().or(z.literal(''));
export const OptionalPANSchema = PANSchema.optional().or(z.literal(''));
export const OptionalIFSCSchema = IFSCSchema.optional().or(z.literal(''));
export const OptionalBankAccountSchema = BankAccountSchema.optional().or(z.literal(''));
export const OptionalUANSchema = UANSchema.optional().or(z.literal(''));
