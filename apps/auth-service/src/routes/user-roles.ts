import type { FastifyInstance } from 'fastify';
import type { ErpDatabase } from '@erp/db';
import { users, roles, userRoles, rolePermissions } from '@erp/db';
import { eq, and, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { NotFoundError, ValidationError, BusinessError } from '@erp/types';
import { PERMISSIONS } from '@erp/types';
import { authenticate } from '../middleware/authenticate.js';
import { requirePermission } from '../middleware/authorize.js';

const AssignRolesSchema = z.object({
  roleIds: z.array(z.number().int().positive()).min(1),
});

export async function userRolesRoutes(fastify: FastifyInstance, db: ErpDatabase): Promise<void> {
  // ── GET /users/:id/roles — Get roles assigned to a user ─────────────────
  fastify.get<{ Params: { id: string } }>(
    '/users/:id/roles',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.USER_VIEW)] },
    async (request, reply) => {
      const auth = (request as { auth: { tenantId: number } }).auth;
      const tenantId = auth.tenantId;
      const userId = parseInt(request.params.id, 10);

      const [user] = await db
        .select({ id: users.id, email: users.email })
        .from(users)
        .where(and(eq(users.id, userId), eq(users.tenantId, tenantId)));

      if (!user) throw new NotFoundError('User', userId);

      const assignedRoles = await db
        .select({
          id: roles.id,
          name: roles.name,
          description: roles.description,
          isSystem: roles.isSystem,
        })
        .from(userRoles)
        .innerJoin(roles, eq(userRoles.roleId, roles.id))
        .where(and(eq(userRoles.userId, userId), eq(userRoles.tenantId, tenantId)));

      return reply.code(200).send({ data: { userId, roles: assignedRoles } });
    }
  );

  // ── PUT /users/:id/roles — Replace all roles for a user ─────────────────
  fastify.put<{ Params: { id: string } }>(
    '/users/:id/roles',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.ROLE_ASSIGN_USER)] },
    async (request, reply) => {
      const auth = (request as { auth: { tenantId: number } }).auth;
      const tenantId = auth.tenantId;
      const userId = parseInt(request.params.id, 10);

      const body = AssignRolesSchema.safeParse(request.body);
      if (!body.success) {
        throw new ValidationError(body.error.errors.map((e) => e.message).join('; '));
      }

      const [user] = await db
        .select({ id: users.id })
        .from(users)
        .where(and(eq(users.id, userId), eq(users.tenantId, tenantId)));

      if (!user) throw new NotFoundError('User', userId);

      // Validate all roleIds belong to this tenant
      const validRoles = await db
        .select({ id: roles.id })
        .from(roles)
        .where(and(eq(roles.tenantId, tenantId), inArray(roles.id, body.data.roleIds)));

      if (validRoles.length !== body.data.roleIds.length) {
        throw new BusinessError('INVALID_ROLE', 'One or more role IDs are invalid for this tenant');
      }

      // Replace atomically
      await db.delete(userRoles).where(and(eq(userRoles.userId, userId), eq(userRoles.tenantId, tenantId)));

      await db.insert(userRoles).values(
        body.data.roleIds.map((roleId) => ({ userId, roleId, tenantId }))
      );

      return reply.code(200).send({ data: { userId, roleIds: body.data.roleIds } });
    }
  );

  // ── GET /users/:id/permissions — Compute effective permissions ───────────
  fastify.get<{ Params: { id: string } }>(
    '/users/:id/permissions',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.USER_VIEW)] },
    async (request, reply) => {
      const auth = (request as { auth: { tenantId: number } }).auth;
      const tenantId = auth.tenantId;
      const userId = parseInt(request.params.id, 10);

      const userRoleRows = await db
        .select({ roleId: userRoles.roleId })
        .from(userRoles)
        .where(and(eq(userRoles.userId, userId), eq(userRoles.tenantId, tenantId)));

      if (userRoleRows.length === 0) {
        return reply.code(200).send({ data: { userId, permissions: [] } });
      }

      const roleIds = userRoleRows.map((r) => r.roleId);
      const perms = await db
        .select({ permission: rolePermissions.permission })
        .from(rolePermissions)
        .where(inArray(rolePermissions.roleId, roleIds));

      const uniquePerms = [...new Set(perms.map((p) => p.permission))];

      return reply.code(200).send({ data: { userId, permissions: uniquePerms } });
    }
  );
}
