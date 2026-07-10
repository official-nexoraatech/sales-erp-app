import { z } from 'zod';
import { OptionalIFSCSchema, OptionalBankAccountSchema } from '@erp/types';

// Mirrors AccountSchema in apps/accounting-service/src/api/accounts.routes.ts —
// keep in sync so the frontend never accepts what the backend will reject.
export const ACCOUNT_TYPES = ['ASSET', 'LIABILITY', 'EQUITY', 'INCOME', 'EXPENSE', 'CONTRA'] as const;

const blankToUndefined = (v: unknown) => (v === '' || v === null ? undefined : v);

export const accountFormSchema = z.object({
  accountCode: z.string().min(1, 'Required').max(30, 'Must be 30 characters or fewer'),
  name: z.string().min(2, 'Must be at least 2 characters').max(300, 'Must be 300 characters or fewer'),
  accountType: z.enum(ACCOUNT_TYPES, { errorMap: () => ({ message: 'Required' }) }),
  normalBalance: z.enum(['DEBIT', 'CREDIT'], { errorMap: () => ({ message: 'Required' }) }),
  parentId: z.preprocess(blankToUndefined, z.coerce.number().int().positive().optional()),
  openingBalance: z.coerce.number().min(0, 'Cannot be negative').optional(),
  isBank: z.boolean().optional(),
  isCash: z.boolean().optional(),
  bankName: z.string().max(200).optional(),
  bankAccountNo: OptionalBankAccountSchema,
  bankIfsc: OptionalIFSCSchema,
});

export type AccountFormData = z.infer<typeof accountFormSchema>;
