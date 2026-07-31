import { z } from 'zod';

// Mirrors LeadCreateSchema/CaptureSchema in apps/sales-service/src/api/lead.routes.ts.
export const LEAD_SOURCES = [
  'WEBSITE',
  'REFERRAL',
  'WALK_IN',
  'SOCIAL_MEDIA',
  'ADVERTISEMENT',
  'PHONE_INQUIRY',
  'OTHER',
] as const;
export const LEAD_STAGES = ['NEW', 'CONTACTED', 'QUALIFIED', 'CONVERTED', 'LOST'] as const;

export const leadFormSchema = z.object({
  displayName: z.string().max(200).optional(),
  companyName: z.string().max(300).optional(),
  phone: z.string().min(10, 'Phone must be at least 10 digits').max(20),
  email: z.string().email('Invalid email address').max(255).optional().or(z.literal('')),
  source: z.enum(LEAD_SOURCES).default('OTHER'),
  isB2b: z.boolean().default(false),
  notes: z.string().max(2000).optional(),
});

export type LeadFormData = z.infer<typeof leadFormSchema>;

// Public capture form — same shape minus the staff-only fields, plus the honeypot.
export const leadCaptureFormSchema = z.object({
  displayName: z.string().max(200).optional(),
  companyName: z.string().max(300).optional(),
  phone: z.string().min(10, 'Phone must be at least 10 digits').max(20),
  email: z.string().email('Invalid email address').max(255).optional().or(z.literal('')),
  notes: z.string().max(2000).optional(),
  // Honeypot — never shown to a real user, see the CSS in LeadCapturePage.tsx.
  hp: z.string().max(0).optional(),
});

export type LeadCaptureFormData = z.infer<typeof leadCaptureFormSchema>;
