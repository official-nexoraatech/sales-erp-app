import {
  bigserial,
  boolean,
  decimal,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  varchar,
} from 'drizzle-orm/pg-core';

// ─── Inventory Ledger (append-only — partitioned by year in production) ──────
// Partitioning DDL (run manually for production):
//   CREATE TABLE inventory_ledger_2025 PARTITION OF inventory_ledger
//   FOR VALUES FROM ('2025-01-01') TO ('2026-01-01');
export const inventoryLedger = pgTable(
  'inventory_ledger',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    tenantId: integer('tenant_id').notNull(),
    itemId: integer('item_id').notNull(),
    variantId: integer('variant_id'),
    warehouseId: integer('warehouse_id').notNull(),
    movementType: varchar('movement_type', { length: 30 })
      .notNull()
      .$type<
        | 'STOCK_IN'
        | 'STOCK_OUT'
        | 'ADJUSTMENT'
        | 'TRANSFER_IN'
        | 'TRANSFER_OUT'
        | 'OPENING'
        | 'RESERVATION'
        | 'RESERVATION_RELEASE'
      >(),
    quantity: decimal('quantity', { precision: 15, scale: 3 }).notNull(),
    quantityBefore: decimal('quantity_before', { precision: 15, scale: 3 }).notNull(),
    quantityAfter: decimal('quantity_after', { precision: 15, scale: 3 }).notNull(),
    referenceType: varchar('reference_type', { length: 50 }),
    referenceId: integer('reference_id'),
    referenceLineId: integer('reference_line_id'),
    unitCost: decimal('unit_cost', { precision: 15, scale: 2 }),
    notes: text('notes'),
    createdBy: integer('created_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index('idx_inv_ledger_tenant_item_wh').on(t.tenantId, t.itemId, t.warehouseId, t.createdAt),
    index('idx_inv_ledger_reference').on(t.tenantId, t.referenceType, t.referenceId),
    index('idx_inv_ledger_tenant_date').on(t.tenantId, t.createdAt),
  ]
);

// ─── Stock Reservations ────────────────────────────────────────────────────
export const stockReservations = pgTable(
  'stock_reservations',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    tenantId: integer('tenant_id').notNull(),
    itemId: integer('item_id').notNull(),
    variantId: integer('variant_id'),
    warehouseId: integer('warehouse_id').notNull(),
    quantity: decimal('quantity', { precision: 15, scale: 3 }).notNull(),
    status: varchar('status', { length: 20 })
      .notNull()
      .default('ACTIVE')
      .$type<'ACTIVE' | 'FULFILLED' | 'RELEASED' | 'EXPIRED'>(),
    referenceType: varchar('reference_type', { length: 50 }).notNull(),
    referenceId: integer('reference_id').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    fulfilledAt: timestamp('fulfilled_at', { withTimezone: true }),
    releasedAt: timestamp('released_at', { withTimezone: true }),
    releaseReason: text('release_reason'),
    createdBy: integer('created_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index('idx_reservations_tenant_item').on(t.tenantId, t.itemId, t.status),
    index('idx_reservations_reference').on(t.tenantId, t.referenceType, t.referenceId),
    index('idx_reservations_expiry').on(t.status, t.expiresAt),
  ]
);

