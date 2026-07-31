import { z } from 'zod';
import {
  OptionalGSTINSchema,
  OptionalPANSchema,
  OptionalIFSCSchema,
  OptionalBankAccountSchema,
} from '@erp/types';

// Mirrors SupplierSchema in apps/sales-service/src/api/supplier.routes.ts —
// keep in sync so the frontend never accepts what the backend will reject.
export const SUPPLIER_TYPES = ['DOMESTIC', 'IMPORT', 'MANUFACTURER', 'AGENT'] as const;

const blankToUndefined = (v: unknown) => (v === '' || v === null ? undefined : v);

export const SUPPLIER_STATUSES = ['ACTIVE', 'INACTIVE', 'BLACKLISTED'] as const;

export const supplierFormSchema = z.object({
  displayName: z
    .string()
    .min(2, 'Must be at least 2 characters')
    .max(200, 'Must be 200 characters or fewer'),
  companyName: z.string().max(300).optional(),
  contactPerson: z.string().max(200).optional(),
  // preprocessed through blankToUndefined (not just .optional().or(z.literal(''))) — an
  // unselected <select> submits '', and while that passed *this* schema either way, it was
  // sent to the backend verbatim where SupplierSchema's `.default('DOMESTIC')` only applies
  // to an absent key, not an empty string, so the create call 422'd with "Invalid enum value"
  // for every supplier left at the default "Select…" option.
  supplierType: z.preprocess(blankToUndefined, z.enum(SUPPLIER_TYPES).optional()),
  branchId: z.preprocess(
    blankToUndefined,
    z.coerce.number({ invalid_type_error: 'Required' }).int().positive('Required')
  ),
  phone: z
    .string()
    .min(10, 'Phone must be at least 10 digits')
    .max(20, 'Phone must be 20 characters or fewer'),
  altPhone: z.string().max(20).optional(),
  email: z.string().email('Invalid email address').max(255).optional().or(z.literal('')),
  gstin: OptionalGSTINSchema,
  isRegistered: z.boolean().optional(),
  pan: OptionalPANSchema,
  // Flattened here for form ergonomics — reassembled into billingAddress on submit.
  addressLine1: z.string().optional(),
  addressLine2: z.string().optional(),
  addressCity: z.string().optional(),
  addressState: z.string().optional(),
  addressStateCode: z.string().max(2).optional(),
  addressPincode: z
    .string()
    .regex(/^[1-9][0-9]{5}$/, 'Invalid pincode')
    .optional()
    .or(z.literal('')),
  addressCountry: z.string().optional(),
  bankName: z.string().max(200).optional(),
  bankAccountNo: OptionalBankAccountSchema,
  bankIfsc: OptionalIFSCSchema,
  bankBranch: z.string().max(200).optional(),
  creditDays: z.coerce.number().int().min(0, 'Cannot be negative').optional(),
  creditLimitEnabled: z.boolean().optional(),
  creditLimit: z.coerce.number().min(0, 'Cannot be negative').optional(),
  openingBalance: z.coerce.number().min(0, 'Cannot be negative').optional(),
  status: z.enum(SUPPLIER_STATUSES).optional(),
  notes: z.string().max(5000).optional(),
  // Purchase audit 2026-07-21 gap-fix: manual vendor rating.
  rating: z.coerce.number().min(1).max(5).optional(),
  ratingNotes: z.string().max(2000).optional(),
});

export type SupplierFormData = z.infer<typeof supplierFormSchema>;
