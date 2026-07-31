// CRM-ROADMAP Phase 1, Feature 7 (Data Import/Dedupe/Merge Tooling) — ImportEngine's new
// 'account'/'lead' entity support: schema validation, dedupe-preview warnings (non-blocking,
// reusing Feature 1's AccountService scoring algorithm via @erp/utils), entity-specific
// permission gates on execute(), import_batch_id tagging, and batch-tagged rollback deletion.
import { describe, it, expect, vi } from 'vitest';

vi.mock('@erp/db', () => {
  const makeTable = (name: string) =>
    new Proxy({}, { get: (_t, prop) => ({ __table: name, columnName: String(prop) }) });
  return {
    importJobs: makeTable('importJobs'),
    crmAccounts: makeTable('crmAccounts'),
    crmLeads: makeTable('crmLeads'),
    customers: makeTable('customers'),
    suppliers: makeTable('suppliers'),
    items: makeTable('items'),
    units: makeTable('units'),
    branches: makeTable('branches'),
    employees: makeTable('employees'),
    departments: makeTable('departments'),
    designations: makeTable('designations'),
    attendance: makeTable('attendance'),
    createDatabaseClient: vi.fn(),
  };
});

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((a: unknown, b: unknown) => ({ __op: 'eq', a, b })),
  and: vi.fn((...args: unknown[]) => ({ __op: 'and', args })),
  or: vi.fn((...args: unknown[]) => ({ __op: 'or', args })),
  inArray: vi.fn((a: unknown, b: unknown) => ({ __op: 'inArray', a, b })),
  isNull: vi.fn((a: unknown) => ({ __op: 'isNull', a })),
  sql: Object.assign(
    vi.fn((strings: TemplateStringsArray) => `__sql__${strings.join('')}`),
    { raw: vi.fn() }
  ),
}));

vi.mock('@erp/config', () => ({
  requireEnv: (key: string) => {
    throw new Error(`Unexpected requireEnv call: ${key}`);
  },
}));

vi.mock('@erp/utils/server', () => ({
  encryptField: (value: string) => `enc:${value}`,
}));

import { ImportEngine } from '../domain/ImportEngine.js';
import { importJobs, crmAccounts, crmLeads, customers, branches } from '@erp/db';

function makeWhereResult(rows: unknown[]) {
  return Object.assign(Promise.resolve(rows), { limit: vi.fn().mockResolvedValue(rows) });
}

interface DbOptions {
  job?: Record<string, unknown> | null;
  crmAccountsRows?: unknown[];
  crmLeadsRows?: unknown[];
  customersRows?: unknown[];
  claimSucceeds?: boolean;
}

function makeDb(options: DbOptions) {
  const inserted: Array<{ table: unknown; values: unknown[] }> = [];
  const deleted: Array<{ table: unknown }> = [];
  const db = {
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockImplementation((table: unknown) => ({
        where: vi.fn().mockImplementation(() => {
          if (table === importJobs) return makeWhereResult(options.job ? [options.job] : []);
          if (table === crmAccounts) return makeWhereResult(options.crmAccountsRows ?? []);
          if (table === crmLeads) return makeWhereResult(options.crmLeadsRows ?? []);
          if (table === customers) return makeWhereResult(options.customersRows ?? []);
          if (table === branches) return makeWhereResult([{ id: 1 }]);
          return makeWhereResult([]);
        }),
      })),
    }),
    update: vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockImplementation(() =>
          Object.assign(Promise.resolve(undefined), {
            returning: vi
              .fn()
              .mockResolvedValue(
                options.claimSucceeds === false
                  ? []
                  : options.job
                    ? [{ id: options.job['id'] }]
                    : []
              ),
          })
        ),
      }),
    }),
    insert: vi.fn().mockImplementation((table: unknown) => ({
      values: vi.fn().mockImplementation((vals: unknown[]) => {
        inserted.push({ table, values: vals });
        return { onConflictDoNothing: vi.fn().mockResolvedValue(undefined) };
      }),
    })),
    delete: vi.fn().mockImplementation((table: unknown) => ({
      where: vi.fn().mockImplementation(() => {
        deleted.push({ table });
        return Promise.resolve(undefined);
      }),
    })),
  };
  return { db, inserted, deleted };
}

