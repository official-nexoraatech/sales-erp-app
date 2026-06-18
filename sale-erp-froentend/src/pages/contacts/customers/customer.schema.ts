import { z } from 'zod';
import type { CreateCustomerRequest } from '../../../types/customer.types';

const optionalAmount = z.preprocess(
  (value) => (value === '' || value == null ? undefined : Number(value)),
  z.number().min(0, 'Amount cannot be negative').optional()
);

const optionalText = (max: number) => z.string().max(max).optional().or(z.literal(''));

const hasAddressValue = (address: {
  addressLine1?: string;
  addressLine2?: string;
  city?: string;
  stateId?: number;
  countryId?: number;
  pincode?: string;
}) => Boolean(
  address.addressLine1?.trim() ||
  address.addressLine2?.trim() ||
  address.city?.trim() ||
  address.pincode?.trim() ||
  address.stateId ||
  address.countryId
);

const addressSchema = z.object({
  addressLine1: optionalText(250),
  addressLine2: optionalText(250),
  city: optionalText(100),
  stateId: z.preprocess((value) => Number(value || 0), z.number().int()),
  countryId: z.preprocess((value) => Number(value || 0), z.number().int()),
  pincode: z.string().optional().or(z.literal('')),
}).superRefine((address, context) => {
  if (!hasAddressValue(address)) return;

  if (!address.addressLine1?.trim()) {
    context.addIssue({ code: 'custom', path: ['addressLine1'], message: 'Address line 1 is required' });
  }
  if (!address.city?.trim()) {
    context.addIssue({ code: 'custom', path: ['city'], message: 'City is required' });
  }
  if (!address.countryId) {
    context.addIssue({ code: 'custom', path: ['countryId'], message: 'Please select a valid option' });
  }
  if (!address.stateId) {
    context.addIssue({ code: 'custom', path: ['stateId'], message: 'Please select a valid option' });
  }
  if (!/^[0-9]{5,10}$/.test(address.pincode || '')) {
    context.addIssue({ code: 'custom', path: ['pincode'], message: 'Pincode must contain 5 to 10 digits' });
  }
});

export const customerSchema = z.object({
  companyName: z.string().max(150).optional().or(z.literal('')),
  firstName: z.string().min(2, 'First name must have at least 2 characters').max(100),
  lastName: z.string().min(2, 'Last name must have at least 2 characters').max(100),
  email: z.string().email('Invalid email').max(150).optional().or(z.literal('')),
  phone: z.string().max(20).optional().or(z.literal('')),
  mobile: z.string().regex(/^[0-9]{10,15}$/, 'Mobile must contain 10 to 15 digits'),
  whatsappNo: z.string().regex(/^[0-9]{10,15}$/, 'WhatsApp number must contain 10 to 15 digits'),
  gstNumber: z.string().regex(/^$|^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/, 'Invalid GST number').optional().or(z.literal('')),
  panNumber: z.string().regex(/^$|^[A-Z]{5}[0-9]{4}[A-Z]$/, 'Invalid PAN number').optional().or(z.literal('')),
  creditLimit: optionalAmount,
  openingBalance: optionalAmount,
  openingBalanceType: z.enum(['', 'RECEIVABLE', 'PAYABLE']),
  isWholesale: z.boolean(),
  billingAddress: addressSchema,
  shippingAddress: addressSchema,
});

export type CustomerFormData = z.infer<typeof customerSchema>;
export type CustomerFormInput = z.input<typeof customerSchema>;

const normalizeAddress = (address: CustomerFormData['billingAddress']) => {
  if (!hasAddressValue(address)) return undefined;
  return {
    addressLine1: address.addressLine1?.trim() || '',
    addressLine2: address.addressLine2?.trim() || '',
    city: address.city?.trim() || '',
    stateId: address.stateId,
    countryId: address.countryId,
    pincode: address.pincode?.trim() || '',
  };
};

export const toCustomerRequest = (data: CustomerFormData): CreateCustomerRequest => {
  const billingAddress = normalizeAddress(data.billingAddress);
  const shippingAddress = normalizeAddress(data.shippingAddress);

  return {
    companyName: data.companyName || '',
    firstName: data.firstName,
    lastName: data.lastName,
    email: data.email || '',
    phone: data.phone || '',
    mobile: data.mobile,
    whatsappNo: data.whatsappNo,
    gstNumber: data.gstNumber || '',
    panNumber: data.panNumber || '',
    creditLimit: data.creditLimit ?? 0,
    openingBalance: data.openingBalance ?? 0,
    openingBalanceType: data.openingBalanceType,
    isWholesale: data.isWholesale,
    ...(billingAddress ? { billingAddress } : {}),
    ...(shippingAddress ? { shippingAddress } : {}),
  };
};
