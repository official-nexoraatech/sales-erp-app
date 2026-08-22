// PG-027 Session 3 — billing.routes.ts authorization + behavior tests.
// Mirrors tenant-admin-authz.test.ts's exact pattern (mocked @erp/db + drizzle-orm, real RS256
// JWT signing via jose) — see [[erp_db_vitest_barrel_export_bug]] for why these are mocked
// rather than trusting real module resolution under vitest.

/* global process */
import { describe, it, expect, beforeAll } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { generateKeyPairSync } from 'node:crypto';
import { SignJWT, importPKCS8, type KeyLike } from 'jose';
import type * as ErpTypes from '@erp/types';
import { vi } from 'vitest';

vi.mock('@erp/db', () => ({
  tenants: { __name: 'tenants', id: 'id' },
  tenantInvoices: {
    __name: 'tenant_invoices',
    id: 'id',
    tenantId: 'tenant_id',
    createdAt: 'created_at',
  },
  users: { __name: 'users', tenantId: 'tenant_id', isActive: 'is_active' },
  branches: { __name: 'branches', tenantId: 'tenant_id', isActive: 'is_active' },
  planEntitlements: { __name: 'plan_entitlements', plan: 'plan' },
  featureFlags: { __name: 'feature_flags', tenantId: 'tenantId', flagKey: 'flagKey' },
  auditLog: { __name: 'audit_log' },
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((a: unknown, b: unknown) => ({ __eq__: [a, b] })),
  and: vi.fn((...args: unknown[]) => ({ __and__: args })),
  count: vi.fn(() => ({ __count__: true })),
  // withTenantConnection (called by these routes via @erp/sdk) uses drizzle-orm's own sql
  // tagged template internally — a per-file vi.mock('drizzle-orm', ...) replaces the module
  // for every importer, so it must be included here too or the SET LOCAL call throws.
  sql: Object.assign(
    vi.fn(() => '__sql__'),
    { raw: vi.fn() }
  ),
}));

vi.mock('@erp/types', async (importOriginal) => {
  const actual = await importOriginal<typeof ErpTypes>();
  return {
    ...actual,
    PERMISSIONS: { ...actual.PERMISSIONS, PLATFORM_TENANT_MANAGE: 'PLATFORM_TENANT_MANAGE' },
  };
});

import { billingRoutes } from '../api/billing.routes.js';

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
    .setIssuer('erp-auth-service')
    .setExpirationTime(nowSec + 900)
    .sign(privateKey);
}

interface FakeState {
  tenant?: Record<string, unknown>;
  invoice?: Record<string, unknown>;
  planTemplate?: Record<string, unknown>;
}

function makeFakeDb(state: FakeState): Record<string, unknown> {
  return {
    select: () => ({
      from: (table: { __name: string }) => {
        const chain = {
          where: (): typeof chain & Promise<unknown[]> => {
            const result: unknown[] =
              table.__name === 'tenants'
                ? state.tenant
                  ? [state.tenant]
                  : []
                : table.__name === 'tenant_invoices'
                  ? state.invoice
                    ? [state.invoice]
                    : []
                  : table.__name === 'plan_entitlements'
                    ? state.planTemplate
                      ? [state.planTemplate]
                      : []
                    : table.__name === 'users' || table.__name === 'branches'
                      ? [{ value: 3 }]
                      : [];
            return Object.assign(Promise.resolve(result), {
              orderBy: () => ({
                limit: () => ({ offset: () => Promise.resolve(result) }),
              }),
            }) as never;
          },
        };
        return chain;
      },
    }),
    update: () => ({
      set: (patch: Record<string, unknown>) => ({
        where: async () => {
          if (state.tenant) Object.assign(state.tenant, patch);
          if (state.invoice) Object.assign(state.invoice, patch);
          return [];
        },
      }),
    }),
    insert: () => ({
      values: () => ({
        onConflictDoUpdate: async () => [],
      }),
    }),
    execute: () => Promise.resolve(),
    // withTenantConnection (used by the migrated routes in billing.routes.ts) calls
    // db.transaction(cb) expecting cb's param to expose .execute() directly.
    transaction(cb: (trx: Record<string, unknown>) => unknown) {
      return cb(this as unknown as Record<string, unknown>);
    },
  };
}

async function buildApp(db: Record<string, unknown>): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await billingRoutes(app, db as never);
  return app;
}

const platformToken = () =>
  signToken({ sub: '99', tenantId: 999, permissions: ['PLATFORM_TENANT_MANAGE'] });
const ordinaryToken = () => signToken({ sub: '5', tenantId: 1, permissions: ['INVOICE_VIEW'] });

