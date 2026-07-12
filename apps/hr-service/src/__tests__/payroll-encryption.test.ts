import { describe, it, expect, vi } from 'vitest';
import { decryptField } from '@erp/utils/server';

const MOCK_ENC_KEY = 'a'.repeat(64); // 32-byte hex

vi.mock('@erp/config', () => ({
  requireEnv: (key: string) => {
    if (key === 'FIELD_ENCRYPTION_KEY') return MOCK_ENC_KEY;
    throw new Error(`Unknown env: ${key}`);
  },
}));

vi.mock('@erp/db', () => ({
  employeeSalaries: {
    tenantId: {},
    employeeId: {},
    isActive: {},
    basicEncrypted: {},
    hraEncrypted: {},
    daEncrypted: {},
    grossEncrypted: {},
  },
  attendance: { tenantId: {}, employeeId: {}, attendanceDate: {}, status: {} },
  leaveApplications: {
    tenantId: {},
    employeeId: {},
    status: {},
    startDate: {},
    endDate: {},
    days: {},
  },
  tailorWorkLog: { tenantId: {}, employeeId: {}, workDate: {}, amount: {} },
  payrollSlips: { id: {}, tenantId: {}, payrollRunId: {}, employeeId: {} },
}));

describe('PayrollEngine encryption', () => {
  it('upsertSlip encrypts grossSalary and netSalary in the DB row', async () => {
    let capturedValues: Record<string, unknown> = {};

    const mockDb = {
      raw: {
        select: () => ({
          from: () => ({
            where: () => Promise.resolve([]),
          }),
        }),
        insert: (_table: unknown) => ({
          values: (vals: Record<string, unknown>) => {
            capturedValues = vals;
            return { returning: () => Promise.resolve([{ id: 1 }]) };
          },
        }),
        update: () => ({
          set: (vals: Record<string, unknown>) => {
            capturedValues = vals;
            return { where: () => Promise.resolve() };
          },
        }),
      },
    };

    const { PayrollEngine } = await import('../domain/PayrollEngine.js');

    await PayrollEngine.upsertSlip(mockDb as never, 1, 1, {
      employeeId: 10,
      presentDays: 26,
      paidLeaveDays: 0,
      lopDays: 0,
      workingDays: 26,
      basicSalary: 25000,
      hraAmount: 10000,
      daAmount: 5000,
      otherAllowances: 0,
      pieceRateAmount: 0,
      grossSalary: 40000,
      pfEmployee: 1800,
      pfEmployer: 1800,
      esiEmployee: 0,
      esiEmployer: 0,
      professionalTax: 200,
      loanDeduction: 0,
      tdsDeduction: 0,
      totalDeductions: 2000,
      netSalary: 38000,
    });

    const gross = capturedValues['grossSalary'] as string;
    const net = capturedValues['netSalary'] as string;

    // Must not be plain numbers
    expect(gross).not.toBe('40000');
    expect(net).not.toBe('38000');

    // Must be encrypted ciphertext (contains ':' separators)
    expect(gross).toContain(':');
    expect(net).toContain(':');

    // Must decrypt to correct values
    expect(decryptField(gross, MOCK_ENC_KEY)).toBe('40000');
    expect(decryptField(net, MOCK_ENC_KEY)).toBe('38000');
  });
});
