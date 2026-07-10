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

// ─── Quotations ───────────────────────────────────────────────────────────────
export const quotations = pgTable(
  'quotations',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    tenantId: integer('tenant_id').notNull(),
    branchId: integer('branch_id').notNull(),
    quotationNumber: varchar('quotation_number', { length: 50 }).notNull(),
    customerId: integer('customer_id').notNull(),
    status: varchar('status', { length: 30 })
      .notNull()
      .default('DRAFT')
      .$type<'DRAFT' | 'SENT' | 'VIEWED' | 'ACCEPTED' | 'CONVERTED' | 'EXPIRED' | 'REJECTED'>(),
    validUntil: timestamp('valid_until', { withTimezone: true }).notNull(),
    placeOfSupply: varchar('place_of_supply', { length: 2 }).notNull(),
    subtotal: decimal('subtotal', { precision: 15, scale: 2 }).notNull().default('0'),
    discountAmount: decimal('discount_amount', { precision: 15, scale: 2 }).notNull().default('0'),
    taxableAmount: decimal('taxable_amount', { precision: 15, scale: 2 }).notNull().default('0'),
    cgstAmount: decimal('cgst_amount', { precision: 15, scale: 2 }).notNull().default('0'),
    sgstAmount: decimal('sgst_amount', { precision: 15, scale: 2 }).notNull().default('0'),
    igstAmount: decimal('igst_amount', { precision: 15, scale: 2 }).notNull().default('0'),
    grandTotal: decimal('grand_total', { precision: 15, scale: 2 }).notNull().default('0'),
    currency: varchar('currency', { length: 3 }).notNull().default('INR'),
    notes: text('notes'),
    termsAndConditions: text('terms_and_conditions'),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    viewedAt: timestamp('viewed_at', { withTimezone: true }),
    convertedInvoiceId: integer('converted_invoice_id'),
    convertedAt: timestamp('converted_at', { withTimezone: true }),
    createdBy: integer('created_by').notNull(),
    updatedBy: integer('updated_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    version: integer('version').notNull().default(0),
  },
  (t) => [
    unique('quotations_tenant_number').on(t.tenantId, t.quotationNumber),
    index('idx_quotations_tenant_status').on(t.tenantId, t.status, t.createdAt),
    index('idx_quotations_customer').on(t.customerId, t.tenantId),
    index('idx_quotations_valid_until').on(t.validUntil, t.status),
  ]
);

export const quotationLines = pgTable(
  'quotation_lines',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    quotationId: integer('quotation_id').notNull(),
    tenantId: integer('tenant_id').notNull(),
    lineNumber: integer('line_number').notNull(),
    itemId: integer('item_id').notNull(),
    variantId: integer('variant_id'),
    description: text('description'),
    quantity: decimal('quantity', { precision: 15, scale: 3 }).notNull(),
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
    index('idx_quotation_lines_quotation').on(t.quotationId),
    index('idx_quotation_lines_item').on(t.itemId, t.tenantId),
  ]
);

