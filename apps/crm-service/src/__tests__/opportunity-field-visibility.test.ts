// CRM-ROADMAP Phase 3, Feature 6 — Field-level RBAC for CRM Records. Integration coverage per
// this feature's own DoD: two callers with different permission sets hitting the exact same
// route must receive correctly different response shapes (the `value` field omitted, not
// nulled, for a caller lacking OPPORTUNITY_VALUE_VIEW) — live-DB, not the mocked-db route-guard
// style already covered by opportunity-permission-guards.test.ts, since the thing under test here
// is actual row content, not just a 403/non-403 status code.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { generateKeyPairSync } from 'node:crypto';
import { SignJWT, importPKCS8, type KeyLike } from 'jose';
import { createDatabaseClient } from '@erp/db';
import { branches, customers, crmOpportunities, crmOpportunityHistory } from '@erp/db';
import { eq } from 'drizzle-orm';
import type { PlatformContextFactory } from '@erp/sdk';
import { PERMISSIONS } from '@erp/types';
import { opportunityRoutes } from '../api/opportunity.routes.js';
import { OpportunityService } from '../domain/OpportunityService.js';

const DB_URL = process.env['DATABASE_URL'];
const TEST_ISSUER = process.env['JWT_ISSUER'] ?? 'erp-auth-service';

describe.skipIf(!DB_URL)('GET /opportunities* — field-level RBAC on `value`', () => {
  let db: ReturnType<typeof createDatabaseClient>;
  let app: FastifyInstance;
  let privateKey: KeyLike;
  const TEST_TENANT = 900_501 + Math.floor(Math.random() * 1000);
  let branchId: number;
  let customerId: number;
  let opportunityId: number;

  async function makeToken(permissions: string[]): Promise<string> {
    const nowSec = Math.floor(Date.now() / 1000);
    return new SignJWT({
      tenantId: TEST_TENANT,
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
    db = createDatabaseClient({ url: DB_URL! });
    const { privateKey: privPem, publicKey: pubPem } = generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });
    privateKey = await importPKCS8(privPem, 'RS256');
    process.env['JWT_PUBLIC_KEY'] = pubPem;

    const [branch] = await db
      .insert(branches)
      .values({
        tenantId: TEST_TENANT,
        name: 'FV Branch',
        code: 'FV',
        isHeadOffice: true,
        isActive: true,
        createdBy: 1,
      })
      .returning();
    branchId = branch!.id;

    const [customer] = await db
      .insert(customers)
      .values({
        tenantId: TEST_TENANT,
        branchId,
        displayName: 'Field Visibility Customer',
        phone: '9600001111',
        creditLimit: '0',
        openingBalance: '0',
        createdBy: 1,
      })
      .returning();
    customerId = customer!.id;

    const created = await OpportunityService.create(db, {
      tenantId: TEST_TENANT,
      name: 'Field Visibility Deal',
      value: 75_000,
      customerId,
      createdBy: 1,
    });
    opportunityId = created.id;

    const ctxFactory = {
      create: () => ({
        db: { raw: db },
        events: { publish: async () => undefined },
        audit: { log: async () => undefined },
      }),
    } as unknown as PlatformContextFactory;

    app = Fastify({ logger: false });
    await opportunityRoutes(app, ctxFactory);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    await db.delete(crmOpportunityHistory).where(eq(crmOpportunityHistory.tenantId, TEST_TENANT));
    await db.delete(crmOpportunities).where(eq(crmOpportunities.tenantId, TEST_TENANT));
    await db.delete(customers).where(eq(customers.tenantId, TEST_TENANT));
    await db.delete(branches).where(eq(branches.tenantId, TEST_TENANT));
  });

  describe('GET /opportunities', () => {
    it('omits value for a caller without OPPORTUNITY_VALUE_VIEW', async () => {
      const token = await makeToken([PERMISSIONS.OPPORTUNITY_VIEW]);
      const res = await app.inject({
        method: 'GET',
        url: '/opportunities',
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(res.statusCode).toBe(200);
      const row = res.json().data.content.find((o: { id: number }) => o.id === opportunityId);
      expect(row).toBeDefined();
      expect('value' in row).toBe(false);
    });

    it('includes value for a caller with OPPORTUNITY_VALUE_VIEW', async () => {
      const token = await makeToken([
        PERMISSIONS.OPPORTUNITY_VIEW,
        PERMISSIONS.OPPORTUNITY_VALUE_VIEW,
      ]);
      const res = await app.inject({
        method: 'GET',
        url: '/opportunities',
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(res.statusCode).toBe(200);
      const row = res.json().data.content.find((o: { id: number }) => o.id === opportunityId);
      expect(row).toBeDefined();
      expect(parseFloat(row.value)).toBe(75_000);
    });
  });

  describe('GET /opportunities/:id', () => {
    it('omits value for a caller without OPPORTUNITY_VALUE_VIEW', async () => {
      const token = await makeToken([PERMISSIONS.OPPORTUNITY_VIEW]);
      const res = await app.inject({
        method: 'GET',
        url: `/opportunities/${opportunityId}`,
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(res.statusCode).toBe(200);
      expect('value' in res.json().data).toBe(false);
    });

    it('includes value for a caller with OPPORTUNITY_VALUE_VIEW', async () => {
      const token = await makeToken([
        PERMISSIONS.OPPORTUNITY_VIEW,
        PERMISSIONS.OPPORTUNITY_VALUE_VIEW,
      ]);
      const res = await app.inject({
        method: 'GET',
        url: `/opportunities/${opportunityId}`,
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(res.statusCode).toBe(200);
      expect(parseFloat(res.json().data.value)).toBe(75_000);
    });
  });

  describe('GET /opportunities/forecast', () => {
    it('omits pipelineValue/weightedValue/commitValue for a caller without OPPORTUNITY_VALUE_VIEW', async () => {
      const token = await makeToken([PERMISSIONS.OPPORTUNITY_VIEW]);
      const res = await app.inject({
        method: 'GET',
        url: '/opportunities/forecast',
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(res.statusCode).toBe(200);
      const data = res.json().data;
      expect('pipelineValue' in data).toBe(false);
      expect('weightedValue' in data).toBe(false);
      expect('commitValue' in data).toBe(false);
    });

    it('includes pipelineValue/weightedValue/commitValue for a caller with OPPORTUNITY_VALUE_VIEW', async () => {
      const token = await makeToken([
        PERMISSIONS.OPPORTUNITY_VIEW,
        PERMISSIONS.OPPORTUNITY_VALUE_VIEW,
      ]);
      const res = await app.inject({
        method: 'GET',
        url: '/opportunities/forecast',
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(res.statusCode).toBe(200);
      const data = res.json().data;
      expect(data.pipelineValue).toBeGreaterThanOrEqual(75_000);
    });
  });
});
