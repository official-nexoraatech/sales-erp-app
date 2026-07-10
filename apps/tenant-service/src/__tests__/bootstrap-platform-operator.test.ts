import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createDatabaseClient } from '@erp/db';
import { tenants, roles, users, userRoles } from '@erp/db';
import { eq, and } from 'drizzle-orm';
import { bootstrapPlatformOperator } from '../../scripts/bootstrap-platform-operator.js';

const DB_URL = process.env['DATABASE_URL'];

describe.skipIf(!DB_URL)('Platform-operator bootstrap (PG-030)', () => {
  let db: ReturnType<typeof createDatabaseClient>;
  let createdUserId: number | undefined;

  beforeAll(async () => {
    db = createDatabaseClient({ url: DB_URL! });
  });

  afterAll(async () => {
    if (!createdUserId) return;
    await db.delete(userRoles).where(eq(userRoles.userId, createdUserId));
    await db.delete(users).where(eq(users.id, createdUserId));
  });

  it('under concurrent invocation on a clean state, exactly one bootstrap attempt succeeds', async () => {
    const [tenant] = await db.select().from(tenants).where(eq(tenants.slug, 'platform-operations'));
    if (!tenant) return; // migration 0020_es21_platform_operator.sql not applied in this environment

    const [role] = await db
      .select()
      .from(roles)
      .where(and(eq(roles.tenantId, tenant.id), eq(roles.name, 'PLATFORM_OPERATOR')));
    if (!role) return;

    const [existing] = await db.select().from(userRoles).where(eq(userRoles.roleId, role.id));
    if (existing) return; // an operator already exists in this environment — nothing to bootstrap

    const password = 'Bootstrap@Test123';
    const results = await Promise.allSettled([
      bootstrapPlatformOperator(db, `bootstrap-race-a-${Date.now()}@platform.internal`, password),
      bootstrapPlatformOperator(db, `bootstrap-race-b-${Date.now()}@platform.internal`, password),
    ]);

    const fulfilled = results.filter((r): r is PromiseFulfilledResult<number> => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);

    createdUserId = fulfilled[0]!.value;
    expect(createdUserId).toBeGreaterThan(0);

    const [user] = await db.select().from(users).where(eq(users.id, createdUserId));
    expect(user!.tenantId).toBe(tenant.id);

    const [grantedRole] = await db.select().from(userRoles).where(eq(userRoles.userId, createdUserId));
    expect(grantedRole!.roleId).toBe(role.id);
  });

  it('refuses a subsequent bootstrap attempt now that a platform operator exists', async () => {
    if (!createdUserId) return; // previous test found an environment already past bootstrap, or migration missing

    await expect(
      bootstrapPlatformOperator(db, `bootstrap-should-not-be-created-${Date.now()}@platform.internal`, 'Bootstrap@Test123')
    ).rejects.toThrow('already exists');
  });
});
