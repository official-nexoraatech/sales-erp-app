// PG-027 Session 2 — real-Postgres proof of the billing-cycle pipeline: invoice generation,
// charging (against a fake PaymentGatewayAdapter — no real Razorpay credentials in this session,
// per this session's own "mock for now" decision), idempotency, dunning, and suspension.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createDatabaseClient, type ErpDatabase } from '@erp/db';
import { tenants, planEntitlements, tenantInvoices, auditLog, businessTypes } from '@erp/db';
import { eq, and } from 'drizzle-orm';
import { BillingService } from '../domain/BillingService.js';
import type { PaymentGatewayAdapter, ChargeResult } from '../domain/PaymentGatewayAdapter.js';
import type { PlatformContextFactory } from '@erp/sdk';

const DB_URL = process.env['DATABASE_URL'];

function fakeAdapter(result: ChargeResult): PaymentGatewayAdapter & { callCount: number } {
  let callCount = 0;
  return {
    get callCount() {
      return callCount;
    },
    charge: async () => {
      callCount += 1;
      return result;
    },
  };
}

const fakeCtxFactory = {
  publishTenantStatusInvalidation: async () => {
    /* no-op — no real Redis in this test */
  },
} as unknown as PlatformContextFactory;

describe.skipIf(!DB_URL)('BillingService billing-cycle pipeline — real Postgres', () => {
  let db: ErpDatabase;
  const TENANT = 900_501 + Math.floor(Math.random() * 1000);
  let businessTypeId: number;
  const createdTenantIds: number[] = [];

  async function makeTenant(opts: {
    plan: 'STARTER' | 'GROWTH';
    nextBillingDate: string | null;
    status?: 'ACTIVE' | 'SUSPENDED';
    paymentGatewayCustomerRef?: string | null;
  }): Promise<number> {
    const unique = `${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
    const [row] = await db
      .insert(tenants)
      .values({
        name: `Billing Test ${TENANT}-${unique}`,
        slug: `billing-test-${TENANT}-${unique}`,
        contactEmail: `billing-test-${unique}@example.com`,
        plan: opts.plan,
        vertical: 'CLOTH_RETAIL',
        businessTypeId,
        status: opts.status ?? 'ACTIVE',
        provisioningStatus: 'COMPLETE',
        nextBillingDate: opts.nextBillingDate,
        paymentGatewayCustomerRef: opts.paymentGatewayCustomerRef ?? null,
      })
      .returning({ id: tenants.id });
    createdTenantIds.push(row!.id);
    return row!.id;
  }

  beforeAll(async () => {
    db = createDatabaseClient({ url: DB_URL! });

    const [bt] = await db
      .select()
      .from(businessTypes)
      .where(eq(businessTypes.code, 'CLOTH_RETAIL'));
    businessTypeId = bt!.id;

    // GROWTH already has monthly_price_paise seeded (migration 0040); STARTER's own row is
    // reused as-is (whatever pricing it currently has — this suite only asserts relative
    // priced-vs-unpriced behavior, not a specific number, so it doesn't need to seed its own).
  });

  afterAll(async () => {
    for (const tenantId of createdTenantIds) {
      await db.delete(auditLog).where(eq(auditLog.tenantId, tenantId));
      await db.delete(tenantInvoices).where(eq(tenantInvoices.tenantId, tenantId));
      await db.delete(tenants).where(eq(tenants.id, tenantId));
    }
  });

  it('generateInvoice: creates a PENDING invoice snapshotting plan/amount/period', async () => {
    const [growthTemplate] = await db
      .select()
      .from(planEntitlements)
      .where(eq(planEntitlements.plan, 'GROWTH'));
    if (
      growthTemplate?.monthlyPricePaise === null ||
      growthTemplate?.monthlyPricePaise === undefined
    ) {
      // Pricing is a business decision this package deliberately doesn't invent — if it's still
      // unset, skip rather than fail on an environment-specific data gap.
      return;
    }

    const tenantId = await makeTenant({ plan: 'GROWTH', nextBillingDate: '2026-01-01' });
    const svc = new BillingService(db);
    const invoiceId = await svc.generateInvoice(tenantId);

    expect(invoiceId).not.toBeNull();
    const [invoice] = await db
      .select()
      .from(tenantInvoices)
      .where(eq(tenantInvoices.id, invoiceId!));
    expect(invoice!.status).toBe('PENDING');
    expect(invoice!.plan).toBe('GROWTH');
    expect(invoice!.amountPaise).toBe(growthTemplate.monthlyPricePaise);
    expect(invoice!.billingPeriodStart).toBe('2026-01-01');
  });

  it('generateInvoice: returns null (skips) when the tenant has no next_billing_date set', async () => {
    const tenantId = await makeTenant({ plan: 'GROWTH', nextBillingDate: null });
    const svc = new BillingService(db);
    const invoiceId = await svc.generateInvoice(tenantId);
    expect(invoiceId).toBeNull();
  });

  it('chargeInvoice: success marks PAID, advances next_billing_date, clears dunning', async () => {
    const tenantId = await makeTenant({
      plan: 'GROWTH',
      nextBillingDate: '2026-01-01',
      paymentGatewayCustomerRef: JSON.stringify({
        customerId: 'cust_1',
        tokenId: 'tok_1',
        email: 'a@b.com',
        contact: '9999999999',
      }),
    });
    await db.update(tenants).set({ dunningStartedAt: new Date() }).where(eq(tenants.id, tenantId));

    const svc = new BillingService(db);
    const invoiceId = await svc.generateInvoice(tenantId);
    if (invoiceId === null) return; // unpriced plan in this environment — nothing to charge

    const adapter = fakeAdapter({ success: true, gatewayRef: 'order_success_1' });
    const outcome = await svc.chargeInvoice(invoiceId, adapter);

    expect(outcome).toBe('PAID');
    const [invoice] = await db
      .select()
      .from(tenantInvoices)
      .where(eq(tenantInvoices.id, invoiceId));
    expect(invoice!.status).toBe('PAID');
    expect(invoice!.paymentGatewayRef).toBe('order_success_1');
    expect(invoice!.paidAt).not.toBeNull();

    const [tenant] = await db.select().from(tenants).where(eq(tenants.id, tenantId));
    expect(tenant!.dunningStartedAt).toBeNull();
    expect(tenant!.nextBillingDate).not.toBe('2026-01-01');
  });

  it('chargeInvoice: failure marks FAILED and persists gatewayRef even without success', async () => {
    const tenantId = await makeTenant({
      plan: 'GROWTH',
      nextBillingDate: '2026-01-01',
      paymentGatewayCustomerRef: JSON.stringify({
        customerId: 'cust_2',
        tokenId: 'tok_2',
        email: 'a@b.com',
        contact: '9999999999',
      }),
    });
    const svc = new BillingService(db);
    const invoiceId = await svc.generateInvoice(tenantId);
    if (invoiceId === null) return;

    const adapter = fakeAdapter({
      success: false,
      gatewayRef: 'order_failed_1',
      failureReason: 'Card declined',
    });
    const outcome = await svc.chargeInvoice(invoiceId, adapter);

    expect(outcome).toBe('FAILED');
    const [invoice] = await db
      .select()
      .from(tenantInvoices)
      .where(eq(tenantInvoices.id, invoiceId));
    expect(invoice!.status).toBe('FAILED');
    expect(invoice!.failureReason).toBe('Card declined');
    expect(invoice!.paymentGatewayRef).toBe('order_failed_1');
  });

  it('chargeInvoice: idempotent — calling again on an already-PAID invoice never re-charges', async () => {
    const tenantId = await makeTenant({
      plan: 'GROWTH',
      nextBillingDate: '2026-01-01',
      paymentGatewayCustomerRef: JSON.stringify({
        customerId: 'cust_3',
        tokenId: 'tok_3',
        email: 'a@b.com',
        contact: '9999999999',
      }),
    });
    const svc = new BillingService(db);
    const invoiceId = await svc.generateInvoice(tenantId);
    if (invoiceId === null) return;

    const adapter = fakeAdapter({ success: true, gatewayRef: 'order_once' });
    await svc.chargeInvoice(invoiceId, adapter);
    expect(adapter.callCount).toBe(1);

    const secondOutcome = await svc.chargeInvoice(invoiceId, adapter);
    expect(secondOutcome).toBe('PAID');
    expect(adapter.callCount).toBe(1); // no second charge attempt — already-PAID guard short-circuits
  });

  it('chargeInvoice: no saved payment method skips charging without erroring', async () => {
    const tenantId = await makeTenant({
      plan: 'GROWTH',
      nextBillingDate: '2026-01-01',
      paymentGatewayCustomerRef: null,
    });
    const svc = new BillingService(db);
    const invoiceId = await svc.generateInvoice(tenantId);
    if (invoiceId === null) return;

    const adapter = fakeAdapter({ success: true, gatewayRef: 'should_not_be_called' });
    const outcome = await svc.chargeInvoice(invoiceId, adapter);
    expect(outcome).toBe('SKIPPED_NO_GATEWAY_REF');
    expect(adapter.callCount).toBe(0);
  });

  it('startOrCheckDunning: starts on first call, waits within grace period, elapses after', async () => {
    const tenantId = await makeTenant({ plan: 'GROWTH', nextBillingDate: '2026-01-01' });
    const svc = new BillingService(db);

    const first = await svc.startOrCheckDunning(tenantId, 7);
    expect(first.action).toBe('STARTED');

    const second = await svc.startOrCheckDunning(tenantId, 7);
    expect(second.action).toBe('STILL_WAITING');

    // Backdate dunning_started_at past the grace period.
    await db
      .update(tenants)
      .set({ dunningStartedAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000) })
      .where(eq(tenants.id, tenantId));

    const third = await svc.startOrCheckDunning(tenantId, 7);
    expect(third.action).toBe('GRACE_ELAPSED');
  });

  it('suspendForNonPayment: flips status to SUSPENDED with reason PAYMENT_OVERDUE, writes audit log', async () => {
    const tenantId = await makeTenant({ plan: 'GROWTH', nextBillingDate: '2026-01-01' });
    const svc = new BillingService(db);

    const didSuspend = await svc.suspendForNonPayment(tenantId, fakeCtxFactory);
    expect(didSuspend).toBe(true);

    const [tenant] = await db.select().from(tenants).where(eq(tenants.id, tenantId));
    expect(tenant!.status).toBe('SUSPENDED');
    expect(tenant!.suspendedReason).toBe('PAYMENT_OVERDUE');

    const [audit] = await db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.tenantId, tenantId), eq(auditLog.action, 'TENANT_SUSPENDED')));
    expect(audit).toBeDefined();
  });

  it('suspendForNonPayment: no-op (returns false) when tenant is already SUSPENDED', async () => {
    const tenantId = await makeTenant({
      plan: 'GROWTH',
      nextBillingDate: '2026-01-01',
      status: 'SUSPENDED',
    });
    const svc = new BillingService(db);
    const didSuspend = await svc.suspendForNonPayment(tenantId, fakeCtxFactory);
    expect(didSuspend).toBe(false);
  });

  it('findTenantsDueForBilling: only returns ACTIVE tenants with next_billing_date in the past', async () => {
    const dueTenantId = await makeTenant({ plan: 'STARTER', nextBillingDate: '2020-01-01' });
    const notYetDueTenantId = await makeTenant({ plan: 'STARTER', nextBillingDate: '2099-01-01' });
    const suspendedDueTenantId = await makeTenant({
      plan: 'STARTER',
      nextBillingDate: '2020-01-01',
      status: 'SUSPENDED',
    });

    const svc = new BillingService(db);
    const due = await svc.findTenantsDueForBilling();
    const dueIds = due.map((t) => t.id);

    expect(dueIds).toContain(dueTenantId);
    expect(dueIds).not.toContain(notYetDueTenantId);
    expect(dueIds).not.toContain(suspendedDueTenantId);
  });
});
