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

// ─── Purchase Orders ──────────────────────────────────────────────────────────
export const purchaseOrders = pgTable(
  'purchase_orders',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    tenantId: integer('tenant_id').notNull(),
    branchId: integer('branch_id').notNull(),
    warehouseId: integer('warehouse_id').notNull(),
    poNumber: varchar('po_number', { length: 50 }),
    supplierId: integer('supplier_id').notNull(),
    status: varchar('status', { length: 30 })
      .notNull()
      .default('DRAFT')
      .$type<
        | 'DRAFT'
        | 'SUBMITTED'
        | 'PENDING_APPROVAL'
        | 'APPROVED'
        | 'PARTIALLY_RECEIVED'
        | 'RECEIVED'
        | 'CLOSED'
        | 'CANCELLED'
      >(),
    poDate: timestamp('po_date', { withTimezone: true }).notNull(),
    expectedDeliveryDate: timestamp('expected_delivery_date', { withTimezone: true }),
    // Purchase audit 2026-07-21 gap-fix: BLANKET/RATE_CONTRACT POs are long-validity
    // agreements that GRNs are progressively drawn against (call-offs) rather than a
    // one-off order — reuses the existing multi-GRN-per-PO mechanism, just gated by
    // contractValidTill instead of a fixed orderedQty being the only limit.
    poType: varchar('po_type', { length: 20 })
      .notNull()
      .default('STANDARD')
      .$type<'STANDARD' | 'BLANKET' | 'RATE_CONTRACT'>(),
    contractValidFrom: timestamp('contract_valid_from', { withTimezone: true }),
    contractValidTill: timestamp('contract_valid_till', { withTimezone: true }),
    requisitionId: integer('requisition_id'),
    placeOfSupply: varchar('place_of_supply', { length: 2 }).notNull(),
    sellerStateCode: varchar('seller_state_code', { length: 2 }),
    subtotal: decimal('subtotal', { precision: 15, scale: 2 }).notNull().default('0'),
    discountAmount: decimal('discount_amount', { precision: 15, scale: 2 }).notNull().default('0'),
    taxableAmount: decimal('taxable_amount', { precision: 15, scale: 2 }).notNull().default('0'),
    cgstAmount: decimal('cgst_amount', { precision: 15, scale: 2 }).notNull().default('0'),
    sgstAmount: decimal('sgst_amount', { precision: 15, scale: 2 }).notNull().default('0'),
    igstAmount: decimal('igst_amount', { precision: 15, scale: 2 }).notNull().default('0'),
    grandTotal: decimal('grand_total', { precision: 15, scale: 2 }).notNull().default('0'),
    receivedAmount: decimal('received_amount', { precision: 15, scale: 2 }).notNull().default('0'),
    currency: varchar('currency', { length: 3 }).notNull().default('INR'),
    notes: text('notes'),
    termsAndConditions: text('terms_and_conditions'),
    pdfUrl: text('pdf_url'),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    approvedBy: integer('approved_by'),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    cancellationReason: text('cancellation_reason'),
    submittedAt: timestamp('submitted_at', { withTimezone: true }),
    createdBy: integer('created_by').notNull(),
    updatedBy: integer('updated_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    version: integer('version').notNull().default(0),
  },
  (t) => [
    unique('purchase_orders_tenant_number').on(t.tenantId, t.poNumber),
    index('idx_po_tenant_status').on(t.tenantId, t.status, t.createdAt),
    index('idx_po_supplier').on(t.supplierId, t.tenantId),
    index('idx_po_expected_delivery').on(t.expectedDeliveryDate, t.status),
  ]
);

export const purchaseOrderLines = pgTable(
  'purchase_order_lines',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    purchaseOrderId: integer('purchase_order_id').notNull(),
    tenantId: integer('tenant_id').notNull(),
    lineNumber: integer('line_number').notNull(),
    itemId: integer('item_id').notNull(),
    variantId: integer('variant_id'),
    description: text('description'),
    orderedQty: decimal('ordered_qty', { precision: 15, scale: 3 }).notNull(),
    receivedQty: decimal('received_qty', { precision: 15, scale: 3 }).notNull().default('0'),
    unitId: integer('unit_id'),
    unitPrice: decimal('unit_price', { precision: 15, scale: 2 }).notNull(),
    discountPct: decimal('discount_pct', { precision: 5, scale: 2 }).notNull().default('0'),
    discountAmount: decimal('discount_amount', { precision: 15, scale: 2 }).notNull().default('0'),
    taxableAmount: decimal('taxable_amount', { precision: 15, scale: 2 }).notNull().default('0'),
    gstRate: decimal('gst_rate', { precision: 5, scale: 2 }).notNull().default('0'),
    cgstRate: decimal('cgst_rate', { precision: 5, scale: 2 }).notNull().default('0'),
    sgstRate: decimal('sgst_rate', { precision: 5, scale: 2 }).notNull().default('0'),
    igstRate: decimal('igst_rate', { precision: 5, scale: 2 }).notNull().default('0'),
    cgstAmount: decimal('cgst_amount', { precision: 15, scale: 2 }).notNull().default('0'),
    sgstAmount: decimal('sgst_amount', { precision: 15, scale: 2 }).notNull().default('0'),
    igstAmount: decimal('igst_amount', { precision: 15, scale: 2 }).notNull().default('0'),
    lineTotal: decimal('line_total', { precision: 15, scale: 2 }).notNull(),
    hsnCode: varchar('hsn_code', { length: 20 }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index('idx_po_lines_po').on(t.purchaseOrderId),
    index('idx_po_lines_item').on(t.itemId, t.tenantId),
  ]
);

