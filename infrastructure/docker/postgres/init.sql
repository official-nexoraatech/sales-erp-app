-- ERP Database Initialization
-- Runs once on postgres-primary container first start

-- ─── Reliability: bound query execution time ──────────────────────────────
-- Chaos engineering drill (Experiment 2.1) found unbounded query waits under
-- severe latency; caps any single statement at 3s so a slow query fails fast
-- instead of holding a connection/lock indefinitely.
ALTER SYSTEM SET statement_timeout = '3000';
SELECT pg_reload_conf();

-- ─── Extensions ────────────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";   -- GIN index for fuzzy search

-- ─── Replication User ──────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'repl_user') THEN
    CREATE ROLE repl_user WITH REPLICATION LOGIN PASSWORD 'repl_password';
  END IF;
END
$$;

-- ─── Updated-At trigger function ───────────────────────────────────────────
-- Applied to every mutable table via trigger in each migration
CREATE OR REPLACE FUNCTION trigger_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ─── Tenant isolation: Row Level Security helper ────────────────────────────
-- Services SET LOCAL app.current_tenant_id = :tenantId; per request
-- All tables use: USING (tenant_id = current_setting('app.current_tenant_id')::int)
CREATE OR REPLACE FUNCTION current_tenant_id()
RETURNS INTEGER AS $$
BEGIN
  RETURN current_setting('app.current_tenant_id', true)::INTEGER;
EXCEPTION
  WHEN OTHERS THEN
    RAISE EXCEPTION 'Security: tenant context not set. Access denied.';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ─── Done ──────────────────────────────────────────────────────────────────
-- NOTE: outbox_events, inbox_events, audit_log, feature_flags, and saga_log
-- used to be bootstrapped here too, but that raced with Drizzle migration
-- 0000_worried_blue_marvel (which creates the same tables without IF NOT
-- EXISTS), so `drizzle-kit migrate` always failed with "relation already
-- exists" and every migration after 0000 silently never ran. Table/seed
-- ownership now belongs entirely to the Drizzle migrations
-- (see 0000_worried_blue_marvel.sql and 0021_es28_seed_feature_flag_defaults.sql).
DO $$ BEGIN
  RAISE NOTICE 'ERP database initialized successfully';
END $$;
