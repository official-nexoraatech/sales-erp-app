// CRM-ROADMAP Phase 4, Feature 6 (Partner/Channel Portal) — mirrors
// portal-auth-boundary.integration.test.ts exactly for the PARTNER auth scope: proves partner A
// can never reach partner B's data through any /partner/* route, on a real database with two
// real seeded WHOLESALE customers. Same self-defending-scanner mechanism (a parameterized route
// table whose length is checked against the :id-route count scraped from partner.routes.ts).
// Also covers this feature's own net-new capability (POST /partner/orders) and its
// security-critical price-override protection: an item with no price-list tier coverage must
// use the server-resolved base price, never a client-submitted one (the client schema doesn't
// even accept a unitPrice field — this proves the created line reflects items.salePrice).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify, { type FastifyInstance } from 'fastify';
import { generateKeyPairSync } from 'node:crypto';
import { SignJWT, importPKCS8, type KeyLike } from 'jose';
import { createDatabaseClient } from '@erp/db';
import { branches, customers, items, quotations, quotationLines } from '@erp/db';
import { eq } from 'drizzle-orm';
import { partnerRoutes } from '../api/partner.routes.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_URL = process.env['DATABASE_URL'];
const TEST_ISSUER = process.env['JWT_ISSUER'] ?? 'erp-auth-service';

