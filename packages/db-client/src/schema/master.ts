import {
  bigint,
  bigserial,
  boolean,
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

// ─── Warehouses ────────────────────────────────────────────────────────────
export const warehouses = pgTable(
  'warehouses',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    tenantId: integer('tenant_id').notNull(),
    branchId: integer('branch_id').notNull(),
    name: varchar('name', { length: 200 }).notNull(),
    code: varchar('code', { length: 20 }).notNull(),
    address: jsonb('address').$type<{
      line1: string;
      line2?: string;
      city: string;
      state: string;
      pincode: string;
    }>(),
    isDefault: boolean('is_default').notNull().default(false),
    isActive: boolean('is_active').notNull().default(true),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    deletedBy: integer('deleted_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    createdBy: integer('created_by').notNull(),
    version: integer('version').notNull().default(0),
  },
  (t) => [
    unique('warehouses_tenant_code').on(t.tenantId, t.code),
    index('idx_warehouses_tenant').on(t.tenantId),
    index('idx_warehouses_branch').on(t.branchId, t.tenantId),
    index('idx_warehouses_active').on(t.tenantId, t.isActive),
  ]
);

// ─── Customers ─────────────────────────────────────────────────────────────
export const customers = pgTable(
  'customers',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    tenantId: integer('tenant_id').notNull(),
    branchId: integer('branch_id').notNull(),
    customerCode: varchar('customer_code', { length: 50 }),
    displayName: varchar('display_name', { length: 200 }).notNull(),
    firstName: varchar('first_name', { length: 100 }),
    lastName: varchar('last_name', { length: 100 }),
    companyName: varchar('company_name', { length: 300 }),
    customerType: varchar('customer_type', { length: 20 })
      .notNull()
      .default('RETAIL')
      .$type<'RETAIL' | 'WHOLESALE' | 'B2B' | 'GOVERNMENT' | 'EXPORT'>(),
    // Encrypted fields — store ciphertext; companion _hash for exact-match search
    gstin: text('gstin'),
    gstinHash: varchar('gstin_hash', { length: 64 }),
    pan: text('pan'),
    panHash: varchar('pan_hash', { length: 64 }),
    phone: varchar('phone', { length: 20 }).notNull(),
    altPhone: varchar('alt_phone', { length: 20 }),
    email: varchar('email', { length: 255 }),
    dateOfBirth: varchar('date_of_birth', { length: 10 }),
    anniversary: varchar('anniversary', { length: 10 }),
    gender: varchar('gender', { length: 10 }).$type<'MALE' | 'FEMALE' | 'OTHER'>(),
    // Address
    billingAddress: jsonb('billing_address').$type<{
      line1: string;
      line2?: string;
      city: string;
      state: string;
      stateCode: string;
      pincode: string;
      country: string;
    }>(),
    shippingAddress: jsonb('shipping_address').$type<{
      line1: string;
      line2?: string;
      city: string;
      state: string;
      stateCode: string;
      pincode: string;
      country: string;
    }>(),
    // Financial
    creditLimit: decimal('credit_limit', { precision: 15, scale: 2 }).notNull().default('0'),
    creditDays: integer('credit_days').notNull().default(0),
    creditLimitEnabled: boolean('credit_limit_enabled').notNull().default(false),
    openingBalance: decimal('opening_balance', { precision: 15, scale: 2 }).notNull().default('0'),
    openingBalanceType: varchar('opening_balance_type', { length: 10 })
      .default('DEBIT')
      .$type<'DEBIT' | 'CREDIT'>(),
    priceListId: bigint('price_list_id', { mode: 'number' }),
    // Loyalty
    loyaltyPoints: integer('loyalty_points').notNull().default(0),
    loyaltyCardNumber: varchar('loyalty_card_number', { length: 50 }),
    // CRM — health scoring (Phase 9 M9.2)
    healthScore: integer('health_score'),
    healthSegment: varchar('health_segment', { length: 20 }).$type<'CHAMPION' | 'LOYAL' | 'AT_RISK' | 'LOST'>(),
    scoredAt: timestamp('scored_at', { withTimezone: true }),
    // Status
    status: varchar('status', { length: 20 })
      .notNull()
      .default('ACTIVE')
      .$type<'ACTIVE' | 'INACTIVE' | 'BLOCKED'>(),
    blockedReason: text('blocked_reason'),
    blockedAt: timestamp('blocked_at', { withTimezone: true }),
    blockedBy: integer('blocked_by'),
    // Meta
    notes: text('notes'),
    tags: jsonb('tags').$type<string[]>().default([]),
    customFields: jsonb('custom_fields').$type<Record<string, unknown>>().default({}),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    deletedBy: integer('deleted_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    createdBy: integer('created_by').notNull(),
    version: integer('version').notNull().default(0),
  },
  (t) => [
    unique('customers_tenant_code').on(t.tenantId, t.customerCode),
    index('idx_customers_tenant').on(t.tenantId),
    index('idx_customers_branch').on(t.branchId, t.tenantId),
    index('idx_customers_phone').on(t.phone, t.tenantId),
    index('idx_customers_email').on(t.email, t.tenantId),
    index('idx_customers_gstin_hash').on(t.gstinHash),
    index('idx_customers_status').on(t.status, t.tenantId),
    // Phase 13: GIN trigram indexes for pg_trgm fuzzy search
    index('idx_customers_displayname_trgm').on(t.displayName),
    index('idx_customers_companyname_trgm').on(t.companyName),
  ]
);

// ─── Customers History (temporal audit trail) ──────────────────────────────
export const customersHistory = pgTable(
  'customers_history',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    customerId: integer('customer_id').notNull(),
    tenantId: integer('tenant_id').notNull(),
    changedBy: integer('changed_by').notNull(),
    changedAt: timestamp('changed_at', { withTimezone: true }).defaultNow().notNull(),
    previousData: jsonb('previous_data').notNull(),
    changeType: varchar('change_type', { length: 20 }).notNull().$type<'UPDATE' | 'BLOCK' | 'UNBLOCK'>(),
  },
  (t) => [
    index('idx_customers_history_customer').on(t.customerId),
    index('idx_customers_history_tenant').on(t.tenantId, t.changedAt),
  ]
);

