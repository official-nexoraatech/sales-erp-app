// CP-7/CP-8 (Campaign Management Platform initiative) — permission-guard tests for the routes
// that stayed in sales-service's crm.routes.ts after the CRM/O2C split (migration 7) moved the
// campaign-specific describe blocks to crm-service (see that file's own header comment).
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { generateKeyPairSync } from 'node:crypto';
import { SignJWT, importPKCS8, type KeyLike } from 'jose';
import { PERMISSIONS } from '@erp/types';

vi.mock('@erp/db', () => ({
  customers: {},
  customerInteractions: {},
  businessSeasons: {},
  tenantSenderIdentity: {},
  webhookSubscriptions: {},
  tenantCommunicationSettings: {},
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
import { integrationsRoutes } from '../api/integrations.routes.js';

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
  process.env['JWT_ISSUER'] = TEST_ISSUER;
});

describe('PUT /crm/sender-identity — requirePermission(CRM_SENDER_IDENTITY_MANAGE)', () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    app = Fastify({ logger: false });
    await crmRoutes(app, mockCtxFactory);
  });
  afterAll(() => app.close());

  it('403s a caller with only CRM_CAMPAIGN_CREATE', async () => {
    const token = await makeToken([PERMISSIONS.CRM_CAMPAIGN_CREATE]);
    const res = await app.inject({
      method: 'PUT',
      url: '/crm/sender-identity',
      headers: { Authorization: `Bearer ${token}` },
      payload: {
        channel: 'EMAIL',
        senderName: 'Style Hub',
        senderAddressOrNumber: 'promo@stylehub.example',
      },
    });
    expect(res.statusCode).toBe(403);
  });

  it('does not 403 a caller with CRM_SENDER_IDENTITY_MANAGE', async () => {
    const token = await makeToken([PERMISSIONS.CRM_SENDER_IDENTITY_MANAGE]);
    const res = await app.inject({
      method: 'PUT',
      url: '/crm/sender-identity',
      headers: { Authorization: `Bearer ${token}` },
      payload: {
        channel: 'EMAIL',
        senderName: 'Style Hub',
        senderAddressOrNumber: 'promo@stylehub.example',
      },
    });
    expect(res.statusCode).not.toBe(403);
  });
});

describe('POST /integrations/webhook-subscriptions — requirePermission(INTEGRATION_WEBHOOK_MANAGE)', () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    app = Fastify({ logger: false });
    await integrationsRoutes(app, mockCtxFactory);
  });
  afterAll(() => app.close());

  it('403s a caller with only CRM_CAMPAIGN_APPROVE', async () => {
    const token = await makeToken([PERMISSIONS.CRM_CAMPAIGN_APPROVE]);
    const res = await app.inject({
      method: 'POST',
      url: '/integrations/webhook-subscriptions',
      headers: { Authorization: `Bearer ${token}` },
      payload: { targetUrl: 'https://example.com/webhook', events: ['CAMPAIGN_SENT'] },
    });
    expect(res.statusCode).toBe(403);
  });

  it('does not 403 a caller with INTEGRATION_WEBHOOK_MANAGE', async () => {
    const token = await makeToken([PERMISSIONS.INTEGRATION_WEBHOOK_MANAGE]);
    const res = await app.inject({
      method: 'POST',
      url: '/integrations/webhook-subscriptions',
      headers: { Authorization: `Bearer ${token}` },
      payload: { targetUrl: 'https://example.com/webhook', events: ['CAMPAIGN_SENT'] },
    });
    expect(res.statusCode).not.toBe(403);
  });
});

// Follow-up (settings UI closing the CP-7/CP-8 gap): PUT /crm/communication-settings.
describe('PUT /crm/communication-settings — requirePermission(CRM_AUTOMATION_MANAGE)', () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    app = Fastify({ logger: false });
    await crmRoutes(app, mockCtxFactory);
  });
  afterAll(() => app.close());

  it('403s a caller with only CRM_CAMPAIGN_CREATE', async () => {
    const token = await makeToken([PERMISSIONS.CRM_CAMPAIGN_CREATE]);
    const res = await app.inject({
      method: 'PUT',
      url: '/crm/communication-settings',
      headers: { Authorization: `Bearer ${token}` },
      payload: { approvalRequired: true },
    });
    expect(res.statusCode).toBe(403);
  });

  it('does not 403 a caller with CRM_AUTOMATION_MANAGE', async () => {
    const token = await makeToken([PERMISSIONS.CRM_AUTOMATION_MANAGE]);
    const res = await app.inject({
      method: 'PUT',
      url: '/crm/communication-settings',
      headers: { Authorization: `Bearer ${token}` },
      payload: { approvalRequired: true },
    });
    expect(res.statusCode).not.toBe(403);
  });
});
