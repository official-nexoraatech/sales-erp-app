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

export const supplierFormSchema = z.object({
  displayName: z
    .string()
    .min(2, 'Must be at least 2 characters')
    .max(200, 'Must be 200 characters or fewer'),
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
  email: z.string().email('Invalid email address').max(255).optional().or(z.literal('')),
  gstin: OptionalGSTINSchema,
  pan: OptionalPANSchema,
  bankName: z.string().max(200).optional(),
  bankAccountNo: OptionalBankAccountSchema,
  bankIfsc: OptionalIFSCSchema,
  creditDays: z.coerce.number().int().min(0, 'Cannot be negative').optional(),
  openingBalance: z.coerce.number().min(0, 'Cannot be negative').optional(),
});

export type SupplierFormData = z.infer<typeof supplierFormSchema>;
