// CRM-ROADMAP Phase 4, Feature 7 (CTI / Call Center Integration) — permission-guard test for
// call.routes.ts.
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { generateKeyPairSync } from 'node:crypto';
import { SignJWT, importPKCS8, type KeyLike } from 'jose';
import { PERMISSIONS } from '@erp/types';

vi.mock('@erp/db', () => ({
  crmCallLogs: {},
  users: {},
}));

vi.mock('drizzle-orm', () => ({
  and: vi.fn(() => '__and__'),
  desc: vi.fn(() => '__desc__'),
  eq: vi.fn(() => '__eq__'),
}));

import { callRoutes } from '../api/call.routes.js';

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

describe('POST /calls/initiate — requirePermission(CALL_INITIATE)', () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    app = Fastify({ logger: false });
    await callRoutes(app, mockCtxFactory);
  });
  afterAll(() => app.close());

  it('403s a caller without CALL_INITIATE', async () => {
    const token = await makeToken([PERMISSIONS.CALL_LOG_VIEW]);
    const res = await app.inject({
      method: 'POST',
      url: '/calls/initiate',
      headers: { Authorization: `Bearer ${token}` },
      payload: { toNumber: '9000000000' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('401s with no token at all', async () => {
    const res = await app.inject({ method: 'POST', url: '/calls/initiate', payload: {} });
    expect(res.statusCode).toBe(401);
  });
});

describe('GET /calls — requireAnyPermission([CALL_INITIATE, CALL_LOG_VIEW])', () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    app = Fastify({ logger: false });
    await callRoutes(app, mockCtxFactory);
  });
  afterAll(() => app.close());

  it('403s a caller with neither permission', async () => {
    const token = await makeToken([]);
    const res = await app.inject({
      method: 'GET',
      url: '/calls',
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(403);
  });
});
