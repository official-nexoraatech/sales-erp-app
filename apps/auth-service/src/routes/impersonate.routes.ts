import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { eq, and } from 'drizzle-orm';
import { users, securityAuditLog } from '@erp/db';
import type { ErpDatabase } from '@erp/db';
import { PERMISSIONS, NotFoundError } from '@erp/types';
import { signAccessToken } from '../jwt.js';
import { requirePermission } from '../middleware/authorize.js';
import { loadUserRolesAndPermissions } from '../domain/roles.js';
import { inetParam } from '../db-helpers.js';

const ImpersonateBody = z.object({
  targetUserId: z.number().int().positive(),
  reason: z.string().min(1).max(500),
});

const IMPERSONATION_TOKEN_TTL_SECONDS = 3600; // 1 hour max, per ES-19 spec

export async function impersonateRoutes(fastify: FastifyInstance, db: ErpDatabase): Promise<void> {
  fastify.post('/admin/impersonate', {
    preHandler: [requirePermission(PERMISSIONS.IMPERSONATE_USER)],
    handler: async (request, reply) => {
      const body = ImpersonateBody.safeParse(request.body);
      if (!body.success) {
        return reply.code(400).send({ error: 'Invalid request', details: body.error.flatten() });
      }

      const { userId: actorId, tenantId, roles } = request.auth;
      const { targetUserId, reason } = body.data;

      const [targetUser] = await db
        .select()
        .from(users)
        .where(and(eq(users.id, targetUserId), eq(users.tenantId, tenantId)))
        .limit(1);

      if (!targetUser) throw new NotFoundError('User', targetUserId);

      // Impersonation token carries the TARGET user's own roles/permissions —
      // that's the point of impersonation (reproduce what they can see/do).
      const { roleNames, permissions, branchIds } = await loadUserRolesAndPermissions(db, targetUser.id, tenantId);

      const accessToken = await signAccessToken(
        {
          sub: String(targetUser.id),
          tenantId,
          email: targetUser.email,
          roles: roleNames,
          permissions,
          branchIds,
          impersonatedBy: actorId,
          isImpersonation: true,
        },
        IMPERSONATION_TOKEN_TTL_SECONDS
      );

      await db.insert(securityAuditLog).values({
        tenantId,
        actorId,
        actorRole: roles[0] ?? null,
        targetUserId,
        action: 'IMPERSONATION_START',
        ipAddress: inetParam(request.ip),
        details: { reason },
      });

      return reply.code(200).send({ data: { accessToken } });
    },
  });

  fastify.post('/admin/impersonate/end', {
    handler: async (request, reply) => {
      const { userId, tenantId, impersonatedBy, isImpersonation, roles } = request.auth;
      if (!isImpersonation || impersonatedBy === undefined) {
        return reply.code(400).send({ error: 'Current session is not an impersonation session' });
      }

      await db.insert(securityAuditLog).values({
        tenantId,
        actorId: impersonatedBy,
        actorRole: roles[0] ?? null,
        targetUserId: userId,
        action: 'IMPERSONATION_END',
        ipAddress: inetParam(request.ip),
        details: {},
      });

      return reply.code(200).send({ message: 'Impersonation session ended' });
    },
  });
}
