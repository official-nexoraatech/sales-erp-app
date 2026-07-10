import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createDatabaseClient } from '@erp/db';
import {
  customers, invoices, branches, warehouses, payments, paymentAllocations,
  featureFlags, loyaltyTransactions, posHeldSales, campaigns, campaignRecipients,
} from '@erp/db';
import { eq, and } from 'drizzle-orm';
import type { PlatformContext } from '@erp/sdk';
import { PaymentService } from '../domain/PaymentService.js';
import { LoyaltyService } from '../domain/LoyaltyService.js';
import { CampaignService, optOutCondition } from '../domain/CampaignService.js';

describe('optOutCondition', () => {
  it('maps each marketing channel to a distinct opt-out condition, and IN_APP to none', () => {
    const sms = optOutCondition('SMS');
    const whatsapp = optOutCondition('WHATSAPP');
    const email = optOutCondition('EMAIL');
    const inApp = optOutCondition('IN_APP');

    expect(sms).toBeDefined();
    expect(whatsapp).toBeDefined();
    expect(email).toBeDefined();
    expect(inApp).toBeUndefined();

    // Each channel's condition targets a different column — they must not be the same SQL object.
    expect(sms).not.toBe(whatsapp);
    expect(whatsapp).not.toBe(email);
  });
});

const DB_URL = process.env['DATABASE_URL'];

