import { describe, it, expect, vi } from 'vitest';

vi.mock('@erp/db', () => {
  const mockTable = new Proxy(
    {},
    {
      get: (_t, prop) => ({ columnName: String(prop) }),
    }
  );
  return {
    importJobs: mockTable,
    exportJobs: mockTable,
    customers: mockTable,
    suppliers: mockTable,
    items: mockTable,
    units: mockTable,
    branches: mockTable,
    employees: mockTable,
    departments: mockTable,
    designations: mockTable,
    attendance: mockTable,
    createDatabaseClient: vi.fn(),
  };
});

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((_a: unknown, _b: unknown) => '__eq__'),
  and: vi.fn((..._args: unknown[]) => '__and__'),
  desc: vi.fn((_a: unknown) => '__desc__'),
  sql: Object.assign(
    vi.fn((strings: TemplateStringsArray) => `__sql__${strings.join('')}`),
    { raw: vi.fn() }
  ),
}));

const MOCK_ENC_KEY = 'a'.repeat(64);

vi.mock('@erp/config', () => ({
  requireEnv: (key: string) => {
    if (key === 'FIELD_ENCRYPTION_KEY') return MOCK_ENC_KEY;
    throw new Error(`Unknown env: ${key}`);
  },
}));

vi.mock('@erp/utils/server', () => ({
  encryptField: (value: string) => `enc:${value}`,
}));

import { ImportEngine } from '../domain/ImportEngine.js';

function makeWhereResult(rows: unknown[]) {
  return Object.assign(Promise.resolve(rows), {
    limit: vi.fn().mockResolvedValue(rows),
  });
}

function makeDb(jobRows: unknown[] = []) {
  return {
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({ where: vi.fn().mockReturnValue(makeWhereResult(jobRows)) }),
    }),
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockReturnValue({
        onConflictDoNothing: vi.fn().mockResolvedValue(undefined),
        returning: vi.fn().mockResolvedValue([{ id: 1 }]),
      }),
    }),
    update: vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }),
    }),
  };
}

describe('ImportEngine.getTemplate', () => {
  const engine = new ImportEngine({} as never);

  it('returns customer CSV header', () => {
    const t = engine.getTemplate('customer');
    expect(t).toContain('name');
    expect(t).toContain('phone');
    expect(t).toContain('gstin');
  });

  it('returns item CSV header', () => {
    const t = engine.getTemplate('item');
    expect(t).toContain('sku');
    expect(t).toContain('salePrice');
    expect(t).toContain('taxRate');
  });

  it('returns opening-stock CSV header', () => {
    const t = engine.getTemplate('opening-stock');
    expect(t).toContain('warehouseCode');
    expect(t).toContain('quantity');
  });
});

describe('ImportEngine.createJob', () => {
  it('throws when CSV has no data rows', async () => {
    const engine = new ImportEngine(makeDb() as never);
    await expect(engine.createJob(1, 1, 'customer', 'name,phone\n', 'test.csv')).rejects.toThrow(
      'no data rows'
    );
  });

  it('throws when CSV exceeds 10000 rows', async () => {
    const rows = Array.from({ length: 10_001 }, (_, i) => `Customer${i},9999999999`).join('\n');
    const csv = `name,phone\n${rows}`;
    const engine = new ImportEngine(makeDb() as never);
    await expect(engine.createJob(1, 1, 'customer', csv, 'big.csv')).rejects.toThrow(
      'Max 10,000 rows'
    );
  });

  it('creates job and returns a ULID string', async () => {
    const csv = 'name,phone\nRaj Textiles,9876543210\nShree Fabrics,8765432109';
    const db = makeDb();
    const engine = new ImportEngine(db as never);
    const jobId = await engine.createJob(1, 1, 'customer', csv, 'customers.csv');
    expect(typeof jobId).toBe('string');
    expect(jobId.length).toBeGreaterThan(0);
    expect(db.insert).toHaveBeenCalled();
  });
});

