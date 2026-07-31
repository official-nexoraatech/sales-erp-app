import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import argon2 from 'argon2';
import { eq, and, isNull } from 'drizzle-orm';
import type { Redis } from 'ioredis';
import { assertTenantActive } from '@erp/sdk';
import {
  crmPortalAccounts,
  crmPortalRefreshTokens,
  crmPortalPasswordTokens,
  securityAuditLog,
} from '@erp/db';
import type { ErpDatabase } from '@erp/db';
import { signAccessToken } from '../jwt.js';
import { generateSecureToken, sha256Hex } from '../crypto.js';
import type { AuthConfig } from '../config.js';
import { checkIpBlocked, recordFailedLoginAndMaybeBlock } from '../middleware/suspicious-login.js';
import { inetParam } from '../db-helpers.js';

// Deliberately separate from REFRESH_COOKIE_NAME/REFRESH_COOKIE_PATH (refresh-cookie.ts) — a
// staff and a portal refresh token must never be confused or replayed against the wrong table.
// Scoped narrower than the staff cookie's '/api/auth' on purpose: this is the highest-risk
// surface in the roadmap, so the portal cookie is only ever sent to portal-auth paths.
const PORTAL_REFRESH_COOKIE_NAME = 'portal_refresh_token';
const PORTAL_REFRESH_COOKIE_PATH = '/api/auth/auth/portal';

function setPortalRefreshCookie(
  reply: FastifyReply,
  refreshToken: string,
  config: AuthConfig
): void {
  void reply.setCookie(PORTAL_REFRESH_COOKIE_NAME, refreshToken, {
    httpOnly: true,
    secure: config.nodeEnv === 'production',
    sameSite: 'strict',
    path: PORTAL_REFRESH_COOKIE_PATH,
    maxAge: config.jwtRefreshTokenTtlDays * 24 * 60 * 60,
  });
}

function clearPortalRefreshCookie(reply: FastifyReply): void {
  void reply.clearCookie(PORTAL_REFRESH_COOKIE_NAME, { path: PORTAL_REFRESH_COOKIE_PATH });
}

// Portal auth events are logged with actorId: 0 (the existing SUSPICIOUS_LOGIN sentinel
// convention, see suspicious-login.ts) rather than the portal account's own numeric id —
// putting a portal-account id into an employee-shaped actorId/targetUserId field is exactly
// the cross-identity-space misattribution this feature's Finding 3 warns about, so identifying
// detail goes in `details` (free-form) instead.
function auditPortalAuthEvent(
  db: ErpDatabase,
  input: {
    tenantId: number;
    action: 'LOGIN_SUCCESS' | 'LOGIN_FAILURE';
    ip: string;
    details: Record<string, unknown>;
  }
): void {
  void db
    .insert(securityAuditLog)
    .values({
      tenantId: input.tenantId,
      actorId: 0,
      action: input.action,
      ipAddress: inetParam(input.ip),
      details: { surface: 'CUSTOMER_PORTAL', ...input.details },
    })
    .catch(() => undefined);
}

const PortalSetPasswordBody = z.object({
  token: z.string().min(1),
  newPassword: z.string().min(12).max(128),
});

const PortalLoginBody = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  tenantId: z.number().int().positive(),
});

const PortalRefreshBody = z.object({}).optional();