export const purchaseOrderHistory = pgTable(
  'purchase_order_history',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    purchaseOrderId: integer('purchase_order_id').notNull(),
    tenantId: integer('tenant_id').notNull(),
    action: varchar('action', { length: 100 }).notNull(),
    fromStatus: varchar('from_status', { length: 30 }),
    toStatus: varchar('to_status', { length: 30 }),
    performedBy: integer('performed_by').notNull(),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index('idx_po_history_po').on(t.purchaseOrderId, t.tenantId)]
);

export const purchaseOrderAmendments = pgTable(
  'purchase_order_amendments',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    purchaseOrderId: integer('purchase_order_id').notNull(),
    tenantId: integer('tenant_id').notNull(),
    amendments: jsonb('amendments').notNull(),
    reason: text('reason').notNull(),
    performedBy: integer('performed_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index('idx_po_amendments_po').on(t.purchaseOrderId, t.tenantId)]
);

// ─── Goods Receipt Notes (GRN) ────────────────────────────────────────────────
export const grns = pgTable(
  'grns',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    tenantId: integer('tenant_id').notNull(),
    branchId: integer('branch_id').notNull(),
    warehouseId: integer('warehouse_id').notNull(),
    grnNumber: varchar('grn_number', { length: 50 }),
    purchaseOrderId: integer('purchase_order_id').notNull(),
    supplierId: integer('supplier_id').notNull(),
    status: varchar('status', { length: 30 })
      .notNull()
      .default('DRAFT')
      .$type<'DRAFT' | 'PENDING_APPROVAL' | 'APPROVED' | 'REJECTED'>(),
    grnDate: timestamp('grn_date', { withTimezone: true }).notNull(),
    supplierInvoiceNumber: varchar('supplier_invoice_number', { length: 100 }),
    supplierInvoiceDate: timestamp('supplier_invoice_date', { withTimezone: true }),
    subtotal: decimal('subtotal', { precision: 15, scale: 2 }).notNull().default('0'),
    taxableAmount: decimal('taxable_amount', { precision: 15, scale: 2 }).notNull().default('0'),
    cgstAmount: decimal('cgst_amount', { precision: 15, scale: 2 }).notNull().default('0'),
    sgstAmount: decimal('sgst_amount', { precision: 15, scale: 2 }).notNull().default('0'),
    igstAmount: decimal('igst_amount', { precision: 15, scale: 2 }).notNull().default('0'),
    cessAmount: decimal('cess_amount', { precision: 15, scale: 2 }).notNull().default('0'),
    grandTotal: decimal('grand_total', { precision: 15, scale: 2 }).notNull().default('0'),
    landedCostTotal: decimal('landed_cost_total', { precision: 15, scale: 2 })
      .notNull()
      .default('0'),
    effectiveCostTotal: decimal('effective_cost_total', { precision: 15, scale: 2 })
      .notNull()
      .default('0'),
    hasPriceVariance: boolean('has_price_variance').notNull().default(false),
    // RCM: true when supplier is unregistered — buyer self-assesses GST (ES-10)
    rcmApplicable: boolean('rcm_applicable').notNull().default(false),
    varianceApprovedBy: integer('variance_approved_by'),
    varianceApprovedAt: timestamp('variance_approved_at', { withTimezone: true }),
    notes: text('notes'),
    rejectionReason: text('rejection_reason'),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    approvedBy: integer('approved_by'),
    createdBy: integer('created_by').notNull(),
    updatedBy: integer('updated_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    version: integer('version').notNull().default(0),
    // Optional client-generated idempotency key — same mechanism as invoices.clientOperationId
    // (nullable + unique per tenant, so NULL never collides). A network-timeout retry of
    // POST /grns with the same operationId returns the original GRN instead of creating a
    // second DRAFT one that could later be independently approved, double-crediting stock.
    clientOperationId: varchar('client_operation_id', { length: 100 }),
  },
  (t) => [
    unique('grns_tenant_number').on(t.tenantId, t.grnNumber),
    unique('grns_tenant_client_operation_id').on(t.tenantId, t.clientOperationId),
    index('idx_grn_tenant_status').on(t.tenantId, t.status, t.createdAt),
    index('idx_grn_po').on(t.purchaseOrderId, t.tenantId),
    index('idx_grn_supplier').on(t.supplierId, t.tenantId),
  ]
);

export const grnLines = pgTable(
  'grn_lines',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    grnId: integer('grn_id').notNull(),
    tenantId: integer('tenant_id').notNull(),
    purchaseOrderLineId: integer('purchase_order_line_id'),
    lineNumber: integer('line_number').notNull(),
    itemId: integer('item_id').notNull(),
    variantId: integer('variant_id'),
    description: text('description'),
    orderedQty: decimal('ordered_qty', { precision: 15, scale: 3 }).notNull().default('0'),
    // receivedQty stays in this line's own unit (unitId below) — the PO-vs-GRN received-qty
    // ceiling check compares this directly against purchaseOrderLines.orderedQty, which is in
    // the same unit, so that guard is untouched. Multi-vertical platform audit 2026-08-16:
    // receivedQtyBaseUnit is the actual quantity applied to items.availableQty/inventory_ledger/
    // FIFO layers — receivedQty converted via items.purchaseUnitConversionFactor when unitId
    // below equals the item's purchaseUnitId, else identical to receivedQty. Nullable/backfilled
    // at approval time; existing rows and single-unit items are unaffected.
    receivedQty: decimal('received_qty', { precision: 15, scale: 3 }).notNull(),
    receivedQtyBaseUnit: decimal('received_qty_base_unit', { precision: 15, scale: 3 }),
    unitId: integer('unit_id'),
    poRate: decimal('po_rate', { precision: 15, scale: 2 }).notNull().default('0'),
    grnRate: decimal('grn_rate', { precision: 15, scale: 2 }).notNull(),
    priceVariancePct: decimal('price_variance_pct', { precision: 8, scale: 4 })
      .notNull()
      .default('0'),
    gstRate: decimal('gst_rate', { precision: 5, scale: 2 }).notNull().default('0'),
    cgstRate: decimal('cgst_rate', { precision: 5, scale: 2 }).notNull().default('0'),
    sgstRate: decimal('sgst_rate', { precision: 5, scale: 2 }).notNull().default('0'),
    igstRate: decimal('igst_rate', { precision: 5, scale: 2 }).notNull().default('0'),
    taxableAmount: decimal('taxable_amount', { precision: 15, scale: 2 }).notNull().default('0'),
    cgstAmount: decimal('cgst_amount', { precision: 15, scale: 2 }).notNull().default('0'),
    sgstAmount: decimal('sgst_amount', { precision: 15, scale: 2 }).notNull().default('0'),
    igstAmount: decimal('igst_amount', { precision: 15, scale: 2 }).notNull().default('0'),
    cessRate: decimal('cess_rate', { precision: 5, scale: 2 }).notNull().default('0'),
    cessAmount: decimal('cess_amount', { precision: 15, scale: 2 }).notNull().default('0'),
    lineTotal: decimal('line_total', { precision: 15, scale: 2 }).notNull(),
    allocatedLandedCost: decimal('allocated_landed_cost', { precision: 15, scale: 2 })
      .notNull()
      .default('0'),
    effectiveUnitCost: decimal('effective_unit_cost', { precision: 15, scale: 4 })
      .notNull()
      .default('0'),
    hsnCode: varchar('hsn_code', { length: 20 }),
    warehouseId: integer('warehouse_id'),
    // ES-purchase-audit: batch/serial/expiry/QC capture at receipt time — see migration
    // 0088 for why these are receipt-only fields, not a full batch-wise stock ledger.
    batchNumber: varchar('batch_number', { length: 100 }),
    serialNumbers: jsonb('serial_numbers').$type<string[]>(),
    expiryDate: timestamp('expiry_date', { withTimezone: true }),
    acceptedQty: decimal('accepted_qty', { precision: 15, scale: 3 }),
    rejectedQty: decimal('rejected_qty', { precision: 15, scale: 3 }).notNull().default('0'),
    damagedQty: decimal('damaged_qty', { precision: 15, scale: 3 }).notNull().default('0'),
    qcStatus: varchar('qc_status', { length: 20 })
      .notNull()
      .default('NA')
      .$type<'PENDING' | 'PASSED' | 'FAILED' | 'NA'>(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index('idx_grn_lines_grn').on(t.grnId),
    index('idx_grn_lines_item').on(t.itemId, t.tenantId),
    index('idx_grn_lines_batch').on(t.batchNumber, t.tenantId),
  ]
);

export const grnHistory = pgTable(
  'grn_history',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    grnId: integer('grn_id').notNull(),
    tenantId: integer('tenant_id').notNull(),
    action: varchar('action', { length: 100 }).notNull(),
    fromStatus: varchar('from_status', { length: 30 }),
    toStatus: varchar('to_status', { length: 30 }),
    performedBy: integer('performed_by').notNull(),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index('idx_grn_history_grn').on(t.grnId, t.tenantId)]
);