describe('ImportEngine.validate', () => {
  it('validates valid customer rows without errors', async () => {
    const job = {
      id: 'job-1',
      tenantId: 1,
      entityType: 'customer',
      status: 'MAPPED',
      rollbackData: [{ name: 'Raj Textiles', phone: '9876543210', creditLimit: '10000' }],
      columnMapping: [
        { sourceColumn: 'name', targetField: 'name' },
        { sourceColumn: 'phone', targetField: 'phone' },
        { sourceColumn: 'creditLimit', targetField: 'creditLimit', transform: 'NUMBER' as const },
      ],
    };
    const engine = new ImportEngine(makeDb([job]) as never);
    const result = await engine.validate(1, 'job-1');
    expect(result.validRows).toBe(1);
    expect(result.errors).toHaveLength(0);
  });

  it('catches invalid phone format and reports error', async () => {
    const job = {
      id: 'job-1',
      tenantId: 1,
      entityType: 'customer',
      status: 'MAPPED',
      rollbackData: [
        { name: 'Raj Textiles', phone: '9876543210' }, // valid
        { name: 'Bad Customer', phone: 'not-a-phone' }, // invalid phone
      ],
      columnMapping: [
        { sourceColumn: 'name', targetField: 'name' },
        { sourceColumn: 'phone', targetField: 'phone' },
      ],
    };
    const engine = new ImportEngine(makeDb([job]) as never);
    const result = await engine.validate(1, 'job-1');
    expect(result.validRows).toBe(1);
    expect(result.errors.length).toBeGreaterThan(0);
    const phoneError = result.errors.find((e) => e.field === 'phone');
    expect(phoneError).toBeDefined();
    expect(phoneError?.row).toBe(3); // row 3 = CSV line 3 (1 header + 2 data)
  });

  it('validates item rows with proper types', async () => {
    const job = {
      id: 'job-2',
      tenantId: 1,
      entityType: 'item',
      status: 'MAPPED',
      rollbackData: [
        {
          name: 'Blue Fabric',
          sku: 'FAB-001',
          salePrice: '250',
          purchasePrice: '200',
          taxRate: '5',
          unit: 'Meter',
        },
      ],
      columnMapping: [
        { sourceColumn: 'name', targetField: 'name' },
        { sourceColumn: 'sku', targetField: 'sku' },
        { sourceColumn: 'salePrice', targetField: 'salePrice', transform: 'NUMBER' as const },
        {
          sourceColumn: 'purchasePrice',
          targetField: 'purchasePrice',
          transform: 'NUMBER' as const,
        },
        { sourceColumn: 'taxRate', targetField: 'taxRate', transform: 'NUMBER' as const },
        { sourceColumn: 'unit', targetField: 'unit' },
      ],
    };
    const engine = new ImportEngine(makeDb([job]) as never);
    const result = await engine.validate(1, 'job-2');
    expect(result.validRows).toBe(1);
    expect(result.errors).toHaveLength(0);
  });
});

// ES-26 (M9): ImportEngine.execute() atomic status transition
function makeUpdateWhereResult(returningRows: unknown[]) {
  return Object.assign(Promise.resolve(undefined), {
    returning: vi.fn().mockResolvedValue(returningRows),
  });
}

// claimResults[n] is what the n-th `.update().set().where().returning()` call resolves to —
// the first call is always the atomic EXECUTING claim in execute().
function makeExecuteDb(job: unknown, claimResults: unknown[][]) {
  let selectCallCount = 0;
  let updateCallCount = 0;
  return {
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockImplementation(() => {
          selectCallCount++;
          if (selectCallCount === 1) return makeWhereResult(job ? [job] : []);
          return makeWhereResult([{ id: 1 }]); // head-office branch lookup
        }),
      }),
    }),
    update: vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockImplementation(() => {
          const result = makeUpdateWhereResult(claimResults[updateCallCount] ?? []);
          updateCallCount++;
          return result;
        }),
      }),
    }),
    insert: vi.fn().mockReturnValue({
      values: vi
        .fn()
        .mockReturnValue({ onConflictDoNothing: vi.fn().mockResolvedValue(undefined) }),
    }),
  };
}

