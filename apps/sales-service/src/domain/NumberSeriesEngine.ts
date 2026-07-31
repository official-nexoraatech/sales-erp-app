import { eq, and, sql } from 'drizzle-orm';
import type { ErpDatabase } from '@erp/db';
import { numberSeriesConfig } from '@erp/db';
import { BusinessError } from '@erp/types';

// C-7 fix: invoiceNumber used to be accepted verbatim from the client at confirm time,
// protected only by a proactive duplicate check and the DB unique index — not a demonstrably
// gap-free sequential number per financial year, which Indian GST practice (Rule 46) expects.
// This reuses the SAME number_series_config table and FY/format logic report-service's
// NumberSeriesEngine already implements for its admin preview/configure screens — that engine
// lives in report-service and is never actually called from the real invoice-confirm flow
// (the exact "backend exists, nothing calls it" pattern flagged repeatedly elsewhere in this
// codebase). Rather than a cross-service call (ES-03: everything confirmInTransaction touches
// must stay inside its own Postgres transaction for atomicity), this is a focused copy of just
// the `next()` sequence logic, called with the SAME `trx` handle confirmInTransaction already
// uses — so a rolled-back confirm never burns a number, keeping the sequence truly gap-free.
export type SeriesType = 'INVOICE';

function formatNumber(template: string, seq: number, financialYear: string): string {
  return template
    .replace('{FY-SHORT}', financialYear)
    .replace('{FY}', financialYear.replace('-', '').slice(0, 4))
    .replace(/{SEQ:(\d+)}/, (_, width: string) => seq.toString().padStart(parseInt(width, 10), '0'))
    .replace('{SEQ}', seq.toString());
}

// April-start/March-end Indian financial year — matches report-service's NumberSeriesEngine
// exactly, so a tenant sees one continuous sequence regardless of which service touched it.
function getCurrentFinancialYear(): string {
  const now = new Date();
  const month = now.getMonth() + 1;
  const year = now.getFullYear();
  if (month >= 4) return `${String(year).slice(2)}-${String(year + 1).slice(2)}`;
  return `${String(year - 1).slice(2)}-${String(year).slice(2)}`;
}

const DEFAULT_FORMATS: Record<SeriesType, string> = {
  INVOICE: 'INV/{FY-SHORT}/{SEQ:5}',
};

export class NumberSeriesEngine {
  constructor(private readonly db: ErpDatabase) {}

  async next(tenantId: number, type: SeriesType): Promise<string> {
    const financialYear = getCurrentFinancialYear();

    const existing = await this.db
      .select()
      .from(numberSeriesConfig)
      .where(
        and(
          eq(numberSeriesConfig.tenantId, tenantId),
          eq(numberSeriesConfig.seriesType, type),
          eq(numberSeriesConfig.financialYear, financialYear)
        )
      );

    if (!existing[0]) {
      await this.db
        .insert(numberSeriesConfig)
        .values({
          tenantId,
          seriesType: type,
          formatTemplate: DEFAULT_FORMATS[type],
          sequenceWidth: 5,
          currentSeq: 0,
          financialYear,
          createdBy: 0,
        })
        .onConflictDoNothing();
    }

    // Atomic UPDATE...RETURNING — the same mechanism the guarded stock-deduction and
    // payment-allocation updates elsewhere in this service already rely on to prevent races.
    const updated = await this.db
      .update(numberSeriesConfig)
      .set({
        currentSeq: sql`${numberSeriesConfig.currentSeq} + 1`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(numberSeriesConfig.tenantId, tenantId),
          eq(numberSeriesConfig.seriesType, type),
          eq(numberSeriesConfig.financialYear, financialYear)
        )
      )
      .returning();

    const config = updated[0];
    if (!config)
      throw new BusinessError('NUMBER_SERIES_ERROR', 'Failed to generate invoice number');

    return formatNumber(config.formatTemplate, config.currentSeq, financialYear);
  }
}
