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
} from 'drizzle-orm/pg-core';

// ─── Tenants (system-level — no tenant_id, this IS the root) ──────────────
export const tenants = pgTable(
  'tenants',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    name: varchar('name', { length: 200 }).notNull(),
    slug: varchar('slug', { length: 100 }).notNull(),
    status: varchar('status', { length: 20 })
      .notNull()
      .default('PROVISIONING')
      .$type<'PROVISIONING' | 'ACTIVE' | 'SUSPENDED' | 'CLOSED'>(),
    plan: varchar('plan', { length: 50 }).notNull().default('STARTER').$type<'STARTER' | 'GROWTH' | 'ENTERPRISE'>(),
    contactEmail: varchar('contact_email', { length: 255 }).notNull(),
    contactPhone: varchar('contact_phone', { length: 20 }),
    gstin: varchar('gstin', { length: 20 }),
    pan: varchar('pan', { length: 20 }),
    registeredAddress: jsonb('registered_address').$type<{
      line1: string;
      line2?: string;
      city: string;
      state: string;
      pincode: string;
      country: string;
    }>(),
    adminUserId: bigint('admin_user_id', { mode: 'number' }),
    s3Prefix: varchar('s3_prefix', { length: 200 }),
    esIndexPrefix: varchar('es_index_prefix', { length: 100 }),
    provisioningStatus: varchar('provisioning_status', { length: 30 })
      .$type<
        | 'NOT_STARTED'
        | 'SCHEMA_CREATED'
        | 'MIGRATIONS_RUN'
        | 'ROLES_SEEDED'
        | 'ADMIN_CREATED'
        | 'S3_CONFIGURED'
        | 'ES_INDICES_CREATED'
        | 'FEATURE_FLAGS_SET'
        | 'WELCOME_EMAIL_SENT'
        | 'COMPLETE'
      >()
      .default('NOT_STARTED'),
    provisioningSteps: jsonb('provisioning_steps')
      .$type<Record<string, { done: boolean; completedAt?: string; error?: string }>>()
      .default({}),
    settings: jsonb('settings')
      .$type<{
        timezone?: string;
        fiscalYearStart?: string;
        currency?: string;
        country?: string;
        language?: string;
        dateFormat?: string;
        maxBranches?: number;
        maxUsers?: number;
      }>()
      .default({}),
    suspendedAt: timestamp('suspended_at', { withTimezone: true }),
    suspendedBy: integer('suspended_by'),
    suspendedReason: text('suspended_reason'),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    closedBy: integer('closed_by'),
    closedReason: text('closed_reason'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    createdBy: integer('created_by').notNull().default(0),
    version: integer('version').notNull().default(0),
  },
  (t) => [
    unique('tenants_slug_unique').on(t.slug),
    unique('tenants_contact_email_unique').on(t.contactEmail),
    index('idx_tenants_status').on(t.status),
    index('idx_tenants_slug').on(t.slug),
  ]
);

// ─── Organization Settings (tenant-scoped) ─────────────────────────────────
export const organizationSettings = pgTable(
  'organization_settings',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    tenantId: integer('tenant_id').notNull(),
    orgName: varchar('org_name', { length: 200 }).notNull(),
    legalName: varchar('legal_name', { length: 300 }),
    gstin: varchar('gstin', { length: 20 }),
    pan: varchar('pan', { length: 20 }),
    tan: varchar('tan', { length: 20 }),
    cin: varchar('cin', { length: 21 }),
    logoUrl: text('logo_url'),
    address: jsonb('address').$type<{
      line1: string;
      line2?: string;
      city: string;
      state: string;
      pincode: string;
      country: string;
    }>(),
    timezone: varchar('timezone', { length: 100 }).notNull().default('Asia/Kolkata'),
    currency: varchar('currency', { length: 10 }).notNull().default('INR'),
    fiscalYearStart: varchar('fiscal_year_start', { length: 5 }).notNull().default('04-01'),
    dateFormat: varchar('date_format', { length: 20 }).notNull().default('DD/MM/YYYY'),
    country: varchar('country', { length: 2 }).notNull().default('IN'),
    language: varchar('language', { length: 10 }).notNull().default('en'),
    bankDetails: jsonb('bank_details').$type<{
      bankName?: string;
      accountNumber?: string;
      ifscCode?: string;
      branch?: string;
    }>(),
    invoiceFooter: text('invoice_footer'),
    termsAndConditions: text('terms_and_conditions'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    createdBy: integer('created_by').notNull(),
    version: integer('version').notNull().default(0),
  },
  (t) => [
    unique('org_settings_tenant_unique').on(t.tenantId),
    index('idx_org_settings_tenant').on(t.tenantId),
  ]
);

// ─── Branches ─────────────────────────────────────────────────────────────
export const branches = pgTable(
  'branches',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    tenantId: integer('tenant_id').notNull(),
    name: varchar('name', { length: 200 }).notNull(),
    code: varchar('code', { length: 20 }).notNull(),
    address: jsonb('address').$type<{
      line1: string;
      line2?: string;
      city: string;
      state: string;
      pincode: string;
    }>(),
    phone: varchar('phone', { length: 20 }),
    email: varchar('email', { length: 255 }),
    gstin: varchar('gstin', { length: 20 }),
    isHeadOffice: boolean('is_head_office').notNull().default(false),
    isActive: boolean('is_active').notNull().default(true),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    deletedBy: integer('deleted_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    createdBy: integer('created_by').notNull(),
    version: integer('version').notNull().default(0),
  },
  (t) => [
    unique('branches_tenant_code').on(t.tenantId, t.code),
    index('idx_branches_tenant').on(t.tenantId),
    index('idx_branches_active').on(t.tenantId, t.isActive),
  ]
);

// ─── User ↔ Branch assignments ────────────────────────────────────────────
export const userBranches = pgTable(
  'user_branches',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    userId: integer('user_id').notNull(),
    branchId: integer('branch_id').notNull(),
    tenantId: integer('tenant_id').notNull(),
    isPrimary: boolean('is_primary').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    unique('user_branches_unique').on(t.userId, t.branchId),
    index('idx_user_branches_user').on(t.userId, t.tenantId),
    index('idx_user_branches_branch').on(t.branchId),
  ]
);

export type Tenant = typeof tenants.$inferSelect;
export type NewTenant = typeof tenants.$inferInsert;
export type OrganizationSettings = typeof organizationSettings.$inferSelect;
export type Branch = typeof branches.$inferSelect;
export type NewBranch = typeof branches.$inferInsert;
