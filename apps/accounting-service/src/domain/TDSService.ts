import { eq, and, sql } from 'drizzle-orm';
import { tdsEntries, tdsCertificates } from '@erp/db';
import type { TenantScopedDatabase } from '@erp/sdk';
import { BusinessError } from '@erp/types';
import { createLogger } from '@erp/logger';
import { JournalEngine } from './JournalEngine.js';

const logger = createLogger({ serviceName: 'accounting-service' });

type TDSSection = '194C' | '194H' | '194J';

const TDS_SECTION_RATES: Record<
  string,
  { section: TDSSection; rate: number; threshold: number; description: string }
> = {
  '194C_INDIVIDUAL': {
    section: '194C',
    rate: 1,
    threshold: 30000,
    description: 'Payment to contractor — individual/HUF',
  },
  '194C_COMPANY': {
    section: '194C',
    rate: 2,
    threshold: 30000,
    description: 'Payment to contractor — others',
  },
  '194H': { section: '194H', rate: 5, threshold: 15000, description: 'Commission or brokerage' },
  '194J_PROFESSIONAL': {
    section: '194J',
    rate: 10,
    threshold: 30000,
    description: 'Professional services',
  },
  '194J_TECHNICAL': {
    section: '194J',
    rate: 2,
    threshold: 30000,
    description: 'Technical services',
  },
};

export type TDSCategory = keyof typeof TDS_SECTION_RATES;

export class TDSService {
  static computeTDS(
    _supplierId: number,
    grossAmount: number,
    category: TDSCategory
  ): { tdsAmount: number; netAmount: number; section: TDSSection; rate: number } {
    const rule = TDS_SECTION_RATES[category];
    if (!rule) {
      throw new BusinessError('INVALID_TDS_CATEGORY', `Unknown TDS category: ${category}`);
    }

    if (grossAmount < rule.threshold) {
      return { tdsAmount: 0, netAmount: grossAmount, section: rule.section, rate: rule.rate };
    }

    const tdsAmount = parseFloat(((grossAmount * rule.rate) / 100).toFixed(2));
    const netAmount = parseFloat((grossAmount - tdsAmount).toFixed(2));
    return { tdsAmount, netAmount, section: rule.section, rate: rule.rate };
  }

  static async recordTDSEntry(
    db: TenantScopedDatabase,
    tenantId: number,
    userId: number,
    input: {
      supplierId: number;
      paymentId: number;
      grossAmount: number;
      category: TDSCategory;
      tdsPayableAccountId: number;
      expenseAccountId: number;
      periodMonth: number;
      periodYear: number;
    }
  ): Promise<{ tdsEntryId: number; journalId: string; tdsAmount: number }> {
    const { tdsAmount, section, rate } = TDSService.computeTDS(
      input.supplierId,
      input.grossAmount,
      input.category
    );

    if (tdsAmount <= 0) {
      throw new BusinessError(
        'TDS_BELOW_THRESHOLD',
        'TDS amount is zero — gross amount below threshold'
      );
    }

    return db.transaction(async (trx) => {
      const { journalId } = await JournalEngine.post(trx, tenantId, userId, {
        description: `TDS deduction u/s ${section} on payment to supplier ${input.supplierId}`,
        referenceType: 'SUPPLIER_PAYMENT',
        referenceId: input.paymentId,
        lines: [
          {
            accountId: input.expenseAccountId,
            debitAmount: tdsAmount,
            creditAmount: 0,
            description: `TDS payable u/s ${section}`,
          },
          {
            accountId: input.tdsPayableAccountId,
            debitAmount: 0,
            creditAmount: tdsAmount,
            description: `TDS payable u/s ${section} — ${input.periodYear}-${String(input.periodMonth).padStart(2, '0')}`,
          },
        ],
      });

      const [entry] = await trx.raw
        .insert(tdsEntries)
        .values({
          tenantId,
          supplierId: input.supplierId,
          paymentId: input.paymentId,
          tdsSection: section,
          taxableAmount: String(input.grossAmount),
          tdsRate: String(rate),
          tdsAmount: String(tdsAmount),
          periodMonth: input.periodMonth,
          periodYear: input.periodYear,
          depositStatus: 'PENDING',
          journalId,
          createdBy: userId,
        } as typeof tdsEntries.$inferInsert)
        .returning();

      if (!entry) throw new Error('TDS entry insert failed');

      logger.info(
        { tdsEntryId: entry.id, journalId, section, tdsAmount },
        'TDS deduction recorded'
      );
      return { tdsEntryId: entry.id, journalId, tdsAmount };
    });
  }

  static async getTDSLiability(
    db: TenantScopedDatabase,
    tenantId: number,
    periodMonth: number,
    periodYear: number
  ): Promise<{
    periodMonth: number;
    periodYear: number;
    totalLiability: number;
    entryCount: number;
  }> {
    const [result] = (await db.raw.execute(sql`
      SELECT
        COALESCE(SUM(tds_amount), 0)::NUMERIC AS total_liability,
        COUNT(*)::INTEGER AS entry_count
      FROM tds_entries
      WHERE tenant_id = ${tenantId}
        AND period_month = ${periodMonth}
        AND period_year = ${periodYear}
        AND deposit_status = 'PENDING'
    `)) as { total_liability: string; entry_count: number }[];

    return {
      periodMonth,
      periodYear,
      totalLiability: Number(result?.total_liability ?? 0),
      entryCount: result?.entry_count ?? 0,
    };
  }

