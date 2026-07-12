// QA session (2026-07-12) -- requireAnyPermission guard test.
//
// ACCOUNTANT's role-defaults.ts grant included PAYMENT_IN_VIEW (not PAYMENT_VIEW), but
// GET /payments and GET /payments/:id only ever checked PAYMENT_VIEW -- ACCOUNTANT could not
// view customer payments received at all despite apparently being granted view access. Fixed
// with requireAnyPermission([PAYMENT_VIEW, PAYMENT_IN_VIEW]).
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { generateKeyPairSync } from 'node:crypto';
import { SignJWT, importPKCS8, type KeyLike } from 'jose';
import { PERMISSIONS } from '@erp/types';

vi.mock('@erp/db', () => ({ payments: {} }));

vi.mock('drizzle-orm', () => ({
  and: vi.fn(() => '__and__'),
  desc: vi.fn(() => '__desc__'),
  eq: vi.fn(() => '__eq__'),
  sql: vi.fn(() => '__sql__'),
}));

import { paymentRoutes } from '../api/payment.routes.js';

const mockCtxFactory = {
  create: () => ({
    db: { raw: {} as never, transaction: vi.fn() },
    cache: { getJson: vi.fn().mockResolvedValue(null), setJson: vi.fn() },
    events: { publish: vi.fn() },
    audit: { log: vi.fn() },
  }),
} as never;

let privateKey: KeyLike;

async function makeToken(permissions: string[]): Promise<string> {
  const nowSec = Math.floor(Date.now() / 1000);
  return new SignJWT({ tenantId: 1, email: 'test@erp.local', roles: [], permissions })
    .setProtectedHeader({ alg: 'RS256' })
    .setSubject('1')
    .setIssuer('erp-test')
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

describe('GET /payments -- requireAnyPermission([PAYMENT_VIEW, PAYMENT_IN_VIEW])', () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    app = Fastify({ logger: false });
    await paymentRoutes(app, mockCtxFactory);
  });
  afterAll(() => app.close());

  it('403s a caller with neither permission', async () => {
    const token = await makeToken([]);
    const res = await app.inject({
      method: 'GET',
      url: '/payments',
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(403);
  });

  it('does not 403 a caller with only PAYMENT_IN_VIEW -- ACCOUNTANT is granted this but never had PAYMENT_VIEW', async () => {
    const token = await makeToken([PERMISSIONS.PAYMENT_IN_VIEW]);
    const res = await app.inject({
      method: 'GET',
      url: '/payments',
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).not.toBe(403);
  });

  it('does not 403 a caller with only the legacy PAYMENT_VIEW -- no regression', async () => {
    const token = await makeToken([PERMISSIONS.PAYMENT_VIEW]);
    const res = await app.inject({
      method: 'GET',
      url: '/payments',
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).not.toBe(403);
  });
});
