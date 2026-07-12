// ES-21 — Tenant-admin route authorization tests (C1, C2)
//
// Regression coverage for the audit's full-platform-compromise chain: before this
// phase, /admin/tenants had zero preHandler at all, and suspend/activate/close only
// required `authenticate` — any authenticated user from any tenant could enumerate
// and suspend/close any other tenant on the platform.

/* global process */
import { describe, it, expect, vi, beforeAll } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { generateKeyPairSync } from 'node:crypto';
import { SignJWT, importPKCS8, type KeyLike } from 'jose';
import type * as ErpTypes from '@erp/types';

vi.mock('@erp/db', () => ({
  tenants: { __name: 'tenants' },
  auditLog: { __name: 'auditLog' },
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((a: unknown, b: unknown) => ({ __eq__: [a, b] })),
  and: vi.fn((...args: unknown[]) => ({ __and__: args })),
}));

// See security.test.ts / es20-admin-routes.test.ts for why this is needed: vitest's
// module resolution for '@erp/types' can pick up a stale compiled permissions.js
// missing constants added by later phases (PLATFORM_TENANT_MANAGE is brand new here).
vi.mock('@erp/types', async (importOriginal) => {
  const actual = await importOriginal<typeof ErpTypes>();
  return {
    ...actual,
    PERMISSIONS: {
      ...actual.PERMISSIONS,
      PLATFORM_TENANT_MANAGE: 'PLATFORM_TENANT_MANAGE',
    },
  };
});

import { tenantRoutes } from '../api/tenant.routes.js';

let privateKey: KeyLike;

beforeAll(async () => {
  const { privateKey: priv, publicKey: pub } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  privateKey = await importPKCS8(priv, 'RS256');
  process.env['JWT_PUBLIC_KEY'] = pub;
});

async function signToken(opts: {
  sub: string;
  tenantId: number;
  permissions: string[];
}): Promise<string> {
  const nowSec = Math.floor(Date.now() / 1000);
  return new SignJWT({
    tenantId: opts.tenantId,
    email: 'test@example.com',
    roles: [],
    permissions: opts.permissions,
  })
    .setProtectedHeader({ alg: 'RS256' })
    .setSubject(opts.sub)
    .setIssuedAt(nowSec)
    .setExpirationTime(nowSec + 900)
    .sign(privateKey);
}

function selectResult(rows: unknown[]): unknown {
  return Object.assign(Promise.resolve(rows), {
    where: (_cond?: unknown) => Promise.resolve(rows),
  });
}

function makeFakeDb(tenant?: Record<string, unknown>): {
  db: Record<string, unknown>;
  state: { tenant?: Record<string, unknown>; auditLogs: Record<string, unknown>[] };
} {
  const state: { tenant?: Record<string, unknown>; auditLogs: Record<string, unknown>[] } = {
    tenant,
    auditLogs: [],
  };
  const db = {
    select: () => ({ from: () => selectResult(state.tenant ? [state.tenant] : []) }),
    update: () => ({
      set: (patch: Record<string, unknown>) => ({
        where: async () => {
          if (state.tenant) Object.assign(state.tenant, patch);
          return [];
        },
      }),
    }),
    insert: () => ({
      values: async (row: Record<string, unknown>) => {
        state.auditLogs.push(row);
        return [];
      },
    }),
  };
  return { db, state };
}

const FAKE_CONFIG = { elasticsearchUrl: 'http://localhost:9200', minioBucket: 'erp-local' };

const FAKE_CTX_FACTORY = { publishTenantStatusInvalidation: vi.fn(async () => {}) };

async function buildApp(db: Record<string, unknown>): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await tenantRoutes(app, db as never, FAKE_CONFIG as never, FAKE_CTX_FACTORY as never);
  return app;
}

