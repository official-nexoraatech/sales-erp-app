import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import argon2 from 'argon2';
import { eq, and, isNull } from 'drizzle-orm';
import type { Redis } from 'ioredis';
import { assertTenantActive } from '@erp/sdk';
import {
  crmPartnerAccounts,
  crmPartnerRefreshTokens,
  crmPartnerPasswordTokens,
  securityAuditLog,
} from '@erp/db';
import type { ErpDatabase } from '@erp/db';
import { signAccessToken } from '../jwt.js';
import { generateSecureToken, sha256Hex } from '../crypto.js';
import type { AuthConfig } from '../config.js';
import { checkIpBlocked, recordFailedLoginAndMaybeBlock } from '../middleware/suspicious-login.js';
import { inetParam } from '../db-helpers.js';

// CRM-ROADMAP Phase 4, Feature 6 (Partner/Channel Portal) — mirrors portal-auth.routes.ts
// (CRM-ROADMAP Phase 3, Feature 2) exactly for the third auth scope, PARTNER. Deliberately
// separate cookie name/path from both REFRESH_COOKIE_NAME/PATH (staff) and
// PORTAL_REFRESH_COOKIE_NAME/PATH (customer) — a staff, customer, and partner refresh token
// must never be confused or replayed against the wrong table.
const PARTNER_REFRESH_COOKIE_NAME = 'partner_refresh_token';
const PARTNER_REFRESH_COOKIE_PATH = '/api/auth/auth/partner';

function setPartnerRefreshCookie(
  reply: FastifyReply,
  refreshToken: string,
  config: AuthConfig
): void {
  void reply.setCookie(PARTNER_REFRESH_COOKIE_NAME, refreshToken, {
    httpOnly: true,
    secure: config.nodeEnv === 'production',
    sameSite: 'strict',
    path: PARTNER_REFRESH_COOKIE_PATH,
    maxAge: config.jwtRefreshTokenTtlDays * 24 * 60 * 60,
  });
}

function clearPartnerRefreshCookie(reply: FastifyReply): void {
  void reply.clearCookie(PARTNER_REFRESH_COOKIE_NAME, { path: PARTNER_REFRESH_COOKIE_PATH });
}

// Same actorId: 0 sentinel and reasoning as portal-auth.routes.ts's auditPortalAuthEvent —
// a partner-account id in an employee-shaped actorId field would misattribute the event.
function auditPartnerAuthEvent(
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
      details: { surface: 'PARTNER_PORTAL', ...input.details },
    })
    .catch(() => undefined);
}

const PartnerSetPasswordBody = z.object({
  token: z.string().min(1),
  newPassword: z.string().min(12).max(128),
});

const PartnerLoginBody = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  tenantId: z.number().int().positive(),
});

const PartnerRefreshBody = z.object({}).optional();

