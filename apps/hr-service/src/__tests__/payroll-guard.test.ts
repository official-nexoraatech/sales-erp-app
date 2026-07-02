import { describe, it, expect, vi } from 'vitest';
import { BusinessError } from '@erp/types';

const MOCK_ENC_KEY = 'a'.repeat(64);

vi.mock('@erp/config', () => ({
  requireEnv: (key: string) => {
    if (key === 'FIELD_ENCRYPTION_KEY') return MOCK_ENC_KEY;
    throw new Error(`Unknown env: ${key}`);
  },
}));

vi.mock('@erp/db', () => ({
  employeeSalaries: { tenantId: {}, employeeId: {}, isActive: {}, basicEncrypted: {}, hraEncrypted: {}, daEncrypted: {}, grossEncrypted: {} },
  attendance: { tenantId: {}, employeeId: {}, attendanceDate: {}, status: {} },
  leaveApplications: { tenantId: {}, employeeId: {}, status: {}, startDate: {}, endDate: {}, days: {} },
  tailorWorkLog: { tenantId: {}, employeeId: {}, workDate: {}, amount: {} },
  payrollSlips: { id: {}, tenantId: {}, payrollRunId: {}, employeeId: {} },
}));

function makeDb(salaryRows: unknown[]) {
  return {
    raw: {
      select: () => ({
        from: () => ({
          where: () => ({
            then: (resolve: (v: unknown) => unknown) => resolve(salaryRows),
          }),
          // chain multiple calls
        }),
      }),
    },
  };
}

describe('PayrollEngine salary structure guard', () => {
  it('throws PAYROLL_NO_SALARY_STRUCTURE when employee has no active salary', async () => {
    const { PayrollEngine } = await import('../domain/PayrollEngine.js');

    const mockDb = {
      raw: {
        select: () => ({
          from: () => ({
            where: () => Promise.resolve([]),
          }),
        }),
      },
    };

    await expect(
      PayrollEngine.computeSlip(mockDb as never, 1, 42, 6, 2026, 26)
    ).rejects.toThrow(BusinessError);

    await expect(
      PayrollEngine.computeSlip(mockDb as never, 1, 42, 6, 2026, 26)
    ).rejects.toMatchObject({ code: 'PAYROLL_NO_SALARY_STRUCTURE' });
  });
});
