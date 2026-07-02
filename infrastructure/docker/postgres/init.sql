-- ERP Database Initialization
-- Runs once on postgres-primary container first start

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

-- ─── Outbox Events (Transactional Outbox Pattern) ──────────────────────────
CREATE TABLE IF NOT EXISTS outbox_events (
  id          BIGSERIAL       PRIMARY KEY,
  event_id    VARCHAR(26)     NOT NULL UNIQUE,      -- ULID
  event_type  VARCHAR(100)    NOT NULL,
  aggregate_type VARCHAR(100) NOT NULL,
  aggregate_id   BIGINT       NOT NULL,
  tenant_id   INTEGER         NOT NULL,
  payload     JSONB           NOT NULL,
  published   BOOLEAN         NOT NULL DEFAULT FALSE,
  published_at TIMESTAMPTZ,
  created_at  TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_outbox_unpublished
  ON outbox_events (published, created_at)
  WHERE published = FALSE;

CREATE INDEX IF NOT EXISTS idx_outbox_tenant
  ON outbox_events (tenant_id, created_at);

-- ─── Inbox Events (Idempotency for event consumers) ────────────────────────
CREATE TABLE IF NOT EXISTS inbox_events (
  id               BIGSERIAL     PRIMARY KEY,
  event_id         VARCHAR(26)   NOT NULL,
  consumer_service VARCHAR(100)  NOT NULL,
  status           VARCHAR(20)   NOT NULL DEFAULT 'PROCESSING'
                   CHECK (status IN ('PROCESSING', 'PROCESSED', 'FAILED')),
  tenant_id        INTEGER       NOT NULL,
  error_message    TEXT,
  processed_at     TIMESTAMPTZ,
  created_at       TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  UNIQUE (event_id, consumer_service)
);

CREATE INDEX IF NOT EXISTS idx_inbox_status
  ON inbox_events (status, created_at);

-- ─── Audit Log (Append-only, immutable) ────────────────────────────────────
CREATE TABLE IF NOT EXISTS audit_log (
  id          BIGSERIAL       PRIMARY KEY,
  tenant_id   INTEGER         NOT NULL,
  user_id     INTEGER         NOT NULL,
  action      VARCHAR(200)    NOT NULL,
  entity_type VARCHAR(100)    NOT NULL,
  entity_id   BIGINT,
  before_data JSONB,
  after_data  JSONB,
  metadata    JSONB,
  ip_address  INET,
  user_agent  TEXT,
  created_at  TIMESTAMPTZ     NOT NULL DEFAULT NOW()
) PARTITION BY RANGE (created_at);

CREATE TABLE IF NOT EXISTS audit_log_2025
  PARTITION OF audit_log
  FOR VALUES FROM ('2025-01-01') TO ('2026-01-01');

CREATE TABLE IF NOT EXISTS audit_log_2026
  PARTITION OF audit_log
  FOR VALUES FROM ('2026-01-01') TO ('2027-01-01');

CREATE TABLE IF NOT EXISTS audit_log_2027
  PARTITION OF audit_log
  FOR VALUES FROM ('2027-01-01') TO ('2028-01-01');

CREATE INDEX IF NOT EXISTS idx_audit_log_tenant_created
  ON audit_log (tenant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_log_entity
  ON audit_log (entity_type, entity_id, tenant_id);

-- ─── Feature Flags ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS feature_flags (
  id          BIGSERIAL       PRIMARY KEY,
  tenant_id   INTEGER,                               -- NULL = global default
  flag_key    VARCHAR(200)    NOT NULL,
  enabled     BOOLEAN         NOT NULL DEFAULT FALSE,
  config      JSONB,
  created_at  TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, flag_key)
);

CREATE INDEX IF NOT EXISTS idx_feature_flags_tenant
  ON feature_flags (tenant_id, flag_key);

-- Seed global feature flag defaults from ERP_MASTER_SPEC Section 11
INSERT INTO feature_flags (tenant_id, flag_key, enabled) VALUES
  (NULL, 'pos.enabled',                      TRUE),
  (NULL, 'gst.e-invoice.enabled',            FALSE),
  (NULL, 'gst.e-way-bill.enabled',           FALSE),
  (NULL, 'multi-branch.enabled',             FALSE),
  (NULL, 'inventory.fabric-rolls.enabled',   FALSE),
  (NULL, 'inventory.variants.enabled',       TRUE),
  (NULL, 'inventory.reservations.enabled',   TRUE),
  (NULL, 'sales.quotations.enabled',         TRUE),
  (NULL, 'sales.loyalty.enabled',            FALSE),
  (NULL, 'hr.alterations.enabled',           TRUE),
  (NULL, 'hr.tailoring.enabled',             FALSE),
  (NULL, 'finance.double-entry.enabled',     TRUE),
  (NULL, 'finance.tds.enabled',              FALSE),
  (NULL, 'integrations.whatsapp.enabled',    FALSE),
  (NULL, 'integrations.sms.enabled',         TRUE),
  (NULL, 'integrations.payment-gateway.enabled', FALSE),
  (NULL, 'platform.ai.enabled',              FALSE),
  (NULL, 'platform.offline.enabled',         FALSE)
ON CONFLICT (tenant_id, flag_key) DO NOTHING;

-- ─── Saga Log ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS saga_log (
  id             BIGSERIAL      PRIMARY KEY,
  saga_id        UUID           NOT NULL DEFAULT gen_random_uuid(),
  saga_type      VARCHAR(100)   NOT NULL,
  tenant_id      INTEGER        NOT NULL,
  correlation_id VARCHAR(36)    NOT NULL,
  status         VARCHAR(20)    NOT NULL DEFAULT 'STARTED'
                 CHECK (status IN ('STARTED', 'COMPLETED', 'COMPENSATING', 'COMPENSATED', 'FAILED')),
  current_step   INTEGER        NOT NULL DEFAULT 0,
  step_history   JSONB          NOT NULL DEFAULT '[]',
  payload        JSONB          NOT NULL DEFAULT '{}',
  error          TEXT,
  created_at     TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ    NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_saga_log_tenant_status
  ON saga_log (tenant_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_saga_log_correlation
  ON saga_log (correlation_id);

-- ─── Done ──────────────────────────────────────────────────────────────────
DO $$ BEGIN
  RAISE NOTICE 'ERP database initialized successfully';
END $$;
