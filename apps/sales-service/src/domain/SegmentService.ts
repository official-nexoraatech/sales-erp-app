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
  // CP-3 (Campaign Management Platform initiative): store-scoped targeting + a couple of
  // previously-unlisted flat columns.
  branchId: customers.branchId,
  gender: customers.gender,
  anniversary: customers.anniversary,
} as const;

type FieldKey = keyof typeof FIELD_COLUMNS;

// CP-3: purchase-behavior aggregates, scoped per-tenant, matching the exact subquery shape
// already used by prebuiltWhere's 'high-value'/'overdue-30'/'no-purchase-60-days' cases — kept
// as raw SQL fragments (not a query builder join) for the same reason those are: a single
// correlated scalar subquery per customer row, no join fan-out.
const COMPUTED_NUMERIC_FIELDS: Record<string, (tenantId: number) => SQL> = {
  daysSinceLastPurchase: (tenantId) =>
    sql`EXTRACT(DAY FROM (now() - (SELECT MAX(i.invoice_date) FROM invoices i WHERE i.customer_id = ${customers.id} AND i.tenant_id = ${tenantId} AND i.status NOT IN ('DRAFT','CANCELLED'))))`,
  orderCount: (tenantId) =>
    sql`(SELECT COUNT(*) FROM invoices i WHERE i.customer_id = ${customers.id} AND i.tenant_id = ${tenantId} AND i.status NOT IN ('DRAFT','CANCELLED'))`,
  averageOrderValue: (tenantId) =>
    sql`(SELECT COALESCE(AVG(i.grand_total), 0) FROM invoices i WHERE i.customer_id = ${customers.id} AND i.tenant_id = ${tenantId} AND i.status NOT IN ('DRAFT','CANCELLED'))`,
  lifetimeValue: (tenantId) =>
    sql`(SELECT COALESCE(SUM(i.grand_total), 0) FROM invoices i WHERE i.customer_id = ${customers.id} AND i.tenant_id = ${tenantId} AND i.status NOT IN ('DRAFT','CANCELLED'))`,
};

// CP-3: geographic targeting — customers.billingAddress is jsonb, not flat columns, so these
// read via ->> (jsonb-to-text) rather than a direct column reference.
const JSON_TEXT_FIELDS: Record<string, SQL> = {
  city: sql`(${customers.billingAddress}->>'city')`,
  state: sql`(${customers.billingAddress}->>'state')`,
  pincode: sql`(${customers.billingAddress}->>'pincode')`,
};

// CP-3: tenant-defined custom attributes — reuses the customers.customFields jsonb column that
// already exists on the table (no new schema needed) rather than a separate key/value table.
// Rule field syntax: "customField:<key>", e.g. "customField:preferredBrand".
const CUSTOM_FIELD_PREFIX = 'customField:';

export class SegmentService {
  static isPrebuilt(code: string): code is PrebuiltSegmentCode {
    return (PREBUILT_SEGMENTS as readonly string[]).includes(code);
  }

