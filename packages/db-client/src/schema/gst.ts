import {
  bigserial,
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  varchar,
  decimal,
} from 'drizzle-orm/pg-core';

// ─── GST Rates ─────────────────────────────────────────────────────────────
// Valid GST rates: 0, 5, 12, 18, 28 (plus cess where applicable)
export const gstRates = pgTable(
  'gst_rates',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    tenantId: integer('tenant_id').notNull(),
    rate: decimal('rate', { precision: 5, scale: 2 }).notNull(),
    description: varchar('description', { length: 200 }).notNull(),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    createdBy: integer('created_by').notNull(),
    version: integer('version').notNull().default(0),
  },
  (t) => [
    unique('gst_rates_tenant_rate').on(t.tenantId, t.rate),
    index('idx_gst_rates_tenant').on(t.tenantId),
  ]
);

// ─── HSN Master (Government HSN Code Reference) ─────────────────────────
// Seeded with top textile/retail HSN codes on tenant provisioning
export const hsnMaster = pgTable(
  'hsn_master',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    hsnCode: varchar('hsn_code', { length: 20 }).notNull(),
    description: text('description').notNull(),
    gstRate: decimal('gst_rate', { precision: 5, scale: 2 }).notNull(),
    cessRate: decimal('cess_rate', { precision: 5, scale: 2 }).notNull().default('0'),
    chapter: varchar('chapter', { length: 10 }),
    heading: varchar('heading', { length: 10 }),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    unique('hsn_master_code').on(t.hsnCode),
    index('idx_hsn_master_code').on(t.hsnCode),
    index('idx_hsn_master_chapter').on(t.chapter),
  ]
);

// ─── GST Ledger (Phase 7 — M7.1) ────────────────────────────────────────
// Append-only register — one row per GST event (invoice, credit note, purchase, purchase return).
// Partitioned by period_month in prod; indexed heavily for monthly report aggregation.
export const gstLedger = pgTable(
  'gst_ledger',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    tenantId: integer('tenant_id').notNull(),
    // YYYY-MM format (e.g. "2025-06") for easy period filtering
    periodMonth: varchar('period_month', { length: 7 }).notNull(),
    entryType: varchar('entry_type', { length: 30 })
      .notNull()
      .$type<'SALES_INVOICE' | 'CREDIT_NOTE' | 'PURCHASE' | 'PURCHASE_RETURN'>(),
    // Counterparty — customer or supplier GSTIN
    gstinOfCounterparty: varchar('gstin_of_counterparty', { length: 15 }),
    counterpartyName: varchar('counterparty_name', { length: 300 }),
    // Document details
    documentNumber: varchar('document_number', { length: 100 }).notNull(),
    documentDate: date('document_date').notNull(),
    // GST amounts
    placeOfSupply: varchar('place_of_supply', { length: 2 }),
    isInterstate: boolean('is_interstate').notNull().default(false),
    taxableAmount: decimal('taxable_amount', { precision: 15, scale: 2 }).notNull().default('0'),
    cgstAmount: decimal('cgst_amount', { precision: 15, scale: 2 }).notNull().default('0'),
    sgstAmount: decimal('sgst_amount', { precision: 15, scale: 2 }).notNull().default('0'),
    igstAmount: decimal('igst_amount', { precision: 15, scale: 2 }).notNull().default('0'),
    cessAmount: decimal('cess_amount', { precision: 15, scale: 2 }).notNull().default('0'),
    totalGst: decimal('total_gst', { precision: 15, scale: 2 }).notNull().default('0'),
    grandTotal: decimal('grand_total', { precision: 15, scale: 2 }).notNull().default('0'),
    // ITC fields (for purchase entries)
    itcEligible: boolean('itc_eligible').notNull().default(true),
    itcReversalReason: varchar('itc_reversal_reason', { length: 200 }),
    // HSN and rate
    hsnCode: varchar('hsn_code', { length: 20 }),
    gstRate: decimal('gst_rate', { precision: 5, scale: 2 }),
    // RCM — buyer is liable to pay GST
    rcmApplicable: boolean('rcm_applicable').notNull().default(false),
    // Source linking (idempotency key)
    sourceEventId: varchar('source_event_id', { length: 100 }),
    sourceDocumentId: integer('source_document_id'),
    sourceDocumentType: varchar('source_document_type', { length: 50 }),
    branchId: integer('branch_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index('idx_gst_ledger_tenant_period').on(t.tenantId, t.periodMonth, t.entryType),
    index('idx_gst_ledger_counterparty').on(t.tenantId, t.gstinOfCounterparty, t.periodMonth),
    index('idx_gst_ledger_source').on(t.sourceEventId),
    index('idx_gst_ledger_doc').on(t.tenantId, t.documentNumber, t.entryType),
  ]
);

