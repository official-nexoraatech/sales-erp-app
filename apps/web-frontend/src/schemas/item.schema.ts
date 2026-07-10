import { z } from 'zod';
import { HSN_REGEX } from '@erp/types';

// Mirrors ItemSchema in apps/inventory-service/src/api/item.routes.ts — keep
// in sync so the frontend never accepts what the backend will reject.
export const GST_RATES = [0, 5, 12, 18, 28] as const;

// Number <Input>/<Select> fields submit '' when left blank; treat that as
// "not provided" before coercion so it doesn't become 0 or NaN.
const blankToUndefined = (v: unknown) => (v === '' || v === null ? undefined : v);
const optionalNonNegative = (message = 'Cannot be negative') =>
  z.preprocess(blankToUndefined, z.coerce.number().min(0, message).optional());

export const itemFormSchema = z.object({
  name: z.string().min(2, 'Must be at least 2 characters').max(300, 'Must be 300 characters or fewer'),
  itemCode: z.string().max(50, 'Must be 50 characters or fewer').optional(),
  hsnCode: z.string().regex(HSN_REGEX, 'HSN code must be 4, 6, or 8 digits'),
  gstRate: z.coerce.number().refine((v) => (GST_RATES as readonly number[]).includes(v), {
    message: 'GST rate must be one of: 0, 5, 12, 18, 28',
  }),
  cessRate: optionalNonNegative().refine((v) => v === undefined || v <= 100, 'Cannot exceed 100'),
  categoryId: z.preprocess(blankToUndefined, z.coerce.number().int().positive().optional()),
  brandId: z.preprocess(blankToUndefined, z.coerce.number().int().positive().optional()),
  unitId: z.preprocess(blankToUndefined, z.coerce.number({ invalid_type_error: 'Required' }).int().positive('Required')),
  mrp: optionalNonNegative(),
  salePrice: optionalNonNegative(),
  minSalePrice: optionalNonNegative(),
  purchasePrice: optionalNonNegative(),
  reorderLevel: optionalNonNegative(),
  barcode: z.string().max(100, 'Must be 100 characters or fewer').optional(),
  barcodeType: z.string().optional(),
  trackInventory: z.boolean().optional(),
  isFabricItem: z.boolean().optional(),
  fabricWidth: optionalNonNegative(),
  description: z.string().max(5000, 'Must be 5000 characters or fewer').optional(),
});

export type ItemFormData = z.infer<typeof itemFormSchema>;
