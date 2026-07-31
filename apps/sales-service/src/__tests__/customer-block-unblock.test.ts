// H-3 fix: customers.status='BLOCKED' was schema-valid (blockedReason/At/By columns,
// customers_history changeType) but no route ever set it, and CUSTOMER_BLOCK was a dead
// permission constant (defined, never checked, never granted to any role). This tests the new
// POST /customers/:id/block and /unblock routes: permission gating and core state transitions.

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { generateKeyPairSync } from 'node:crypto';
import { SignJWT, importPKCS8, type KeyLike } from 'jose';
import { PERMISSIONS } from '@erp/types';
import { registerErrorHandler } from '@erp/sdk';
import { createLogger } from '@erp/logger';

vi.mock('@erp/db', () => ({
  customers: { id: 'id', tenantId: 'tenant_id', status: 'status', version: 'version' },
  customersHistory: {},
  customerCommunicationPreferences: {},
}));

vi.mock('drizzle-orm', () => ({
  and: vi.fn(() => '__and__'),
  eq: vi.fn(() => '__eq__'),
  isNull: vi.fn(() => '__isnull__'),
  or: vi.fn(() => '__or__'),
  ilike: vi.fn(() => '__ilike__'),
  sql: vi.fn(() => '__sql__'),
}));

import { customerRoutes } from '../api/customer.routes.js';

function makeCtxFactory(customerRow: Record<string, unknown> | undefined) {
  const raw = {
    select: () => ({
      from: () => ({ where: () => Promise.resolve(customerRow ? [customerRow] : []) }),
    }),
    insert: () => ({ values: () => Promise.resolve(undefined) }),
    update: (() => {
      let lastSet: Record<string, unknown> = {};
      return () => ({
        set: (patch: Record<string, unknown>) => {
          lastSet = patch;
          return {
            where: () => ({
              returning: () => Promise.resolve([{ ...customerRow, ...lastSet }]),
            }),
          };
        },
      });
    })(),
  };
  return {
    create: () => ({
      db: {
        raw,
        transaction: async (fn: (trx: { raw: typeof raw }) => Promise<unknown>) => fn({ raw }),
      },
      cache: { getJson: vi.fn().mockResolvedValue(null), setJson: vi.fn(), del: vi.fn() },
      events: { publish: vi.fn() },
      audit: { log: vi.fn() },
    }),
  } as never;
}

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

async function buildApp(
  customerRow: Record<string, unknown> | undefined
): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  registerErrorHandler(
    app,
    'sales-service-test',
    createLogger({ serviceName: 'sales-service-test' })
  );
  await customerRoutes(app, makeCtxFactory(customerRow));
  return app;
}

describe('POST /customers/:id/block', () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    app = await buildApp({ id: 1, tenantId: 1, status: 'ACTIVE', version: 0 });
  });
  afterAll(() => app.close());

  it('403s a caller without CUSTOMER_BLOCK', async () => {
    const token = await makeToken([]);
    const res = await app.inject({
      method: 'POST',
      url: '/customers/1/block',
      headers: { Authorization: `Bearer ${token}` },
      payload: { reason: 'Repeated payment defaults' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('blocks an ACTIVE customer for a caller with CUSTOMER_BLOCK', async () => {
    const token = await makeToken([PERMISSIONS.CUSTOMER_BLOCK]);
    const res = await app.inject({
      method: 'POST',
      url: '/customers/1/block',
      headers: { Authorization: `Bearer ${token}` },
      payload: { reason: 'Repeated payment defaults' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.status).toBe('BLOCKED');
  });
});

describe('POST /customers/:id/block — already blocked', () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    app = await buildApp({ id: 1, tenantId: 1, status: 'BLOCKED', version: 0 });
  });
  afterAll(() => app.close());

  it('rejects blocking an already-BLOCKED customer', async () => {
    const token = await makeToken([PERMISSIONS.CUSTOMER_BLOCK]);
    const res = await app.inject({
      method: 'POST',
      url: '/customers/1/block',
      headers: { Authorization: `Bearer ${token}` },
      payload: { reason: 'test' },
    });
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
    expect(res.statusCode).toBeLessThan(500);
  });
});

describe('POST /customers/:id/unblock', () => {
  it('unblocks a BLOCKED customer back to ACTIVE', async () => {
    const app = await buildApp({ id: 1, tenantId: 1, status: 'BLOCKED', version: 0 });
    const token = await makeToken([PERMISSIONS.CUSTOMER_BLOCK]);
    const res = await app.inject({
      method: 'POST',
      url: '/customers/1/unblock',
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.status).toBe('ACTIVE');
    await app.close();
  });

  it('rejects unblocking a customer that is not currently BLOCKED', async () => {
    const app = await buildApp({ id: 1, tenantId: 1, status: 'ACTIVE', version: 0 });
    const token = await makeToken([PERMISSIONS.CUSTOMER_BLOCK]);
    const res = await app.inject({
      method: 'POST',
      url: '/customers/1/unblock',
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
    expect(res.statusCode).toBeLessThan(500);
    await app.close();
  });
});
