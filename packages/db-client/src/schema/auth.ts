import {
  bigserial,
  boolean,
  index,
  inet,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

// ─── Users ─────────────────────────────────────────────────────────────────
export const users = pgTable(
  'users',
  {
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
    // ES-19 — TOTP 2FA: totpSecret is AES-256-GCM ciphertext, never plaintext
    totpSecret: text('totp_secret'),
    totpEnabled: boolean('totp_enabled').notNull().default(false),
    backupCodes: text('backup_codes').array(),
    // PG-020: populated on first successful SSO login (session B) to pin the IdP subject
    // claim to this user, rather than re-matching by email on every login — schema only
    // in this change, nothing writes these columns yet.
    ssoProvider: varchar('sso_provider', { length: 30 }),
    ssoSubject: varchar('sso_subject', { length: 255 }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    unique('users_tenant_email').on(t.tenantId, t.email),
    unique('users_tenant_provider_subject').on(t.tenantId, t.ssoProvider, t.ssoSubject),
    index('idx_users_tenant').on(t.tenantId),
    index('idx_users_email').on(t.email),
  ]
);

// ─── Roles ─────────────────────────────────────────────────────────────────
export const roles = pgTable(
  'roles',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    tenantId: integer('tenant_id').notNull(),
    name: varchar('name', { length: 100 }).notNull(),
    description: text('description'),
    isSystem: boolean('is_system').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    unique('roles_tenant_name').on(t.tenantId, t.name),
    index('idx_roles_tenant').on(t.tenantId),
  ]
);

// ─── User ↔ Role join ──────────────────────────────────────────────────────
export const userRoles = pgTable(
  'user_roles',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    userId: integer('user_id').notNull(),
    roleId: integer('role_id').notNull(),
    tenantId: integer('tenant_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    unique('user_roles_unique').on(t.userId, t.roleId),
    index('idx_user_roles_user').on(t.userId, t.tenantId),
    index('idx_user_roles_role').on(t.roleId),
  ]
);

// ─── Role ↔ Permission join ────────────────────────────────────────────────
export const rolePermissions = pgTable(
  'role_permissions',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    roleId: integer('role_id').notNull(),
    permission: varchar('permission', { length: 100 }).notNull(),
    tenantId: integer('tenant_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    unique('role_permissions_unique').on(t.roleId, t.permission),
    index('idx_role_permissions_role').on(t.roleId),
  ]
);

// ─── Refresh Tokens (stored as SHA-256 hash — never store plain token) ────
export const refreshTokens = pgTable(
  'refresh_tokens',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    userId: integer('user_id').notNull(),
    tenantId: integer('tenant_id').notNull(),
    tokenHash: varchar('token_hash', { length: 64 }).notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    userAgent: text('user_agent'),
    ipAddress: varchar('ip_address', { length: 45 }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    unique('refresh_tokens_hash').on(t.tokenHash),
    index('idx_refresh_tokens_user').on(t.userId, t.tenantId),
    index('idx_refresh_tokens_expires').on(t.expiresAt, t.revokedAt),
  ]
);

// ─── Password Reset Tokens ─────────────────────────────────────────────────
export const passwordResetTokens = pgTable(
  'password_reset_tokens',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    userId: integer('user_id').notNull(),
    tenantId: integer('tenant_id').notNull(),
    tokenHash: varchar('token_hash', { length: 64 }).notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    unique('password_reset_tokens_hash').on(t.tokenHash),
    index('idx_password_reset_user').on(t.userId, t.tenantId),
  ]
);

// ─── Active Sessions (ES-19 — session management / remote logout) ─────────
export const activeSessions = pgTable(
  'active_sessions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: integer('tenant_id').notNull(),
    userId: integer('user_id').notNull(),
    deviceInfo: varchar('device_info', { length: 500 }),
    ipAddress: inet('ip_address').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).defaultNow().notNull(),
    refreshTokenId: integer('refresh_token_id'),
  },
  (t) => [
    index('idx_active_sessions_user').on(t.tenantId, t.userId),
    index('idx_active_sessions_refresh_token').on(t.refreshTokenId),
  ]
);

// ─── Security Audit Log (ES-19 — impersonation, MFA, session, suspicious login) ─
export const securityAuditLog = pgTable(
  'security_audit_log',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: integer('tenant_id').notNull(),
    actorId: integer('actor_id').notNull(),
    actorRole: varchar('actor_role', { length: 50 }),
    targetUserId: integer('target_user_id'),
    action: varchar('action', { length: 50 })
      .notNull()
      .$type<
        | 'IMPERSONATION_START'
        | 'IMPERSONATION_END'
        | 'MFA_ENABLED'
        | 'MFA_DISABLED'
        | 'SESSION_TERMINATED'
        | 'SUSPICIOUS_LOGIN'
        | 'ADMIN_PASSWORD_RESET'
      >(),
    ipAddress: inet('ip_address'),
    details: jsonb('details'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index('idx_security_audit_actor').on(t.tenantId, t.actorId, t.createdAt),
    index('idx_security_audit_action').on(t.tenantId, t.action, t.createdAt),
  ]
);

// ─── Blocked IPs (ES-19 — suspicious login detection) ──────────────────────
export const blockedIps = pgTable(
  'blocked_ips',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    ipAddress: inet('ip_address').notNull(),
    blockedUntil: timestamp('blocked_until', { withTimezone: true }).notNull(),
    reason: varchar('reason', { length: 100 }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [unique('blocked_ips_ip_unique').on(t.ipAddress)]
);

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Role = typeof roles.$inferSelect;
export type NewRole = typeof roles.$inferInsert;
export type RefreshToken = typeof refreshTokens.$inferSelect;
export type PasswordResetToken = typeof passwordResetTokens.$inferSelect;
export type ActiveSession = typeof activeSessions.$inferSelect;
export type NewActiveSession = typeof activeSessions.$inferInsert;
export type SecurityAuditLogEntry = typeof securityAuditLog.$inferSelect;
export type NewSecurityAuditLogEntry = typeof securityAuditLog.$inferInsert;
export type BlockedIp = typeof blockedIps.$inferSelect;
