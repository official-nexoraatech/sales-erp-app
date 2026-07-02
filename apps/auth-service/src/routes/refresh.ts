import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { eq, and, isNull } from 'drizzle-orm';
import { users, userRoles, rolePermissions, refreshTokens } from '@erp/db';
import type { ErpDatabase } from '@erp/db';
import { signAccessToken } from '../jwt.js';
import { generateSecureToken, sha256Hex } from '../crypto.js';
import type { AuthConfig } from '../config.js';

const RefreshBody = z.object({
  refreshToken: z.string().min(1),
});

export async function refreshRoute(fastify: FastifyInstance, db: ErpDatabase, config: AuthConfig): Promise<void> {
  fastify.post('/auth/refresh', {
    handler: async (request, reply) => {
      const body = RefreshBody.safeParse(request.body);
      if (!body.success) {
        return reply.code(400).send({ error: 'Invalid request' });
      }

      const tokenHash = sha256Hex(body.data.refreshToken);
      const now = new Date();

      const [tokenRow] = await db
        .select()
        .from(refreshTokens)
        .where(
          and(eq(refreshTokens.tokenHash, tokenHash), isNull(refreshTokens.revokedAt))
        )
        .limit(1);

      if (!tokenRow || tokenRow.expiresAt < now) {
        return reply.code(401).send({ error: 'Invalid or expired refresh token' });
      }

      const [user] = await db
        .select()
        .from(users)
        .where(and(eq(users.id, tokenRow.userId), eq(users.isActive, true)))
        .limit(1);

      if (!user) {
        return reply.code(401).send({ error: 'User not found or inactive' });
      }

      // Rotate refresh token — revoke old, issue new
      await db
        .update(refreshTokens)
        .set({ revokedAt: now })
        .where(eq(refreshTokens.id, tokenRow.id));

      // Reload permissions
      const permissionsSet = new Set<string>();
      const userRoleRows = await db
        .select({ roleId: userRoles.roleId })
        .from(userRoles)
        .where(and(eq(userRoles.userId, user.id), eq(userRoles.tenantId, tokenRow.tenantId)));

      if (userRoleRows.length > 0) {
        const permRows = await db
          .select({ permission: rolePermissions.permission })
          .from(rolePermissions)
          .where(eq(rolePermissions.tenantId, tokenRow.tenantId));
        permRows.forEach((r: { permission: string }) => permissionsSet.add(r.permission));
      }

      const accessToken = await signAccessToken({
        sub: String(user.id),
        tenantId: tokenRow.tenantId,
        email: user.email,
        roles: [],
        permissions: Array.from(permissionsSet),
      });

      const plainRefreshToken = generateSecureToken(32);
      const newTokenHash = sha256Hex(plainRefreshToken);
      const expiresAt = new Date(Date.now() + config.jwtRefreshTokenTtlDays * 24 * 60 * 60 * 1000);

      await db.insert(refreshTokens).values({
        userId: user.id,
        tenantId: tokenRow.tenantId,
        tokenHash: newTokenHash,
        expiresAt,
        userAgent: request.headers['user-agent'] ?? null,
        ipAddress: request.ip,
      });

      return reply.code(200).send({
        accessToken,
        refreshToken: plainRefreshToken,
        expiresIn: config.jwtAccessTokenTtl,
        tokenType: 'Bearer',
      });
    },
  });
}
