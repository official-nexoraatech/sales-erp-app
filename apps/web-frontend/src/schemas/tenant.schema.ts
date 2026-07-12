import { z } from 'zod';

// Mirrors CreateTenantSchema in apps/tenant-service/src/api/tenant.schemas.ts —
// keep in sync so the frontend never accepts what the backend will reject.
export const TENANT_PLANS = ['STARTER', 'GROWTH', 'ENTERPRISE'] as const;

export const tenantFormSchema = z.object({
  name: z
    .string()
    .min(2, 'Must be at least 2 characters')
    .max(200, 'Must be 200 characters or fewer'),
  slug: z
    .string()
    .min(3, 'Must be at least 3 characters')
    .max(100, 'Must be 100 characters or fewer')
    .regex(/^[a-z0-9-]+$/, 'Lowercase letters, numbers, and hyphens only'),
  contactEmail: z.string().email('Invalid email address'),
  contactPhone: z
    .string()
    .min(10, 'Phone must be at least 10 digits')
    .max(15)
    .optional()
    .or(z.literal('')),
  plan: z.enum(TENANT_PLANS),
  adminFirstName: z.string().min(1, 'Required').max(100),
  adminLastName: z.string().min(1, 'Required').max(100),
  adminPassword: z.string().min(12, 'Must be at least 12 characters').max(128),
  timezone: z.string().optional().or(z.literal('')),
  currency: z.string().optional().or(z.literal('')),
  country: z.string().optional().or(z.literal('')),
});

export type TenantFormData = z.infer<typeof tenantFormSchema>;
