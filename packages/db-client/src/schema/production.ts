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

// ─── Job Work Orders ──────────────────────────────────────────────────────────
// Tracks outsourced stitching/processing sent to external job workers
export const jobWorkOrders = pgTable(
  'job_work_orders',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    tenantId: integer('tenant_id').notNull(),
    orderNumber: varchar('order_number', { length: 50 }),
    status: varchar('status', { length: 30 })
      .notNull()
      .default('DRAFT')
      .$type<
        'DRAFT' | 'MATERIAL_ISSUED' | 'IN_PROGRESS' | 'QUALITY_CHECK' | 'COMPLETED' | 'CANCELLED'
      >(),
    // Job worker details
    supplierId: integer('supplier_id').notNull(),
    branchId: integer('branch_id').notNull(),
    warehouseId: integer('warehouse_id').notNull(),
    // Item to manufacture
    outputItemId: integer('output_item_id').notNull(),
    outputVariantId: integer('output_variant_id'),
    // Manufacturing vertical, Phase B — optional, which work center this order runs on.
    workCenterId: integer('work_center_id'),
    orderedQty: decimal('ordered_qty', { precision: 15, scale: 3 }).notNull(),
    receivedQty: decimal('received_qty', { precision: 15, scale: 3 }).notNull().default('0'),
    rejectedQty: decimal('rejected_qty', { precision: 15, scale: 3 }).notNull().default('0'),
    scrapQty: decimal('scrap_qty', { precision: 15, scale: 3 }).notNull().default('0'),
    // Costing
    jobWorkRate: decimal('job_work_rate', { precision: 15, scale: 2 }).notNull().default('0'),
    jobWorkCharges: decimal('job_work_charges', { precision: 15, scale: 2 }).notNull().default('0'),
    materialsCost: decimal('materials_cost', { precision: 15, scale: 2 }).notNull().default('0'),
    finishedGoodsCost: decimal('finished_goods_cost', { precision: 15, scale: 2 })
      .notNull()
      .default('0'),
    // Dates
    orderDate: timestamp('order_date', { withTimezone: true }).notNull(),
    expectedDate: timestamp('expected_date', { withTimezone: true }),
    issuedAt: timestamp('issued_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    cancellationReason: text('cancellation_reason'),
    notes: text('notes'),
    // Audit
    createdBy: integer('created_by').notNull(),
    updatedBy: integer('updated_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    version: integer('version').notNull().default(0),
  },
  (t) => [
    index('idx_job_work_orders_tenant').on(t.tenantId, t.status),
    index('idx_job_work_orders_supplier').on(t.supplierId, t.tenantId),
    index('idx_job_work_orders_item').on(t.outputItemId, t.tenantId),
    index('idx_job_work_orders_date').on(t.tenantId, t.orderDate),
  ]
);

// ─── Job Work Order Materials (Raw Material Inputs) ───────────────────────────
export const jobWorkOrderMaterials = pgTable(
  'job_work_order_materials',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    jobWorkOrderId: integer('job_work_order_id').notNull(),
    tenantId: integer('tenant_id').notNull(),
    itemId: integer('item_id').notNull(),
    variantId: integer('variant_id'),
    requiredQty: decimal('required_qty', { precision: 15, scale: 3 }).notNull(),
    issuedQty: decimal('issued_qty', { precision: 15, scale: 3 }).notNull().default('0'),
    unitCost: decimal('unit_cost', { precision: 15, scale: 2 }).notNull().default('0'),
    totalCost: decimal('total_cost', { precision: 15, scale: 2 }).notNull().default('0'),
    warehouseId: integer('warehouse_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index('idx_jwom_order').on(t.jobWorkOrderId),
    index('idx_jwom_tenant_item').on(t.tenantId, t.itemId),
  ]
);

// ─── Job Work Order Quality Checks ────────────────────────────────────────────
export const jobWorkOrderQualityChecks = pgTable(
  'job_work_order_quality_checks',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    jobWorkOrderId: integer('job_work_order_id').notNull(),
    tenantId: integer('tenant_id').notNull(),
    pieceNumber: integer('piece_number').notNull(),
    result: varchar('result', { length: 20 }).notNull().$type<'PASS' | 'FAIL' | 'REWORK'>(),
    defectNotes: text('defect_notes'),
    inspectedBy: integer('inspected_by').notNull(),
    inspectedAt: timestamp('inspected_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index('idx_jwqc_order').on(t.jobWorkOrderId, t.tenantId)]
);

// ─── Job Work Order History ────────────────────────────────────────────────────
export const jobWorkOrderHistory = pgTable(
  'job_work_order_history',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    jobWorkOrderId: integer('job_work_order_id').notNull(),
    tenantId: integer('tenant_id').notNull(),
    action: varchar('action', { length: 100 }).notNull(),
    fromStatus: varchar('from_status', { length: 30 }),
    toStatus: varchar('to_status', { length: 30 }),
    performedBy: integer('performed_by').notNull(),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index('idx_jwo_history_order').on(t.jobWorkOrderId, t.tenantId)]
);

// ─── Bill of Materials (Manufacturing vertical, Phase A) ──────────────────────
// Single-level only — a BOM's components are always real, purchasable/stockable items, never
// another BOM (no nested sub-assemblies in Phase A). Only one isActive=true BOM per (tenantId,
// finishedItemId, finishedVariantId) is enforced in BOMService, not a DB constraint here,
// matching the isActive-flag convention already used elsewhere in this codebase (e.g. branches,
// itemVariants) rather than a partial unique index.
export const boms = pgTable(
  'boms',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    tenantId: integer('tenant_id').notNull(),
    name: varchar('name', { length: 200 }).notNull(),
    finishedItemId: integer('finished_item_id').notNull(),
    finishedVariantId: integer('finished_variant_id'),
    outputQty: decimal('output_qty', { precision: 15, scale: 3 }).notNull().default('1'),
    isActive: boolean('is_active').notNull().default(true),
    version: integer('version').notNull().default(0),
    createdBy: integer('created_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index('idx_boms_tenant_item').on(t.tenantId, t.finishedItemId)]
);

export const bomLines = pgTable(
  'bom_lines',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    bomId: integer('bom_id').notNull(),
    tenantId: integer('tenant_id').notNull(),
    componentItemId: integer('component_item_id').notNull(),
    componentVariantId: integer('component_variant_id'),
    quantityPerOutput: decimal('quantity_per_output', { precision: 15, scale: 3 }).notNull(),
    scrapPercent: decimal('scrap_percent', { precision: 5, scale: 2 }).notNull().default('0'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index('idx_bom_lines_bom').on(t.bomId),
    index('idx_bom_lines_tenant_item').on(t.tenantId, t.componentItemId),
  ]
);

// ─── Work Centers (Manufacturing vertical, Phase B) ──────────────────────────
export const workCenters = pgTable(
  'work_centers',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    tenantId: integer('tenant_id').notNull(),
    name: varchar('name', { length: 200 }).notNull(),
    code: varchar('code', { length: 30 }).notNull(),
    description: text('description'),
    capacityPerDay: decimal('capacity_per_day', { precision: 15, scale: 3 }).notNull().default('0'),
    isActive: boolean('is_active').notNull().default(true),
    createdBy: integer('created_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [unique('idx_work_centers_tenant_code').on(t.tenantId, t.code)]
);

// ─── Production Orders (Manufacturing vertical) ───────────────────────────────
// In-house manufacturing, distinct from Job Work Order — no supplierId (nothing leaves the
// premises to a third party); laborCost/overheadCost replace jobWorkRate/jobWorkCharges as the
// conversion-cost fields. Otherwise mirrors jobWorkOrders' shape (status lifecycle,
// materials/quality-checks/history subtables, optional workCenterId) so
// ProductionOrderService reuses the same ValuationService-backed stock-in/stock-out pattern
// already proven for job work.
export const productionOrders = pgTable(
  'production_orders',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    tenantId: integer('tenant_id').notNull(),
    orderNumber: varchar('order_number', { length: 50 }),
    status: varchar('status', { length: 30 })
      .notNull()
      .default('DRAFT')
      .$type<
        'DRAFT' | 'MATERIAL_ISSUED' | 'IN_PROGRESS' | 'QUALITY_CHECK' | 'COMPLETED' | 'CANCELLED'
      >(),
    branchId: integer('branch_id').notNull(),
    warehouseId: integer('warehouse_id').notNull(),
    outputItemId: integer('output_item_id').notNull(),
    outputVariantId: integer('output_variant_id'),
    workCenterId: integer('work_center_id'),
    // Routing extension — which routing (if any) this order's operations were instantiated from.
    routingId: integer('routing_id'),
    orderedQty: decimal('ordered_qty', { precision: 15, scale: 3 }).notNull(),
    receivedQty: decimal('received_qty', { precision: 15, scale: 3 }).notNull().default('0'),
    rejectedQty: decimal('rejected_qty', { precision: 15, scale: 3 }).notNull().default('0'),
    scrapQty: decimal('scrap_qty', { precision: 15, scale: 3 }).notNull().default('0'),
    laborCost: decimal('labor_cost', { precision: 15, scale: 2 }).notNull().default('0'),
    overheadCost: decimal('overhead_cost', { precision: 15, scale: 2 }).notNull().default('0'),
    materialsCost: decimal('materials_cost', { precision: 15, scale: 2 }).notNull().default('0'),
    finishedGoodsCost: decimal('finished_goods_cost', { precision: 15, scale: 2 })
      .notNull()
      .default('0'),
    orderDate: timestamp('order_date', { withTimezone: true }).notNull(),
    expectedDate: timestamp('expected_date', { withTimezone: true }),
    issuedAt: timestamp('issued_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    cancellationReason: text('cancellation_reason'),
    notes: text('notes'),
    createdBy: integer('created_by').notNull(),
    updatedBy: integer('updated_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    version: integer('version').notNull().default(0),
  },
  (t) => [
    index('idx_production_orders_tenant').on(t.tenantId, t.status),
    index('idx_production_orders_item').on(t.outputItemId, t.tenantId),
    index('idx_production_orders_date').on(t.tenantId, t.orderDate),
    index('idx_production_orders_work_center').on(t.workCenterId, t.tenantId),
  ]
);

export const productionOrderMaterials = pgTable(
  'production_order_materials',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    productionOrderId: integer('production_order_id').notNull(),
    tenantId: integer('tenant_id').notNull(),
    itemId: integer('item_id').notNull(),
    variantId: integer('variant_id'),
    requiredQty: decimal('required_qty', { precision: 15, scale: 3 }).notNull(),
    issuedQty: decimal('issued_qty', { precision: 15, scale: 3 }).notNull().default('0'),
    unitCost: decimal('unit_cost', { precision: 15, scale: 2 }).notNull().default('0'),
    totalCost: decimal('total_cost', { precision: 15, scale: 2 }).notNull().default('0'),
    warehouseId: integer('warehouse_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index('idx_pom_order').on(t.productionOrderId),
    index('idx_pom_tenant_item').on(t.tenantId, t.itemId),
  ]
);

export const productionOrderQualityChecks = pgTable(
  'production_order_quality_checks',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    productionOrderId: integer('production_order_id').notNull(),
    tenantId: integer('tenant_id').notNull(),
    pieceNumber: integer('piece_number').notNull(),
    result: varchar('result', { length: 20 }).notNull().$type<'PASS' | 'FAIL' | 'REWORK'>(),
    defectNotes: text('defect_notes'),
    inspectedBy: integer('inspected_by').notNull(),
    inspectedAt: timestamp('inspected_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index('idx_poqc_order').on(t.productionOrderId, t.tenantId)]
);

export const productionOrderHistory = pgTable(
  'production_order_history',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    productionOrderId: integer('production_order_id').notNull(),
    tenantId: integer('tenant_id').notNull(),
    action: varchar('action', { length: 100 }).notNull(),
    fromStatus: varchar('from_status', { length: 30 }),
    toStatus: varchar('to_status', { length: 30 }),
    performedBy: integer('performed_by').notNull(),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index('idx_po_history_order').on(t.productionOrderId, t.tenantId)]
);

// ─── Routing (Manufacturing vertical) ──────────────────────────────────────────
// Multi-step operation sequences (e.g. Cut -> Stitch -> Finish -> Pack), each step optionally
// assigned to a Work Center with a standard time. Keyed by finished item, same pattern as
// boms.finishedItemId — a routing describes HOW an item is produced, a BOM describes WHAT it's
// made of; the two are independent, a Production Order can reference either, both, or neither.
export const routings = pgTable(
  'routings',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    tenantId: integer('tenant_id').notNull(),
    name: varchar('name', { length: 200 }).notNull(),
    finishedItemId: integer('finished_item_id').notNull(),
    finishedVariantId: integer('finished_variant_id'),
    isActive: boolean('is_active').notNull().default(true),
    version: integer('version').notNull().default(0),
    createdBy: integer('created_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index('idx_routings_tenant_item').on(t.tenantId, t.finishedItemId)]
);

export const routingOperations = pgTable(
  'routing_operations',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    routingId: integer('routing_id').notNull(),
    tenantId: integer('tenant_id').notNull(),
    sequenceNo: integer('sequence_no').notNull(),
    operationName: varchar('operation_name', { length: 200 }).notNull(),
    workCenterId: integer('work_center_id'),
    standardTimeMinutes: decimal('standard_time_minutes', { precision: 10, scale: 2 })
      .notNull()
      .default('0'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index('idx_routing_operations_routing').on(t.routingId, t.sequenceNo)]
);

// One row per routing_operations row, instantiated onto a specific production order at create()
// time — tracks actual progress (status/actualTimeMinutes/started/completedAt) independently of
// the routing definition itself, which may later change or deactivate without affecting past
// orders that already copied its steps.
export const productionOrderOperations = pgTable(
  'production_order_operations',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    productionOrderId: integer('production_order_id').notNull(),
    tenantId: integer('tenant_id').notNull(),
    routingOperationId: integer('routing_operation_id'),
    sequenceNo: integer('sequence_no').notNull(),
    operationName: varchar('operation_name', { length: 200 }).notNull(),
    workCenterId: integer('work_center_id'),
    standardTimeMinutes: decimal('standard_time_minutes', { precision: 10, scale: 2 })
      .notNull()
      .default('0'),
    status: varchar('status', { length: 20 })
      .notNull()
      .default('PENDING')
      .$type<'PENDING' | 'IN_PROGRESS' | 'COMPLETED'>(),
    actualTimeMinutes: decimal('actual_time_minutes', { precision: 10, scale: 2 }),
    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index('idx_poo_order').on(t.productionOrderId, t.sequenceNo)]
);

// ─── Barcode Batches (Print Sessions) ────────────────────────────────────────
export const barcodeBatches = pgTable(
  'barcode_batches',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    tenantId: integer('tenant_id').notNull(),
    itemId: integer('item_id').notNull(),
    variantId: integer('variant_id'),
    quantity: integer('quantity').notNull(),
    format: varchar('format', { length: 20 })
      .notNull()
      .default('EAN13')
      .$type<'EAN13' | 'CODE128' | 'QR'>(),
    printFormat: varchar('print_format', { length: 30 })
      .notNull()
      .default('LABEL_40x25')
      .$type<'A4_SHEET' | 'LABEL_40x25' | 'LABEL_60x40' | 'LABEL_50x25' | 'LABEL_100x50'>(),
    printUrl: text('print_url'),
    createdBy: integer('created_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index('idx_barcode_batches_tenant').on(t.tenantId, t.createdAt),
    index('idx_barcode_batches_item').on(t.itemId, t.tenantId),
  ]
);

// ─── Barcodes (Individual Barcode Records) ────────────────────────────────────
export const barcodes = pgTable(
  'barcodes',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    tenantId: integer('tenant_id').notNull(),
    batchId: integer('batch_id').notNull(),
    itemId: integer('item_id').notNull(),
    variantId: integer('variant_id'),
    barcodeValue: varchar('barcode_value', { length: 200 }).notNull(),
    format: varchar('format', { length: 20 }).notNull().$type<'EAN13' | 'CODE128' | 'QR'>(),
    isActive: boolean('is_active').notNull().default(true),
    deactivatedAt: timestamp('deactivated_at', { withTimezone: true }),
    deactivatedBy: integer('deactivated_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    unique('barcodes_tenant_value').on(t.tenantId, t.barcodeValue),
    index('idx_barcodes_item').on(t.itemId, t.tenantId),
    index('idx_barcodes_value').on(t.barcodeValue, t.tenantId),
    index('idx_barcodes_batch').on(t.batchId),
  ]
);

// ─── Consignment Stocks ───────────────────────────────────────────────────────
// Consigned items are NOT owned until sold — NOT on balance sheet until sold
export const consignmentStocks = pgTable(
  'consignment_stocks',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    tenantId: integer('tenant_id').notNull(),
    supplierId: integer('supplier_id').notNull(),
    itemId: integer('item_id').notNull(),
    variantId: integer('variant_id'),
    warehouseId: integer('warehouse_id').notNull(),
    receivedQty: decimal('received_qty', { precision: 15, scale: 3 }).notNull(),
    soldQty: decimal('sold_qty', { precision: 15, scale: 3 }).notNull().default('0'),
    returnedQty: decimal('returned_qty', { precision: 15, scale: 3 }).notNull().default('0'),
    availableQty: decimal('available_qty', { precision: 15, scale: 3 }).notNull(),
    agreedRate: decimal('agreed_rate', { precision: 15, scale: 2 }).notNull(),
    receivedDate: timestamp('received_date', { withTimezone: true }).notNull(),
    referenceNumber: varchar('reference_number', { length: 100 }),
    status: varchar('status', { length: 20 })
      .notNull()
      .default('ACTIVE')
      .$type<'ACTIVE' | 'SETTLED' | 'RETURNED' | 'PARTIAL'>(),
    notes: text('notes'),
    createdBy: integer('created_by').notNull(),
    updatedBy: integer('updated_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    version: integer('version').notNull().default(0),
  },
  (t) => [
    index('idx_consignment_stocks_tenant').on(t.tenantId, t.status),
    index('idx_consignment_stocks_supplier').on(t.supplierId, t.tenantId),
    index('idx_consignment_stocks_item').on(t.itemId, t.tenantId),
  ]
);

// ─── Consignment Settlements ──────────────────────────────────────────────────
export const consignmentSettlements = pgTable(
  'consignment_settlements',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    tenantId: integer('tenant_id').notNull(),
    supplierId: integer('supplier_id').notNull(),
    settlementNumber: varchar('settlement_number', { length: 50 }),
    periodFrom: timestamp('period_from', { withTimezone: true }).notNull(),
    periodTo: timestamp('period_to', { withTimezone: true }).notNull(),
    totalSoldQty: decimal('total_sold_qty', { precision: 15, scale: 3 }).notNull().default('0'),
    totalAmount: decimal('total_amount', { precision: 15, scale: 2 }).notNull().default('0'),
    status: varchar('status', { length: 20 })
      .notNull()
      .default('PENDING')
      .$type<'PENDING' | 'SETTLED' | 'DISPUTED'>(),
    settledAt: timestamp('settled_at', { withTimezone: true }),
    settledBy: integer('settled_by'),
    paymentReference: varchar('payment_reference', { length: 100 }),
    lineItems: jsonb('line_items')
      .$type<
        Array<{
          consignmentStockId: number;
          itemId: number;
          soldQty: number;
          rate: number;
          amount: number;
        }>
      >()
      .notNull()
      .default([]),
    notes: text('notes'),
    createdBy: integer('created_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index('idx_consignment_settlements_tenant').on(t.tenantId, t.status),
    index('idx_consignment_settlements_supplier').on(t.supplierId, t.tenantId),
  ]
);

export type JobWorkOrder = typeof jobWorkOrders.$inferSelect;
export type NewJobWorkOrder = typeof jobWorkOrders.$inferInsert;
export type JobWorkOrderMaterial = typeof jobWorkOrderMaterials.$inferSelect;
export type JobWorkOrderQualityCheck = typeof jobWorkOrderQualityChecks.$inferSelect;
export type BarcodeBatch = typeof barcodeBatches.$inferSelect;
export type Barcode = typeof barcodes.$inferSelect;
export type ConsignmentStock = typeof consignmentStocks.$inferSelect;
export type NewConsignmentStock = typeof consignmentStocks.$inferInsert;
export type ConsignmentSettlement = typeof consignmentSettlements.$inferSelect;
