import { z } from 'zod';

const optionalAmount = z.preprocess(
  (value) => (value === '' || value == null ? undefined : Number(value)),
  z.number().min(0, 'Amount cannot be negative').optional()
);

export const supplierSchema = z.object({
  companyName: z.string().max(150, 'Company name cannot exceed 150 characters').optional().or(z.literal('')),
  firstName: z.string().min(2, 'First name must have at least 2 characters').max(100),
  lastName: z.string().min(2, 'Last name must have at least 2 characters').max(100),
  email: z.string().email('Invalid email').max(150).optional().or(z.literal('')),
  phone: z.string().optional().or(z.literal('')),
  mobile: z.string().regex(/^[0-9]{10,15}$/, 'Mobile must contain 10 to 15 digits'),
  whatsappNo: z.string().optional().or(z.literal('')),
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
  shippingMobile: z.string().optional().or(z.literal('')),
  shippingEmail: z.string().email('Invalid shipping email').optional().or(z.literal('')),
  shippingGstin: z.string().optional().or(z.literal('')),
  shippingAddress: z.string().optional().or(z.literal('')),
  creditLimit: optionalAmount,
  openingBalance: optionalAmount,
});

export type SupplierFormData = z.infer<typeof supplierSchema>;
export type SupplierFormInput = z.input<typeof supplierSchema>;

export const toSupplierRequest = (data: SupplierFormData) => ({
  companyName: data.companyName || '',
  firstName: data.firstName,
  lastName: data.lastName,
  mobile: data.mobile,
  email: data.email || '',
  gstNumber: data.gstNumber || '',
  creditLimit: data.creditLimit ?? 0,
  openingBalance: data.openingBalance ?? 0,
});
