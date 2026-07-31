// CRM-ROADMAP Phase 4, Feature 1 (Field Sales / Distributor CRM) — permission-guard test for
// field-visit.routes.ts.
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { generateKeyPairSync } from 'node:crypto';
import { SignJWT, importPKCS8, type KeyLike } from 'jose';
import { PERMISSIONS } from '@erp/types';

vi.mock('@erp/db', () => ({
  crmVisitRoutes: {},
  crmVisitRouteStops: {},
  crmFieldVisits: {},
  customers: {},
}));

vi.mock('drizzle-orm', () => ({
  and: vi.fn(() => '__and__'),
  eq: vi.fn(() => '__eq__'),
  gte: vi.fn(() => '__gte__'),
  lte: vi.fn(() => '__lte__'),
  sql: Object.assign(
    vi.fn(() => '__sql__'),
    { raw: vi.fn() }
  ),
}));

import { fieldVisitRoutes } from '../api/field-visit.routes.js';

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

describe('POST /visit-routes — requirePermission(ROUTE_MANAGE)', () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    app = Fastify({ logger: false });
    await fieldVisitRoutes(app, mockCtxFactory);
  });
  afterAll(() => app.close());

  it('403s a caller with only FIELD_VISIT_MANAGE (a rep cannot create routes)', async () => {
    const token = await makeToken([PERMISSIONS.FIELD_VISIT_MANAGE]);
    const res = await app.inject({
      method: 'POST',
      url: '/visit-routes',
      headers: { Authorization: `Bearer ${token}` },
      payload: { name: 'Route', assignedTo: 1, scheduledDate: new Date().toISOString() },
    });
    expect(res.statusCode).toBe(403);
  });

  it('401s with no token at all', async () => {
    const res = await app.inject({ method: 'POST', url: '/visit-routes', payload: {} });
    expect(res.statusCode).toBe(401);
  });
});

describe('GET /visit-routes — requireAnyPermission([ROUTE_MANAGE, FIELD_VISIT_MANAGE])', () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    app = Fastify({ logger: false });
    await fieldVisitRoutes(app, mockCtxFactory);
  });
  afterAll(() => app.close());

  it('403s a caller with neither permission', async () => {
    const token = await makeToken([]);
    const res = await app.inject({
      method: 'GET',
      url: '/visit-routes',
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(403);
  });
});

describe('POST /field-visits — requireAnyPermission([FIELD_VISIT_MANAGE, ROUTE_MANAGE])', () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    app = Fastify({ logger: false });
    await fieldVisitRoutes(app, mockCtxFactory);
  });
  afterAll(() => app.close());

  it('403s a caller with neither permission', async () => {
    const token = await makeToken([PERMISSIONS.TERRITORY_MANAGE]);
    const res = await app.inject({
      method: 'POST',
      url: '/field-visits',
      headers: { Authorization: `Bearer ${token}` },
      payload: { customerId: 1, clientOperationId: 'op-1' },
    });
    expect(res.statusCode).toBe(403);
  });
});
