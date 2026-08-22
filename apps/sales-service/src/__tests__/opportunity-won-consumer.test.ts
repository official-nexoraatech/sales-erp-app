// CRM/O2C split — the async half of OpportunityService.markWon()'s outbox redesign (see
// OpportunityWonConsumer.ts's own header comment). No dedicated consumer test existed before
// this file (the old, now-split opportunity-service.test.ts tested the full markWon->consumer
// pipeline in one integration test); this fills that gap directly, mirroring
// whatsapp-order-consumer.test.ts's pattern — a manually-constructed event payload (since
// OpportunityService itself now lives in crm-service) rather than deriving it from a real
// markWon() call.
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
} from '@erp/db';
import { eq } from 'drizzle-orm';
import { TenantScopedDatabase } from '@erp/sdk';
import type { ERPEventPayload } from '@erp/types';
import { BusinessError } from '@erp/types';
import { handleOpportunityWon } from '../consumers/OpportunityWonConsumer.js';

const DB_URL = process.env['DATABASE_URL'];

function makeEvent(payload: Record<string, unknown>): ERPEventPayload {
  return {
    eventId: 'test-event',
    eventType: 'OPPORTUNITY_WON',
    schemaVersion: 1,
    aggregateType: 'crm_opportunity',
    aggregateId: (payload['opportunityId'] as number) ?? 0,
    tenantId: payload['tenantId'] as number,
    userId: payload['userId'] as number,
    correlationId: 'test-event',
    causationId: 'test-event',
    occurredAt: new Date().toISOString(),
    payload,
  };
}

