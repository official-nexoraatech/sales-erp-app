import { eq, and, sql } from 'drizzle-orm';
import type { ErpDatabase } from '@erp/db';
import { numberSeriesConfig } from '@erp/db';
import { BusinessError } from '@erp/types';

export type SeriesType =
  | 'INVOICE'
  | 'QUOTATION'
  | 'PURCHASE_ORDER'
  | 'GRN'
  | 'PURCHASE_RETURN'
  | 'SALE_RETURN'
  | 'CREDIT_NOTE'
  | 'PAYMENT_IN'
  | 'PAYMENT_OUT'
  | 'EXPENSE'
  | 'STOCK_TRANSFER'
  | 'SALARY_SLIP'
  | 'DELIVERY_CHALLAN';

// Number format: "INV/{FY-SHORT}/{SEQ:5}" → "INV/25-26/00001"
function formatNumber(template: string, seq: number, financialYear: string): string {
  return template
    .replace('{FY-SHORT}', financialYear)
    .replace('{FY}', financialYear.replace('-', '').slice(0, 4))
    .replace(/{SEQ:(\d+)}/, (_, width) => seq.toString().padStart(parseInt(width, 10), '0'))
    .replace('{SEQ}', seq.toString());
}

function getCurrentFinancialYear(): string {
  const now = new Date();
  const month = now.getMonth() + 1;
  const year = now.getFullYear();
  if (month >= 4) {
    return `${String(year).slice(2)}-${String(year + 1).slice(2)}`;
  }
  return `${String(year - 1).slice(2)}-${String(year).slice(2)}`;
}

// Default format templates per series type
const DEFAULT_FORMATS: Record<SeriesType, string> = {
  INVOICE: 'INV/{FY-SHORT}/{SEQ:5}',
  QUOTATION: 'QTN/{FY-SHORT}/{SEQ:5}',
  PURCHASE_ORDER: 'PO/{FY-SHORT}/{SEQ:5}',
  GRN: 'GRN/{FY-SHORT}/{SEQ:5}',
  PURCHASE_RETURN: 'PRET/{FY-SHORT}/{SEQ:5}',
  SALE_RETURN: 'SRET/{FY-SHORT}/{SEQ:5}',
  CREDIT_NOTE: 'CN/{FY-SHORT}/{SEQ:5}',
  PAYMENT_IN: 'RCPT/{FY-SHORT}/{SEQ:5}',
  PAYMENT_OUT: 'PYMT/{FY-SHORT}/{SEQ:5}',
  EXPENSE: 'EXP/{FY-SHORT}/{SEQ:5}',
  STOCK_TRANSFER: 'STR/{FY-SHORT}/{SEQ:5}',
  SALARY_SLIP: 'SAL/{FY-SHORT}/{SEQ:5}',
  DELIVERY_CHALLAN: 'DC/{FY-SHORT}/{SEQ:5}',
};

export class NumberSeriesEngine {
  constructor(private readonly db: ErpDatabase) {}

  // Thread-safe next number generation — uses DB-level atomic UPDATE+RETURNING
  async next(
    tenantId: number,
    type: SeriesType,
    branchId?: number
  ): Promise<string> {
    const financialYear = getCurrentFinancialYear();

    // Try to find existing config
    const existing = await this.db
      .select()
      .from(numberSeriesConfig)
      .where(
        and(
          eq(numberSeriesConfig.tenantId, tenantId),
          eq(numberSeriesConfig.seriesType, type),
          eq(numberSeriesConfig.financialYear, financialYear)
        )
      )
      .limit(1);

    if (!existing[0]) {
      // First use: create the config row
      await this.db
        .insert(numberSeriesConfig)
        .values({
          tenantId,
          branchId,
          seriesType: type,
          formatTemplate: DEFAULT_FORMATS[type] ?? `${type}/{FY-SHORT}/{SEQ:5}`,
          sequenceWidth: 5,
          currentSeq: 0,
          financialYear,
          createdBy: 0,
        })
        .onConflictDoNothing();
    }

    // Atomic increment using UPDATE...RETURNING (prevents race conditions)
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
    if (!config) throw new BusinessError('NUMBER_SERIES_ERROR', 'Failed to generate number');

    return formatNumber(config.formatTemplate, config.currentSeq, financialYear);
  }

  async preview(tenantId: number, type: SeriesType): Promise<string> {
    const financialYear = getCurrentFinancialYear();
    const [config] = await this.db
      .select()
      .from(numberSeriesConfig)
      .where(
        and(
          eq(numberSeriesConfig.tenantId, tenantId),
          eq(numberSeriesConfig.seriesType, type),
          eq(numberSeriesConfig.financialYear, financialYear)
        )
      );

    const template = config?.formatTemplate ?? DEFAULT_FORMATS[type] ?? `${type}/{FY-SHORT}/{SEQ:5}`;
    const nextSeq = (config?.currentSeq ?? 0) + 1;
    return formatNumber(template, nextSeq, financialYear);
  }

  async configure(
    tenantId: number,
    type: SeriesType,
    formatTemplate: string,
    branchId?: number
  ): Promise<void> {
    const financialYear = getCurrentFinancialYear();
    await this.db
      .insert(numberSeriesConfig)
      .values({
        tenantId,
        branchId,
        seriesType: type,
        formatTemplate,
        sequenceWidth: 5,
        currentSeq: 0,
        financialYear,
        createdBy: 0,
      })
      .onConflictDoUpdate({
        target: [
          numberSeriesConfig.tenantId,
          numberSeriesConfig.seriesType,
          numberSeriesConfig.financialYear,
        ],
        set: { formatTemplate, updatedAt: new Date() },
      });
  }
}
