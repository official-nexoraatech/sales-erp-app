import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import argon2 from 'argon2';
import { eq } from 'drizzle-orm';
import type { Redis } from 'ioredis';
import { TenantScopedCache } from '@erp/sdk';
import { users, securityAuditLog } from '@erp/db';
import type { ErpDatabase } from '@erp/db';
import type { AuthConfig } from '../config.js';
import { MFAService } from '../domain/MFAService.js';
import { issueTokensAndSession } from '../domain/session.js';
import { loadUserRolesAndPermissions } from '../domain/roles.js';
import { inetParam } from '../db-helpers.js';

const VerifyBody = z.object({
  mfaToken: z.string().min(1),
  code: z.string().min(1),
});

const ConfirmBody = z.object({ code: z.string().min(1) });

const DisableBody = z.object({ code: z.string().min(1), password: z.string().min(1) });

const RegenerateBackupCodesBody = z.object({ totpCode: z.string().min(1) });

interface MfaTokenPayload {
  userId: number;
  tenantId: number;
}

async function issueTokensForUser(
  db: ErpDatabase,
  config: AuthConfig,
  userId: number,
  tenantId: number,
  ctx: { ip: string; userAgent: string | null }
): Promise<ReturnType<typeof issueTokensAndSession>> {
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user) throw new Error('User not found');

  const { roleNames, permissions, branchIds } = await loadUserRolesAndPermissions(db, userId, tenantId);

  await db
    .update(users)
    .set({ failedLoginAttempts: 0, lockedUntil: null, lastLoginAt: new Date(), updatedAt: new Date() })
    .where(eq(users.id, userId));

  return issueTokensAndSession(
    db,
    config,
    { sub: String(userId), tenantId, email: user.email, roles: roleNames, permissions, branchIds },
    ctx
  );
}

const MFA_MAX_VERIFY_ATTEMPTS = 5;
const MFA_TOKEN_TTL_FALLBACK_SECONDS = 300; // matches MFA_TOKEN_TTL_SECONDS in login.ts

export async function mfaVerifyRoute(
  fastify: FastifyInstance,
  db: ErpDatabase,
  config: AuthConfig,
  redis: Redis
): Promise<void> {
  fastify.post('/auth/mfa/verify', {
    handler: async (request, reply) => {
      const body = VerifyBody.safeParse(request.body);
      if (!body.success) {
        return reply.code(400).send({ error: 'Invalid request' });
      }

      // tenantId travels as a prefix of the opaque mfaToken (set by login.ts) so the
      // Redis key can be tenant-scoped even though this request doesn't carry tenantId.
      const [tenantIdPrefix, ...tokenParts] = body.data.mfaToken.split('.');
      const tokenSecret = tokenParts.join('.');
      const tokenTenantId = Number(tenantIdPrefix);
      if (!Number.isInteger(tokenTenantId) || tokenTenantId <= 0 || !tokenSecret) {
        return reply.code(401).send({ error: 'Invalid or expired MFA token' });
      }

      const cache = new TenantScopedCache(redis, tokenTenantId);
      const key = `mfa:${tokenSecret}`;
      const attemptsKey = `mfa:attempts:${tokenSecret}`;
      const payload = await cache.getJson<MfaTokenPayload>(key);
      if (!payload || payload.tenantId !== tokenTenantId) {
        return reply.code(401).send({ error: 'Invalid or expired MFA token' });
      }

      const { userId, tenantId } = payload;
      const mfaService = new MFAService(db, config.fieldEncryptionKey);

      const validTotp = await mfaService.verifyTOTP(userId, body.data.code);
      const validBackup = validTotp ? false : await mfaService.useBackupCode(userId, body.data.code);

      if (!validTotp && !validBackup) {
        // Per-token attempt cap — independent of the global rate limiter. A wrong
        // guess no longer burns the token outright (so a mistyped code doesn't force
        // a fresh login), but the 5th wrong attempt invalidates it immediately.
        const attempts = await cache.incr(attemptsKey);
        if (attempts === 1) {
          const ttl = await cache.ttl(key);
          await cache.expire(attemptsKey, ttl > 0 ? ttl : MFA_TOKEN_TTL_FALLBACK_SECONDS);
        }
        if (attempts >= MFA_MAX_VERIFY_ATTEMPTS) {
          await cache.del(key);
          await cache.del(attemptsKey);
        }
        return reply.code(401).send({ error: 'Invalid TOTP or backup code' });
      }

      // Correct code — single-use token, clear both keys
      await cache.del(key);
      await cache.del(attemptsKey);

      const tokens = await issueTokensForUser(db, config, userId, tenantId, {
        ip: request.ip,
        userAgent: request.headers['user-agent'] ?? null,
      });

      return reply.code(200).send({ data: tokens });
    },
  });
}

// Protected MFA management routes — require `authenticate` preHandler (request.auth set)
export async function mfaManagementRoutes(fastify: FastifyInstance, db: ErpDatabase, config: AuthConfig): Promise<void> {
  const mfaService = new MFAService(db, config.fieldEncryptionKey);

  fastify.post('/mfa/enroll', {
    handler: async (request, reply) => {
      const { userId, tenantId } = request.auth;
      const result = await mfaService.enrollTOTP(userId, tenantId);
      return reply.code(200).send({ data: result });
    },
  });

  fastify.post('/mfa/confirm', {
    handler: async (request, reply) => {
      const body = ConfirmBody.safeParse(request.body);
      if (!body.success) return reply.code(400).send({ error: 'Invalid request' });

      const { userId, tenantId } = request.auth;
      await mfaService.confirmEnrollment(userId, body.data.code);
      await db.insert(securityAuditLog).values({
        tenantId,
        actorId: userId,
        action: 'MFA_ENABLED',
        ipAddress: inetParam(request.ip),
        details: {},
      });
      return reply.code(200).send({ message: '2FA enabled' });
    },
  });

  fastify.delete('/mfa', {
    handler: async (request, reply) => {
      const body = DisableBody.safeParse(request.body);
      if (!body.success) return reply.code(400).send({ error: 'Invalid request' });

      const { userId, tenantId } = request.auth;
      const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
      if (!user || !(await argon2.verify(user.passwordHash, body.data.password))) {
        return reply.code(401).send({ error: 'Invalid password' });
      }

      await mfaService.disableTOTP(userId, body.data.code);
      await db.insert(securityAuditLog).values({
        tenantId,
        actorId: userId,
        action: 'MFA_DISABLED',
        ipAddress: inetParam(request.ip),
        details: {},
      });
      return reply.code(200).send({ message: '2FA disabled' });
    },
  });

  fastify.post('/mfa/backup-codes/regenerate', {
    handler: async (request, reply) => {
      const body = RegenerateBackupCodesBody.safeParse(request.body);
      if (!body.success) return reply.code(400).send({ error: 'totpCode is required' });

      const { userId } = request.auth;
      const backupCodes = await mfaService.regenerateBackupCodes(userId, body.data.totpCode);
      return reply.code(200).send({ data: { backupCodes } });
    },
  });
}