// ─── GST Return Filings Tracker (Phase 7 — M7.7) ────────────────────────
export const gstReturnFilings = pgTable(
  'gst_return_filings',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    tenantId: integer('tenant_id').notNull(),
    returnType: varchar('return_type', { length: 20 })
      .notNull()
      .$type<'GSTR1' | 'GSTR3B' | 'GSTR9' | 'GSTR9C'>(),
    period: varchar('period', { length: 7 }).notNull(), // YYYY-MM
    dueDate: date('due_date').notNull(),
    filedDate: date('filed_date'),
    status: varchar('status', { length: 20 })
      .notNull()
      .default('PENDING')
      .$type<'PENDING' | 'FILED' | 'LATE_FILED' | 'NIL_FILED'>(),
    referenceNumber: varchar('reference_number', { length: 100 }),
    filedBy: integer('filed_by'),
    filingData: jsonb('filing_data'),
    // PG-039 — manual override for figures that can't be derived from gst_ledger (currently
    // import-of-goods/import-of-services IGST): { importOfGoodsIgst?, importOfServicesIgst?,
    // enteredBy, enteredAt }. See Gstr3bService for how this merges into the computed return.
    manualAdjustments: jsonb('manual_adjustments'),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    unique('gst_return_filings_tenant_type_period').on(t.tenantId, t.returnType, t.period),
    index('idx_gst_return_filings_tenant').on(t.tenantId, t.returnType, t.status),
  ]
);

// ─── GSTR-2A Imported Entries (Phase 7 — M7.6) ──────────────────────────
export const gst2aEntries = pgTable(
  'gst_2a_entries',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    tenantId: integer('tenant_id').notNull(),
    period: varchar('period', { length: 7 }).notNull(),
    importBatchId: varchar('import_batch_id', { length: 50 }).notNull(),
    // Supplier details
    supplierGstin: varchar('supplier_gstin', { length: 15 }).notNull(),
    supplierName: varchar('supplier_name', { length: 300 }),
    // Invoice details from GSTR-2A
    invoiceNumber: varchar('invoice_number', { length: 100 }).notNull(),
    invoiceDate: date('invoice_date').notNull(),
    invoiceType: varchar('invoice_type', { length: 10 }).default('INV'),
    // Tax amounts
    taxableAmount: decimal('taxable_amount', { precision: 15, scale: 2 }).notNull().default('0'),
    cgstAmount: decimal('cgst_amount', { precision: 15, scale: 2 }).notNull().default('0'),
    sgstAmount: decimal('sgst_amount', { precision: 15, scale: 2 }).notNull().default('0'),
    igstAmount: decimal('igst_amount', { precision: 15, scale: 2 }).notNull().default('0'),
    cessAmount: decimal('cess_amount', { precision: 15, scale: 2 }).notNull().default('0'),
    placeOfSupply: varchar('place_of_supply', { length: 2 }),
    // Reconciliation result
    reconciliationStatus: varchar('reconciliation_status', { length: 20 })
      .notNull()
      .default('UNMATCHED')
      .$type<'MATCHED' | 'BOOKS_ONLY' | 'GSTR2A_ONLY' | 'AMOUNT_MISMATCH' | 'UNMATCHED'>(),
    matchedLedgerId: integer('matched_ledger_id'),
    matchVariance: decimal('match_variance', { precision: 15, scale: 2 }),
    reconciledAt: timestamp('reconciled_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index('idx_gst_2a_tenant_period').on(t.tenantId, t.period),
    index('idx_gst_2a_supplier').on(t.tenantId, t.supplierGstin, t.period),
    index('idx_gst_2a_status').on(t.tenantId, t.reconciliationStatus, t.period),
    index('idx_gst_2a_batch').on(t.importBatchId),
  ]
);

