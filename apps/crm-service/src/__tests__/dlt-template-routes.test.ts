// CRM/O2C split pilot migration — dlt-template.routes.ts had zero test coverage before moving
// from sales-service; this closes that pre-existing gap in its new home rather than carrying
// it forward silently. Outcome-matrix pattern matches the rest of this session's route tests.
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { generateKeyPairSync } from 'node:crypto';
import { SignJWT, importPKCS8, type KeyLike } from 'jose';
import { PERMISSIONS } from '@erp/types';

vi.mock('@erp/db', () => ({
  crmDltTemplates: { __name: 'crmDltTemplates' },
  createDatabaseClient: vi.fn(),
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn(() => '__eq__'),
  and: vi.fn(() => '__and__'),
  sql: vi.fn(() => '__sql__'),
}));

import { dltTemplateRoutes } from '../api/dlt-template.routes.js';

let privateKey: KeyLike;

function makeAutoChainDb(): unknown {
  const proxy: unknown = new Proxy(
    {},
    {
      get(_target, prop) {
        if (prop === 'then') return (resolve: (v: unknown) => void) => resolve([]);
        return () => proxy;
      },
    }
  );
  return proxy;
}

function makeCtxFactory() {
  const ctx = {
    db: { raw: makeAutoChainDb() },
    audit: { log: vi.fn() },
    tenant: { tenantId: 1, userId: 1, correlationId: 'test' },
  };
  const rawDb = {
    transaction: (cb: (trx: unknown) => unknown) => cb(makeAutoChainDb()),
    execute: async () => [],
  };
  return { create: () => ctx, rawDb } as never;
}

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
    .setIssuer('erp-auth-service')
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

afterEach(() => {
  vi.clearAllMocks();
});

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await dltTemplateRoutes(app, makeCtxFactory());
  return app;
}

describe('GET /dlt-templates', () => {
  it('no Authorization header -> 401', async () => {
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/dlt-templates' });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it('missing CRM_DLT_TEMPLATE_MANAGE -> 403', async () => {
    const app = await buildApp();
    const token = await makeToken([]);
    const res = await app.inject({
      method: 'GET',
      url: '/dlt-templates',
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(403);
    await app.close();
  });

  it('with CRM_DLT_TEMPLATE_MANAGE -> 200', async () => {
    const app = await buildApp();
    const token = await makeToken([PERMISSIONS.CRM_DLT_TEMPLATE_MANAGE]);
    const res = await app.inject({
      method: 'GET',
      url: '/dlt-templates',
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    await app.close();
  });
});

describe('POST /dlt-templates', () => {
  it('no Authorization header -> 401', async () => {
    const app = await buildApp();
    const res = await app.inject({ method: 'POST', url: '/dlt-templates', payload: {} });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it('missing CRM_DLT_TEMPLATE_MANAGE -> 403', async () => {
    const app = await buildApp();
    const token = await makeToken([]);
    const res = await app.inject({
      method: 'POST',
      url: '/dlt-templates',
      headers: { Authorization: `Bearer ${token}` },
      payload: { templateId: 'T1', header: 'H', messagePattern: 'Hello {#var#}' },
    });
    expect(res.statusCode).toBe(403);
    await app.close();
  });

  it('with CRM_DLT_TEMPLATE_MANAGE and a valid body -> 201', async () => {
    // The generic auto-chain mock resolves every chain to [] (fine for the list/403/401
    // cases above), but a successful insert().returning() needs a truthy created row —
    // give this one test a dedicated insert-chain mock instead.
    const app = Fastify({ logger: false });
    const insertedRow = { id: 1, templateId: 'T1', header: 'H', messagePattern: 'Hello {#var#}' };
    const dbRaw = {
      insert: vi.fn(() => ({
        values: vi.fn(() => ({
          returning: vi.fn(async () => [insertedRow]),
        })),
      })),
      execute: async () => [],
    };
    const ctxFactory = {
      create: () => ({
        db: { raw: dbRaw },
        audit: { log: vi.fn() },
        tenant: { tenantId: 1, userId: 1, correlationId: 'test' },
      }),
      rawDb: {
        transaction: (cb: (trx: unknown) => unknown) => cb(dbRaw),
        execute: async () => [],
      },
    } as never;
    await dltTemplateRoutes(app, ctxFactory);

    const token = await makeToken([PERMISSIONS.CRM_DLT_TEMPLATE_MANAGE]);
    const res = await app.inject({
      method: 'POST',
      url: '/dlt-templates',
      headers: { Authorization: `Bearer ${token}` },
      payload: { templateId: 'T1', header: 'H', messagePattern: 'Hello {#var#}' },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().data).toEqual(insertedRow);
    await app.close();
  });

  it('with CRM_DLT_TEMPLATE_MANAGE but an invalid body -> 422', async () => {
    const app = await buildApp();
    const token = await makeToken([PERMISSIONS.CRM_DLT_TEMPLATE_MANAGE]);
    const res = await app.inject({
      method: 'POST',
      url: '/dlt-templates',
      headers: { Authorization: `Bearer ${token}` },
      payload: { templateId: '', header: '', messagePattern: '' },
    });
    expect(res.statusCode).toBe(422);
    await app.close();
  });
});
