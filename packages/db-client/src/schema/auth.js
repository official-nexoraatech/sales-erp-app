import { bigserial, boolean, index, integer, pgTable, text, timestamp, unique, varchar, } from 'drizzle-orm/pg-core';
// ─── Users ─────────────────────────────────────────────────────────────────
export const users = pgTable('users', {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    tenantId: integer('tenant_id').notNull(),
    email: varchar('email', { length: 255 }).notNull(),
    passwordHash: varchar('password_hash', { length: 255 }).notNull(),
    firstName: varchar('first_name', { length: 100 }).notNull(),
    lastName: varchar('last_name', { length: 100 }).notNull(),
    phone: varchar('phone', { length: 20 }),
    isActive: boolean('is_active').notNull().default(true),
    isEmailVerified: boolean('is_email_verified').notNull().default(false),
    failedLoginAttempts: integer('failed_login_attempts').notNull().default(0),
    lockedUntil: timestamp('locked_until', { withTimezone: true }),
    lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
    emailVerifiedAt: timestamp('email_verified_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
    unique('users_tenant_email').on(t.tenantId, t.email),
    index('idx_users_tenant').on(t.tenantId),
    index('idx_users_email').on(t.email),
]);
// ─── Roles ─────────────────────────────────────────────────────────────────
export const roles = pgTable('roles', {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    tenantId: integer('tenant_id').notNull(),
    name: varchar('name', { length: 100 }).notNull(),
    description: text('description'),
    isSystem: boolean('is_system').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
    unique('roles_tenant_name').on(t.tenantId, t.name),
    index('idx_roles_tenant').on(t.tenantId),
]);
// ─── User ↔ Role join ──────────────────────────────────────────────────────
export const userRoles = pgTable('user_roles', {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    userId: integer('user_id').notNull(),
    roleId: integer('role_id').notNull(),
    tenantId: integer('tenant_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
    unique('user_roles_unique').on(t.userId, t.roleId),
    index('idx_user_roles_user').on(t.userId, t.tenantId),
    index('idx_user_roles_role').on(t.roleId),
]);
// ─── Role ↔ Permission join ────────────────────────────────────────────────
export const rolePermissions = pgTable('role_permissions', {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    roleId: integer('role_id').notNull(),
    permission: varchar('permission', { length: 100 }).notNull(),
    tenantId: integer('tenant_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
    unique('role_permissions_unique').on(t.roleId, t.permission),
    index('idx_role_permissions_role').on(t.roleId),
]);
// ─── Refresh Tokens (stored as SHA-256 hash — never store plain token) ────
export const refreshTokens = pgTable('refresh_tokens', {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    userId: integer('user_id').notNull(),
    tenantId: integer('tenant_id').notNull(),
    tokenHash: varchar('token_hash', { length: 64 }).notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    userAgent: text('user_agent'),
    ipAddress: varchar('ip_address', { length: 45 }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
    unique('refresh_tokens_hash').on(t.tokenHash),
    index('idx_refresh_tokens_user').on(t.userId, t.tenantId),
    index('idx_refresh_tokens_expires').on(t.expiresAt, t.revokedAt),
]);
// ─── Password Reset Tokens ─────────────────────────────────────────────────
export const passwordResetTokens = pgTable('password_reset_tokens', {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    userId: integer('user_id').notNull(),
    tenantId: integer('tenant_id').notNull(),
    tokenHash: varchar('token_hash', { length: 64 }).notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
    unique('password_reset_tokens_hash').on(t.tokenHash),
    index('idx_password_reset_user').on(t.userId, t.tenantId),
]);
//# sourceMappingURL=auth.js.map