// ─── Landed Costs ─────────────────────────────────────────────────────────────
export const landedCosts = pgTable(
  'landed_costs',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    tenantId: integer('tenant_id').notNull(),
    grnId: integer('grn_id').notNull(),
    costType: varchar('cost_type', { length: 50 })
      .notNull()
      .$type<'CUSTOMS_DUTY' | 'FREIGHT' | 'INSURANCE' | 'HANDLING' | 'OTHER'>(),
    description: text('description'),
    amount: decimal('amount', { precision: 15, scale: 2 }).notNull(),
    allocationMethod: varchar('allocation_method', { length: 20 })
      .notNull()
      .default('BY_VALUE')
      .$type<'BY_VALUE' | 'BY_QUANTITY' | 'BY_WEIGHT'>(),
    isAllocated: boolean('is_allocated').notNull().default(false),
    createdBy: integer('created_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index('idx_landed_costs_grn').on(t.grnId, t.tenantId)]
);

// ─── Supplier Payments ────────────────────────────────────────────────────────
export const supplierPayments = pgTable(
  'supplier_payments',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    tenantId: integer('tenant_id').notNull(),
    branchId: integer('branch_id').notNull(),
    paymentNumber: varchar('payment_number', { length: 50 }).notNull(),
    supplierId: integer('supplier_id').notNull(),
    paymentDate: timestamp('payment_date', { withTimezone: true }).notNull(),
    paymentMode: varchar('payment_mode', { length: 20 })
      .notNull()
      .$type<'CASH' | 'CHEQUE' | 'NEFT' | 'RTGS' | 'UPI' | 'ADVANCE'>(),
    amount: decimal('amount', { precision: 15, scale: 2 }).notNull(),
    allocatedAmount: decimal('allocated_amount', { precision: 15, scale: 2 })
      .notNull()
      .default('0'),
    unallocatedAmount: decimal('unallocated_amount', { precision: 15, scale: 2 }).notNull(),
    status: varchar('status', { length: 30 })
      .notNull()
      .default('PAID')
      .$type<'PAID' | 'PARTIALLY_ALLOCATED' | 'FULLY_ALLOCATED' | 'BOUNCED' | 'CANCELLED'>(),
    chequeNumber: varchar('cheque_number', { length: 50 }),
    chequeBankName: varchar('cheque_bank_name', { length: 200 }),
    chequeDate: timestamp('cheque_date', { withTimezone: true }),
    isPdc: boolean('is_pdc').notNull().default(false),
    pdcClearingDate: timestamp('pdc_clearing_date', { withTimezone: true }),
    pdcAlertSentAt: timestamp('pdc_alert_sent_at', { withTimezone: true }),
    transactionReference: varchar('transaction_reference', { length: 100 }),
    notes: text('notes'),
    bouncedAt: timestamp('bounced_at', { withTimezone: true }),
    bounceReason: text('bounce_reason'),
    createdBy: integer('created_by').notNull(),
    updatedBy: integer('updated_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    unique('supplier_payments_tenant_number').on(t.tenantId, t.paymentNumber),
    index('idx_sp_tenant_supplier').on(t.tenantId, t.supplierId, t.paymentDate),
    index('idx_sp_pdc').on(t.isPdc, t.pdcClearingDate, t.status),
  ]
);

export const supplierPaymentAllocations = pgTable(
  'supplier_payment_allocations',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    paymentId: integer('payment_id').notNull(),
    grnId: integer('grn_id').notNull(),
    tenantId: integer('tenant_id').notNull(),
    amount: decimal('amount', { precision: 15, scale: 2 }).notNull(),
    allocatedBy: integer('allocated_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index('idx_sp_alloc_payment').on(t.paymentId, t.tenantId),
    index('idx_sp_alloc_grn').on(t.grnId, t.tenantId),
  ]
);

// ─── Purchase Returns ─────────────────────────────────────────────────────────
export const purchaseReturns = pgTable(
  'purchase_returns',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    tenantId: integer('tenant_id').notNull(),
    branchId: integer('branch_id').notNull(),
    returnNumber: varchar('return_number', { length: 50 }),
    grnId: integer('grn_id').notNull(),
    supplierId: integer('supplier_id').notNull(),
    warehouseId: integer('warehouse_id').notNull(),
    status: varchar('status', { length: 30 })
      .notNull()
      .default('DRAFT')
      .$type<'DRAFT' | 'PENDING_APPROVAL' | 'APPROVED' | 'CANCELLED'>(),
    returnDate: timestamp('return_date', { withTimezone: true }).notNull(),
    reason: varchar('reason', { length: 50 })
      .notNull()
      .$type<'QUALITY_ISSUE' | 'WRONG_ITEM' | 'EXCESS_QUANTITY' | 'DAMAGED' | 'OTHER'>(),
    returnNotes: text('return_notes'),
    grandTotal: decimal('grand_total', { precision: 15, scale: 2 }).notNull().default('0'),
    debitNoteId: integer('debit_note_id'),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    approvedBy: integer('approved_by'),
    createdBy: integer('created_by').notNull(),
    updatedBy: integer('updated_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    unique('purchase_returns_tenant_number').on(t.tenantId, t.returnNumber),
    index('idx_pr_tenant_status').on(t.tenantId, t.status, t.createdAt),
    index('idx_pr_grn').on(t.grnId, t.tenantId),
    index('idx_pr_supplier').on(t.supplierId, t.tenantId),
  ]
);

export const purchaseReturnLines = pgTable(
  'purchase_return_lines',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    purchaseReturnId: integer('purchase_return_id').notNull(),
    tenantId: integer('tenant_id').notNull(),
    grnLineId: integer('grn_line_id').notNull(),
    lineNumber: integer('line_number').notNull(),
    itemId: integer('item_id').notNull(),
    variantId: integer('variant_id'),
    returnQty: decimal('return_qty', { precision: 15, scale: 3 }).notNull(),
    unitPrice: decimal('unit_price', { precision: 15, scale: 2 }).notNull(),
    gstRate: decimal('gst_rate', { precision: 5, scale: 2 }).notNull().default('0'),
    taxableAmount: decimal('taxable_amount', { precision: 15, scale: 2 }).notNull().default('0'),
    cgstAmount: decimal('cgst_amount', { precision: 15, scale: 2 }).notNull().default('0'),
    sgstAmount: decimal('sgst_amount', { precision: 15, scale: 2 }).notNull().default('0'),
    igstAmount: decimal('igst_amount', { precision: 15, scale: 2 }).notNull().default('0'),
    lineTotal: decimal('line_total', { precision: 15, scale: 2 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index('idx_pr_lines_return').on(t.purchaseReturnId),
    index('idx_pr_lines_item').on(t.itemId, t.tenantId),
  ]
);

// ─── Debit Notes ──────────────────────────────────────────────────────────────
export const debitNotes = pgTable(
  'debit_notes',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    tenantId: integer('tenant_id').notNull(),
    debitNoteNumber: varchar('debit_note_number', { length: 50 }).notNull(),
    purchaseReturnId: integer('purchase_return_id').notNull(),
    supplierId: integer('supplier_id').notNull(),
    status: varchar('status', { length: 20 })
      .notNull()
      .default('OPEN')
      .$type<'OPEN' | 'PARTIALLY_APPLIED' | 'APPLIED' | 'CANCELLED'>(),
    amount: decimal('amount', { precision: 15, scale: 2 }).notNull(),
    appliedAmount: decimal('applied_amount', { precision: 15, scale: 2 }).notNull().default('0'),
    balanceAmount: decimal('balance_amount', { precision: 15, scale: 2 }).notNull(),
    issueDate: timestamp('issue_date', { withTimezone: true }).notNull(),
    expiryDate: timestamp('expiry_date', { withTimezone: true }),
    notes: text('notes'),
    createdBy: integer('created_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    unique('debit_notes_tenant_number').on(t.tenantId, t.debitNoteNumber),
    index('idx_debit_notes_tenant_supplier').on(t.tenantId, t.supplierId, t.status),
  ]
);

// ─── Expenses ─────────────────────────────────────────────────────────────────
export const expenses = pgTable(
  'expenses',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    tenantId: integer('tenant_id').notNull(),
    branchId: integer('branch_id').notNull(),
    expenseNumber: varchar('expense_number', { length: 50 }),
    expenseType: varchar('expense_type', { length: 50 })
      .notNull()
      .$type<
        'RENT' | 'ELECTRICITY' | 'SALARY' | 'FREIGHT' | 'MARKETING' | 'MAINTENANCE' | 'MISC'
      >(),
    supplierId: integer('supplier_id'),
    status: varchar('status', { length: 30 })
      .notNull()
      .default('DRAFT')
      .$type<'DRAFT' | 'SUBMITTED' | 'PENDING_APPROVAL' | 'APPROVED' | 'PAID'>(),
    expenseDate: timestamp('expense_date', { withTimezone: true }).notNull(),
    dueDate: timestamp('due_date', { withTimezone: true }),
    description: text('description'),
    totalAmount: decimal('total_amount', { precision: 15, scale: 2 }).notNull().default('0'),
    paidAmount: decimal('paid_amount', { precision: 15, scale: 2 }).notNull().default('0'),
    paymentMode: varchar('payment_mode', { length: 20 }).$type<
      'CASH' | 'CHEQUE' | 'NEFT' | 'RTGS' | 'UPI'
    >(),
    paymentDate: timestamp('payment_date', { withTimezone: true }),
    paymentReference: varchar('payment_reference', { length: 100 }),
    accountId: integer('account_id'),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    approvedBy: integer('approved_by'),
    paidAt: timestamp('paid_at', { withTimezone: true }),
    paidBy: integer('paid_by'),
    notes: text('notes'),
    attachments: jsonb('attachments').notNull().default([]),
    createdBy: integer('created_by').notNull(),
    updatedBy: integer('updated_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    unique('expenses_tenant_number').on(t.tenantId, t.expenseNumber),
    index('idx_expenses_tenant_status').on(t.tenantId, t.status, t.expenseDate),
    index('idx_expenses_type').on(t.tenantId, t.expenseType),
  ]
);

export const expenseLines = pgTable(
  'expense_lines',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    expenseId: integer('expense_id').notNull(),
    tenantId: integer('tenant_id').notNull(),
    lineNumber: integer('line_number').notNull(),
    description: text('description').notNull(),
    amount: decimal('amount', { precision: 15, scale: 2 }).notNull(),
    gstRate: decimal('gst_rate', { precision: 5, scale: 2 }).notNull().default('0'),
    gstAmount: decimal('gst_amount', { precision: 15, scale: 2 }).notNull().default('0'),
    lineTotal: decimal('line_total', { precision: 15, scale: 2 }).notNull(),
    accountId: integer('account_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index('idx_expense_lines_expense').on(t.expenseId)]
);

// ─── Supplier Payable Projection (CQRS) ──────────────────────────────────────
export const projectionSupplierBalance = pgTable(
  'projection_supplier_balance',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    tenantId: integer('tenant_id').notNull(),
    supplierId: integer('supplier_id').notNull(),
    currentBalance: decimal('current_balance', { precision: 15, scale: 2 }).notNull().default('0'),
    totalPurchased: decimal('total_purchased', { precision: 15, scale: 2 }).notNull().default('0'),
    totalPaid: decimal('total_paid', { precision: 15, scale: 2 }).notNull().default('0'),
    totalReturns: decimal('total_returns', { precision: 15, scale: 2 }).notNull().default('0'),
    overdueAmount: decimal('overdue_amount', { precision: 15, scale: 2 }).notNull().default('0'),
    lastGrnAt: timestamp('last_grn_at', { withTimezone: true }),
    lastPaymentAt: timestamp('last_payment_at', { withTimezone: true }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    unique('proj_supplier_balance_unique').on(t.tenantId, t.supplierId),
    index('idx_proj_supplier_balance_tenant').on(t.tenantId, t.supplierId),
  ]
);

// ─── Purchase Requisitions ────────────────────────────────────────────────────
// Purchase audit 2026-07-21 gap-fix: department request -> approval, upstream of RFQ/PO.
// No budget/cost-center-budget subsystem exists anywhere in this codebase (confirmed via
// gap-analysis search) — estimatedTotal is captured for the approver's judgment call, not
// enforced against a budget ceiling. Genuine, documented scope decision, not an oversight.
export const purchaseRequisitions = pgTable(
  'purchase_requisitions',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    tenantId: integer('tenant_id').notNull(),
    branchId: integer('branch_id').notNull(),
    requisitionNumber: varchar('requisition_number', { length: 50 }),
    department: varchar('department', { length: 100 }),
    priority: varchar('priority', { length: 10 })
      .notNull()
      .default('MEDIUM')
      .$type<'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT'>(),
    status: varchar('status', { length: 20 })
      .notNull()
      .default('DRAFT')
      .$type<'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'REJECTED' | 'CONVERTED' | 'CANCELLED'>(),
    requiredByDate: timestamp('required_by_date', { withTimezone: true }),
    estimatedTotal: decimal('estimated_total', { precision: 15, scale: 2 }).notNull().default('0'),
    notes: text('notes'),
    rejectionReason: text('rejection_reason'),
    convertedToPoId: integer('converted_to_po_id'),
    requestedBy: integer('requested_by').notNull(),
    approvedBy: integer('approved_by'),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    version: integer('version').notNull().default(0),
  },
  (t) => [
    unique('purchase_requisitions_tenant_number').on(t.tenantId, t.requisitionNumber),
    index('idx_requisition_tenant_status').on(t.tenantId, t.status, t.createdAt),
  ]
);

export const purchaseRequisitionLines = pgTable(
  'purchase_requisition_lines',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    requisitionId: integer('requisition_id').notNull(),
    tenantId: integer('tenant_id').notNull(),
    lineNumber: integer('line_number').notNull(),
    itemId: integer('item_id').notNull(),
    description: text('description'),
    requestedQty: decimal('requested_qty', { precision: 15, scale: 3 }).notNull(),
    unitId: integer('unit_id'),
    estimatedUnitPrice: decimal('estimated_unit_price', { precision: 15, scale: 2 })
      .notNull()
      .default('0'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index('idx_requisition_lines_requisition').on(t.requisitionId)]
);

// ─── RFQ / Supplier Quotations ────────────────────────────────────────────────
export const rfqs = pgTable(
  'rfqs',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    tenantId: integer('tenant_id').notNull(),
    branchId: integer('branch_id').notNull(),
    rfqNumber: varchar('rfq_number', { length: 50 }),
    requisitionId: integer('requisition_id'),
    status: varchar('status', { length: 20 })
      .notNull()
      .default('DRAFT')
      .$type<'DRAFT' | 'SENT' | 'CLOSED' | 'CANCELLED'>(),
    dueDate: timestamp('due_date', { withTimezone: true }),
    notes: text('notes'),
    createdBy: integer('created_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    unique('rfqs_tenant_number').on(t.tenantId, t.rfqNumber),
    index('idx_rfq_tenant_status').on(t.tenantId, t.status, t.createdAt),
  ]
);

export const rfqLines = pgTable(
  'rfq_lines',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    rfqId: integer('rfq_id').notNull(),
    tenantId: integer('tenant_id').notNull(),
    lineNumber: integer('line_number').notNull(),
    itemId: integer('item_id').notNull(),
    description: text('description'),
    qty: decimal('qty', { precision: 15, scale: 3 }).notNull(),
    unitId: integer('unit_id'),
  },
  (t) => [index('idx_rfq_lines_rfq').on(t.rfqId)]
);

export const rfqSuppliers = pgTable(
  'rfq_suppliers',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    rfqId: integer('rfq_id').notNull(),
    tenantId: integer('tenant_id').notNull(),
    supplierId: integer('supplier_id').notNull(),
    status: varchar('status', { length: 20 })
      .notNull()
      .default('INVITED')
      .$type<'INVITED' | 'RESPONDED' | 'DECLINED'>(),
    invitedAt: timestamp('invited_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    unique('rfq_suppliers_unique').on(t.rfqId, t.supplierId),
    index('idx_rfq_suppliers_rfq').on(t.rfqId, t.tenantId),
  ]
);

export const supplierQuotations = pgTable(
  'supplier_quotations',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    tenantId: integer('tenant_id').notNull(),
    rfqId: integer('rfq_id').notNull(),
    supplierId: integer('supplier_id').notNull(),
    quotationNumber: varchar('quotation_number', { length: 100 }),
    status: varchar('status', { length: 20 })
      .notNull()
      .default('SUBMITTED')
      .$type<'SUBMITTED' | 'SELECTED' | 'REJECTED'>(),
    validTill: timestamp('valid_till', { withTimezone: true }),
    grandTotal: decimal('grand_total', { precision: 15, scale: 2 }).notNull().default('0'),
    notes: text('notes'),
    convertedToPoId: integer('converted_to_po_id'),
    createdBy: integer('created_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index('idx_quotation_rfq').on(t.rfqId, t.tenantId),
    index('idx_quotation_supplier').on(t.supplierId, t.tenantId),
  ]
);

export const supplierQuotationLines = pgTable(
  'supplier_quotation_lines',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    quotationId: integer('quotation_id').notNull(),
    tenantId: integer('tenant_id').notNull(),
    rfqLineId: integer('rfq_line_id').notNull(),
    itemId: integer('item_id').notNull(),
    qty: decimal('qty', { precision: 15, scale: 3 }).notNull(),
    unitPrice: decimal('unit_price', { precision: 15, scale: 2 }).notNull(),
    gstRate: decimal('gst_rate', { precision: 5, scale: 2 }).notNull().default('0'),
    deliveryDays: integer('delivery_days'),
    lineTotal: decimal('line_total', { precision: 15, scale: 2 }).notNull(),
  },
  (t) => [index('idx_quotation_lines_quotation').on(t.quotationId)]
);

