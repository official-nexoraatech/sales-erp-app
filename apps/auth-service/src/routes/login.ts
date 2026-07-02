import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import argon2 from 'argon2';
import { eq, and } from 'drizzle-orm';
import { users, userRoles, rolePermissions, refreshTokens } from '@erp/db';
import type { ErpDatabase } from '@erp/db';
import { signAccessToken } from '../jwt.js';
import { generateSecureToken, sha256Hex } from '../crypto.js';
import type { AuthConfig } from '../config.js';

const LoginBody = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  tenantId: z.number().int().positive(),
});

export async function loginRoute(fastify: FastifyInstance, db: ErpDatabase, config: AuthConfig): Promise<void> {
  fastify.post('/auth/login', {
    config: { rateLimit: { max: config.loginRateLimitMax, timeWindow: config.loginRateLimitWindowMs } },
    handler: async (request, reply) => {
      const body = LoginBody.safeParse(request.body);
      if (!body.success) {
        return reply.code(400).send({ error: 'Invalid request', details: body.error.flatten() });
      }

      const { email, password, tenantId } = body.data;

      const [user] = await db
        .select()
        .from(users)
        .where(and(eq(users.email, email), eq(users.tenantId, tenantId)))
        .limit(1);

      // Constant-time response to prevent user enumeration
      if (!user) {
        await argon2.hash('dummy-prevent-timing-attack', { type: argon2.argon2id });
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

        if (shouldLock) {
          return reply.code(429).send({
            error: 'Account locked due to too many failed attempts',
            retryAfterSeconds: Math.ceil(config.accountLockoutDurationMs / 1000),
          });
        }
        return reply.code(401).send({ error: 'Invalid credentials' });
      }

      // Load roles and permissions
      const userRoleRows = await db
        .select({ roleId: userRoles.roleId })
        .from(userRoles)
        .where(and(eq(userRoles.userId, user.id), eq(userRoles.tenantId, tenantId)));

      const roleIds = userRoleRows.map((r) => r.roleId);
      const roleNames: string[] = [];
      const permissionsSet = new Set<string>();

      if (roleIds.length > 0) {
        const permRows = await db
          .select({ permission: rolePermissions.permission })
          .from(rolePermissions)
          .where(eq(rolePermissions.tenantId, tenantId));
        permRows.forEach((r: { permission: string }) => permissionsSet.add(r.permission));
      }

      // Issue tokens
      const accessToken = await signAccessToken({
        sub: String(user.id),
        tenantId,
        email: user.email,
        roles: roleNames,
        permissions: Array.from(permissionsSet),
      });

      const plainRefreshToken = generateSecureToken(32);
      const tokenHash = sha256Hex(plainRefreshToken);
      const expiresAt = new Date(Date.now() + config.jwtRefreshTokenTtlDays * 24 * 60 * 60 * 1000);

      await db.insert(refreshTokens).values({
        userId: user.id,
        tenantId,
        tokenHash,
        expiresAt,
        userAgent: request.headers['user-agent'] ?? null,
        ipAddress: request.ip,
      });

      // Reset failed attempts and record last login
      await db
        .update(users)
        .set({ failedLoginAttempts: 0, lockedUntil: null, lastLoginAt: new Date(), updatedAt: new Date() })
        .where(eq(users.id, user.id));

      return reply.code(200).send({
        data: {
          accessToken,
          refreshToken: plainRefreshToken,
          expiresIn: config.jwtAccessTokenTtl,
          tokenType: 'Bearer',
        },
      });
    },
  });
}
