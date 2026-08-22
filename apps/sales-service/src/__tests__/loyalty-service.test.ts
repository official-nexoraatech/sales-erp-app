// CRM-ROADMAP Phase 2, Feature 3 (Loyalty & Rewards — Tiering Layer). DB-backed integration
// tests only — every method here touches Postgres. Skipped without DATABASE_URL, matching
// pos-completion.test.ts's own convention (including its exact featureFlags-seeding fixture).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createDatabaseClient } from '@erp/db';
import {
  branches,
  customers,
  featureFlags,
  loyaltyTransactions,
  crmLoyaltyTiers,
  crmRedemptionCatalog,
  crmLoyaltyRedemptions,
} from '@erp/db';
import { eq, and } from 'drizzle-orm';
import { BusinessError } from '@erp/types';
import { LoyaltyService } from '../domain/LoyaltyService.js';

const DB_URL = process.env['DATABASE_URL'];

describe.skipIf(!DB_URL)('LoyaltyService — integration (CRM-ROADMAP Phase 2, Feature 3)', () => {
  let db: ReturnType<typeof createDatabaseClient>;
  const TEST_TENANT = 900_701 + Math.floor(Math.random() * 1000);
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

  // Tier evaluation (evaluateTier, stays in sales-service) writes customers.loyaltyTierId
  // directly — this reads that back via a raw join instead of the now-moved getBalance.
  async function getTierName(customerId: number): Promise<string | null> {
    const [row] = await db
      .select({ tierName: crmLoyaltyTiers.name })
      .from(customers)
      .leftJoin(crmLoyaltyTiers, eq(crmLoyaltyTiers.id, customers.loyaltyTierId))
      .where(and(eq(customers.id, customerId), eq(customers.tenantId, TEST_TENANT)));
    return row?.tierName ?? null;
  }

  beforeAll(async () => {
    db = createDatabaseClient({ url: DB_URL! });
    svc = new LoyaltyService(db);

    const [branch] = await db
      .insert(branches)
      .values({
        tenantId: TEST_TENANT,
        name: 'Loyalty Test HO',
        code: 'LHO',
        isHeadOffice: true,
        isActive: true,
        createdBy: 1,
      })
      .returning();
    branchId = branch!.id;

    await db
      .insert(featureFlags)
      .values({ tenantId: TEST_TENANT, flagKey: 'sales.loyalty.enabled', enabled: true });
  });

  afterAll(async () => {
    await db.delete(crmLoyaltyRedemptions).where(eq(crmLoyaltyRedemptions.tenantId, TEST_TENANT));
    await db.delete(crmRedemptionCatalog).where(eq(crmRedemptionCatalog.tenantId, TEST_TENANT));
    await db.delete(crmLoyaltyTiers).where(eq(crmLoyaltyTiers.tenantId, TEST_TENANT));
    await db.delete(loyaltyTransactions).where(eq(loyaltyTransactions.tenantId, TEST_TENANT));
    await db.delete(customers).where(eq(customers.tenantId, TEST_TENANT));
    await db.delete(featureFlags).where(eq(featureFlags.tenantId, TEST_TENANT));
    await db.delete(branches).where(eq(branches.tenantId, TEST_TENANT));
  });

  describe("redeemPoints — concurrency (critical path per this feature's own DoD)", () => {
    it('concurrent redemptions: exactly 50 of 100 one-point requests succeed from a 50-point balance, never negative', async () => {
      const customerId = await makeCustomer('Loyalty Concurrency Customer', 50);

      const tasks = Array.from({ length: 100 }, () =>
        svc.redeemPoints(TEST_TENANT, customerId, 1, 'TEST', 1, 1)
      );
      const results = await Promise.allSettled(tasks);
      const succeeded = results.filter((r) => r.status === 'fulfilled');
      const failed = results.filter((r) => r.status === 'rejected');

      expect(succeeded).toHaveLength(50);
      expect(failed).toHaveLength(50);
      for (const f of failed) {
        if (f.status === 'rejected') expect(f.reason).toBeInstanceOf(BusinessError);
      }

      const [final] = await db
        .select({ loyaltyPoints: customers.loyaltyPoints })
        .from(customers)
        .where(and(eq(customers.id, customerId), eq(customers.tenantId, TEST_TENANT)));
      expect(final!.loyaltyPoints).toBe(0);
    });
  });

  describe('earnPoints', () => {
    it('sets a non-null expiry_date on the EARN transaction (the pipeline that never fired before this fix)', async () => {
      const customerId = await makeCustomer('Loyalty Expiry Set Customer');
      await svc.earnPoints(TEST_TENANT, customerId, 1000, 'TEST', 1, 1);

      const [txn] = await db
        .select()
        .from(loyaltyTransactions)
        .where(
          and(
            eq(loyaltyTransactions.customerId, customerId),
            eq(loyaltyTransactions.tenantId, TEST_TENANT),
            eq(loyaltyTransactions.type, 'EARN')
          )
        );
      expect(txn!.expiryDate).not.toBeNull();
      expect(new Date(txn!.expiryDate!).getTime()).toBeGreaterThan(Date.now());
    });
  });

  // expirePoints/getExpiringPoints moved to crm-service (CRM/O2C split) — covered there by
  // apps/crm-service/src/__tests__/loyalty-service.test.ts.

  describe('tier evaluation — upgrade-only, never demoted', () => {
    it('assigns a tier once lifetime earned crosses its threshold, and upgrades further on a higher threshold', async () => {
      await db.insert(crmLoyaltyTiers).values([
        {
          tenantId: TEST_TENANT,
          name: 'Silver',
          code: `silver-${TEST_TENANT}`,
          minLifetimePoints: 5,
          createdBy: 1,
        },
        {
          tenantId: TEST_TENANT,
          name: 'Gold',
          code: `gold-${TEST_TENANT}`,
          minLifetimePoints: 20,
          createdBy: 1,
        },
      ]);

      const customerId = await makeCustomer('Loyalty Tier Customer');
      await svc.earnPoints(TEST_TENANT, customerId, 1000, 'TEST', 1, 1); // 10 points -> Silver

      expect(await getTierName(customerId)).toBe('Silver');

      await svc.earnPoints(TEST_TENANT, customerId, 1500, 'TEST', 2, 1); // +15 = 25 lifetime -> Gold

      expect(await getTierName(customerId)).toBe('Gold');
    });

    it('never demotes a tier when the current balance drops via redemption', async () => {
      await db.insert(crmLoyaltyTiers).values({
        tenantId: TEST_TENANT,
        name: 'Platinum',
        code: `platinum-${TEST_TENANT}`,
        minLifetimePoints: 5,
        createdBy: 1,
      });

      const customerId = await makeCustomer('Loyalty No Demote Customer');
      await svc.earnPoints(TEST_TENANT, customerId, 1000, 'TEST', 1, 1); // 10 points, crosses threshold -> Platinum

      expect(await getTierName(customerId)).toBe('Platinum');

      await svc.redeemPoints(TEST_TENANT, customerId, 10, 'TEST', 1, 1); // balance back to 0

      expect(await getTierName(customerId)).toBe('Platinum');
    });
  });

  describe('redemption catalog', () => {
    it('redeemCatalogItem debits the exact catalog cost and records a redemption row through the same ledger', async () => {
      const customerId = await makeCustomer('Loyalty Catalog Customer', 500);
      const [item] = await db
        .insert(crmRedemptionCatalog)
        .values({
          tenantId: TEST_TENANT,
          name: '10% Off Voucher',
          pointsCost: 200,
          rewardType: 'DISCOUNT_PERCENT',
          rewardValue: '10',
          createdBy: 1,
        })
        .returning();

      const reward = await svc.redeemCatalogItem(
        TEST_TENANT,
        customerId,
        item!.id,
        'POS_SALE',
        1,
        1
      );
      expect(reward.rewardType).toBe('DISCOUNT_PERCENT');
      expect(reward.rewardValue).toBe(10);

      const [customer] = await db
        .select({ loyaltyPoints: customers.loyaltyPoints })
        .from(customers)
        .where(and(eq(customers.id, customerId), eq(customers.tenantId, TEST_TENANT)));
      expect(customer!.loyaltyPoints).toBe(300);

      const [redemption] = await db
        .select()
        .from(crmLoyaltyRedemptions)
        .where(eq(crmLoyaltyRedemptions.id, reward.redemptionId));
      expect(redemption!.pointsCost).toBe(200);
      expect(redemption!.catalogItemId).toBe(item!.id);

      const [txn] = await db
        .select()
        .from(loyaltyTransactions)
        .where(eq(loyaltyTransactions.id, redemption!.loyaltyTransactionId));
      expect(txn!.points).toBe(-200);
      expect(txn!.type).toBe('REDEEM');
    });

    it("blocks redeeming a catalog item that costs more than the customer's balance (no overdraw)", async () => {
      const customerId = await makeCustomer('Loyalty Catalog Overdraw Customer', 50);
      const [item] = await db
        .insert(crmRedemptionCatalog)
        .values({
          tenantId: TEST_TENANT,
          name: 'Premium Reward',
          pointsCost: 1000,
          rewardType: 'DISCOUNT_AMOUNT',
          rewardValue: '500',
          createdBy: 1,
        })
        .returning();

      await expect(
        svc.redeemCatalogItem(TEST_TENANT, customerId, item!.id, 'POS_SALE', 1, 1)
      ).rejects.toThrow(/Only 50 points available/);

      const [customer] = await db
        .select({ loyaltyPoints: customers.loyaltyPoints })
        .from(customers)
        .where(and(eq(customers.id, customerId), eq(customers.tenantId, TEST_TENANT)));
      expect(customer!.loyaltyPoints).toBe(50);
    });

    // createCatalogItem moved to crm-service (CRM/O2C split) — covered there.
  });
});
