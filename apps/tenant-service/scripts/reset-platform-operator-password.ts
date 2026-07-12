/**
 * Platform-Operator Password Reset Script
 *
 * Usage:
 *   DATABASE_URL="postgresql://..." pnpm --filter @erp/tenant-service reset-operator-password -- --email=<email> --new-password=<password>
 *
 * Recovers a locked-out PLATFORM_OPERATOR account (e.g. the very first operator,
 * created via bootstrap-platform-operator.ts, forgetting their password) by resetting
 * it directly against the database — the same "operator has server/DB access" model
 * the bootstrap script already assumes (see PG-030,
 * ERP-PLANNING/production-gap-prompts/004-Platform/28-first-platform-operator-bootstrap.md).
 *
 * Self-service /auth/forgot-password cannot recover this account today: the
 * `platform-operations` tenant is seeded directly by migration 0020, bypassing the normal
 * tenant-provisioning flow, so it has never had its PASSWORD_RESET_REQUESTED notification
 * template seeded (POST /notifications/templates/seed-auth) — NotificationEngine.send()
 * silently SKIPS with no email and no error, and the request still returns 200 as designed
 * (email-enumeration protection). This script is the operator-recovery equivalent of that
 * flow for the one account it can't reach.
 */
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import type { ErpDatabase } from '@erp/db';
import { createDatabaseClient, tenants, roles, users, userRoles, refreshTokens } from '@erp/db';
import { eq, and, isNull } from 'drizzle-orm';
import argon2 from 'argon2';

export async function resetPlatformOperatorPassword(
  db: ErpDatabase,
  email: string,
  newPassword: string
): Promise<number> {
  return db.transaction(async (trx) => {
    const [tenant] = await trx
      .select()
      .from(tenants)
      .where(eq(tenants.slug, 'platform-operations'));
    if (!tenant) {
      throw new Error(
        'platform-operations tenant not found — run migration 0020_es21_platform_operator.sql first'
      );
    }

    const [role] = await trx
      .select()
      .from(roles)
      .where(and(eq(roles.tenantId, tenant.id), eq(roles.name, 'PLATFORM_OPERATOR')));
    if (!role) {
      throw new Error(
        'PLATFORM_OPERATOR role not found for platform-operations tenant — run migration 0020 first'
      );
    }

    const [user] = await trx
      .select()
      .from(users)
      .where(and(eq(users.email, email), eq(users.tenantId, tenant.id)));
    if (!user) {
      throw new Error(`No user with email "${email}" found in the platform-operations tenant`);
    }

    const [grant] = await trx
      .select()
      .from(userRoles)
      .where(and(eq(userRoles.userId, user.id), eq(userRoles.roleId, role.id)));
    if (!grant) {
      throw new Error(
        `User "${email}" exists but does not hold the PLATFORM_OPERATOR role — refusing to reset`
      );
    }

    const passwordHash = await argon2.hash(newPassword, {
      type: argon2.argon2id,
      memoryCost: 65536,
      timeCost: 3,
      parallelism: 4,
    });

    const now = new Date();
    await trx
      .update(users)
      .set({ passwordHash, failedLoginAttempts: 0, lockedUntil: null, updatedAt: now })
      .where(eq(users.id, user.id));

    // Force re-login everywhere, same as the normal /auth/reset-password route.
    await trx
      .update(refreshTokens)
      .set({ revokedAt: now })
      .where(and(eq(refreshTokens.userId, user.id), isNull(refreshTokens.revokedAt)));

    return user.id;
  });
}

function parseArgs(argv: string[]): { email?: string; newPassword?: string } {
  const result: { email?: string; newPassword?: string } = {};
  for (const arg of argv) {
    if (arg.startsWith('--email=')) result.email = arg.slice('--email='.length);
    if (arg.startsWith('--new-password=')) result.newPassword = arg.slice('--new-password='.length);
  }
  return result;
}

async function main(): Promise<void> {
  const DATABASE_URL = process.env['DATABASE_URL'];
  if (!DATABASE_URL) {
    process.stderr.write('DATABASE_URL env var is required\n');
    process.exitCode = 1;
    return;
  }

  const { email, newPassword } = parseArgs(process.argv.slice(2));
  if (!email || !newPassword) {
    process.stderr.write(
      'Usage: reset-platform-operator-password.ts --email=<email> --new-password=<password>\n'
    );
    process.exitCode = 1;
    return;
  }
  if (newPassword.length < 12) {
    process.stderr.write('Password must be at least 12 characters (platform minimum).\n');
    process.exitCode = 1;
    return;
  }

  const db = createDatabaseClient({ url: DATABASE_URL });
  const userId = await resetPlatformOperatorPassword(db, email, newPassword);
  process.stdout.write(`Platform operator password reset: id=${userId} email=${email}\n`);
}

// Only auto-run when executed directly (tsx/node), not when imported by tests.
// Compared as file:// URLs, not raw strings — see bootstrap-platform-operator.ts.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`Fatal: ${msg}\n`);
    process.exitCode = 1;
  });
}
