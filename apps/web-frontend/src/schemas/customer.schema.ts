import { z } from 'zod';
import { OptionalGSTINSchema, OptionalPANSchema, PincodeSchema } from '@erp/types';

// Mirrors CustomerSchema in apps/sales-service/src/api/customer.routes.ts —
// keep in sync so the frontend never accepts what the backend will reject.
export const CUSTOMER_TYPES = ['RETAIL', 'WHOLESALE', 'B2B', 'GOVERNMENT', 'EXPORT'] as const;

const blankToUndefined = (v: unknown) => (v === '' || v === null ? undefined : v);

export const customerFormSchema = z
  .object({
    displayName: z.string().min(2, 'Must be at least 2 characters').max(200, 'Must be 200 characters or fewer'),
    customerType: z.enum(CUSTOMER_TYPES, { errorMap: () => ({ message: 'Required' }) }),
    branchId: z.preprocess(blankToUndefined, z.coerce.number({ invalid_type_error: 'Required' }).int().positive('Required')),
    phone: z.string().min(10, 'Phone must be at least 10 digits').max(20, 'Phone must be 20 characters or fewer'),
    email: z.string().email('Invalid email address').max(255).optional().or(z.literal('')),
    gstin: OptionalGSTINSchema,
    pan: OptionalPANSchema,
    creditLimit: z.coerce.number().min(0, 'Cannot be negative').optional(),
    creditDays: z.coerce.number().int().min(0, 'Cannot be negative').optional(),
    openingBalance: z.coerce.number().min(0, 'Cannot be negative').optional(),
    'billingAddress.addressLine1': z.string().optional(),
    'billingAddress.city': z.string().optional(),
    'billingAddress.state': z.string().optional(),
    'billingAddress.pinCode': PincodeSchema.optional().or(z.literal('')),
  })
  // The backend's billingAddress is all-or-nothing (line1/city/state/pincode are all
  // required once the object is present) — enforce that here instead of letting a
  // partially-filled address 422 after round-tripping to the server.
  .superRefine((data, ctx) => {
    const fields = [
      'billingAddress.addressLine1',
      'billingAddress.city',
      'billingAddress.state',
      'billingAddress.pinCode',
    ] as const;
    const anyFilled = fields.some((f) => !!data[f]);
    if (!anyFilled) return;
    for (const f of fields) {
      if (!data[f]) ctx.addIssue({ code: z.ZodIssueCode.custom, path: [f], message: 'Required when any billing address field is filled' });
    }
  });

export type CustomerFormData = z.infer<typeof customerFormSchema>;