describe('ImportEngine.execute — atomic status transition (M9)', () => {
  const baseJob = {
    id: 5,
    tenantId: 1,
    entityType: 'customer',
    status: 'VALIDATED',
    rollbackData: [],
    columnMapping: [],
    createdBy: 1,
  };

  it('throws IMPORT_INVALID_STATE when the atomic claim update returns zero rows', async () => {
    const db = makeExecuteDb(baseJob, [[]]);
    const engine = new ImportEngine(db as never);
    await expect(engine.execute(1, '5', [])).rejects.toThrow('Cannot execute in state');
  });

  it('completes normally when the atomic claim update returns the claimed row', async () => {
    const db = makeExecuteDb(baseJob, [[{ id: 5 }]]);
    const engine = new ImportEngine(db as never);
    const result = await engine.execute(1, '5', []);
    expect(result).toEqual({ imported: 0, failed: 0 });
  });

  it('two concurrent execute() calls for the same job: exactly one claims it, the other is rejected', async () => {
    // First `.update()...returning()` call to resolve gets the claimed row; the second gets
    // zero rows back — modeling the atomic `WHERE status = 'VALIDATED'` losing the race.
    const db = makeExecuteDb(baseJob, [[{ id: 5 }], []]);
    const engine = new ImportEngine(db as never);

    const outcomes = await Promise.allSettled([
      engine.execute(1, '5', []),
      engine.execute(1, '5', []),
    ]);

    expect(outcomes.filter((o) => o.status === 'fulfilled')).toHaveLength(1);
    expect(outcomes.filter((o) => o.status === 'rejected')).toHaveLength(1);
  });
});

// PG-043: real employee/attendance insert branches
// selectQueue[0] is always the head-office branch lookup; subsequent entries are consumed
// in the order execute() issues them (departments → designations → employees, or the
// employeeCode map for attendance).
function makeEntityDb(job: Record<string, unknown>, selectQueue: unknown[][]) {
  let selectIdx = 0;
  const inserted: Array<{ values: unknown[] }> = [];
  const db = {
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockImplementation(() => {
          const result = selectIdx === 0 ? [job] : (selectQueue[selectIdx - 1] ?? []);
          selectIdx++;
          return makeWhereResult(result);
        }),
      }),
    }),
    update: vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockImplementation(() => makeUpdateWhereResult([{ id: job['id'] }])),
      }),
    }),
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockImplementation((vals: unknown[]) => {
        inserted.push({ values: vals });
        return {
          onConflictDoNothing: vi.fn().mockResolvedValue(undefined),
          onConflictDoUpdate: vi.fn().mockResolvedValue(undefined),
        };
      }),
    }),
  };
  return { db, inserted };
}

