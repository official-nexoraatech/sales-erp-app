// CRM/O2C split — permission-guard test for festival-intelligence.routes.ts (JWT +
// CRM_SEASON_VIEW/CRM_SEASON_MANAGE) and internal.routes.ts's festival-suggestions/compute
// cron endpoint (x-internal-key, no JWT).
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { generateKeyPairSync } from 'node:crypto';
import { SignJWT, importPKCS8, type KeyLike } from 'jose';

vi.mock('@erp/db', () => ({
  businessSeasons: {},
  crmFestivalSuggestions: {},
  tenants: {},
  invoices: {},
  // internal.routes.ts also imports SegmentService/CampaignService/JourneyService/
  // ReferralService/TicketService (CRM/O2C split, migrations 7 and 12) — SegmentService's
  // module-level FIELD_COLUMNS destructures `customers.*` at import time, so `customers` must
  // exist on this mock even though this test never exercises segment logic itself.
  customers: {},
  createDatabaseClient: vi.fn(),
}));

vi.mock('drizzle-orm', () => ({
  and: vi.fn(() => '__and__'),
  eq: vi.fn(() => '__eq__'),
  desc: vi.fn(() => '__desc__'),
  gte: vi.fn(() => '__gte__'),
  lt: vi.fn(() => '__lt__'),
  sql: Object.assign(
    vi.fn(() => '__sql__'),
    { raw: vi.fn() }
  ),
}));

import { festivalIntelligenceRoutes } from '../api/festival-intelligence.routes.js';
import { internalRoutes } from '../api/internal.routes.js';

const TEST_ISSUER = 'erp-test';
let privateKey: KeyLike;

const mockCtxFactory = {
  create: () => ({
    db: { raw: {} as never, transaction: vi.fn() },
    events: { publish: vi.fn() },
    audit: { log: vi.fn() },
  }),
} as never;

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
    .setIssuer(TEST_ISSUER)
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
  process.env['JWT_ISSUER'] = TEST_ISSUER;
  process.env['INTERNAL_API_KEY'] = 'test-internal-key';
});

describe('festival-intelligence.routes.ts — requirePermission guards', () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    app = Fastify({ logger: false });
    await festivalIntelligenceRoutes(app, mockCtxFactory);
  });
  afterAll(() => app.close());

  it('403s GET /crm/festival-suggestions without CRM_SEASON_VIEW', async () => {
    const token = await makeToken([]);
    const res = await app.inject({
      method: 'GET',
      url: '/crm/festival-suggestions',
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(403);
  });

  it('401s GET /crm/festival-suggestions with no token', async () => {
    const res = await app.inject({ method: 'GET', url: '/crm/festival-suggestions' });
    expect(res.statusCode).toBe(401);
  });

  it('403s POST /crm/festival-suggestions/:id/approve without CRM_SEASON_MANAGE', async () => {
    const token = await makeToken([]);
    const res = await app.inject({
      method: 'POST',
      url: '/crm/festival-suggestions/1/approve',
      headers: { Authorization: `Bearer ${token}` },
      payload: { name: 'Test' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('403s POST /crm/festival-suggestions/:id/reject without CRM_SEASON_MANAGE', async () => {
    const token = await makeToken([]);
    const res = await app.inject({
      method: 'POST',
      url: '/crm/festival-suggestions/1/reject',
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(403);
  });
});

describe('internal.routes.ts — festival-suggestions/compute requires x-internal-key', () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    app = Fastify({ logger: false });
    await internalRoutes(app, mockCtxFactory);
  });
  afterAll(() => app.close());

  it('401s POST /crm/festival-suggestions/compute with no x-internal-key', async () => {
    const res = await app.inject({ method: 'POST', url: '/crm/festival-suggestions/compute' });
    expect(res.statusCode).toBe(401);
  });

  it('401s POST /crm/festival-suggestions/compute with a wrong x-internal-key', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/crm/festival-suggestions/compute',
      headers: { 'x-internal-key': 'wrong-key' },
    });
    expect(res.statusCode).toBe(401);
  });
});
