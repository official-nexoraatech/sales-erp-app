import { z } from 'zod';

export const stockAdjustmentLineSchema = z.object({
  itemId: z.number().int().positive(),
  direction: z.enum(['IN', 'OUT']),
  quantity: z.number().positive('Qty must be greater than 0'),
});

export const stockAdjustmentFormSchema = z.object({
  warehouseId: z
    .number({ invalid_type_error: 'Select a warehouse' })
    .positive('Select a warehouse'),
  adjustmentType: z.string().min(1, 'Required'),
  lines: z.array(stockAdjustmentLineSchema).min(1, 'Add at least one item'),
});
export type StockAdjustmentFormData = z.infer<typeof stockAdjustmentFormSchema>;

export const stockTransferLineSchema = z.object({
  itemId: z.number().int().positive(),
  quantity: z.number().positive('Qty must be greater than 0'),
});

export const stockTransferFormSchema = z
  .object({
    fromWarehouseId: z
      .number({ invalid_type_error: 'Select a source warehouse' })
      .positive('Select a source warehouse'),
    toWarehouseId: z
      .number({ invalid_type_error: 'Select a destination warehouse' })
      .positive('Select a destination warehouse'),
    lines: z.array(stockTransferLineSchema).min(1, 'Add at least one item'),
  })
  .refine((data) => data.fromWarehouseId !== data.toWarehouseId, {
    message: 'Source and destination warehouse must be different',
    path: ['toWarehouseId'],
  });
export type StockTransferFormData = z.infer<typeof stockTransferFormSchema>;
