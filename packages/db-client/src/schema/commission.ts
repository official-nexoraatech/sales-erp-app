import {
  bigserial,
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  varchar,
} from 'drizzle-orm/pg-core';

// ─── Commission Plans (tenant-configurable) ────────────────────────────────
export const commissionPlans = pgTable(
  'commission_plans',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    tenantId: integer('tenant_id').notNull(),
    name: varchar('name', { length: 200 }).notNull(),
    calculationBasis: varchar('calculation_basis', { length: 20 })
      .notNull()
      .$type<'PERCENTAGE' | 'FLAT_PER_UNIT' | 'TIERED'>(),
    // PERCENTAGE: rate is a % of the invoice's taxableAmount.
    // FLAT_PER_UNIT: rate is a flat ₹ amount per unit of qty sold (flatAmount).
    // TIERED: tierSlabs is an ordered list of {uptoAmount, ratePct} bands applied to
    // cumulative taxableAmount within the plan's period — kept intentionally simple (no
    // rolling-period aggregation in v1; each invoice is evaluated independently against the
    // slab that its own taxableAmount falls into).
    ratePct: numeric('rate_pct', { precision: 5, scale: 2 }),
    flatAmount: numeric('flat_amount', { precision: 12, scale: 2 }),
    tierSlabs: jsonb('tier_slabs').$type<Array<{ uptoAmount: number; ratePct: number }>>(),
    effectiveFrom: timestamp('effective_from', { withTimezone: true }).notNull(),
    effectiveTill: timestamp('effective_till', { withTimezone: true }),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    createdBy: integer('created_by').notNull(),
  },
  (t) => [index('idx_commission_plans_tenant').on(t.tenantId, t.isActive)]
);

// ─── Commission Assignments (which user/role/branch a plan applies to) ─────
export const commissionAssignments = pgTable(
  'commission_assignments',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    tenantId: integer('tenant_id').notNull(),
    planId: integer('plan_id').notNull(),
    // Exactly one of userId/roleName/branchId is set — resolution order at compute time is
    // userId (most specific) > roleName > branchId (least specific, a branch-wide default).
    userId: integer('user_id'),
    roleName: varchar('role_name', { length: 100 }),
    branchId: integer('branch_id'),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    createdBy: integer('created_by').notNull(),
  },
  (t) => [
    index('idx_commission_assignments_tenant_user').on(t.tenantId, t.userId, t.isActive),
    index('idx_commission_assignments_tenant_branch').on(t.tenantId, t.branchId, t.isActive),
  ]
);

// ─── Commission Ledger (one row per invoice a commission was computed for) ─
export const commissionLedger = pgTable(
  'commission_ledger',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    tenantId: integer('tenant_id').notNull(),
    invoiceId: integer('invoice_id').notNull(),
    planId: integer('plan_id').notNull(),
    assignmentId: integer('assignment_id').notNull(),
    earnedByUserId: integer('earned_by_user_id').notNull(),
    baseAmount: numeric('base_amount', { precision: 14, scale: 2 }).notNull(), // invoice taxableAmount the commission was computed against
    commissionAmount: numeric('commission_amount', { precision: 12, scale: 2 }).notNull(),
    status: varchar('status', { length: 20 })
      .notNull()
      .default('DRAFT')
      .$type<'DRAFT' | 'APPROVED' | 'PAID' | 'VOIDED'>(),
    approvedBy: integer('approved_by'),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    paidAt: timestamp('paid_at', { withTimezone: true }),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index('idx_commission_ledger_tenant_invoice').on(t.tenantId, t.invoiceId),
    index('idx_commission_ledger_tenant_earner').on(t.tenantId, t.earnedByUserId, t.status),
    index('idx_commission_ledger_tenant_status').on(t.tenantId, t.status),
  ]
);

export type CommissionPlan = typeof commissionPlans.$inferSelect;
export type NewCommissionPlan = typeof commissionPlans.$inferInsert;
export type CommissionAssignment = typeof commissionAssignments.$inferSelect;
export type NewCommissionAssignment = typeof commissionAssignments.$inferInsert;
export type CommissionLedgerRow = typeof commissionLedger.$inferSelect;
export type NewCommissionLedgerRow = typeof commissionLedger.$inferInsert;
