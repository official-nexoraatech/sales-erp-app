// CRM/O2C split — net-new focused coverage for the admin/read half of LoyaltyService
// (getBalance, listTiers/createTier/updateTier, listCatalog/createCatalogItem/updateCatalogItem,
// getExpiringPoints, expirePoints) moved here from sales-service. getExpiringPoints/expirePoints
// tests seed loyaltyTransactions directly (via db.insert) instead of going through earnPoints,
// since earnPoints isn't available in this service — same substitution pattern used for
// HealthScoringService's split in migration 4.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createDatabaseClient } from '@erp/db';
import {
  branches,
  customers,
  loyaltyTransactions,
  crmLoyaltyTiers,
  crmRedemptionCatalog,
} from '@erp/db';
import { eq, and } from 'drizzle-orm';
import { ValidationError } from '@erp/types';
import { LoyaltyService } from '../domain/LoyaltyService.js';

const DB_URL = process.env['DATABASE_URL'];

describe.skipIf(!DB_URL)('LoyaltyService (crm-service half)', () => {
  let db: ReturnType<typeof createDatabaseClient>;
  const TEST_TENANT = 903_001 + Math.floor(Math.random() * 1000);
  let branchId: number;
  let svc: LoyaltyService;

  async function makeCustomer(displayName: string, startingPoints = 0): Promise<number> {
    const [row] = await db
      .insert(customers)
      .values({
        tenantId: TEST_TENANT,
        branchId,
        displayName,
        phone: `9${Math.floor(100000000 + Math.random() * 899999999)}`,
        creditLimit: '0',
        openingBalance: '0',
        loyaltyPoints: startingPoints,
        createdBy: 1,
      })
      .returning();
    return row!.id;
  }

  beforeAll(async () => {
    db = createDatabaseClient({ url: DB_URL! });
    svc = new LoyaltyService(db);

    const [branch] = await db
      .insert(branches)
      .values({
        tenantId: TEST_TENANT,
        name: 'CRM Loyalty Test HO',
        code: 'CLHO',
        isHeadOffice: true,
        isActive: true,
        createdBy: 1,
      })
      .returning();
    branchId = branch!.id;
  });

  afterAll(async () => {
    await db.delete(crmRedemptionCatalog).where(eq(crmRedemptionCatalog.tenantId, TEST_TENANT));
    await db.delete(crmLoyaltyTiers).where(eq(crmLoyaltyTiers.tenantId, TEST_TENANT));
    await db.delete(loyaltyTransactions).where(eq(loyaltyTransactions.tenantId, TEST_TENANT));
    await db.delete(customers).where(eq(customers.tenantId, TEST_TENANT));
    await db.delete(branches).where(eq(branches.tenantId, TEST_TENANT));
  });

  describe('getBalance', () => {
    it('returns points, redeemValue, tier, and history for a customer', async () => {
      const customerId = await makeCustomer('Balance Customer', 100);
      const balance = await svc.getBalance(customerId, TEST_TENANT);
      expect(balance.points).toBe(100);
      expect(balance.redeemValue).toBe(50); // 100 * 0.5
      expect(balance.tier).toBeNull();
    });
  });

  describe('tiers', () => {
    it('createTier then listTiers/updateTier round-trip', async () => {
      const tier = await svc.createTier(TEST_TENANT, 1, {
        name: 'Bronze',
        code: `bronze-${TEST_TENANT}`,
        minLifetimePoints: 0,
      });
      expect(tier.name).toBe('Bronze');

      const tiers = await svc.listTiers(TEST_TENANT);
      expect(tiers.some((t) => t.id === tier.id)).toBe(true);

      const updated = await svc.updateTier(TEST_TENANT, tier.id, { name: 'Bronze Plus' });
      expect(updated.name).toBe('Bronze Plus');
    });

    it('createTier rejects a negative minLifetimePoints', async () => {
      await expect(
        svc.createTier(TEST_TENANT, 1, {
          name: 'Bad Tier',
          code: `bad-${TEST_TENANT}`,
          minLifetimePoints: -1,
        })
      ).rejects.toThrow(ValidationError);
    });
  });

  describe('redemption catalog', () => {
    it('createCatalogItem rejects an out-of-range DISCOUNT_PERCENT value', async () => {
      await expect(
        svc.createCatalogItem(TEST_TENANT, 1, {
          name: 'Bad Reward',
          pointsCost: 100,
          rewardType: 'DISCOUNT_PERCENT',
          rewardValue: 150,
        })
      ).rejects.toThrow(/between 0 and 100/);
    });

    it('createCatalogItem then listCatalog/updateCatalogItem round-trip', async () => {
      const item = await svc.createCatalogItem(TEST_TENANT, 1, {
        name: 'Free Shipping',
        pointsCost: 50,
        rewardType: 'DISCOUNT_AMOUNT',
        rewardValue: 20,
      });
      const items = await svc.listCatalog(TEST_TENANT);
      expect(items.some((i) => i.id === item.id)).toBe(true);

      const updated = await svc.updateCatalogItem(TEST_TENANT, item.id, { pointsCost: 60 });
      expect(updated.pointsCost).toBe(60);
    });
  });

  describe('getExpiringPoints', () => {
    it('returns customers whose points expire within the window, excluding those outside it', async () => {
      const soonCustomerId = await makeCustomer('Expiring Soon Customer');
      await db.insert(loyaltyTransactions).values({
        tenantId: TEST_TENANT,
        customerId: soonCustomerId,
        type: 'EARN',
        points: 10,
        balanceBefore: 0,
        balanceAfter: 10,
        referenceType: 'TEST',
        referenceId: 1,
        expiryDate: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000),
        createdBy: 1,
      });

      const farCustomerId = await makeCustomer('Expiring Far Customer');
      await db.insert(loyaltyTransactions).values({
        tenantId: TEST_TENANT,
        customerId: farCustomerId,
        type: 'EARN',
        points: 10,
        balanceBefore: 0,
        balanceAfter: 10,
        referenceType: 'TEST',
        referenceId: 1,
        expiryDate: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
        createdBy: 1,
      });

      const expiring = await svc.getExpiringPoints(TEST_TENANT, 30);
      const customerIds = expiring.map((e) => e.customerId);
      expect(customerIds).toContain(soonCustomerId);
      expect(customerIds).not.toContain(farCustomerId);

      const soonRow = expiring.find((e) => e.customerId === soonCustomerId);
      expect(soonRow!.expiringPoints).toBe(10);
    });
  });

  describe('expirePoints', () => {
    it('deducts an EARN transaction past its expiry and marks it processed', async () => {
      const customerId = await makeCustomer('Expire Fire Customer', 10);
      await db.insert(loyaltyTransactions).values({
        tenantId: TEST_TENANT,
        customerId,
        type: 'EARN',
        points: 10,
        balanceBefore: 0,
        balanceAfter: 10,
        referenceType: 'TEST',
        referenceId: 1,
        expiryDate: new Date(Date.now() - 1000),
        createdBy: 1,
      });

      const expiredCount = await svc.expirePoints(db);
      expect(expiredCount).toBeGreaterThanOrEqual(1);

      const [customer] = await db
        .select({ loyaltyPoints: customers.loyaltyPoints })
        .from(customers)
        .where(and(eq(customers.id, customerId), eq(customers.tenantId, TEST_TENANT)));
      expect(customer!.loyaltyPoints).toBe(0);

      // Rerunning must not double-deduct — expirePoints excludes rows already marked EXPIRE.
      const secondRun = await svc.expirePoints(db);
      const [customerAfter] = await db
        .select({ loyaltyPoints: customers.loyaltyPoints })
        .from(customers)
        .where(and(eq(customers.id, customerId), eq(customers.tenantId, TEST_TENANT)));
      expect(customerAfter!.loyaltyPoints).toBe(0);
      void secondRun;
    });
  });
});
