-- ES-19 — Enterprise Security: TOTP 2FA, sessions, impersonation audit, IP blocking

ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "totp_secret" text;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "totp_enabled" boolean NOT NULL DEFAULT false;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "backup_codes" text[];

CREATE TABLE IF NOT EXISTS "active_sessions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" integer NOT NULL,
  "user_id" integer NOT NULL,
  "device_info" varchar(500),
  "ip_address" inet NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "last_seen_at" timestamptz NOT NULL DEFAULT now(),
  "refresh_token_id" integer
);

CREATE INDEX IF NOT EXISTS "idx_active_sessions_user" ON "active_sessions" ("tenant_id", "user_id");
CREATE INDEX IF NOT EXISTS "idx_active_sessions_refresh_token" ON "active_sessions" ("refresh_token_id");

CREATE TABLE IF NOT EXISTS "security_audit_log" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" integer NOT NULL,
  "actor_id" integer NOT NULL,
  "actor_role" varchar(50),
  "target_user_id" integer,
  "action" varchar(50) NOT NULL,
  "ip_address" inet,
  "details" jsonb,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "idx_security_audit_actor" ON "security_audit_log" ("tenant_id", "actor_id", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "idx_security_audit_action" ON "security_audit_log" ("tenant_id", "action", "created_at" DESC);

CREATE TABLE IF NOT EXISTS "blocked_ips" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "ip_address" inet NOT NULL,
  "blocked_until" timestamptz NOT NULL,
  "reason" varchar(100),
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "blocked_ips_ip_unique" UNIQUE ("ip_address")
);
