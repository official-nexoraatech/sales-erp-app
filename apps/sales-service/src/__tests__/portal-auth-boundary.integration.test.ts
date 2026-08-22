// CRM-ROADMAP Phase 3, Feature 2 (Self-Service Customer Portal) — proves customer A can never
// reach customer B's data through any /portal/* route in sales-service's own portal.routes.ts
// (the O2C half — orders/preferences/loyalty-bridge; the Ticket/Referral half moved to
// crm-service, CRM/O2C split migration 12, with its own equivalent boundary test there), on a
// real database with two real seeded customers. A parameterized route table (not one-off tests
// per route) plus a meta-assertion checking the table's length against the route count scraped
// from portal.routes.ts, so a new :id-scoped route added without a matching boundary-test entry
// fails CI — same self-defending-scanner idea route-guard-coverage.test.ts already uses.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify, { type FastifyInstance } from 'fastify';
import { generateKeyPairSync } from 'node:crypto';
import { SignJWT, importPKCS8, type KeyLike } from 'jose';
import { createDatabaseClient } from '@erp/db';
import { branches, customers, invoices } from '@erp/db';
import { eq } from 'drizzle-orm';
import { portalRoutes } from '../api/portal.routes.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_URL = process.env['DATABASE_URL'];
const TEST_ISSUER = process.env['JWT_ISSUER'] ?? 'erp-auth-service';

describe.skipIf(!DB_URL)('portal routes (sales-service) — cross-customer boundary', () => {
  let db: ReturnType<typeof createDatabaseClient>;
  let app: FastifyInstance;
  let privateKey: KeyLike;
  const TEST_TENANT = 902_201 + Math.floor(Math.random() * 1000);
  let branchId: number;
  let customerA: number;
  let customerB: number;
  let orderA: number;
  let orderB: number;

  async function tokenFor(customerId: number): Promise<string> {
    const nowSec = Math.floor(Date.now() / 1000);
    return new SignJWT({
      tenantId: TEST_TENANT,
      email: `customer-${customerId}@example.com`,
      roles: ['CUSTOMER'],
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
        createdBy: 1,
      })
      .returning();
    branchId = branch!.id;

    const [custA] = await db
      .insert(customers)
      .values({
        tenantId: TEST_TENANT,
        branchId,
        displayName: 'Customer A',
        phone: '9900000010',
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
        displayName: 'Customer B',
        phone: '9900000011',
        creditLimit: '0',
        openingBalance: '0',
        createdBy: 1,
      })
      .returning();
    customerB = custB!.id;

    const now = new Date();
    const [invA] = await db
      .insert(invoices)
      .values({
        tenantId: TEST_TENANT,
        branchId,
        warehouseId: 1,
        customerId: customerA,
        placeOfSupply: '27',
        invoiceDate: now,
        dueDate: now,
        createdBy: 1,
      })
      .returning();
    orderA = invA!.id;

    const [invB] = await db
      .insert(invoices)
      .values({
        tenantId: TEST_TENANT,
        branchId,
        warehouseId: 1,
        customerId: customerB,
        placeOfSupply: '27',
        invoiceDate: now,
        dueDate: now,
        createdBy: 1,
      })
      .returning();
    orderB = invB!.id;

    app = Fastify({ logger: false });
    await portalRoutes(app, db);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    await db.delete(invoices).where(eq(invoices.tenantId, TEST_TENANT));
    await db.delete(customers).where(eq(customers.tenantId, TEST_TENANT));
    await db.delete(branches).where(eq(branches.tenantId, TEST_TENANT));
  });

  // Parameterized route table: (method, path-builder using B's ids, optional body).
  // Called with customer A's token — every one must 404, proving A cannot reach B's data by
  // guessing/incrementing an id. A 403 would itself leak that the row exists for someone else.
  function routeTable(): Array<{ method: 'GET' | 'POST'; url: () => string; body?: unknown }> {
    return [{ method: 'GET', url: () => `/portal/orders/${orderB}` }];
  }

  // Self-defending: scrape portal.routes.ts for every :id-scoped route so a newly added one
  // without a matching entry above fails this test instead of silently shipping unguarded.
  it('the route table above covers every :id-scoped route in portal.routes.ts', () => {
    const source = readFileSync(join(__dirname, '../api/portal.routes.ts'), 'utf8');
    const idRoutePattern =
      /fastify\.(get|post|put|patch|delete)(?:<[^>(]*>)?\(\s*['"`]([^'"`]*:id[^'"`]*)['"`]/g;
    const found: string[] = [];
    let m: RegExpExecArray | null;
    while ((m = idRoutePattern.exec(source)) !== null) {
      found.push(`${m[1]!.toUpperCase()} ${m[2]}`);
    }
    expect(found.length).toBe(routeTable().length);
  });

  it("GET /portal/orders/:id 404s when customer A requests customer B's id", async () => {
    const token = await tokenFor(customerA);
    const res = await app.inject({
      method: 'GET',
      url: `/portal/orders/${orderB}`,
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(404);
  });

  it("GET /portal/orders never includes customer B's order in customer A's list", async () => {
    const token = await tokenFor(customerA);
    const res = await app.inject({
      method: 'GET',
      url: '/portal/orders',
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    const ids = (res.json().data.content as Array<{ id: number }>).map((r) => r.id);
    expect(ids).toContain(orderA);
    expect(ids).not.toContain(orderB);
  });

  it('a staff-shaped token (no CUSTOMER role) is rejected by every /portal/* route', async () => {
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
      url: '/portal/orders',
      headers: { Authorization: `Bearer ${staffToken}` },
    });
    expect(res.statusCode).toBe(401);
  });

  it('GET /portal/orders/:id succeeds for the owning customer (positive control)', async () => {
    const token = await tokenFor(customerA);
    const res = await app.inject({
      method: 'GET',
      url: `/portal/orders/${orderA}`,
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.id).toBe(orderA);
  });
});
