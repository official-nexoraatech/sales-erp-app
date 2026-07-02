import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createDatabaseClient } from '@erp/db';
import { tenants, roles, users, branches } from '@erp/db';
import { eq } from 'drizzle-orm';
import { TenantProvisioner } from '../domain/TenantProvisioner.js';

const DB_URL = process.env['DATABASE_URL'];

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
    await db.delete(users).where(eq(users.tenantId, provisionedTenantId));
    await db.delete(roles).where(eq(roles.tenantId, provisionedTenantId));
    await db.delete(branches).where(eq(branches.tenantId, provisionedTenantId));
    await db.delete(tenants).where(eq(tenants.id, provisionedTenantId));
  });

  it('provisions a tenant with admin user and seeded roles', async () => {
    const slug = `test-tenant-${Date.now()}`;
    const provisioner = new TenantProvisioner(db, 'http://localhost:9200', 'erp-local');

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
  });

  it('can suspend and activate a tenant', async () => {
    if (!provisionedTenantId) return;

    const provisioner = new TenantProvisioner(db, 'http://localhost:9200', 'erp-local');

    await provisioner.suspend(provisionedTenantId, 'Integration test suspension', 1);
    const [suspended] = await db.select().from(tenants).where(eq(tenants.id, provisionedTenantId));
    expect(suspended!.status).toBe('SUSPENDED');
    expect(suspended!.suspendedBy).toBe(1);

    await provisioner.activate(provisionedTenantId);
    const [active] = await db.select().from(tenants).where(eq(tenants.id, provisionedTenantId));
    expect(active!.status).toBe('ACTIVE');
  });
});
