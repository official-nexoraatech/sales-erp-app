import { z } from 'zod';

export const carrierSchema = z.object({
  name: z.string().min(1, 'Carrier name is required').max(150),
  email: z.string().email('Invalid email').optional().or(z.literal('')),
  mobile: z.string().optional().or(z.literal('')),
  whatsappNo: z.string().optional().or(z.literal('')),
  status: z.enum(['ACTIVE', 'INACTIVE']),
  address: z.string().optional().or(z.literal('')),
  note: z.string().optional().or(z.literal('')),
});

export type CarrierFormData = z.infer<typeof carrierSchema>;
