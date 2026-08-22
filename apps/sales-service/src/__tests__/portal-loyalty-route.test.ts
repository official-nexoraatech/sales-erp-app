// CRM-ROADMAP Phase 3, Feature 2 (Self-Service Customer Portal) — GET /portal/loyalty.
// CRM/O2C split: getBalance moved to crm-service, so this route now reaches it via fetch +
// x-internal-key (portal.routes.ts's fetchLoyaltyBalance). Mocks fetch rather than depending on
// a live crm-service process, same pattern as customer-360-degradation.test.ts.
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { generateKeyPairSync } from 'node:crypto';
import { SignJWT, importPKCS8, type KeyLike } from 'jose';
import type { ErpDatabase } from '@erp/db';

process.env['CRM_SERVICE_URL'] = 'http://crm-service.test';
process.env['INTERNAL_API_KEY'] = 'test-internal-key';
const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);
afterAll(() => vi.unstubAllGlobals());

import { portalRoutes } from '../api/portal.routes.js';

const TEST_ISSUER = 'erp-test';
let privateKey: KeyLike;

async function makeToken(): Promise<string> {
  const nowSec = Math.floor(Date.now() / 1000);
  return new SignJWT({
    tenantId: 1,
    email: 'customer@example.com',
    roles: ['CUSTOMER'],
    permissions: [],
    branchIds: [],
    customerId: 42,
  })
    .setProtectedHeader({ alg: 'RS256' })
    .setSubject('7')
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

describe('GET /portal/loyalty', () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    app = Fastify({ logger: false });
    await portalRoutes(app, {} as ErpDatabase);
    await app.ready();
  });
  afterAll(() => app.close());

  it('200s with the crm-service balance on success, calling the right customer/tenant', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: { points: 100, redeemValue: 50, tier: 'Silver' } }),
    });

    const token = await makeToken();
    const res = await app.inject({
      method: 'GET',
      url: '/portal/loyalty',
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { data: { points: number; tier: string } };
    expect(body.data.points).toBe(100);
    expect(body.data.tier).toBe('Silver');

    const calledUrl = String(fetchMock.mock.calls.at(-1)![0]);
    expect(calledUrl).toContain('/internal/customers/42/loyalty-balance');
    expect(calledUrl).toContain('tenantId=1');
  });

  it('propagates a 503 when crm-service is unreachable, instead of silently degrading', async () => {
    fetchMock.mockRejectedValueOnce(new Error('ECONNREFUSED'));

    const token = await makeToken();
    const res = await app.inject({
      method: 'GET',
      url: '/portal/loyalty',
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBeGreaterThanOrEqual(500);
  });
});
