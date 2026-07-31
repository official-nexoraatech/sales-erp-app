// CRM-ROADMAP Phase 3, Feature 2 (Self-Service Customer Portal), Finding 1 — the self-service
// notification inbox (GET /notifications and friends) is a KNOWN_EXCEPTIONS entry in
// route-guard-coverage.test.ts ("every route is scoped to the caller's own userId"). A
// CUSTOMER-role portal JWT's numeric id could coincidentally collide with a real employee's
// users.id and reach that employee's own in-app notification inbox — must still be rejected.
import { describe, it, expect, beforeAll } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { generateKeyPairSync } from 'node:crypto';
import { SignJWT, importPKCS8, type KeyLike } from 'jose';
import type { ErpDatabase } from '@erp/db';
import type { Redis } from 'ioredis';
import type { DeliveryEnqueuer } from '../domain/DeliveryQueue.js';
import { notificationRoutes } from '../api/notification.routes.js';

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

const fakeDeliveryQueue: DeliveryEnqueuer = { enqueue: async () => undefined };

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await notificationRoutes(app, {} as ErpDatabase, fakeDeliveryQueue, {} as Redis);
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

describe('GET /notifications rejects a CUSTOMER-role token (Finding 1)', () => {
  it('401s a CUSTOMER-role portal token', async () => {
    const app = await buildApp();
    const token = await makeToken(['CUSTOMER'], 42);
    const res = await app.inject({
      method: 'GET',
      url: '/notifications',
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
      url: '/notifications',
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).not.toBe(401);
    await app.close();
  });
});
