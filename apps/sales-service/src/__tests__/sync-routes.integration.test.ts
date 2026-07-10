/**
 * OFFLINE-04 — GET /sync/customers
 * Same DB-gated, real-HTTP convention as inventory-service's sync-routes.integration.test.ts:
 * a real Postgres connection wrapped in a fake ctxFactory, routes hit via app.inject().
 * Covers tenant isolation, branch scoping (per getBranchScope — the property this route
 * adds on top of the internal search-sync route it mirrors), and modifiedSince filtering.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { generateKeyPairSync } from 'node:crypto';
import { SignJWT, importPKCS8, type KeyLike } from 'jose';
import { createDatabaseClient, customers, branches } from '@erp/db';
import { eq } from 'drizzle-orm';
import { PERMISSIONS } from '@erp/types';
import { syncRoutes } from '../api/sync.routes.js';

const DB_URL = process.env['DATABASE_URL'];

describe.skipIf(!DB_URL)('OFFLINE-04 delta-sync download routes — sales-service', () => {
  let db: ReturnType<typeof createDatabaseClient>;
  let app: FastifyInstance;
  let privateKey: KeyLike;
  const TENANT_A = 900_301 + Math.floor(Math.random() * 1000);
  const TENANT_B = TENANT_A + 1;
  let branch1Id: number;
  let branch2Id: number;

  const fakeCtxFactory = {
    create: ({ tenantId }: { tenantId: number }) => ({
      db: { raw: db, transaction: (fn: (tx: unknown) => unknown) => fn(db) },
      cache: { getJson: async () => null, setJson: async () => {} },
      events: { publish: async () => {} },
      audit: { log: async () => {} },
      tenantId,
    }),
  } as never;

  async function makeToken(branchIds: number[], permissions: string[] = [PERMISSIONS.CUSTOMER_VIEW]): Promise<string> {
    const nowSec = Math.floor(Date.now() / 1000);
    return new SignJWT({ tenantId: TENANT_A, email: 'sync-test@erp.local', roles: [], permissions, branchIds })
      .setProtectedHeader({ alg: 'RS256' })
      .setSubject('1')
      .setIssuer('erp-test')
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

    const [b1] = await db.insert(branches).values({ tenantId: TENANT_A, name: 'Branch 1', code: 'B1', isHeadOffice: true, isActive: true, createdBy: 1 }).returning();
    const [b2] = await db.insert(branches).values({ tenantId: TENANT_A, name: 'Branch 2', code: 'B2', isHeadOffice: false, isActive: true, createdBy: 1 }).returning();
    branch1Id = b1!.id;
    branch2Id = b2!.id;

    await db.insert(customers).values([
      { tenantId: TENANT_A, branchId: branch1Id, displayName: 'Branch 1 Customer', phone: '9000000010', creditLimit: '0', openingBalance: '0', createdBy: 1 },
      { tenantId: TENANT_A, branchId: branch2Id, displayName: 'Branch 2 Customer', phone: '9000000011', creditLimit: '0', openingBalance: '0', createdBy: 1 },
      { tenantId: TENANT_B, branchId: branch1Id, displayName: 'Tenant B Customer', phone: '9000000012', creditLimit: '0', openingBalance: '0', createdBy: 1 },
    ]);

    app = Fastify({ logger: false });
    await syncRoutes(app, fakeCtxFactory);
  });

  afterAll(async () => {
    await app.close();
    await db.delete(customers).where(eq(customers.tenantId, TENANT_A));
    await db.delete(customers).where(eq(customers.tenantId, TENANT_B));
    await db.delete(branches).where(eq(branches.tenantId, TENANT_A));
  });

  it('never returns another tenant\'s customers', async () => {
    const token = await makeToken([]);
    const res = await app.inject({ method: 'GET', url: '/sync/customers', headers: { Authorization: `Bearer ${token}` } });

    const body = JSON.parse(res.body) as { data: { content: { displayName: string; tenantId: number }[] } };
    expect(body.data.content.every((c) => c.tenantId === TENANT_A)).toBe(true);
    expect(body.data.content.some((c) => c.displayName === 'Tenant B Customer')).toBe(false);
  });

  it('restricts to the caller\'s assigned branch when branchIds is non-empty', async () => {
    const token = await makeToken([branch1Id]);
    const res = await app.inject({ method: 'GET', url: '/sync/customers', headers: { Authorization: `Bearer ${token}` } });

    const body = JSON.parse(res.body) as { data: { content: { displayName: string }[] } };
    expect(body.data.content.some((c) => c.displayName === 'Branch 1 Customer')).toBe(true);
    expect(body.data.content.some((c) => c.displayName === 'Branch 2 Customer')).toBe(false);
  });

  it('returns all branches when the caller has no branch assignments (getBranchScope => all)', async () => {
    const token = await makeToken([]);
    const res = await app.inject({ method: 'GET', url: '/sync/customers', headers: { Authorization: `Bearer ${token}` } });

    const body = JSON.parse(res.body) as { data: { content: { displayName: string }[] } };
    expect(body.data.content.some((c) => c.displayName === 'Branch 1 Customer')).toBe(true);
    expect(body.data.content.some((c) => c.displayName === 'Branch 2 Customer')).toBe(true);
  });

  it('returns all branches when the caller holds BRANCH_SCOPE_BYPASS', async () => {
    const token = await makeToken([branch2Id], [PERMISSIONS.CUSTOMER_VIEW, 'BRANCH_SCOPE_BYPASS']);
    const res = await app.inject({ method: 'GET', url: '/sync/customers', headers: { Authorization: `Bearer ${token}` } });

    const body = JSON.parse(res.body) as { data: { content: { displayName: string }[] } };
    expect(body.data.content.some((c) => c.displayName === 'Branch 1 Customer')).toBe(true);
  });

  it('modifiedSince only returns customers updated after the given timestamp', async () => {
    await db.insert(customers).values({
      tenantId: TENANT_A, branchId: branch1Id, displayName: 'Ancient Customer', phone: '9000000099',
      creditLimit: '0', openingBalance: '0', createdBy: 1, updatedAt: new Date('2019-01-01T00:00:00Z'),
    });

    const token = await makeToken([]);
    const res = await app.inject({ method: 'GET', url: '/sync/customers?modifiedSince=2024-01-01T00:00:00Z', headers: { Authorization: `Bearer ${token}` } });

    const body = JSON.parse(res.body) as { data: { content: { displayName: string }[] } };
    expect(body.data.content.some((c) => c.displayName === 'Ancient Customer')).toBe(false);
    expect(body.data.content.some((c) => c.displayName === 'Branch 1 Customer')).toBe(true);
  });

  it('pages through a dataset larger than one page via hasMore', async () => {
    // 3 pre-existing TENANT_A customers from beforeAll/earlier tests + 5 fresh ones = 8,
    // so a page size of 3 spans 3 pages with the last page short.
    await db.insert(customers).values(
      Array.from({ length: 5 }, (_, i) => ({
        tenantId: TENANT_A, branchId: branch1Id, displayName: `Page Customer ${i}`,
        phone: `900000020${i}`, creditLimit: '0', openingBalance: '0', createdBy: 1,
      }))
    );

    const token = await makeToken([]);
    const seenIds = new Set<number>();
    let page = 0;
    let hasMore = true;
    let pages = 0;
    while (hasMore) {
      const res = await app.inject({ method: 'GET', url: `/sync/customers?page=${page}&size=3`, headers: { Authorization: `Bearer ${token}` } });
      const body = JSON.parse(res.body) as { data: { content: { id: number }[]; totalElements: number; hasMore: boolean } };
      body.data.content.forEach((c) => seenIds.add(c.id));
      hasMore = body.data.hasMore;
      pages++;
      expect(pages).toBeLessThan(20); // guard against an infinite loop if hasMore never settles
      page++;
    }

    expect(pages).toBeGreaterThan(1);
    expect(seenIds.size).toBeGreaterThanOrEqual(8);
  });
});
