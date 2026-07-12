import { describe, it, expect, vi } from 'vitest';
import { encryptField } from '@erp/utils/server';

const MOCK_ENC_KEY = 'a'.repeat(64);

vi.mock('@erp/config', () => ({
  requireEnv: (key: string) => {
    if (key === 'FIELD_ENCRYPTION_KEY') return MOCK_ENC_KEY;
    throw new Error(`Unknown env: ${key}`);
  },
}));

vi.mock('@erp/db', () => ({
  payrollRuns: { id: {}, tenantId: {}, periodMonth: {}, periodYear: {} },
  payrollSlips: {
    id: {},
    tenantId: {},
    payrollRunId: {},
    employeeId: {},
    basicSalary: {},
    hraAmount: {},
    daAmount: {},
    otherAllowances: {},
    pieceRateAmount: {},
    pfEmployee: {},
    pfEmployer: {},
    epsAmount: {},
    esiEmployee: {},
    esiEmployer: {},
    grossSalary: {},
    tdsDeduction: {},
  },
  employees: {
    id: {},
    tenantId: {},
    displayName: {},
    uan: {},
    esiNumber: {},
    panEncrypted: {},
    branchId: {},
  },
  organizationSettings: { tenantId: {}, orgName: {}, legalName: {}, tan: {}, address: {} },
  branches: { id: {}, tenantId: {}, address: {} },
}));

// Generic chainable query mock: every select()/from()/innerJoin() call in the
// services under test terminates in a single .where() — resolve queued results in call order.
function makeDb(resultQueue: unknown[][]) {
  let i = 0;
  const chain = {
    from: () => chain,
    innerJoin: () => chain,
    where: () => Promise.resolve(resultQueue[i++] ?? []),
  };
  return { raw: { select: () => chain } } as never;
}

describe('PF calculation (computePF)', () => {
  it('caps EPF employee contribution at 12% of ₹15,000 basic when basic is ₹20,000', async () => {
    const { computePF } = await import('../domain/PayrollEngine.js');
    expect(computePF(20000, true).pfEmployee).toBe(1800);
  });

  it('computes EPF employee contribution as 12% of basic when basic is ₹10,000 (uncapped)', async () => {
    const { computePF } = await import('../domain/PayrollEngine.js');
    expect(computePF(10000, true).pfEmployee).toBe(1200);
  });
});

describe('ESI calculation (computeESI)', () => {
  it('does not apply ESI when gross salary is ₹22,000 (over the ₹21,000 limit)', async () => {
    const { computeESI } = await import('../domain/PayrollEngine.js');
    const result = computeESI(22000, true);
    expect(result.esiEmployee).toBe(0);
    expect(result.esiEmployer).toBe(0);
  });

  it('computes ESI employee contribution as 0.75% of gross salary when gross is ₹18,000', async () => {
    const { computeESI } = await import('../domain/PayrollEngine.js');
    expect(computeESI(18000, true).esiEmployee).toBe(135);
  });
});

describe('Section 192 TDS slabs (calculateIncomeTax)', () => {
  it('computes tax of ₹25,000 for annual taxable income of ₹7,00,000', async () => {
    const { calculateIncomeTax } = await import('../domain/PayrollEngine.js');
    expect(calculateIncomeTax(700000)).toBe(25000);
  });

  it('computes tax of ₹10,000 (5% of ₹2,00,000) for annual taxable income of ₹5,00,000', async () => {
    const { calculateIncomeTax } = await import('../domain/PayrollEngine.js');
    expect(calculateIncomeTax(500000)).toBe(10000);
  });
});