// ─── Stock Transfers ───────────────────────────────────────────────────────
export const stockTransfers = pgTable(
  'stock_transfers',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    tenantId: integer('tenant_id').notNull(),
    transferNumber: varchar('transfer_number', { length: 30 }).notNull(),
    fromWarehouseId: integer('from_warehouse_id').notNull(),
    toWarehouseId: integer('to_warehouse_id').notNull(),
    status: varchar('status', { length: 30 })
      .notNull()
      .default('DRAFT')
      .$type<
        | 'DRAFT'
        | 'SUBMITTED'
        | 'PENDING_APPROVAL'
        | 'APPROVED'
        | 'DISPATCHED'
        | 'IN_TRANSIT'
        | 'RECEIVED'
        | 'CANCELLED'
      >(),
    notes: text('notes'),
    requestedBy: integer('requested_by').notNull(),
    approvedBy: integer('approved_by'),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    dispatchedBy: integer('dispatched_by'),
    dispatchedAt: timestamp('dispatched_at', { withTimezone: true }),
    receivedBy: integer('received_by'),
    receivedAt: timestamp('received_at', { withTimezone: true }),
    cancelledBy: integer('cancelled_by'),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    cancellationReason: text('cancellation_reason'),
    sagaId: varchar('saga_id', { length: 36 }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    createdBy: integer('created_by').notNull(),
    version: integer('version').notNull().default(0),
  },
  (t) => [
    unique('stock_transfers_tenant_number').on(t.tenantId, t.transferNumber),
    index('idx_st_tenant_status').on(t.tenantId, t.status, t.createdAt),
    index('idx_st_from_wh').on(t.fromWarehouseId, t.tenantId),
    index('idx_st_to_wh').on(t.toWarehouseId, t.tenantId),
  ]
);

// ─── Stock Transfer Lines ─────────────────────────────────────────────────
export const stockTransferLines = pgTable(
  'stock_transfer_lines',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    tenantId: integer('tenant_id').notNull(),
    transferId: integer('transfer_id').notNull(),
    itemId: integer('item_id').notNull(),
    variantId: integer('variant_id'),
    requestedQty: decimal('requested_qty', { precision: 15, scale: 3 }).notNull(),
    dispatchedQty: decimal('dispatched_qty', { precision: 15, scale: 3 }).notNull().default('0'),
    receivedQty: decimal('received_qty', { precision: 15, scale: 3 }).notNull().default('0'),
    unitCost: decimal('unit_cost', { precision: 15, scale: 2 }),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index('idx_stl_transfer').on(t.transferId),
    index('idx_stl_item').on(t.itemId, t.tenantId),
  ]
);

// ─── Stock Adjustments ────────────────────────────────────────────────────
export const stockAdjustments = pgTable(
  'stock_adjustments',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    tenantId: integer('tenant_id').notNull(),
    adjustmentNumber: varchar('adjustment_number', { length: 30 }).notNull(),
    warehouseId: integer('warehouse_id').notNull(),
    adjustmentType: varchar('adjustment_type', { length: 30 })
      .notNull()
      .$type<
        | 'DAMAGE'
        | 'EXPIRY'
        | 'THEFT'
        | 'SHORTAGE'
        | 'EXCESS'
        | 'QUALITY_ISSUE'
        | 'SAMPLE_ISSUED'
        | 'RETURN_TO_VENDOR'
      >(),
    status: varchar('status', { length: 30 })
      .notNull()
      .default('DRAFT')
      .$type<'DRAFT' | 'SUBMITTED' | 'PENDING_APPROVAL' | 'APPROVED' | 'CANCELLED'>(),
    totalValue: decimal('total_value', { precision: 15, scale: 2 }).notNull().default('0'),
    notes: text('notes'),
    submittedBy: integer('submitted_by'),
    submittedAt: timestamp('submitted_at', { withTimezone: true }),
    approvedBy: integer('approved_by'),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    cancelledBy: integer('cancelled_by'),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    cancellationReason: text('cancellation_reason'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    createdBy: integer('created_by').notNull(),
    version: integer('version').notNull().default(0),
  },
  (t) => [
    unique('stock_adjustments_tenant_number').on(t.tenantId, t.adjustmentNumber),
    index('idx_sa_tenant_status').on(t.tenantId, t.status, t.createdAt),
    index('idx_sa_warehouse').on(t.warehouseId, t.tenantId),
  ]
);

