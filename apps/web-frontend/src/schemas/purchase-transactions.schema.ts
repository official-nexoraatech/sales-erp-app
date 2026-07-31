import { z } from 'zod';

export const purchaseInvoiceFormSchema = z.object({
  grnId: z.number({ invalid_type_error: 'Select a GRN' }).positive('Select a GRN'),
  supplierInvoiceNumber: z.string().trim().min(1, 'Required'),
  invoiceDate: z.string().min(1, 'Required'),
});
export type PurchaseInvoiceFormData = z.infer<typeof purchaseInvoiceFormSchema>;

export const purchaseOrderLineSchema = z.object({
  itemId: z.number().int().positive(),
  orderedQty: z.number().positive('Qty must be greater than 0'),
  unitPrice: z.number().min(0, 'Cannot be negative'),
  discountPct: z.number().min(0, 'Cannot be negative').max(100, 'Cannot exceed 100%'),
  gstRate: z.number().min(0, 'Cannot be negative'),
});

export const purchaseOrderFormSchema = z.object({
  supplierId: z.number({ invalid_type_error: 'Select a supplier' }).positive('Select a supplier'),
  branchId: z.number({ invalid_type_error: 'Select a branch' }).positive('Select a branch'),
  warehouseId: z
    .number({ invalid_type_error: 'Select a warehouse' })
    .positive('Select a warehouse'),
  poDate: z.string().min(1, 'Required'),
  placeOfSupply: z.string().min(1, 'Select a state'),
  sellerStateCode: z.string().min(1, 'Select a state'),
  lines: z.array(purchaseOrderLineSchema).min(1, 'Add at least one item'),
});
export type PurchaseOrderFormData = z.infer<typeof purchaseOrderFormSchema>;

export const purchaseReturnLineSchema = z.object({
  grnLineId: z.number().int().positive(),
  itemId: z.number().int().positive(),
  quantity: z.number().positive('Qty must be greater than 0'),
});

export const purchaseReturnFormSchema = z.object({
  grnId: z.number({ invalid_type_error: 'Select a GRN' }).positive('Select a GRN'),
  reason: z.string().min(1, 'Select a reason'),
  lines: z.array(purchaseReturnLineSchema).min(1, 'Select at least one item to return'),
});
export type PurchaseReturnFormData = z.infer<typeof purchaseReturnFormSchema>;

export const requisitionLineSchema = z.object({
  itemId: z.number().int().positive(),
  quantity: z.number().positive('Qty must be greater than 0'),
});

export const requisitionFormSchema = z.object({
  branchId: z.number({ invalid_type_error: 'Select a branch' }).positive('Select a branch'),
  lines: z.array(requisitionLineSchema).min(1, 'Add at least one item'),
});
export type RequisitionFormData = z.infer<typeof requisitionFormSchema>;

export const rfqLineSchema = z.object({
  itemId: z.number().int().positive(),
  quantity: z.number().positive('Qty must be greater than 0'),
});

export const rfqFormSchema = z.object({
  branchId: z.number({ invalid_type_error: 'Select a branch' }).positive('Select a branch'),
  lines: z.array(rfqLineSchema).min(1, 'Add at least one item'),
});
export type RfqFormData = z.infer<typeof rfqFormSchema>;

export const grnLineSchema = z.object({
  purchaseOrderLineId: z.number().int().positive(),
  itemId: z.number().int().positive(),
  receivedQty: z.number().min(0, 'Cannot be negative'),
});

export const grnFormSchema = z.object({
  purchaseOrderId: z
    .number({ invalid_type_error: 'Load a purchase order' })
    .positive('Load a purchase order'),
  warehouseId: z
    .number({ invalid_type_error: 'Select a warehouse' })
    .positive('Select a warehouse'),
  grnDate: z.string().min(1, 'Required'),
  lines: z.array(grnLineSchema).refine((lines) => lines.length > 0, {
    message: 'Enter received quantity for at least one line',
  }),
});
export type GRNFormData = z.infer<typeof grnFormSchema>;
