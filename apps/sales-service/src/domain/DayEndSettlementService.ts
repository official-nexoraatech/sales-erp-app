import { and, desc, eq, gte, inArray, lte, sql } from 'drizzle-orm';
import {
  posSessions,
  posDayEndSettlements,
  payments,
  paymentAllocations,
  invoices,
  saleReturns,
  type PosDayEndSettlement,
} from '@erp/db';
import type { ErpDatabase } from '@erp/db';
import { BusinessError, ValidationError } from '@erp/types';
import { withIdempotentInsert } from '@erp/sdk';

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

const BUSINESS_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// A session's whole cash-drawer lifecycle is attributed to the calendar day it opened on
// (matches this codebase's existing "day" convention — see ReportsEngine.ts/usageRollup.ts),
// even if it closes past midnight.
function dayRange(businessDate: string): { start: Date; end: Date } {
  return {
    start: new Date(`${businessDate}T00:00:00.000Z`),
    end: new Date(`${businessDate}T23:59:59.999Z`),
  };
}

// Multi-vertical platform audit 2026-08-16, Phase 3: posSessions only ever tracked one till's
// cash reconciliation — a store manager had no single, store-wide view (payment-mode split,
// tax/discount totals, refunds) across every till for a business day. This aggregates the
// day's already-closed sessions into one immutable settlement row (see posDayEndSettlements'
// unique constraint) — a real Z-reading, not a re-runnable report.
export class DayEndSettlementService {
  static async generate(
    db: ErpDatabase,
    tenantId: number,
    branchId: number,
    businessDate: string,
    userId: number
  ): Promise<PosDayEndSettlement> {
    if (!BUSINESS_DATE_RE.test(businessDate)) {
      throw new ValidationError('businessDate must be in YYYY-MM-DD format');
    }
    const { start, end } = dayRange(businessDate);

    const sessions = await db
      .select()
      .from(posSessions)
      .where(
        and(
          eq(posSessions.tenantId, tenantId),
          eq(posSessions.branchId, branchId),
          gte(posSessions.openedAt, start),
          lte(posSessions.openedAt, end)
        )
      );

    const openSessions = sessions.filter((s) => s.status !== 'CLOSED');
    if (openSessions.length > 0) {
      throw new BusinessError(
        'SESSIONS_STILL_OPEN',
        `${openSessions.length} session(s) opened on ${businessDate} are still open — close every till before generating the day-end settlement`
      );
    }
    const sessionIds = sessions.map((s) => s.id);

    // Sourced from payments/invoices (the transactional source of truth), not from
    // posSessions.totalSales — that running counter is incremented at sale time and never
    // decremented on a later cancellation, so it can drift from what actually settled.
    const paymentModeBreakdown: Record<string, string> = {};
    let totalSales = 0;
    let totalDiscount = 0;
    let totalTax = 0;
    let totalTransactions = 0;

    if (sessionIds.length > 0) {
      // Deliberately NOT filtered by the underlying invoice's status: this is a cash-drawer
      // reconciliation figure (what was physically collected at the till), which is not the
      // same question as "net revenue" below — a payment taken against an invoice that was
      // later cancelled (with no separate refund payment recorded) still needs to reconcile
      // against the cash actually in the drawer.
      const paymentRows = await db
        .select({ paymentMode: payments.paymentMode, total: sql<string>`sum(${payments.amount})` })
        .from(payments)
        .where(and(eq(payments.tenantId, tenantId), inArray(payments.posSessionId, sessionIds)))
        .groupBy(payments.paymentMode);
      for (const r of paymentRows) {
        paymentModeBreakdown[r.paymentMode] = round2(parseFloat(r.total)).toFixed(2);
      }

      const invoiceIdRows = await db
        .selectDistinct({ invoiceId: paymentAllocations.invoiceId })
        .from(paymentAllocations)
        .innerJoin(payments, eq(paymentAllocations.paymentId, payments.id))
        .where(and(eq(payments.tenantId, tenantId), inArray(payments.posSessionId, sessionIds)));
      const invoiceIds = invoiceIdRows.map((r) => r.invoiceId);

      if (invoiceIds.length > 0) {
        const [agg] = await db
          .select({
            totalSales: sql<string>`coalesce(sum(${invoices.grandTotal}), 0)`,
            totalDiscount: sql<string>`coalesce(sum(${invoices.discountAmount}), 0)`,
            totalTax: sql<string>`coalesce(sum(${invoices.cgstAmount} + ${invoices.sgstAmount} + ${invoices.igstAmount} + ${invoices.cessAmount}), 0)`,
            count: sql<number>`count(*)::int`,
          })
          .from(invoices)
          .where(
            and(
              eq(invoices.tenantId, tenantId),
              inArray(invoices.id, invoiceIds),
              sql`${invoices.status} != 'CANCELLED'`
            )
          );
        totalSales = round2(parseFloat(agg?.totalSales ?? '0'));
        totalDiscount = round2(parseFloat(agg?.totalDiscount ?? '0'));
        totalTax = round2(parseFloat(agg?.totalTax ?? '0'));
        totalTransactions = agg?.count ?? 0;
      }
    }

    // Sale returns carry no posSessionId (a pre-existing gap — refunds are never attributed
    // to a till), so refunds are matched to the branch+businessDate instead, same boundary a
    // store manager would use to reconcile "today's refunds" by hand.
    const [refundAgg] = await db
      .select({
        totalRefunds: sql<string>`coalesce(sum(${saleReturns.totalAmount}), 0)`,
        count: sql<number>`count(*)::int`,
      })
      .from(saleReturns)
      .where(
        and(
          eq(saleReturns.tenantId, tenantId),
          eq(saleReturns.branchId, branchId),
          eq(saleReturns.status, 'APPROVED'),
          gte(saleReturns.returnDate, start),
          lte(saleReturns.returnDate, end)
        )
      );
    const totalRefunds = round2(parseFloat(refundAgg?.totalRefunds ?? '0'));
    const refundCount = refundAgg?.count ?? 0;

    const openingCashTotal = round2(
      sessions.reduce((s, x) => s + parseFloat(String(x.openingCash)), 0)
    );
    const closingCashTotal = round2(
      sessions.reduce((s, x) => s + parseFloat(String(x.closingCash ?? '0')), 0)
    );
    const expectedCashTotal = round2(
      sessions.reduce((s, x) => s + parseFloat(String(x.expectedCash ?? '0')), 0)
    );
    const cashVarianceTotal = round2(
      sessions.reduce((s, x) => s + parseFloat(String(x.cashVariance ?? '0')), 0)
    );

    const [row] = await withIdempotentInsert(
      () =>
        db
          .insert(posDayEndSettlements)
          .values({
            tenantId,
            branchId,
            businessDate,
            sessionIds,
            sessionCount: sessions.length,
            totalTransactions,
            totalSales: String(totalSales),
            totalDiscount: String(totalDiscount),
            totalTax: String(totalTax),
            totalRefunds: String(totalRefunds),
            refundCount,
            paymentModeBreakdown,
            openingCashTotal: String(openingCashTotal),
            closingCashTotal: String(closingCashTotal),
            expectedCashTotal: String(expectedCashTotal),
            cashVarianceTotal: String(cashVarianceTotal),
            generatedBy: userId,
          })
          .returning(),
      'pos_day_end_settlements_tenant_branch_date',
      `${branchId}:${businessDate}`,
      'PosDayEndSettlement'
    );
    if (!row)
      throw new BusinessError('SETTLEMENT_CREATE_FAILED', 'Day-end settlement creation failed');
    return row;
  }

  static async list(
    db: ErpDatabase,
    tenantId: number,
    branchIds: number[] | 'all',
    page: number,
    pageSize: number
  ): Promise<{ content: PosDayEndSettlement[]; totalElements: number }> {
    const conditions = [eq(posDayEndSettlements.tenantId, tenantId)];
    if (branchIds !== 'all') conditions.push(inArray(posDayEndSettlements.branchId, branchIds));

    const content = await db
      .select()
      .from(posDayEndSettlements)
      .where(and(...conditions))
      .orderBy(desc(posDayEndSettlements.businessDate), desc(posDayEndSettlements.id))
      .limit(pageSize)
      .offset((page - 1) * pageSize);

    const [countRow] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(posDayEndSettlements)
      .where(and(...conditions));

    return { content, totalElements: countRow?.count ?? 0 };
  }
}
