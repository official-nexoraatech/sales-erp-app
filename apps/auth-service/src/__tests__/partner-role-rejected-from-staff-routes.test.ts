// CRM-ROADMAP Phase 4, Feature 6 (Partner/Channel Portal) — mirrors
// customer-role-rejected-from-staff-routes.test.ts exactly for the PARTNER auth scope. Same
// reasoning: sessions.routes.ts trusts request.auth.userId as a real employee id with no
// further check, and a PARTNER-role JWT's numeric id (a crm_partner_accounts.id, a bigserial
// starting at 1 per tenant, same as users.id) could coincidentally collide with a real
// employee's id. Wired here exactly the way main.ts wires it (scope.addHook('preHandler',
// authenticate), not per-route).
import { describe, it, expect, beforeAll } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { generateKeyPairSync } from 'node:crypto';
import type { ErpDatabase } from '@erp/db';
import { authenticate } from '../middleware/authenticate.js';
import { sessionsRoutes } from '../routes/sessions.routes.js';
import { initializeJwt, signAccessToken } from '../jwt.js';

async function makeToken(roles: string[], customerId?: number): Promise<string> {
  return signAccessToken({
    sub: '7',
    tenantId: 1,
    email: 'x@example.com',
    roles,
    permissions: [],
    branchIds: [],
    ...(customerId !== undefined ? { customerId } : {}),
  });
}

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await app.register(async (scope) => {
    scope.addHook('preHandler', authenticate);
    await sessionsRoutes(scope, {} as ErpDatabase);
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
  await initializeJwt({
    privateKeyPem: privPem,
    publicKeyPem: pubPem,
    issuer: 'erp-test',
    accessTokenTtlSeconds: 900,
  });
  process.env['JWT_PUBLIC_KEY'] = pubPem;
  process.env['JWT_ISSUER'] = 'erp-test';
});

describe('GET /sessions rejects a PARTNER-role token', () => {
  it('401s a PARTNER-role token, even one whose numeric sub could collide with a real users.id', async () => {
    const app = await buildApp();
    const token = await makeToken(['PARTNER'], 42);
    const res = await app.inject({
      method: 'GET',
      url: '/sessions',
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
      url: '/sessions',
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).not.toBe(401);
    await app.close();
  });
});
