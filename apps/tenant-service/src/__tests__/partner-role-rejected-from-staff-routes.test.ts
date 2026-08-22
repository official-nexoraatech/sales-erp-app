// CRM-ROADMAP Phase 4, Feature 6 (Partner/Channel Portal) — mirrors
// customer-role-rejected-from-staff-routes.test.ts exactly for the PARTNER auth scope.
// approval.routes.ts scopes every query/action to the caller's own userId as the assigned
// approver — a PARTNER-role JWT's numeric id could coincidentally collide with a real
// employee's users.id and reach that employee's own pending approvals.
import { describe, it, expect, beforeAll } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { generateKeyPairSync } from 'node:crypto';
import { SignJWT, importPKCS8, type KeyLike } from 'jose';
import type { ErpDatabase } from '@erp/db';
import { approvalRoutes } from '../api/approval.routes.js';

const TEST_ISSUER = 'erp-test';
let privateKey: KeyLike;

async function makeToken(roles: string[], customerId?: number): Promise<string> {
  const nowSec = Math.floor(Date.now() / 1000);
  return new SignJWT({
    tenantId: 1,
    email: 'x@example.com',
    roles,
    permissions: [],
    branchIds: [],
    ...(customerId !== undefined ? { customerId } : {}),
  })
    .setProtectedHeader({ alg: 'RS256' })
    .setSubject('7')
    .setIssuer(TEST_ISSUER)
    .setIssuedAt(nowSec)
    .setExpirationTime(nowSec + 900)
    .sign(privateKey);
}

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await approvalRoutes(app, {} as ErpDatabase);
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

describe('GET /approvals/pending rejects a PARTNER-role token', () => {
  it('401s a PARTNER-role token', async () => {
    const app = await buildApp();
    const token = await makeToken(['PARTNER'], 42);
    const res = await app.inject({
      method: 'GET',
      url: '/approvals/pending',
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it('does not reject a normal staff token (control)', async () => {
    const app = await buildApp();
    const token = await makeToken(['ADMIN']);
    const res = await app.inject({
      method: 'GET',
      url: '/approvals/pending',
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).not.toBe(401);
    await app.close();
  });
});
