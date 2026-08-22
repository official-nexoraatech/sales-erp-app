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

-- ─── Application Role (non-superuser, required for RLS to have any effect) ─
-- Phase 9 GUC-per-request rollout follow-up (2026-08-22): the default Postgres
-- Docker image makes POSTGRES_USER ('erp') a superuser, and Postgres
-- unconditionally bypasses Row-Level Security for superusers — confirmed
-- empirically (a real RLS policy + FORCE ROW LEVEL SECURITY had zero effect
-- when queried as 'erp'). All application services must connect as this role
-- instead once RLS starts being enabled table-by-table; 'erp' remains available
-- for migrations/admin access. erp_app owns application tables/sequences/
-- functions (not just granted access) so it can run `drizzle-kit migrate`
-- (ALTER TABLE requires ownership or superuser) — FORCE ROW LEVEL SECURITY on
-- each RLS-enabled table ensures ownership doesn't bypass RLS the way it
-- normally would for a table's owner.
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'erp_app') THEN
    CREATE ROLE erp_app WITH LOGIN PASSWORD 'erp_app_password' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  END IF;
END
$$;

GRANT ALL PRIVILEGES ON DATABASE erp TO erp_app;
GRANT ALL PRIVILEGES ON SCHEMA public TO erp_app;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO erp_app;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO erp_app;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO erp_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO erp_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO erp_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO erp_app;

-- Only matters when this runs against a database that already has objects
-- created by 'erp' (e.g. migrations were run before this role existed) — a
-- truly fresh install has zero tables at this point, so this loop is a no-op
-- and every table Drizzle creates afterward (via DATABASE_URL now pointing at
-- erp_app) is erp_app-owned automatically. REASSIGN OWNED BY can't be used
-- here because it also tries to reassign database-level ownership, which
-- Postgres refuses ("required by the database system").
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tableowner = 'erp' LOOP
    EXECUTE format('ALTER TABLE public.%I OWNER TO erp_app', r.tablename);
  END LOOP;
  FOR r IN SELECT sequencename FROM pg_sequences WHERE schemaname = 'public' AND sequenceowner = 'erp' LOOP
    EXECUTE format('ALTER SEQUENCE public.%I OWNER TO erp_app', r.sequencename);
  END LOOP;
  FOR r IN SELECT p.proname AS name, pg_get_function_identity_arguments(p.oid) AS args
           FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
           JOIN pg_roles ro ON ro.oid = p.proowner
           WHERE n.nspname = 'public' AND ro.rolname = 'erp' LOOP
    EXECUTE format('ALTER FUNCTION public.%I(%s) OWNER TO erp_app', r.name, r.args);
  END LOOP;
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
