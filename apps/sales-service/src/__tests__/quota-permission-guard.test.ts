// CRM-ROADMAP Phase 4, Feature 5 (Sales Forecasting & Quota Management) — permission-guard
// test for quota.routes.ts. QUOTA_MANAGE gates every CRUD route (Sales Ops admin
// configuration); QUOTA_VALUE_VIEW additionally hides the $ figures within GET /quotas and
// GET /quotas/attainment for a caller who has QUOTA_MANAGE but not QUOTA_VALUE_VIEW.
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { generateKeyPairSync } from 'node:crypto';
import { SignJWT, importPKCS8, type KeyLike } from 'jose';
import { PERMISSIONS } from '@erp/types';

vi.mock('@erp/db', () => ({
  crmSalesQuotas: {},
  crmTerritories: {},
  crmTerritoryBranches: {},
  crmOpportunities: {},
  users: {},
}));

vi.mock('drizzle-orm', () => ({
  and: vi.fn(() => '__and__'),
  eq: vi.fn(() => '__eq__'),
  inArray: vi.fn(() => '__inArray__'),
  sql: vi.fn(() => '__sql__'),
}));

import { quotaRoutes } from '../api/quota.routes.js';

const TEST_ISSUER = 'erp-test';
let privateKey: KeyLike;

const mockCtxFactory = {
  create: () => ({
    db: { raw: {} as never, transaction: vi.fn() },
    events: { publish: vi.fn() },
    audit: { log: vi.fn() },
  }),
} as never;

async function makeToken(permissions: string[]): Promise<string> {
  const nowSec = Math.floor(Date.now() / 1000);
  return new SignJWT({
    tenantId: 1,
    email: 'test@erp.local',
    roles: [],
    permissions,
    branchIds: [],
  })
    .setProtectedHeader({ alg: 'RS256' })
    .setSubject('1')
    .setIssuer(TEST_ISSUER)
    .setIssuedAt(nowSec)
    .setExpirationTime(nowSec + 900)
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
  process.env['JWT_ISSUER'] = TEST_ISSUER;
});

describe('GET /quotas — requirePermission(QUOTA_MANAGE)', () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    app = Fastify({ logger: false });
    await quotaRoutes(app, mockCtxFactory);
  });
  afterAll(() => app.close());

  it('403s a caller without QUOTA_MANAGE', async () => {
    const token = await makeToken([]);
    const res = await app.inject({
      method: 'GET',
      url: '/quotas',
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(403);
  });

  it('401s with no token at all', async () => {
    const res = await app.inject({ method: 'GET', url: '/quotas' });
    expect(res.statusCode).toBe(401);
  });
});

describe('POST /quotas — requirePermission(QUOTA_MANAGE)', () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    app = Fastify({ logger: false });
    await quotaRoutes(app, mockCtxFactory);
  });
  afterAll(() => app.close());

  it('403s a caller with only QUOTA_VALUE_VIEW (view-only figure access, not management)', async () => {
    const token = await makeToken([PERMISSIONS.QUOTA_VALUE_VIEW]);
    const res = await app.inject({
      method: 'POST',
      url: '/quotas',
      headers: { Authorization: `Bearer ${token}` },
      payload: {
        subjectType: 'REP',
        subjectUserId: 1,
        periodYear: 2026,
        periodMonth: 1,
        quotaAmount: 100,
      },
    });
    expect(res.statusCode).toBe(403);
  });
});