describe('PG-027 Session 3 — billing.routes.ts authorization', () => {
  it('GET /admin/tenants/:id/billing — 401 with no token', async () => {
    const app = await buildApp(makeFakeDb({ tenant: { id: 2, plan: 'GROWTH', settings: {} } }));
    const res = await app.inject({ method: 'GET', url: '/admin/tenants/2/billing' });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it('GET /admin/tenants/:id/billing — 403 without PLATFORM_TENANT_MANAGE', async () => {
    const app = await buildApp(makeFakeDb({ tenant: { id: 2, plan: 'GROWTH', settings: {} } }));
    const res = await app.inject({
      method: 'GET',
      url: '/admin/tenants/2/billing',
      headers: { Authorization: `Bearer ${await ordinaryToken()}` },
    });
    expect(res.statusCode).toBe(403);
    await app.close();
  });

  it('GET /admin/tenants/:id/billing — 200 with correct shape for a real caller', async () => {
    const app = await buildApp(
      makeFakeDb({
        tenant: {
          id: 2,
          plan: 'GROWTH',
          settings: { maxUsers: 25, maxBranches: 5 },
          nextBillingDate: '2026-09-01',
          dunningStartedAt: null,
        },
      })
    );
    const res = await app.inject({
      method: 'GET',
      url: '/admin/tenants/2/billing',
      headers: { Authorization: `Bearer ${await platformToken()}` },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as {
      data: { plan: string; entitlements: Record<string, unknown> };
    };
    expect(body.data.plan).toBe('GROWTH');
    expect(body.data.entitlements).toEqual({
      maxUsers: 25,
      currentUsers: 3,
      maxBranches: 5,
      currentBranches: 3,
    });
    await app.close();
  });

  it('GET /admin/tenants/:id/billing — 404 for an unknown tenant', async () => {
    const app = await buildApp(makeFakeDb({}));
    const res = await app.inject({
      method: 'GET',
      url: '/admin/tenants/999999/billing',
      headers: { Authorization: `Bearer ${await platformToken()}` },
    });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it('PATCH /admin/tenants/:id/plan — 403 without PLATFORM_TENANT_MANAGE', async () => {
    const app = await buildApp(makeFakeDb({ tenant: { id: 2, plan: 'STARTER', settings: {} } }));
    const res = await app.inject({
      method: 'PATCH',
      url: '/admin/tenants/2/plan',
      headers: { Authorization: `Bearer ${await ordinaryToken()}` },
      payload: { plan: 'GROWTH' },
    });
    expect(res.statusCode).toBe(403);
    await app.close();
  });

  it('PATCH /admin/tenants/:id/plan — 200 and updates the tenant plan for a real caller', async () => {
    const app = await buildApp(
      makeFakeDb({
        tenant: { id: 2, plan: 'STARTER', settings: {} },
        planTemplate: {
          plan: 'GROWTH',
          maxUsers: 25,
          maxBranches: 5,
          featureFlags: [],
          billingPeriod: 'MONTHLY',
        },
      })
    );
    const res = await app.inject({
      method: 'PATCH',
      url: '/admin/tenants/2/plan',
      headers: { Authorization: `Bearer ${await platformToken()}` },
      payload: { plan: 'GROWTH' },
    });
    expect(res.statusCode).toBe(200);
    await app.close();
  });

  it('GET /admin/tenants/:id/invoices — 403 without PLATFORM_TENANT_MANAGE', async () => {
    const app = await buildApp(makeFakeDb({ tenant: { id: 2, plan: 'GROWTH', settings: {} } }));
    const res = await app.inject({
      method: 'GET',
      url: '/admin/tenants/2/invoices',
      headers: { Authorization: `Bearer ${await ordinaryToken()}` },
    });
    expect(res.statusCode).toBe(403);
    await app.close();
  });

  it('POST retry-payment — 404 for an unknown invoice', async () => {
    const app = await buildApp(makeFakeDb({ tenant: { id: 2, plan: 'GROWTH', settings: {} } }));
    const res = await app.inject({
      method: 'POST',
      url: '/admin/tenants/2/invoices/999999/retry-payment',
      headers: { Authorization: `Bearer ${await platformToken()}` },
    });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it('POST retry-payment — rejects (BusinessError, 422) when the invoice is already PAID', async () => {
    // BusinessError always maps to 422 in this codebase (packages/shared-types/src/errors.ts),
    // not a per-call status override — matches every other BusinessError-throwing route
    // (CREDIT_LIMIT_EXCEEDED, INSUFFICIENT_STOCK, etc.), so 422 here, not a bespoke 409.
    const app = await buildApp(
      makeFakeDb({
        tenant: { id: 2, plan: 'GROWTH', settings: {} },
        invoice: { id: 5, tenantId: 2, status: 'PAID' },
      })
    );
    const res = await app.inject({
      method: 'POST',
      url: '/admin/tenants/2/invoices/5/retry-payment',
      headers: { Authorization: `Bearer ${await platformToken()}` },
    });
    // Error-envelope shaping (registerErrorHandler) is wired in main.ts's bootstrap, not per
    // route file — this bare-Fastify-app test (matching tenant-admin-authz.test.ts's own
    // convention) only asserts the status code, not the response body shape.
    expect(res.statusCode).toBe(422);
    await app.close();
  });
});
