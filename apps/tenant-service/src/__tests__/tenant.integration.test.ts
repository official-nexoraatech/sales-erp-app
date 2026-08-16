import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { createDatabaseClient } from '@erp/db';
import { tenants, roles, users, branches, organizationSettings, featureFlags } from '@erp/db';
import { eq, and } from 'drizzle-orm';
import type { StorageClient } from '@erp/sdk';
import { TenantProvisioner } from '../domain/TenantProvisioner.js';

const DB_URL = process.env['DATABASE_URL'];
const MINIO_ENDPOINT = process.env['MINIO_ENDPOINT'];

function makeFakeStorageClient(): StorageClient {
  return {
    bucketExists: vi.fn().mockResolvedValue(true),
    uploadFile: vi.fn().mockResolvedValue('tenant/1/provisioning/1-.tenant-init'),
    getSignedUrl: vi.fn().mockResolvedValue('https://minio.local/signed-url'),
    deleteFile: vi.fn().mockResolvedValue(undefined),
  } as unknown as StorageClient;
}

describe.skipIf(!DB_URL)('Tenant provisioning integration', () => {
  let db: ReturnType<typeof createDatabaseClient>;
  let provisionedTenantId: number;

  beforeAll(async () => {
    db = createDatabaseClient({ url: DB_URL! });
  });

  afterAll(async () => {
    if (!provisionedTenantId) return;
    // Clean up in reverse-FK order
    await db.execute(`DELETE FROM user_roles WHERE tenant_id = ${provisionedTenantId}`);
    await db.execute(`DELETE FROM user_branches WHERE tenant_id = ${provisionedTenantId}`);
    await db.execute(`DELETE FROM role_permissions WHERE tenant_id = ${provisionedTenantId}`);
    await db
      .delete(organizationSettings)
      .where(eq(organizationSettings.tenantId, provisionedTenantId));
    await db.delete(users).where(eq(users.tenantId, provisionedTenantId));
    await db.delete(roles).where(eq(roles.tenantId, provisionedTenantId));
    await db.delete(branches).where(eq(branches.tenantId, provisionedTenantId));
    await db.delete(tenants).where(eq(tenants.id, provisionedTenantId));
  });

  it('provisions a tenant with admin user and seeded roles', async () => {
    const slug = `test-tenant-${Date.now()}`;
    const provisioner = new TenantProvisioner(db, 'http://localhost:9200', makeFakeStorageClient());

    const result = await provisioner.provision({
      name: 'Test Cloth Co.',
      slug,
      contactEmail: `admin-${Date.now()}@test.example`,
      adminFirstName: 'Test',
      adminLastName: 'Admin',
      adminPassword: 'Test@12345',
      plan: 'STARTER',
    });

    provisionedTenantId = result.tenantId;

    expect(result.tenantId).toBeGreaterThan(0);
    expect(result.adminUserId).toBeGreaterThan(0);

    // Tenant record should be ACTIVE
    const [tenant] = await db.select().from(tenants).where(eq(tenants.id, result.tenantId));
    expect(tenant!.status).toBe('ACTIVE');
    expect(tenant!.provisioningStatus).toBe('COMPLETE');
    // Grocery-expansion audit 2026-08-16: vertical must default to CLOTH_RETAIL for backward
    // compatibility when the caller doesn't specify one.
    expect(tenant!.vertical).toBe('CLOTH_RETAIL');

    // Roles must be seeded
    const seededRoles = await db.select().from(roles).where(eq(roles.tenantId, result.tenantId));
    expect(seededRoles.length).toBeGreaterThan(0);
    const roleNames = seededRoles.map((r) => r.name);
    expect(roleNames).toContain('OWNER');

    // Admin user must exist
    const [adminUser] = await db.select().from(users).where(eq(users.id, result.adminUserId));
    expect(adminUser).toBeDefined();
    expect(adminUser!.tenantId).toBe(result.tenantId);
    expect(adminUser!.isActive).toBe(true);

    // QA session (2026-07-12): GET /organization 404s until this row exists — confirmed live
    // against a freshly provisioned tenant that provisioning never created it. Regression
    // guard: a baseline row must exist immediately after provisioning, seeded from the
    // signup form's own `name`, not requiring a manual Settings visit first.
    const [org] = await db
      .select()
      .from(organizationSettings)
      .where(eq(organizationSettings.tenantId, result.tenantId));
    expect(org).toBeDefined();
    expect(org!.orgName).toBe('Test Cloth Co.');
    expect(org!.createdBy).toBe(result.adminUserId);
  });

  it('provisions a GROCERY tenant with the vertical template applied (tailoring flag off)', async () => {
    const slug = `test-grocery-${Date.now()}`;
    const provisioner = new TenantProvisioner(db, 'http://localhost:9200', makeFakeStorageClient());

    const result = await provisioner.provision({
      name: 'Test Grocery Co.',
      slug,
      contactEmail: `admin-grocery-${Date.now()}@test.example`,
      adminFirstName: 'Test',
      adminLastName: 'Admin',
      adminPassword: 'Test@12345',
      plan: 'STARTER',
      vertical: 'GROCERY',
    });

    try {
      const [tenant] = await db.select().from(tenants).where(eq(tenants.id, result.tenantId));
      expect(tenant!.vertical).toBe('GROCERY');

      // hr.tailoring.enabled is globally defaulted to true (see
      // apps/hr-service/src/api/internal.routes.ts) — a GROCERY tenant must get its own
      // tenant-scoped override row disabling it, per VERTICAL_DEFAULTS.GROCERY.
      const [tailoringFlag] = await db
        .select()
        .from(featureFlags)
        .where(
          and(
            eq(featureFlags.tenantId, result.tenantId),
            eq(featureFlags.flagKey, 'hr.tailoring.enabled')
          )
        );
      expect(tailoringFlag).toBeDefined();
      expect(tailoringFlag!.enabled).toBe(false);

      // Roles are unaffected — VERTICAL_DEFAULTS.GROCERY.excludeRoles is empty today.
      const seededRoles = await db.select().from(roles).where(eq(roles.tenantId, result.tenantId));
      expect(seededRoles.map((r) => r.name)).toContain('CASHIER');
    } finally {
      // Same reverse-FK cleanup order as afterAll, scoped to this test's own tenant.
      await db.execute(`DELETE FROM user_roles WHERE tenant_id = ${result.tenantId}`);
      await db.execute(`DELETE FROM user_branches WHERE tenant_id = ${result.tenantId}`);
      await db.execute(`DELETE FROM role_permissions WHERE tenant_id = ${result.tenantId}`);
      await db.execute(`DELETE FROM feature_flags WHERE tenant_id = ${result.tenantId}`);
      await db
        .delete(organizationSettings)
        .where(eq(organizationSettings.tenantId, result.tenantId));
      await db.delete(users).where(eq(users.tenantId, result.tenantId));
      await db.delete(roles).where(eq(roles.tenantId, result.tenantId));
      await db.delete(branches).where(eq(branches.tenantId, result.tenantId));
      await db.delete(tenants).where(eq(tenants.id, result.tenantId));
    }
  });

  it('can suspend and activate a tenant, clearing suspension metadata and bumping version each transition', async () => {
    if (!provisionedTenantId) return;

    const provisioner = new TenantProvisioner(db, 'http://localhost:9200', makeFakeStorageClient());

    const [before] = await db.select().from(tenants).where(eq(tenants.id, provisionedTenantId));
    const versionBeforeSuspend = before!.version;

    await provisioner.suspend(provisionedTenantId, 'Integration test suspension', 1);
    const [suspended] = await db.select().from(tenants).where(eq(tenants.id, provisionedTenantId));
    expect(suspended!.status).toBe('SUSPENDED');
    expect(suspended!.suspendedBy).toBe(1);
    expect(suspended!.suspendedReason).toBe('Integration test suspension');
    expect(suspended!.version).toBe(versionBeforeSuspend + 1);

    await provisioner.activate(provisionedTenantId);
    const [active] = await db.select().from(tenants).where(eq(tenants.id, provisionedTenantId));
    expect(active!.status).toBe('ACTIVE');
    // Regression guard: activate() used to set these to `undefined`, which Drizzle silently
    // drops from the UPDATE — the columns kept their stale suspended values forever.
    expect(active!.suspendedAt).toBeNull();
    expect(active!.suspendedBy).toBeNull();
    expect(active!.suspendedReason).toBeNull();
    expect(active!.version).toBe(versionBeforeSuspend + 2);
  });

  it('close() only transitions from a non-CLOSED status and cannot be applied twice', async () => {
    const slug = `test-tenant-close-${Date.now()}`;
    const provisioner = new TenantProvisioner(db, 'http://localhost:9200', makeFakeStorageClient());
    const result = await provisioner.provision({
      name: 'Close Test Co.',
      slug,
      contactEmail: `close-${Date.now()}@example.com`,
      adminFirstName: 'Test',
      adminLastName: 'Admin',
      adminPassword: 'Password123!',
      plan: 'STARTER',
    });

    await provisioner.close(result.tenantId, 'Integration test close', 1);
    const [closed] = await db.select().from(tenants).where(eq(tenants.id, result.tenantId));
    expect(closed!.status).toBe('CLOSED');
    const versionAfterFirstClose = closed!.version;

    // A second close() call must be a no-op (regression guard: close() previously had no
    // status guard in its WHERE clause at all, unlike suspend()/activate()).
    await provisioner.close(result.tenantId, 'Second close attempt', 1);
    const [stillClosed] = await db.select().from(tenants).where(eq(tenants.id, result.tenantId));
    expect(stillClosed!.version).toBe(versionAfterFirstClose);

    // Clean up — this test provisions its own tenant, separate from provisionedTenantId.
    await db.execute(`DELETE FROM user_roles WHERE tenant_id = ${result.tenantId}`);
    await db.execute(`DELETE FROM user_branches WHERE tenant_id = ${result.tenantId}`);
    await db.execute(`DELETE FROM role_permissions WHERE tenant_id = ${result.tenantId}`);
    await db.delete(organizationSettings).where(eq(organizationSettings.tenantId, result.tenantId));
    await db.delete(users).where(eq(users.tenantId, result.tenantId));
    await db.delete(roles).where(eq(roles.tenantId, result.tenantId));
    await db.delete(branches).where(eq(branches.tenantId, result.tenantId));
    await db.delete(tenants).where(eq(tenants.id, result.tenantId));
  });

  it('marks provisioning FAILED and rejects if the S3 bucket is unreachable', async () => {
    const slug = `test-tenant-s3fail-${Date.now()}`;
    const failingStorage = {
      bucketExists: vi.fn().mockResolvedValue(false),
      uploadFile: vi.fn(),
      getSignedUrl: vi.fn(),
      deleteFile: vi.fn(),
    } as unknown as StorageClient;
    const provisioner = new TenantProvisioner(db, 'http://localhost:9200', failingStorage);

    await expect(
      provisioner.provision({
        name: 'S3 Fail Co.',
        slug,
        contactEmail: `admin-s3fail-${Date.now()}@test.example`,
        adminFirstName: 'Test',
        adminLastName: 'Admin',
        adminPassword: 'Test@12345',
        plan: 'STARTER',
      })
    ).rejects.toThrow('S3_PROVISIONING_FAILED');

    const [failedTenant] = await db.select().from(tenants).where(eq(tenants.slug, slug));
    expect(failedTenant!.provisioningStatus).toBe('FAILED');

    // Provisioning has no resume mechanism (see PG-029) — clean up this run's partial state.
    await db.execute(`DELETE FROM user_roles WHERE tenant_id = ${failedTenant!.id}`);
    await db.execute(`DELETE FROM user_branches WHERE tenant_id = ${failedTenant!.id}`);
    await db.execute(`DELETE FROM role_permissions WHERE tenant_id = ${failedTenant!.id}`);
    await db.delete(users).where(eq(users.tenantId, failedTenant!.id));
    await db.delete(roles).where(eq(roles.tenantId, failedTenant!.id));
    await db.delete(branches).where(eq(branches.tenantId, failedTenant!.id));
    await db.delete(tenants).where(eq(tenants.id, failedTenant!.id));
  });
});