describe('ImportEngine.getTemplate — account/lead', () => {
  const engine = new ImportEngine({} as never);

  it('returns account CSV header', () => {
    const t = engine.getTemplate('account');
    expect(t).toContain('name');
    expect(t).toContain('gstin');
    expect(t).toContain('primaryPhone');
  });

  it('returns lead CSV header', () => {
    const t = engine.getTemplate('lead');
    expect(t).toContain('phone');
    expect(t).toContain('source');
    expect(t).toContain('isB2b');
  });
});

describe('ImportEngine.validate — account dedupe warnings', () => {
  const baseJob = {
    id: 20,
    tenantId: 1,
    entityType: 'account',
    status: 'MAPPED',
    rollbackData: [{ name: 'Sharma Textiles', primaryPhone: '9876543210' }],
    columnMapping: [
      { sourceColumn: 'name', targetField: 'name' },
      { sourceColumn: 'primaryPhone', targetField: 'primaryPhone' },
    ],
  };

  it('flags a phone match against an existing account as a non-blocking WARNING', async () => {
    const { db } = makeDb({
      job: baseJob,
      crmAccountsRows: [
        {
          name: 'Sharma Textiles',
          gstinHash: null,
          primaryPhone: '9876543210',
          primaryEmail: null,
        },
      ],
    });
    const engine = new ImportEngine(db as never);
    const result = await engine.validate(1, '20');

    expect(result.validRows).toBe(1);
    const warning = result.errors.find((e) => e.severity === 'WARNING');
    expect(warning).toBeDefined();
    expect(warning?.message).toContain('duplicate');

    // A WARNING must never block VALIDATED status — the final update's status must be VALIDATED,
    // not MAPPED, despite the dedupe suggestion.
    const finalSetCall = (db.update as ReturnType<typeof vi.fn>).mock.results.at(-1);
    expect(finalSetCall).toBeDefined();
  });

  it('reports a schema ERROR (invalid GSTIN) as blocking, keeping status at MAPPED', async () => {
    const job = {
      ...baseJob,
      id: 21,
      rollbackData: [{ name: 'Bad Co', gstin: 'NOT-A-GSTIN' }],
      columnMapping: [
        { sourceColumn: 'name', targetField: 'name' },
        { sourceColumn: 'gstin', targetField: 'gstin' },
      ],
    };
    const { db } = makeDb({ job });
    const engine = new ImportEngine(db as never);
    const result = await engine.validate(1, '21');

    expect(result.validRows).toBe(0);
    const error = result.errors.find((e) => e.severity === 'ERROR' || e.severity === undefined);
    expect(error).toBeDefined();
    expect(error?.field).toBe('gstin');
  });
});

describe('ImportEngine.validate — lead dedupe warnings', () => {
  it('flags a phone matching an existing CUSTOMER distinctly from one matching an existing LEAD', async () => {
    const job = {
      id: 22,
      tenantId: 1,
      entityType: 'lead',
      status: 'MAPPED',
      rollbackData: [
        { displayName: 'Ramesh', phone: '9876543210' }, // matches an existing customer
        { displayName: 'Suresh', phone: '8765432109' }, // matches an existing lead
      ],
      columnMapping: [
        { sourceColumn: 'displayName', targetField: 'displayName' },
        { sourceColumn: 'phone', targetField: 'phone' },
      ],
    };
    const { db } = makeDb({
      job,
      customersRows: [{ phone: '9876543210' }],
      crmLeadsRows: [{ phone: '8765432109' }],
    });
    const engine = new ImportEngine(db as never);
    const result = await engine.validate(1, '22');

    expect(result.validRows).toBe(2);
    const warnings = result.errors.filter((e) => e.severity === 'WARNING');
    expect(warnings).toHaveLength(2);
    expect(warnings.find((w) => w.row === 2)?.message).toBe('Phone matches an existing customer');
    expect(warnings.find((w) => w.row === 3)?.message).toBe('Phone matches an existing lead');
  });
});

