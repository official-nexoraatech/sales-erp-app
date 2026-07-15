// CP-7 (Campaign Management Platform initiative) — permission-guard tests for the three new
// granular CRM permissions added this phase: CRM_CAMPAIGN_APPROVE, CRM_CAMPAIGN_ANALYTICS_VIEW,
// CRM_AUTOMATION_MANAGE. Per this codebase's documented recurring bug
// (rbac_dead_permission_constant_pattern), a permission constant can be granted in
// role-defaults.ts but checked under a different constant at the route — these tests verify the
// route-level guard for each new constant actually gates on that exact constant, with both a
// positive (holds the permission) and negative (does not) case, matching the pattern in
// quotation-sale-return-permission-guards.test.ts / payment-view-permission-guard.test.ts.
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { generateKeyPairSync } from 'node:crypto';
import { SignJWT, importPKCS8, type KeyLike } from 'jose';
import { PERMISSIONS } from '@erp/types';

vi.mock('@erp/db', () => ({
  customers: {},
  customerInteractions: {},
  customerSegments: {},
  campaigns: {},
  campaignTemplates: {},
  campaignAutomationRules: {},
  campaignComments: {},
  businessSeasons: {},
  notificationLog: {},
}));

vi.mock('drizzle-orm', () => ({
  and: vi.fn(() => '__and__'),
  eq: vi.fn(() => '__eq__'),
  gte: vi.fn(() => '__gte__'),
  isNull: vi.fn(() => '__isNull__'),
  lte: vi.fn(() => '__lte__'),
  sql: vi.fn(() => '__sql__'),
}));

import { crmRoutes } from '../api/crm.routes.js';

const TEST_ISSUER = 'erp-test';
const TEST_TTL = 900;
let privateKey: KeyLike;

const mockCtxFactory = {
  create: () => ({
    db: { raw: {} as never, transaction: vi.fn() },
    cache: { getJson: vi.fn().mockResolvedValue(null), setJson: vi.fn() },
    events: { publish: vi.fn() },
    audit: { log: vi.fn() },
    tenant: { tenantId: 1, userId: 1 },
  }),
} as never;

async function makeToken(permissions: string[]): Promise<string> {
  const nowSec = Math.floor(Date.now() / 1000);
  return new SignJWT({ tenantId: 1, email: 'test@erp.local', roles: [], permissions })
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

describe('POST /crm/campaigns/:id/approve — requirePermission(CRM_CAMPAIGN_APPROVE)', () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    app = Fastify({ logger: false });
    await crmRoutes(app, mockCtxFactory);
  });
  afterAll(() => app.close());

  it('403s a caller without CRM_CAMPAIGN_APPROVE', async () => {
    const token = await makeToken([PERMISSIONS.CRM_CAMPAIGN_CREATE]);
    const res = await app.inject({
      method: 'POST',
      url: '/crm/campaigns/1/approve',
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(403);
  });

  it('does not 403 a caller with CRM_CAMPAIGN_APPROVE', async () => {
    const token = await makeToken([PERMISSIONS.CRM_CAMPAIGN_APPROVE]);
    const res = await app.inject({
      method: 'POST',
      url: '/crm/campaigns/1/approve',
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).not.toBe(403);
  });
});

describe('POST /crm/campaigns/:id/reject — requirePermission(CRM_CAMPAIGN_APPROVE)', () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    app = Fastify({ logger: false });
    await crmRoutes(app, mockCtxFactory);
  });
  afterAll(() => app.close());

  it('403s a caller without CRM_CAMPAIGN_APPROVE, even one who can create campaigns', async () => {
    const token = await makeToken([PERMISSIONS.CRM_CAMPAIGN_CREATE]);
    const res = await app.inject({
      method: 'POST',
      url: '/crm/campaigns/1/reject',
      headers: { Authorization: `Bearer ${token}` },
      payload: { reason: 'x' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('does not 403 a caller with CRM_CAMPAIGN_APPROVE', async () => {
    const token = await makeToken([PERMISSIONS.CRM_CAMPAIGN_APPROVE]);
    const res = await app.inject({
      method: 'POST',
      url: '/crm/campaigns/1/reject',
      headers: { Authorization: `Bearer ${token}` },
      payload: { reason: 'x' },
    });
    expect(res.statusCode).not.toBe(403);
  });
});

describe('GET /crm/campaigns/:id/stats — requirePermission(CRM_CAMPAIGN_ANALYTICS_VIEW)', () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    app = Fastify({ logger: false });
    await crmRoutes(app, mockCtxFactory);
  });
  afterAll(() => app.close());

  it('403s a caller with only the broader CRM_VIEW — analytics is a separate grant', async () => {
    const token = await makeToken([PERMISSIONS.CRM_VIEW]);
    const res = await app.inject({
      method: 'GET',
      url: '/crm/campaigns/1/stats',
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(403);
  });

  it('does not 403 a caller with CRM_CAMPAIGN_ANALYTICS_VIEW', async () => {
    const token = await makeToken([PERMISSIONS.CRM_CAMPAIGN_ANALYTICS_VIEW]);
    const res = await app.inject({
      method: 'GET',
      url: '/crm/campaigns/1/stats',
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).not.toBe(403);
  });
});

describe('POST /crm/automation-rules — requirePermission(CRM_AUTOMATION_MANAGE)', () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    app = Fastify({ logger: false });
    await crmRoutes(app, mockCtxFactory);
  });
  afterAll(() => app.close());

  it('403s a caller with only CRM_CAMPAIGN_CREATE — automation is a separate grant now', async () => {
    const token = await makeToken([PERMISSIONS.CRM_CAMPAIGN_CREATE]);
    const res = await app.inject({
      method: 'POST',
      url: '/crm/automation-rules',
      headers: { Authorization: `Bearer ${token}` },
      payload: { triggerType: 'BIRTHDAY', channel: 'SMS', messageTemplate: 'Hi' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('does not 403 a caller with CRM_AUTOMATION_MANAGE', async () => {
    const token = await makeToken([PERMISSIONS.CRM_AUTOMATION_MANAGE]);
    const res = await app.inject({
      method: 'POST',
      url: '/crm/automation-rules',
      headers: { Authorization: `Bearer ${token}` },
      payload: { triggerType: 'BIRTHDAY', channel: 'SMS', messageTemplate: 'Hi' },
    });
    expect(res.statusCode).not.toBe(403);
  });
});
