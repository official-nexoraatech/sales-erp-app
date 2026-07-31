// CRM-ROADMAP Phase 3, Feature 1 (AI & Predictive Intelligence Suite). Statistical models, not
// black-box ones, per the roadmap's own instruction ("this is where a statistical model is
// easier to test than a black-box one — exploit that") — every fixture below is hand-computed,
// not just asserted against whatever the code happens to produce.
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { createDatabaseClient } from '@erp/db';
import {
  branches,
  customers,
  units,
  items,
  invoices,
  invoiceLines,
  crmChurnPredictions,
  crmNextBestActions,
  crmProductRecommendations,
} from '@erp/db';
import { eq, and } from 'drizzle-orm';
import { HealthScoringService } from '../domain/HealthScoringService.js';

describe('HealthScoringService.computeNextBestAction — pure rule cascade', () => {
  const health = (segment: 'CHAMPION' | 'LOYAL' | 'AT_RISK' | 'LOST') => ({ segment });

  it('recommends a win-back offer for HIGH churn risk, regardless of segment', () => {
    const action = HealthScoringService.computeNextBestAction(
      { customerId: 1, riskLevel: 'HIGH', riskScore: 90, reason: 'high risk reason' },
      health('CHAMPION')
    );
    expect(action?.actionType).toBe('WIN_BACK_OFFER');
    expect(action?.reason).toBe('high risk reason');
  });

  it('recommends a loyalty upsell for a CHAMPION-segment customer who is not at high churn risk', () => {
    const action = HealthScoringService.computeNextBestAction(
      { customerId: 1, riskLevel: 'LOW', riskScore: 10, reason: 'low risk reason' },
      health('CHAMPION')
    );
    expect(action?.actionType).toBe('LOYALTY_UPSELL');
  });

  it('recommends re-engagement for MEDIUM churn risk outside the CHAMPION segment', () => {
    const action = HealthScoringService.computeNextBestAction(
      { customerId: 1, riskLevel: 'MEDIUM', riskScore: 55, reason: 'medium risk reason' },
      health('LOYAL')
    );
    expect(action?.actionType).toBe('RE_ENGAGEMENT');
  });

  it('returns null (no forced filler action) when nothing applies', () => {
    const action = HealthScoringService.computeNextBestAction(
      { customerId: 1, riskLevel: 'LOW', riskScore: 10, reason: 'low risk reason' },
      health('LOYAL')
    );
    expect(action).toBeNull();
  });
});

const DB_URL = process.env['DATABASE_URL'];

