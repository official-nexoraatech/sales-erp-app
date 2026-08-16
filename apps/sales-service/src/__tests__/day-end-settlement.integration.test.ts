/**
 * Multi-vertical platform audit 2026-08-16, Phase 3 — store-wide Z-report/day-end settlement.
 * Proves the real aggregation (payments-by-mode, invoice tax/discount excluding CANCELLED,
 * refunds, cash totals) and the open-session guard / once-per-day immutability against a real
 * database — DayEndSettlementService has no pure half worth isolating (every branch depends on
 * a DB query), so this is the only test suite for it.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createDatabaseClient } from '@erp/db';
import {
  posSessions,
  posDayEndSettlements,
  payments,
  paymentAllocations,
  invoices,
  saleReturns,
} from '@erp/db';
import { eq } from 'drizzle-orm';
import { BusinessError, ValidationError } from '@erp/types';
import { DuplicateOperationError } from '@erp/sdk';
import { DayEndSettlementService } from '../domain/DayEndSettlementService.js';

const DB_URL = process.env['DATABASE_URL'];

describe.skipIf(!DB_URL)('DayEndSettlementService — integration', () => {
  let db: ReturnType<typeof createDatabaseClient>;
  const TEST_TENANT = 909_001 + Math.floor(Math.random() * 1000);
  const BRANCH_ID = 1;
  const WAREHOUSE_ID = 1;
  const CUSTOMER_ID = 1;
  // Fixed past date so this suite never collides with "today" across repeated runs, and never
  // straddles a real calendar-day boundary mid-test.
  const BUSINESS_DATE = '2025-03-10';
  const dayStart = new Date(`${BUSINESS_DATE}T09:00:00.000Z`);

  beforeAll(async () => {
    db = createDatabaseClient({ url: DB_URL! });
  });

  afterAll(async () => {
    await db.delete(posDayEndSettlements).where(eq(posDayEndSettlements.tenantId, TEST_TENANT));
    await db.delete(paymentAllocations).where(eq(paymentAllocations.tenantId, TEST_TENANT));
    await db.delete(payments).where(eq(payments.tenantId, TEST_TENANT));
    await db.delete(saleReturns).where(eq(saleReturns.tenantId, TEST_TENANT));
    await db.delete(invoices).where(eq(invoices.tenantId, TEST_TENANT));
    await db.delete(posSessions).where(eq(posSessions.tenantId, TEST_TENANT));
  });

  it('rejects a malformed businessDate', async () => {
    await expect(
      DayEndSettlementService.generate(db, TEST_TENANT, BRANCH_ID, '10-03-2025', 1)
    ).rejects.toThrow(ValidationError);
  });

  it('blocks generation while any session opened that day is still OPEN', async () => {
    await db.insert(posSessions).values([
      {
        tenantId: TEST_TENANT,
        branchId: BRANCH_ID,
        warehouseId: WAREHOUSE_ID,
        sessionNumber: `TEST-OPEN-${TEST_TENANT}`,
        status: 'CLOSED',
        openedBy: 1,
        openingCash: '500',
        closingCash: '500',
        expectedCash: '500',
        cashVariance: '0',
        openedAt: dayStart,
        closedAt: dayStart,
      },
      {
        tenantId: TEST_TENANT,
        branchId: BRANCH_ID,
        warehouseId: WAREHOUSE_ID,
        sessionNumber: `TEST-STILL-OPEN-${TEST_TENANT}`,
        status: 'OPEN',
        openedBy: 1,
        openingCash: '200',
        openedAt: dayStart,
      },
    ]);

    await expect(
      DayEndSettlementService.generate(db, TEST_TENANT, BRANCH_ID, BUSINESS_DATE, 1)
    ).rejects.toThrow(BusinessError);

    // Clean up so the next test's session set for this branch+date starts fresh.
    await db.delete(posSessions).where(eq(posSessions.tenantId, TEST_TENANT));
  });

  it('aggregates payments-by-mode, invoice tax/discount (excluding CANCELLED), refunds, and cash totals across every closed session for the day — then refuses a second generation for the same day', async () => {
    const [session1, session2] = await db
      .insert(posSessions)
      .values([
        {
          tenantId: TEST_TENANT,
          branchId: BRANCH_ID,
          warehouseId: WAREHOUSE_ID,
          sessionNumber: `TEST-S1-${TEST_TENANT}`,
          status: 'CLOSED',
          openedBy: 1,
          closedBy: 1,
          openingCash: '500',
          closingCash: '615',
          expectedCash: '610',
          cashVariance: '5',
          totalSales: '110',
          totalTransactions: 1,
          openedAt: dayStart,
          closedAt: dayStart,
        },
        {
          tenantId: TEST_TENANT,
          branchId: BRANCH_ID,
          warehouseId: WAREHOUSE_ID,
          sessionNumber: `TEST-S2-${TEST_TENANT}`,
          status: 'CLOSED',
          openedBy: 2,
          closedBy: 2,
          openingCash: '300',
          closingCash: '300',
          expectedCash: '300',
          cashVariance: '0',
          totalSales: '218',
          totalTransactions: 1,
          openedAt: dayStart,
          closedAt: dayStart,
        },
      ])
      .returning();

    const [inv1, inv2, invCancelled] = await db
      .insert(invoices)
      .values([
        {
          tenantId: TEST_TENANT,
          branchId: BRANCH_ID,
          warehouseId: WAREHOUSE_ID,
          invoiceNumber: `TEST-INV1-${TEST_TENANT}`,
          status: 'PAID',
          customerId: CUSTOMER_ID,
          placeOfSupply: '27',
          invoiceDate: dayStart,
          dueDate: dayStart,
          discountAmount: '10',
          cgstAmount: '5',
          sgstAmount: '5',
          grandTotal: '110',
          createdBy: 1,
        },
        {
          tenantId: TEST_TENANT,
          branchId: BRANCH_ID,
          warehouseId: WAREHOUSE_ID,
          invoiceNumber: `TEST-INV2-${TEST_TENANT}`,
          status: 'CONFIRMED',
          customerId: CUSTOMER_ID,
          placeOfSupply: '27',
          invoiceDate: dayStart,
          dueDate: dayStart,
          discountAmount: '0',
          cgstAmount: '9',
          sgstAmount: '9',
          grandTotal: '218',
          createdBy: 1,
        },
        {
          tenantId: TEST_TENANT,
          branchId: BRANCH_ID,
          warehouseId: WAREHOUSE_ID,
          invoiceNumber: `TEST-INV3-CANCELLED-${TEST_TENANT}`,
          status: 'CANCELLED',
          customerId: CUSTOMER_ID,
          placeOfSupply: '27',
          invoiceDate: dayStart,
          dueDate: dayStart,
          grandTotal: '999',
          createdBy: 1,
        },
      ])
      .returning();

    const [pay1, pay2, pay3] = await db
      .insert(payments)
      .values([
        {
          tenantId: TEST_TENANT,
          branchId: BRANCH_ID,
          paymentNumber: `TEST-PAY1-${TEST_TENANT}`,
          customerId: CUSTOMER_ID,
          paymentDate: dayStart,
          paymentMode: 'CASH',
          amount: '110',
          posSessionId: session1!.id,
          createdBy: 1,
        },
        {
          tenantId: TEST_TENANT,
          branchId: BRANCH_ID,
          paymentNumber: `TEST-PAY2-${TEST_TENANT}`,
          customerId: CUSTOMER_ID,
          paymentDate: dayStart,
          paymentMode: 'CARD',
          amount: '218',
          posSessionId: session2!.id,
          createdBy: 1,
        },
        // Cash was actually collected against this invoice before it was later cancelled (no
        // refund payment recorded) — the CASH total below must still include it even though
        // totalSales/totalTax/totalDiscount correctly exclude the cancelled invoice.
        {
          tenantId: TEST_TENANT,
          branchId: BRANCH_ID,
          paymentNumber: `TEST-PAY3-${TEST_TENANT}`,
          customerId: CUSTOMER_ID,
          paymentDate: dayStart,
          paymentMode: 'CASH',
          amount: '999',
          posSessionId: session1!.id,
          createdBy: 1,
        },
      ])
      .returning();

    await db.insert(paymentAllocations).values([
      {
        paymentId: pay1!.id,
        invoiceId: inv1!.id,
        tenantId: TEST_TENANT,
        amount: '110',
        allocatedBy: 1,
      },
      {
        paymentId: pay2!.id,
        invoiceId: inv2!.id,
        tenantId: TEST_TENANT,
        amount: '218',
        allocatedBy: 1,
      },
      {
        paymentId: pay3!.id,
        invoiceId: invCancelled!.id,
        tenantId: TEST_TENANT,
        amount: '999',
        allocatedBy: 1,
      },
    ]);

    await db.insert(saleReturns).values({
      tenantId: TEST_TENANT,
      branchId: BRANCH_ID,
      returnNumber: `TEST-RET1-${TEST_TENANT}`,
      invoiceId: inv1!.id,
      customerId: CUSTOMER_ID,
      status: 'APPROVED',
      returnDate: dayStart,
      reason: 'OTHER',
      totalAmount: '20',
      createdBy: 1,
    });

    const settlement = await DayEndSettlementService.generate(
      db,
      TEST_TENANT,
      BRANCH_ID,
      BUSINESS_DATE,
      1
    );

    expect(settlement.sessionCount).toBe(2);
    expect(settlement.totalTransactions).toBe(2); // inv1 + inv2, cancelled invCancelled excluded
    expect(settlement.totalSales).toBe('328.00'); // 110 + 218, excludes the 999 cancelled invoice
    expect(settlement.totalDiscount).toBe('10.00');
    expect(settlement.totalTax).toBe('28.00'); // (5+5) + (9+9)
    expect(settlement.totalRefunds).toBe('20.00');
    expect(settlement.refundCount).toBe(1);
    expect(settlement.paymentModeBreakdown).toEqual({ CASH: '1109.00', CARD: '218.00' }); // 110+999
    expect(settlement.openingCashTotal).toBe('800.00'); // 500 + 300
    expect(settlement.closingCashTotal).toBe('915.00'); // 615 + 300
    expect(settlement.cashVarianceTotal).toBe('5.00');
    expect(new Set(settlement.sessionIds)).toEqual(new Set([session1!.id, session2!.id]));

    // A real Z-reading can only be taken once for a given branch+day.
    await expect(
      DayEndSettlementService.generate(db, TEST_TENANT, BRANCH_ID, BUSINESS_DATE, 1)
    ).rejects.toThrow(DuplicateOperationError);
  });

  it('list() returns generated settlements newest-businessDate-first, scoped to the tenant', async () => {
    const { content, totalElements } = await DayEndSettlementService.list(
      db,
      TEST_TENANT,
      'all',
      1,
      20
    );
    expect(totalElements).toBe(1);
    expect(content[0]!.businessDate).toBe(BUSINESS_DATE);
  });
});