describe('Multi-state Professional Tax (PG-044)', () => {
  // Same 3-slab shape as the pre-PG-044 hardcoded PT_SLABS constant — regression safety:
  // a Maharashtra employee's PT must not shift after switching to the seeded pt_slabs table.
  const MH_SLABS = [
    { incomeUpto: 10000, monthlyAmount: 0 },
    { incomeUpto: 15000, monthlyAmount: 150 },
    { incomeUpto: null, monthlyAmount: 200 },
  ];
  const KA_SLABS = [
    { incomeUpto: 24999, monthlyAmount: 0 },
    { incomeUpto: null, monthlyAmount: 200 },
  ];

  describe('PTSlabService.computePT', () => {
    it('matches the pre-PG-044 hardcoded Maharashtra slabs exactly (regression)', async () => {
      const { PTSlabService } = await import('../domain/PTSlabService.js');
      expect(PTSlabService.computePT(8000, MH_SLABS)).toBe(0);
      expect(PTSlabService.computePT(12000, MH_SLABS)).toBe(150);
      expect(PTSlabService.computePT(50000, MH_SLABS)).toBe(200);
    });

    it("applies Karnataka slabs, not Maharashtra's, when given Karnataka slab data", async () => {
      const { PTSlabService } = await import('../domain/PTSlabService.js');
      expect(PTSlabService.computePT(20000, KA_SLABS)).toBe(0);
      expect(PTSlabService.computePT(30000, KA_SLABS)).toBe(200);
    });

    it("returns 0 (not an error, not another state's rate) for a no-PT state with zero seeded slabs", async () => {
      const { PTSlabService } = await import('../domain/PTSlabService.js');
      expect(PTSlabService.computePT(50000, [])).toBe(0);
    });
  });

  describe('normalizeStateToCode', () => {
    it('normalizes a full state name (any case) to its 2-letter code', async () => {
      const { normalizeStateToCode } = await import('../domain/PTSlabService.js');
      expect(normalizeStateToCode('Maharashtra')).toBe('MH');
      expect(normalizeStateToCode('karnataka')).toBe('KA');
    });

    it('passes an already-coded value through unchanged (case-normalized)', async () => {
      const { normalizeStateToCode } = await import('../domain/PTSlabService.js');
      expect(normalizeStateToCode('mh')).toBe('MH');
    });
  });

  describe('resolveEmployeeState', () => {
    it("resolves via the employee's branch address when the branch has a state on file", async () => {
      const { resolveEmployeeState } = await import('../domain/PayrollEngine.js');
      const db = makeDb([[{ address: { state: 'Karnataka' } }]]);
      const state = await resolveEmployeeState(db, 1, 5);
      expect(state).toBe('Karnataka');
    });

    it('falls back to organizationSettings when the employee has no branchId', async () => {
      const { resolveEmployeeState } = await import('../domain/PayrollEngine.js');
      const db = makeDb([[{ address: { state: 'Gujarat' } }]]);
      const state = await resolveEmployeeState(db, 1, null);
      expect(state).toBe('Gujarat');
    });

    it('falls back to organizationSettings when the branch has no state on file', async () => {
      const { resolveEmployeeState } = await import('../domain/PayrollEngine.js');
      const db = makeDb([[{ address: null }], [{ address: { state: 'Gujarat' } }]]);
      const state = await resolveEmployeeState(db, 1, 7);
      expect(state).toBe('Gujarat');
    });
  });
});

describe('PFChallanService.generateChallan', () => {
  it('produces correct totals for a 10-employee payroll run', async () => {
    const { PFChallanService } = await import('../domain/PFChallanService.js');

    const slips = Array.from({ length: 10 }, (_, idx) => ({
      employeeId: idx + 1,
      displayName: `Employee ${idx + 1}`,
      uan: `UAN00${idx + 1}`,
      basicSalary: '15000.00',
      pfEmployee: '1800.00',
      pfEmployer: '550.50',
      epsAmount: '1249.50',
    }));

    const db = makeDb([
      [{ id: 501 }], // payrollRuns lookup
      slips, // payrollSlips joined with employees
    ]);

    const result = await PFChallanService.generateChallan(db, 1, 7, 2026);

    expect(result.rows).toHaveLength(10);
    expect(result.totals.basicSalary).toBeCloseTo(150000, 2);
    expect(result.totals.epfEmployee).toBeCloseTo(18000, 2);
    expect(result.totals.epfEmployer).toBeCloseTo(5505, 2);
    expect(result.totals.epsAmount).toBeCloseTo(12495, 2);
  });
});

describe('Form16Service.generateForm16Data', () => {
  it('sums decrypted gross salary across all monthly payslips for the financial year', async () => {
    const { Form16Service } = await import('../domain/Form16Service.js');

    const monthlyGross = 25000;
    const slips = Array.from({ length: 12 }, (_, idx) => {
      const month = ((idx + 3) % 12) + 1; // Apr(4)..Mar(3) cycle starting at 4
      const year = month >= 4 ? 2025 : 2026;
      return {
        periodMonth: month,
        periodYear: year,
        grossSalary: encryptField(String(monthlyGross), MOCK_ENC_KEY),
        tdsDeduction: '0',
        pfEmployee: '1800',
        esiEmployee: '0',
      };
    });

    const db = makeDb([
      [{ displayName: 'Test Employee', panEncrypted: null }], // employees lookup
      [{ orgName: 'Test Org', legalName: 'Test Org Pvt Ltd', tan: 'TANX12345Y' }], // organizationSettings
      slips, // payrollSlips joined with payrollRuns
    ]);

    const data = await Form16Service.generateForm16Data(db, 1, 42, '2025-26');

    expect(data.monthlyBreakdown).toHaveLength(12);
    expect(data.grossSalary).toBeCloseTo(monthlyGross * 12, 2);
  });
});