// ─── Invoices ─────────────────────────────────────────────────────────────────
export const invoices = pgTable(
  'invoices',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    tenantId: integer('tenant_id').notNull(),
    branchId: integer('branch_id').notNull(),
    warehouseId: integer('warehouse_id').notNull(),
    invoiceNumber: varchar('invoice_number', { length: 50 }),
    status: varchar('status', { length: 30 })
      .notNull()
      .default('DRAFT')
      .$type<'DRAFT' | 'CONFIRMED' | 'PARTIALLY_PAID' | 'PAID' | 'CANCELLED' | 'OVERDUE'>(),
    customerId: integer('customer_id').notNull(),
    quotationId: integer('quotation_id'),
    deliveryChallanId: integer('delivery_challan_id'),
    placeOfSupply: varchar('place_of_supply', { length: 2 }).notNull(),
    invoiceDate: timestamp('invoice_date', { withTimezone: true }).notNull(),
    dueDate: timestamp('due_date', { withTimezone: true }).notNull(),
    paymentTerms: varchar('payment_terms', { length: 50 }),
    subtotal: decimal('subtotal', { precision: 15, scale: 2 }).notNull().default('0'),
    discountAmount: decimal('discount_amount', { precision: 15, scale: 2 }).notNull().default('0'),
    taxableAmount: decimal('taxable_amount', { precision: 15, scale: 2 }).notNull().default('0'),
    cgstAmount: decimal('cgst_amount', { precision: 15, scale: 2 }).notNull().default('0'),
    sgstAmount: decimal('sgst_amount', { precision: 15, scale: 2 }).notNull().default('0'),
    igstAmount: decimal('igst_amount', { precision: 15, scale: 2 }).notNull().default('0'),
    cessAmount: decimal('cess_amount', { precision: 15, scale: 2 }).notNull().default('0'),
    grandTotal: decimal('grand_total', { precision: 15, scale: 2 }).notNull().default('0'),
    paidAmount: decimal('paid_amount', { precision: 15, scale: 2 }).notNull().default('0'),
    balanceDue: decimal('balance_due', { precision: 15, scale: 2 }).notNull().default('0'),
    currency: varchar('currency', { length: 3 }).notNull().default('INR'),
    roundingAmount: decimal('rounding_amount', { precision: 8, scale: 2 }).notNull().default('0'),
    loyaltyPointsEarned: integer('loyalty_points_earned').notNull().default(0),
    loyaltyPointsRedeemed: integer('loyalty_points_redeemed').notNull().default(0),
    loyaltyRedemptionValue: decimal('loyalty_redemption_value', { precision: 10, scale: 2 }).notNull().default('0'),
    pdfUrl: text('pdf_url'),
    pdfGeneratedAt: timestamp('pdf_generated_at', { withTimezone: true }),
    notes: text('notes'),
    deliveryDate: timestamp('delivery_date', { withTimezone: true }),
    deliveryAddress: jsonb('delivery_address'),
    confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    cancellationReason: text('cancellation_reason'),
    approvalId: integer('approval_id'),
    createdBy: integer('created_by').notNull(),
    updatedBy: integer('updated_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    version: integer('version').notNull().default(0),
    // OFFLINE-02: client-generated UUID attached at offline-queue time, carried through
    // every retry of the same queued POS sale. NULL for non-POS-originated invoices, which
    // never collide under a standard Postgres unique constraint (mirrors
    // notification_log.idempotency_key's convention).
    clientOperationId: varchar('client_operation_id', { length: 100 }),
  },
  (t) => [
    unique('invoices_tenant_number').on(t.tenantId, t.invoiceNumber),
    unique('invoices_tenant_client_operation_id').on(t.tenantId, t.clientOperationId),
    index('idx_invoices_tenant_status').on(t.tenantId, t.status, t.invoiceDate),
    index('idx_invoices_customer').on(t.customerId, t.tenantId),
    index('idx_invoices_due_date').on(t.dueDate, t.status, t.tenantId),
    index('idx_invoices_branch').on(t.branchId, t.tenantId),
    // Phase 13: composite indexes for date-range customer queries
    index('idx_invoices_tenant_customer_date').on(t.tenantId, t.customerId, t.createdAt),
    index('idx_invoices_tenant_date').on(t.tenantId, t.createdAt),
    index('idx_invoices_tenant_status_created').on(t.tenantId, t.status, t.createdAt),
  ]
);

