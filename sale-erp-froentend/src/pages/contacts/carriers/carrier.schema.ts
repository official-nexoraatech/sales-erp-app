import { z } from 'zod';
import { optionalMobileNumberSchema, WHATSAPP_VALIDATION_MESSAGE } from '../../../utils/validation';

export const carrierSchema = z.object({
  name: z.string().min(1, 'Carrier name is required').max(150),
  email: z.string().email('Invalid email').optional().or(z.literal('')),
  mobile: optionalMobileNumberSchema(),
  whatsappNo: optionalMobileNumberSchema(WHATSAPP_VALIDATION_MESSAGE),
  status: z.enum(['ACTIVE', 'INACTIVE']),
  address: z.string().optional().or(z.literal('')),
  note: z.string().optional().or(z.literal('')),
});

export type CarrierFormData = z.infer<typeof carrierSchema>;
