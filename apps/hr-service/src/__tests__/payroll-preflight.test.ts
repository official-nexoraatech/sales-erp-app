// Product audit 2026-07-31, Phase 1 Step 8 — GET /payroll-runs/preflight lists active
// employees lacking an active salary structure BEFORE a payroll run starts, instead of only
// discovering it mid-run via the skip-and-report path (2026-07-12 fix).
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';
import { generateKeyPairSync } from 'node:crypto';
import { SignJWT, importPKCS8, type KeyLike } from 'jose';
import { PERMISSIONS } from '@erp/types';
import type * as ErpSdk from '@erp/sdk';

// Phase 3A (HR_PAYROLL capability) — requireCapability() is now called eagerly at
// route-registration time, and this file's ctxFactory has no rawDb/getRedis (its purpose is
// preflight-check correctness, not capability resolution, which is covered by
// payroll-capability.test.ts). Mock only requireCapability to always allow — a full-replacement
// mock breaks authenticate.ts, which imports verifyAccessToken/assertTenantActive from this
// same module, so importOriginal is required here, not optional.
vi.mock('@erp/sdk', async (importOriginal) => {
  const actual = await importOriginal<typeof ErpSdk>();
  return { ...actual, requireCapability: () => async () => {} };
});

vi.mock('@erp/db', () => ({
  payrollRuns: {},
  payrollSlips: {},
  employees: { __name: 'employees' },
  employeeSalaries: { __name: 'employeeSalaries' },
  salaryStructures: {},
  designations: {},
  departments: {},
  organizationSettings: {},
  employeeHistory: {},
  branches: {},
}));

vi.mock('drizzle-orm', () => ({
  and: vi.fn((...conditions: unknown[]) => ({ type: 'and', conditions })),
  eq: vi.fn((col: unknown, val: unknown) => ({ type: 'eq', col, val })),
  isNull: vi.fn((col: unknown) => ({ type: 'isNull', col })),
  sql: vi.fn(() => '__sql__'),
}));

vi.mock('@erp/config', () => ({
  requireEnv: (_name: string) => '0'.repeat(64),
}));

vi.mock('@erp/utils/server', () => ({
  encryptField: (val: string, _key: string) => `enc:${val}`,
  decryptField: (val: string, _key: string) => val.replace(/^enc:/, ''),
}));

import { payrollRoutes } from '../api/payroll.routes.js';
import { employees, employeeSalaries } from '@erp/db';

const TEST_TTL = 900;
let privateKey: KeyLike;

async function makeToken(permissions: string[]): Promise<string> {
  const nowSec = Math.floor(Date.now() / 1000);
  return new SignJWT({ tenantId: 1, email: 'test@erp.local', roles: [], permissions })
    .setProtectedHeader({ alg: 'RS256' })
    .setSubject('1')
    .setIssuer('erp-test')
    .setIssuedAt(nowSec)
    .setExpirationTime(nowSec + TEST_TTL)
    .sign(privateKey);
}

beforeAll(async () => {
  const { privateKey: privPem, publicKey: pubPem } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  privateKey = await importPKCS8(privPem, 'RS256');
  process.env['JWT_PUBLIC_KEY'] = pubPem;
});

function makeCtxFactory(activeEmployees: unknown[], activeSalaryEmployeeIds: number[]) {
  const raw = {
    select: vi.fn(() => ({
      from: vi.fn((table: unknown) => ({
        where: vi.fn(async () => {
          if (table === employees) return activeEmployees;
          if (table === employeeSalaries)
            return activeSalaryEmployeeIds.map((employeeId) => ({ employeeId }));
          return [];
        }),
      })),
    })),
  };
  return {
    create: () => ({
      db: { raw, transaction: vi.fn() },
      cache: { getJson: vi.fn().mockResolvedValue(null), setJson: vi.fn() },
      events: { publish: vi.fn() },
      audit: { log: vi.fn() },
    }),
    // requireCapability('HR_PAYROLL', ctxFactory.rawDb, ctxFactory.getRedis()) evaluates both
    // arguments eagerly at route-registration time, before requireCapability itself (mocked
    // above to always allow) ever runs — so these need to exist even though their contents are
    // never touched by the mock.
    rawDb: {},
    getRedis: () => ({}),
  } as never;
}

describe('GET /payroll-runs/preflight', () => {
  it('requires PAYROLL_VIEW', async () => {
    const app = Fastify({ logger: false });
    await payrollRoutes(app, makeCtxFactory([], []));
    const token = await makeToken([]);

    const res = await app.inject({
      method: 'GET',
      url: '/payroll-runs/preflight',
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(403);
    await app.close();
  });

  it('lists only the active employees lacking an active salary structure', async () => {
    const app = Fastify({ logger: false });
    await payrollRoutes(
      app,
      makeCtxFactory(
        [
          { id: 1, employeeCode: 'EMP-001', firstName: 'Asha', lastName: 'Rao' },
          { id: 2, employeeCode: 'EMP-002', firstName: 'New', lastName: 'Hire' },
          { id: 3, employeeCode: 'EMP-003', firstName: 'Ravi', lastName: 'Kumar' },
        ],
        [1, 3] // only employees 1 and 3 have an active salary row
      )
    );
    const token = await makeToken([PERMISSIONS.PAYROLL_VIEW]);

    const res = await app.inject({
      method: 'GET',
      url: '/payroll-runs/preflight',
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as {
      data: {
        totalActiveEmployees: number;
        readyCount: number;
        missingSalaryStructure: Array<{ id: number; employeeCode: string }>;
      };
    };
    expect(body.data.totalActiveEmployees).toBe(3);
    expect(body.data.readyCount).toBe(2);
    expect(body.data.missingSalaryStructure).toHaveLength(1);
    expect(body.data.missingSalaryStructure[0]!.employeeCode).toBe('EMP-002');
    await app.close();
  });

  it('returns an empty missingSalaryStructure list when every active employee is covered', async () => {
    const app = Fastify({ logger: false });
    await payrollRoutes(
      app,
      makeCtxFactory([{ id: 1, employeeCode: 'EMP-001', firstName: 'Asha', lastName: 'Rao' }], [1])
    );
    const token = await makeToken([PERMISSIONS.PAYROLL_VIEW]);

    const res = await app.inject({
      method: 'GET',
      url: '/payroll-runs/preflight',
      headers: { Authorization: `Bearer ${token}` },
    });

    const body = JSON.parse(res.body) as { data: { missingSalaryStructure: unknown[] } };
    expect(body.data.missingSalaryStructure).toEqual([]);
    await app.close();
  });
});

afterAll(() => {
  delete process.env['JWT_PUBLIC_KEY'];
});