describe.skipIf(!DB_URL)('POS completion — integration', () => {
  let db: ReturnType<typeof createDatabaseClient>;
  const TEST_TENANT = 900_301 + Math.floor(Math.random() * 1000);
  let branchId: number;
  let warehouseId: number;

  beforeAll(async () => {
    db = createDatabaseClient({ url: DB_URL! });

    const [branch] = await db
      .insert(branches)
      .values({ tenantId: TEST_TENANT, name: 'Test HO', code: 'HO', isHeadOffice: true, isActive: true, createdBy: 1 })
      .returning();
    branchId = branch!.id;

    const [warehouse] = await db
      .insert(warehouses)
      .values({ tenantId: TEST_TENANT, branchId, name: 'Test WH', code: 'WH1', isActive: true, createdBy: 1 })
      .returning();
    warehouseId = warehouse!.id;

    await db.insert(featureFlags).values({ tenantId: TEST_TENANT, flagKey: 'sales.loyalty.enabled', enabled: true });
  });

  afterAll(async () => {
    await db.delete(campaignRecipients).where(eq(campaignRecipients.tenantId, TEST_TENANT));
    await db.delete(campaigns).where(eq(campaigns.tenantId, TEST_TENANT));
    await db.delete(posHeldSales).where(eq(posHeldSales.tenantId, TEST_TENANT));
    await db.delete(loyaltyTransactions).where(eq(loyaltyTransactions.tenantId, TEST_TENANT));
    await db.delete(paymentAllocations).where(eq(paymentAllocations.tenantId, TEST_TENANT));
    await db.delete(payments).where(eq(payments.tenantId, TEST_TENANT));
    await db.delete(invoices).where(eq(invoices.tenantId, TEST_TENANT));
    await db.delete(customers).where(eq(customers.tenantId, TEST_TENANT));
    await db.delete(featureFlags).where(eq(featureFlags.tenantId, TEST_TENANT));
    await db.delete(warehouses).where(eq(warehouses.tenantId, TEST_TENANT));
    await db.delete(branches).where(eq(branches.tenantId, TEST_TENANT));
  });

  it('recording and allocating a POS payment reduces the invoice balance to zero — the core POS payment-recording fix', async () => {
    const [customer] = await db
      .insert(customers)
      .values({ tenantId: TEST_TENANT, branchId, displayName: 'POS Payment Customer', phone: '9000000020', creditLimit: '0', openingBalance: '0', createdBy: 1 })
      .returning();

    const [invoice] = await db
      .insert(invoices)
      .values({
        tenantId: TEST_TENANT, branchId, warehouseId, customerId: customer!.id,
        status: 'CONFIRMED', placeOfSupply: '27',
        invoiceDate: new Date(), dueDate: new Date(),
        grandTotal: '1000.00', balanceDue: '1000.00', createdBy: 1,
      })
      .returning();

    const paymentSvc = new PaymentService(db);
    const paymentId = await paymentSvc.create({
      tenantId: TEST_TENANT, branchId, customerId: customer!.id,
      paymentNumber: `PAY-TEST-${invoice!.id}`, paymentDate: new Date(),
      paymentMode: 'CASH', amount: 1000, createdBy: 1,
    });
    await paymentSvc.allocate(paymentId, TEST_TENANT, [{ invoiceId: invoice!.id, amount: 1000 }], 1);

    const [updated] = await db.select().from(invoices).where(eq(invoices.id, invoice!.id));
    expect(parseFloat(updated!.balanceDue)).toBe(0);
    expect(updated!.status).toBe('PAID');
  });

  it('splitting a payment across two modes (e.g. cash + card) still fully allocates the invoice', async () => {
    const [customer] = await db
      .insert(customers)
      .values({ tenantId: TEST_TENANT, branchId, displayName: 'Split Payment Customer', phone: '9000000021', creditLimit: '0', openingBalance: '0', createdBy: 1 })
      .returning();

    const [invoice] = await db
      .insert(invoices)
      .values({
        tenantId: TEST_TENANT, branchId, warehouseId, customerId: customer!.id,
        status: 'CONFIRMED', placeOfSupply: '27',
        invoiceDate: new Date(), dueDate: new Date(),
        grandTotal: '800.00', balanceDue: '800.00', createdBy: 1,
      })
      .returning();

    const paymentSvc = new PaymentService(db);
    for (const [mode, amount] of [['CASH', 300], ['CARD', 500]] as const) {
      const paymentId = await paymentSvc.create({
        tenantId: TEST_TENANT, branchId, customerId: customer!.id,
        paymentNumber: `PAY-TEST-SPLIT-${invoice!.id}-${mode}`, paymentDate: new Date(),
        paymentMode: mode, amount, createdBy: 1,
      });
      await paymentSvc.allocate(paymentId, TEST_TENANT, [{ invoiceId: invoice!.id, amount }], 1);
    }

    const [updated] = await db.select().from(invoices).where(eq(invoices.id, invoice!.id));
    expect(parseFloat(updated!.balanceDue)).toBe(0);
    expect(updated!.status).toBe('PAID');
  });

  it('earns loyalty points on a sale, then redeems them, updating the customer balance and ledger', async () => {
    const [customer] = await db
      .insert(customers)
      .values({ tenantId: TEST_TENANT, branchId, displayName: 'Loyalty Customer', phone: '9000000022', creditLimit: '0', openingBalance: '0', createdBy: 1 })
      .returning();

    const loyaltySvc = new LoyaltyService(db);
    const earned = await loyaltySvc.earnPoints(TEST_TENANT, customer!.id, 1000, 'POS_SALE', 1, 1);
    expect(earned).toBe(10); // ₹100 = 1 point, per LoyaltyService's DEFAULT_EARN_RATE

    const [afterEarn] = await db.select({ loyaltyPoints: customers.loyaltyPoints }).from(customers).where(eq(customers.id, customer!.id));
    expect(afterEarn!.loyaltyPoints).toBe(10);

    const redemptionValue = await loyaltySvc.redeemPoints(TEST_TENANT, customer!.id, 4, 'POS_SALE', 2, 1);
    expect(redemptionValue).toBe(2); // 4 points x ₹0.50/point

    const [afterRedeem] = await db.select({ loyaltyPoints: customers.loyaltyPoints }).from(customers).where(eq(customers.id, customer!.id));
    expect(afterRedeem!.loyaltyPoints).toBe(6);

    const ledger = await db.select().from(loyaltyTransactions).where(eq(loyaltyTransactions.customerId, customer!.id));
    expect(ledger.map((l) => l.type).sort()).toEqual(['EARN', 'REDEEM']);
  });

  it('rejects redeeming more points than the customer has', async () => {
    const [customer] = await db
      .insert(customers)
      .values({ tenantId: TEST_TENANT, branchId, displayName: 'Insufficient Points Customer', phone: '9000000023', creditLimit: '0', openingBalance: '0', createdBy: 1, loyaltyPoints: 5 })
      .returning();

    const loyaltySvc = new LoyaltyService(db);
    await expect(loyaltySvc.redeemPoints(TEST_TENANT, customer!.id, 100, 'POS_SALE', 1, 1)).rejects.toThrow('Only 5 points available');
  });

  it('a campaign targeting explicit customer ids excludes a customer opted out of that channel', async () => {
    const [optedIn] = await db
      .insert(customers)
      .values({ tenantId: TEST_TENANT, branchId, displayName: 'Opted In Customer', phone: '9000000024', creditLimit: '0', openingBalance: '0', createdBy: 1 })
      .returning();
    const [optedOut] = await db
      .insert(customers)
      .values({ tenantId: TEST_TENANT, branchId, displayName: 'Opted Out Customer', phone: '9000000025', creditLimit: '0', openingBalance: '0', createdBy: 1, optOutSms: true })
      .returning();

    const [campaign] = await db
      .insert(campaigns)
      .values({
        tenantId: TEST_TENANT, name: 'Test SMS Campaign', channel: 'SMS',
        customerIds: [optedIn!.id, optedOut!.id], messageTemplate: 'Hi {{customerName}}', createdBy: 1,
      })
      .returning();

    const ctx = { db: { raw: db }, tenant: { tenantId: TEST_TENANT } } as unknown as PlatformContext;
    const recipients = await CampaignService.resolveRecipients(ctx, campaign!);

    expect(recipients.map((r) => r.id)).toContain(optedIn!.id);
    expect(recipients.map((r) => r.id)).not.toContain(optedOut!.id);
  });

  it('hold and resume round-trip preserves the parked cart', async () => {
    const cart = [{ itemId: 1, itemName: 'Test Shirt', quantity: 2, unitPrice: 500, gstRate: 5, discountPct: 0, lineTotal: 1050 }];

    const [held] = await db
      .insert(posHeldSales)
      .values({ tenantId: TEST_TENANT, sessionId: 1, cart, createdBy: 1 })
      .returning();

    const [reloaded] = await db.select().from(posHeldSales).where(and(eq(posHeldSales.id, held!.id), eq(posHeldSales.tenantId, TEST_TENANT)));
    expect(reloaded!.cart).toEqual(cart);

    await db.delete(posHeldSales).where(eq(posHeldSales.id, held!.id));
    const [afterDelete] = await db.select().from(posHeldSales).where(eq(posHeldSales.id, held!.id));
    expect(afterDelete).toBeUndefined();
  });
});
