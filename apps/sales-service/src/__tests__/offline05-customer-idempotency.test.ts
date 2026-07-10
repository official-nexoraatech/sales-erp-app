/**
 * OFFLINE-05 — POST /customers returns the already-committed original record on a retried
 * offline-customer-creation sync instead of creating a duplicate, mirroring OFFLINE-02's
 * POST /pos/sales dedupe behavior (see offline02-pos-sale-idempotency.test.ts, which this
 * test's harness is adapted from).
 */

import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { generateKeyPairSync } from 'node:crypto';
import { SignJWT, importPKCS8, type KeyLike } from 'jose';
import { PERMISSIONS } from '@erp/types';

vi.mock('@erp/db', () => ({
  customers: {
    id: 'id', tenantId: 'tenant_id', branchId: 'branch_id', phone: 'phone',
    deletedAt: 'deleted_at', clientOperationId: 'client_operation_id',
    displayName: 'display_name', customerCode: 'customer_code',
  },
  customersHistory: {},
}));

vi.mock('drizzle-orm', () => ({
  and: vi.fn((...args) => ({ type: 'and', args })),
  eq: vi.fn((col, val) => ({ type: 'eq', col, val })),
  isNull: vi.fn((col) => ({ type: 'isNull', col })),
  or: vi.fn((...args) => ({ type: 'or', args })),
  ilike: vi.fn(() => '__ilike__'),
  sql: vi.fn((s) => s),
}));

import { customerRoutes } from '../api/customer.routes.js';

const TEST_ISSUER = 'erp-test';
const TEST_TTL = 900;
let privateKey: KeyLike;

async function makeToken(permissions: string[]): Promise<string> {
  const nowSec = Math.floor(Date.now() / 1000);
  return new SignJWT({ tenantId: 1, email: 'cashier@erp.local', roles: [], permissions, branchIds: [2] })
    .setProtectedHeader({ alg: 'RS256' })
    .setSubject('1')
    .setIssuer(TEST_ISSUER)
    .setIssuedAt(nowSec)
    .setExpirationTime(nowSec + TEST_TTL)
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

const CUSTOMER_BODY = {
  displayName: 'Walk-in Customer',
  phone: '9876543210',
  branchId: 2,
  operationId: '22222222-2222-4222-8222-222222222222',
};

// A unique-violation error shaped like what the `postgres` driver throws (matches
// isUniqueViolation's expectations in customer.routes.ts).
function uniqueViolation(constraintName: string) {
  return Object.assign(new Error('duplicate key value violates unique constraint'), {
    code: '23505',
    constraint_name: constraintName,
  });
}

// Sequential-response chainable query builder — resolves each call to the next queued
// value in call order, except a `{ __reject: err }` entry which rejects instead (needed to
// simulate insert()...returning() throwing a unique-constraint violation).
function makeChainableDb(script: unknown[]) {
  let i = 0;
  const next = () => {
    const entry = script[i++];
    if (entry && typeof entry === 'object' && '__reject' in (entry as Record<string, unknown>)) {
      return Promise.reject((entry as { __reject: unknown }).__reject);
    }
    return Promise.resolve(entry);
  };
  const chainable: Record<string, unknown> = {};
  for (const m of ['select', 'from', 'where', 'insert', 'values', 'returning']) {
    chainable[m] = vi.fn(() => chainable);
  }
  (chainable as { then: unknown })['then'] = (resolve: (v: unknown) => void, reject: (e: unknown) => void) =>
    next().then(resolve, reject);
  return chainable;
}

function makeCtxFactory(script: unknown[]) {
  return {
    create: () => ({
      db: { raw: makeChainableDb(script) },
      events: { publish: vi.fn() },
      audit: { log: vi.fn() },
    }),
  } as never;
}

describe('POST /customers — OFFLINE-05 idempotent retry handling', () => {
  let app: FastifyInstance;

  afterEach(() => app?.close());

  it('creates a new customer and returns 201 when no operationId conflict exists', async () => {
    const script = [
      [], // duplicate-phone check — no existing match
      [{ id: 501, tenantId: 1, displayName: 'Walk-in Customer', phone: '9876543210', clientOperationId: CUSTOMER_BODY.operationId }], // insert ... returning
    ];

    app = Fastify({ logger: false });
    await customerRoutes(app, makeCtxFactory(script));
    const token = await makeToken([PERMISSIONS.CUSTOMER_CREATE]);

    const res = await app.inject({
      method: 'POST',
      url: '/customers',
      headers: { Authorization: `Bearer ${token}` },
      payload: CUSTOMER_BODY,
    });

    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body) as { data: { id: number } };
    expect(body.data.id).toBe(501);
  });

  it('returns the already-committed original customer (200) on a retried operationId instead of erroring', async () => {
    const script = [
      [], // duplicate-phone check
      { __reject: uniqueViolation('customers_tenant_client_operation_id') }, // insert ... returning
      [{ id: 501, tenantId: 1, displayName: 'Walk-in Customer', phone: '9876543210', clientOperationId: CUSTOMER_BODY.operationId }], // select existing by operationId
    ];

    app = Fastify({ logger: false });
    await customerRoutes(app, makeCtxFactory(script));
    const token = await makeToken([PERMISSIONS.CUSTOMER_CREATE]);

    const res = await app.inject({
      method: 'POST',
      url: '/customers',
      headers: { Authorization: `Bearer ${token}` },
      payload: CUSTOMER_BODY,
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { data: { id: number } };
    expect(body.data.id).toBe(501);
  });

  it('does not swallow a unique-violation on an unrelated constraint', async () => {
    const script = [
      [],
      { __reject: uniqueViolation('customers_tenant_code') },
    ];

    app = Fastify({ logger: false });
    await customerRoutes(app, makeCtxFactory(script));
    const token = await makeToken([PERMISSIONS.CUSTOMER_CREATE]);

    const res = await app.inject({
      method: 'POST',
      url: '/customers',
      headers: { Authorization: `Bearer ${token}` },
      payload: CUSTOMER_BODY,
    });

    expect(res.statusCode).toBe(500);
  });
});
