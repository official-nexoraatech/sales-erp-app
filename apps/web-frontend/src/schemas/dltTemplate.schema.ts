import { z } from 'zod';

// Mirrors DltTemplateSchema in apps/sales-service/src/api/dlt-template.routes.ts.
export const dltTemplateFormSchema = z.object({
  templateId: z.string().min(1, 'Required').max(50),
  header: z.string().min(1, 'Required').max(20),
  messagePattern: z.string().min(1, 'Required').max(2000),
  isActive: z.boolean().default(true),
});

export type DltTemplateFormData = z.infer<typeof dltTemplateFormSchema>;