describe.skipIf(!DB_URL)('handleOpportunityWon — integration', () => {
  let db: ReturnType<typeof createDatabaseClient>;
  const TEST_TENANT = 900_960 + Math.floor(Math.random() * 1000);
  let branchId: number;
  let customerId: number;
  let blockedCustomerId: number;
  let itemId: number;

  beforeAll(async () => {
    db = createDatabaseClient({ url: DB_URL! });
    const [branch] = await db
      .insert(branches)
      .values({
        tenantId: TEST_TENANT,
        name: 'Consumer Test Branch',
        code: 'OWCB',
        isHeadOffice: true,
        isActive: true,
        createdBy: 1,
      })
      .returning();
    branchId = branch!.id;

    const [customer] = await db
      .insert(customers)
      .values({
        tenantId: TEST_TENANT,
        branchId,
        displayName: 'Consumer Test Customer',
        phone: '9500009991',
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
        branchId,
        displayName: 'Consumer Test Blocked Customer',
        phone: '9500009992',
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
        name: 'Consumer Test Item',
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
    await db.delete(quotationLines).where(eq(quotationLines.tenantId, TEST_TENANT));
    await db.delete(quotations).where(eq(quotations.tenantId, TEST_TENANT));
    await db.delete(crmOpportunities).where(eq(crmOpportunities.tenantId, TEST_TENANT));
    await db.delete(items).where(eq(items.tenantId, TEST_TENANT));
    await db.delete(units).where(eq(units.tenantId, TEST_TENANT));
    await db.delete(customers).where(eq(customers.tenantId, TEST_TENANT));
    await db.delete(branches).where(eq(branches.tenantId, TEST_TENANT));
  });

  it('creates the real quotation and writes convertedQuotationId back onto the opportunity', async () => {
    const [opp] = await db
      .insert(crmOpportunities)
      .values({
        tenantId: TEST_TENANT,
        name: 'Consumer Test Deal',
        stage: 'WON',
        probability: 100,
        value: '5000',
        customerId,
        branchId,
        createdBy: 1,
      })
      .returning();

    const tsDb = new TenantScopedDatabase(TEST_TENANT, db);
    await handleOpportunityWon(
      makeEvent({
        opportunityId: opp!.id,
        tenantId: TEST_TENANT,
        userId: 1,
        branchId,
        customerId,
        placeOfSupply: '27',
        sellerStateCode: '27',
        validUntil: new Date(Date.now() + 30 * 86_400_000).toISOString(),
        quotationNumber: `QT-TEST-${opp!.id}`,
        notes: 'Consumer test',
        lines: [{ itemId, quantity: 10, unitPrice: 500, gstRate: 12, hsnCode: '5208' }],
      }),
      tsDb
    );

    const [reloaded] = await db
      .select()
      .from(crmOpportunities)
      .where(eq(crmOpportunities.id, opp!.id));
    expect(reloaded!.convertedQuotationId).not.toBeNull();

    const lines = await db
      .select()
      .from(quotationLines)
      .where(eq(quotationLines.quotationId, reloaded!.convertedQuotationId!));
    expect(lines).toHaveLength(1);
    expect(lines[0]!.itemId).toBe(itemId);
    expect(lines[0]!.gstRate).toBe('12.00');
    expect(lines[0]!.hsnCode).toBe('5208');
  });

  it('is idempotent — replaying the event for an already-converted opportunity does not create a second quotation', async () => {
    const [opp] = await db
      .insert(crmOpportunities)
      .values({
        tenantId: TEST_TENANT,
        name: 'Consumer Test Idempotent Deal',
        stage: 'WON',
        probability: 100,
        value: '5000',
        customerId,
        branchId,
        createdBy: 1,
      })
      .returning();

    const event = makeEvent({
      opportunityId: opp!.id,
      tenantId: TEST_TENANT,
      userId: 1,
      branchId,
      customerId,
      placeOfSupply: '27',
      sellerStateCode: '27',
      validUntil: new Date(Date.now() + 30 * 86_400_000).toISOString(),
      quotationNumber: `QT-TEST-IDEMPOTENT-${opp!.id}`,
      notes: 'Consumer test',
      lines: [{ itemId, quantity: 1, unitPrice: 500, gstRate: 12, hsnCode: '5208' }],
    });
    const tsDb = new TenantScopedDatabase(TEST_TENANT, db);
    await handleOpportunityWon(event, tsDb);
    const [afterFirst] = await db
      .select()
      .from(crmOpportunities)
      .where(eq(crmOpportunities.id, opp!.id));

    await handleOpportunityWon(event, tsDb);
    const [afterSecond] = await db
      .select()
      .from(crmOpportunities)
      .where(eq(crmOpportunities.id, opp!.id));

    expect(afterSecond!.convertedQuotationId).toBe(afterFirst!.convertedQuotationId);
    const quotationsForOpp = await db
      .select()
      .from(quotations)
      .where(eq(quotations.id, afterFirst!.convertedQuotationId!));
    expect(quotationsForOpp).toHaveLength(1);
  });

  it('throws (and leaves convertedQuotationId null) when the customer is blocked — the accepted post-split gap, not a rollback', async () => {
    const [opp] = await db
      .insert(crmOpportunities)
      .values({
        tenantId: TEST_TENANT,
        name: 'Consumer Test Blocked Deal',
        stage: 'WON',
        probability: 100,
        value: '5000',
        customerId: blockedCustomerId,
        branchId,
        createdBy: 1,
      })
      .returning();

    const tsDb = new TenantScopedDatabase(TEST_TENANT, db);
    await expect(
      handleOpportunityWon(
        makeEvent({
          opportunityId: opp!.id,
          tenantId: TEST_TENANT,
          userId: 1,
          branchId,
          customerId: blockedCustomerId,
          placeOfSupply: '27',
          sellerStateCode: '27',
          validUntil: new Date(Date.now() + 30 * 86_400_000).toISOString(),
          quotationNumber: `QT-TEST-BLOCKED-${opp!.id}`,
          notes: 'Consumer test',
          lines: [{ itemId, quantity: 1, unitPrice: 500, gstRate: 12, hsnCode: '5208' }],
        }),
        tsDb
      )
    ).rejects.toThrow(BusinessError);

    const [reloaded] = await db
      .select()
      .from(crmOpportunities)
      .where(eq(crmOpportunities.id, opp!.id));
    expect(reloaded!.stage).toBe('WON');
    expect(reloaded!.convertedQuotationId).toBeNull();
  });
});
