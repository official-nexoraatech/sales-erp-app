// CRM-ROADMAP Phase 1, Feature 8 — GET /crm/dashboard permission gating: the base
// CRM_DASHBOARD_VIEW gate on the whole route, and per-section hiding (a caller missing
// LEAD_VIEW/TICKET_VIEW/CRM_CAMPAIGN_ANALYTICS_VIEW gets that section omitted with a 200, never
// a 403 for the whole dashboard — the phase doc's explicit "hidden, not erroring" requirement).
import { describe, it, expect, vi, beforeAll } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { generateKeyPairSync } from 'node:crypto';
import { SignJWT, importPKCS8, type KeyLike } from 'jose';
import { PERMISSIONS } from '@erp/types';

vi.mock('@erp/db', () => ({
  crmLeads: {},
  crmTickets: {},
  campaigns: {},
  // CRM-ROADMAP Phase 4, Feature 5: CrmDashboardService.getQuotaAttainment delegates to
  // QuotaService, which imports these four tables — needed for that module's own top-level
  // imports to resolve, even though the mocked ctx.db.raw below never actually introspects them.
  crmSalesQuotas: {},
  crmTerritories: {},
  crmTerritoryBranches: {},
  crmOpportunities: {},
  users: {},
}));

// A single query-result stub that satisfies both call shapes used by CrmDashboardService:
// `await ...where(...)` (tickets/campaigns) and `await ...where(...).groupBy(...)` (leads).
function emptyQueryResult() {
  return Object.assign(Promise.resolve([]), { groupBy: () => Promise.resolve([]) });
}

vi.mock('drizzle-orm', () => ({
  and: vi.fn(() => '__and__'),
  eq: vi.fn(() => '__eq__'),
  gte: vi.fn(() => '__gte__'),
  lte: vi.fn(() => '__lte__'),
  inArray: vi.fn(() => '__inArray__'),
  isNull: vi.fn(() => '__isNull__'),
  isNotNull: vi.fn(() => '__isNotNull__'),
  notInArray: vi.fn(() => '__notInArray__'),
  or: vi.fn(() => '__or__'),
  sql: vi.fn(() => '__sql__'),
}));

import { crmDashboardRoutes } from '../api/crm-dashboard.routes.js';

const TEST_ISSUER = process.env['JWT_ISSUER'] ?? 'erp-auth-service';
let privateKey: KeyLike;

const mockCtxFactory = {
  create: () => ({
    db: {
      raw: {
        select: () => ({ from: () => ({ where: () => emptyQueryResult() }) }),
      } as never,
    },
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
});

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await crmDashboardRoutes(app, mockCtxFactory);
  await app.ready();
  return app;
}

describe('GET /crm/dashboard — permission gating', () => {
  it('403s a caller without CRM_DASHBOARD_VIEW at all', async () => {
    const app = await buildApp();
    const token = await makeToken([]);
    const res = await app.inject({
      method: 'GET',
      url: '/crm/dashboard',
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(403);
    await app.close();
  });

  it('hides every sub-section (never 403s the whole dashboard) for a caller with only CRM_DASHBOARD_VIEW', async () => {
    const app = await buildApp();
    const token = await makeToken([PERMISSIONS.CRM_DASHBOARD_VIEW]);
    const res = await app.inject({
      method: 'GET',
      url: '/crm/dashboard',
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.leadFunnel).toBeNull();
    expect(body.data.ticketSla).toBeNull();
    expect(body.data.campaignPerformance).toBeNull();
    expect(body.data.hiddenSections.sort()).toEqual([
      'campaignPerformance',
      'leadFunnel',
      'quotaAttainment',
      'ticketSla',
    ]);
    await app.close();
  });

  it('shows only the sections the caller holds the underlying permission for', async () => {
    const app = await buildApp();
    const token = await makeToken([PERMISSIONS.CRM_DASHBOARD_VIEW, PERMISSIONS.TICKET_VIEW]);
    const res = await app.inject({
      method: 'GET',
      url: '/crm/dashboard',
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.leadFunnel).toBeNull();
    expect(body.data.ticketSla).not.toBeNull();
    expect(body.data.campaignPerformance).toBeNull();
    expect(body.data.hiddenSections.sort()).toEqual([
      'campaignPerformance',
      'leadFunnel',
      'quotaAttainment',
    ]);
    await app.close();
  });

  it('shows every original section for a caller holding all four original permissions (quotaAttainment still hidden — needs its own QUOTA_MANAGE)', async () => {
    const app = await buildApp();
    const token = await makeToken([
      PERMISSIONS.CRM_DASHBOARD_VIEW,
      PERMISSIONS.LEAD_VIEW,
      PERMISSIONS.TICKET_VIEW,
      PERMISSIONS.CRM_CAMPAIGN_ANALYTICS_VIEW,
    ]);
    const res = await app.inject({
      method: 'GET',
      url: '/crm/dashboard',
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.leadFunnel).not.toBeNull();
    expect(body.data.ticketSla).not.toBeNull();
    expect(body.data.campaignPerformance).not.toBeNull();
    expect(body.data.quotaAttainment).toBeNull();
    expect(body.data.hiddenSections).toEqual(['quotaAttainment']);
    await app.close();
  });

  // CRM-ROADMAP Phase 4, Feature 5 — quotaAttainment is gated on its own permission
  // (QUOTA_MANAGE), independent of the other three sections.
  it('shows quotaAttainment (empty, since no quotas exist in this mock) for a caller with QUOTA_MANAGE', async () => {
    const app = await buildApp();
    const token = await makeToken([PERMISSIONS.CRM_DASHBOARD_VIEW, PERMISSIONS.QUOTA_MANAGE]);
    const res = await app.inject({
      method: 'GET',
      url: '/crm/dashboard',
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.quotaAttainment).not.toBeNull();
    expect(body.data.quotaAttainment.rows).toEqual([]);
    expect(body.data.hiddenSections).not.toContain('quotaAttainment');
    await app.close();
  });
});
