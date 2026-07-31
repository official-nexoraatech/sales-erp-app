// CRM-ROADMAP Phase 2, Feature 1 (Sales Pipeline & Opportunity Management) — OpportunityService
// coverage per this feature's own DoD: forecast math independently verified against a
// hand-computed fixture, exit-criteria enforcement (Won needs >=1 line item, Lost needs a
// reason), the Won→Quotation handoff as a single atomic operation (a failure mid-handoff must
// roll back the stage change too, not leave a "Won but no quotation" opportunity), optimistic
// locking, and branch scoping (AR-6) for both a scoped and an unscoped caller.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createDatabaseClient } from '@erp/db';
import {
  branches,
  customers,
  units,
  items,
  quotations,
  quotationLines,
  crmOpportunities,
  crmOpportunityLineItems,
  crmOpportunityHistory,
  crmPipelineStages,
} from '@erp/db';
import { eq } from 'drizzle-orm';
import { BusinessError, OptimisticLockError } from '@erp/types';
import { OpportunityService } from '../domain/OpportunityService.js';

describe('OpportunityService.computeForecast — pure math', () => {
  it('matches a hand-computed fixture: pipeline/weighted/commit bands', () => {
    const result = OpportunityService.computeForecast([
      { value: 100_000, probability: 10 }, // pipeline only
      { value: 200_000, probability: 50 }, // pipeline + weighted
      { value: 150_000, probability: 80 }, // pipeline + weighted + commit (>=75)
    ]);
    // pipeline = 100000 + 200000 + 150000 = 450000
    expect(result.pipelineValue).toBe(450_000);
    // weighted = 100000*.10 + 200000*.50 + 150000*.80 = 10000 + 100000 + 120000 = 230000
    expect(result.weightedValue).toBe(230_000);
    // commit = only the 80%-probability deal, at full value
    expect(result.commitValue).toBe(150_000);
  });

  it('returns all-zero bands for an empty opportunity list, never NaN', () => {
    const result = OpportunityService.computeForecast([]);
    expect(result).toEqual({ pipelineValue: 0, weightedValue: 0, commitValue: 0 });
  });
});

const DB_URL = process.env['DATABASE_URL'];

