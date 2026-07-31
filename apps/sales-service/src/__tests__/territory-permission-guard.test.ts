// CRM-ROADMAP Phase 4, Feature 4 (Territory Management) — permission-guard test for
// territory.routes.ts. A single TERRITORY_MANAGE permission gates every route (Sales Ops admin
// configuration, not a customer-facing entity needing granular view/create splits).
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { generateKeyPairSync } from 'node:crypto';
import { SignJWT, importPKCS8, type KeyLike } from 'jose';
import { PERMISSIONS } from '@erp/types';

vi.mock('@erp/db', () => ({
  crmTerritories: {},
  crmTerritoryBranches: {},
  crmTerritoryUsers: {},
  branches: {},
  users: {},
  crmLeads: {},
  crmOpportunities: {},
}));

vi.mock('drizzle-orm', () => ({
  and: vi.fn(() => '__and__'),
  desc: vi.fn(() => '__desc__'),
  eq: vi.fn(() => '__eq__'),
  inArray: vi.fn(() => '__inArray__'),
  sql: vi.fn(() => '__sql__'),
}));

import { territoryRoutes } from '../api/territory.routes.js';

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

describe('GET /territories — requirePermission(TERRITORY_MANAGE)', () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    app = Fastify({ logger: false });
    await territoryRoutes(app, mockCtxFactory);
  });
  afterAll(() => app.close());

  it('403s a caller without TERRITORY_MANAGE', async () => {
    const token = await makeToken([]);
    const res = await app.inject({
      method: 'GET',
      url: '/territories',
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(403);
  });

  it('401s with no token at all', async () => {
    const res = await app.inject({ method: 'GET', url: '/territories' });
    expect(res.statusCode).toBe(401);
  });
});

describe('POST /territories/:id/branches — requirePermission(TERRITORY_MANAGE)', () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    app = Fastify({ logger: false });
    await territoryRoutes(app, mockCtxFactory);
  });
  afterAll(() => app.close());

  it('403s a caller without TERRITORY_MANAGE', async () => {
    const token = await makeToken([PERMISSIONS.LEAD_ASSIGN]);
    const res = await app.inject({
      method: 'PUT',
      url: '/territories/1/branches',
      headers: { Authorization: `Bearer ${token}` },
      payload: { branchIds: [1] },
    });
    expect(res.statusCode).toBe(403);
  });
});
