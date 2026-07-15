/* global Buffer */
import type { ErpDatabase } from '@erp/db';
import {
  tenants,
  roles,
  rolePermissions,
  users,
  featureFlags,
  branches,
  organizationSettings,
} from '@erp/db';
import { createLogger } from '@erp/logger';
import { eq, and } from 'drizzle-orm';
import argon2 from 'argon2';
import { randomUUID } from 'node:crypto';
import { WorkflowEngine, RuleEngine } from '@erp/sdk';
import type { StorageClient } from '@erp/sdk';
import { ROLE_DEFAULTS } from '../rbac/role-defaults.js';
import { BillingService } from './BillingService.js';

export interface ProvisionTenantInput {
  name: string;
  slug: string;
  contactEmail: string;
  contactPhone?: string;
  plan?: 'STARTER' | 'GROWTH' | 'ENTERPRISE';
  adminFirstName: string;
  adminLastName: string;
  adminPassword: string;
  orgSettings?: {
    timezone?: string;
    currency?: string;
    country?: string;
  };
}

export interface ProvisionResult {
  tenantId: number;
  adminUserId: number;
  adminEmail: string;
  provisioningSteps: Record<string, { done: boolean; completedAt: string }>;
}

const logger = createLogger({ serviceName: 'tenant-service' });

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- used only in the ProvisionStep type query below
const ALL_PROVISION_STEPS = [
  'CREATE_RECORD',
  'CREATE_SCHEMA',
  'RUN_MIGRATIONS',
  'SEED_ROLES_PERMISSIONS',
  'CREATE_ADMIN_USER',
  'SEED_ORG_SETTINGS',
  'CONFIGURE_S3',
  'CREATE_ES_INDICES',
  'SET_FEATURE_FLAGS',
  'ASSIGN_PLAN_ENTITLEMENTS',
  'SEND_WELCOME_EMAIL',
] as const;

type ProvisionStep = (typeof ALL_PROVISION_STEPS)[number];

export class TenantProvisioner {
  constructor(
    private readonly db: ErpDatabase,
    private readonly esUrl: string,
    private readonly storageClient: StorageClient
  ) {}

