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
  sql: Object.assign(
    vi.fn(() => '__sql__'),
    { raw: vi.fn() }
  ),
}));

vi.mock('../domain/HealthScoringService.js', () => ({
  HealthScoringService: {
    scoreCustomer: vi.fn().mockRejectedValue(new Error('health scoring temporarily unavailable')),
  },
}));

// CRM/O2C split — getPredictionsForCustomer/recordFeedback now reach crm-service over fetch;
// resolved here by default (not under test in the pre-existing 'health' degradation case below)
// so it doesn't crash those assertions. Individual tests override this per-case.
process.env['CRM_SERVICE_URL'] = 'http://crm-service.test';
process.env['INTERNAL_API_KEY'] = 'test-internal-key';
const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);
const EMPTY_PREDICTIONS_RESPONSE = {
  ok: true,
  json: async () => ({ data: { churn: null, nextBestAction: null, productRecommendations: [] } }),
};
fetchMock.mockResolvedValue(EMPTY_PREDICTIONS_RESPONSE);
afterAll(() => vi.unstubAllGlobals());

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
  const raw: Record<string, unknown> = {
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
  // withTenantConnection wraps every route in a transaction that sets the GUC via
  // `.execute()` before invoking the callback with this same object as the scoped db.
  raw['execute'] = async () => undefined;
  raw['transaction'] = (cb: (trx: unknown) => unknown) => cb(raw);
  return {
    create: () => ({ db: { raw } }),
    rawDb: raw,
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

  // CRM/O2C split — getPredictionsForCustomer moved to crm-service; this route now reaches it
  // via fetch + x-internal-key (see customer-360.routes.ts's fetchHealthPredictions). These two
  // cases prove the new HTTP hop renders real data on success and degrades gracefully on
  // failure, same as every other Promise.allSettled section in this route.
  it('renders churn/next-best-action/product-recommendation data from crm-service on success', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: {
          churn: { riskLevel: 'HIGH', riskScore: 90, reason: 'overdue' },
          nextBestAction: { id: 1, actionType: 'WIN_BACK_OFFER', actionText: 'Send an offer' },
          productRecommendations: [{ id: 1, itemId: 5, itemName: 'Widget', rank: 1 }],
        },
      }),
    });

    const token = await makeToken();
    const res = await app.inject({
      method: 'GET',
      url: '/customers/42/360',
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as {
      data: {
        churn: { riskLevel: string };
        nextBestAction: { actionType: string };
        degraded: string[];
      };
    };
    expect(body.data.churn.riskLevel).toBe('HIGH');
    expect(body.data.nextBestAction.actionType).toBe('WIN_BACK_OFFER');
    expect(body.data.degraded).not.toContain('predictions');

    const calledArgs = fetchMock.mock.calls.at(-1)!;
    expect(String(calledArgs[0])).toContain('/internal/customers/42/health-predictions');

    fetchMock.mockResolvedValue(EMPTY_PREDICTIONS_RESPONSE);
  });

  it('degrades the predictions section (not the whole request) when crm-service is unreachable', async () => {
    fetchMock.mockRejectedValueOnce(new Error('ECONNREFUSED'));

    const token = await makeToken();
    const res = await app.inject({
      method: 'GET',
      url: '/customers/42/360',
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as {
      data: { churn: unknown; degraded: string[]; timeline: unknown[] };
    };
    expect(body.data.churn).toBeNull();
    expect(body.data.degraded).toContain('predictions');
    expect(body.data.timeline).toHaveLength(1);

    fetchMock.mockResolvedValue(EMPTY_PREDICTIONS_RESPONSE);
  });
});

// CRM/O2C split — recordFeedback moved to crm-service; this route now reaches it via fetch +
// x-internal-key (see customer-360.routes.ts's postRecommendationFeedback).
describe('POST /recommendations/:id/feedback — crm-service HTTP call', () => {
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

  it('200s and forwards the crm-service result when the update succeeds', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ data: { updated: true } }) });

    const token = await makeToken();
    const res = await app.inject({
      method: 'POST',
      url: '/recommendations/7/feedback',
      headers: { Authorization: `Bearer ${token}` },
      payload: { recommendationType: 'NEXT_BEST_ACTION', action: 'DISMISS' },
    });

    expect(res.statusCode).toBe(200);
    const calledArgs = fetchMock.mock.calls.at(-1)!;
    expect(String(calledArgs[0])).toContain('/internal/recommendations/7/feedback');

    fetchMock.mockResolvedValue(EMPTY_PREDICTIONS_RESPONSE);
  });

  it('404s (NotFoundError) when crm-service reports the recommendation was not updated', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ data: { updated: false } }) });

    const token = await makeToken();
    const res = await app.inject({
      method: 'POST',
      url: '/recommendations/999/feedback',
      headers: { Authorization: `Bearer ${token}` },
      payload: { recommendationType: 'NEXT_BEST_ACTION', action: 'DISMISS' },
    });

    expect(res.statusCode).toBe(404);
    fetchMock.mockResolvedValue(EMPTY_PREDICTIONS_RESPONSE);
  });
});
