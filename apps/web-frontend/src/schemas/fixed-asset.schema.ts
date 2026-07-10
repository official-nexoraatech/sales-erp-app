import { z } from 'zod';

// Mirrors CreateAssetSchema in apps/accounting-service/src/api/fixed-assets.routes.ts —
// keep in sync so the frontend never accepts what the backend will reject.
export const ASSET_CATEGORIES = ['BUILDING', 'MACHINERY', 'COMPUTER', 'VEHICLE', 'FURNITURE', 'OTHER'] as const;

const blankToUndefined = (v: unknown) => (v === '' || v === null ? undefined : v);

export const fixedAssetFormSchema = z.object({
  assetCode: z.string().min(1, 'Required').max(30, 'Must be 30 characters or fewer'),
  assetName: z.string().min(1, 'Required').max(300, 'Must be 300 characters or fewer'),
  assetCategory: z.string().min(1, 'Required'),
  purchaseDate: z.string().length(10, 'Required'),
  purchaseCost: z.coerce.number().positive('Must be greater than 0'),
  salvageValue: z.coerce.number().min(0, 'Cannot be negative'),
  usefulLifeMonths: z.coerce.number().int('Must be a whole number').positive('Must be greater than 0'),
  depreciationMethod: z.enum(['SLM', 'WDV'], { errorMap: () => ({ message: 'Required' }) }),
  wdvRate: z.preprocess(blankToUndefined, z.coerce.number().positive('Must be greater than 0').optional()),
  assetAccountId: z.preprocess(blankToUndefined, z.coerce.number({ invalid_type_error: 'Required' }).int().positive('Required')),
  depreciationExpenseAccountId: z.preprocess(blankToUndefined, z.coerce.number({ invalid_type_error: 'Required' }).int().positive('Required')),
  accumulatedDepreciationAccountId: z.preprocess(blankToUndefined, z.coerce.number({ invalid_type_error: 'Required' }).int().positive('Required')),
}).superRefine((data, ctx) => {
  if (data.depreciationMethod === 'WDV' && !data.wdvRate) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['wdvRate'], message: 'Required for WDV method' });
  }
});

export type FixedAssetFormData = z.infer<typeof fixedAssetFormSchema>;
