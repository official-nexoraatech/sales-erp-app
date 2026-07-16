import { z } from 'zod';

export const CreateTenantSchema = z.object({
  name: z.string().min(2).max(200),
  slug: z
    .string()
    .min(3)
    .max(100)
    .regex(/^[a-z0-9-]+$/, 'Slug must be lowercase alphanumeric with hyphens'),
  contactEmail: z.string().email(),
  contactPhone: z.string().min(10).max(15).optional(),
  plan: z.enum(['STARTER', 'GROWTH', 'ENTERPRISE']).optional().default('STARTER'),
  adminFirstName: z.string().min(1).max(100),
  adminLastName: z.string().min(1).max(100),
  adminPassword: z.string().min(12, 'Admin password must be at least 12 characters').max(128),
  orgSettings: z
    .object({
      timezone: z.string().optional(),
      currency: z.string().optional(),
      country: z.string().optional(),
    })
    .optional(),
});

// Self-serve public signup — mirrors CreateTenantSchema's field conventions but drops
// platform-operator-only fields (plan, contactPhone, orgSettings): self-serve always starts
// on STARTER, chosen server-side, not by the caller.
export const PublicSignupSchema = z.object({
  name: z.string().min(2).max(200),
  slug: z
    .string()
    .min(3)
    .max(100)
    .regex(/^[a-z0-9-]+$/, 'Slug must be lowercase alphanumeric with hyphens'),
  contactEmail: z.string().email(),
  adminFirstName: z.string().min(1).max(100),
  adminLastName: z.string().min(1).max(100),
  adminPassword: z.string().min(12, 'Password must be at least 12 characters').max(128),
});

export const SuspendTenantSchema = z.object({
  reason: z.string().min(5).max(500),
});

export const CloseTenantSchema = z.object({
  reason: z.string().min(5).max(500),
  confirmation: z.literal('CLOSE_TENANT'),
});

// PG-028
export const UsagePeriodQuerySchema = z.object({
  period: z
    .string()
    .regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Period must be in YYYY-MM format')
    .optional(),
});

export type CreateTenantInput = z.infer<typeof CreateTenantSchema>;
export type SuspendTenantInput = z.infer<typeof SuspendTenantSchema>;
export type CloseTenantInput = z.infer<typeof CloseTenantSchema>;
export type UsagePeriodQueryInput = z.infer<typeof UsagePeriodQuerySchema>;