  async provision(input: ProvisionTenantInput): Promise<ProvisionResult> {
    const startedAt = Date.now();
    const completedSteps: Record<string, { done: boolean; completedAt: string }> = {};

    const markStep = (step: ProvisionStep): void => {
      completedSteps[step] = { done: true, completedAt: new Date().toISOString() };
    };

    // ── STEP 1: Create tenant record ────────────────────────────────────────
    logger.info({ slug: input.slug }, 'Provisioning tenant: creating record');
    const [tenant] = await this.db
      .insert(tenants)
      .values({
        name: input.name,
        slug: input.slug,
        contactEmail: input.contactEmail,
        contactPhone: input.contactPhone,
        plan: input.plan ?? 'STARTER',
        status: 'PROVISIONING',
        provisioningStatus: 'NOT_STARTED',
        provisioningSteps: {},
        settings: {
          timezone: input.orgSettings?.timezone ?? 'Asia/Kolkata',
          currency: input.orgSettings?.currency ?? 'INR',
          country: input.orgSettings?.country ?? 'IN',
        },
        s3Prefix: '',
        esIndexPrefix: '',
        createdBy: 0,
      })
      .returning();
    if (!tenant) throw new Error('Failed to create tenant record');

    const tenantId = tenant.id;
    markStep('CREATE_RECORD');

    await this.db
      .update(tenants)
      .set({ provisioningStatus: 'SCHEMA_CREATED', provisioningSteps: completedSteps })
      .where(eq(tenants.id, tenantId));

    // ── STEP 2 & 3: Schema creation + migrations ────────────────────────────
    // For multi-schema Postgres, we'd CREATE SCHEMA here.
    // In this shared-schema design, tenant isolation is via tenant_id + RLS.
    // Schema created = tenant_id row exists. Migrations = already applied globally.
    markStep('CREATE_SCHEMA');
    markStep('RUN_MIGRATIONS');

    await this.db
      .update(tenants)
      .set({ provisioningStatus: 'MIGRATIONS_RUN', provisioningSteps: completedSteps })
      .where(eq(tenants.id, tenantId));

    // ── STEP 4: Seed default roles and permissions ──────────────────────────
    logger.info({ tenantId }, 'Seeding roles and permissions');
    await this.seedRolesAndPermissions(tenantId);
    markStep('SEED_ROLES_PERMISSIONS');

    await this.db
      .update(tenants)
      .set({ provisioningStatus: 'ROLES_SEEDED', provisioningSteps: completedSteps })
      .where(eq(tenants.id, tenantId));

    // ── STEP 4b: Seed workflow definitions and rule templates ───────────────
    logger.info({ tenantId }, 'Seeding workflow definitions and rule templates');
    const workflow = new WorkflowEngine(this.db, tenantId, 0, randomUUID());
    await workflow.seedDefinitions();
    const rules = new RuleEngine(this.db);
    await rules.seedTemplates(tenantId, 0);

    // ── STEP 5: Create admin user ───────────────────────────────────────────
    logger.info({ tenantId }, 'Creating admin user');
    const adminUserId = await this.createAdminUser(tenantId, input);
    markStep('CREATE_ADMIN_USER');

    await this.db
      .update(tenants)
      .set({
        provisioningStatus: 'ADMIN_CREATED',
        adminUserId,
        provisioningSteps: completedSteps,
      })
      .where(eq(tenants.id, tenantId));

    // ── STEP 5b: Seed baseline organization settings ────────────────────────
    // GET /organization 404s until a row exists — confirmed live: every fresh tenant hit
    // this on every single page load (org name blank in the sidebar, branding sync silently
    // failing) until someone manually visited Settings > Organization to create the row via
    // PUT's upsert. Seed a baseline row from what the signup form already collected instead
    // of leaving a real gap between "tenant provisioned" and "first settings save".
    logger.info({ tenantId }, 'Seeding baseline organization settings');
    await this.db.insert(organizationSettings).values({
      tenantId,
      orgName: input.name,
      createdBy: adminUserId,
      ...(input.orgSettings?.timezone ? { timezone: input.orgSettings.timezone } : {}),
      ...(input.orgSettings?.currency ? { currency: input.orgSettings.currency } : {}),
      ...(input.orgSettings?.country ? { country: input.orgSettings.country } : {}),
    });
    markStep('SEED_ORG_SETTINGS');

    // ── STEP 6: Configure S3 prefix ─────────────────────────────────────────
    const s3Prefix = `tenants/${tenantId}`;
    logger.info({ tenantId, s3Prefix }, 'Configuring S3 prefix');
    try {
      const bucketOk = await this.storageClient.bucketExists();
      if (!bucketOk) {
        throw new Error('MinIO/S3 bucket does not exist or is unreachable');
      }
      // Placeholder object at the tenant's prefix root — S3/MinIO has no concept of an
      // empty "folder", so the prefix only becomes real/listable once an object exists under it.
      await this.storageClient.uploadFile(
        tenantId,
        'provisioning',
        '.tenant-init',
        Buffer.from(''),
        'application/octet-stream'
      );
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      logger.error({ tenantId, err }, 'S3 provisioning failed — aborting tenant provisioning');
      await this.db
        .update(tenants)
        .set({ provisioningStatus: 'FAILED', provisioningSteps: completedSteps })
        .where(eq(tenants.id, tenantId));
      throw new Error(`S3_PROVISIONING_FAILED: ${reason}`);
    }
    markStep('CONFIGURE_S3');

    await this.db
      .update(tenants)
      .set({
        provisioningStatus: 'S3_CONFIGURED',
        s3Prefix,
        provisioningSteps: completedSteps,
      })
      .where(eq(tenants.id, tenantId));

    // ── STEP 7: Create Elasticsearch indices ────────────────────────────────
    const esIndexPrefix = `erp_${tenantId}`;
    logger.info({ tenantId, esIndexPrefix }, 'Creating Elasticsearch indices');
    await this.createEsIndices(tenantId, esIndexPrefix);
    markStep('CREATE_ES_INDICES');

    await this.db
      .update(tenants)
      .set({
        provisioningStatus: 'ES_INDICES_CREATED',
        esIndexPrefix,
        provisioningSteps: completedSteps,
      })
      .where(eq(tenants.id, tenantId));

    // ── STEP 8: Set feature flags ────────────────────────────────────────────
    logger.info({ tenantId }, 'Configuring feature flags');
    await this.seedFeatureFlags(tenantId);
    markStep('SET_FEATURE_FLAGS');

    await this.db
      .update(tenants)
      .set({ provisioningStatus: 'FEATURE_FLAGS_SET', provisioningSteps: completedSteps })
      .where(eq(tenants.id, tenantId));

    // ── STEP 9: Assign default plan entitlements (PG-027) ──────────────────
    logger.info({ tenantId, plan: tenant.plan }, 'Assigning plan entitlements');
    await new BillingService(this.db).assignPlanEntitlements(tenantId, tenant.plan);
    markStep('ASSIGN_PLAN_ENTITLEMENTS');

    await this.db
      .update(tenants)
      .set({ provisioningStatus: 'PLAN_ENTITLEMENTS_ASSIGNED', provisioningSteps: completedSteps })
      .where(eq(tenants.id, tenantId));

    // ── STEP 10: Send welcome email ───────────────────────────────────────────
    logger.info({ tenantId, contactEmail: input.contactEmail }, 'Sending welcome email');
    await this.sendWelcomeEmail(tenantId, input.contactEmail, input.name, input.adminFirstName);
    markStep('SEND_WELCOME_EMAIL');

    // ── Finalize: mark ACTIVE ────────────────────────────────────────────────
    await this.db
      .update(tenants)
      .set({
        status: 'ACTIVE',
        provisioningStatus: 'COMPLETE',
        provisioningSteps: completedSteps,
      })
      .where(eq(tenants.id, tenantId));

    const durationMs = Date.now() - startedAt;
    logger.info({ tenantId, durationMs }, 'Tenant provisioning complete');

    return {
      tenantId,
      adminUserId,
      adminEmail: input.contactEmail,
      provisioningSteps: completedSteps,
    };
  }

