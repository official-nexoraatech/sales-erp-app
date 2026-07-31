// CRM-ROADMAP Phase 2, Feature 1 — permission-guard tests for the five new OPPORTUNITY_*
// constants. Per this codebase's documented recurring bug (rbac_dead_permission_constant_pattern
// — a permission granted in role-defaults.ts but checked under a different constant, or not
// checked at all, at the route), these verify each route-level guard actually gates on the
// specific constant it claims to, matching the pattern in
// crm-campaign-permission-guards.test.ts / crm-dashboard-permission-guards.test.ts.
import { describe, it, expect, vi, beforeAll } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { generateKeyPairSync } from 'node:crypto';
import { SignJWT, importPKCS8, type KeyLike } from 'jose';
import { PERMISSIONS } from '@erp/types';

vi.mock('@erp/db', () => ({
  crmOpportunities: {},
  crmOpportunityLineItems: {},
  crmOpportunityHistory: {},
  crmPipelineStages: {},
  items: {},
}));

vi.mock('drizzle-orm', () => ({
  and: vi.fn(() => '__and__'),
  eq: vi.fn(() => '__eq__'),
  desc: vi.fn(() => '__desc__'),
  asc: vi.fn(() => '__asc__'),
  or: vi.fn(() => '__or__'),
  isNull: vi.fn(() => '__isNull__'),
  inArray: vi.fn(() => '__inArray__'),
}));

import { opportunityRoutes } from '../api/opportunity.routes.js';

const TEST_ISSUER = process.env['JWT_ISSUER'] ?? 'erp-auth-service';
let privateKey: KeyLike;

function emptyQueryResult() {
  return Object.assign(Promise.resolve([]), {
    orderBy: () => Object.assign(Promise.resolve([]), { limit: () => Promise.resolve([]) }),
  });
}

const mockCtxFactory = {
  create: () => ({
    db: {
      raw: {
        select: () => ({ from: () => ({ where: () => emptyQueryResult() }) }),
      } as never,
    },
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
});

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await opportunityRoutes(app, mockCtxFactory);
  await app.ready();
  return app;
}

describe('GET /opportunities — requires OPPORTUNITY_VIEW', () => {
  it('403s a caller without it', async () => {
    const app = await buildApp();
    const token = await makeToken([]);
    const res = await app.inject({
      method: 'GET',
      url: '/opportunities',
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(403);
    await app.close();
  });

  it('does not 403 a caller with it', async () => {
    const app = await buildApp();
    const token = await makeToken([PERMISSIONS.OPPORTUNITY_VIEW]);
    const res = await app.inject({
      method: 'GET',
      url: '/opportunities',
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).not.toBe(403);
    await app.close();
  });
});

describe('POST /opportunities — requires OPPORTUNITY_CREATE', () => {
  it('403s a caller with only OPPORTUNITY_VIEW', async () => {
    const app = await buildApp();
    const token = await makeToken([PERMISSIONS.OPPORTUNITY_VIEW]);
    const res = await app.inject({
      method: 'POST',
      url: '/opportunities',
      headers: { Authorization: `Bearer ${token}` },
      payload: { name: 'Deal', value: 100 },
    });
    expect(res.statusCode).toBe(403);
    await app.close();
  });
});

describe('PUT /opportunities/:id — requires OPPORTUNITY_UPDATE', () => {
  it('403s a caller with only OPPORTUNITY_VIEW', async () => {
    const app = await buildApp();
    const token = await makeToken([PERMISSIONS.OPPORTUNITY_VIEW]);
    const res = await app.inject({
      method: 'PUT',
      url: '/opportunities/1',
      headers: { Authorization: `Bearer ${token}` },
      payload: { version: 0 },
    });
    expect(res.statusCode).toBe(403);
    await app.close();
  });
});

describe('POST /opportunities/:id/stage — requires OPPORTUNITY_STAGE_CHANGE', () => {
  it('403s a caller with only OPPORTUNITY_UPDATE', async () => {
    const app = await buildApp();
    const token = await makeToken([PERMISSIONS.OPPORTUNITY_UPDATE]);
    const res = await app.inject({
      method: 'POST',
      url: '/opportunities/1/stage',
      headers: { Authorization: `Bearer ${token}` },
      payload: { toStageCode: 'QUALIFICATION', version: 0 },
    });
    expect(res.statusCode).toBe(403);
    await app.close();
  });
});

describe('DELETE /opportunities/:id — requires OPPORTUNITY_DELETE', () => {
  it('403s a caller with only OPPORTUNITY_UPDATE', async () => {
    const app = await buildApp();
    const token = await makeToken([PERMISSIONS.OPPORTUNITY_UPDATE]);
    const res = await app.inject({
      method: 'DELETE',
      url: '/opportunities/1',
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(403);
    await app.close();
  });
});