  /** Builds the WHERE clause for one of the 6 pre-built read-only segment filters. */
  static prebuiltWhere(
    code: PrebuiltSegmentCode,
    tenantId: number,
    highValueThreshold = 5000
  ): SQL {
    const base = and(eq(customers.tenantId, tenantId), sql`${customers.deletedAt} IS NULL`) as SQL;

    switch (code) {
      case 'no-purchase-60-days': {
        const cutoff = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);
        return and(
          base,
          sql`NOT EXISTS (SELECT 1 FROM invoices i WHERE i.customer_id = ${customers.id} AND i.tenant_id = ${tenantId} AND i.invoice_date >= ${cutoff.toISOString()} AND i.status NOT IN ('DRAFT','CANCELLED'))`
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
          sql`EXISTS (SELECT 1 FROM invoices i WHERE i.customer_id = ${customers.id} AND i.tenant_id = ${tenantId} AND i.status = 'OVERDUE' AND i.due_date < ${cutoff.toISOString()})`
        ) as SQL;
      }
      case 'birthdays-this-month':
        return and(
          base,
          sql`${customers.dateOfBirth} IS NOT NULL AND SUBSTRING(${customers.dateOfBirth} FROM 6 FOR 2) = TO_CHAR(CURRENT_DATE, 'MM')`
        ) as SQL;
      case 'new-customers-this-month':
        return and(
          base,
          sql`DATE_TRUNC('month', ${customers.createdAt}) = DATE_TRUNC('month', CURRENT_DATE)`
        ) as SQL;
    }
  }

  /** Builds the WHERE clause for a custom field/operator/value segment definition. */
  static customWhere(tenantId: number, def: SegmentFilterDefinition): SQL {
    const base = and(eq(customers.tenantId, tenantId), sql`${customers.deletedAt} IS NULL`) as SQL;
    if (!def.rules.length) return base;

    const conditions = def.rules.map((rule) => SegmentService.buildCondition(tenantId, rule));
    const combined = (def.logic === 'OR' ? or(...conditions) : and(...conditions)) as SQL;
    return and(base, combined) as SQL;
  }

  private static buildCondition(tenantId: number, rule: SegmentFilterRule): SQL {
    if (rule.field.startsWith(CUSTOM_FIELD_PREFIX)) {
      const key = rule.field.slice(CUSTOM_FIELD_PREFIX.length);
      if (!key)
        throw new ValidationError(
          'customField rule requires a key, e.g. "customField:preferredBrand"'
        );
      return SegmentService.compareText(
        sql`(${customers.customFields}->>${key})`,
        rule.operator,
        rule.value
      );
    }

    const jsonField = JSON_TEXT_FIELDS[rule.field];
    if (jsonField) {
      return SegmentService.compareText(jsonField, rule.operator, rule.value);
    }

    const computedField = COMPUTED_NUMERIC_FIELDS[rule.field];
    if (computedField) {
      return SegmentService.compareNumeric(computedField(tenantId), rule.operator, rule.value);
    }

    const col = FIELD_COLUMNS[rule.field as FieldKey];
    if (!col) throw new ValidationError(`Unsupported segment field: ${rule.field}`);
    return SegmentService.compareColumn(col, rule.operator, rule.value);
  }

  private static compareColumn(
    col: (typeof FIELD_COLUMNS)[FieldKey],
    operator: SegmentFilterRule['operator'],
    value: unknown
  ): SQL {
    switch (operator) {
      case 'eq':
        return eq(col, value as never);
      case 'neq':
        return ne(col, value as never);
      case 'gt':
        return gt(col, value as never);
      case 'gte':
        return gte(col, value as never);
      case 'lt':
        return lt(col, value as never);
      case 'lte':
        return lte(col, value as never);
      case 'contains':
        return ilike(col, `%${String(value)}%`);
      default:
        throw new ValidationError(`Unsupported segment operator: ${operator}`);
    }
  }

  // CP-3: comparison against a raw SQL text expression (jsonb ->> field, custom attributes) —
  // value is always bound as a parameter via the sql tagged template, never string-concatenated.
  private static compareText(
    expr: SQL,
    operator: SegmentFilterRule['operator'],
    value: unknown
  ): SQL {
    const text = String(value);
    switch (operator) {
      case 'eq':
        return sql`${expr} = ${text}`;
      case 'neq':
        return sql`${expr} != ${text}`;
      case 'gt':
        return sql`${expr} > ${text}`;
      case 'gte':
        return sql`${expr} >= ${text}`;
      case 'lt':
        return sql`${expr} < ${text}`;
      case 'lte':
        return sql`${expr} <= ${text}`;
      case 'contains':
        return sql`${expr} ILIKE ${`%${text}%`}`;
      default:
        throw new ValidationError(`Unsupported segment operator: ${operator}`);
    }
  }

  // CP-3: comparison against a raw SQL numeric expression (purchase-history aggregates).
  private static compareNumeric(
    expr: SQL,
    operator: SegmentFilterRule['operator'],
    value: unknown
  ): SQL {
    if (operator === 'contains') {
      throw new ValidationError('contains is not supported for numeric fields');
    }
    const num = Number(value);
    switch (operator) {
      case 'eq':
        return sql`${expr} = ${num}`;
      case 'neq':
        return sql`${expr} != ${num}`;
      case 'gt':
        return sql`${expr} > ${num}`;
      case 'gte':
        return sql`${expr} >= ${num}`;
      case 'lt':
        return sql`${expr} < ${num}`;
      case 'lte':
        return sql`${expr} <= ${num}`;
      default:
        throw new ValidationError(`Unsupported segment operator: ${operator}`);
    }
  }

  static async countMatching(db: ErpDatabase, where: SQL): Promise<number> {
    const [row] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(customers)
      .where(where);
    return row?.count ?? 0;
  }

  static async listMatching(
    db: ErpDatabase,
    where: SQL,
    page: number,
    size: number
  ): Promise<{ rows: Array<typeof customers.$inferSelect>; total: number }> {
    const [rows, total] = await Promise.all([
      db
        .select()
        .from(customers)
        .where(where)
        .limit(size)
        .offset(page * size),
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
    if (!segment.filterDefinition)
      throw new NotFoundError('Segment filter definition', segment.code);
    return SegmentService.customWhere(tenantId, segment.filterDefinition);
  }
}