// ─── Purchase Invoices (supplier-invoice capture + PO/GRN variance check) ────
// Purchase audit 2026-07-21 gap-fix: this system posts AP/GST at GRN approval (2-way
// PO<->GRN match) — deliberately NOT changed by this table (see PurchaseInvoiceService
// module comment). This is a reconciliation/audit record only: captures what the supplier
// actually billed against what was received, and flags qty/rate variance for review. Not
// wired into SupplierPaymentService, which continues to allocate against GRNs exactly as
// before this feature.
export const purchaseInvoices = pgTable(
  'purchase_invoices',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    tenantId: integer('tenant_id').notNull(),
    branchId: integer('branch_id').notNull(),
    invoiceNumber: varchar('invoice_number', { length: 50 }),
    supplierInvoiceNumber: varchar('supplier_invoice_number', { length: 100 }).notNull(),
    supplierId: integer('supplier_id').notNull(),
    purchaseOrderId: integer('purchase_order_id').notNull(),
    grnId: integer('grn_id').notNull(),
    invoiceDate: timestamp('invoice_date', { withTimezone: true }).notNull(),
    status: varchar('status', { length: 20 })
      .notNull()
      .default('MATCHED')
      .$type<'MATCHED' | 'VARIANCE' | 'APPROVED'>(),
    subtotal: decimal('subtotal', { precision: 15, scale: 2 }).notNull().default('0'),
    taxAmount: decimal('tax_amount', { precision: 15, scale: 2 }).notNull().default('0'),
    grandTotal: decimal('grand_total', { precision: 15, scale: 2 }).notNull().default('0'),
    varianceAmount: decimal('variance_amount', { precision: 15, scale: 2 }).notNull().default('0'),
    notes: text('notes'),
    approvedBy: integer('approved_by'),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    createdBy: integer('created_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    unique('purchase_invoices_tenant_number').on(t.tenantId, t.invoiceNumber),
    index('idx_purchase_invoice_grn').on(t.grnId, t.tenantId),
    index('idx_purchase_invoice_po').on(t.purchaseOrderId, t.tenantId),
    index('idx_purchase_invoice_supplier').on(t.supplierId, t.tenantId),
  ]
);

