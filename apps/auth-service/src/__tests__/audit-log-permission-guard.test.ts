// QA session (2026-07-12) -- requireAnyPermission guard test.
//
// ACCOUNTANT and ACCOUNTANT_SUPERVISOR's role-defaults.ts grants included AUDIT_LOG_VIEW, but
// GET /admin/audit-logs and GET /admin/security-audit-log only ever checked VIEW_AUDIT_LOG --
// a near-duplicate-named constant nobody but AUDITOR (which has both) was actually granted.
// Fixed with requireAnyPermission([VIEW_AUDIT_LOG, AUDIT_LOG_VIEW]).
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { generateKeyPairSync } from 'node:crypto';
import { SignJWT, importPKCS8, type KeyLike } from 'jose';
import { PERMISSIONS } from '@erp/types';
import { initializeJwt } from '../jwt.js';
import { authenticate } from '../middleware/authenticate.js';
import { auditLogRoutes } from '../routes/audit-log.routes.js';

const TEST_ISSUER = 'erp-auth-service-test';

const mockDb = {
  select: vi.fn().mockReturnThis(),
  from: vi.fn().mockReturnThis(),
  where: vi.fn().mockReturnThis(),
  orderBy: vi.fn().mockReturnThis(),
  limit: vi.fn().mockReturnThis(),
  offset: vi.fn().mockResolvedValue([]),
} as never;

let privateKey: KeyLike;

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
  await initializeJwt({
    privateKeyPem: privPem,
    publicKeyPem: pubPem,
    issuer: TEST_ISSUER,
    accessTokenTtlSeconds: 900,
  });
});

describe('GET /admin/audit-logs -- requireAnyPermission([VIEW_AUDIT_LOG, AUDIT_LOG_VIEW])', () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    app = Fastify({ logger: false });
    app.addHook('preHandler', authenticate);
    await auditLogRoutes(app, mockDb);
  });
  afterAll(() => app.close());

  it('403s a caller with neither permission', async () => {
    const token = await makeToken([PERMISSIONS.DASHBOARD_VIEW]);
    const res = await app.inject({
      method: 'GET',
      url: '/admin/audit-logs',
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(403);
  });

  it('does not 403 a caller with only AUDIT_LOG_VIEW -- ACCOUNTANT/ACCOUNTANT_SUPERVISOR are granted this but never had VIEW_AUDIT_LOG', async () => {
    const token = await makeToken([PERMISSIONS.AUDIT_LOG_VIEW]);
    const res = await app.inject({
      method: 'GET',
      url: '/admin/audit-logs',
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).not.toBe(403);
  });

  it('does not 403 a caller with only the legacy VIEW_AUDIT_LOG -- no regression', async () => {
    const token = await makeToken([PERMISSIONS.VIEW_AUDIT_LOG]);
    const res = await app.inject({
      method: 'GET',
      url: '/admin/audit-logs',
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).not.toBe(403);
  });
});
