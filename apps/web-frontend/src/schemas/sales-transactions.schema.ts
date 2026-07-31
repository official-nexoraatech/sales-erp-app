import { z } from 'zod';

// Shared by Invoice/Quotation/Sale Return line items — each document adds its own
// document-level required fields on top of this.
export const saleLineSchema = z.object({
  itemId: z.number().int().positive(),
  quantity: z.number().positive('Qty must be greater than 0'),
  unitPrice: z.number().min(0, 'Cannot be negative'),
  discountPct: z.number().min(0, 'Cannot be negative').max(100, 'Cannot exceed 100%'),
  gstRate: z.number().min(0, 'Cannot be negative'),
});

export const invoiceFormSchema = z.object({
  customerId: z.number({ invalid_type_error: 'Select a customer' }).positive('Select a customer'),
  branchId: z.number({ invalid_type_error: 'Select a branch' }).positive('Select a branch'),
  warehouseId: z
    .number({ invalid_type_error: 'Select a warehouse' })
    .positive('Select a warehouse'),
  placeOfSupply: z.string().min(1, 'Select a state'),
  invoiceDate: z.string().min(1, 'Required'),
  dueDate: z.string().min(1, 'Required'),
  lines: z.array(saleLineSchema).min(1, 'Add at least one item'),
});
export type InvoiceFormData = z.infer<typeof invoiceFormSchema>;

export const quotationFormSchema = z.object({
  customerId: z.number({ invalid_type_error: 'Select a customer' }).positive('Select a customer'),
  branchId: z.number({ invalid_type_error: 'Select a branch' }).positive('Select a branch'),
  placeOfSupply: z.string().min(1, 'Select a state'),
  validUntil: z.string().min(1, 'Required'),
  lines: z.array(saleLineSchema).min(1, 'Add at least one item'),
});
export type QuotationFormData = z.infer<typeof quotationFormSchema>;

export const deliveryChallanLineSchema = z.object({
  itemId: z.number().int().positive(),
  quantity: z.number().positive('Qty must be greater than 0'),
});

export const deliveryChallanFormSchema = z.object({
  customerId: z.number({ invalid_type_error: 'Select a customer' }).positive('Select a customer'),
  branchId: z.number({ invalid_type_error: 'Select a branch' }).positive('Select a branch'),
  warehouseId: z
    .number({ invalid_type_error: 'Select a warehouse' })
    .positive('Select a warehouse'),
  challanDate: z.string().min(1, 'Required'),
  lines: z.array(deliveryChallanLineSchema).min(1, 'Add at least one item'),
});
export type DeliveryChallanFormData = z.infer<typeof deliveryChallanFormSchema>;

export const saleReturnLineSchema = z.object({
  invoiceLineId: z.number().int().positive(),
  itemId: z.number().int().positive(),
  quantity: z.number().positive('Qty must be greater than 0'),
});

export const saleReturnFormSchema = z.object({
  invoiceId: z.number({ invalid_type_error: 'Select an invoice' }).positive('Select an invoice'),
  reason: z.string().min(1, 'Select a reason'),
  lines: z.array(saleReturnLineSchema).min(1, 'Select at least one item to return'),
});
export type SaleReturnFormData = z.infer<typeof saleReturnFormSchema>;
