/**
 * OFFLINE-04 — permission gating on GET /sync/customers.
 * Runs without a DB — mirrors pos-branch-isolation.test.ts's mock style. Data-correctness
 * (tenant/branch scoping, modifiedSince) is covered by sync-routes.integration.test.ts.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { generateKeyPairSync } from 'node:crypto';
import { SignJWT, importPKCS8, type KeyLike } from 'jose';
import { PERMISSIONS } from '@erp/types';

vi.mock('@erp/db', () => ({
  customers: {},
}));

vi.mock('drizzle-orm', () => ({
  and: vi.fn(() => '__and__'),
  asc: vi.fn(() => '__asc__'),
  eq: vi.fn(() => '__eq__'),
  gte: vi.fn(() => '__gte__'),
  inArray: vi.fn(() => '__inArray__'),
  isNull: vi.fn(() => '__isNull__'),
  sql: vi.fn(() => '__sql__'),
}));

import { syncRoutes } from '../api/sync.routes.js';

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
  return new SignJWT({ tenantId: 1, email: 'test@erp.local', roles: [], permissions, branchIds: [] })
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

describe('Auth gating on OFFLINE-04 GET /sync/customers', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = Fastify({ logger: false });
    await syncRoutes(app, mockCtxFactory);
  });

  afterAll(() => app.close());

  it('returns 401 with no Authorization header', async () => {
    const res = await app.inject({ method: 'GET', url: '/sync/customers' });
    expect(res.statusCode).toBe(401);
  });

  it('returns 403 without CUSTOMER_VIEW', async () => {
    const token = await makeToken([]);
    const res = await app.inject({ method: 'GET', url: '/sync/customers', headers: { Authorization: `Bearer ${token}` } });
    expect(res.statusCode).toBe(403);
  });

  it('does not reject a caller who holds CUSTOMER_VIEW', async () => {
    const token = await makeToken([PERMISSIONS.CUSTOMER_VIEW]);
    const res = await app.inject({ method: 'GET', url: '/sync/customers', headers: { Authorization: `Bearer ${token}` } });
    expect(res.statusCode).not.toBe(401);
    expect(res.statusCode).not.toBe(403);
  });
});