describe.skipIf(!DB_URL)('HealthScoringService — AI predictions integration', () => {
  let db: ReturnType<typeof createDatabaseClient>;
  const TEST_TENANT = 901_001 + Math.floor(Math.random() * 1000);
  let branchId: number;
  let unitId: number;
  let itemA: number;
  let itemB: number;
  let itemC: number;

  beforeAll(async () => {
    db = createDatabaseClient({ url: DB_URL! });

    const [branch] = await db
      .insert(branches)
      .values({
        tenantId: TEST_TENANT,
        name: 'AI Branch',
        code: 'AI',
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

    const itemRows = await db
      .insert(items)
      .values([
        {
          tenantId: TEST_TENANT,
          name: 'Item A',
          unitId,
          hsnCode: '5208',
          gstRate: '12',
          salePrice: '100',
          createdBy: 1,
        },
        {
          tenantId: TEST_TENANT,
          name: 'Item B',
          unitId,
          hsnCode: '5208',
          gstRate: '12',
          salePrice: '200',
          createdBy: 1,
        },
        {
          tenantId: TEST_TENANT,
          name: 'Item C',
          unitId,
          hsnCode: '5208',
          gstRate: '12',
          salePrice: '300',
          createdBy: 1,
        },
      ])
      .returning();
    itemA = itemRows[0]!.id;
    itemB = itemRows[1]!.id;
    itemC = itemRows[2]!.id;
  });

  afterAll(async () => {
    await db
      .delete(crmProductRecommendations)
      .where(eq(crmProductRecommendations.tenantId, TEST_TENANT));
    await db.delete(crmNextBestActions).where(eq(crmNextBestActions.tenantId, TEST_TENANT));
    await db.delete(crmChurnPredictions).where(eq(crmChurnPredictions.tenantId, TEST_TENANT));
    await db.delete(invoiceLines).where(eq(invoiceLines.tenantId, TEST_TENANT));
    await db.delete(invoices).where(eq(invoices.tenantId, TEST_TENANT));
    await db.delete(items).where(eq(items.tenantId, TEST_TENANT));
    await db.delete(units).where(eq(units.tenantId, TEST_TENANT));
    await db.delete(customers).where(eq(customers.tenantId, TEST_TENANT));
    await db.delete(branches).where(eq(branches.tenantId, TEST_TENANT));
  });

  async function makeCustomer(name: string): Promise<number> {
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
        createdBy: 1,
      })
      .returning();
    return customer!.id;
  }

  async function makeInvoice(
    customerId: number,
    daysAgo: number,
    itemIds: number[]
  ): Promise<number> {
    const [invoice] = await db
      .insert(invoices)
      .values({
        tenantId: TEST_TENANT,
        branchId,
        warehouseId: branchId,
        customerId,
        invoiceNumber: `AI-${Date.now()}-${Math.random()}`,
        placeOfSupply: '27',
        invoiceDate: new Date(Date.now() - daysAgo * 86_400_000),
        dueDate: new Date(Date.now() + 30 * 86_400_000),
        status: 'CONFIRMED',
        subtotal: '100',
        taxableAmount: '100',
        grandTotal: '100',
        paidAmount: '0',
        createdBy: 1,
      } as unknown as typeof invoices.$inferInsert)
      .returning();
    await db.insert(invoiceLines).values(
      itemIds.map((itemId, i) => ({
        invoiceId: invoice!.id,
        tenantId: TEST_TENANT,
        lineNumber: i + 1,
        itemId,
        quantity: '1',
        unitPrice: '100',
        taxableAmount: '100',
        lineTotal: '100',
      }))
    );
    return invoice!.id;
  }

  describe('predictChurn', () => {
    it('returns INSUFFICIENT_DATA for a customer with fewer than 2 purchases', async () => {
      const customerId = await makeCustomer('Zero Purchase Customer');
      const prediction = await HealthScoringService.predictChurn(db, TEST_TENANT, customerId);
      expect(prediction.riskLevel).toBe('INSUFFICIENT_DATA');
      expect(prediction.riskScore).toBeNull();

      const customerId2 = await makeCustomer('One Purchase Customer');
      await makeInvoice(customerId2, 5, [itemA]);
      const prediction2 = await HealthScoringService.predictChurn(db, TEST_TENANT, customerId2);
      expect(prediction2.riskLevel).toBe('INSUFFICIENT_DATA');
    });

    it('scores LOW risk when the customer purchased recently, in line with their typical interval', async () => {
      const customerId = await makeCustomer('Regular Customer');
      // Purchases every ~10 days historically; most recent one only 5 days ago.
      await makeInvoice(customerId, 30, [itemA]);
      await makeInvoice(customerId, 20, [itemA]);
      await makeInvoice(customerId, 5, [itemA]);
      const prediction = await HealthScoringService.predictChurn(db, TEST_TENANT, customerId);
      // avgInterval = ((30-20)+(20-5))/2 = 12.5 days; daysSinceLastPurchase = 5.
      // ratio = 5/12.5 = 0.4 -> score = round(0.4*50) = 20 -> LOW.
      expect(prediction.riskScore).toBe(20);
      expect(prediction.riskLevel).toBe('LOW');
    });

    it('scores HIGH risk when far overdue relative to the typical interval', async () => {
      const customerId = await makeCustomer('Overdue Customer');
      // Purchases every ~10 days historically; nothing for 40 days since.
      await makeInvoice(customerId, 60, [itemA]);
      await makeInvoice(customerId, 50, [itemA]);
      await makeInvoice(customerId, 40, [itemA]);
      const prediction = await HealthScoringService.predictChurn(db, TEST_TENANT, customerId);
      // avgInterval = 10 days; daysSinceLastPurchase = 40. ratio = 4 -> score = 100 (clamped) -> HIGH.
      expect(prediction.riskScore).toBe(100);
      expect(prediction.riskLevel).toBe('HIGH');
    });
  });

  describe('computeProductRecommendations', () => {
    it('recommends items other customers who share a purchase also bought, excluding items already owned', async () => {
      const target = await makeCustomer('Target Customer');
      const peer1 = await makeCustomer('Peer Customer 1');
      const peer2 = await makeCustomer('Peer Customer 2');

      // Target bought A. Peer1 bought A + B. Peer2 bought A + B + C.
      await makeInvoice(target, 10, [itemA]);
      await makeInvoice(peer1, 10, [itemA, itemB]);
      await makeInvoice(peer2, 10, [itemA, itemB, itemC]);

      const recs = await HealthScoringService.computeProductRecommendations(
        db,
        TEST_TENANT,
        target,
        5
      );
      const itemIds = recs.map((r) => r.itemId);
      expect(itemIds).not.toContain(itemA); // already owned
      expect(itemIds[0]).toBe(itemB); // co-purchased by 2 peers, ranked first
      expect(itemIds).toContain(itemC); // co-purchased by 1 peer
      expect(recs[0]!.rank).toBe(1);
    });

    it('returns no recommendations for a customer with zero purchase history', async () => {
      const customerId = await makeCustomer('No History Customer');
      const recs = await HealthScoringService.computeProductRecommendations(
        db,
        TEST_TENANT,
        customerId,
        5
      );
      expect(recs).toEqual([]);
    });
  });

  describe('computeAndCachePredictions — nightly batch + dismiss-aware merge', () => {
    afterEach(async () => {
      await db
        .delete(crmProductRecommendations)
        .where(eq(crmProductRecommendations.tenantId, TEST_TENANT));
      await db.delete(crmNextBestActions).where(eq(crmNextBestActions.tenantId, TEST_TENANT));
      await db.delete(crmChurnPredictions).where(eq(crmChurnPredictions.tenantId, TEST_TENANT));
    });

    it('caches churn/next-best-action/product-recommendation rows for every active customer', async () => {
      const customerId = await makeCustomer('Batch Customer');
      await makeInvoice(customerId, 60, [itemA]);
      await makeInvoice(customerId, 50, [itemA]);
      await makeInvoice(customerId, 40, [itemA]); // HIGH churn risk -> WIN_BACK_OFFER expected

      await HealthScoringService.computeAndCachePredictions(db, TEST_TENANT);

      const [churnRow] = await db
        .select()
        .from(crmChurnPredictions)
        .where(
          and(
            eq(crmChurnPredictions.tenantId, TEST_TENANT),
            eq(crmChurnPredictions.customerId, customerId)
          )
        );
      expect(churnRow?.riskLevel).toBe('HIGH');

      const [actionRow] = await db
        .select()
        .from(crmNextBestActions)
        .where(
          and(
            eq(crmNextBestActions.tenantId, TEST_TENANT),
            eq(crmNextBestActions.customerId, customerId)
          )
        );
      expect(actionRow?.actionType).toBe('WIN_BACK_OFFER');
      expect(actionRow?.dismissed).toBe(false);
    });

    // Runs the nightly batch (which scores every active customer in the tenant) twice —
    // slower than a single-batch test, so it gets a longer timeout to stay stable under
    // whole-suite parallel load (matches this codebase's documented CPU-contention pattern
    // for full-suite runs).
    it('does not resurface a dismissed next-best-action for the same underlying trigger on the next run', async () => {
      const customerId = await makeCustomer('Dismiss NBA Customer');
      await makeInvoice(customerId, 60, [itemA]);
      await makeInvoice(customerId, 50, [itemA]);
      await makeInvoice(customerId, 40, [itemA]); // stays HIGH risk across both runs below

      await HealthScoringService.computeAndCachePredictions(db, TEST_TENANT);
      const [firstRun] = await db
        .select()
        .from(crmNextBestActions)
        .where(
          and(
            eq(crmNextBestActions.tenantId, TEST_TENANT),
            eq(crmNextBestActions.customerId, customerId)
          )
        );
      expect(firstRun?.dismissed).toBe(false);

      const dismissed = await HealthScoringService.recordFeedback(
        db,
        TEST_TENANT,
        'NEXT_BEST_ACTION',
        firstRun!.id,
        'DISMISS'
      );
      expect(dismissed).toBe(true);

      await HealthScoringService.computeAndCachePredictions(db, TEST_TENANT);
      const [secondRun] = await db
        .select()
        .from(crmNextBestActions)
        .where(
          and(
            eq(crmNextBestActions.tenantId, TEST_TENANT),
            eq(crmNextBestActions.customerId, customerId)
          )
        );
      // Same trigger (still HIGH risk -> WIN_BACK_OFFER) — stays dismissed, not resurfaced.
      expect(secondRun?.dismissed).toBe(true);
    }, 15_000);

    it('does not resurface a dismissed product recommendation for the same item on the next run', async () => {
      const target = await makeCustomer('Dismiss Rec Target');
      const peer = await makeCustomer('Dismiss Rec Peer');
      await makeInvoice(target, 10, [itemA]);
      await makeInvoice(peer, 10, [itemA, itemB]);

      await HealthScoringService.computeAndCachePredictions(db, TEST_TENANT);
      const [rec] = await db
        .select()
        .from(crmProductRecommendations)
        .where(
          and(
            eq(crmProductRecommendations.tenantId, TEST_TENANT),
            eq(crmProductRecommendations.customerId, target),
            eq(crmProductRecommendations.itemId, itemB)
          )
        );
      expect(rec).toBeDefined();

      await HealthScoringService.recordFeedback(
        db,
        TEST_TENANT,
        'PRODUCT_RECOMMENDATION',
        rec!.id,
        'DISMISS'
      );

      await HealthScoringService.computeAndCachePredictions(db, TEST_TENANT);
      const rows = await db
        .select()
        .from(crmProductRecommendations)
        .where(
          and(
            eq(crmProductRecommendations.tenantId, TEST_TENANT),
            eq(crmProductRecommendations.customerId, target),
            eq(crmProductRecommendations.itemId, itemB)
          )
        );
      expect(rows).toHaveLength(1);
      expect(rows[0]!.dismissed).toBe(true);

      const { productRecommendations } = await HealthScoringService.getPredictionsForCustomer(
        db,
        TEST_TENANT,
        target
      );
      expect(productRecommendations.find((r) => r.itemId === itemB)).toBeUndefined();
    }, 15_000);
  });
});
