import { z } from 'zod';
import type { ValidationError, ValidationResult, MigrationEntity } from '../types.js';

// ── Indian GSTIN regex ────────────────────────────────────────────────────────
const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;
const PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]{1}$/;
const HSN_RE = /^[0-9]{4,8}$/;
const GST_RATES = [0, 0.1, 0.25, 1.5, 3, 5, 7.5, 12, 18, 28];

// ── Zod schemas ───────────────────────────────────────────────────────────────

export const CustomerSchema = z.object({
  displayName: z.string().min(1, 'displayName is required').max(200),
  companyName: z.string().max(200).optional(),
  gstin: z
    .string()
    .regex(GSTIN_RE, 'Invalid GSTIN format (must be 15-char GST number)')
    .optional()
    .or(z.literal('')),
  pan: z
    .string()
    .regex(PAN_RE, 'Invalid PAN format')
    .optional()
    .or(z.literal('')),
  phone: z.string().max(15).optional().or(z.literal('')),
  email: z.string().email('Invalid email').optional().or(z.literal('')),
  address: z.string().max(500).optional(),
  city: z.string().max(100).optional(),
  state: z.string().max(100).optional(),
  pincode: z.string().regex(/^[0-9]{6}$/, 'Pincode must be 6 digits').optional().or(z.literal('')),
  creditLimit: z.coerce.number().nonnegative().optional(),
  openingBalance: z.coerce.number().optional(),
});

export const SupplierSchema = z.object({
  displayName: z.string().min(1, 'displayName is required').max(200),
  companyName: z.string().max(200).optional(),
  gstin: z.string().regex(GSTIN_RE, 'Invalid GSTIN').optional().or(z.literal('')),
  phone: z.string().max(15).optional(),
  email: z.string().email('Invalid email').optional().or(z.literal('')),
  address: z.string().max(500).optional(),
  city: z.string().max(100).optional(),
  state: z.string().max(100).optional(),
  pincode: z.string().regex(/^[0-9]{6}$/).optional().or(z.literal('')),
  openingBalance: z.coerce.number().optional(),
});

export const ItemSchema = z.object({
  name: z.string().min(1, 'name is required').max(300),
  sku: z.string().max(100).optional(),
  hsnCode: z.string().regex(HSN_RE, 'HSN must be 4–8 digits'),
  gstRate: z.coerce
    .number()
    .refine((v) => GST_RATES.includes(v), { message: `GST rate must be one of: ${GST_RATES.join(', ')}` }),
  unit: z.string().min(1, 'unit is required').max(50),
  category: z.string().max(100).optional(),
  brand: z.string().max(100).optional(),
  sellingPrice: z.coerce.number().positive('sellingPrice must be > 0'),
  costPrice: z.coerce.number().nonnegative().optional(),
  minSalePrice: z.coerce.number().nonnegative().optional(),
});

export const OpeningStockSchema = z.object({
  itemSku: z.string().min(1, 'itemSku is required'),
  warehouseName: z.string().min(1, 'warehouseName is required'),
  quantity: z.coerce.number().nonnegative(),
  costPerUnit: z.coerce.number().nonnegative(),
});

export const OpeningBalanceSchema = z.object({
  accountCode: z.string().min(1, 'accountCode is required'),
  accountName: z.string().min(1, 'accountName is required'),
  debit: z.coerce.number().nonnegative(),
  credit: z.coerce.number().nonnegative(),
  narration: z.string().optional(),
});

const SCHEMAS: Record<string, z.ZodSchema> = {
  customers: CustomerSchema,
  suppliers: SupplierSchema,
  items: ItemSchema,
  'opening-stock': OpeningStockSchema,
  'opening-balances': OpeningBalanceSchema,
};

// ── Validator ─────────────────────────────────────────────────────────────────

export function validateRows(
  entity: MigrationEntity,
  rows: Record<string, unknown>[],
): ValidationResult {
  const schema = SCHEMAS[entity];
  if (!schema) {
    return {
      entity,
      totalRows: rows.length,
      validRows: 0,
      errorRows: rows.length,
      errors: [{ row: 0, field: 'entity', value: entity, message: `No schema for entity: ${entity}` }],
    };
  }

  const errors: ValidationError[] = [];
  let validRows = 0;

  rows.forEach((row, idx) => {
    const result = schema.safeParse(row);
    if (result.success) {
      validRows++;
    } else {
      result.error.issues.forEach((issue) => {
        errors.push({
          row: idx + 2, // +2 because row 1 = header
          field: issue.path.join('.'),
          value: row[issue.path[0] as string],
          message: issue.message,
        });
      });
    }
  });

  return {
    entity,
    totalRows: rows.length,
    validRows,
    errorRows: rows.length - validRows,
    errors,
  };
}

export function printValidationResult(result: ValidationResult): void {
  console.log(`\n── Validation Report: ${result.entity} ─────────────────`);
  console.log(`  Total rows : ${result.totalRows}`);
  console.log(`  Valid rows : ${result.validRows}`);
  console.log(`  Error rows : ${result.errorRows}`);

  if (result.errors.length > 0) {
    console.log(`\n  Errors (first 50):`);
    result.errors.slice(0, 50).forEach((e) => {
      console.log(`    Row ${e.row} | ${e.field}: ${e.message} (got: ${JSON.stringify(e.value)})`);
    });
    if (result.errors.length > 50) {
      console.log(`    ... and ${result.errors.length - 50} more errors`);
    }
  }
}
