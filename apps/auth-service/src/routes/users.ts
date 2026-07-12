import type { FastifyInstance } from 'fastify';
import type { User } from '@erp/db';
import { users, roles, userRoles, userBranches, rolePermissions } from '@erp/db';
import { and, eq, ne, inArray } from 'drizzle-orm';
import { z } from 'zod';
import * as argon2 from 'argon2';
import {
  BusinessError,
  ERPError,
  NotFoundError,
  PermissionError,
  ValidationError,
} from '@erp/types';
import { PERMISSIONS } from '@erp/types';
import type { PlatformContextFactory } from '@erp/sdk';
import { authenticate } from '../middleware/authenticate.js';
import { requirePermission } from '../middleware/authorize.js';

// Strips fields that must never leave auth-service: password hash, encrypted
// TOTP secret ciphertext, and hashed backup codes.
export function sanitizeUser(
  user: User
): Omit<User, 'passwordHash' | 'totpSecret' | 'backupCodes'> {
  const sanitized: Record<string, unknown> = { ...user };
  delete sanitized['passwordHash'];
  delete sanitized['totpSecret'];
  delete sanitized['backupCodes'];
  return sanitized as Omit<User, 'passwordHash' | 'totpSecret' | 'backupCodes'>;
}

const CreateUserSchema = z.object({
  email: z.string().email().max(255),
  password: z.string().min(12, 'Password must be at least 12 characters'),
  firstName: z.string().min(1).max(100),
  lastName: z.string().min(1).max(100),
  phone: z.string().max(20).optional(),
  roleIds: z.array(z.number().int().positive()).min(1, 'At least one role is required'),
  branchIds: z.array(z.number().int().positive()).default([]),
  primaryBranchId: z.number().int().positive().optional(),
  isActive: z.boolean().default(true),
});

const UpdateUserSchema = z.object({
  firstName: z.string().min(1).max(100).optional(),
  lastName: z.string().min(1).max(100).optional(),
  phone: z.string().max(20).optional(),
  isActive: z.boolean().optional(),
});

const UpdateMeSchema = z.object({
  firstName: z.string().min(1).max(100).optional(),
  lastName: z.string().min(1).max(100).optional(),
  phone: z.string().max(20).optional(),
});

const ChangePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(12, 'New password must be at least 12 characters'),
});

const ResetPasswordSchema = z.object({
  currentPassword: z
    .string()
    .min(1, "Admin's current password is required to reset another user's password"),
  newPassword: z.string().min(12, 'Password must be at least 12 characters'),
});

type AuthedRequest = { auth: { tenantId: number; userId: number; permissions: string[] } };

