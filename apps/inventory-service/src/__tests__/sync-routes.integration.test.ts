/**
 * OFFLINE-04 — GET /sync/items, /sync/price-list-items, /sync/tax-rates
 * Exercises the real routes over HTTP (app.inject) against a real Postgres connection,
 * with a lightweight fake ctxFactory reusing that real db client (cache/events/audit are
 * stubbed since these read-only routes never touch them) — mirrors
 * apps/sales-service/src/__tests__/customer.integration.test.ts's DB-gated convention,
 * extended to the HTTP layer so tenant scoping, modifiedSince filtering, and pagination
 * are verified against the actual SQL the route issues, not a mocked query builder.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { generateKeyPairSync } from 'node:crypto';
import { SignJWT, importPKCS8, type KeyLike } from 'jose';
import { createDatabaseClient, items, priceLists, priceListItems } from '@erp/db';
import { eq } from 'drizzle-orm';
import { PERMISSIONS } from '@erp/types';
import { syncRoutes } from '../api/sync.routes.js';

const DB_URL = process.env['DATABASE_URL'];

describe.skipIf(!DB_URL)('OFFLINE-04 delta-sync download routes — inventory-service', () => {
  let db: ReturnType<typeof createDatabaseClient>;
  let app: FastifyInstance;
  let privateKey: KeyLike;
  const TENANT_A = 900_201 + Math.floor(Math.random() * 1000);
  const TENANT_B = TENANT_A + 1;

  const fakeCtxFactory = {
    create: ({ tenantId }: { tenantId: number }) => ({
      db: { raw: db, transaction: (fn: (tx: unknown) => unknown) => fn(db) },
      cache: { getJson: async () => null, setJson: async () => {} },
      events: { publish: async () => {} },
      audit: { log: async () => {} },
      tenantId,
    }),
  } as never;

  async function makeToken(branchIds: number[] = []): Promise<string> {
    const nowSec = Math.floor(Date.now() / 1000);
    return new SignJWT({ tenantId: TENANT_A, email: 'sync-test@erp.local', roles: [], permissions: [PERMISSIONS.ITEM_VIEW, PERMISSIONS.PRICE_LIST_VIEW], branchIds })
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

    app = Fastify({ logger: false });
    await syncRoutes(app, fakeCtxFactory);
  });

  afterAll(async () => {
    await app.close();
    await db.delete(priceListItems).where(eq(priceListItems.tenantId, TENANT_A));
    await db.delete(priceLists).where(eq(priceLists.tenantId, TENANT_A));
    await db.delete(items).where(eq(items.tenantId, TENANT_A));
    await db.delete(items).where(eq(items.tenantId, TENANT_B));
  });

  it('GET /sync/items only returns the caller tenant\'s items, never another tenant\'s', async () => {
    await db.insert(items).values([
      { tenantId: TENANT_A, name: 'Tenant A Item', itemCode: 'TA-1', salePrice: '100', gstRate: '18', unitId: 1, hsnCode: '1000', createdBy: 1 },
      { tenantId: TENANT_B, name: 'Tenant B Item', itemCode: 'TB-1', salePrice: '200', gstRate: '18', unitId: 1, hsnCode: '2000', createdBy: 1 },
    ]);

    const token = await makeToken();
    const res = await app.inject({ method: 'GET', url: '/sync/items', headers: { Authorization: `Bearer ${token}` } });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { data: { content: { name: string; tenantId: number }[] } };
    expect(body.data.content.some((i) => i.name === 'Tenant A Item')).toBe(true);
    expect(body.data.content.every((i) => i.tenantId === TENANT_A)).toBe(true);
    expect(body.data.content.some((i) => i.name === 'Tenant B Item')).toBe(false);
  });

  it('modifiedSince only returns items updated after the given timestamp', async () => {
    const older = new Date('2020-01-01T00:00:00Z');
    const newer = new Date('2030-01-01T00:00:00Z');
    await db.insert(items).values([
      { tenantId: TENANT_A, name: 'Old Item', itemCode: 'OLD-1', salePrice: '10', gstRate: '18', unitId: 1, hsnCode: '3000', createdBy: 1, updatedAt: older },
      { tenantId: TENANT_A, name: 'New Item', itemCode: 'NEW-1', salePrice: '20', gstRate: '18', unitId: 1, hsnCode: '3001', createdBy: 1, updatedAt: newer },
    ]);

    const token = await makeToken();
    const cutoff = new Date('2025-01-01T00:00:00Z').toISOString();
    const res = await app.inject({ method: 'GET', url: `/sync/items?modifiedSince=${cutoff}`, headers: { Authorization: `Bearer ${token}` } });

    const body = JSON.parse(res.body) as { data: { content: { name: string }[] } };
    expect(body.data.content.some((i) => i.name === 'New Item')).toBe(true);
    expect(body.data.content.some((i) => i.name === 'Old Item')).toBe(false);
  });

  it('pagination pages through a dataset larger than one page via hasMore', async () => {
    await db.insert(items).values([
      { tenantId: TENANT_A, name: 'Page Item 1', itemCode: 'PG-1', salePrice: '1', gstRate: '18', unitId: 1, hsnCode: '4001', createdBy: 1 },
      { tenantId: TENANT_A, name: 'Page Item 2', itemCode: 'PG-2', salePrice: '1', gstRate: '18', unitId: 1, hsnCode: '4002', createdBy: 1 },
      { tenantId: TENANT_A, name: 'Page Item 3', itemCode: 'PG-3', salePrice: '1', gstRate: '18', unitId: 1, hsnCode: '4003', createdBy: 1 },
    ]);

    const token = await makeToken();
    const page0 = await app.inject({ method: 'GET', url: '/sync/items?page=0&size=2', headers: { Authorization: `Bearer ${token}` } });
    const body0 = JSON.parse(page0.body) as { data: { content: unknown[]; hasMore: boolean; totalElements: number } };
    expect(body0.data.content).toHaveLength(2);
    expect(body0.data.hasMore).toBe(true);

    const lastPage = Math.floor((body0.data.totalElements - 1) / 2);
    const pageLast = await app.inject({ method: 'GET', url: `/sync/items?page=${lastPage}&size=2`, headers: { Authorization: `Bearer ${token}` } });
    const bodyLast = JSON.parse(pageLast.body) as { data: { hasMore: boolean } };
    expect(bodyLast.data.hasMore).toBe(false);
  });

  it('GET /sync/price-list-items is tenant-scoped', async () => {
    const [pl] = await db.insert(priceLists).values({ tenantId: TENANT_A, name: 'Retail', code: 'RTL', createdBy: 1 }).returning();
    const [item] = await db.insert(items).values({ tenantId: TENANT_A, name: 'Priced Item', itemCode: 'PR-1', salePrice: '50', gstRate: '18', unitId: 1, hsnCode: '5000', createdBy: 1 }).returning();
    await db.insert(priceListItems).values({ tenantId: TENANT_A, priceListId: pl!.id, itemId: item!.id, salePrice: '45', createdBy: 1 });

    const token = await makeToken();
    const res = await app.inject({ method: 'GET', url: '/sync/price-list-items', headers: { Authorization: `Bearer ${token}` } });

    const body = JSON.parse(res.body) as { data: { content: { tenantId: number }[] } };
    expect(body.data.content.every((r) => r.tenantId === TENANT_A)).toBe(true);
  });

  it('GET /sync/tax-rates returns one row per hsnCode', async () => {
    await db.insert(items).values([
      { tenantId: TENANT_A, name: 'HSN Item 1', itemCode: 'HS-1', salePrice: '1', gstRate: '12', unitId: 1, hsnCode: '6000', createdBy: 1 },
      { tenantId: TENANT_A, name: 'HSN Item 2', itemCode: 'HS-2', salePrice: '1', gstRate: '12', unitId: 1, hsnCode: '6000', createdBy: 1 },
    ]);

    const token = await makeToken();
    const res = await app.inject({ method: 'GET', url: '/sync/tax-rates', headers: { Authorization: `Bearer ${token}` } });

    const body = JSON.parse(res.body) as { data: { content: { hsnCode: string }[] } };
    const hsn6000Rows = body.data.content.filter((r) => r.hsnCode === '6000');
    expect(hsn6000Rows).toHaveLength(1);
  });
});
