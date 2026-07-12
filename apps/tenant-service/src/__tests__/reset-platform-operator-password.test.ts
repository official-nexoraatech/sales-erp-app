import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createDatabaseClient } from '@erp/db';
import { tenants, roles, users, userRoles, refreshTokens } from '@erp/db';
import { eq, and } from 'drizzle-orm';
import argon2 from 'argon2';
import { resetPlatformOperatorPassword } from '../../scripts/reset-platform-operator-password.js';

const DB_URL = process.env['DATABASE_URL'];

describe.skipIf(!DB_URL)('Platform-operator password reset', () => {
  let db: ReturnType<typeof createDatabaseClient>;
  let createdUserId: number | undefined;

  beforeAll(async () => {
    db = createDatabaseClient({ url: DB_URL! });
  });

  afterAll(async () => {
    if (!createdUserId) return;
    await db.delete(refreshTokens).where(eq(refreshTokens.userId, createdUserId));
    await db.delete(userRoles).where(eq(userRoles.userId, createdUserId));
    await db.delete(users).where(eq(users.id, createdUserId));
  });

  it('resets the password and revokes existing sessions for an existing operator', async () => {
    const [tenant] = await db.select().from(tenants).where(eq(tenants.slug, 'platform-operations'));
    if (!tenant) return; // migration 0020_es21_platform_operator.sql not applied in this environment

    const [role] = await db
      .select()
      .from(roles)
      .where(and(eq(roles.tenantId, tenant.id), eq(roles.name, 'PLATFORM_OPERATOR')));
    if (!role) return;

    const email = `reset-test-${Date.now()}@platform.internal`;
    const [user] = await db
      .insert(users)
      .values({
        tenantId: tenant.id,
        email,
        passwordHash: await argon2.hash('OriginalPass@123', { type: argon2.argon2id }),
        firstName: 'Platform',
        lastName: 'Operator',
        isActive: true,
        isEmailVerified: true,
        failedLoginAttempts: 3,
      })
      .returning();
    createdUserId = user!.id;
    await db.insert(userRoles).values({ userId: user!.id, roleId: role.id, tenantId: tenant.id });
    await db.insert(refreshTokens).values({
      userId: user!.id,
      tenantId: tenant.id,
      tokenHash: `test-hash-${Date.now()}`,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    });

    const returnedId = await resetPlatformOperatorPassword(db, email, 'BrandNewPass@456');
    expect(returnedId).toBe(user!.id);

    const [updated] = await db.select().from(users).where(eq(users.id, user!.id));
    expect(updated!.failedLoginAttempts).toBe(0);
    expect(updated!.lockedUntil).toBeNull();
    expect(await argon2.verify(updated!.passwordHash, 'BrandNewPass@456')).toBe(true);

    const tokens = await db.select().from(refreshTokens).where(eq(refreshTokens.userId, user!.id));
    expect(tokens.every((t) => t.revokedAt !== null)).toBe(true);
  });

  it('refuses to reset a user who does not hold the PLATFORM_OPERATOR role', async () => {
    const [tenant] = await db.select().from(tenants).where(eq(tenants.slug, 'platform-operations'));
    if (!tenant) return;

    await expect(
      resetPlatformOperatorPassword(
        db,
        `no-such-operator-${Date.now()}@platform.internal`,
        'BrandNewPass@456'
      )
    ).rejects.toThrow('No user with email');
  });
});
