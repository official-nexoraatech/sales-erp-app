/**
 * First Platform-Operator Bootstrap Script (PG-030)
 *
 * Usage:
 *   DATABASE_URL="postgresql://..." pnpm --filter @erp/tenant-service bootstrap-operator -- --email=<email> --password=<password>
 *
 * Creates the very first PLATFORM_OPERATOR user, scoped to the reserved
 * "platform-operations" tenant seeded by migration 0020_es21_platform_operator.sql.
 * Refuses to run if a PLATFORM_OPERATOR user already exists — see
 * ERP-PLANNING/phase-completions/ES-21_COMPLETION.md for why this can no longer be
 * done by hand-writing SQL. Every operator after the first should be created via the
 * normal POST /users flow (auth-service) by an existing operator.
 */
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import type { ErpDatabase } from '@erp/db';
import { createDatabaseClient, tenants, roles, users, userRoles } from '@erp/db';
import { eq, and, sql } from 'drizzle-orm';
import argon2 from 'argon2';

export async function bootstrapPlatformOperator(
  db: ErpDatabase,
  email: string,
  password: string
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

    // Lock the role row so a concurrent bootstrap attempt can't race the count-then-insert
    // below (TOCTOU guard) — the lock is held until this transaction commits or rolls back.
    const [role] = await trx
      .select()
      .from(roles)
      .where(and(eq(roles.tenantId, tenant.id), eq(roles.name, 'PLATFORM_OPERATOR')))
      .for('update');
    if (!role) {
      throw new Error(
        'PLATFORM_OPERATOR role not found for platform-operations tenant — run migration 0020 first'
      );
    }

    const [countRow] = await trx
      .select({ count: sql<number>`count(*)::int` })
      .from(userRoles)
      .where(eq(userRoles.roleId, role.id));
    if ((countRow?.count ?? 0) > 0) {
      throw new Error(
        'A PLATFORM_OPERATOR user already exists — use POST /users (via an existing operator) to create additional ones.'
      );
    }

    const passwordHash = await argon2.hash(password, {
      type: argon2.argon2id,
      memoryCost: 65536,
      timeCost: 3,
      parallelism: 4,
    });

    const [user] = await trx
      .insert(users)
      .values({
        tenantId: tenant.id,
        email,
        passwordHash,
        firstName: 'Platform',
        lastName: 'Operator',
        isActive: true,
        isEmailVerified: true,
        failedLoginAttempts: 0,
      })
      .returning();
    if (!user) throw new Error('Failed to create platform operator user');

    await trx.insert(userRoles).values({ userId: user.id, roleId: role.id, tenantId: tenant.id });

    return user.id;
  });
}

function parseArgs(argv: string[]): { email?: string; password?: string } {
  const result: { email?: string; password?: string } = {};
  for (const arg of argv) {
    if (arg.startsWith('--email=')) result.email = arg.slice('--email='.length);
    if (arg.startsWith('--password=')) result.password = arg.slice('--password='.length);
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

  const { email, password } = parseArgs(process.argv.slice(2));
  if (!email || !password) {
    process.stderr.write(
      'Usage: bootstrap-platform-operator.ts --email=<email> --password=<password>\n'
    );
    process.exitCode = 1;
    return;
  }
  if (password.length < 12) {
    process.stderr.write('Password must be at least 12 characters (platform minimum).\n');
    process.exitCode = 1;
    return;
  }

  const db = createDatabaseClient({ url: DATABASE_URL });
  const createdUserId = await bootstrapPlatformOperator(db, email, password);
  process.stdout.write(`Platform operator created: id=${createdUserId} email=${email}\n`);
}

// Only auto-run when executed directly (tsx/node), not when imported by tests.
// Compared as file:// URLs, not raw strings — on Windows process.argv[1] is a
// backslash path ("C:\...") while import.meta.url is always a forward-slash,
// percent-encoded URL ("file:///C:/..."), so a naive template-string comparison
// never matches and this guard silently no-ops on Windows.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`Fatal: ${msg}\n`);
    process.exitCode = 1;
  });
}
