import { z } from 'zod';

// CRM-ROADMAP Phase 2, Feature 1 — Sales Pipeline & Opportunity Management.

export const opportunityFormSchema = z.object({
  name: z.string().min(2, 'Must be at least 2 characters').max(300),
  dealType: z.string().max(50).optional(),
  value: z.coerce.number().nonnegative('Must be zero or more'),
  expectedCloseDate: z.string().optional(),
  customerId: z.coerce.number().int().positive().optional(),
  accountId: z.coerce.number().int().positive().optional(),
  branchId: z.coerce.number().int().positive().optional(),
  notes: z.string().max(2000).optional(),
});

export type OpportunityFormData = z.infer<typeof opportunityFormSchema>;

export const markWonFormSchema = z.object({
  branchId: z.coerce.number().int().positive('Required'),
  placeOfSupply: z.string().length(2, 'Two-letter state code required'),
  sellerStateCode: z.string().length(2, 'Two-letter state code required'),
  validUntil: z.string().min(1, 'Required'),
});

export type MarkWonFormData = z.infer<typeof markWonFormSchema>;
