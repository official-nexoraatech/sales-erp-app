import { z } from 'zod';
import {
  OptionalPANSchema,
  OptionalBankAccountSchema,
  OptionalIFSCSchema,
  OptionalUANSchema,
} from '@erp/types';

// Mirrors CreateEmployeeSchema in apps/hr-service/src/api/employee.routes.ts —
// keep in sync so the frontend never accepts what the backend will reject.
export const EMPLOYMENT_TYPES = [
  'FULL_TIME',
  'PART_TIME',
  'CONTRACT',
  'DAILY_WAGE',
  'TRAINEE',
  'TAILOR',
] as const;

const blankToUndefined = (v: unknown) => (v === '' || v === null ? undefined : v);

export const employeeFormSchema = z.object({
  firstName: z.string().min(1, 'Required').max(100, 'Must be 100 characters or fewer'),
  lastName: z.string().min(1, 'Required').max(100, 'Must be 100 characters or fewer'),
  phone: z
    .string()
    .min(10, 'Phone must be at least 10 digits')
    .max(20, 'Phone must be 20 characters or fewer'),
  // Backend's CreateEmployeeSchema declares these plain `.optional()` (not `.or(z.literal(''))`)
  // — an untouched field in this form still submits '' (every registered RHF field is present
  // in the payload), which always 422'd. Preprocess through blankToUndefined so an empty
  // optional field is omitted entirely, matching the same fix already applied to
  // supplier.schema.ts's supplierType.
  email: z.preprocess(blankToUndefined, z.string().email('Invalid email address').optional()),
  gender: z.preprocess(blankToUndefined, z.enum(['MALE', 'FEMALE', 'OTHER']).optional()),
  dateOfBirth: z.preprocess(blankToUndefined, z.string().max(10).optional()),
  aadhaarLast4: z.preprocess(
    blankToUndefined,
    z
      .string()
      .regex(/^\d{4}$/, 'Must be exactly 4 digits')
      .optional()
  ),
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