export const invoiceLines = pgTable(
  'invoice_lines',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    invoiceId: integer('invoice_id').notNull(),
    tenantId: integer('tenant_id').notNull(),
    lineNumber: integer('line_number').notNull(),
    itemId: integer('item_id').notNull(),
    variantId: integer('variant_id'),
    description: text('description'),
    quantity: decimal('quantity', { precision: 15, scale: 3 }).notNull(),
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
    cessRate: decimal('cess_rate', { precision: 5, scale: 2 }).notNull().default('0'),
    cessAmount: decimal('cess_amount', { precision: 15, scale: 2 }).notNull().default('0'),
    lineTotal: decimal('line_total', { precision: 15, scale: 2 }).notNull(),
    hsnCode: varchar('hsn_code', { length: 20 }),
    warehouseId: integer('warehouse_id'),
    reservationId: integer('reservation_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index('idx_invoice_lines_invoice').on(t.invoiceId),
    index('idx_invoice_lines_item').on(t.itemId, t.tenantId),
  ]
);

export const invoiceHistory = pgTable(
  'invoice_history',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    invoiceId: integer('invoice_id').notNull(),
    tenantId: integer('tenant_id').notNull(),
    action: varchar('action', { length: 100 }).notNull(),
    fromStatus: varchar('from_status', { length: 30 }),
    toStatus: varchar('to_status', { length: 30 }),
    performedBy: integer('performed_by').notNull(),
    notes: text('notes'),
    metadata: jsonb('metadata'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index('idx_invoice_history_invoice').on(t.invoiceId),
    index('idx_invoice_history_tenant').on(t.tenantId, t.createdAt),
  ]
);

// ─── POS Sessions ─────────────────────────────────────────────────────────────
export const posSessions = pgTable(
  'pos_sessions',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    tenantId: integer('tenant_id').notNull(),
    branchId: integer('branch_id').notNull(),
    warehouseId: integer('warehouse_id').notNull(),
    sessionNumber: varchar('session_number', { length: 50 }).notNull(),
    status: varchar('status', { length: 20 })
      .notNull()
      .default('OPEN')
      .$type<'OPEN' | 'CLOSED'>(),
    openedBy: integer('opened_by').notNull(),
    closedBy: integer('closed_by'),
    openingCash: decimal('opening_cash', { precision: 15, scale: 2 }).notNull().default('0'),
    closingCash: decimal('closing_cash', { precision: 15, scale: 2 }),
    expectedCash: decimal('expected_cash', { precision: 15, scale: 2 }),
    cashVariance: decimal('cash_variance', { precision: 15, scale: 2 }),
    totalSales: decimal('total_sales', { precision: 15, scale: 2 }).notNull().default('0'),
    totalTransactions: integer('total_transactions').notNull().default(0),
    openedAt: timestamp('opened_at', { withTimezone: true }).defaultNow().notNull(),
    closedAt: timestamp('closed_at', { withTimezone: true }),
  },
  (t) => [
    index('idx_pos_sessions_tenant_status').on(t.tenantId, t.status),
    index('idx_pos_sessions_branch').on(t.branchId, t.status),
  ]
);

// ─── POS Held Sales (park/resume a cart) ───────────────────────────────────────
export const posHeldSales = pgTable(
  'pos_held_sales',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    tenantId: integer('tenant_id').notNull(),
    sessionId: integer('session_id').notNull(),
    customerId: integer('customer_id'),
    label: varchar('label', { length: 100 }),
    cart: jsonb('cart').notNull(),
    createdBy: integer('created_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index('idx_pos_held_sales_tenant_session').on(t.tenantId, t.sessionId),
  ]
);

