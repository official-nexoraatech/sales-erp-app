-- Phase 13: Database Index Audit — Enterprise Hardening
-- Adds performance-critical indexes identified during EXPLAIN ANALYZE audit.
-- All CREATE INDEX CONCURRENTLY — zero-downtime, safe for production deploy.

-- ─── 1. pg_trgm extension (required for GIN trigram indexes) ───────────────
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ─── 2. invoices: (tenant_id, customer_id, created_at) ────────────────────
-- Existing: idx_invoices_customer (customer_id, tenant_id) — no date ordering.
-- New index supports: customer statement queries, date-range scans per customer.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_invoices_tenant_customer_date
  ON invoices (tenant_id, customer_id, created_at DESC);

-- ─── 3. invoices: (tenant_id, created_at) — general date-range list queries ─
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_invoices_tenant_date
  ON invoices (tenant_id, created_at DESC);

-- ─── 4. customers: GIN trigram index on display_name ─────────────────────
-- Enables: ILIKE '%name%' and pg_trgm similarity searches without seq scan.
-- Used by: search-service customer fuzzy search.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_customers_displayname_trgm
  ON customers USING gin (display_name gin_trgm_ops);

-- Also index company_name for B2B customer searches
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_customers_companyname_trgm
  ON customers USING gin (company_name gin_trgm_ops)
  WHERE company_name IS NOT NULL;

-- ─── 5. items: GIN trigram index on name for full-text search ─────────────
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_items_name_trgm
  ON items USING gin (name gin_trgm_ops);

-- ─── 6. invoices: (tenant_id, status, created_at) — pending/overdue queries ─
-- Existing idx_invoices_tenant_status uses invoice_date; this adds created_at variant.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_invoices_tenant_status_created
  ON invoices (tenant_id, status, created_at DESC);

-- ─── 7. outbox_events: unprocessed polling index (critical for relay worker) ─
-- Existing schema likely has (published, created_at); add PARTIAL for hot path.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_outbox_unpublished
  ON outbox_events (created_at ASC)
  WHERE published = false;

-- ─── 8. inventory_ledger: already has (tenant_id, item_id, warehouse_id, created_at)
-- Verify: SELECT indexname FROM pg_indexes WHERE tablename = 'inventory_ledger';
-- NO NEW INDEX NEEDED — idx_inv_ledger_tenant_item_wh already covers the spec requirement.

-- ─── 9. financial_entries: already has (tenant_id, created_at) ────────────
-- NO NEW INDEX NEEDED — idx_financial_entries_tenant_date already satisfies spec.

-- ─── 10. purchase_orders: already has (tenant_id, status, created_at) ──────
-- NO NEW INDEX NEEDED — idx_po_tenant_status already satisfies spec.

-- ─── Slow query log: Enable pg_stat_statements for query profiling ─────────
-- (Run as superuser; safe to run multiple times)
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;
