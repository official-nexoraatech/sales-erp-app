// CRM-ROADMAP Phase 4, Feature 6 (Partner/Channel Portal): unit tests for requirePartnerAuth
// (middleware/partner-auth.ts) — mirrors portal-auth-middleware.test.ts exactly for the
// PARTNER auth scope. Covers the claim-extraction edge cases: missing customerId, a
// non-PARTNER role, and an invalid/expired token.
import { describe, it, expect, beforeAll } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { generateKeyPairSync } from 'node:crypto';
import { SignJWT, importPKCS8, type KeyLike } from 'jose';
import { requirePartnerAuth } from '../middleware/partner-auth.js';

const TEST_ISSUER = 'erp-test';
let privateKey: KeyLike;

async function makeToken(
  overrides: Partial<{
    roles: string[];
    // null means "omit the claim entirely" — distinct from the default-42 case, since JS
    // destructuring defaults also kick in for an explicitly-passed `undefined`.
    customerId: number | null;
    tenantId: number;
    expiresInSeconds: number;
  }> = {}
): Promise<string> {
  const nowSec = Math.floor(Date.now() / 1000);
  const { roles = ['PARTNER'], customerId = 42, tenantId = 1, expiresInSeconds = 900 } = overrides;
  return new SignJWT({
    tenantId,
    email: 'partner@example.com',
    roles,
    permissions: [],
    branchIds: [],
    ...(customerId !== null ? { customerId } : {}),
  })
    .setProtectedHeader({ alg: 'RS256' })
    .setSubject('7')
    .setIssuer(TEST_ISSUER)
    .setIssuedAt(nowSec)
    .setExpirationTime(nowSec + expiresInSeconds)
    .sign(privateKey);
}

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  app.get('/probe', { preHandler: [requirePartnerAuth] }, async (request, reply) => {
    return reply.code(200).send({ customerId: request.partnerAuth.customerId });
  });
  await app.ready();
  return app;
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

describe('requirePartnerAuth', () => {
  it('401s with no Authorization header', async () => {
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/probe' });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it('401s an invalid/malformed token', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/probe',
      headers: { Authorization: 'Bearer not-a-real-token' },
    });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it('401s an expired token', async () => {
    const app = await buildApp();
    const token = await makeToken({ expiresInSeconds: -10 });
    const res = await app.inject({
      method: 'GET',
      url: '/probe',
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it('401s a valid token whose roles do not include PARTNER (a staff token)', async () => {
    const app = await buildApp();
    const token = await makeToken({ roles: ['SALES_MANAGER'] });
    const res = await app.inject({
      method: 'GET',
      url: '/probe',
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it('401s a valid token whose roles include CUSTOMER, not PARTNER (wrong portal)', async () => {
    const app = await buildApp();
    const token = await makeToken({ roles: ['CUSTOMER'] });
    const res = await app.inject({
      method: 'GET',
      url: '/probe',
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it('401s a PARTNER-role token missing the customerId claim', async () => {
    const app = await buildApp();
    const token = await makeToken({ roles: ['PARTNER'], customerId: null });
    const res = await app.inject({
      method: 'GET',
      url: '/probe',
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it('lets a valid PARTNER-role token with a customerId claim through', async () => {
    const app = await buildApp();
    const token = await makeToken({ roles: ['PARTNER'], customerId: 99 });
    const res = await app.inject({
      method: 'GET',
      url: '/probe',
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ customerId: 99 });
    await app.close();
  });
});