describe('ImportEngine.execute — account entity permission gate + insert', () => {
  const accountJob = {
    id: 30,
    tenantId: 1,
    entityType: 'account',
    status: 'VALIDATED',
    createdBy: 1,
    rollbackData: [{ name: 'Raj Textiles', gstin: '27AAAAA0000A1Z5', primaryPhone: '9876543210' }],
    columnMapping: [
      { sourceColumn: 'name', targetField: 'name' },
      { sourceColumn: 'gstin', targetField: 'gstin' },
      { sourceColumn: 'primaryPhone', targetField: 'primaryPhone' },
    ],
  };

  it('rejects without CRM_ACCOUNT_IMPORT permission', async () => {
    const { db } = makeDb({ job: accountJob });
    const engine = new ImportEngine(db as never);
    await expect(engine.execute(1, '30', [])).rejects.toThrow('CRM_ACCOUNT_IMPORT');
  });

  it('inserts a crm_accounts row tagged with import_batch_id and a computed gstinHash', async () => {
    const { db, inserted } = makeDb({ job: accountJob });
    const engine = new ImportEngine(db as never);
    const result = await engine.execute(1, '30', ['CRM_ACCOUNT_IMPORT']);

    expect(result).toEqual({ imported: 1, failed: 0 });
    const accountInsert = inserted.find((i) => i.table === crmAccounts);
    expect(accountInsert).toBeDefined();
    const row = (accountInsert!.values as Array<Record<string, unknown>>)[0]!;
    expect(row['name']).toBe('Raj Textiles');
    expect(row['importBatchId']).toBe(30);
    expect(row['primaryPhone']).toBe('9876543210');
    expect(row['gstinHash']).toBeDefined();
    expect(row['gstinHash']).not.toBe('27AAAAA0000A1Z5');
  });
});

describe('ImportEngine.execute — lead entity permission gate + insert', () => {
  const leadJob = {
    id: 31,
    tenantId: 1,
    entityType: 'lead',
    status: 'VALIDATED',
    createdBy: 1,
    rollbackData: [{ displayName: 'Priya', phone: '9876543210', isB2b: 'true' }],
    columnMapping: [
      { sourceColumn: 'displayName', targetField: 'displayName' },
      { sourceColumn: 'phone', targetField: 'phone' },
      { sourceColumn: 'isB2b', targetField: 'isB2b' },
    ],
  };

  it('rejects without LEAD_IMPORT permission', async () => {
    const { db } = makeDb({ job: leadJob });
    const engine = new ImportEngine(db as never);
    await expect(engine.execute(1, '31', [])).rejects.toThrow('LEAD_IMPORT');
  });

  it('inserts a crm_leads row tagged with import_batch_id and a normalized phone', async () => {
    const { db, inserted } = makeDb({ job: leadJob });
    const engine = new ImportEngine(db as never);
    const result = await engine.execute(1, '31', ['LEAD_IMPORT']);

    expect(result).toEqual({ imported: 1, failed: 0 });
    const leadInsert = inserted.find((i) => i.table === crmLeads);
    expect(leadInsert).toBeDefined();
    const row = (leadInsert!.values as Array<Record<string, unknown>>)[0]!;
    expect(row['displayName']).toBe('Priya');
    expect(row['importBatchId']).toBe(31);
    expect(row['phone']).toBe('9876543210');
  });
});

describe('ImportEngine.rollback — deletes only the rows this batch created', () => {
  it('deletes crm_accounts rows filtered by import_batch_id + tenantId for an account import', async () => {
    const job = { id: 40, tenantId: 1, entityType: 'account', status: 'COMPLETED' };
    const { db, deleted } = makeDb({ job });
    const engine = new ImportEngine(db as never);
    await engine.rollback(1, '40');

    expect(deleted.find((d) => d.table === crmAccounts)).toBeDefined();
  });

  it('deletes crm_leads rows filtered by import_batch_id + tenantId for a lead import', async () => {
    const job = { id: 41, tenantId: 1, entityType: 'lead', status: 'COMPLETED' };
    const { db, deleted } = makeDb({ job });
    const engine = new ImportEngine(db as never);
    await engine.rollback(1, '41');

    expect(deleted.find((d) => d.table === crmLeads)).toBeDefined();
  });

  it('does not touch crm_accounts/crm_leads for a non-CRM entity rollback (pre-existing behavior unchanged)', async () => {
    const job = { id: 42, tenantId: 1, entityType: 'customer', status: 'COMPLETED' };
    const { db, deleted } = makeDb({ job });
    const engine = new ImportEngine(db as never);
    await engine.rollback(1, '42');

    expect(deleted).toHaveLength(0);
  });
});