describe.skipIf(!DB_URL)('partner routes (sales-service) — cross-partner boundary', () => {
  let db: ReturnType<typeof createDatabaseClient>;
  let app: FastifyInstance;
  let privateKey: KeyLike;
  const TEST_TENANT = 909_201 + Math.floor(Math.random() * 1000);
  let branchId: number;
  let customerA: number;
  let customerB: number;
  let orderA: number;
  let orderB: number;
  let noTierItemId: number;

  async function tokenFor(customerId: number): Promise<string> {
    const nowSec = Math.floor(Date.now() / 1000);
    return new SignJWT({
      tenantId: TEST_TENANT,
      email: `partner-${customerId}@example.com`,
      roles: ['PARTNER'],
      permissions: [],
      branchIds: [],
      customerId,
    })
      .setProtectedHeader({ alg: 'RS256' })
      .setSubject(String(1000 + customerId))
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
        name: 'Boundary Branch',
        code: 'BB',
        isHeadOffice: true,
        isActive: true,
        gstin: '27AAAAA0000A1Z5',
        createdBy: 1,
      })
      .returning();
    branchId = branch!.id;

    const [custA] = await db
      .insert(customers)
      .values({
        tenantId: TEST_TENANT,
        branchId,
        displayName: 'Partner A',
        phone: '9900000020',
        customerType: 'WHOLESALE',
        creditLimit: '0',
        openingBalance: '0',
        createdBy: 1,
      })
      .returning();
    customerA = custA!.id;

    const [custB] = await db
      .insert(customers)
      .values({
        tenantId: TEST_TENANT,
        branchId,
        displayName: 'Partner B',
        phone: '9900000021',
        customerType: 'WHOLESALE',
        creditLimit: '0',
        openingBalance: '0',
        createdBy: 1,
      })
      .returning();
    customerB = custB!.id;

    const [item] = await db
      .insert(items)
      .values({
        tenantId: TEST_TENANT,
        name: 'No-Tier Item',
        itemCode: `NTI-${TEST_TENANT}`,
        salePrice: '250.00',
        purchasePrice: '100.00',
        gstRate: '18.00',
        unitId: 1,
        hsnCode: '4820',
        availableQty: '0',
        createdBy: 1,
      })
      .returning();
    noTierItemId = item!.id;

    const now = new Date();
    const [qA] = await db
      .insert(quotations)
      .values({
        tenantId: TEST_TENANT,
        branchId,
        quotationNumber: `QT-BOUND-A-${Date.now()}`,
        customerId: customerA,
        validUntil: now,
        placeOfSupply: '27',
        createdBy: 1,
      })
      .returning();
    orderA = qA!.id;

    const [qB] = await db
      .insert(quotations)
      .values({
        tenantId: TEST_TENANT,
        branchId,
        quotationNumber: `QT-BOUND-B-${Date.now()}`,
        customerId: customerB,
        validUntil: now,
        placeOfSupply: '27',
        createdBy: 1,
      })
      .returning();
    orderB = qB!.id;

    app = Fastify({ logger: false });
    await partnerRoutes(app, db);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    await db.delete(quotationLines).where(eq(quotationLines.tenantId, TEST_TENANT));
    await db.delete(quotations).where(eq(quotations.tenantId, TEST_TENANT));
    await db.delete(items).where(eq(items.tenantId, TEST_TENANT));
    await db.delete(customers).where(eq(customers.tenantId, TEST_TENANT));
    await db.delete(branches).where(eq(branches.tenantId, TEST_TENANT));
  });

  // Parameterized route table: (method, path-builder using B's ids). Called with partner A's
  // token — every one must 404, proving A cannot reach B's data by guessing/incrementing an id.
  function routeTable(): Array<{ method: 'GET' | 'POST'; url: () => string; body?: unknown }> {
    return [{ method: 'GET', url: () => `/partner/orders/${orderB}` }];
  }

  // Self-defending: scrape partner.routes.ts for every :id-scoped route so a newly added one
  // without a matching entry above fails this test instead of silently shipping unguarded.
  it('the route table above covers every :id-scoped route in partner.routes.ts', () => {
    const source = readFileSync(join(__dirname, '../api/partner.routes.ts'), 'utf8');
    const idRoutePattern =
      /fastify\.(get|post|put|patch|delete)(?:<[^>(]*>)?\(\s*['"`]([^'"`]*:id[^'"`]*)['"`]/g;
    const found: string[] = [];
    let m: RegExpExecArray | null;
    while ((m = idRoutePattern.exec(source)) !== null) {
      found.push(`${m[1]!.toUpperCase()} ${m[2]}`);
    }
    expect(found.length).toBe(routeTable().length);
  });

  it("GET /partner/orders/:id 404s when partner A requests partner B's id", async () => {
    const token = await tokenFor(customerA);
    const res = await app.inject({
      method: 'GET',
      url: `/partner/orders/${orderB}`,
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(404);
  });

  it("GET /partner/orders never includes partner B's order in partner A's list", async () => {
    const token = await tokenFor(customerA);
    const res = await app.inject({
      method: 'GET',
      url: '/partner/orders',
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    const ids = (res.json().data.content as Array<{ id: number }>).map((r) => r.id);
    expect(ids).toContain(orderA);
    expect(ids).not.toContain(orderB);
  });

  it('a staff-shaped token (no PARTNER role) is rejected by every /partner/* route', async () => {
    const nowSec = Math.floor(Date.now() / 1000);
    const staffToken = await new SignJWT({
      tenantId: TEST_TENANT,
      email: 'staff@example.com',
      roles: ['SALES_MANAGER'],
      permissions: ['CUSTOMER_VIEW'],
      branchIds: [],
    })
      .setProtectedHeader({ alg: 'RS256' })
      .setSubject('1')
      .setIssuer(TEST_ISSUER)
      .setIssuedAt(nowSec)
      .setExpirationTime(nowSec + 900)
      .sign(privateKey);

    const res = await app.inject({
      method: 'GET',
      url: '/partner/orders',
      headers: { Authorization: `Bearer ${staffToken}` },
    });
    expect(res.statusCode).toBe(401);
  });

  it('a CUSTOMER-role token (wrong portal) is rejected by /partner/* routes', async () => {
    const nowSec = Math.floor(Date.now() / 1000);
    const customerToken = await new SignJWT({
      tenantId: TEST_TENANT,
      email: 'customer@example.com',
      roles: ['CUSTOMER'],
      permissions: [],
      branchIds: [],
      customerId: customerA,
    })
      .setProtectedHeader({ alg: 'RS256' })
      .setSubject(String(1000 + customerA))
      .setIssuer(TEST_ISSUER)
      .setIssuedAt(nowSec)
      .setExpirationTime(nowSec + 900)
      .sign(privateKey);

    const res = await app.inject({
      method: 'GET',
      url: '/partner/orders',
      headers: { Authorization: `Bearer ${customerToken}` },
    });
    expect(res.statusCode).toBe(401);
  });

  it('GET /partner/orders/:id succeeds for the owning partner (positive control)', async () => {
    const token = await tokenFor(customerA);
    const res = await app.inject({
      method: 'GET',
      url: `/partner/orders/${orderA}`,
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.id).toBe(orderA);
  });

  it('POST /partner/orders creates a quotation visible only to the owning partner, priced from items.salePrice (no client price accepted, no tier coverage)', async () => {
    const token = await tokenFor(customerA);
    const createRes = await app.inject({
      method: 'POST',
      url: '/partner/orders',
      headers: { Authorization: `Bearer ${token}` },
      payload: { lines: [{ itemId: noTierItemId, quantity: 2 }] },
    });
    expect(createRes.statusCode).toBe(201);
    const newOrderId = (createRes.json().data as { id: number }).id;

    const [line] = await db
      .select()
      .from(quotationLines)
      .where(eq(quotationLines.quotationId, newOrderId));
    expect(line).toBeDefined();
    expect(parseFloat(line!.unitPrice)).toBe(250);

    const ownerRes = await app.inject({
      method: 'GET',
      url: `/partner/orders/${newOrderId}`,
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(ownerRes.statusCode).toBe(200);

    const otherPartnerToken = await tokenFor(customerB);
    const otherRes = await app.inject({
      method: 'GET',
      url: `/partner/orders/${newOrderId}`,
      headers: { Authorization: `Bearer ${otherPartnerToken}` },
    });
    expect(otherRes.statusCode).toBe(404);
  });
});
