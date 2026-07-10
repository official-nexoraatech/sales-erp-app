import { z } from 'zod';

// Mirrors CreateUserSchema in apps/auth-service/src/routes/users.ts — keep in
// sync so the frontend never accepts what the backend will reject.
const blankToUndefined = (v: unknown) => (v === '' || v === null ? undefined : v);

export function buildUserFormSchema(isEdit: boolean) {
  return z.object({
    firstName: z.string().min(1, 'Required').max(100, 'Must be 100 characters or fewer'),
    lastName: z.string().min(1, 'Required').max(100, 'Must be 100 characters or fewer'),
    email: z.string().email('Invalid email address').max(255),
    phone: z.string().max(20, 'Must be 20 characters or fewer').optional(),
    password: isEdit
      ? z.string().optional().or(z.literal(''))
      : z.string().min(12, 'Password must be at least 12 characters'),
    roleId: z.preprocess(blankToUndefined, z.coerce.number({ invalid_type_error: 'Required' }).int().positive('Required')),
    primaryBranchId: z.preprocess(blankToUndefined, z.coerce.number().int().positive().optional()),
  });
}

export type UserFormData = z.infer<ReturnType<typeof buildUserFormSchema>>;
