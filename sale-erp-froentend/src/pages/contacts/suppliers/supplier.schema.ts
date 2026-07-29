import { z } from 'zod';
import { optionalMobileNumberSchema, requiredMobileNumberSchema, PHONE_VALIDATION_MESSAGE, WHATSAPP_VALIDATION_MESSAGE } from '../../../utils/validation';

const optionalAmount = z.preprocess(
  (value) => (value === '' || value == null ? undefined : String(value).trim()),
  z.string()
    .regex(/^-?(?:\d+|\d*\.\d+)$/, 'Enter a valid number')
    .transform(Number)
    .pipe(z.number().min(0, 'Amount cannot be negative'))
    .optional()
);

export const supplierSchema = z.object({
  firstName: z.string().min(2, 'First name must have at least 2 characters').max(100),
  lastName: z.string().min(2, 'Last name must have at least 2 characters').max(100),
  email: z.string().email('Invalid email').max(150).optional().or(z.literal('')),
  phone: optionalMobileNumberSchema(PHONE_VALIDATION_MESSAGE),
  mobile: requiredMobileNumberSchema(),
  whatsappNo: optionalMobileNumberSchema(WHATSAPP_VALIDATION_MESSAGE),
  gstNumber: z
    .string()
    .regex(/^$|^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/, 'Invalid GST number')
    .optional()
    .or(z.literal('')),
  state: z.string().optional().or(z.literal('')),
  status: z.enum(['ACTIVE', 'INACTIVE']),
  isDefaultSupplier: z.boolean(),
  billingAddress: z.string().optional().or(z.literal('')),
  shippingName: z.string().optional().or(z.literal('')),
  shippingMobile: optionalMobileNumberSchema(),
  shippingEmail: z.string().email('Invalid shipping email').optional().or(z.literal('')),
  shippingGstin: z.string().optional().or(z.literal('')),
  shippingAddress: z.string().optional().or(z.literal('')),
  creditLimit: optionalAmount,
  openingBalance: optionalAmount,
});

export type SupplierFormData = z.infer<typeof supplierSchema>;
export type SupplierFormInput = z.input<typeof supplierSchema>;

export const toSupplierRequest = (data: SupplierFormData) => ({
  firstName: data.firstName,
  lastName: data.lastName,
  mobile: data.mobile,
  whatsappNo: data.whatsappNo || data.mobile,
  email: data.email || '',
  gstNumber: data.gstNumber || '',
  creditLimit: data.creditLimit ?? 0,
  openingBalance: data.openingBalance ?? 0,
});
