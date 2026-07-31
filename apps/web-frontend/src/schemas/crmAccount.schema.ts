import { z } from 'zod';
import { OptionalGSTINSchema, PincodeSchema } from '@erp/types';

// Mirrors AccountSchema/ContactSchema in apps/sales-service/src/api/account.routes.ts —
// keep in sync so the frontend never accepts what the backend will reject. Named
// CRM_ACCOUNT_TYPES/crmAccountFormSchema, not ACCOUNT_TYPES/accountFormSchema — those names
// are already taken by schemas/account.schema.ts, the unrelated Chart of Accounts form.
export const CRM_ACCOUNT_TYPES = [
  'B2B',
  'WHOLESALE',
  'DISTRIBUTOR',
  'CORPORATE',
  'INDIVIDUAL',
] as const;
export const CRM_CONTACT_ROLES = [
  'BILLING',
  'DECISION_MAKER',
  'SHIPPING',
  'PRIMARY',
  'OTHER',
] as const;

const blankToUndefined = (v: unknown) => (v === '' || v === null ? undefined : v);

export const crmAccountFormSchema = z.object({
  name: z
    .string()
    .min(2, 'Must be at least 2 characters')
    .max(300, 'Must be 300 characters or fewer'),
  accountType: z.enum(CRM_ACCOUNT_TYPES, { errorMap: () => ({ message: 'Required' }) }),
  primaryPhone: z.string().max(20).optional(),
  primaryEmail: z.string().email('Invalid email address').max(255).optional().or(z.literal('')),
  gstin: OptionalGSTINSchema,
  'billingAddress.line1': z.string().optional(),
  'billingAddress.city': z.string().optional(),
  'billingAddress.state': z.string().optional(),
  'billingAddress.pincode': PincodeSchema.optional().or(z.literal('')),
  notes: z.string().max(5000).optional(),
});

export type CrmAccountFormData = z.infer<typeof crmAccountFormSchema>;

export const crmContactFormSchema = z.object({
  name: z.string().min(1, 'Required').max(200),
  role: z.enum(CRM_CONTACT_ROLES, { errorMap: () => ({ message: 'Required' }) }),
  email: z.string().email('Invalid email address').max(255).optional().or(z.literal('')),
  phone: z.preprocess(blankToUndefined, z.string().max(20).optional()),
  isPrimary: z.boolean().default(false),
  notes: z.string().max(2000).optional(),
});

export type CrmContactFormData = z.infer<typeof crmContactFormSchema>;
