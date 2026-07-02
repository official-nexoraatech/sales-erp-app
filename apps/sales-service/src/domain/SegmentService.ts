import { and, eq, gt, gte, ilike, lt, lte, ne, or, sql, type SQL } from 'drizzle-orm';
import { customers } from '@erp/db';
import type { ErpDatabase } from '@erp/db';
import { NotFoundError, ValidationError } from '@erp/types';

export const PREBUILT_SEGMENTS = [
  'no-purchase-60-days',
  'gold-tier',
  'high-value',
  'overdue-30',
  'birthdays-this-month',
  'new-customers-this-month',
] as const;

export type PrebuiltSegmentCode = (typeof PREBUILT_SEGMENTS)[number];

export interface SegmentFilterRule {
  field: string;
  operator: 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'contains';
  value: unknown;
}

export interface SegmentFilterDefinition {
  rules: SegmentFilterRule[];
  logic: 'AND' | 'OR';
}

// Whitelist of customer columns that custom segment rules may target — never accept raw SQL from clients
const FIELD_COLUMNS = {
  customerType: customers.customerType,
  status: customers.status,
  creditLimit: customers.creditLimit,
  loyaltyPoints: customers.loyaltyPoints,
  openingBalance: customers.openingBalance,
  healthSegment: customers.healthSegment,
  healthScore: customers.healthScore,
  createdAt: customers.createdAt,
  dateOfBirth: customers.dateOfBirth,
  displayName: customers.displayName,
  phone: customers.phone,
  email: customers.email,
} as const;

type FieldKey = keyof typeof FIELD_COLUMNS;

export class SegmentService {
  static isPrebuilt(code: string): code is PrebuiltSegmentCode {
    return (PREBUILT_SEGMENTS as readonly string[]).includes(code);
  }

  /** Builds the WHERE clause for one of the 6 pre-built read-only segment filters. */
  static prebuiltWhere(code: PrebuiltSegmentCode, tenantId: number, highValueThreshold = 5000): SQL {
    const base = and(eq(customers.tenantId, tenantId), sql`${customers.deletedAt} IS NULL`) as SQL;

    switch (code) {
      case 'no-purchase-60-days': {
        const cutoff = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);
        return and(
          base,
          sql`NOT EXISTS (SELECT 1 FROM invoices i WHERE i.customer_id = ${customers.id} AND i.tenant_id = ${tenantId} AND i.invoice_date >= ${cutoff} AND i.status NOT IN ('DRAFT','CANCELLED'))`
        ) as SQL;
      }
      case 'gold-tier':
        return and(base, gte(customers.loyaltyPoints, 5000)) as SQL;
      case 'high-value':
        return and(
          base,
          sql`(SELECT COALESCE(AVG(i.grand_total), 0) FROM invoices i WHERE i.customer_id = ${customers.id} AND i.tenant_id = ${tenantId} AND i.status NOT IN ('DRAFT','CANCELLED')) > ${highValueThreshold}`
        ) as SQL;
      case 'overdue-30': {
        const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
        return and(
          base,
          sql`EXISTS (SELECT 1 FROM invoices i WHERE i.customer_id = ${customers.id} AND i.tenant_id = ${tenantId} AND i.status = 'OVERDUE' AND i.due_date < ${cutoff})`
        ) as SQL;
      }
      case 'birthdays-this-month':
        return and(
          base,
          sql`${customers.dateOfBirth} IS NOT NULL AND SUBSTRING(${customers.dateOfBirth} FROM 6 FOR 2) = TO_CHAR(CURRENT_DATE, 'MM')`
        ) as SQL;
      case 'new-customers-this-month':
        return and(base, sql`DATE_TRUNC('month', ${customers.createdAt}) = DATE_TRUNC('month', CURRENT_DATE)`) as SQL;
    }
  }

  /** Builds the WHERE clause for a custom field/operator/value segment definition. */
  static customWhere(tenantId: number, def: SegmentFilterDefinition): SQL {
    const base = and(eq(customers.tenantId, tenantId), sql`${customers.deletedAt} IS NULL`) as SQL;
    if (!def.rules.length) return base;

    const conditions = def.rules.map((rule) => SegmentService.buildCondition(rule));
    const combined = (def.logic === 'OR' ? or(...conditions) : and(...conditions)) as SQL;
    return and(base, combined) as SQL;
  }

  private static buildCondition(rule: SegmentFilterRule): SQL {
    const col = FIELD_COLUMNS[rule.field as FieldKey];
    if (!col) throw new ValidationError(`Unsupported segment field: ${rule.field}`);

    switch (rule.operator) {
      case 'eq':
        return eq(col, rule.value as never);
      case 'neq':
        return ne(col, rule.value as never);
      case 'gt':
        return gt(col, rule.value as never);
      case 'gte':
        return gte(col, rule.value as never);
      case 'lt':
        return lt(col, rule.value as never);
      case 'lte':
        return lte(col, rule.value as never);
      case 'contains':
        return ilike(col, `%${String(rule.value)}%`);
      default:
        throw new ValidationError(`Unsupported segment operator: ${rule.operator}`);
    }
  }

  static async countMatching(db: ErpDatabase, where: SQL): Promise<number> {
    const [row] = await db.select({ count: sql<number>`count(*)::int` }).from(customers).where(where);
    return row?.count ?? 0;
  }

  static async listMatching(
    db: ErpDatabase,
    where: SQL,
    page: number,
    size: number
  ): Promise<{ rows: Array<typeof customers.$inferSelect>; total: number }> {
    const [rows, total] = await Promise.all([
      db.select().from(customers).where(where).limit(size).offset(page * size),
      SegmentService.countMatching(db, where),
    ]);
    return { rows, total };
  }

  /** Resolves a segment's WHERE clause (pre-built code or stored custom definition). */
  static async resolveWhere(
    db: ErpDatabase,
    tenantId: number,
    segment: { code: string; isSystem: boolean; filterDefinition: SegmentFilterDefinition | null }
  ): Promise<SQL> {
    if (segment.isSystem && SegmentService.isPrebuilt(segment.code)) {
      return SegmentService.prebuiltWhere(segment.code, tenantId);
    }
    if (!segment.filterDefinition) throw new NotFoundError('Segment filter definition', segment.code);
    return SegmentService.customWhere(tenantId, segment.filterDefinition);
  }
}
