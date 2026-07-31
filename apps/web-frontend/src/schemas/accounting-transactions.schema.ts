import { z } from 'zod';

export const journalLineSchema = z.object({
  accountId: z.number().int().positive(),
  debitAmount: z.number().min(0),
  creditAmount: z.number().min(0),
});

export const journalFormSchema = z.object({
  description: z.string().trim().min(1, 'Required'),
  lines: z
    .array(journalLineSchema)
    .min(2, 'A journal requires at least 2 lines, each with an account and an amount'),
});
export type JournalFormData = z.infer<typeof journalFormSchema>;