// ─── Stock Adjustment Lines ────────────────────────────────────────────────
export const stockAdjustmentLines = pgTable(
  'stock_adjustment_lines',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    tenantId: integer('tenant_id').notNull(),
    adjustmentId: integer('adjustment_id').notNull(),
    itemId: integer('item_id').notNull(),
    variantId: integer('variant_id'),
    direction: varchar('direction', { length: 4 }).notNull().$type<'IN' | 'OUT'>(),
    quantity: decimal('quantity', { precision: 15, scale: 3 }).notNull(),
    systemQty: decimal('system_qty', { precision: 15, scale: 3 }).notNull().default('0'),
    unitCost: decimal('unit_cost', { precision: 15, scale: 2 }),
    lineValue: decimal('line_value', { precision: 15, scale: 2 }).notNull().default('0'),
    reason: text('reason'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index('idx_sal_adjustment').on(t.adjustmentId),
    index('idx_sal_item').on(t.itemId, t.tenantId),
  ]
);

// ─── Physical Verifications ───────────────────────────────────────────────
export const physicalVerifications = pgTable(
  'physical_verifications',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    tenantId: integer('tenant_id').notNull(),
    verificationNumber: varchar('verification_number', { length: 30 }).notNull(),
    warehouseId: integer('warehouse_id').notNull(),
    status: varchar('status', { length: 20 })
      .notNull()
      .default('DRAFT')
      .$type<'DRAFT' | 'COUNTING' | 'REVIEW' | 'APPROVED' | 'CANCELLED'>(),
    snapshotTakenAt: timestamp('snapshot_taken_at', { withTimezone: true }),
    countingStartedAt: timestamp('counting_started_at', { withTimezone: true }),
    reviewStartedAt: timestamp('review_started_at', { withTimezone: true }),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    approvedBy: integer('approved_by'),
    adjustmentId: integer('adjustment_id'),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    createdBy: integer('created_by').notNull(),
    version: integer('version').notNull().default(0),
  },
  (t) => [
    unique('phys_verif_tenant_number').on(t.tenantId, t.verificationNumber),
    index('idx_pv_tenant_status').on(t.tenantId, t.status, t.createdAt),
    index('idx_pv_warehouse').on(t.warehouseId, t.tenantId),
  ]
);

// ─── Physical Verification Lines ─────────────────────────────────────────
export const physicalVerificationLines = pgTable(
  'physical_verification_lines',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    tenantId: integer('tenant_id').notNull(),
    verificationId: integer('verification_id').notNull(),
    itemId: integer('item_id').notNull(),
    variantId: integer('variant_id'),
    systemQty: decimal('system_qty', { precision: 15, scale: 3 }).notNull(),
    physicalQty: decimal('physical_qty', { precision: 15, scale: 3 }),
    variance: decimal('variance', { precision: 15, scale: 3 }),
    isReviewed: boolean('is_reviewed').notNull().default(false),
    reviewNotes: text('review_notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    unique('pvl_unique').on(t.verificationId, t.itemId, t.variantId),
    index('idx_pvl_verification').on(t.verificationId),
    index('idx_pvl_item').on(t.itemId, t.tenantId),
  ]
);

// ─── Fabric Rolls (feature-flagged: inventory.fabric-rolls.enabled) ────────
export const fabricRolls = pgTable(
  'fabric_rolls',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    tenantId: integer('tenant_id').notNull(),
    rollNumber: varchar('roll_number', { length: 50 }).notNull(),
    itemId: integer('item_id').notNull(),
    warehouseId: integer('warehouse_id').notNull(),
    grnReference: varchar('grn_reference', { length: 50 }),
    originalMeters: decimal('original_meters', { precision: 10, scale: 2 }).notNull(),
    remainingMeters: decimal('remaining_meters', { precision: 10, scale: 2 }).notNull(),
    width: decimal('width', { precision: 8, scale: 2 }),
    status: varchar('status', { length: 20 })
      .notNull()
      .default('AVAILABLE')
      .$type<'AVAILABLE' | 'PARTIALLY_CUT' | 'FULLY_CUT' | 'DAMAGED'>(),
    receivedAt: timestamp('received_at', { withTimezone: true }).defaultNow().notNull(),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    createdBy: integer('created_by').notNull(),
    version: integer('version').notNull().default(0),
  },
  (t) => [
    unique('fabric_rolls_tenant_number').on(t.tenantId, t.rollNumber),
    index('idx_fr_tenant_item').on(t.tenantId, t.itemId, t.status),
    index('idx_fr_warehouse').on(t.warehouseId, t.tenantId),
    index('idx_fr_received').on(t.tenantId, t.receivedAt),
  ]
);