  private async seedRolesAndPermissions(tenantId: number): Promise<void> {
    for (const [roleName, permissions] of Object.entries(ROLE_DEFAULTS)) {
      const [role] = await this.db
        .insert(roles)
        .values({
          tenantId,
          name: roleName,
          description: `Default ${roleName} role`,
          isSystem: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        .returning();

      if (!role) continue;

      if (permissions.length > 0) {
        await this.db.insert(rolePermissions).values(
          permissions.map((p) => ({
            roleId: role.id,
            permission: p,
            tenantId,
          }))
        );
      }
    }
  }

  private async createAdminUser(tenantId: number, input: ProvisionTenantInput): Promise<number> {
    const passwordHash = await argon2.hash(input.adminPassword, {
      type: argon2.argon2id,
      memoryCost: 65536,
      timeCost: 3,
      parallelism: 4,
    });

    // Seed a default head-office branch
    const [branch] = await this.db
      .insert(branches)
      .values({
        tenantId,
        name: 'Head Office',
        code: 'HO',
        isHeadOffice: true,
        isActive: true,
        createdBy: 0,
      })
      .returning();

    const [user] = await this.db
      .insert(users)
      .values({
        tenantId,
        email: input.contactEmail,
        passwordHash,
        firstName: input.adminFirstName,
        lastName: input.adminLastName,
        isActive: true,
        isEmailVerified: true,
        failedLoginAttempts: 0,
      })
      .returning();

    if (!user) throw new Error('Failed to create admin user');

    // Assign OWNER role
    const [ownerRole] = await this.db
      .select()
      .from(roles)
      .where(and(eq(roles.tenantId, tenantId), eq(roles.name, 'OWNER')));

    if (ownerRole) {
      await this.db.execute(
        `INSERT INTO user_roles (user_id, role_id, tenant_id) VALUES (${user.id}, ${ownerRole.id}, ${tenantId})`
      );
    }

    // Assign to head office branch
    if (branch) {
      await this.db.execute(
        `INSERT INTO user_branches (user_id, branch_id, tenant_id, is_primary) VALUES (${user.id}, ${branch.id}, ${tenantId}, true)`
      );
    }

    return user.id;
  }

  private async createEsIndices(tenantId: number, prefix: string): Promise<void> {
    const indices = ['customers', 'items', 'invoices', 'suppliers', 'employees'];
    for (const entity of indices) {
      const indexName = `${prefix}_${entity}`;
      try {
        const res = await fetch(`${this.esUrl}/${indexName}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            settings: {
              number_of_shards: 1,
              number_of_replicas: 0,
              analysis: {
                analyzer: {
                  erp_name_analyzer: {
                    type: 'custom',
                    tokenizer: 'standard',
                    filter: ['lowercase', 'asciifolding', 'erp_synonyms'],
                  },
                },
                filter: {
                  erp_synonyms: {
                    type: 'synonym',
                    synonyms: [
                      'pvt => private',
                      'ltd => limited',
                      'co => company',
                      'dept => department',
                      'mfg => manufacturing',
                    ],
                  },
                },
              },
            },
            mappings: {
              properties: {
                tenantId: { type: 'integer' },
                name: { type: 'text', analyzer: 'erp_name_analyzer' },
                phone: { type: 'keyword' },
                email: { type: 'keyword' },
                createdAt: { type: 'date' },
              },
            },
          }),
        });
        if (!res.ok && res.status !== 400) {
          logger.warn(
            { tenantId, indexName, status: res.status },
            'ES index creation returned non-OK'
          );
        }
      } catch (err) {
        logger.warn(
          { tenantId, indexName, err },
          'ES index creation failed (non-fatal during provisioning)'
        );
      }
    }
  }

  private async seedFeatureFlags(tenantId: number): Promise<void> {
    const flags = [
      { key: 'pos.enabled', enabled: false },
      { key: 'multi-branch.enabled', enabled: false },
      { key: 'inventory.variants.enabled', enabled: true },
      { key: 'sales.quotations.enabled', enabled: true },
      { key: 'sales.credit-limit.enabled', enabled: true },
      { key: 'accounting.auto-journal.enabled', enabled: true },
      { key: 'gst.e-invoice.enabled', enabled: false },
      { key: 'gst.eway-bill.enabled', enabled: false },
      { key: 'hr.payroll.enabled', enabled: false },
      { key: 'hr.attendance.enabled', enabled: false },
      { key: 'notification.whatsapp.enabled', enabled: false },
      { key: 'notification.email.enabled', enabled: true },
      { key: 'notification.sms.enabled', enabled: true },
      { key: 'import.bulk.enabled', enabled: true },
      { key: 'audit.detailed.enabled', enabled: true },
    ];

    for (const flag of flags) {
      try {
        await this.db
          .insert(featureFlags)
          .values({ tenantId, flagKey: flag.key, enabled: flag.enabled })
          .onConflictDoNothing();
      } catch {
        // ignore duplicates from global flags
      }
    }
  }

  // PG-026 bugfix: this previously called a nonexistent `/api/v2/notifications/send` path
  // (notification-service registers its routes with no prefix at all) with a body shape
  // (`templateKey`/`recipient`/`variables`) that never matched any real endpoint's schema —
  // welcome emails have never been delivered. Fixed to call the real `/notifications/send-internal`
  // route with its actual InternalSendSchema shape, guarded by x-internal-key like every other
  // service-to-service notification call in this codebase. Also seeds the WELCOME_EMAIL template
  // this tenant needs first — no such template was ever seeded anywhere, so even a
  // correctly-shaped call would have been silently skipped by NotificationEngine's
  // no-template-row-found path (see [[pg017_password_reset_email_delivery]]'s same gap).
  private async sendWelcomeEmail(
    tenantId: number,
    email: string,
    tenantName: string,
    firstName: string
  ): Promise<void> {
    const notificationUrl = process.env['NOTIFICATION_SERVICE_URL'];
    if (!notificationUrl) {
      logger.warn({ email }, 'NOTIFICATION_SERVICE_URL not configured — skipping welcome email');
      return;
    }
    const internalKey = process.env['INTERNAL_API_KEY'] ?? '';
    try {
      await fetch(`${notificationUrl}/notifications/templates/seed-tenant`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-internal-key': internalKey },
        body: JSON.stringify({ tenantId }),
      });

      const res = await fetch(`${notificationUrl}/notifications/send-internal`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-internal-key': internalKey },
        body: JSON.stringify({
          tenantId,
          eventType: 'WELCOME_EMAIL',
          recipientEmail: email,
          channels: ['EMAIL'],
          templateData: { firstName, tenantName },
        }),
      });
      if (!res.ok) {
        logger.warn({ email, status: res.status }, 'Welcome email delivery failed (non-fatal)');
      }
    } catch (err) {
      logger.warn({ email, err }, 'Welcome email delivery failed (non-fatal)');
    }
  }

  async suspend(tenantId: number, reason: string, suspendedBy: number): Promise<void> {
    await this.db
      .update(tenants)
      .set({
        status: 'SUSPENDED',
        suspendedAt: new Date(),
        suspendedBy,
        suspendedReason: reason,
        updatedAt: new Date(),
        version: tenants.version,
      })
      .where(and(eq(tenants.id, tenantId), eq(tenants.status, 'ACTIVE')));
  }

  async activate(tenantId: number): Promise<void> {
    await this.db
      .update(tenants)
      .set({
        status: 'ACTIVE',
        suspendedAt: undefined,
        suspendedBy: undefined,
        suspendedReason: undefined,
        updatedAt: new Date(),
      })
      .where(and(eq(tenants.id, tenantId), eq(tenants.status, 'SUSPENDED')));
  }

  async close(tenantId: number, reason: string, closedBy: number): Promise<void> {
    await this.db
      .update(tenants)
      .set({
        status: 'CLOSED',
        closedAt: new Date(),
        closedBy,
        closedReason: reason,
        updatedAt: new Date(),
      })
      .where(eq(tenants.id, tenantId));
  }
}
