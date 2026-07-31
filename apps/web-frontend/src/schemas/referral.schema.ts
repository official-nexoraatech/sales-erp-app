import { z } from 'zod';

// Mirrors RedeemSchema in apps/sales-service/src/api/referral-public.routes.ts.
export const referralRedeemFormSchema = z.object({
  refereeName: z.string().max(200).optional(),
  refereePhone: z.string().min(10, 'Phone must be at least 10 digits').max(20),
  // Honeypot — never shown to a real user, see the CSS in ReferralLandingPage.tsx.
  hp: z.string().max(0).optional(),
});

export type ReferralRedeemFormData = z.infer<typeof referralRedeemFormSchema>;