describe.skipIf(!DB_URL)('OpportunityService — integration', () => {
  let db: ReturnType<typeof createDatabaseClient>;
  const TEST_TENANT = 900_901 + Math.floor(Math.random() * 1000);
  let branchA: number;
  let branchB: number;
  let customerId: number;
  let blockedCustomerId: number;
  let itemId: number;

  beforeAll(async () => {
    db = createDatabaseClient({ url: DB_URL! });
    const [ba] = await db
      .insert(branches)
      .values({
        tenantId: TEST_TENANT,
        name: 'Branch A',
        code: 'BA',
        isHeadOffice: true,
        isActive: true,
        createdBy: 1,
      })
      .returning();
    branchA = ba!.id;
    const [bb] = await db
      .insert(branches)
      .values({
        tenantId: TEST_TENANT,
        name: 'Branch B',
        code: 'BB',
        isHeadOffice: false,
        isActive: true,
        createdBy: 1,
      })
      .returning();
    branchB = bb!.id;

    const [customer] = await db
      .insert(customers)
      .values({
        tenantId: TEST_TENANT,
        branchId: branchA,
        displayName: 'Opportunity Test Customer',
        phone: '9500001111',
        customerType: 'WHOLESALE',
        creditLimit: '0',
        openingBalance: '0',
        createdBy: 1,
      })
      .returning();
    customerId = customer!.id;

    const [blockedCustomer] = await db
      .insert(customers)
      .values({
        tenantId: TEST_TENANT,
        branchId: branchA,
        displayName: 'Blocked Customer',
        phone: '9500002222',
        customerType: 'WHOLESALE',
        creditLimit: '0',
        openingBalance: '0',
        status: 'BLOCKED',
        createdBy: 1,
      })
      .returning();
    blockedCustomerId = blockedCustomer!.id;

    const [unit] = await db
      .insert(units)
      .values({ tenantId: TEST_TENANT, name: 'Piece', abbreviation: 'PC', createdBy: 1 })
      .returning();

    const [item] = await db
      .insert(items)
      .values({
        tenantId: TEST_TENANT,
        name: 'Test Fabric',
        unitId: unit!.id,
        hsnCode: '5208',
        gstRate: '12',
        salePrice: '500',
        createdBy: 1,
      })
      .returning();
    itemId = item!.id;
  });

  afterAll(async () => {
    await db.delete(crmOpportunityHistory).where(eq(crmOpportunityHistory.tenantId, TEST_TENANT));
    await db
      .delete(crmOpportunityLineItems)
      .where(eq(crmOpportunityLineItems.tenantId, TEST_TENANT));
    await db.delete(crmOpportunities).where(eq(crmOpportunities.tenantId, TEST_TENANT));
    await db.delete(crmPipelineStages).where(eq(crmPipelineStages.tenantId, TEST_TENANT));
    await db.delete(quotationLines).where(eq(quotationLines.tenantId, TEST_TENANT));
    await db.delete(quotations).where(eq(quotations.tenantId, TEST_TENANT));
    await db.delete(items).where(eq(items.tenantId, TEST_TENANT));
    await db.delete(units).where(eq(units.tenantId, TEST_TENANT));
    await db.delete(customers).where(eq(customers.tenantId, TEST_TENANT));
    await db.delete(branches).where(eq(branches.tenantId, TEST_TENANT));
  });

  describe('getStages', () => {
    it('falls back to the hardcoded default stage set when the tenant has zero custom rows', async () => {
      const stages = await OpportunityService.getStages(db, TEST_TENANT);
      expect(stages.map((s) => s.code)).toEqual([
        'NEW',
        'QUALIFICATION',
        'PROPOSAL',
        'NEGOTIATION',
        'WON',
        'LOST',
      ]);
      expect(stages.find((s) => s.code === 'WON')?.isWon).toBe(true);
      expect(stages.find((s) => s.code === 'LOST')?.isLost).toBe(true);
    });
  });

  describe('create', () => {
    it('creates an opportunity in the first non-terminal stage and records a CREATED history row', async () => {
      const created = await OpportunityService.create(db, {
        tenantId: TEST_TENANT,
        name: 'New Wholesale Deal',
        value: 50_000,
        customerId,
        createdBy: 1,
      });
      expect(created.stage).toBe('NEW');
      expect(created.probability).toBe(10);

      const history = await db
        .select()
        .from(crmOpportunityHistory)
        .where(eq(crmOpportunityHistory.opportunityId, created.id));
      expect(history).toHaveLength(1);
      expect(history[0]!.activityType).toBe('CREATED');
    });
  });

  describe('changeStage — exit criteria', () => {
    it('rejects marking Lost without a reason', async () => {
      const opp = await OpportunityService.create(db, {
        tenantId: TEST_TENANT,
        name: 'Deal A',
        value: 10_000,
        customerId,
        createdBy: 1,
      });
      await expect(
        OpportunityService.changeStage(db, TEST_TENANT, 1, opp.id, {
          toStageCode: 'LOST',
          version: 0,
        })
      ).rejects.toThrow(BusinessError);
    });

    it('accepts marking Lost with a reason, sets lostAt/lostReason, and logs a LOST history row', async () => {
      const opp = await OpportunityService.create(db, {
        tenantId: TEST_TENANT,
        name: 'Deal B',
        value: 10_000,
        customerId,
        createdBy: 1,
      });
      const updated = await OpportunityService.changeStage(db, TEST_TENANT, 1, opp.id, {
        toStageCode: 'LOST',
        version: 0,
        lostReason: 'Went with a competitor',
      });
      expect(updated.stage).toBe('LOST');
      expect(updated.lostReason).toBe('Went with a competitor');
      expect(updated.lostAt).not.toBeNull();
    });

    it('rejects marking Won with zero line items', async () => {
      const opp = await OpportunityService.create(db, {
        tenantId: TEST_TENANT,
        name: 'Deal C',
        value: 10_000,
        customerId,
        createdBy: 1,
      });
      await expect(
        OpportunityService.changeStage(db, TEST_TENANT, 1, opp.id, {
          toStageCode: 'WON',
          version: 0,
        })
      ).rejects.toThrow(BusinessError);
    });

    it('accepts marking Won once at least one line item exists', async () => {
      const opp = await OpportunityService.create(db, {
        tenantId: TEST_TENANT,
        name: 'Deal D',
        value: 10_000,
        customerId,
        createdBy: 1,
      });
      await OpportunityService.addLineItem(db, TEST_TENANT, opp.id, {
        itemId,
        quantity: 1,
        unitPrice: 500,
      });
      const updated = await OpportunityService.changeStage(db, TEST_TENANT, 1, opp.id, {
        toStageCode: 'WON',
        version: 0,
      });
      expect(updated.stage).toBe('WON');
      expect(updated.probability).toBe(100);
    });

    it('rejects a stale version with OptimisticLockError', async () => {
      const opp = await OpportunityService.create(db, {
        tenantId: TEST_TENANT,
        name: 'Deal E',
        value: 10_000,
        customerId,
        createdBy: 1,
      });
      await expect(
        OpportunityService.changeStage(db, TEST_TENANT, 1, opp.id, {
          toStageCode: 'QUALIFICATION',
          version: 99,
        })
      ).rejects.toThrow(OptimisticLockError);
    });

    it('rejects changing the stage of an already-closed (Won/Lost) opportunity', async () => {
      const opp = await OpportunityService.create(db, {
        tenantId: TEST_TENANT,
        name: 'Deal F',
        value: 10_000,
        customerId,
        createdBy: 1,
      });
      await OpportunityService.changeStage(db, TEST_TENANT, 1, opp.id, {
        toStageCode: 'LOST',
        version: 0,
        lostReason: 'Budget cut',
      });
      await expect(
        OpportunityService.changeStage(db, TEST_TENANT, 1, opp.id, {
          toStageCode: 'NEW',
          version: 1,
        })
      ).rejects.toThrow(BusinessError);
    });
  });

  describe('markWon — atomic Won→Quotation handoff', () => {
    it('creates a real quotation from the opportunity line items, sets convertedQuotationId, and reaches WON', async () => {
      const opp = await OpportunityService.create(db, {
        tenantId: TEST_TENANT,
        name: 'Winnable Deal',
        value: 5_000,
        customerId,
        createdBy: 1,
      });
      await OpportunityService.addLineItem(db, TEST_TENANT, opp.id, {
        itemId,
        quantity: 10,
        unitPrice: 500,
      });

      const result = await OpportunityService.markWon(db, TEST_TENANT, 1, opp.id, {
        version: 0,
        branchId: branchA,
        placeOfSupply: '27',
        sellerStateCode: '27',
        validUntil: new Date(Date.now() + 30 * 86_400_000),
      });

      expect(result.opportunity.stage).toBe('WON');
      expect(result.opportunity.convertedQuotationId).toBe(result.quotationId);

      const lines = await db
        .select()
        .from(quotationLines)
        .where(eq(quotationLines.quotationId, result.quotationId));
      expect(lines).toHaveLength(1);
      expect(lines[0]!.itemId).toBe(itemId);
      // gstRate/hsnCode were sourced fresh from `items` at Won-time, matching the seeded item.
      expect(lines[0]!.gstRate).toBe('12.00');
      expect(lines[0]!.hsnCode).toBe('5208');
    });

    it('rolls back the stage change too when quotation creation fails mid-handoff (single atomic operation)', async () => {
      const opp = await OpportunityService.create(db, {
        tenantId: TEST_TENANT,
        name: 'Deal With Blocked Customer',
        value: 5_000,
        customerId: blockedCustomerId,
        createdBy: 1,
      });
      await OpportunityService.addLineItem(db, TEST_TENANT, opp.id, {
        itemId,
        quantity: 1,
        unitPrice: 500,
      });

      await expect(
        OpportunityService.markWon(db, TEST_TENANT, 1, opp.id, {
          version: 0,
          branchId: branchA,
          placeOfSupply: '27',
          sellerStateCode: '27',
          validUntil: new Date(Date.now() + 30 * 86_400_000),
        })
      ).rejects.toThrow(BusinessError); // QuotationService.create() rejects a BLOCKED customer

      const [reloaded] = await db
        .select()
        .from(crmOpportunities)
        .where(eq(crmOpportunities.id, opp.id));
      // Still NEW, not WON — the failed quotation creation rolled back the stage change with it.
      expect(reloaded!.stage).toBe('NEW');
      expect(reloaded!.convertedQuotationId).toBeNull();
    });

    it('rejects marking Won when the opportunity has no linked customer', async () => {
      const opp = await OpportunityService.create(db, {
        tenantId: TEST_TENANT,
        name: 'No Customer Deal',
        value: 5_000,
        createdBy: 1,
      });
      await OpportunityService.addLineItem(db, TEST_TENANT, opp.id, {
        itemId,
        quantity: 1,
        unitPrice: 500,
      });
      await expect(
        OpportunityService.markWon(db, TEST_TENANT, 1, opp.id, {
          version: 0,
          branchId: branchA,
          placeOfSupply: '27',
          sellerStateCode: '27',
          validUntil: new Date(Date.now() + 30 * 86_400_000),
        })
      ).rejects.toThrow(BusinessError);
    });
  });

  describe('list — branch scoping (AR-6)', () => {
    it("a branch-restricted caller sees their branch + unassigned opportunities, never another branch's", async () => {
      const oppA = await OpportunityService.create(db, {
        tenantId: TEST_TENANT,
        name: 'Branch A Deal',
        value: 1_000,
        branchId: branchA,
        createdBy: 1,
      });
      const oppB = await OpportunityService.create(db, {
        tenantId: TEST_TENANT,
        name: 'Branch B Deal',
        value: 1_000,
        branchId: branchB,
        createdBy: 1,
      });
      const oppUnassigned = await OpportunityService.create(db, {
        tenantId: TEST_TENANT,
        name: 'Unassigned Deal',
        value: 1_000,
        createdBy: 1,
      });

      const scopedToA = await OpportunityService.list(db, TEST_TENANT, [branchA]);
      const scopedIds = scopedToA.map((o) => o.id);
      expect(scopedIds).toContain(oppA.id);
      expect(scopedIds).toContain(oppUnassigned.id);
      expect(scopedIds).not.toContain(oppB.id);

      const unscoped = await OpportunityService.list(db, TEST_TENANT, 'all');
      const unscopedIds = unscoped.map((o) => o.id);
      expect(unscopedIds).toContain(oppA.id);
      expect(unscopedIds).toContain(oppB.id);
      expect(unscopedIds).toContain(oppUnassigned.id);
    });
  });
});
