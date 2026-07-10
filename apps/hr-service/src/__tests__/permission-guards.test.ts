/**
 * ES-07 — Permission Guard Tests: hr-service
 * Covers: VIEW_SALARY_DETAILS
 */

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { generateKeyPairSync } from 'node:crypto';
import { SignJWT, importPKCS8, type KeyLike } from 'jose';
import { PERMISSIONS } from '@erp/types';

// ── Module mocks ──────────────────────────────────────────────────────────

vi.mock('@erp/db', () => ({
  payrollRuns: {},
  payrollSlips: {},
  employees: {},
  employeeSalaries: {},
  salaryStructures: {},
  designations: {},
  branches: {},
}));

vi.mock('drizzle-orm', () => ({
  and: vi.fn(() => '__and__'),
  eq: vi.fn(() => '__eq__'),
  isNull: vi.fn(() => '__isNull__'),
  sql: vi.fn(() => '__sql__'),
}));

vi.mock('@erp/config', () => ({
  requireEnv: (_name: string) => '0'.repeat(64),
}));

vi.mock('@erp/utils', () => ({
  encryptField: (val: string, _key: string) => `enc:${val}`,
  decryptField: (val: string, _key: string) => val.replace(/^enc:/, ''),
}));

// ── Route imports ─────────────────────────────────────────────────────────

import { payrollRoutes } from '../api/payroll.routes.js';

// ── Test constants ────────────────────────────────────────────────────────

const TEST_TTL = 900;
let privateKey: KeyLike;

const mockCtxFactory = {
  create: () => ({
    db: { raw: {} as never, transaction: vi.fn() },
    cache: { getJson: vi.fn().mockResolvedValue(null), setJson: vi.fn() },
    events: { publish: vi.fn() },
    audit: { log: vi.fn() },
  }),
} as never;

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

// ═══════════════════════════════════════════════════════════════════════════
// VIEW_SALARY_DETAILS
// ═══════════════════════════════════════════════════════════════════════════

describe('VIEW_SALARY_DETAILS guard on GET /payroll-slips/:id', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = Fastify({ logger: false });
    await payrollRoutes(app, mockCtxFactory);
  });

  afterAll(() => app.close());

  it('returns 403 when user lacks VIEW_SALARY_DETAILS', async () => {
    const token = await makeToken([PERMISSIONS.PAYROLL_VIEW]);

    const res = await app.inject({
      method: 'GET',
      url: '/payroll-slips/42',
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(403);
    const body = JSON.parse(res.body) as { error: { code: string; message: string } };
    expect(body.error.message).toMatch(/VIEW_SALARY_DETAILS/);
  });

  it('does not return 403 when user has VIEW_SALARY_DETAILS', async () => {
    const token = await makeToken([PERMISSIONS.VIEW_SALARY_DETAILS]);

    const res = await app.inject({
      method: 'GET',
      url: '/payroll-slips/42',
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).not.toBe(403);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// No regression — HR managers can view payroll runs
// ═══════════════════════════════════════════════════════════════════════════

describe('No regression — HR_MANAGER can view payroll runs', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = Fastify({ logger: false });
    await payrollRoutes(app, mockCtxFactory);
  });

  afterAll(() => app.close());

  it('user with PAYROLL_VIEW can list payroll runs (not 403)', async () => {
    const token = await makeToken([PERMISSIONS.PAYROLL_VIEW]);

    const res = await app.inject({
      method: 'GET',
      url: '/payroll-runs',
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).not.toBe(403);
  });

  it('user with PAYROLL_VIEW can view a specific payroll run (not 403)', async () => {
    const token = await makeToken([PERMISSIONS.PAYROLL_VIEW]);

    const res = await app.inject({
      method: 'GET',
      url: '/payroll-runs/1',
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).not.toBe(403);
  });

  it('VIEW_SALARY_DETAILS guard only applies to payroll-slips detail, not payroll-runs', async () => {
    // PAYROLL_VIEW without VIEW_SALARY_DETAILS should NOT block payroll runs access
    const token = await makeToken([PERMISSIONS.PAYROLL_VIEW]);

    const [runsRes, slipRes] = await Promise.all([
      app.inject({ method: 'GET', url: '/payroll-runs', headers: { Authorization: `Bearer ${token}` } }),
      app.inject({ method: 'GET', url: '/payroll-slips/1', headers: { Authorization: `Bearer ${token}` } }),
    ]);

    expect(runsRes.statusCode).not.toBe(403);
    expect(slipRes.statusCode).toBe(403);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Admin/HR_MANAGER with VIEW_SALARY_DETAILS can access salary detail
// ═══════════════════════════════════════════════════════════════════════════

describe('HR_MANAGER with VIEW_SALARY_DETAILS — can access payroll slip detail', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = Fastify({ logger: false });
    await payrollRoutes(app, mockCtxFactory);
  });

  afterAll(() => app.close());

  it('HR_MANAGER (PAYROLL_VIEW + VIEW_SALARY_DETAILS) is not blocked on slip detail', async () => {
    const token = await makeToken([PERMISSIONS.PAYROLL_VIEW, PERMISSIONS.VIEW_SALARY_DETAILS]);

    const res = await app.inject({
      method: 'GET',
      url: '/payroll-slips/5',
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).not.toBe(403);
  });
});