// ─── Payments ─────────────────────────────────────────────────────────────────
export const payments = pgTable(
  'payments',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    tenantId: integer('tenant_id').notNull(),
    branchId: integer('branch_id').notNull(),
    paymentNumber: varchar('payment_number', { length: 50 }).notNull(),
    customerId: integer('customer_id').notNull(),
    paymentDate: timestamp('payment_date', { withTimezone: true }).notNull(),
    paymentMode: varchar('payment_mode', { length: 30 })
      .notNull()
      .$type<'CASH' | 'CARD' | 'UPI' | 'CHEQUE' | 'NEFT' | 'RTGS' | 'CREDIT_NOTE' | 'ADVANCE' | 'LOYALTY'>(),
    amount: decimal('amount', { precision: 15, scale: 2 }).notNull(),
    allocatedAmount: decimal('allocated_amount', { precision: 15, scale: 2 }).notNull().default('0'),
    unallocatedAmount: decimal('unallocated_amount', { precision: 15, scale: 2 }).notNull().default('0'),
    status: varchar('status', { length: 30 })
      .notNull()
      .default('RECEIVED')
      .$type<'RECEIVED' | 'PARTIALLY_ALLOCATED' | 'FULLY_ALLOCATED' | 'BOUNCED' | 'REFUNDED'>(),
    // Cheque-specific
    chequeNumber: varchar('cheque_number', { length: 30 }),
    chequeBankName: varchar('cheque_bank_name', { length: 100 }),
    chequeDate: timestamp('cheque_date', { withTimezone: true }),
    bouncedAt: timestamp('bounced_at', { withTimezone: true }),
    bounceReason: text('bounce_reason'),
    // UPI/NEFT/RTGS
    transactionReference: varchar('transaction_reference', { length: 100 }),
    notes: text('notes'),
    posSessionId: integer('pos_session_id'),
    createdBy: integer('created_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    version: integer('version').notNull().default(0),
  },
  (t) => [
    unique('payments_tenant_number').on(t.tenantId, t.paymentNumber),
    index('idx_payments_tenant_customer').on(t.tenantId, t.customerId),
    index('idx_payments_date').on(t.tenantId, t.paymentDate),
    index('idx_payments_status').on(t.tenantId, t.status),
  ]
);

export const paymentAllocations = pgTable(
  'payment_allocations',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    paymentId: integer('payment_id').notNull(),
    invoiceId: integer('invoice_id').notNull(),
    tenantId: integer('tenant_id').notNull(),
    amount: decimal('amount', { precision: 15, scale: 2 }).notNull(),
    allocatedAt: timestamp('allocated_at', { withTimezone: true }).defaultNow().notNull(),
    allocatedBy: integer('allocated_by').notNull(),
  },
  (t) => [
    index('idx_payment_allocations_payment').on(t.paymentId),
    index('idx_payment_allocations_invoice').on(t.invoiceId),
  ]
);

// ─── Sale Returns ─────────────────────────────────────────────────────────────
export const saleReturns = pgTable(
  'sale_returns',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    tenantId: integer('tenant_id').notNull(),
    branchId: integer('branch_id').notNull(),
    returnNumber: varchar('return_number', { length: 50 }).notNull(),
    invoiceId: integer('invoice_id').notNull(),
    customerId: integer('customer_id').notNull(),
    status: varchar('status', { length: 30 })
      .notNull()
      .default('DRAFT')
      .$type<'DRAFT' | 'APPROVED' | 'CANCELLED'>(),
    returnDate: timestamp('return_date', { withTimezone: true }).notNull(),
    reason: varchar('reason', { length: 100 })
      .notNull()
      .$type<'DEFECTIVE' | 'WRONG_ITEM' | 'CUSTOMER_CHANGE_MIND' | 'QUALITY_ISSUE' | 'OTHER'>(),
    isPhysicalReturn: boolean('is_physical_return').notNull().default(true),
    warehouseId: integer('warehouse_id'),
    subtotal: decimal('subtotal', { precision: 15, scale: 2 }).notNull().default('0'),
    cgstAmount: decimal('cgst_amount', { precision: 15, scale: 2 }).notNull().default('0'),
    sgstAmount: decimal('sgst_amount', { precision: 15, scale: 2 }).notNull().default('0'),
    igstAmount: decimal('igst_amount', { precision: 15, scale: 2 }).notNull().default('0'),
    totalAmount: decimal('total_amount', { precision: 15, scale: 2 }).notNull().default('0'),
    creditNoteId: integer('credit_note_id'),
    notes: text('notes'),
    createdBy: integer('created_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    version: integer('version').notNull().default(0),
  },
  (t) => [
    unique('sale_returns_tenant_number').on(t.tenantId, t.returnNumber),
    index('idx_sale_returns_invoice').on(t.invoiceId),
    index('idx_sale_returns_customer').on(t.customerId, t.tenantId),
  ]
);

