import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import argon2 from 'argon2';
import { eq, and } from 'drizzle-orm';
import type { Redis } from 'ioredis';
import { TenantScopedCache, assertTenantActive } from '@erp/sdk';
import { users } from '@erp/db';
import type { ErpDatabase } from '@erp/db';
import { generateSecureToken } from '../crypto.js';
import type { AuthConfig } from '../config.js';
import { checkIpBlocked, recordFailedLoginAndMaybeBlock } from '../middleware/suspicious-login.js';
import { issueTokensAndSession } from '../domain/session.js';
import { loadUserRolesAndPermissions } from '../domain/roles.js';

const LoginBody = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  tenantId: z.number().int().positive(),
});

const MFA_TOKEN_TTL_SECONDS = 300;

export async function loginRoute(
  fastify: FastifyInstance,
  db: ErpDatabase,
  config: AuthConfig,
  redis: Redis
): Promise<void> {
  fastify.post('/auth/login', {
    config: {
      rateLimit: { max: config.loginRateLimitMax, timeWindow: config.loginRateLimitWindowMs },
    },
    handler: async (request, reply) => {
      const body = LoginBody.safeParse(request.body);
      if (!body.success) {
        return reply.code(400).send({ error: 'Invalid request', details: body.error.flatten() });
      }

      const { email, password, tenantId } = body.data;

      const ipStatus = await checkIpBlocked(db, request.ip);
      if (ipStatus.blocked) {
        return reply.code(429).send({
          error: 'Too many failed login attempts from this IP',
          retryAfterSeconds: ipStatus.retryAfterSeconds,
        });
      }

      // Reject before checking credentials — a suspended/closed tenant's users shouldn't
      // be able to log in at all, and should see that clearly instead of generic
      // "Invalid credentials". Thrown ERPError is caught by the shared error handler.
      await assertTenantActive(tenantId, []);

      const [user] = await db
        .select()
        .from(users)
        .where(and(eq(users.email, email), eq(users.tenantId, tenantId)))
        .limit(1);

      // Constant-time response to prevent user enumeration
      if (!user) {
        await argon2.hash('dummy-prevent-timing-attack', { type: argon2.argon2id });
        await recordFailedLoginAndMaybeBlock(db, redis, request.ip, tenantId, config);
        return reply.code(401).send({ error: 'Invalid credentials' });
      }

      if (!user.isActive) {
        return reply.code(401).send({ error: 'Account is disabled' });
      }

      // Check account lockout
      if (user.lockedUntil && user.lockedUntil > new Date()) {
        const remainingMs = user.lockedUntil.getTime() - Date.now();
        return reply.code(429).send({
          error: 'Account temporarily locked',
          retryAfterSeconds: Math.ceil(remainingMs / 1000),
        });
      }

      const passwordValid = await argon2.verify(user.passwordHash, password);

      if (!passwordValid) {
        const newAttempts = user.failedLoginAttempts + 1;
        const shouldLock = newAttempts >= config.accountLockoutAttempts;
        await db
          .update(users)
          .set({
            failedLoginAttempts: newAttempts,
            lockedUntil: shouldLock ? new Date(Date.now() + config.accountLockoutDurationMs) : null,
            updatedAt: new Date(),
          })
          .where(eq(users.id, user.id));

        await recordFailedLoginAndMaybeBlock(db, redis, request.ip, tenantId, config);

        if (shouldLock) {
          return reply.code(429).send({
            error: 'Account locked due to too many failed attempts',
            retryAfterSeconds: Math.ceil(config.accountLockoutDurationMs / 1000),
          });
        }
        return reply.code(401).send({ error: 'Invalid credentials' });
      }

      // Password confirmed — challenge with TOTP before issuing any tokens
      if (user.totpEnabled) {
        // The Redis key must be tenant-scoped, but /auth/mfa/verify only receives the
        // opaque mfaToken back (no tenantId in that request) — so the tenantId travels
        // as a prefix of the token itself, letting the read side reconstruct the same
        // TenantScopedCache without changing the API contract.
        const tokenSecret = generateSecureToken(32);
        const mfaToken = `${tenantId}.${tokenSecret}`;
        const cache = new TenantScopedCache(redis, tenantId);
        await cache.setJson(
          `mfa:${tokenSecret}`,
          { userId: user.id, tenantId },
          MFA_TOKEN_TTL_SECONDS
        );
        return reply.code(200).send({ data: { requiresMFA: true, mfaToken } });
      }

      // Load roles and permissions
      const { roleNames, permissions, branchIds } = await loadUserRolesAndPermissions(
        db,
        user.id,
        tenantId
      );

      // Issue tokens + record active session
      const tokens = await issueTokensAndSession(
        db,
        config,
        {
          sub: String(user.id),
          tenantId,
          email: user.email,
          roles: roleNames,
          permissions,
          branchIds,
        },
        { ip: request.ip, userAgent: request.headers['user-agent'] ?? null }
      );

      // Reset failed attempts and record last login
      await db
        .update(users)
        .set({
          failedLoginAttempts: 0,
          lockedUntil: null,
          lastLoginAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(users.id, user.id));

      return reply.code(200).send({ data: tokens });
    },
  });
}
