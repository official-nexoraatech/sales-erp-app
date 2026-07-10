import type { FastifyInstance } from 'fastify';
import { roles, rolePermissions } from '@erp/db';
import { eq, and } from 'drizzle-orm';
import { z } from 'zod';
import { NotFoundError, ValidationError, PermissionError, BusinessError } from '@erp/types';
import type { Permission } from '@erp/types';
import { PERMISSIONS } from '@erp/types';
import type { PlatformContextFactory } from '@erp/sdk';
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

export async function rolesRoutes(fastify: FastifyInstance, ctxFactory: PlatformContextFactory): Promise<void> {
  function ctxFor(request: unknown): ReturnType<PlatformContextFactory['create']> {
    const auth = (request as { auth: { tenantId: number; userId?: number } }).auth;
    const correlationId = ((request as { headers?: Record<string, unknown> }).headers?.['x-correlation-id'] as string | undefined) ?? crypto.randomUUID();
    return ctxFactory.create({ tenantId: auth.tenantId, userId: auth.userId ?? 0, correlationId });
  }

  // ── GET /roles — List roles for the tenant ───────────────────────────────
  fastify.get(
    '/roles',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.ROLE_VIEW)] },
    async (request, reply) => {
      const auth = (request as { auth: { tenantId: number } }).auth;
      const tenantId = auth.tenantId;
      const ctx = ctxFor(request);

      const allRoles = await ctx.db.raw.select().from(roles).where(eq(roles.tenantId, tenantId));

      // Attach permissions to each role
      const rolesWithPermissions = await Promise.all(
        allRoles.map(async (role) => {
          const perms = await ctx.db.raw
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
      const ctx = ctxFor(request);

      const body = CreateRoleSchema.safeParse(request.body);
      if (!body.success) {
        throw new ValidationError(body.error.errors.map((e) => e.message).join('; '));
      }

      const [existing] = await ctx.db.raw
        .select()
        .from(roles)
        .where(and(eq(roles.tenantId, tenantId), eq(roles.name, body.data.name)));

      if (existing) {
        throw new BusinessError('DUPLICATE_ROLE', `Role '${body.data.name}' already exists`);
      }

      const [role] = await ctx.db.raw
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

        await ctx.db.raw.insert(rolePermissions).values(
          body.data.permissions.map((p) => ({
            roleId: role.id,
            permission: p,
            tenantId,
          }))
        );
      }

      await ctx.events.publish('role', role.id, 'ROLE_CREATED', { ...role, permissions: body.data.permissions } as unknown as Record<string, unknown>);

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
      const ctx = ctxFor(request);
      const roleId = parseInt(request.params.id, 10);

      const [role] = await ctx.db.raw
        .select()
        .from(roles)
        .where(and(eq(roles.id, roleId), eq(roles.tenantId, tenantId)));

      if (!role) throw new NotFoundError('Role', roleId);
      if (role.isSystem) throw new PermissionError(PERMISSIONS.ROLE_UPDATE);

      const body = UpdateRoleSchema.safeParse(request.body);
      if (!body.success) {
        throw new ValidationError(body.error.errors.map((e) => e.message).join('; '));
      }

      const [updated] = await ctx.db.raw
        .update(roles)
        .set({
          name: body.data.name ?? role.name,
          description: body.data.description ?? role.description,
          updatedAt: new Date(),
        })
        .where(and(eq(roles.id, roleId), eq(roles.tenantId, tenantId)))
        .returning();

      if (updated) {
        await ctx.events.publish('role', roleId, 'ROLE_UPDATED', updated as unknown as Record<string, unknown>);
      }

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
      const ctx = ctxFor(request);
      const roleId = parseInt(request.params.id, 10);

      const [role] = await ctx.db.raw
        .select()
        .from(roles)
        .where(and(eq(roles.id, roleId), eq(roles.tenantId, tenantId)));

      if (!role) throw new NotFoundError('Role', roleId);
      if (role.isSystem) throw new PermissionError(PERMISSIONS.ROLE_DELETE);

      await ctx.db.raw
        .delete(rolePermissions)
        .where(and(eq(rolePermissions.roleId, roleId)));

      await ctx.db.raw
        .delete(roles)
        .where(and(eq(roles.id, roleId), eq(roles.tenantId, tenantId)));

      await ctx.events.publish('role', roleId, 'ROLE_DELETED', { id: roleId });

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
      const ctx = ctxFor(request);
      const roleId = parseInt(request.params.id, 10);

      const [role] = await ctx.db.raw
        .select()
        .from(roles)
        .where(and(eq(roles.id, roleId), eq(roles.tenantId, tenantId)));

      if (!role) throw new NotFoundError('Role', roleId);

      const perms = await ctx.db.raw
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
      const ctx = ctxFor(request);
      const roleId = parseInt(request.params.id, 10);

      const body = SetPermissionsSchema.safeParse(request.body);
      if (!body.success) {
        throw new ValidationError(body.error.errors.map((e) => e.message).join('; '));
      }

      const [role] = await ctx.db.raw
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
      await ctx.db.raw.delete(rolePermissions).where(eq(rolePermissions.roleId, roleId));

      if (body.data.permissions.length > 0) {
        await ctx.db.raw.insert(rolePermissions).values(
          body.data.permissions.map((p) => ({
            roleId,
            permission: p as Permission,
            tenantId,
          }))
        );
      }

      await ctx.events.publish('role', roleId, 'ROLE_UPDATED', { id: roleId, permissions: body.data.permissions });

      return reply.code(200).send({
        data: { roleId, permissions: body.data.permissions },
      });
    }
  );
}