export async function userRoutes(
  fastify: FastifyInstance,
  ctxFactory: PlatformContextFactory
): Promise<void> {
  function ctxFor(request: unknown): ReturnType<PlatformContextFactory['create']> {
    const { tenantId, userId } = (request as unknown as AuthedRequest).auth;
    const correlationId =
      ((request as { headers?: Record<string, unknown> }).headers?.['x-correlation-id'] as
        string | undefined) ?? crypto.randomUUID();
    return ctxFactory.create({ tenantId, userId, correlationId });
  }

  // ── GET /users — List all users ─────────────────────────────────────────
  fastify.get(
    '/users',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.USER_VIEW)] },
    async (request, reply) => {
      const { tenantId } = (request as unknown as AuthedRequest).auth;
      const ctx = ctxFor(request);

      const allUsers = await ctx.db.raw.select().from(users).where(eq(users.tenantId, tenantId));
      const safe = allUsers.map(sanitizeUser);
      return reply.code(200).send({ data: { content: safe, totalElements: safe.length } });
    }
  );

  // ── GET /users/:id — Get user ──────────────────────────────────────────
  fastify.get<{ Params: { id: string } }>(
    '/users/:id',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.USER_VIEW)] },
    async (request, reply) => {
      const { tenantId } = (request as unknown as AuthedRequest).auth;
      const ctx = ctxFor(request);
      const id = parseInt(request.params.id, 10);

      const [user] = await ctx.db.raw
        .select()
        .from(users)
        .where(and(eq(users.id, id), eq(users.tenantId, tenantId)));
      if (!user) throw new NotFoundError('User', id);

      const userRoleRows = await ctx.db.raw
        .select()
        .from(userRoles)
        .where(eq(userRoles.userId, id));
      const branchRows = await ctx.db.raw
        .select()
        .from(userBranches)
        .where(eq(userBranches.userId, id));
      const safeUser = sanitizeUser(user);

      return reply.code(200).send({
        data: { ...safeUser, roleIds: userRoleRows.map((r) => r.roleId), branches: branchRows },
      });
    }
  );

  // ── POST /users — Create user ─────────────────────────────────────────
  fastify.post(
    '/users',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.USER_CREATE)] },
    async (request, reply) => {
      const {
        tenantId,
        userId,
        permissions: callerPermissions,
      } = (request as unknown as AuthedRequest).auth;
      const ctx = ctxFor(request);

      const body = CreateUserSchema.safeParse(request.body);
      if (!body.success)
        throw new ValidationError(body.error.errors.map((e) => e.message).join('; '));

      // Unique email per tenant
      const [existing] = await ctx.db.raw
        .select()
        .from(users)
        .where(and(eq(users.email, body.data.email), eq(users.tenantId, tenantId)));
      if (existing)
        throw new BusinessError(
          'DUPLICATE_EMAIL',
          'A user with this email already exists in this tenant'
        );

      // Roles must belong to this tenant, and the caller cannot grant a permission
      // they don't themselves hold — prevents self-escalation via arbitrary roleIds.
      const targetRoles = await ctx.db.raw
        .select({ id: roles.id })
        .from(roles)
        .where(and(eq(roles.tenantId, tenantId), inArray(roles.id, body.data.roleIds)));
      if (targetRoles.length !== body.data.roleIds.length) {
        throw new BusinessError('INVALID_ROLE', 'One or more role IDs are invalid for this tenant');
      }

      const grantedPerms = await ctx.db.raw
        .select({ permission: rolePermissions.permission })
        .from(rolePermissions)
        .where(inArray(rolePermissions.roleId, body.data.roleIds));
      const disallowed = grantedPerms.find((p) => !callerPermissions.includes(p.permission));
      if (disallowed) throw new PermissionError(disallowed.permission);

      const passwordHash = await argon2.hash(body.data.password, { type: argon2.argon2id });

      const [newUser] = await ctx.db.raw
        .insert(users)
        .values({
          tenantId,
          email: body.data.email,
          passwordHash,
          firstName: body.data.firstName,
          lastName: body.data.lastName,
          phone: body.data.phone,
          isActive: body.data.isActive,
        })
        .returning();
      if (!newUser) throw new Error('User insert failed unexpectedly');

      // Assign roles
      if (body.data.roleIds.length > 0) {
        await ctx.db.raw.insert(userRoles).values(
          body.data.roleIds.map((roleId) => ({
            userId: newUser.id,
            roleId,
            tenantId,
          }))
        );
      }

      // Assign branches
      if (body.data.branchIds.length > 0) {
        await ctx.db.raw.insert(userBranches).values(
          body.data.branchIds.map((branchId) => ({
            userId: newUser.id,
            branchId,
            tenantId,
            isPrimary: branchId === body.data.primaryBranchId,
          }))
        );
      }

      const safeUser = sanitizeUser(newUser);
      await ctx.events.publish(
        'user',
        newUser.id,
        'USER_CREATED',
        safeUser as unknown as Record<string, unknown>
      );
      return reply.code(201).send({ data: { ...safeUser, createdBy: userId } });
    }
  );

  // ── PUT /users/:id — Update user ──────────────────────────────────────
  fastify.put<{ Params: { id: string } }>(
    '/users/:id',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.USER_UPDATE)] },
    async (request, reply) => {
      const { tenantId } = (request as unknown as AuthedRequest).auth;
      const ctx = ctxFor(request);
      const id = parseInt(request.params.id, 10);

      const body = UpdateUserSchema.safeParse(request.body);
      if (!body.success)
        throw new ValidationError(body.error.errors.map((e) => e.message).join('; '));

      const [existing] = await ctx.db.raw
        .select()
        .from(users)
        .where(and(eq(users.id, id), eq(users.tenantId, tenantId)));
      if (!existing) throw new NotFoundError('User', id);

      const [updated] = await ctx.db.raw
        .update(users)
        .set({ ...body.data, updatedAt: new Date() })
        .where(eq(users.id, id))
        .returning();
      if (!updated) throw new Error('User update failed unexpectedly');

      const safeUser = sanitizeUser(updated);
      await ctx.events.publish(
        'user',
        id,
        'USER_UPDATED',
        safeUser as unknown as Record<string, unknown>
      );
      return reply.code(200).send({ data: safeUser });
    }
  );

  // ── DELETE /users/:id — Soft delete (mark inactive, cannot delete last OWNER) ──
  fastify.delete<{ Params: { id: string } }>(
    '/users/:id',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.USER_DELETE)] },
    async (request, reply) => {
      const { tenantId } = (request as unknown as AuthedRequest).auth;
      const ctx = ctxFor(request);
      const id = parseInt(request.params.id, 10);

      const [existing] = await ctx.db.raw
        .select()
        .from(users)
        .where(and(eq(users.id, id), eq(users.tenantId, tenantId)));
      if (!existing) throw new NotFoundError('User', id);

      // Check if this is the last OWNER
      const ownerRole = await ctx.db.raw
        .select()
        .from(roles)
        .where(and(eq(roles.tenantId, tenantId), eq(roles.name, 'OWNER')));
      if (ownerRole.length > 0) {
        const ownerUserRole = await ctx.db.raw
          .select()
          .from(userRoles)
          .where(and(eq(userRoles.roleId, ownerRole[0]!.id), eq(userRoles.userId, id)));
        if (ownerUserRole.length > 0) {
          const otherOwners = await ctx.db.raw
            .select()
            .from(userRoles)
            .where(and(eq(userRoles.roleId, ownerRole[0]!.id), ne(userRoles.userId, id)));
          if (otherOwners.length === 0) {
            throw new BusinessError(
              'CANNOT_DELETE_LAST_OWNER',
              'Cannot delete the last user with OWNER role'
            );
          }
        }
      }

      await ctx.db.raw
        .update(users)
        .set({ isActive: false, updatedAt: new Date() })
        .where(eq(users.id, id));
      await ctx.events.publish('user', id, 'USER_DEACTIVATED', { id });
      return reply.code(200).send({ data: { message: 'User deactivated', id } });
    }
  );

  // ── POST /users/:id/reset-password — Admin resets ANOTHER user's password ──
  // (self-service "forgot password" is the separate, unauthenticated
  // forgot-password.ts / reset-password.ts email-token flow — untouched)
  fastify.post<{ Params: { id: string } }>(
    '/users/:id/reset-password',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.USER_MANAGE)] },
    async (request, reply) => {
      const { tenantId, userId: callerId } = (request as unknown as AuthedRequest).auth;
      const ctx = ctxFor(request);
      const id = parseInt(request.params.id, 10);

      const body = ResetPasswordSchema.safeParse(request.body);
      if (!body.success)
        throw new ValidationError(body.error.errors.map((e) => e.message).join('; '));

      // Re-auth: the caller must prove their own identity with their own current
      // password before they can reset someone else's — mitigates a stolen/reused
      // access token being enough on its own to take over any account in the tenant.
      const [caller] = await ctx.db.raw
        .select()
        .from(users)
        .where(and(eq(users.id, callerId), eq(users.tenantId, tenantId)));
      if (!caller) throw new NotFoundError('User', callerId);
      const callerPasswordValid = await argon2.verify(
        caller.passwordHash,
        body.data.currentPassword
      );
      if (!callerPasswordValid) {
        throw new ERPError('INVALID_CURRENT_PASSWORD', 'Your current password is incorrect', 401);
      }

      const [existing] = await ctx.db.raw
        .select()
        .from(users)
        .where(and(eq(users.id, id), eq(users.tenantId, tenantId)));
      if (!existing) throw new NotFoundError('User', id);

      const passwordHash = await argon2.hash(body.data.newPassword, { type: argon2.argon2id });
      await ctx.db.raw
        .update(users)
        .set({ passwordHash, failedLoginAttempts: 0, lockedUntil: null, updatedAt: new Date() })
        .where(eq(users.id, id));

      return reply.code(200).send({ data: { message: 'Password reset successfully' } });
    }
  );

  // ── POST /users/:id/lock ───────────────────────────────────────────────
  fastify.post<{ Params: { id: string } }>(
    '/users/:id/lock',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.USER_MANAGE)] },
    async (request, reply) => {
      const { tenantId, userId: callerId } = (request as unknown as AuthedRequest).auth;
      const ctx = ctxFor(request);
      const id = parseInt(request.params.id, 10);
      if (id === callerId)
        throw new BusinessError('CANNOT_LOCK_SELF', 'You cannot lock your own account');

      const [existing] = await ctx.db.raw
        .select()
        .from(users)
        .where(and(eq(users.id, id), eq(users.tenantId, tenantId)));
      if (!existing) throw new NotFoundError('User', id);

      // Same last-OWNER protection as DELETE /users/:id — a locked-out sole OWNER
      // is just as unrecoverable as a deleted one.
      const ownerRole = await ctx.db.raw
        .select()
        .from(roles)
        .where(and(eq(roles.tenantId, tenantId), eq(roles.name, 'OWNER')));
      if (ownerRole.length > 0) {
        const ownerUserRole = await ctx.db.raw
          .select()
          .from(userRoles)
          .where(and(eq(userRoles.roleId, ownerRole[0]!.id), eq(userRoles.userId, id)));
        if (ownerUserRole.length > 0) {
          const otherOwners = await ctx.db.raw
            .select()
            .from(userRoles)
            .where(and(eq(userRoles.roleId, ownerRole[0]!.id), ne(userRoles.userId, id)));
          if (otherOwners.length === 0) {
            throw new BusinessError(
              'CANNOT_LOCK_LAST_OWNER',
              'Cannot lock the last user with OWNER role'
            );
          }
        }
      }

      const lockUntil = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000); // 1 year = manual lock
      await ctx.db.raw
        .update(users)
        .set({ lockedUntil: lockUntil, updatedAt: new Date() })
        .where(eq(users.id, id));
      return reply.code(200).send({ data: { message: 'User locked', id } });
    }
  );

  // ── POST /users/:id/unlock ────────────────────────────────────────────
  fastify.post<{ Params: { id: string } }>(
    '/users/:id/unlock',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.USER_MANAGE)] },
    async (request, reply) => {
      const { tenantId } = (request as unknown as AuthedRequest).auth;
      const ctx = ctxFor(request);
      const id = parseInt(request.params.id, 10);
      const [existing] = await ctx.db.raw
        .select()
        .from(users)
        .where(and(eq(users.id, id), eq(users.tenantId, tenantId)));
      if (!existing) throw new NotFoundError('User', id);
      await ctx.db.raw
        .update(users)
        .set({ lockedUntil: null, failedLoginAttempts: 0, updatedAt: new Date() })
        .where(eq(users.id, id));
      return reply.code(200).send({ data: { message: 'User unlocked', id } });
    }
  );

  // ── PUT /users/:id/branches — Assign branch access ───────────────────
  fastify.put<{ Params: { id: string } }>(
    '/users/:id/branches',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.USER_MANAGE)] },
    async (request, reply) => {
      const { tenantId } = (request as unknown as AuthedRequest).auth;
      const ctx = ctxFor(request);
      const id = parseInt(request.params.id, 10);
      const BranchAssignSchema = z.object({
        branchIds: z.array(z.number().int().positive()),
        primaryBranchId: z.number().int().positive().optional(),
      });
      const body = BranchAssignSchema.safeParse(request.body);
      if (!body.success)
        throw new ValidationError(body.error.errors.map((e) => e.message).join('; '));
      const [existing] = await ctx.db.raw
        .select()
        .from(users)
        .where(and(eq(users.id, id), eq(users.tenantId, tenantId)));
      if (!existing) throw new NotFoundError('User', id);
      // Replace branch assignments
      await ctx.db.raw
        .delete(userBranches)
        .where(and(eq(userBranches.userId, id), eq(userBranches.tenantId, tenantId)));
      if (body.data.branchIds.length > 0) {
        await ctx.db.raw.insert(userBranches).values(
          body.data.branchIds.map((branchId) => ({
            userId: id,
            branchId,
            tenantId,
            isPrimary: branchId === body.data.primaryBranchId,
          }))
        );
      }
      return reply.code(200).send({ data: { message: 'Branch access updated', userId: id } });
    }
  );

  // ── GET /users/me — Current user profile ─────────────────────────────
  fastify.get('/users/me', async (request, reply) => {
    const { tenantId, userId } = (request as unknown as AuthedRequest).auth;
    const ctx = ctxFor(request);
    const [user] = await ctx.db.raw
      .select()
      .from(users)
      .where(and(eq(users.id, userId), eq(users.tenantId, tenantId)));
    if (!user) throw new NotFoundError('User', userId);
    const userRoleRows = await ctx.db.raw
      .select()
      .from(userRoles)
      .where(eq(userRoles.userId, userId));
    const branchRows = await ctx.db.raw
      .select()
      .from(userBranches)
      .where(eq(userBranches.userId, userId));
    const safeUser = sanitizeUser(user);
    return reply.code(200).send({
      data: { ...safeUser, roleIds: userRoleRows.map((r) => r.roleId), branches: branchRows },
    });
  });

  // ── PUT /users/me — Update my profile ────────────────────────────────
  fastify.put('/users/me', async (request, reply) => {
    const { tenantId, userId } = (request as unknown as AuthedRequest).auth;
    const ctx = ctxFor(request);
    const body = UpdateMeSchema.safeParse(request.body);
    if (!body.success)
      throw new ValidationError(body.error.errors.map((e) => e.message).join('; '));
    const [existing] = await ctx.db.raw
      .select()
      .from(users)
      .where(and(eq(users.id, userId), eq(users.tenantId, tenantId)));
    if (!existing) throw new NotFoundError('User', userId);
    const [updated] = await ctx.db.raw
      .update(users)
      .set({ ...body.data, updatedAt: new Date() })
      .where(eq(users.id, userId))
      .returning();
    if (!updated) throw new Error('User update failed unexpectedly');
    const safeUser = sanitizeUser(updated);
    await ctx.events.publish(
      'user',
      userId,
      'USER_UPDATED',
      safeUser as unknown as Record<string, unknown>
    );
    return reply.code(200).send({ data: safeUser });
  });

  // ── PUT /users/me/password — Change my password ───────────────────────
  fastify.put('/users/me/password', async (request, reply) => {
    const { tenantId, userId } = (request as unknown as AuthedRequest).auth;
    const ctx = ctxFor(request);
    const body = ChangePasswordSchema.safeParse(request.body);
    if (!body.success)
      throw new ValidationError(body.error.errors.map((e) => e.message).join('; '));
    const [user] = await ctx.db.raw
      .select()
      .from(users)
      .where(and(eq(users.id, userId), eq(users.tenantId, tenantId)));
    if (!user) throw new NotFoundError('User', userId);
    const valid = await argon2.verify(user.passwordHash, body.data.currentPassword);
    if (!valid)
      throw new BusinessError('INVALID_CURRENT_PASSWORD', 'Current password is incorrect');
    const passwordHash = await argon2.hash(body.data.newPassword, { type: argon2.argon2id });
    await ctx.db.raw
      .update(users)
      .set({ passwordHash, updatedAt: new Date() })
      .where(eq(users.id, userId));
    return reply.code(200).send({ data: { message: 'Password changed successfully' } });
  });

  // ── POST /users/me/avatar/upload — Get S3 upload URL ─────────────────
  fastify.post('/users/me/avatar/upload', async (request, reply) => {
    const { tenantId, userId } = (request as unknown as AuthedRequest).auth;
    const body = request.body as { fileName?: string; contentType?: string };
    const s3Key = `tenants/${tenantId}/users/${userId}/avatar/${Date.now()}-${body.fileName ?? 'avatar.jpg'}`;
    return reply.code(200).send({
      data: {
        uploadUrl: `${process.env['MINIO_ENDPOINT'] ?? 'http://localhost:9000'}/erp-storage/${s3Key}`,
        s3Key,
        contentType: body.contentType ?? 'image/jpeg',
        expiresIn: 900,
      },
    });
  });
}
