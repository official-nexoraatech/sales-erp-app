-- ES-16: Backend Performance & Hardening — missing index audit
-- Plain CREATE INDEX (not CONCURRENTLY): drizzle-kit migrate always runs each
-- migration file inside a transaction, and CONCURRENTLY cannot run in one.
--
-- This audit re-verified every index the ES-16 prompt asked for against the
-- actual schema (packages/db-client/src/schema). Several requested indexes
-- were already satisfied by earlier phases (Phase 13 / ES-03 / ES-13) under
-- different names, or targeted columns/tables that don't exist in this
-- codebase. Only genuinely missing indexes are added below; see
-- ERP-PLANNING/phase-completions/ES-16_COMPLETION.md for the full audit.

-- ─── invoices: tenant-scoped partial index for unpaid/overdue lookups ──────
-- idx_invoices_due_date (due_date, status, tenant_id) already exists but leads
-- with due_date, not tenant_id, and is not partial — every tenant's AR aging
-- query re-scans all fully-paid/cancelled rows too.
CREATE INDEX IF NOT EXISTS idx_invoices_tenant_due_date
  ON invoices (tenant_id, due_date)
  WHERE status NOT IN ('PAID', 'CANCELLED');

-- ─── inventory_ledger: item-wide chronological lookup (warehouse-agnostic) ──
-- idx_inv_ledger_tenant_item_wh (tenant_id, item_id, warehouse_id, created_at)
-- already covers per-warehouse queries. Costing (ES-13) and ledger-history
-- reads that scan an item across all warehouses can't use that index for an
-- ordered scan because warehouse_id sits between item_id and created_at.
CREATE INDEX IF NOT EXISTS idx_inventory_ledger_tenant_item_date
  ON inventory_ledger (tenant_id, item_id, created_at DESC);

-- ─── inventory_fifo_layers: partial index excluding exhausted layers ───────
-- idx_fifo_layers_consume_order (tenant_id, item_id, warehouse_id, received_at)
-- already exists but isn't partial — FIFO consumption (ValuationService)
-- filters remaining_qty > 0 on every read, and exhausted layers are never
-- deleted, so they accumulate in the index forever.
CREATE INDEX IF NOT EXISTS idx_fifo_layers_tenant_item_wh_active
  ON inventory_fifo_layers (tenant_id, item_id, warehouse_id, received_at ASC)
  WHERE remaining_qty > 0;

-- ─── outbox_events: tighten the relay worker's hot polling query ──────────
-- OutboxRelayWorker.getNextBatch() runs:
--   WHERE published = false AND failed = false ORDER BY created_at LIMIT n FOR UPDATE SKIP LOCKED
-- idx_outbox_unpublished (published, created_at) doesn't include `failed`, so
-- failed-and-unpublished rows still need a Filter step instead of being
-- pruned by the index itself. (Note: this table has no `status`/`tenant_id`
-- polling path — the relay worker is a single global process, not
-- tenant-scoped — so the ES-16 prompt's spec'd
-- `idx_outbox_events_tenant_status_created` doesn't match this schema.)
CREATE INDEX IF NOT EXISTS idx_outbox_relay_queue
  ON outbox_events (created_at ASC)
  WHERE published = false AND failed = false;

-- ─── NOT APPLICABLE / ALREADY COVERED (verified against current schema) ────
-- idx_invoices_tenant_status_date  -> already covered by idx_invoices_tenant_status (tenant_id, status, invoice_date)
-- idx_invoices_tenant_customer     -> already covered by idx_invoices_tenant_customer_date (tenant_id, customer_id, created_at)
-- idx_purchase_orders_tenant_status -> already covered by idx_po_tenant_status (tenant_id, status, created_at)
-- idx_vendor_invoices_tenant_status -> no `vendor_invoices` table exists in this schema (supplier invoice fields live on GRN/PO lines)
-- idx_inbox_events_event_id        -> redundant: unique(event_id, consumer_service) already indexes event_id as the leading column
-- idx_items_tenant_code            -> already covered by the `items_tenant_code` UNIQUE constraint on (tenant_id, item_code)
-- idx_customers_tenant_search      -> already covered by idx_customers_displayname_trgm (GIN trigram, added in Phase 13) — better than text_pattern_ops for fuzzy search