  static async generateCertificate(
    db: TenantScopedDatabase,
    tenantId: number,
    userId: number,
    supplierId: number,
    periodYear: number,
    periodQuarter: 1 | 2 | 3 | 4,
    certificateNumber: string
  ): Promise<typeof tdsCertificates.$inferSelect> {
    // Derive months from quarter
    const quarterMonths: Record<number, number[]> = {
      1: [4, 5, 6],
      2: [7, 8, 9],
      3: [10, 11, 12],
      4: [1, 2, 3],
    };
    const months = quarterMonths[periodQuarter] ?? [];
    const calYear = periodQuarter === 4 ? periodYear + 1 : periodYear;

    const [totals] = (await db.raw.execute(sql`
      SELECT
        COALESCE(SUM(taxable_amount), 0)::NUMERIC AS total_taxable,
        COALESCE(SUM(tds_amount), 0)::NUMERIC AS total_tds,
        MAX(tds_section) AS tds_section
      FROM tds_entries
      WHERE tenant_id = ${tenantId}
        AND supplier_id = ${supplierId}
        AND period_year IN (${periodYear}, ${calYear})
        AND period_month IN ${months}
        AND deposit_status IN ('PENDING', 'DEPOSITED')
    `)) as { total_taxable: string; total_tds: string; tds_section: string }[];

    if (Number(totals?.total_tds ?? 0) <= 0) {
      throw new BusinessError(
        'NO_TDS_ENTRIES',
        `No TDS entries found for supplier ${supplierId} for Q${periodQuarter} ${periodYear}`
      );
    }

    const section = (totals?.tds_section ?? '194C') as TDSSection;

    const [cert] = await db.raw
      .insert(tdsCertificates)
      .values({
        tenantId,
        supplierId,
        certificateNumber,
        periodYear,
        periodQuarter,
        totalTaxableAmount: totals!.total_taxable,
        totalTdsAmount: totals!.total_tds,
        tdsSection: section,
        generatedAt: new Date(),
        generatedBy: userId,
      } as typeof tdsCertificates.$inferInsert)
      .returning();
    if (!cert) throw new Error('TDS certificate insert failed');

    // Mark entries as DEPOSITED
    await db.raw
      .update(tdsEntries)
      .set({ depositStatus: 'DEPOSITED', depositedAt: new Date(), depositedBy: userId })
      .where(and(eq(tdsEntries.tenantId, tenantId), eq(tdsEntries.supplierId, supplierId)));

    logger.info(
      { certId: cert.id, supplierId, periodYear, periodQuarter },
      'Form 16A certificate generated'
    );
    return cert;
  }

  static async getCertificates(
    db: TenantScopedDatabase,
    tenantId: number,
    supplierId: number
  ): Promise<(typeof tdsCertificates.$inferSelect)[]> {
    return db.raw
      .select()
      .from(tdsCertificates)
      .where(
        and(eq(tdsCertificates.tenantId, tenantId), eq(tdsCertificates.supplierId, supplierId))
      );
  }

  static async get26QData(
    db: TenantScopedDatabase,
    tenantId: number,
    year: number,
    quarter: 1 | 2 | 3 | 4
  ): Promise<{ period: string; tenantId: number; entries: unknown[] }> {
    const quarterMonths: Record<number, number[]> = {
      1: [4, 5, 6],
      2: [7, 8, 9],
      3: [10, 11, 12],
      4: [1, 2, 3],
    };
    const months = quarterMonths[quarter] ?? [];
    const calYear = quarter === 4 ? year + 1 : year;

    const rows = await db.raw.execute(sql`
      SELECT
        te.supplier_id AS "supplierId",
        s.display_name AS "supplierName",
        s.pan AS "pan",
        te.tds_section AS "section",
        te.taxable_amount AS "grossAmount",
        te.tds_amount AS "tdsAmount",
        te.created_at AS "dateOfPayment"
      FROM tds_entries te
      JOIN suppliers s ON s.id = te.supplier_id AND s.tenant_id = te.tenant_id
      WHERE te.tenant_id = ${tenantId}
        AND te.period_year IN (${year}, ${calYear})
        AND te.period_month IN ${months}
      ORDER BY te.created_at
    `);

    return {
      period: `${year}-Q${quarter}`,
      tenantId,
      entries: (
        rows as unknown as Array<{
          pan: string;
          supplierName: string;
          section: string;
          grossAmount: string;
          tdsAmount: string;
          dateOfPayment: Date | string;
        }>
      ).map((r) => ({
        pan: r.pan ?? 'UNKNOWN',
        supplierName: r.supplierName,
        section: r.section,
        grossAmount: Number(r.grossAmount),
        tdsAmount: Number(r.tdsAmount),
        // db.raw.execute() (a raw sql tag, not the typed query builder) returns timestamp
        // columns as strings, not parsed Date objects — normalize via `new Date(...)` rather
        // than assuming a Date instance (found in live QA 2026-07-17: threw on every row).
        dateOfPayment: r.dateOfPayment
          ? new Date(r.dateOfPayment).toISOString().substring(0, 10)
          : undefined,
      })),
    };
  }
}