export const purchaseInvoiceLines = pgTable(
  'purchase_invoice_lines',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    invoiceId: integer('invoice_id').notNull(),
    tenantId: integer('tenant_id').notNull(),
    grnLineId: integer('grn_line_id').notNull(),
    itemId: integer('item_id').notNull(),
    invoicedQty: decimal('invoiced_qty', { precision: 15, scale: 3 }).notNull(),
    invoicedRate: decimal('invoiced_rate', { precision: 15, scale: 2 }).notNull(),
    qtyVariance: decimal('qty_variance', { precision: 15, scale: 3 }).notNull().default('0'),
    rateVariance: decimal('rate_variance', { precision: 15, scale: 2 }).notNull().default('0'),
    lineTotal: decimal('line_total', { precision: 15, scale: 2 }).notNull(),
  },
  (t) => [index('idx_purchase_invoice_lines_invoice').on(t.invoiceId)]
);

// ─── Type exports ─────────────────────────────────────────────────────────────
export type PurchaseOrder = typeof purchaseOrders.$inferSelect;
export type PurchaseOrderLine = typeof purchaseOrderLines.$inferSelect;
export type PurchaseOrderAmendment = typeof purchaseOrderAmendments.$inferSelect;
export type GRN = typeof grns.$inferSelect;
export type GRNLine = typeof grnLines.$inferSelect;
export type LandedCost = typeof landedCosts.$inferSelect;
export type SupplierPayment = typeof supplierPayments.$inferSelect;
export type SupplierPaymentAllocation = typeof supplierPaymentAllocations.$inferSelect;
export type PurchaseReturn = typeof purchaseReturns.$inferSelect;
export type PurchaseReturnLine = typeof purchaseReturnLines.$inferSelect;
export type DebitNote = typeof debitNotes.$inferSelect;
export type Expense = typeof expenses.$inferSelect;
export type ExpenseLine = typeof expenseLines.$inferSelect;
export type PurchaseRequisition = typeof purchaseRequisitions.$inferSelect;
export type PurchaseRequisitionLine = typeof purchaseRequisitionLines.$inferSelect;
export type Rfq = typeof rfqs.$inferSelect;
export type RfqLine = typeof rfqLines.$inferSelect;
export type RfqSupplier = typeof rfqSuppliers.$inferSelect;
export type SupplierQuotation = typeof supplierQuotations.$inferSelect;
export type SupplierQuotationLine = typeof supplierQuotationLines.$inferSelect;
export type PurchaseInvoice = typeof purchaseInvoices.$inferSelect;
export type PurchaseInvoiceLine = typeof purchaseInvoiceLines.$inferSelect;