describe('ES-21 — tenant-admin route authorization (C1, C2)', () => {
  it('1. GET /admin/tenants with no token → 401', async () => {
    const { db } = makeFakeDb();
    const app = await buildApp(db);

    const res = await app.inject({ method: 'GET', url: '/admin/tenants' });

    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it('2. GET /admin/tenants with a valid token lacking PLATFORM_TENANT_MANAGE → 403', async () => {
    const { db } = makeFakeDb();
    const app = await buildApp(db);
    const token = await signToken({ sub: '1', tenantId: 1, permissions: ['INVOICE_VIEW'] });

    const res = await app.inject({
      method: 'GET',
      url: '/admin/tenants',
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(403);
    await app.close();
  });

  it('3. PATCH /admin/tenants/:id/suspend as an authenticated ordinary tenant user → 403', async () => {
    const { db } = makeFakeDb({ id: 2, status: 'ACTIVE' });
    const app = await buildApp(db);
    const token = await signToken({ sub: '5', tenantId: 1, permissions: ['INVOICE_VIEW'] });

    const res = await app.inject({
      method: 'PATCH',
      url: '/admin/tenants/2/suspend',
      headers: { Authorization: `Bearer ${token}` },
      payload: { reason: 'Attempting unauthorized suspend' },
    });

    expect(res.statusCode).toBe(403);
    await app.close();
  });

  it('4. PATCH /admin/tenants/:id/suspend as a platform-operator role → 200', async () => {
    const { db, state } = makeFakeDb({ id: 2, status: 'ACTIVE' });
    const app = await buildApp(db);
    const token = await signToken({
      sub: '99',
      tenantId: 999,
      permissions: ['PLATFORM_TENANT_MANAGE'],
    });

    const res = await app.inject({
      method: 'PATCH',
      url: '/admin/tenants/2/suspend',
      headers: { Authorization: `Bearer ${token}` },
      payload: { reason: 'Fraudulent activity detected on this tenant' },
    });

    expect(res.statusCode).toBe(200);
    expect(state.tenant?.['status']).toBe('SUSPENDED');
    await app.close();
  });

  // PG-012: suspend/activate/close were never audit-logged — only the tenant row's own
  // suspendedBy/suspendedReason columns tracked who/why, with no append-only audit_log
  // entry. These tests confirm the platform-lifecycle action itself is now traceable.
  it('5. PATCH /admin/tenants/:id/suspend writes an audit_log entry with reason and acting user', async () => {
    const { db, state } = makeFakeDb({ id: 2, status: 'ACTIVE' });
    const app = await buildApp(db);
    const token = await signToken({
      sub: '99',
      tenantId: 999,
      permissions: ['PLATFORM_TENANT_MANAGE'],
    });

    await app.inject({
      method: 'PATCH',
      url: '/admin/tenants/2/suspend',
      headers: { Authorization: `Bearer ${token}` },
      payload: { reason: 'Fraudulent activity detected on this tenant' },
    });

    expect(state.auditLogs).toHaveLength(1);
    const entry = state.auditLogs[0]!;
    expect(entry['action']).toBe('TENANT_SUSPENDED');
    expect(entry['entityType']).toBe('tenant');
    expect(entry['entityId']).toBe(2);
    expect(entry['tenantId']).toBe(2);
    expect(entry['userId']).toBe(99);
    expect(entry['actorEmail']).toBe('test@example.com');
    expect(entry['beforeData']).toEqual({ status: 'ACTIVE' });
    expect(entry['afterData']).toEqual({ status: 'SUSPENDED' });
    expect(entry['metadata']).toEqual({ reason: 'Fraudulent activity detected on this tenant' });
    await app.close();
  });

  it('6. PATCH /admin/tenants/:id/activate writes an audit_log entry', async () => {
    const { db, state } = makeFakeDb({ id: 2, status: 'SUSPENDED' });
    const app = await buildApp(db);
    const token = await signToken({
      sub: '99',
      tenantId: 999,
      permissions: ['PLATFORM_TENANT_MANAGE'],
    });

    const res = await app.inject({
      method: 'PATCH',
      url: '/admin/tenants/2/activate',
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    expect(state.auditLogs).toHaveLength(1);
    const entry = state.auditLogs[0]!;
    expect(entry['action']).toBe('TENANT_ACTIVATED');
    expect(entry['beforeData']).toEqual({ status: 'SUSPENDED' });
    expect(entry['afterData']).toEqual({ status: 'ACTIVE' });
    await app.close();
  });

  it('7. PATCH /admin/tenants/:id/close writes an audit_log entry with reason', async () => {
    const { db, state } = makeFakeDb({ id: 2, status: 'ACTIVE' });
    const app = await buildApp(db);
    const token = await signToken({
      sub: '99',
      tenantId: 999,
      permissions: ['PLATFORM_TENANT_MANAGE'],
    });

    const res = await app.inject({
      method: 'PATCH',
      url: '/admin/tenants/2/close',
      headers: { Authorization: `Bearer ${token}` },
      payload: { reason: 'Tenant churned — non-renewal', confirmation: 'CLOSE_TENANT' },
    });

    expect(res.statusCode).toBe(200);
    expect(state.auditLogs).toHaveLength(1);
    const entry = state.auditLogs[0]!;
    expect(entry['action']).toBe('TENANT_CLOSED');
    expect(entry['beforeData']).toEqual({ status: 'ACTIVE' });
    expect(entry['afterData']).toEqual({ status: 'CLOSED' });
    expect(entry['metadata']).toEqual({ reason: 'Tenant churned — non-renewal' });
    await app.close();
  });
});
