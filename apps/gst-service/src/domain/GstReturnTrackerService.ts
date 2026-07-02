import { eq, and } from 'drizzle-orm';
import type { TenantScopedDatabase } from '@erp/sdk';
import { gstReturnFilings } from '@erp/db';
import { createLogger } from '@erp/logger';
import { NotFoundError } from '@erp/types';

const logger = createLogger({ serviceName: 'gst-service' });

type ReturnType = 'GSTR1' | 'GSTR3B' | 'GSTR9' | 'GSTR9C';

export interface ReturnCalendarEntry {
  returnType: ReturnType;
  period: string; // YYYY-MM
  dueDate: string; // YYYY-MM-DD
  status: 'PENDING' | 'FILED' | 'LATE_FILED' | 'NIL_FILED';
  filedDate: string | null;
  isOverdue: boolean;
  daysOverdue: number;
  referenceNumber: string | null;
}

export class GstReturnTrackerService {
  // Get filing calendar for a financial year (e.g. 2025-26 → Apr 2025 to Mar 2026)
  static async getCalendar(
    db: TenantScopedDatabase,
    tenantId: number,
    fy: string // "2025-26"
  ): Promise<ReturnCalendarEntry[]> {
    const [startYear] = fy.split('-');
    if (!startYear) throw new Error('Invalid FY format. Use YYYY-YY (e.g. 2025-26)');

    const fyStart = parseInt(startYear, 10);
    const periods = GstReturnTrackerService.getPeriodsForFy(fyStart);

    // Upsert all return entries (ensure they exist in DB)
    for (const period of periods) {
      for (const returnType of ['GSTR1', 'GSTR3B'] as ReturnType[]) {
        const dueDate = GstReturnTrackerService.getDueDate(returnType, period);
        await db.raw.insert(gstReturnFilings).values({
          tenantId,
          returnType,
          period,
          dueDate,
          status: 'PENDING',
        }).onConflictDoNothing();
      }
    }

    // Annual returns (GSTR-9 due 31 Dec of the following year)
    const gstr9Due = `${fyStart + 1}-12-31`;
    const gstr9Period = `${fyStart + 1}-03`; // March of the FY
    await db.raw.insert(gstReturnFilings).values({
      tenantId,
      returnType: 'GSTR9',
      period: gstr9Period,
      dueDate: gstr9Due,
      status: 'PENDING',
    }).onConflictDoNothing();

    const filings = await db.raw
      .select()
      .from(gstReturnFilings)
      .where(eq(gstReturnFilings.tenantId, tenantId))
      .orderBy(gstReturnFilings.period, gstReturnFilings.returnType);

    const today = new Date().toISOString().substring(0, 10);
    return filings.map((f) => {
      const due = String(f.dueDate);
      const isOverdue = f.status === 'PENDING' && today > due;
      const daysOverdue = isOverdue
        ? Math.floor((Date.now() - new Date(due).getTime()) / 86400000)
        : 0;
      return {
        returnType: f.returnType as ReturnType,
        period: f.period,
        dueDate: due,
        status: f.status as ReturnCalendarEntry['status'],
        filedDate: f.filedDate ? String(f.filedDate) : null,
        isOverdue,
        daysOverdue,
        referenceNumber: f.referenceNumber,
      };
    });
  }

  static async markFiled(
    db: TenantScopedDatabase,
    tenantId: number,
    userId: number,
    returnType: ReturnType,
    period: string,
    referenceNumber?: string
  ): Promise<void> {
    const [filing] = await db.raw
      .select()
      .from(gstReturnFilings)
      .where(
        and(
          eq(gstReturnFilings.tenantId, tenantId),
          eq(gstReturnFilings.returnType, returnType),
          eq(gstReturnFilings.period, period)
        )
      );

    if (!filing) throw new NotFoundError(`${returnType} filing for period ${period}`);

    const today = new Date().toISOString().substring(0, 10);
    const isLate = today > String(filing.dueDate);

    await db.raw
      .update(gstReturnFilings)
      .set({
        status: isLate ? 'LATE_FILED' : 'FILED',
        filedDate: today,
        filedBy: userId,
        referenceNumber: referenceNumber ?? null,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(gstReturnFilings.tenantId, tenantId),
          eq(gstReturnFilings.returnType, returnType),
          eq(gstReturnFilings.period, period)
        )
      );

    logger.info({ tenantId, returnType, period, isLate, referenceNumber }, 'GST return marked filed');
  }

  static async getStatus(
    db: TenantScopedDatabase,
    tenantId: number
  ): Promise<{
    pendingCount: number;
    overdueCount: number;
    filedThisMonth: number;
    nextDue: ReturnCalendarEntry | null;
  }> {
    const filings = await db.raw
      .select()
      .from(gstReturnFilings)
      .where(eq(gstReturnFilings.tenantId, tenantId));

    const today = new Date().toISOString().substring(0, 10);
    const currentMonth = today.substring(0, 7);

    const pending = filings.filter((f) => f.status === 'PENDING');
    const overdue = pending.filter((f) => String(f.dueDate) < today);
    const filedThisMonth = filings.filter(
      (f) => f.filedDate && String(f.filedDate).startsWith(currentMonth)
    );

    const upcoming = pending
      .filter((f) => String(f.dueDate) >= today)
      .sort((a, b) => String(a.dueDate).localeCompare(String(b.dueDate)));

    const nextEntry = upcoming[0];
    const nextDue: ReturnCalendarEntry | null = nextEntry
      ? {
          returnType: nextEntry.returnType as ReturnType,
          period: nextEntry.period,
          dueDate: String(nextEntry.dueDate),
          status: nextEntry.status as ReturnCalendarEntry['status'],
          filedDate: nextEntry.filedDate ? String(nextEntry.filedDate) : null,
          isOverdue: false,
          daysOverdue: 0,
          referenceNumber: nextEntry.referenceNumber,
        }
      : null;

    return {
      pendingCount: pending.length,
      overdueCount: overdue.length,
      filedThisMonth: filedThisMonth.length,
      nextDue,
    };
  }

  // GSTR-1 due: 11th of the following month
  // GSTR-3B due: 20th of the following month
  static getDueDate(returnType: ReturnType, period: string): string {
    const [year, month] = period.split('-').map(Number);
    if (!year || !month) return '';

    const nextMonth = month === 12 ? 1 : month + 1;
    const nextYear = month === 12 ? year + 1 : year;
    const pad = (n: number): string => String(n).padStart(2, '0');

    switch (returnType) {
      case 'GSTR1': return `${nextYear}-${pad(nextMonth)}-11`;
      case 'GSTR3B': return `${nextYear}-${pad(nextMonth)}-20`;
      default: return `${nextYear}-${pad(nextMonth)}-20`;
    }
  }

  private static getPeriodsForFy(fyStart: number): string[] {
    const periods: string[] = [];
    const pad = (n: number): string => String(n).padStart(2, '0');
    // Apr to Dec of fyStart
    for (let m = 4; m <= 12; m++) {
      periods.push(`${fyStart}-${pad(m)}`);
    }
    // Jan to Mar of fyStart+1
    for (let m = 1; m <= 3; m++) {
      periods.push(`${fyStart + 1}-${pad(m)}`);
    }
    return periods;
  }
}
