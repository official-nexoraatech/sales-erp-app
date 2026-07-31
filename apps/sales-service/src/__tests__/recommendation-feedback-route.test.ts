// CRM-ROADMAP Phase 3, Feature 1 — route-level coverage for POST /recommendations/:id/feedback.
// The dismiss-aware merge logic itself (HealthScoringService.recordFeedback/
// computeAndCachePredictions) is already covered by health-scoring-service.test.ts; this file
// covers the thin route wrapper: validation, 404 for an unknown id, and the success path against
// a real row.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { generateKeyPairSync } from 'node:crypto';
import { SignJWT, importPKCS8, type KeyLike } from 'jose';
import { createDatabaseClient } from '@erp/db';
import { branches, customers, crmNextBestActions } from '@erp/db';
import { eq } from 'drizzle-orm';
import type { PlatformContextFactory } from '@erp/sdk';
import { PERMISSIONS } from '@erp/types';
import { customer360Routes } from '../api/customer-360.routes.js';

const DB_URL = process.env['DATABASE_URL'];
const TEST_ISSUER = process.env['JWT_ISSUER'] ?? 'erp-auth-service';

describe.skipIf(!DB_URL)('POST /recommendations/:id/feedback', () => {
  let db: ReturnType<typeof createDatabaseClient>;
  let app: FastifyInstance;
  let privateKey: KeyLike;
  const TEST_TENANT = 901_101 + Math.floor(Math.random() * 1000);
  let branchId: number;
  let customerId: number;
  let actionId: number;

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
        name: 'FB Branch',
        code: 'FB',
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
        displayName: 'Feedback Customer',
        phone: '9900000001',
        creditLimit: '0',
        openingBalance: '0',
        createdBy: 1,
      })
      .returning();
    customerId = customer!.id;

    const [action] = await db
      .insert(crmNextBestActions)
      .values({
        tenantId: TEST_TENANT,
        customerId,
        actionType: 'RE_ENGAGEMENT',
        actionText: 'Send a re-engagement message',
        reason: 'test fixture',
      })
      .returning();
    actionId = action!.id;

    const ctxFactory = {
      create: (tenant: { tenantId: number; userId: number }) => ({
        db: { raw: db },
        tenant,
        events: { publish: async () => undefined },
        audit: { log: async () => undefined },
      }),
    } as unknown as PlatformContextFactory;

    app = Fastify({ logger: false });
    await customer360Routes(app, ctxFactory);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    await db.delete(crmNextBestActions).where(eq(crmNextBestActions.tenantId, TEST_TENANT));
    await db.delete(customers).where(eq(customers.tenantId, TEST_TENANT));
    await db.delete(branches).where(eq(branches.tenantId, TEST_TENANT));
  });

  it('rejects an invalid action value', async () => {
    const token = await makeToken([PERMISSIONS.CRM_360_VIEW]);
    const res = await app.inject({
      method: 'POST',
      url: `/recommendations/${actionId}/feedback`,
      headers: { Authorization: `Bearer ${token}` },
      payload: { recommendationType: 'NEXT_BEST_ACTION', action: 'MAYBE' },
    });
    expect(res.statusCode).toBe(422);
  });

  it('404s for a recommendation id that does not exist', async () => {
    const token = await makeToken([PERMISSIONS.CRM_360_VIEW]);
    const res = await app.inject({
      method: 'POST',
      url: '/recommendations/999999999/feedback',
      headers: { Authorization: `Bearer ${token}` },
      payload: { recommendationType: 'NEXT_BEST_ACTION', action: 'DISMISS' },
    });
    expect(res.statusCode).toBe(404);
  });

  it('dismisses a real recommendation and persists it', async () => {
    const token = await makeToken([PERMISSIONS.CRM_360_VIEW]);
    const res = await app.inject({
      method: 'POST',
      url: `/recommendations/${actionId}/feedback`,
      headers: { Authorization: `Bearer ${token}` },
      payload: { recommendationType: 'NEXT_BEST_ACTION', action: 'DISMISS' },
    });
    expect(res.statusCode).toBe(200);

    const [row] = await db
      .select()
      .from(crmNextBestActions)
      .where(eq(crmNextBestActions.id, actionId));
    expect(row!.dismissed).toBe(true);
  });
});
