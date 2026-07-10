import {
  bigint,
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
        | 'PLAN_ENTITLEMENTS_ASSIGNED'
        | 'WELCOME_EMAIL_SENT'
        | 'COMPLETE'
        | 'FAILED'
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
    // PG-027: billing-cycle scheduling. next_billing_date is nullable — a tenant with no
    // billing cycle configured yet must not trip the scheduler job (it skips NULL rows).
    nextBillingDate: date('next_billing_date'),
    dunningStartedAt: timestamp('dunning_started_at', { withTimezone: true }),
    paymentGatewayCustomerRef: varchar('payment_gateway_customer_ref', { length: 200 }),
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
      upiVpa?: string;
    }>(),
    invoiceFooter: text('invoice_footer'),
    termsAndConditions: text('terms_and_conditions'),
    // Tenant branding — ERP-PLANNING/05_ERP_THEME_SYSTEM.md §4. Deliberately small and
    // enumerated: color/font/radius only, never spacing/status colors (§4.2).
    themeConfig: jsonb('theme_config').$type<{
      brandPrimary?: string;
      brandSecondary?: string;
      brandAccent?: string;
      fontSans?: string;
      radiusScale?: 'sharp' | 'default' | 'rounded';
    }>(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    createdBy: integer('created_by').notNull(),
    updatedBy: integer('updated_by'),
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
    updatedBy: integer('updated_by'),
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

// ─── SSO Configuration (tenant-scoped, PG-020) ─────────────────────────────
// One row per tenant (v1: a tenant configures a single IdP at a time). `provider` is the
// IdP identity for display purposes — every option here speaks OIDC underneath (see
// ERP-PLANNING/production-gap-prompts/002-Security/15-sso-oauth-saml.md), SAML is a
// separate, later package. `clientSecretEncrypted` follows the hr-service field-level-
// encryption convention (AES-256-GCM via @erp/utils encryptField/decryptField), never
// stored in plaintext.
export const ssoConfigs = pgTable(
  'sso_configs',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    tenantId: integer('tenant_id').notNull(),
    provider: varchar('provider', { length: 30 })
      .notNull()
      .default('GENERIC_OIDC')
      .$type<'OKTA' | 'AZURE_AD' | 'GOOGLE_WORKSPACE' | 'GENERIC_OIDC'>(),
    issuerUrl: varchar('issuer_url', { length: 500 }).notNull(),
    clientId: varchar('client_id', { length: 255 }).notNull(),
    clientSecretEncrypted: varchar('client_secret_encrypted', { length: 500 }).notNull(),
    enabled: boolean('enabled').notNull().default(false),
    bypassLocalMfa: boolean('bypass_local_mfa').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    createdBy: integer('created_by').notNull(),
    updatedBy: integer('updated_by'),
    version: integer('version').notNull().default(0),
  },
  (t) => [
    unique('sso_configs_tenant_unique').on(t.tenantId),
    index('idx_sso_configs_tenant').on(t.tenantId),
  ]
);

// ─── Plan Entitlements (PG-027, global — no tenant_id) ─────────────────────
// Tier template copied into a tenant's settings/feature_flags at provisioning or
// plan-change time (see BillingService) — analogous to ROLE_DEFAULTS being a template
// copied into per-tenant roles/role_permissions. Not itself a tenant's actual limits.
export const planEntitlements = pgTable(
  'plan_entitlements',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    plan: varchar('plan', { length: 50 }).notNull().$type<'STARTER' | 'GROWTH' | 'ENTERPRISE'>(),
    // Nullable = unlimited (e.g. ENTERPRISE).
    maxUsers: integer('max_users'),
    maxBranches: integer('max_branches'),
    featureFlags: jsonb('feature_flags').notNull().default([]).$type<string[]>(),
    monthlyPricePaise: integer('monthly_price_paise'),
    billingPeriod: varchar('billing_period', { length: 20 }).notNull().default('MONTHLY').$type<'MONTHLY' | 'ANNUAL'>(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [unique('plan_entitlements_plan_unique').on(t.plan)]
);

// ─── Tenant Invoices (PG-027, tenant-scoped) ────────────────────────────────
// A tenant-billing invoice (what a tenant owes the platform), distinct from
// sales-service's own customer-facing `invoices` table — do not confuse the two.
export const tenantInvoices = pgTable(
  'tenant_invoices',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    tenantId: integer('tenant_id').notNull(),
    // Snapshot of plan at invoice time — plans can change later without altering past invoices.
    plan: varchar('plan', { length: 50 }).notNull(),
    amountPaise: integer('amount_paise').notNull(),
    currency: varchar('currency', { length: 3 }).notNull().default('INR'),
    status: varchar('status', { length: 20 })
      .notNull()
      .default('PENDING')
      .$type<'PENDING' | 'PAID' | 'FAILED' | 'VOID'>(),
    billingPeriodStart: date('billing_period_start').notNull(),
    billingPeriodEnd: date('billing_period_end').notNull(),
    paymentGatewayRef: varchar('payment_gateway_ref', { length: 200 }),
    paidAt: timestamp('paid_at', { withTimezone: true }),
    failureReason: text('failure_reason'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index('idx_tenant_invoices_tenant').on(t.tenantId, t.status),
    index('idx_tenant_invoices_billing_period').on(t.tenantId, t.billingPeriodStart),
  ]
);

export type Tenant = typeof tenants.$inferSelect;
export type NewTenant = typeof tenants.$inferInsert;
export type OrganizationSettings = typeof organizationSettings.$inferSelect;
export type Branch = typeof branches.$inferSelect;
export type NewBranch = typeof branches.$inferInsert;
export type SsoConfig = typeof ssoConfigs.$inferSelect;
export type NewSsoConfig = typeof ssoConfigs.$inferInsert;
export type PlanEntitlement = typeof planEntitlements.$inferSelect;
export type NewPlanEntitlement = typeof planEntitlements.$inferInsert;
export type TenantInvoice = typeof tenantInvoices.$inferSelect;
export type NewTenantInvoice = typeof tenantInvoices.$inferInsert;