// ─── Fabric Cuts ──────────────────────────────────────────────────────────
export const fabricCuts = pgTable(
  'fabric_cuts',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    tenantId: integer('tenant_id').notNull(),
    rollId: integer('roll_id').notNull(),
    meters: decimal('meters', { precision: 10, scale: 2 }).notNull(),
    metersBeforeCut: decimal('meters_before_cut', { precision: 10, scale: 2 }).notNull(),
    metersAfterCut: decimal('meters_after_cut', { precision: 10, scale: 2 }).notNull(),
    purpose: varchar('purpose', { length: 100 }),
    referenceType: varchar('reference_type', { length: 50 }),
    referenceId: integer('reference_id'),
    notes: text('notes'),
    createdBy: integer('created_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index('idx_fc_roll').on(t.rollId),
    index('idx_fc_tenant_date').on(t.tenantId, t.createdAt),
  ]
);

// ─── CQRS Projection: Stock Level (read model — updated by event consumers) ──
export const projectionStockLevel = pgTable(
  'projection_stock_level',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    tenantId: integer('tenant_id').notNull(),
    itemId: integer('item_id').notNull(),
    variantId: integer('variant_id'),
    warehouseId: integer('warehouse_id').notNull(),
    availableQty: decimal('available_qty', { precision: 15, scale: 3 }).notNull().default('0'),
    reservedQty: decimal('reserved_qty', { precision: 15, scale: 3 }).notNull().default('0'),
    lastMovementAt: timestamp('last_movement_at', { withTimezone: true }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    unique('proj_stock_unique').on(t.tenantId, t.itemId, t.warehouseId, t.variantId),
    index('idx_psl_tenant_item').on(t.tenantId, t.itemId),
    index('idx_psl_warehouse').on(t.warehouseId, t.tenantId),
    index('idx_psl_below_reorder').on(t.tenantId, t.availableQty),
  ]
);

// ─── Reconciliation Errors (nightly job output) ────────────────────────────
export const reconciliationErrors = pgTable(
  'reconciliation_errors',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    tenantId: integer('tenant_id').notNull(),
    itemId: integer('item_id').notNull(),
    warehouseId: integer('warehouse_id').notNull(),
    ledgerSum: decimal('ledger_sum', { precision: 15, scale: 3 }).notNull(),
    projectionQty: decimal('projection_qty', { precision: 15, scale: 3 }).notNull(),
    variance: decimal('variance', { precision: 15, scale: 3 }).notNull(),
    detectedAt: timestamp('detected_at', { withTimezone: true }).defaultNow().notNull(),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    resolvedBy: integer('resolved_by'),
  },
  (t) => [
    index('idx_recon_tenant_unresolved').on(t.tenantId, t.resolvedAt),
    index('idx_recon_item').on(t.itemId, t.tenantId),
  ]
);

export type InventoryLedgerEntry = typeof inventoryLedger.$inferInsert;
export type StockReservation = typeof stockReservations.$inferSelect;
export type NewStockReservation = typeof stockReservations.$inferInsert;
export type StockTransfer = typeof stockTransfers.$inferSelect;
export type NewStockTransfer = typeof stockTransfers.$inferInsert;
export type StockTransferLine = typeof stockTransferLines.$inferSelect;
export type StockAdjustment = typeof stockAdjustments.$inferSelect;
export type NewStockAdjustment = typeof stockAdjustments.$inferInsert;
export type StockAdjustmentLine = typeof stockAdjustmentLines.$inferSelect;
export type PhysicalVerification = typeof physicalVerifications.$inferSelect;
export type PhysicalVerificationLine = typeof physicalVerificationLines.$inferSelect;
export type FabricRoll = typeof fabricRolls.$inferSelect;
export type FabricCut = typeof fabricCuts.$inferSelect;
export type ProjectionStockLevel = typeof projectionStockLevel.$inferSelect;
