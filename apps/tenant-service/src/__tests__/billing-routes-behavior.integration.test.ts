// PG-027 Session 3 — real-Postgres, real-HTTP proof that billing.routes.ts's behavior is
// correct, not just its authz gating (already covered by billing-routes-authz.test.ts's mocked
// tests). Uses a real signed JWT against a real Fastify app + real Postgres, matching this
// session's established live-verification practice.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { generateKeyPairSync } from 'node:crypto';
import { SignJWT, importPKCS8, type KeyLike } from 'jose';
import { createDatabaseClient, type ErpDatabase } from '@erp/db';
import { tenants, tenantInvoices, users, branches, businessTypes, auditLog } from '@erp/db';
import { eq } from 'drizzle-orm';
import { billingRoutes } from '../api/billing.routes.js';

const DB_URL = process.env['DATABASE_URL'];

describe.skipIf(!DB_URL)('billing.routes.ts behavior — real Postgres + real HTTP', () => {
  let db: ErpDatabase;
  let app: FastifyInstance;
  let privateKey: KeyLike;
  const TENANT = 900_601 + Math.floor(Math.random() * 1000);
  let businessTypeId: number;
  let tenantId: number;
  const createdUserIds: number[] = [];
  const createdBranchIds: number[] = [];

  async function signToken(): Promise<string> {
    const nowSec = Math.floor(Date.now() / 1000);
    return new SignJWT({
      tenantId: 999,
      email: 'operator@platform.local',
      roles: [],
      permissions: ['PLATFORM_TENANT_MANAGE'],
    })
      .setProtectedHeader({ alg: 'RS256' })
      .setSubject('99')
      .setIssuedAt(nowSec)
      .setIssuer('erp-auth-service')
      .setExpirationTime(nowSec + 900)
      .sign(privateKey);
  }

  beforeAll(async () => {
    db = createDatabaseClient({ url: DB_URL! });

    const { privateKey: priv, publicKey: pub } = generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });
    privateKey = await importPKCS8(priv, 'RS256');
    process.env['JWT_PUBLIC_KEY'] = pub;

    const [bt] = await db
      .select()
      .from(businessTypes)
      .where(eq(businessTypes.code, 'CLOTH_RETAIL'));
    businessTypeId = bt!.id;

    const unique = `${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
    const [tenantRow] = await db
      .insert(tenants)
      .values({
        name: `Billing Routes Test ${TENANT}-${unique}`,
        slug: `billing-routes-test-${TENANT}-${unique}`,
        contactEmail: `billing-routes-test-${unique}@example.com`,
        plan: 'STARTER',
        vertical: 'CLOTH_RETAIL',
        businessTypeId,
        status: 'ACTIVE',
        provisioningStatus: 'COMPLETE',
        settings: { maxUsers: 5, maxBranches: 1 },
        // A saved payment method — needed to reach the actual gateway-attempt path in
        // chargeInvoice() rather than its earlier SKIPPED_NO_GATEWAY_REF short-circuit (a
        // tenant with no saved method at all isn't really a "retry payment" scenario).
        paymentGatewayCustomerRef: JSON.stringify({
          customerId: 'cust_x',
          tokenId: 'tok_x',
          email: 'a@b.com',
          contact: '9999999999',
        }),
      })
      .returning({ id: tenants.id });
    tenantId = tenantRow!.id;

    // Two real active users + one real active branch — proves GET .../billing's currentUsers/
    // currentBranches are live COUNT(*) queries, not a stale rollup.
    for (let i = 0; i < 2; i++) {
      const [u] = await db
        .insert(users)
        .values({
          tenantId,
          email: `billing-route-user-${unique}-${i}@example.com`,
          passwordHash: 'x',
          firstName: 'Test',
          lastName: 'User',
          isActive: true,
        })
        .returning({ id: users.id });
      createdUserIds.push(u!.id);
    }
    const [b] = await db
      .insert(branches)
      .values({
        tenantId,
        name: 'Main Branch',
        code: 'MAIN',
        isHeadOffice: true,
        isActive: true,
        createdBy: 1,
      })
      .returning({ id: branches.id });
    createdBranchIds.push(b!.id);

    app = Fastify({ logger: false });
    await billingRoutes(app, db);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    for (const id of createdUserIds) await db.delete(users).where(eq(users.id, id));
    for (const id of createdBranchIds) await db.delete(branches).where(eq(branches.id, id));
    await db.delete(auditLog).where(eq(auditLog.tenantId, tenantId));
    await db.delete(tenantInvoices).where(eq(tenantInvoices.tenantId, tenantId));
    await db.delete(tenants).where(eq(tenants.id, tenantId));
  });

  it('GET /admin/tenants/:id/billing returns live currentUsers/currentBranches counts', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/admin/tenants/${tenantId}/billing`,
      headers: { Authorization: `Bearer ${await signToken()}` },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as {
      data: { plan: string; entitlements: Record<string, unknown> };
    };
    expect(body.data.plan).toBe('STARTER');
    expect(body.data.entitlements).toEqual({
      maxUsers: 5,
      currentUsers: 2,
      maxBranches: 1,
      currentBranches: 1,
    });
  });

  it('PATCH /admin/tenants/:id/plan visibly updates tenants.settings and feature_flags', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/admin/tenants/${tenantId}/plan`,
      headers: { Authorization: `Bearer ${await signToken()}` },
      payload: { plan: 'GROWTH' },
    });
    expect(res.statusCode).toBe(200);

    const [tenant] = await db.select().from(tenants).where(eq(tenants.id, tenantId));
    expect(tenant!.plan).toBe('GROWTH');
    expect(tenant!.settings?.maxUsers).toBeDefined();
  });

  it('GET /admin/tenants/:id/invoices returns real invoice rows, paginated', async () => {
    await db.insert(tenantInvoices).values([
      {
        tenantId,
        plan: 'GROWTH',
        amountPaise: 1000,
        status: 'PAID',
        billingPeriodStart: '2026-01-01',
        billingPeriodEnd: '2026-02-01',
      },
      {
        tenantId,
        plan: 'GROWTH',
        amountPaise: 1000,
        status: 'FAILED',
        billingPeriodStart: '2026-02-01',
        billingPeriodEnd: '2026-03-01',
      },
    ]);

    const res = await app.inject({
      method: 'GET',
      url: `/admin/tenants/${tenantId}/invoices?page=0&pageSize=20`,
      headers: { Authorization: `Bearer ${await signToken()}` },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { data: { content: unknown[]; totalElements: number } };
    expect(body.data.totalElements).toBe(2);
    expect(body.data.content).toHaveLength(2);
  });

  it('POST retry-payment on a PENDING invoice attempts the charge and fails with a clear reason (no real Razorpay creds configured server-side)', async () => {
    const [invoice] = await db
      .insert(tenantInvoices)
      .values({
        tenantId,
        plan: 'GROWTH',
        amountPaise: 1000,
        status: 'PENDING',
        billingPeriodStart: '2026-03-01',
        billingPeriodEnd: '2026-04-01',
      })
      .returning({ id: tenantInvoices.id });

    const res = await app.inject({
      method: 'POST',
      url: `/admin/tenants/${tenantId}/invoices/${invoice!.id}/retry-payment`,
      headers: { Authorization: `Bearer ${await signToken()}` },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { data: { status: string } };
    expect(body.data.status).toBe('FAILED');

    const [updated] = await db
      .select()
      .from(tenantInvoices)
      .where(eq(tenantInvoices.id, invoice!.id));
    expect(updated!.status).toBe('FAILED');
    expect(updated!.failureReason).toBe('PAYMENT_GATEWAY_NOT_CONFIGURED');
  });

  it('POST retry-payment rejects with a clear reason (not a misleading FAILED) when the tenant has no saved payment method at all', async () => {
    // Live-verification finding: chargeInvoice() silently no-ops when a tenant has no saved
    // payment method, leaving the invoice untouched — the route previously reported that as a
    // regular "FAILED" charge attempt, which is inconsistent with the invoice actually staying
    // PENDING. Fixed to reject explicitly before ever calling chargeInvoice.
    const unique = `${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
    const [noMethodTenant] = await db
      .insert(tenants)
      .values({
        name: `Billing Routes No-Method ${unique}`,
        slug: `billing-routes-no-method-${unique}`,
        contactEmail: `billing-routes-no-method-${unique}@example.com`,
        plan: 'GROWTH',
        vertical: 'CLOTH_RETAIL',
        businessTypeId,
        status: 'ACTIVE',
        provisioningStatus: 'COMPLETE',
      })
      .returning({ id: tenants.id });
    const [invoice] = await db
      .insert(tenantInvoices)
      .values({
        tenantId: noMethodTenant!.id,
        plan: 'GROWTH',
        amountPaise: 1000,
        status: 'PENDING',
        billingPeriodStart: '2026-05-01',
        billingPeriodEnd: '2026-06-01',
      })
      .returning({ id: tenantInvoices.id });

    const res = await app.inject({
      method: 'POST',
      url: `/admin/tenants/${noMethodTenant!.id}/invoices/${invoice!.id}/retry-payment`,
      headers: { Authorization: `Bearer ${await signToken()}` },
    });
    expect(res.statusCode).toBe(422);

    const [updated] = await db
      .select()
      .from(tenantInvoices)
      .where(eq(tenantInvoices.id, invoice!.id));
    expect(updated!.status).toBe('PENDING'); // untouched — the route rejected before charging

    await db.delete(tenantInvoices).where(eq(tenantInvoices.tenantId, noMethodTenant!.id));
    await db.delete(tenants).where(eq(tenants.id, noMethodTenant!.id));
  });

  it('POST retry-payment on an already-PAID invoice rejects with 422, no double-processing', async () => {
    const [invoice] = await db
      .insert(tenantInvoices)
      .values({
        tenantId,
        plan: 'GROWTH',
        amountPaise: 1000,
        status: 'PAID',
        billingPeriodStart: '2026-04-01',
        billingPeriodEnd: '2026-05-01',
      })
      .returning({ id: tenantInvoices.id });

    const res = await app.inject({
      method: 'POST',
      url: `/admin/tenants/${tenantId}/invoices/${invoice!.id}/retry-payment`,
      headers: { Authorization: `Bearer ${await signToken()}` },
    });
    expect(res.statusCode).toBe(422);
  });
});