export async function portalAuthRoutes(
  fastify: FastifyInstance,
  db: ErpDatabase,
  config: AuthConfig,
  redis: Redis
): Promise<void> {
  // Consumes the invite/reset token a staff member's provisioning call sent by email —
  // mirrors reset-password.ts exactly, against the portal's own token/account tables.
  fastify.post('/auth/portal/set-password', {
    handler: async (request, reply) => {
      const body = PortalSetPasswordBody.safeParse(request.body);
      if (!body.success) {
        return reply.code(400).send({ error: 'Invalid request', details: body.error.flatten() });
      }

      const tokenHash = sha256Hex(body.data.token);
      const now = new Date();

      const [tokenRow] = await db
        .select()
        .from(crmPortalPasswordTokens)
        .where(
          and(
            eq(crmPortalPasswordTokens.tokenHash, tokenHash),
            isNull(crmPortalPasswordTokens.usedAt)
          )
        )
        .limit(1);

      if (!tokenRow || tokenRow.expiresAt < now) {
        return reply.code(400).send({ error: 'Invalid or expired reset token' });
      }

      const passwordHash = await argon2.hash(body.data.newPassword, { type: argon2.argon2id });

      await db
        .update(crmPortalPasswordTokens)
        .set({ usedAt: now })
        .where(eq(crmPortalPasswordTokens.id, tokenRow.id));

      await db
        .update(crmPortalAccounts)
        .set({ passwordHash, mustResetPassword: false, updatedAt: now })
        .where(eq(crmPortalAccounts.id, tokenRow.portalAccountId));

      await db
        .update(crmPortalRefreshTokens)
        .set({ revokedAt: now })
        .where(
          and(
            eq(crmPortalRefreshTokens.portalAccountId, tokenRow.portalAccountId),
            isNull(crmPortalRefreshTokens.revokedAt)
          )
        );

      return reply.code(200).send({ message: 'Password set successfully' });
    },
  });

  fastify.post('/auth/portal/login', {
    config: {
      rateLimit: { max: config.loginRateLimitMax, timeWindow: config.loginRateLimitWindowMs },
    },
    handler: async (request, reply) => {
      const body = PortalLoginBody.safeParse(request.body);
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

      await assertTenantActive(tenantId, []);

      const [account] = await db
        .select()
        .from(crmPortalAccounts)
        .where(and(eq(crmPortalAccounts.email, email), eq(crmPortalAccounts.tenantId, tenantId)))
        .limit(1);

      // Constant-time response to prevent account enumeration, same as staff login.ts.
      if (!account) {
        await argon2.hash('dummy-prevent-timing-attack', { type: argon2.argon2id });
        await recordFailedLoginAndMaybeBlock(db, redis, request.ip, tenantId, config);
        auditPortalAuthEvent(db, {
          tenantId,
          action: 'LOGIN_FAILURE',
          ip: request.ip,
          details: { reason: 'unknown_account' },
        });
        return reply.code(401).send({ error: 'Invalid credentials' });
      }

      if (!account.isActive) {
        auditPortalAuthEvent(db, {
          tenantId,
          action: 'LOGIN_FAILURE',
          ip: request.ip,
          details: { reason: 'account_disabled', portalAccountId: account.id },
        });
        return reply.code(401).send({ error: 'Account is disabled' });
      }

      const passwordValid = await argon2.verify(account.passwordHash, password);
      if (!passwordValid) {
        await recordFailedLoginAndMaybeBlock(db, redis, request.ip, tenantId, config);
        auditPortalAuthEvent(db, {
          tenantId,
          action: 'LOGIN_FAILURE',
          ip: request.ip,
          details: { reason: 'invalid_password', portalAccountId: account.id },
        });
        return reply.code(401).send({ error: 'Invalid credentials' });
      }

      const accessToken = await signAccessToken({
        sub: String(account.id),
        tenantId,
        email: account.email,
        roles: ['CUSTOMER'],
        permissions: [],
        branchIds: [],
        customerId: account.customerId,
      });

      const plainRefreshToken = generateSecureToken(32);
      const tokenHash = sha256Hex(plainRefreshToken);
      const expiresAt = new Date(Date.now() + config.jwtRefreshTokenTtlDays * 24 * 60 * 60 * 1000);

      await db.insert(crmPortalRefreshTokens).values({
        portalAccountId: account.id,
        tenantId,
        tokenHash,
        expiresAt,
      });

      await db
        .update(crmPortalAccounts)
        .set({ lastLoginAt: new Date() })
        .where(eq(crmPortalAccounts.id, account.id));

      auditPortalAuthEvent(db, {
        tenantId,
        action: 'LOGIN_SUCCESS',
        ip: request.ip,
        details: { portalAccountId: account.id, customerId: account.customerId },
      });

      setPortalRefreshCookie(reply, plainRefreshToken, config);
      return reply.code(200).send({
        data: {
          accessToken,
          refreshToken: plainRefreshToken,
          expiresIn: config.jwtAccessTokenTtl,
          tokenType: 'Bearer' as const,
          mustResetPassword: account.mustResetPassword,
        },
      });
    },
  });

  fastify.post('/auth/portal/refresh', {
    handler: async (request, reply) => {
      const parsed = PortalRefreshBody.safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply.code(400).send({ error: 'Invalid request' });
      }

      const refreshToken = request.cookies[PORTAL_REFRESH_COOKIE_NAME];
      if (!refreshToken) {
        return reply.code(401).send({ error: 'Invalid or expired refresh token' });
      }

      const tokenHash = sha256Hex(refreshToken);
      const now = new Date();

      const [tokenRow] = await db
        .select()
        .from(crmPortalRefreshTokens)
        .where(
          and(
            eq(crmPortalRefreshTokens.tokenHash, tokenHash),
            isNull(crmPortalRefreshTokens.revokedAt)
          )
        )
        .limit(1);

      if (!tokenRow || tokenRow.expiresAt < now) {
        return reply.code(401).send({ error: 'Invalid or expired refresh token' });
      }

      await assertTenantActive(tokenRow.tenantId, []);

      const [account] = await db
        .select()
        .from(crmPortalAccounts)
        .where(
          and(
            eq(crmPortalAccounts.id, tokenRow.portalAccountId),
            eq(crmPortalAccounts.isActive, true)
          )
        )
        .limit(1);

      if (!account) {
        return reply.code(401).send({ error: 'Account not found or inactive' });
      }

      await db
        .update(crmPortalRefreshTokens)
        .set({ revokedAt: now })
        .where(eq(crmPortalRefreshTokens.id, tokenRow.id));

      const accessToken = await signAccessToken({
        sub: String(account.id),
        tenantId: tokenRow.tenantId,
        email: account.email,
        roles: ['CUSTOMER'],
        permissions: [],
        branchIds: [],
        customerId: account.customerId,
      });

      const plainRefreshToken = generateSecureToken(32);
      const newTokenHash = sha256Hex(plainRefreshToken);
      const expiresAt = new Date(Date.now() + config.jwtRefreshTokenTtlDays * 24 * 60 * 60 * 1000);

      await db.insert(crmPortalRefreshTokens).values({
        portalAccountId: account.id,
        tenantId: tokenRow.tenantId,
        tokenHash: newTokenHash,
        expiresAt,
      });

      setPortalRefreshCookie(reply, plainRefreshToken, config);
      // Unenveloped, matching the staff /auth/refresh route's own response shape
      // (client.ts's refreshAccessToken() reads body.accessToken directly for that route).
      return reply.code(200).send({
        accessToken,
        refreshToken: plainRefreshToken,
        expiresIn: config.jwtAccessTokenTtl,
        tokenType: 'Bearer',
      });
    },
  });

  fastify.post('/auth/portal/logout', {
    handler: async (request, reply) => {
      const refreshToken = request.cookies[PORTAL_REFRESH_COOKIE_NAME];
      if (!refreshToken) {
        clearPortalRefreshCookie(reply);
        return reply.code(200).send({ message: 'Logged out successfully' });
      }

      const tokenHash = sha256Hex(refreshToken);
      await db
        .update(crmPortalRefreshTokens)
        .set({ revokedAt: new Date() })
        .where(
          and(
            eq(crmPortalRefreshTokens.tokenHash, tokenHash),
            isNull(crmPortalRefreshTokens.revokedAt)
          )
        );

      clearPortalRefreshCookie(reply);
      return reply.code(200).send({ message: 'Logged out successfully' });
    },
  });
}
