// CRM-ROADMAP Phase 4, Feature 8 (Public CRM API & BI Export) — permission-guard test for
// api-key.routes.ts. API_KEY_MANAGE gates every route (deliberately reserved for OWNER/ADMIN/
// SUPER_ADMIN only, not SALES_MANAGER — see permissions.ts's own comment).
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { generateKeyPairSync } from 'node:crypto';
import { SignJWT, importPKCS8, type KeyLike } from 'jose';
import { PERMISSIONS } from '@erp/types';

vi.mock('@erp/db', () => ({
  crmApiKeys: {},
}));

vi.mock('../domain/ApiKeyService.js', () => ({
  ApiKeyService: {
    list: vi.fn().mockResolvedValue([]),
    create: vi.fn(),
    revoke: vi.fn(),
  },
  PUBLIC_API_SCOPES: ['leads:read', 'opportunities:read', 'accounts:read', 'contacts:read'],
}));

import { apiKeyRoutes } from '../api/api-key.routes.js';

const TEST_ISSUER = 'erp-test';
let privateKey: KeyLike;

const mockCtxFactory = {
  create: () => ({
    db: { raw: {} as never, transaction: vi.fn() },
    events: { publish: vi.fn() },
    audit: { log: vi.fn() },
    tenant: { tenantId: 1, userId: 1, correlationId: 'test' },
  }),
  rawDb: {
    transaction: (cb: (trx: unknown) => unknown) => cb({ execute: async () => [] }),
    execute: async () => [],
  },
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

describe('GET /api-keys — requirePermission(API_KEY_MANAGE)', () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    app = Fastify({ logger: false });
    await apiKeyRoutes(app, mockCtxFactory);
  });
  afterAll(() => app.close());

  it('403s a caller without API_KEY_MANAGE (e.g. a SALES_MANAGER-shaped token)', async () => {
    const token = await makeToken([PERMISSIONS.TERRITORY_MANAGE, PERMISSIONS.QUOTA_MANAGE]);
    const res = await app.inject({
      method: 'GET',
      url: '/api-keys',
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(403);
  });

  it('200s a caller with API_KEY_MANAGE', async () => {
    const token = await makeToken([PERMISSIONS.API_KEY_MANAGE]);
    const res = await app.inject({
      method: 'GET',
      url: '/api-keys',
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
  });

  it('401s with no token at all', async () => {
    const res = await app.inject({ method: 'GET', url: '/api-keys' });
    expect(res.statusCode).toBe(401);
  });
});

describe('DELETE /api-keys/:id — requirePermission(API_KEY_MANAGE)', () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    app = Fastify({ logger: false });
    await apiKeyRoutes(app, mockCtxFactory);
  });
  afterAll(() => app.close());

  it('403s a caller without API_KEY_MANAGE', async () => {
    const token = await makeToken([]);
    const res = await app.inject({
      method: 'DELETE',
      url: '/api-keys/1',
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(403);
  });
});
