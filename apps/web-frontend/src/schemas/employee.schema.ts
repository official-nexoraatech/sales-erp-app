import { z } from 'zod';
import { OptionalPANSchema, OptionalBankAccountSchema, OptionalIFSCSchema, OptionalUANSchema } from '@erp/types';

// Mirrors CreateEmployeeSchema in apps/hr-service/src/api/employee.routes.ts —
// keep in sync so the frontend never accepts what the backend will reject.
export const EMPLOYMENT_TYPES = ['FULL_TIME', 'PART_TIME', 'CONTRACT', 'DAILY_WAGE', 'TRAINEE', 'TAILOR'] as const;

const blankToUndefined = (v: unknown) => (v === '' || v === null ? undefined : v);

export const employeeFormSchema = z.object({
  firstName: z.string().min(1, 'Required').max(100, 'Must be 100 characters or fewer'),
  lastName: z.string().min(1, 'Required').max(100, 'Must be 100 characters or fewer'),
  phone: z.string().min(10, 'Phone must be at least 10 digits').max(20, 'Phone must be 20 characters or fewer'),
  email: z.string().email('Invalid email address').optional().or(z.literal('')),
  gender: z.enum(['MALE', 'FEMALE', 'OTHER']).optional().or(z.literal('')),
  dateOfBirth: z.string().max(10).optional(),
  aadhaarLast4: z.string().regex(/^\d{4}$/, 'Must be exactly 4 digits').optional().or(z.literal('')),
  pan: OptionalPANSchema,
  bankAccountNo: OptionalBankAccountSchema,
  bankName: z.string().max(200).optional(),
  bankIfsc: OptionalIFSCSchema,
  uan: OptionalUANSchema,
  esiNumber: z.string().max(17).optional(),
  pfApplicable: z.boolean().optional(),
  esiApplicable: z.boolean().optional(),
  employmentType: z.enum(EMPLOYMENT_TYPES),
  departmentId: z.preprocess(blankToUndefined, z.coerce.number().int().positive().optional()),
  designationId: z.preprocess(blankToUndefined, z.coerce.number().int().positive().optional()),
  joiningDate: z.string().min(1, 'Required').max(10),
  version: z.number().int().min(0).optional(),
});

export type EmployeeFormData = z.infer<typeof employeeFormSchema>;
