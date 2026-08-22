// CRM/O2C split — permission-guard test for health-scoring.routes.ts (JWT + CRM_VIEW) and
// internal.routes.ts (x-internal-key, no JWT).
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { generateKeyPairSync } from 'node:crypto';
import { SignJWT, importPKCS8, type KeyLike } from 'jose';

vi.mock('@erp/db', () => ({
  customers: {},
  items: {},
  crmChurnPredictions: {},
  crmNextBestActions: {},
  crmProductRecommendations: {},
}));

vi.mock('drizzle-orm', () => ({
  and: vi.fn(() => '__and__'),
  eq: vi.fn(() => '__eq__'),
  isNull: vi.fn(() => '__isNull__'),
  sql: Object.assign(
    vi.fn(() => '__sql__'),
    { raw: vi.fn() }
  ),
}));

import { healthScoringRoutes } from '../api/health-scoring.routes.js';
import { internalRoutes } from '../api/internal.routes.js';

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
  process.env['INTERNAL_API_KEY'] = 'test-internal-key';
});

describe('GET /crm/segments/health — requirePermission(CRM_VIEW)', () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    app = Fastify({ logger: false });
    await healthScoringRoutes(app, mockCtxFactory);
  });
  afterAll(() => app.close());

  it('403s a caller without CRM_VIEW', async () => {
    const token = await makeToken([]);
    const res = await app.inject({
      method: 'GET',
      url: '/crm/segments/health',
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(403);
  });

  it('401s with no token at all', async () => {
    const res = await app.inject({ method: 'GET', url: '/crm/segments/health' });
    expect(res.statusCode).toBe(401);
  });
});

describe('internal.routes.ts — requireInternalKey', () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    app = Fastify({ logger: false });
    await internalRoutes(app, mockCtxFactory);
  });
  afterAll(() => app.close());

  it('401s GET /internal/customers/:id/health-predictions with a wrong x-internal-key', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/internal/customers/1/health-predictions?tenantId=1',
      headers: { 'x-internal-key': 'wrong-key' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('401s GET /internal/customers/:id/health-predictions with no x-internal-key', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/internal/customers/1/health-predictions?tenantId=1',
    });
    expect(res.statusCode).toBe(401);
  });

  it('401s POST /internal/recommendations/:id/feedback with a wrong x-internal-key', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/internal/recommendations/1/feedback',
      headers: { 'x-internal-key': 'wrong-key' },
      payload: { tenantId: 1, recommendationType: 'NEXT_BEST_ACTION', action: 'DISMISS' },
    });
    expect(res.statusCode).toBe(401);
  });
});
