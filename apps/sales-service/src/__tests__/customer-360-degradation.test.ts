// CRM-ROADMAP Phase 1, Feature 3 (Customer 360 Command Center) — the one piece of genuinely
// new logic in this "thin composition layer" feature is the Promise.allSettled degradation:
// if one sub-service call fails/is slow, the page must still render with the other sections
// populated (partial render), not 500 the whole request. Mocks HealthScoringService to reject
// and ActivityTimelineService to resolve, and asserts both outcomes land correctly in one
// response rather than exercising real DB query chains for every sub-service.
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { generateKeyPairSync } from 'node:crypto';
import { SignJWT, importPKCS8, type KeyLike } from 'jose';
import { PERMISSIONS } from '@erp/types';
import { registerErrorHandler } from '@erp/sdk';
import { createLogger } from '@erp/logger';

vi.mock('@erp/db', () => ({
  customers: { id: 'id', tenantId: 'tenant_id', deletedAt: 'deleted_at', accountId: 'account_id' },
  crmAccounts: { id: 'id', tenantId: 'tenant_id' },
  projectionCustomerBalance: { customerId: 'customer_id', tenantId: 'tenant_id' },
}));

vi.mock('drizzle-orm', () => ({
  and: vi.fn(() => '__and__'),
  eq: vi.fn(() => '__eq__'),
  isNull: vi.fn(() => '__isnull__'),
}));

vi.mock('../domain/HealthScoringService.js', () => ({
  HealthScoringService: {
    scoreCustomer: vi.fn().mockRejectedValue(new Error('health scoring temporarily unavailable')),
    // CRM-ROADMAP Phase 3, Feature 1 — the route's Promise.allSettled batch also reads cached
    // predictions; resolved here (not under test in this file) so it doesn't crash the degraded-
    // rendering assertions this file actually cares about.
    getPredictionsForCustomer: vi
      .fn()
      .mockResolvedValue({ churn: null, nextBestAction: null, productRecommendations: [] }),
  },
}));

vi.mock('../domain/ActivityTimelineService.js', () => ({
  ActivityTimelineService: {
    build: vi
      .fn()
      .mockResolvedValue({ items: [{ type: 'INVOICE', date: '2026-01-01', id: 1 }], total: 1 }),
  },
}));

import { customer360Routes } from '../api/customer-360.routes.js';

const CUSTOMER_ROW = {
  id: 42,
  tenantId: 1,
  accountId: null,
  creditLimit: '10000',
  creditLimitEnabled: true,
  loyaltyPoints: 50,
  loyaltyCardNumber: null,
  deletedAt: null,
};
const BALANCE_ROW = {
  currentBalance: '3000',
  totalInvoiced: '8000',
  totalPaid: '5000',
  overdueAmount: '0',
  lastInvoiceAt: null,
  lastPaymentAt: null,
};

function makeCtxFactory() {
  const raw = {
    select: () => ({
      from: (table: unknown) => ({
        where: () => {
          if (table && (table as { customerId?: string }).customerId === 'customer_id') {
            return Promise.resolve([BALANCE_ROW]);
          }
          return Promise.resolve([CUSTOMER_ROW]);
        },
      }),
    }),
  };
  return {
    create: () => ({ db: { raw } }),
  } as never;
}

let privateKey: KeyLike;

async function makeToken(): Promise<string> {
  const nowSec = Math.floor(Date.now() / 1000);
  return (
    new SignJWT({
      tenantId: 1,
      email: 'test@erp.local',
      roles: [],
      permissions: [PERMISSIONS.CRM_360_VIEW],
    })
      .setProtectedHeader({ alg: 'RS256' })
      .setSubject('1')
      // Must match verifyAccessToken's issuer check (packages/platform-sdk/src/auth.ts,
      // JWT_ISSUER env var defaulting to 'erp-auth-service') — this codebase's other
      // JWT-based route tests currently sign with 'erp-test' instead, which as of this session
      // fails that check universally (see CRM-P1-F3_COMPLETION.md's verification notes: a
      // concurrent, uncommitted change to auth.ts added this issuer check without updating the
      // test-helper convention across the suite yet).
      .setIssuer(process.env['JWT_ISSUER'] ?? 'erp-auth-service')
      .setIssuedAt(nowSec)
      .setExpirationTime(nowSec + 900)
      .sign(privateKey)
  );
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

describe('GET /customers/:id/360 — graceful degradation', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = Fastify({ logger: false });
    registerErrorHandler(
      app,
      'sales-service-test',
      createLogger({ serviceName: 'sales-service-test' })
    );
    await customer360Routes(app, makeCtxFactory());
  });
  afterAll(() => app.close());

  it('renders a partial response (200), not a 500, when the health sub-service fails', async () => {
    const token = await makeToken();
    const res = await app.inject({
      method: 'GET',
      url: '/customers/42/360',
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as {
      data: {
        health: unknown;
        timeline: unknown[];
        degraded: string[];
        financial: { currentBalance: number };
      };
    };

    // The failed section is null and flagged...
    expect(body.data.health).toBeNull();
    expect(body.data.degraded).toContain('health');
    // ...while the sections that succeeded still render fully.
    expect(body.data.timeline).toHaveLength(1);
    expect(body.data.financial.currentBalance).toBe(3000);
  });
});
