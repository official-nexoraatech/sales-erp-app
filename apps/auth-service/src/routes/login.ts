import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import argon2 from 'argon2';
import { eq, and } from 'drizzle-orm';
import type { Redis } from 'ioredis';
import { TenantScopedCache, assertTenantActive } from '@erp/sdk';
import { erpAuthLoginTotal } from '@erp/logger';
import { users, securityAuditLog } from '@erp/db';
import type { ErpDatabase } from '@erp/db';
import { generateSecureToken } from '../crypto.js';
import type { AuthConfig } from '../config.js';
import { checkIpBlocked, recordFailedLoginAndMaybeBlock } from '../middleware/suspicious-login.js';
import { issueTokensAndSession } from '../domain/session.js';
import { loadUserRolesAndPermissions } from '../domain/roles.js';
import { setRefreshCookie } from '../refresh-cookie.js';
import { inetParam } from '../db-helpers.js';

function logLoginFailure(
  db: ErpDatabase,
  tenantId: number,
  ip: string,
  reason: string,
  targetUserId?: number,
  metricOutcome: 'failed' | 'locked' = 'failed'
): void {
  erpAuthLoginTotal.inc({ tenant_id: String(tenantId), outcome: metricOutcome });

  // Fire-and-forget, matching this route's existing pattern for non-essential side
  // effects (see suspicious-login.ts's own securityAuditLog inserts) — a logging
  // failure must never turn a login attempt's own success/failure response into a 500.
  void db
    .insert(securityAuditLog)
    .values({
      tenantId,
      actorId: targetUserId ?? 0,
      ...(targetUserId !== undefined ? { targetUserId } : {}),
      action: 'LOGIN_FAILURE',
      ipAddress: inetParam(ip),
      details: { reason },
    })
    .catch(() => undefined);
}

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
        logLoginFailure(db, tenantId, request.ip, 'unknown_user');
        return reply.code(401).send({ error: 'Invalid credentials' });
      }

      if (!user.isActive) {
        logLoginFailure(db, tenantId, request.ip, 'account_disabled', user.id);
        return reply.code(401).send({ error: 'Account is disabled' });
      }

      // Check account lockout
      if (user.lockedUntil && user.lockedUntil > new Date()) {
        const remainingMs = user.lockedUntil.getTime() - Date.now();
        logLoginFailure(db, tenantId, request.ip, 'account_locked', user.id, 'locked');
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
        logLoginFailure(
          db,
          tenantId,
          request.ip,
          shouldLock ? 'invalid_password_now_locked' : 'invalid_password',
          user.id,
          shouldLock ? 'locked' : 'failed'
        );

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

      erpAuthLoginTotal.inc({ tenant_id: String(tenantId), outcome: 'success' });
      void db
        .insert(securityAuditLog)
        .values({
          tenantId,
          actorId: user.id,
          targetUserId: user.id,
          action: 'LOGIN_SUCCESS',
          ipAddress: inetParam(request.ip),
          details: {},
        })
        .catch(() => undefined);

      setRefreshCookie(reply, tokens.refreshToken, config);
      return reply.code(200).send({ data: tokens });
    },
  });
}