// ─── Suppliers ─────────────────────────────────────────────────────────────
export const suppliers = pgTable(
  'suppliers',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    tenantId: integer('tenant_id').notNull(),
    branchId: integer('branch_id').notNull(),
    supplierCode: varchar('supplier_code', { length: 50 }),
    displayName: varchar('display_name', { length: 200 }).notNull(),
    companyName: varchar('company_name', { length: 300 }),
    contactPerson: varchar('contact_person', { length: 200 }),
    supplierType: varchar('supplier_type', { length: 20 })
      .notNull()
      .default('DOMESTIC')
      .$type<'DOMESTIC' | 'IMPORT' | 'MANUFACTURER' | 'AGENT'>(),
    gstin: varchar('gstin', { length: 20 }),
    pan: varchar('pan', { length: 20 }),
    phone: varchar('phone', { length: 20 }).notNull(),
    altPhone: varchar('alt_phone', { length: 20 }),
    email: varchar('email', { length: 255 }),
    // Address
    billingAddress: jsonb('billing_address').$type<{
      line1: string;
      line2?: string;
      city: string;
      state: string;
      stateCode: string;
      pincode: string;
      country: string;
    }>(),
    // Bank details — encrypted AES-256-GCM
    bankAccountNo: text('bank_account_no'),
    bankAccountNoHash: varchar('bank_account_no_hash', { length: 64 }),
    bankName: varchar('bank_name', { length: 200 }),
    bankIfsc: varchar('bank_ifsc', { length: 20 }),
    bankBranch: varchar('bank_branch', { length: 200 }),
    // Financial
    creditDays: integer('credit_days').notNull().default(0),
    openingBalance: decimal('opening_balance', { precision: 15, scale: 2 }).notNull().default('0'),
    openingBalanceType: varchar('opening_balance_type', { length: 10 })
      .default('CREDIT')
      .$type<'DEBIT' | 'CREDIT'>(),
    // Status
    status: varchar('status', { length: 20 })
      .notNull()
      .default('ACTIVE')
      .$type<'ACTIVE' | 'INACTIVE' | 'BLACKLISTED'>(),
    notes: text('notes'),
    tags: jsonb('tags').$type<string[]>().default([]),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    deletedBy: integer('deleted_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    createdBy: integer('created_by').notNull(),
    version: integer('version').notNull().default(0),
  },
  (t) => [
    unique('suppliers_tenant_code').on(t.tenantId, t.supplierCode),
    index('idx_suppliers_tenant').on(t.tenantId),
    index('idx_suppliers_branch').on(t.branchId, t.tenantId),
    index('idx_suppliers_phone').on(t.phone, t.tenantId),
    index('idx_suppliers_gstin').on(t.gstin, t.tenantId),
    index('idx_suppliers_bank_hash').on(t.bankAccountNoHash),
    index('idx_suppliers_status').on(t.status, t.tenantId),
  ]
);

// ─── Suppliers History ─────────────────────────────────────────────────────
export const suppliersHistory = pgTable(
  'suppliers_history',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    supplierId: integer('supplier_id').notNull(),
    tenantId: integer('tenant_id').notNull(),
    changedBy: integer('changed_by').notNull(),
    changedAt: timestamp('changed_at', { withTimezone: true }).defaultNow().notNull(),
    previousData: jsonb('previous_data').notNull(),
    changeType: varchar('change_type', { length: 20 }).notNull().$type<'UPDATE' | 'BLOCK'>(),
  },
  (t) => [
    index('idx_suppliers_history_supplier').on(t.supplierId),
    index('idx_suppliers_history_tenant').on(t.tenantId, t.changedAt),
  ]
);

export type Warehouse = typeof warehouses.$inferSelect;
export type NewWarehouse = typeof warehouses.$inferInsert;
export type Customer = typeof customers.$inferSelect;
export type NewCustomer = typeof customers.$inferInsert;
export type CustomerHistory = typeof customersHistory.$inferSelect;
export type Supplier = typeof suppliers.$inferSelect;
export type NewSupplier = typeof suppliers.$inferInsert;
export type SupplierHistory = typeof suppliersHistory.$inferSelect;
