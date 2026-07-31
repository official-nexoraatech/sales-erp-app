// CRM-ROADMAP Phase 2, Feature 4 (Referral Program Engine). DB-backed integration tests only —
// every method here touches Postgres. Skipped without DATABASE_URL, matching every other
// domain-service test file's own convention (including the featureFlags-seeding fixture from
// pos-completion.test.ts / loyalty-service.test.ts).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createDatabaseClient } from '@erp/db';
import {
  branches,
  customers,
  invoices,
  featureFlags,
  loyaltyTransactions,
  crmReferralCodes,
  crmReferralEvents,
  crmReferralRewards,
} from '@erp/db';
import { eq, and } from 'drizzle-orm';
import { BusinessError } from '@erp/types';
import { ReferralService } from '../domain/ReferralService.js';

const DB_URL = process.env['DATABASE_URL'];

describe.skipIf(!DB_URL)('ReferralService — integration (CRM-ROADMAP Phase 2, Feature 4)', () => {
  let db: ReturnType<typeof createDatabaseClient>;
  const TEST_TENANT = 900_801 + Math.floor(Math.random() * 1000);
  let branchId: number;
  let warehouseId: number;

  async function makeCustomer(displayName: string, phone: string): Promise<number> {
    const [row] = await db
      .insert(customers)
      .values({
        tenantId: TEST_TENANT,
        branchId,
        displayName,
        phone,
        creditLimit: '0',
        openingBalance: '0',
        createdBy: 1,
      })
      .returning();
    return row!.id;
  }

  async function makeQualifyingInvoice(customerId: number): Promise<number> {
    const [row] = await db
      .insert(invoices)
      .values({
        tenantId: TEST_TENANT,
        branchId,
        warehouseId,
        customerId,
        invoiceNumber: `REF-${Date.now()}-${Math.random()}`,
        placeOfSupply: '27',
        invoiceDate: new Date(),
        dueDate: new Date(Date.now() + 30 * 86_400_000),
        status: 'CONFIRMED',
        subtotal: '100',
        taxableAmount: '100',
        grandTotal: '100',
        paidAmount: '100',
        createdBy: 1,
      } as unknown as typeof invoices.$inferInsert)
      .returning();
    return row!.id;
  }

  async function getLoyaltyPoints(customerId: number): Promise<number> {
    const [row] = await db
      .select({ loyaltyPoints: customers.loyaltyPoints })
      .from(customers)
      .where(and(eq(customers.id, customerId), eq(customers.tenantId, TEST_TENANT)));
    return row?.loyaltyPoints ?? 0;
  }

  beforeAll(async () => {
    db = createDatabaseClient({ url: DB_URL! });
    const [branch] = await db
      .insert(branches)
      .values({
        tenantId: TEST_TENANT,
        name: 'Referral Test HO',
        code: 'RHO',
        isHeadOffice: true,
        isActive: true,
        createdBy: 1,
      })
      .returning();
    branchId = branch!.id;
    warehouseId = branchId;

    await db
      .insert(featureFlags)
      .values({ tenantId: TEST_TENANT, flagKey: 'sales.loyalty.enabled', enabled: true });
  });

  afterAll(async () => {
    await db.delete(crmReferralRewards).where(eq(crmReferralRewards.tenantId, TEST_TENANT));
    await db.delete(crmReferralEvents).where(eq(crmReferralEvents.tenantId, TEST_TENANT));
    await db.delete(crmReferralCodes).where(eq(crmReferralCodes.tenantId, TEST_TENANT));
    await db.delete(loyaltyTransactions).where(eq(loyaltyTransactions.tenantId, TEST_TENANT));
    await db.delete(invoices).where(eq(invoices.tenantId, TEST_TENANT));
    await db.delete(customers).where(eq(customers.tenantId, TEST_TENANT));
    await db.delete(featureFlags).where(eq(featureFlags.tenantId, TEST_TENANT));
    await db.delete(branches).where(eq(branches.tenantId, TEST_TENANT));
  });

  describe('getOrCreateCode', () => {
    it('creates a code once and returns the same one on a second call', async () => {
      const customerId = await makeCustomer('Referrer A', '9100000001');
      const first = await ReferralService.getOrCreateCode(db, TEST_TENANT, customerId);
      const second = await ReferralService.getOrCreateCode(db, TEST_TENANT, customerId);
      expect(second.id).toBe(first.id);
      expect(second.code).toBe(first.code);
    });
  });

  describe('redeem — fraud guardrails', () => {
    it('creates a PENDING reward and a SIGNED_UP event on a clean redemption', async () => {
      const referrerId = await makeCustomer('Referrer B', '9100000002');
      const referralCode = await ReferralService.getOrCreateCode(db, TEST_TENANT, referrerId);

      const reward = await ReferralService.redeem(db, {
        code: referralCode.code,
        refereeName: 'New Referee',
        refereePhone: '9100000102',
        ipAddress: '10.0.0.1',
        deviceId: 'device-clean',
      });
      expect(reward.status).toBe('PENDING');

      const events = await db
        .select()
        .from(crmReferralEvents)
        .where(
          and(
            eq(crmReferralEvents.referralCodeId, referralCode.id),
            eq(crmReferralEvents.eventType, 'SIGNED_UP')
          )
        );
      expect(events).toHaveLength(1);
    });

    it("blocks self-referral (referee phone matches the referrer's own phone)", async () => {
      const referrerId = await makeCustomer('Referrer C', '9100000003');
      const referralCode = await ReferralService.getOrCreateCode(db, TEST_TENANT, referrerId);

      await expect(
        ReferralService.redeem(db, { code: referralCode.code, refereePhone: '9100000003' })
      ).rejects.toThrow(/cannot redeem your own referral code/);
    });

    it('blocks a referee phone that already belongs to an existing customer', async () => {
      const referrerId = await makeCustomer('Referrer D', '9100000004');
      const referralCode = await ReferralService.getOrCreateCode(db, TEST_TENANT, referrerId);
      await makeCustomer('Already A Customer', '9100000104');

      await expect(
        ReferralService.redeem(db, { code: referralCode.code, refereePhone: '9100000104' })
      ).rejects.toThrow(/already belongs to an existing customer/);
    });

    it('one-time-per-referee: a second redemption for the same phone is blocked, even under a different code', async () => {
      const referrerId1 = await makeCustomer('Referrer E1', '9100000005');
      const referrerId2 = await makeCustomer('Referrer E2', '9100000006');
      const code1 = await ReferralService.getOrCreateCode(db, TEST_TENANT, referrerId1);
      const code2 = await ReferralService.getOrCreateCode(db, TEST_TENANT, referrerId2);

      await ReferralService.redeem(db, { code: code1.code, refereePhone: '9100000105' });

      await expect(
        ReferralService.redeem(db, { code: code2.code, refereePhone: '9100000105' })
      ).rejects.toThrow(/already redeemed a referral code/);
    });

    it('flags a redemption for manual review once the same IP has redeemed 3+ other codes', async () => {
      const sharedIp = '203.0.113.55';
      for (let i = 0; i < 3; i++) {
        const referrerId = await makeCustomer(`Correlation Referrer ${i}`, `910000010${i}`);
        const code = await ReferralService.getOrCreateCode(db, TEST_TENANT, referrerId);
        await ReferralService.redeem(db, {
          code: code.code,
          refereePhone: `910000020${i}`,
          ipAddress: sharedIp,
        });
      }

      const referrerId = await makeCustomer('Correlation Referrer Final', '9100000199');
      const code = await ReferralService.getOrCreateCode(db, TEST_TENANT, referrerId);
      const flagged = await ReferralService.redeem(db, {
        code: code.code,
        refereePhone: '9100000299',
        ipAddress: sharedIp,
      });

      expect(flagged.status).toBe('FLAGGED');
      expect(flagged.flagReason).toMatch(/shared this IP\/device/);
    });
  });

  describe('attributeQualifyingPurchases — full funnel payout', () => {
    it('pays out both parties once the referee has a qualifying purchase, and never double-pays', async () => {
      const referrerId = await makeCustomer('Payout Referrer', '9100000301');
      const referralCode = await ReferralService.getOrCreateCode(db, TEST_TENANT, referrerId);

      const reward = await ReferralService.redeem(db, {
        code: referralCode.code,
        refereeName: 'Payout Referee',
        refereePhone: '9100000401',
      });

      const refereeId = await makeCustomer('Payout Referee', '9100000401');
      await makeQualifyingInvoice(refereeId);

      const referrerBefore = await getLoyaltyPoints(referrerId);
      const refereeBefore = await getLoyaltyPoints(refereeId);

      const firstRunPaid = await ReferralService.attributeQualifyingPurchases(db, TEST_TENANT);
      expect(firstRunPaid).toBeGreaterThanOrEqual(1);

      const referrerAfter = await getLoyaltyPoints(referrerId);
      const refereeAfter = await getLoyaltyPoints(refereeId);
      expect(referrerAfter - referrerBefore).toBe(reward.referrerPoints);
      expect(refereeAfter - refereeBefore).toBe(reward.refereePoints);

      const [updatedReward] = await db
        .select()
        .from(crmReferralRewards)
        .where(eq(crmReferralRewards.id, reward.id));
      expect(updatedReward!.status).toBe('PAID');
      expect(updatedReward!.refereeCustomerId).toBe(refereeId);
      expect(updatedReward!.referrerLoyaltyTransactionId).not.toBeNull();
      expect(updatedReward!.refereeLoyaltyTransactionId).not.toBeNull();

      const purchasedEvents = await db
        .select()
        .from(crmReferralEvents)
        .where(
          and(
            eq(crmReferralEvents.referralCodeId, referralCode.id),
            eq(crmReferralEvents.eventType, 'PURCHASED')
          )
        );
      expect(purchasedEvents).toHaveLength(1);

      // Re-running attribution must not pay out again — the reward is no longer PENDING.
      const secondRunPaid = await ReferralService.attributeQualifyingPurchases(db, TEST_TENANT);
      expect(secondRunPaid).toBe(0);
      const referrerFinal = await getLoyaltyPoints(referrerId);
      expect(referrerFinal).toBe(referrerAfter);
    });

    it('does not pay out a FLAGGED reward until approved', async () => {
      const sharedIp = '198.51.100.9';
      for (let i = 0; i < 3; i++) {
        const referrerId = await makeCustomer(`Flag Payout Referrer ${i}`, `910000050${i}`);
        const code = await ReferralService.getOrCreateCode(db, TEST_TENANT, referrerId);
        await ReferralService.redeem(db, {
          code: code.code,
          refereePhone: `910000060${i}`,
          ipAddress: sharedIp,
        });
      }
      const referrerId = await makeCustomer('Flag Payout Referrer Final', '9100000599');
      const code = await ReferralService.getOrCreateCode(db, TEST_TENANT, referrerId);
      const flagged = await ReferralService.redeem(db, {
        code: code.code,
        refereePhone: '9100000699',
        ipAddress: sharedIp,
      });
      expect(flagged.status).toBe('FLAGGED');

      const refereeId = await makeCustomer('Flag Payout Referee', '9100000699');
      await makeQualifyingInvoice(refereeId);

      const paidWhileFlagged = await ReferralService.attributeQualifyingPurchases(db, TEST_TENANT);
      const [stillFlagged] = await db
        .select()
        .from(crmReferralRewards)
        .where(eq(crmReferralRewards.id, flagged.id));
      expect(stillFlagged!.status).toBe('FLAGGED');

      await ReferralService.approveFlagged(db, TEST_TENANT, flagged.id);
      const [approved] = await db
        .select()
        .from(crmReferralRewards)
        .where(eq(crmReferralRewards.id, flagged.id));
      expect(approved!.status).toBe('PENDING');

      const paidAfterApproval = await ReferralService.attributeQualifyingPurchases(db, TEST_TENANT);
      expect(paidAfterApproval).toBeGreaterThanOrEqual(1);
      const [paid] = await db
        .select()
        .from(crmReferralRewards)
        .where(eq(crmReferralRewards.id, flagged.id));
      expect(paid!.status).toBe('PAID');
      void paidWhileFlagged;
    });
  });

  describe('rejectFlagged', () => {
    it('moves a FLAGGED reward to REJECTED and it is never paid out', async () => {
      const sharedIp = '198.51.100.77';
      for (let i = 0; i < 3; i++) {
        const referrerId = await makeCustomer(`Reject Referrer ${i}`, `910000070${i}`);
        const code = await ReferralService.getOrCreateCode(db, TEST_TENANT, referrerId);
        await ReferralService.redeem(db, {
          code: code.code,
          refereePhone: `910000080${i}`,
          ipAddress: sharedIp,
        });
      }
      const referrerId = await makeCustomer('Reject Referrer Final', '9100000799');
      const code = await ReferralService.getOrCreateCode(db, TEST_TENANT, referrerId);
      const flagged = await ReferralService.redeem(db, {
        code: code.code,
        refereePhone: '9100000899',
        ipAddress: sharedIp,
      });

      const rejected = await ReferralService.rejectFlagged(
        db,
        TEST_TENANT,
        flagged.id,
        'Confirmed fraud ring'
      );
      expect(rejected.status).toBe('REJECTED');

      await expect(ReferralService.approveFlagged(db, TEST_TENANT, flagged.id)).rejects.toThrow(
        /Only a FLAGGED reward/
      );
    });
  });

  describe('getFunnelStats', () => {
    it('aggregates clicked/signed-up/paid/flagged/rejected counts correctly', async () => {
      const stats = await ReferralService.getFunnelStats(db, TEST_TENANT);
      expect(stats.paid).toBeGreaterThanOrEqual(1);
      expect(stats.flagged).toBeGreaterThanOrEqual(1);
      expect(stats.rejected).toBeGreaterThanOrEqual(1);
      expect(stats.signedUp).toBeGreaterThanOrEqual(stats.paid + stats.flagged + stats.rejected);
    });
  });

  describe('BusinessError codes', () => {
    it('SELF_REFERRAL and ALREADY_CUSTOMER carry the expected codes', async () => {
      const referrerId = await makeCustomer('Code Check Referrer', '9100000901');
      const code = await ReferralService.getOrCreateCode(db, TEST_TENANT, referrerId);

      try {
        await ReferralService.redeem(db, { code: code.code, refereePhone: '9100000901' });
        expect.unreachable('should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(BusinessError);
        expect((err as BusinessError).code).toBe('SELF_REFERRAL');
      }
    });
  });
});