export async function partnerAuthRoutes(
  fastify: FastifyInstance,
  db: ErpDatabase,
  config: AuthConfig,
  redis: Redis
): Promise<void> {
  // Consumes the invite/reset token a staff member's provisioning call sent by email —
  // mirrors portal-auth.routes.ts's set-password exactly, against the partner tables.
  fastify.post('/auth/partner/set-password', {
    handler: async (request, reply) => {
      const body = PartnerSetPasswordBody.safeParse(request.body);
      if (!body.success) {
        return reply.code(400).send({ error: 'Invalid request', details: body.error.flatten() });
      }

      const tokenHash = sha256Hex(body.data.token);
      const now = new Date();

      const [tokenRow] = await db
        .select()
        .from(crmPartnerPasswordTokens)
        .where(
          and(
            eq(crmPartnerPasswordTokens.tokenHash, tokenHash),
            isNull(crmPartnerPasswordTokens.usedAt)
          )
        )
        .limit(1);

      if (!tokenRow || tokenRow.expiresAt < now) {
        return reply.code(400).send({ error: 'Invalid or expired reset token' });
      }

      const passwordHash = await argon2.hash(body.data.newPassword, { type: argon2.argon2id });

      await db
        .update(crmPartnerPasswordTokens)
        .set({ usedAt: now })
        .where(eq(crmPartnerPasswordTokens.id, tokenRow.id));

      await db
        .update(crmPartnerAccounts)
        .set({ passwordHash, mustResetPassword: false, updatedAt: now })
        .where(eq(crmPartnerAccounts.id, tokenRow.partnerAccountId));

      await db
        .update(crmPartnerRefreshTokens)
        .set({ revokedAt: now })
        .where(
          and(
            eq(crmPartnerRefreshTokens.partnerAccountId, tokenRow.partnerAccountId),
            isNull(crmPartnerRefreshTokens.revokedAt)
          )
        );

      return reply.code(200).send({ message: 'Password set successfully' });
    },
  });

  fastify.post('/auth/partner/login', {
    config: {
      rateLimit: { max: config.loginRateLimitMax, timeWindow: config.loginRateLimitWindowMs },
    },
    handler: async (request, reply) => {
      const body = PartnerLoginBody.safeParse(request.body);
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
        .from(crmPartnerAccounts)
        .where(and(eq(crmPartnerAccounts.email, email), eq(crmPartnerAccounts.tenantId, tenantId)))
        .limit(1);

      // Constant-time response to prevent account enumeration, same as staff login.ts.
      if (!account) {
        await argon2.hash('dummy-prevent-timing-attack', { type: argon2.argon2id });
        await recordFailedLoginAndMaybeBlock(db, redis, request.ip, tenantId, config);
        auditPartnerAuthEvent(db, {
          tenantId,
          action: 'LOGIN_FAILURE',
          ip: request.ip,
          details: { reason: 'unknown_account' },
        });
        return reply.code(401).send({ error: 'Invalid credentials' });
      }

      if (!account.isActive) {
        auditPartnerAuthEvent(db, {
          tenantId,
          action: 'LOGIN_FAILURE',
          ip: request.ip,
          details: { reason: 'account_disabled', partnerAccountId: account.id },
        });
        return reply.code(401).send({ error: 'Account is disabled' });
      }

      const passwordValid = await argon2.verify(account.passwordHash, password);
      if (!passwordValid) {
        await recordFailedLoginAndMaybeBlock(db, redis, request.ip, tenantId, config);
        auditPartnerAuthEvent(db, {
          tenantId,
          action: 'LOGIN_FAILURE',
          ip: request.ip,
          details: { reason: 'invalid_password', partnerAccountId: account.id },
        });
        return reply.code(401).send({ error: 'Invalid credentials' });
      }

      const accessToken = await signAccessToken({
        sub: String(account.id),
        tenantId,
        email: account.email,
        roles: ['PARTNER'],
        permissions: [],
        branchIds: [],
        customerId: account.customerId,
      });

      const plainRefreshToken = generateSecureToken(32);
      const tokenHash = sha256Hex(plainRefreshToken);
      const expiresAt = new Date(Date.now() + config.jwtRefreshTokenTtlDays * 24 * 60 * 60 * 1000);

      await db.insert(crmPartnerRefreshTokens).values({
        partnerAccountId: account.id,
        tenantId,
        tokenHash,
        expiresAt,
      });

      await db
        .update(crmPartnerAccounts)
        .set({ lastLoginAt: new Date() })
        .where(eq(crmPartnerAccounts.id, account.id));

      auditPartnerAuthEvent(db, {
        tenantId,
        action: 'LOGIN_SUCCESS',
        ip: request.ip,
        details: { partnerAccountId: account.id, customerId: account.customerId },
      });

      setPartnerRefreshCookie(reply, plainRefreshToken, config);
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

  fastify.post('/auth/partner/refresh', {
    handler: async (request, reply) => {
      const parsed = PartnerRefreshBody.safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply.code(400).send({ error: 'Invalid request' });
      }

      const refreshToken = request.cookies[PARTNER_REFRESH_COOKIE_NAME];
      if (!refreshToken) {
        return reply.code(401).send({ error: 'Invalid or expired refresh token' });
      }

      const tokenHash = sha256Hex(refreshToken);
      const now = new Date();

      const [tokenRow] = await db
        .select()
        .from(crmPartnerRefreshTokens)
        .where(
          and(
            eq(crmPartnerRefreshTokens.tokenHash, tokenHash),
            isNull(crmPartnerRefreshTokens.revokedAt)
          )
        )
        .limit(1);

      if (!tokenRow || tokenRow.expiresAt < now) {
        return reply.code(401).send({ error: 'Invalid or expired refresh token' });
      }

      await assertTenantActive(tokenRow.tenantId, []);

      const [account] = await db
        .select()
        .from(crmPartnerAccounts)
        .where(
          and(
            eq(crmPartnerAccounts.id, tokenRow.partnerAccountId),
            eq(crmPartnerAccounts.isActive, true)
          )
        )
        .limit(1);

      if (!account) {
        return reply.code(401).send({ error: 'Account not found or inactive' });
      }

      await db
        .update(crmPartnerRefreshTokens)
        .set({ revokedAt: now })
        .where(eq(crmPartnerRefreshTokens.id, tokenRow.id));

      const accessToken = await signAccessToken({
        sub: String(account.id),
        tenantId: tokenRow.tenantId,
        email: account.email,
        roles: ['PARTNER'],
        permissions: [],
        branchIds: [],
        customerId: account.customerId,
      });

      const plainRefreshToken = generateSecureToken(32);
      const newTokenHash = sha256Hex(plainRefreshToken);
      const expiresAt = new Date(Date.now() + config.jwtRefreshTokenTtlDays * 24 * 60 * 60 * 1000);

      await db.insert(crmPartnerRefreshTokens).values({
        partnerAccountId: account.id,
        tenantId: tokenRow.tenantId,
        tokenHash: newTokenHash,
        expiresAt,
      });

      setPartnerRefreshCookie(reply, plainRefreshToken, config);
      // Unenveloped, matching portal-auth.routes.ts's own /refresh response shape.
      return reply.code(200).send({
        accessToken,
        refreshToken: plainRefreshToken,
        expiresIn: config.jwtAccessTokenTtl,
        tokenType: 'Bearer',
      });
    },
  });

  fastify.post('/auth/partner/logout', {
    handler: async (request, reply) => {
      const refreshToken = request.cookies[PARTNER_REFRESH_COOKIE_NAME];
      if (!refreshToken) {
        clearPartnerRefreshCookie(reply);
        return reply.code(200).send({ message: 'Logged out successfully' });
      }

      const tokenHash = sha256Hex(refreshToken);
      await db
        .update(crmPartnerRefreshTokens)
        .set({ revokedAt: new Date() })
        .where(
          and(
            eq(crmPartnerRefreshTokens.tokenHash, tokenHash),
            isNull(crmPartnerRefreshTokens.revokedAt)
          )
        );

      clearPartnerRefreshCookie(reply);
      return reply.code(200).send({ message: 'Logged out successfully' });
    },
  });
}
