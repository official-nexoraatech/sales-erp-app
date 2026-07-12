import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { and, eq, gt, ilike, isNull, lte, or, sql, type SQL } from 'drizzle-orm';
import { users, tenants, refreshTokens, securityAuditLog } from '@erp/db';
import type { ErpDatabase } from '@erp/db';
import * as argon2 from 'argon2';
import { PERMISSIONS, ERPError, NotFoundError, ValidationError } from '@erp/types';
import { requirePermission } from '../middleware/authorize.js';
import { inetParam } from '../db-helpers.js';
import { sanitizeUser } from './users.js';

const ResetAnyUserPasswordSchema = z.object({
  currentPassword: z
    .string()
    .min(1, "Your current password is required to reset another tenant's user"),
  newPassword: z.string().min(12, 'Password must be at least 12 characters'),
});

// Cross-tenant user management for PLATFORM_OPERATOR accounts — e.g. resetting a user's
// password in a tenant the operator does not themselves belong to. Every ordinary
// USER_MANAGE-guarded route in users.ts is deliberately scoped to the caller's own
// request.auth.tenantId; these routes take the target tenantId explicitly instead,
// mirroring tenant-service's /admin/tenants/:id/* pattern.
export async function adminUsersRoutes(fastify: FastifyInstance, db: ErpDatabase): Promise<void> {
  fastify.get<{ Params: { tenantId: string } }>(
    '/admin/tenants/:tenantId/users',
    { preHandler: [requirePermission(PERMISSIONS.PLATFORM_TENANT_MANAGE)] },
    async (request, reply) => {
      const tenantId = parseInt(request.params.tenantId, 10);
      const query = request.query as {
        page?: string;
        size?: string;
        search?: string;
        status?: string;
      };

      const [tenant] = await db.select().from(tenants).where(eq(tenants.id, tenantId));
      if (!tenant) throw new NotFoundError('Tenant', tenantId);

      const page = Math.max(0, parseInt(query.page ?? '0', 10));
      const size = Math.min(100, parseInt(query.size ?? '20', 10));

      let whereClause: SQL | undefined = eq(users.tenantId, tenantId);
      if (query.search) {
        whereClause = and(
          whereClause,
          or(
            ilike(users.firstName, `%${query.search}%`),
            ilike(users.lastName, `%${query.search}%`),
            ilike(users.email, `%${query.search}%`)
          )
        );
      }
      const now = new Date();
      if (query.status === 'active') {
        whereClause = and(
          whereClause,
          eq(users.isActive, true),
          or(isNull(users.lockedUntil), lte(users.lockedUntil, now))
        );
      } else if (query.status === 'inactive') {
        whereClause = and(whereClause, eq(users.isActive, false));
      } else if (query.status === 'locked') {
        whereClause = and(whereClause, gt(users.lockedUntil, now));
      }

      const tenantUsers = await db
        .select()
        .from(users)
        .where(whereClause)
        .limit(size)
        .offset(page * size);
      const [countRow] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(users)
        .where(whereClause);
      const safe = tenantUsers.map(sanitizeUser);
      return reply
        .code(200)
        .send({ data: { content: safe, totalElements: countRow?.count ?? 0, page, size } });
    }
  );

  fastify.post<{ Params: { tenantId: string; userId: string } }>(
    '/admin/tenants/:tenantId/users/:userId/reset-password',
    { preHandler: [requirePermission(PERMISSIONS.PLATFORM_TENANT_MANAGE)] },
    async (request, reply) => {
      const targetTenantId = parseInt(request.params.tenantId, 10);
      const targetUserId = parseInt(request.params.userId, 10);
      const { userId: operatorId, tenantId: operatorTenantId, roles: operatorRoles } = request.auth;

      const body = ResetAnyUserPasswordSchema.safeParse(request.body);
      if (!body.success)
        throw new ValidationError(body.error.errors.map((e) => e.message).join('; '));

      const [tenant] = await db.select().from(tenants).where(eq(tenants.id, targetTenantId));
      if (!tenant) throw new NotFoundError('Tenant', targetTenantId);

      // Re-auth: the operator must prove their own identity with their own current
      // password before resetting a user in another tenant — same rationale as the
      // same-tenant admin reset-password route (users.ts): a stolen/reused access token
      // alone shouldn't be enough to take over any account on the entire platform.
      const [operator] = await db
        .select()
        .from(users)
        .where(and(eq(users.id, operatorId), eq(users.tenantId, operatorTenantId)));
      if (!operator) throw new NotFoundError('User', operatorId);
      const operatorPasswordValid = await argon2.verify(
        operator.passwordHash,
        body.data.currentPassword
      );
      if (!operatorPasswordValid) {
        throw new ERPError('INVALID_CURRENT_PASSWORD', 'Your current password is incorrect', 401);
      }

      const [targetUser] = await db
        .select()
        .from(users)
        .where(and(eq(users.id, targetUserId), eq(users.tenantId, targetTenantId)));
      if (!targetUser) throw new NotFoundError('User', targetUserId);

      const passwordHash = await argon2.hash(body.data.newPassword, { type: argon2.argon2id });
      const now = new Date();

      await db
        .update(users)
        .set({ passwordHash, failedLoginAttempts: 0, lockedUntil: null, updatedAt: now })
        .where(eq(users.id, targetUserId));

      await db
        .update(refreshTokens)
        .set({ revokedAt: now })
        .where(and(eq(refreshTokens.userId, targetUserId), isNull(refreshTokens.revokedAt)));

      await db.insert(securityAuditLog).values({
        tenantId: targetTenantId,
        actorId: operatorId,
        actorRole: operatorRoles[0] ?? null,
        targetUserId,
        action: 'ADMIN_PASSWORD_RESET',
        ipAddress: inetParam(request.ip),
        details: { operatorTenantId },
      });

      return reply
        .code(200)
        .send({ data: { message: 'Password reset successfully', userId: targetUserId } });
    }
  );
}
