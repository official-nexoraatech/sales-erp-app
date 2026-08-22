// CRM/O2C split — permission-guard test for loyalty.routes.ts's 6 moved endpoints (JWT +
// LOYALTY_TIER_MANAGE/CUSTOMER_VIEW/LOYALTY_REDEEM) and internal.routes.ts's 3 loyalty-related
// endpoints (x-internal-key, no JWT).
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { generateKeyPairSync } from 'node:crypto';
import { SignJWT, importPKCS8, type KeyLike } from 'jose';
import { PERMISSIONS } from '@erp/types';

vi.mock('@erp/db', () => ({
  customers: {},
  loyaltyTransactions: {},
  crmLoyaltyTiers: {},
  crmRedemptionCatalog: {},
  tenants: {},
  createDatabaseClient: vi.fn(),
}));

vi.mock('drizzle-orm', () => ({
  and: vi.fn(() => '__and__'),
  eq: vi.fn(() => '__eq__'),
  inArray: vi.fn(() => '__inArray__'),
  lt: vi.fn(() => '__lt__'),
  sql: Object.assign(
    vi.fn(() => '__sql__'),
    { raw: vi.fn() }
  ),
}));

import { loyaltyRoutes } from '../api/loyalty.routes.js';
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

describe('loyalty.routes.ts — requirePermission guards', () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    app = Fastify({ logger: false });
    await loyaltyRoutes(app, mockCtxFactory);
  });
  afterAll(() => app.close());

  it('403s GET /customers/:id/loyalty without CUSTOMER_VIEW', async () => {
    const token = await makeToken([]);
    const res = await app.inject({
      method: 'GET',
      url: '/customers/1/loyalty',
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(403);
  });

  it('401s GET /customers/:id/loyalty with no token', async () => {
    const res = await app.inject({ method: 'GET', url: '/customers/1/loyalty' });
    expect(res.statusCode).toBe(401);
  });

  it('403s GET /loyalty/redemption-catalog without LOYALTY_REDEEM or LOYALTY_TIER_MANAGE', async () => {
    const token = await makeToken([]);
    const res = await app.inject({
      method: 'GET',
      url: '/loyalty/redemption-catalog',
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(403);
  });

  it('403s POST /loyalty/tiers without LOYALTY_TIER_MANAGE', async () => {
    const token = await makeToken([PERMISSIONS.LOYALTY_REDEEM]);
    const res = await app.inject({
      method: 'POST',
      url: '/loyalty/tiers',
      headers: { Authorization: `Bearer ${token}` },
      payload: { name: 'Test', code: 'test', minLifetimePoints: 0 },
    });
    expect(res.statusCode).toBe(403);
  });
});

describe('internal.routes.ts — loyalty endpoints require x-internal-key', () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    app = Fastify({ logger: false });
    await internalRoutes(app, mockCtxFactory);
  });
  afterAll(() => app.close());

  it('401s POST /loyalty/expire-points with no x-internal-key', async () => {
    const res = await app.inject({ method: 'POST', url: '/loyalty/expire-points' });
    expect(res.statusCode).toBe(401);
  });

  it('401s POST /loyalty/expiry-warnings/send with a wrong x-internal-key', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/loyalty/expiry-warnings/send',
      headers: { 'x-internal-key': 'wrong-key' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('401s GET /internal/customers/:id/loyalty-balance with no x-internal-key', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/internal/customers/1/loyalty-balance?tenantId=1',
    });
    expect(res.statusCode).toBe(401);
  });
});