// ─── e-Invoice Data Store (Phase 7 — M7.4) ──────────────────────────────
// Stores IRN + AckNo + SignedQRCode; separate from invoices table to avoid modifying sales-service schema.
export const einvoiceData = pgTable(
  'einvoice_data',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    tenantId: integer('tenant_id').notNull(),
    invoiceId: integer('invoice_id').notNull(),
    invoiceNumber: varchar('invoice_number', { length: 100 }).notNull(),
    // IRN fields from NIC
    irn: varchar('irn', { length: 64 }),
    ackNumber: varchar('ack_number', { length: 50 }),
    ackDate: timestamp('ack_date', { withTimezone: true }),
    signedQrCode: text('signed_qr_code'),
    signedInvoice: text('signed_invoice'),
    // Status management
    irnStatus: varchar('irn_status', { length: 30 })
      .notNull()
      .default('PENDING_IRN')
      .$type<'PENDING_IRN' | 'IRN_GENERATED' | 'IRN_CANCELLED' | 'FAILED_IRN' | 'NOT_APPLICABLE' | 'CANCEL_REQUIRED_MANUALLY'>(),
    retryCount: integer('retry_count').notNull().default(0),
    lastRetryAt: timestamp('last_retry_at', { withTimezone: true }),
    failureReason: text('failure_reason'),
    // NIC cancellation
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    cancelReason: varchar('cancel_reason', { length: 200 }),
    cancelRemark: text('cancel_remark'),
    // e-Way Bill (M7.5)
    ewbNumber: varchar('ewb_number', { length: 30 }),
    ewbDate: timestamp('ewb_date', { withTimezone: true }),
    ewbValidUpto: timestamp('ewb_valid_upto', { withTimezone: true }),
    // Set only when GST_COMPLIANCE_GENERATION saga compensation runs after a failed EWB
    // generation — NIC has no "cancel EWB" API, so this flags the row for manual review
    // instead of inventing a synthetic undo (PG-006).
    ewbStatus: varchar('ewb_status', { length: 30 }).$type<'EWB_GENERATION_FAILED_MANUAL_REVIEW' | null>(),
    // NIC request payload for audit
    nicRequestPayload: jsonb('nic_request_payload'),
    nicResponsePayload: jsonb('nic_response_payload'),
    createdBy: integer('created_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    unique('einvoice_data_tenant_invoice').on(t.tenantId, t.invoiceId),
    index('idx_einvoice_data_irn').on(t.irn),
    index('idx_einvoice_data_status').on(t.tenantId, t.irnStatus),
    index('idx_einvoice_data_retry').on(t.irnStatus, t.retryCount, t.lastRetryAt),
  ]
);

export type GstRate = typeof gstRates.$inferSelect;
export type NewGstRate = typeof gstRates.$inferInsert;
export type HsnMaster = typeof hsnMaster.$inferSelect;
export type GstLedgerEntry = typeof gstLedger.$inferSelect;
export type NewGstLedgerEntry = typeof gstLedger.$inferInsert;
export type GstReturnFiling = typeof gstReturnFilings.$inferSelect;
export type Gst2aEntry = typeof gst2aEntries.$inferSelect;
export type EinvoiceData = typeof einvoiceData.$inferSelect;
