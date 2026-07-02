import type { FastifyInstance } from 'fastify';
import type { ErpDatabase } from '@erp/db';
import { roles, rolePermissions } from '@erp/db';
import { eq, and } from 'drizzle-orm';
import { z } from 'zod';
import { NotFoundError, ValidationError, PermissionError, BusinessError } from '@erp/types';
import type { Permission } from '@erp/types';
import { PERMISSIONS } from '@erp/types';
import { authenticate } from '../middleware/authenticate.js';
import { requirePermission } from '../middleware/authorize.js';

const CreateRoleSchema = z.object({
  name: z.string().min(2).max(100),
  description: z.string().max(500).optional(),
  permissions: z.array(z.string()).optional().default([]),
});

const UpdateRoleSchema = z.object({
  name: z.string().min(2).max(100).optional(),
  description: z.string().max(500).optional(),
});

const SetPermissionsSchema = z.object({
  permissions: z.array(z.string()).min(0),
});

export async function rolesRoutes(fastify: FastifyInstance, db: ErpDatabase): Promise<void> {
  // ── GET /roles — List roles for the tenant ───────────────────────────────
  fastify.get(
    '/roles',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.ROLE_VIEW)] },
    async (request, reply) => {
      const auth = (request as { auth: { tenantId: number } }).auth;
      const tenantId = auth.tenantId;

      const allRoles = await db.select().from(roles).where(eq(roles.tenantId, tenantId));

      // Attach permissions to each role
      const rolesWithPermissions = await Promise.all(
        allRoles.map(async (role) => {
          const perms = await db
            .select({ permission: rolePermissions.permission })
            .from(rolePermissions)
            .where(eq(rolePermissions.roleId, role.id));
          return { ...role, permissions: perms.map((p) => p.permission) };
        })
      );

      return reply.code(200).send({
        data: { content: rolesWithPermissions, totalElements: rolesWithPermissions.length },
      });
    }
  );

  // ── POST /roles — Create a custom role ───────────────────────────────────
  fastify.post(
    '/roles',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.ROLE_CREATE)] },
    async (request, reply) => {
      const auth = (request as { auth: { tenantId: number; userId: number } }).auth;
      const tenantId = auth.tenantId;

      const body = CreateRoleSchema.safeParse(request.body);
      if (!body.success) {
        throw new ValidationError(body.error.errors.map((e) => e.message).join('; '));
      }

      const [existing] = await db
        .select()
        .from(roles)
        .where(and(eq(roles.tenantId, tenantId), eq(roles.name, body.data.name)));

      if (existing) {
        throw new BusinessError('DUPLICATE_ROLE', `Role '${body.data.name}' already exists`);
      }

      const [role] = await db
        .insert(roles)
        .values({
          tenantId,
          name: body.data.name,
          description: body.data.description,
          isSystem: false,
        })
        .returning();

      if (!role) throw new Error('Failed to create role');

      if (body.data.permissions.length > 0) {
        const validPerms = Object.values(PERMISSIONS) as string[];
        const invalid = body.data.permissions.filter((p) => !validPerms.includes(p));
        if (invalid.length > 0) {
          throw new ValidationError(`Invalid permissions: ${invalid.join(', ')}`);
        }

        await db.insert(rolePermissions).values(
          body.data.permissions.map((p) => ({
            roleId: role.id,
            permission: p,
            tenantId,
          }))
        );
      }

      return reply.code(201).send({
        data: { ...role, permissions: body.data.permissions },
      });
    }
  );

  // ── PUT /roles/:id — Update role name/description ────────────────────────
  fastify.put<{ Params: { id: string } }>(
    '/roles/:id',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.ROLE_UPDATE)] },
    async (request, reply) => {
      const auth = (request as { auth: { tenantId: number } }).auth;
      const tenantId = auth.tenantId;
      const roleId = parseInt(request.params.id, 10);

      const [role] = await db
        .select()
        .from(roles)
        .where(and(eq(roles.id, roleId), eq(roles.tenantId, tenantId)));

      if (!role) throw new NotFoundError('Role', roleId);
      if (role.isSystem) throw new PermissionError(PERMISSIONS.ROLE_UPDATE);

      const body = UpdateRoleSchema.safeParse(request.body);
      if (!body.success) {
        throw new ValidationError(body.error.errors.map((e) => e.message).join('; '));
      }

      const [updated] = await db
        .update(roles)
        .set({
          name: body.data.name ?? role.name,
          description: body.data.description ?? role.description,
          updatedAt: new Date(),
        })
        .where(and(eq(roles.id, roleId), eq(roles.tenantId, tenantId)))
        .returning();

      return reply.code(200).send({ data: updated });
    }
  );

  // ── DELETE /roles/:id — Delete custom role ────────────────────────────────
  fastify.delete<{ Params: { id: string } }>(
    '/roles/:id',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.ROLE_DELETE)] },
    async (request, reply) => {
      const auth = (request as { auth: { tenantId: number } }).auth;
      const tenantId = auth.tenantId;
      const roleId = parseInt(request.params.id, 10);

      const [role] = await db
        .select()
        .from(roles)
        .where(and(eq(roles.id, roleId), eq(roles.tenantId, tenantId)));

      if (!role) throw new NotFoundError('Role', roleId);
      if (role.isSystem) throw new PermissionError(PERMISSIONS.ROLE_DELETE);

      await db
        .delete(rolePermissions)
        .where(and(eq(rolePermissions.roleId, roleId)));

      await db
        .delete(roles)
        .where(and(eq(roles.id, roleId), eq(roles.tenantId, tenantId)));

      return reply.code(204).send();
    }
  );

  // ── GET /roles/:id/permissions — Get permissions of a role ───────────────
  fastify.get<{ Params: { id: string } }>(
    '/roles/:id/permissions',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.ROLE_VIEW)] },
    async (request, reply) => {
      const auth = (request as { auth: { tenantId: number } }).auth;
      const tenantId = auth.tenantId;
      const roleId = parseInt(request.params.id, 10);

      const [role] = await db
        .select()
        .from(roles)
        .where(and(eq(roles.id, roleId), eq(roles.tenantId, tenantId)));

      if (!role) throw new NotFoundError('Role', roleId);

      const perms = await db
        .select({ permission: rolePermissions.permission })
        .from(rolePermissions)
        .where(eq(rolePermissions.roleId, roleId));

      return reply.code(200).send({
        data: { roleId, roleName: role.name, permissions: perms.map((p) => p.permission) },
      });
    }
  );

  // ── PUT /roles/:id/permissions — Replace all permissions of a role ────────
  fastify.put<{ Params: { id: string } }>(
    '/roles/:id/permissions',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.ROLE_ASSIGN_PERMISSION)] },
    async (request, reply) => {
      const auth = (request as { auth: { tenantId: number } }).auth;
      const tenantId = auth.tenantId;
      const roleId = parseInt(request.params.id, 10);

      const body = SetPermissionsSchema.safeParse(request.body);
      if (!body.success) {
        throw new ValidationError(body.error.errors.map((e) => e.message).join('; '));
      }

      const [role] = await db
        .select()
        .from(roles)
        .where(and(eq(roles.id, roleId), eq(roles.tenantId, tenantId)));

      if (!role) throw new NotFoundError('Role', roleId);

      const validPerms = Object.values(PERMISSIONS) as string[];
      const invalid = body.data.permissions.filter((p) => !validPerms.includes(p));
      if (invalid.length > 0) {
        throw new ValidationError(`Invalid permissions: ${invalid.join(', ')}`);
      }

      // Replace all permissions atomically
      await db.delete(rolePermissions).where(eq(rolePermissions.roleId, roleId));

      if (body.data.permissions.length > 0) {
        await db.insert(rolePermissions).values(
          body.data.permissions.map((p) => ({
            roleId,
            permission: p as Permission,
            tenantId,
          }))
        );
      }

      return reply.code(200).send({
        data: { roleId, permissions: body.data.permissions },
      });
    }
  );
}