describe('ImportEngine.execute — employee entity (PG-043)', () => {
  const employeeJob = {
    id: 10,
    tenantId: 1,
    entityType: 'employee',
    status: 'VALIDATED',
    createdBy: 1,
    rollbackData: [
      {
        name: 'Raj Kumar',
        phone: '9876543210',
        designation: 'Manager',
        basicSalary: '25000',
        joiningDate: '2024-01-15',
        department: 'Sales',
        pan: 'ABCDE1234F',
      },
    ],
    columnMapping: [
      { sourceColumn: 'name', targetField: 'name' },
      { sourceColumn: 'phone', targetField: 'phone' },
      { sourceColumn: 'designation', targetField: 'designation' },
      { sourceColumn: 'basicSalary', targetField: 'basicSalary', transform: 'NUMBER' as const },
      { sourceColumn: 'joiningDate', targetField: 'joiningDate' },
      { sourceColumn: 'department', targetField: 'department' },
      { sourceColumn: 'pan', targetField: 'pan' },
    ],
  };

  it('requires EMPLOYEE_IMPORT permission and rejects before claiming the job', async () => {
    const engine = new ImportEngine(makeDb([employeeJob]) as never);
    await expect(engine.execute(1, '10', [])).rejects.toThrow('EMPLOYEE_IMPORT');
  });

  it('inserts a real employees row with resolved department/designation and encrypted PAN', async () => {
    const { db, inserted } = makeEntityDb(employeeJob, [
      [{ id: 1 }], // head-office branch
      [{ id: 5, name: 'Sales' }], // departments
      [{ id: 7, name: 'Manager' }], // designations
      [], // existing employees (employeeCode sequence source) — none yet
    ]);
    const engine = new ImportEngine(db as never);
    const result = await engine.execute(1, '10', ['EMPLOYEE_IMPORT']);

    expect(result).toEqual({ imported: 1, failed: 0 });
    expect(inserted).toHaveLength(1);
    const row = (inserted[0]!.values as Array<Record<string, unknown>>)[0]!;
    expect(row['displayName']).toBe('Raj Kumar');
    expect(row['departmentId']).toBe(5);
    expect(row['designationId']).toBe(7);
    expect(row['employeeCode']).toMatch(/^EMP-\d{5}$/);
    expect(row['panEncrypted']).toBe('enc:ABCDE1234F');
    expect(row['panHash']).toBeDefined();
    expect(row['panEncrypted']).not.toBe('ABCDE1234F');
  });
});

describe('ImportEngine.execute — attendance entity (PG-043)', () => {
  it('inserts resolved rows and fails unresolved employeeCode rows instead of silently skipping them', async () => {
    const attendanceJob = {
      id: 11,
      tenantId: 1,
      entityType: 'attendance',
      status: 'VALIDATED',
      createdBy: 1,
      rollbackData: [
        { employeeCode: 'EMP-00010', attendanceDate: '2024-01-15', status: 'PRESENT' },
        { employeeCode: 'EMP-UNKNOWN', attendanceDate: '2024-01-15', status: 'PRESENT' },
      ],
      columnMapping: [
        { sourceColumn: 'employeeCode', targetField: 'employeeCode' },
        { sourceColumn: 'attendanceDate', targetField: 'attendanceDate' },
        { sourceColumn: 'status', targetField: 'status' },
      ],
    };
    const { db, inserted } = makeEntityDb(attendanceJob, [
      [{ id: 1 }], // head-office branch
      [{ id: 10, employeeCode: 'EMP-00010' }], // employeeCode → id map
    ]);
    const engine = new ImportEngine(db as never);
    const result = await engine.execute(1, '11', []);

    expect(result).toEqual({ imported: 1, failed: 1 });
    expect(inserted).toHaveLength(1);
    const rows = inserted[0]!.values as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(1);
    expect(rows[0]!['employeeId']).toBe(10);
  });
});

describe('ImportEngine.execute — opening-stock (still unimplemented)', () => {
  it('counts rows as imported without ever inserting anything, and this stays true after the employee/attendance fix', async () => {
    const openingStockJob = {
      id: 12,
      tenantId: 1,
      entityType: 'opening-stock',
      status: 'VALIDATED',
      createdBy: 1,
      rollbackData: [{ sku: 'FAB-1', warehouseCode: 'WH1', quantity: '10', costPrice: '100' }],
      columnMapping: [
        { sourceColumn: 'sku', targetField: 'sku' },
        { sourceColumn: 'warehouseCode', targetField: 'warehouseCode' },
        { sourceColumn: 'quantity', targetField: 'quantity', transform: 'NUMBER' as const },
        { sourceColumn: 'costPrice', targetField: 'costPrice', transform: 'NUMBER' as const },
      ],
    };
    const { db, inserted } = makeEntityDb(openingStockJob, [[{ id: 1 }]]);
    const engine = new ImportEngine(db as never);
    const result = await engine.execute(1, '12', []);

    expect(result).toEqual({ imported: 1, failed: 0 });
    expect(inserted).toHaveLength(0);
  });
});