export const saleReturnLines = pgTable(
  'sale_return_lines',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    returnId: integer('return_id').notNull(),
    invoiceLineId: integer('invoice_line_id').notNull(),
    tenantId: integer('tenant_id').notNull(),
    itemId: integer('item_id').notNull(),
    variantId: integer('variant_id'),
    returnQty: decimal('return_qty', { precision: 15, scale: 3 }).notNull(),
    unitPrice: decimal('unit_price', { precision: 15, scale: 2 }).notNull(),
    cgstAmount: decimal('cgst_amount', { precision: 15, scale: 2 }).notNull().default('0'),
    sgstAmount: decimal('sgst_amount', { precision: 15, scale: 2 }).notNull().default('0'),
    igstAmount: decimal('igst_amount', { precision: 15, scale: 2 }).notNull().default('0'),
    lineTotal: decimal('line_total', { precision: 15, scale: 2 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index('idx_sale_return_lines_return').on(t.returnId),
    index('idx_sale_return_lines_item').on(t.itemId, t.tenantId),
  ]
);

// ─── Credit Notes ─────────────────────────────────────────────────────────────
export const creditNotes = pgTable(
  'credit_notes',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    tenantId: integer('tenant_id').notNull(),
    branchId: integer('branch_id').notNull(),
    creditNoteNumber: varchar('credit_note_number', { length: 50 }).notNull(),
    customerId: integer('customer_id').notNull(),
    saleReturnId: integer('sale_return_id'),
    originalInvoiceId: integer('original_invoice_id'),
    status: varchar('status', { length: 30 })
      .notNull()
      .default('OPEN')
      .$type<'OPEN' | 'PARTIALLY_USED' | 'FULLY_USED' | 'REFUNDED'>(),
    amount: decimal('amount', { precision: 15, scale: 2 }).notNull(),
    usedAmount: decimal('used_amount', { precision: 15, scale: 2 }).notNull().default('0'),
    remainingAmount: decimal('remaining_amount', { precision: 15, scale: 2 }).notNull(),
    expiryDate: timestamp('expiry_date', { withTimezone: true }),
    notes: text('notes'),
    createdBy: integer('created_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    version: integer('version').notNull().default(0),
  },
  (t) => [
    unique('credit_notes_tenant_number').on(t.tenantId, t.creditNoteNumber),
    index('idx_credit_notes_customer').on(t.customerId, t.tenantId, t.status),
  ]
);

// ─── Loyalty Transactions ─────────────────────────────────────────────────────
export const loyaltyTransactions = pgTable(
  'loyalty_transactions',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    tenantId: integer('tenant_id').notNull(),
    customerId: integer('customer_id').notNull(),
    type: varchar('type', { length: 30 })
      .notNull()
      .$type<'EARN' | 'REDEEM' | 'EXPIRE' | 'BIRTHDAY_BONUS' | 'ADJUSTMENT'>(),
    points: integer('points').notNull(),
    balanceBefore: integer('balance_before').notNull(),
    balanceAfter: integer('balance_after').notNull(),
    referenceType: varchar('reference_type', { length: 50 }),
    referenceId: integer('reference_id'),
    expiryDate: timestamp('expiry_date', { withTimezone: true }),
    notes: text('notes'),
    createdBy: integer('created_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index('idx_loyalty_customer').on(t.customerId, t.tenantId, t.createdAt),
    index('idx_loyalty_expiry').on(t.expiryDate, t.type, t.tenantId),
  ]
);

// ─── Delivery Challans ────────────────────────────────────────────────────────
export const deliveryChallans = pgTable(
  'delivery_challans',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    tenantId: integer('tenant_id').notNull(),
    branchId: integer('branch_id').notNull(),
    warehouseId: integer('warehouse_id').notNull(),
    challanNumber: varchar('challan_number', { length: 50 }).notNull(),
    customerId: integer('customer_id').notNull(),
    status: varchar('status', { length: 30 })
      .notNull()
      .default('DRAFT')
      .$type<'DRAFT' | 'DISPATCHED' | 'CONVERTED' | 'CANCELLED'>(),
    challanDate: timestamp('challan_date', { withTimezone: true }).notNull(),
    deliveryAddress: jsonb('delivery_address'),
    subtotal: decimal('subtotal', { precision: 15, scale: 2 }).notNull().default('0'),
    notes: text('notes'),
    convertedInvoiceId: integer('converted_invoice_id'),
    convertedAt: timestamp('converted_at', { withTimezone: true }),
    dispatchedAt: timestamp('dispatched_at', { withTimezone: true }),
    createdBy: integer('created_by').notNull(),
    updatedBy: integer('updated_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    version: integer('version').notNull().default(0),
  },
  (t) => [
    unique('delivery_challans_tenant_number').on(t.tenantId, t.challanNumber),
    index('idx_delivery_challans_tenant').on(t.tenantId, t.status, t.challanDate),
    index('idx_delivery_challans_customer').on(t.customerId, t.tenantId),
  ]
);

export const deliveryChallanLines = pgTable(
  'delivery_challan_lines',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    challanId: integer('challan_id').notNull(),
    tenantId: integer('tenant_id').notNull(),
    lineNumber: integer('line_number').notNull(),
    itemId: integer('item_id').notNull(),
    variantId: integer('variant_id'),
    description: text('description'),
    quantity: decimal('quantity', { precision: 15, scale: 3 }).notNull(),
    unitId: integer('unit_id'),
    unitPrice: decimal('unit_price', { precision: 15, scale: 2 }),
    hsnCode: varchar('hsn_code', { length: 20 }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index('idx_dc_lines_challan').on(t.challanId),
  ]
);

// ─── CQRS Projections (Sales) ─────────────────────────────────────────────────
export const projectionDashboardDaily = pgTable(
  'projection_dashboard_daily',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    tenantId: integer('tenant_id').notNull(),
    branchId: integer('branch_id').notNull(),
    date: timestamp('date', { withTimezone: true }).notNull(),
    salesCount: integer('sales_count').notNull().default(0),
    salesAmount: decimal('sales_amount', { precision: 15, scale: 2 }).notNull().default('0'),
    collectedAmount: decimal('collected_amount', { precision: 15, scale: 2 }).notNull().default('0'),
    returnCount: integer('return_count').notNull().default(0),
    returnAmount: decimal('return_amount', { precision: 15, scale: 2 }).notNull().default('0'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    unique('proj_dashboard_daily_unique').on(t.tenantId, t.branchId, t.date),
    index('idx_proj_dashboard_date').on(t.tenantId, t.date),
  ]
);

export const projectionCustomerBalance = pgTable(
  'projection_customer_balance',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    tenantId: integer('tenant_id').notNull(),
    customerId: integer('customer_id').notNull(),
    currentBalance: decimal('current_balance', { precision: 15, scale: 2 }).notNull().default('0'),
    totalInvoiced: decimal('total_invoiced', { precision: 15, scale: 2 }).notNull().default('0'),
    totalPaid: decimal('total_paid', { precision: 15, scale: 2 }).notNull().default('0'),
    overdueAmount: decimal('overdue_amount', { precision: 15, scale: 2 }).notNull().default('0'),
    lastInvoiceAt: timestamp('last_invoice_at', { withTimezone: true }),
    lastPaymentAt: timestamp('last_payment_at', { withTimezone: true }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    unique('proj_customer_balance_unique').on(t.tenantId, t.customerId),
    index('idx_proj_customer_balance_tenant').on(t.tenantId, t.currentBalance),
  ]
);