describe.skipIf(!DB_URL || !MINIO_ENDPOINT)('Tenant provisioning — real MinIO bootstrap', () => {
  let db: ReturnType<typeof createDatabaseClient>;
  let tenantId: number;

  beforeAll(async () => {
    db = createDatabaseClient({ url: DB_URL! });
  });

  afterAll(async () => {
    if (!tenantId) return;
    await db.execute(`DELETE FROM user_roles WHERE tenant_id = ${tenantId}`);
    await db.execute(`DELETE FROM user_branches WHERE tenant_id = ${tenantId}`);
    await db.execute(`DELETE FROM role_permissions WHERE tenant_id = ${tenantId}`);
    await db.delete(users).where(eq(users.tenantId, tenantId));
    await db.delete(roles).where(eq(roles.tenantId, tenantId));
    await db.delete(branches).where(eq(branches.tenantId, tenantId));
    await db.delete(tenants).where(eq(tenants.id, tenantId));
  });

  it('creates a real, verifiable object in MinIO at the tenant prefix', async () => {
    const { StorageClient: RealStorageClient } = await import('@erp/sdk');
    const storageClient = new RealStorageClient({
      endpoint: MINIO_ENDPOINT!,
      accessKeyId: process.env['MINIO_ACCESS_KEY'] ?? 'erp_minio',
      secretAccessKey: process.env['MINIO_SECRET_KEY'] ?? 'erp_minio_secret',
      useSSL: process.env['MINIO_USE_SSL'] === 'true',
      bucket: process.env['MINIO_BUCKET'] ?? 'erp-storage',
    });
    const uploadSpy = vi.spyOn(storageClient, 'uploadFile');
    const provisioner = new TenantProvisioner(db, 'http://localhost:9200', storageClient);

    const slug = `test-tenant-minio-${Date.now()}`;
    const result = await provisioner.provision({
      name: 'MinIO Real Co.',
      slug,
      contactEmail: `admin-minio-${Date.now()}@test.example`,
      adminFirstName: 'Test',
      adminLastName: 'Admin',
      adminPassword: 'Test@12345',
      plan: 'STARTER',
    });
    tenantId = result.tenantId;

    const [tenant] = await db.select().from(tenants).where(eq(tenants.id, tenantId));
    expect(tenant!.provisioningStatus).toBe('COMPLETE');

    // Round-trip proof the object really exists in MinIO: fetch the presigned GET URL
    // for the exact key STEP 6 wrote (getSignedUrl itself is a local computation and
    // resolves regardless of existence, so this HTTP round-trip is the real check).
    expect(uploadSpy).toHaveBeenCalledTimes(1);
    const objectKey = await uploadSpy.mock.results[0]!.value;
    const signedUrl = await storageClient.getSignedUrl(objectKey);
    const res = await fetch(signedUrl);
    expect(res.status).toBe(200);
  });
});
