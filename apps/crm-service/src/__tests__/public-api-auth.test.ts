// CRM-ROADMAP Phase 4, Feature 8 — Public CRM API & BI/Data-Warehouse Export.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { createDatabaseClient } from '@erp/db';
import { crmApiKeys, crmLeads, crmOpportunities, branches } from '@erp/db';
import { eq } from 'drizzle-orm';
import { ApiKeyService } from '../domain/ApiKeyService.js';
import { publicApiRoutes } from '../api/public-api.routes.js';

const DB_URL = process.env['DATABASE_URL'];

describe.skipIf(!DB_URL)('publicApiRoutes — requirePublicApiScope', () => {
  let db: ReturnType<typeof createDatabaseClient>;
  let app: FastifyInstance;
  const TEST_TENANT = 908_601 + Math.floor(Math.random() * 1000);
  const OTHER_TENANT = TEST_TENANT + 1;
  let leadsOnlyKey: string;
  let opportunitiesOnlyKey: string;
  let otherTenantKey: string;

  beforeAll(async () => {
    db = createDatabaseClient({ url: DB_URL! });
    app = Fastify({ logger: false });
    await publicApiRoutes(app, db);

    const [branch] = await db
      .insert(branches)
      .values({
        tenantId: TEST_TENANT,
        name: 'Public API Branch',
        code: 'PA',
        isHeadOffice: true,
        isActive: true,
        createdBy: 1,
      })
      .returning();

    await db
      .insert(crmLeads)
      .values({ tenantId: TEST_TENANT, phone: '9990001111', branchId: branch!.id, createdBy: 1 });
    await db
      .insert(crmOpportunities)
      .values({ tenantId: TEST_TENANT, name: 'Test Deal', createdBy: 1 });

    leadsOnlyKey = (
      await ApiKeyService.create(db, TEST_TENANT, 1, { name: 'Leads Key', scopes: ['leads:read'] })
    ).plaintextKey;
    opportunitiesOnlyKey = (
      await ApiKeyService.create(db, TEST_TENANT, 1, {
        name: 'Opps Key',
        scopes: ['opportunities:read'],
      })
    ).plaintextKey;
    otherTenantKey = (
      await ApiKeyService.create(db, OTHER_TENANT, 1, {
        name: 'Other Tenant Key',
        scopes: ['leads:read'],
      })
    ).plaintextKey;
  });

  afterAll(async () => {
    await app.close();
    await db.delete(crmApiKeys).where(eq(crmApiKeys.tenantId, TEST_TENANT));
    await db.delete(crmApiKeys).where(eq(crmApiKeys.tenantId, OTHER_TENANT));
    await db.delete(crmLeads).where(eq(crmLeads.tenantId, TEST_TENANT));
    await db.delete(crmOpportunities).where(eq(crmOpportunities.tenantId, TEST_TENANT));
    await db.delete(branches).where(eq(branches.tenantId, TEST_TENANT));
  });

  it('401s with no x-api-key header at all', async () => {
    const res = await app.inject({ method: 'GET', url: '/public/v1/leads' });
    expect(res.statusCode).toBe(401);
  });

  it('401s with an invalid/unknown key', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/public/v1/leads',
      headers: { 'x-api-key': 'crm_live_' + 'f'.repeat(64) },
    });
    expect(res.statusCode).toBe(401);
  });

  it('200s and returns tenant-scoped leads for a key with leads:read scope', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/public/v1/leads',
      headers: { 'x-api-key': leadsOnlyKey },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.content.length).toBeGreaterThan(0);
    expect(body.data.content.every((l: { phone: string }) => l.phone === '9990001111')).toBe(true);
  });

  it('403s a key without the required scope for a different entity', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/public/v1/opportunities',
      headers: { 'x-api-key': leadsOnlyKey },
    });
    expect(res.statusCode).toBe(403);
  });

  it('200s for opportunities with a key scoped to opportunities:read', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/public/v1/opportunities',
      headers: { 'x-api-key': opportunitiesOnlyKey },
    });
    expect(res.statusCode).toBe(200);
  });

  it("never returns another tenant's data even with a validly-scoped key for that tenant", async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/public/v1/leads',
      headers: { 'x-api-key': otherTenantKey },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.content.length).toBe(0);
  });

  it('caps page size at MAX_PAGE_SIZE regardless of a larger requested limit', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/public/v1/leads?limit=99999',
      headers: { 'x-api-key': leadsOnlyKey },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.limit).toBe(100);
  });
});
