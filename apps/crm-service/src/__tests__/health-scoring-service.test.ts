// CRM/O2C split — net-new focused coverage for the cache-read half of HealthScoringService
// (segmentCounts, getPredictionsForCustomer, recordFeedback) moved here from sales-service.
// The compute half (which populates these same tables) stays in sales-service and is tested
// there — these tests seed the cache tables directly rather than going through that compute
// job, since this service has no access to it.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createDatabaseClient } from '@erp/db';
import {
  branches,
  customers,
  units,
  items,
  crmChurnPredictions,
  crmNextBestActions,
  crmProductRecommendations,
} from '@erp/db';
import { eq, and } from 'drizzle-orm';
import { HealthScoringService } from '../domain/HealthScoringService.js';

const DB_URL = process.env['DATABASE_URL'];

describe.skipIf(!DB_URL)('HealthScoringService (crm-service half)', () => {
  let db: ReturnType<typeof createDatabaseClient>;
  const TEST_TENANT = 902_001 + Math.floor(Math.random() * 1000);
  let branchId: number;
  let unitId: number;
  let itemA: number;

  beforeAll(async () => {
    db = createDatabaseClient({ url: DB_URL! });

    const [branch] = await db
      .insert(branches)
      .values({
        tenantId: TEST_TENANT,
        name: 'CRM Health Branch',
        code: 'CH',
        isHeadOffice: true,
        isActive: true,
        createdBy: 1,
      })
      .returning();
    branchId = branch!.id;

    const [unit] = await db
      .insert(units)
      .values({ tenantId: TEST_TENANT, name: 'Piece', abbreviation: 'PC', createdBy: 1 })
      .returning();
    unitId = unit!.id;

    const [item] = await db
      .insert(items)
      .values({
        tenantId: TEST_TENANT,
        name: 'Recommended Item',
        unitId,
        hsnCode: '5208',
        gstRate: '12',
        salePrice: '100',
        createdBy: 1,
      })
      .returning();
    itemA = item!.id;
  });

  afterAll(async () => {
    await db
      .delete(crmProductRecommendations)
      .where(eq(crmProductRecommendations.tenantId, TEST_TENANT));
    await db.delete(crmNextBestActions).where(eq(crmNextBestActions.tenantId, TEST_TENANT));
    await db.delete(crmChurnPredictions).where(eq(crmChurnPredictions.tenantId, TEST_TENANT));
    await db.delete(customers).where(eq(customers.tenantId, TEST_TENANT));
    await db.delete(items).where(eq(items.tenantId, TEST_TENANT));
    await db.delete(units).where(eq(units.tenantId, TEST_TENANT));
    await db.delete(branches).where(eq(branches.tenantId, TEST_TENANT));
  });

  async function makeCustomer(
    name: string,
    healthSegment: 'CHAMPION' | 'LOYAL' | 'AT_RISK' | 'LOST' | null
  ): Promise<number> {
    const [customer] = await db
      .insert(customers)
      .values({
        tenantId: TEST_TENANT,
        branchId,
        displayName: name,
        phone: `9${Math.floor(100_000_000 + Math.random() * 899_999_999)}`,
        creditLimit: '0',
        openingBalance: '0',
        status: 'ACTIVE',
        healthSegment,
        createdBy: 1,
      } as unknown as typeof customers.$inferInsert)
      .returning();
    return customer!.id;
  }

  describe('segmentCounts', () => {
    it('groups customers by cached healthSegment, bucketing null as unscored', async () => {
      await makeCustomer('Champion Co', 'CHAMPION');
      await makeCustomer('Loyal Co', 'LOYAL');
      await makeCustomer('At Risk Co', 'AT_RISK');
      await makeCustomer('Lost Co', 'LOST');
      await makeCustomer('Unscored Co', null);

      const counts = await HealthScoringService.segmentCounts(db, TEST_TENANT);
      expect(counts).toEqual({ champion: 1, loyal: 1, atRisk: 1, lost: 1, unscored: 1 });
    });
  });

  describe('getPredictionsForCustomer', () => {
    it('returns the cached churn/next-best-action/product-recommendation rows, excluding dismissed ones', async () => {
      const customerId = await makeCustomer('Predictions Customer', 'AT_RISK');

      await db.insert(crmChurnPredictions).values({
        tenantId: TEST_TENANT,
        customerId,
        riskLevel: 'HIGH',
        riskScore: 90,
        reason: 'seeded for test',
      });
      await db.insert(crmNextBestActions).values({
        tenantId: TEST_TENANT,
        customerId,
        actionType: 'WIN_BACK_OFFER',
        actionText: 'Send an offer',
        reason: 'seeded for test',
        dismissed: false,
      });
      await db.insert(crmProductRecommendations).values([
        {
          tenantId: TEST_TENANT,
          customerId,
          itemId: itemA,
          reason: 'active rec',
          rank: 1,
          dismissed: false,
        },
      ]);

      const result = await HealthScoringService.getPredictionsForCustomer(
        db,
        TEST_TENANT,
        customerId
      );
      expect(result.churn?.riskLevel).toBe('HIGH');
      expect(result.nextBestAction?.actionType).toBe('WIN_BACK_OFFER');
      expect(result.productRecommendations).toHaveLength(1);
      expect(result.productRecommendations[0]!.itemName).toBe('Recommended Item');
    });

    it('returns nulls/empty for a customer with no cached predictions', async () => {
      const customerId = await makeCustomer('No Predictions Customer', null);
      const result = await HealthScoringService.getPredictionsForCustomer(
        db,
        TEST_TENANT,
        customerId
      );
      expect(result.churn).toBeNull();
      expect(result.nextBestAction).toBeNull();
      expect(result.productRecommendations).toEqual([]);
    });
  });

  describe('recordFeedback', () => {
    it('dismisses a next-best-action and returns true', async () => {
      const customerId = await makeCustomer('Feedback Customer', 'AT_RISK');
      const [action] = await db
        .insert(crmNextBestActions)
        .values({
          tenantId: TEST_TENANT,
          customerId,
          actionType: 'RE_ENGAGEMENT',
          actionText: 'Send a message',
          reason: 'seeded for test',
          dismissed: false,
        })
        .returning();

      const updated = await HealthScoringService.recordFeedback(
        db,
        TEST_TENANT,
        'NEXT_BEST_ACTION',
        action!.id,
        'DISMISS'
      );
      expect(updated).toBe(true);

      const [row] = await db
        .select()
        .from(crmNextBestActions)
        .where(
          and(eq(crmNextBestActions.id, action!.id), eq(crmNextBestActions.tenantId, TEST_TENANT))
        );
      expect(row?.dismissed).toBe(true);
      expect(row?.dismissedAt).not.toBeNull();
    });

    it('returns false for a recommendation id that does not exist in this tenant', async () => {
      const updated = await HealthScoringService.recordFeedback(
        db,
        TEST_TENANT,
        'NEXT_BEST_ACTION',
        999_999_999,
        'DISMISS'
      );
      expect(updated).toBe(false);
    });
  });
});
